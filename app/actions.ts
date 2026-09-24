'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getActiveBusiness, getActiveBusinessOrNull } from '@/lib/services/business';
import { assignToPeriod } from '@/lib/services/documents';
import { syncCardcomDocuments } from '@/lib/services/sync-cardcom';
import { deductibleVat, reconcileAmounts, vatRateBpAt, fromGross } from '@/lib/vat';
import { toAgorot } from '@/lib/money';
import { isValidIsraeliId, normalizeVatId } from '@/lib/israeli-id';
import { buildPeriod } from '@/lib/periods';
import { getInvoiceProvider } from '@/lib/invoicing';
import { backupPending } from '@/lib/drive/backup';
import { syncSchedule } from '@/lib/services/recognition';
import { buildScheduleFromPayments } from '@/lib/installments';
import type { DocType, Direction, InputKind, LegalType, PaymentMethod, VatFrequency, VatTreatment } from '@prisma/client';

export type ActionResult = { ok: true; message?: string; data?: unknown } | { ok: false; error: string };

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function optionalStr(form: FormData, key: string): string | null {
  const value = str(form, key);
  return value === '' ? null : value;
}

function num(form: FormData, key: string): number | null {
  const value = str(form, key);
  if (value === '') return null;
  const parsed = Number(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateInput(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`תאריך לא תקין: ${value}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

// ---------------------------------------------------------------------------
// הגדרות העסק
// ---------------------------------------------------------------------------

export async function saveBusiness(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const name = str(form, 'name');
    const vatId = normalizeVatId(str(form, 'vatId'));

    if (!name) return { ok: false, error: 'יש להזין את שם העסק.' };
    if (!vatId) return { ok: false, error: 'יש להזין מספר עוסק.' };
    if (!isValidIsraeliId(vatId)) {
      return { ok: false, error: `מספר העוסק ${vatId} אינו תקין — ספרת הביקורת אינה מתאימה. בדקי שוב.` };
    }

    const data = {
      name,
      vatId,
      legalType: str(form, 'legalType') as LegalType,
      vatFrequency: str(form, 'vatFrequency') as VatFrequency,
      address: optionalStr(form, 'address'),
      city: optionalStr(form, 'city'),
      phone: optionalStr(form, 'phone'),
      email: optionalStr(form, 'email'),
      cardcomTerminal: optionalStr(form, 'cardcomTerminal'),
    };

    const existing = await getActiveBusinessOrNull();
    if (existing) await prisma.business.update({ where: { id: existing.id }, data });
    else await prisma.business.create({ data });

    revalidatePath('/', 'layout');
    return { ok: true, message: 'פרטי העסק נשמרו.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'שמירה נכשלה.' };
  }
}

// ---------------------------------------------------------------------------
// מסמכים
// ---------------------------------------------------------------------------

/** שומר מסמך — חדש או קיים. משמש גם לאישור טיוטה שנסרקה וגם להזנה ידנית. */
export async function saveDocument(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const id = optionalStr(form, 'id');
    const direction = str(form, 'direction') as Direction;
    const issueDate = parseDateInput(str(form, 'issueDate'));
    const reportDate = str(form, 'reportDate') ? parseDateInput(str(form, 'reportDate')) : issueDate;

    const counterpartyVatId = normalizeVatId(str(form, 'counterpartyVatId'));
    if (counterpartyVatId && !isValidIsraeliId(counterpartyVatId)) {
      return { ok: false, error: `מספר העוסק ${counterpartyVatId} אינו תקין. דיווח עם מספר שגוי יידחה.` };
    }

    const rateBp = num(form, 'vatRatePercent') != null
      ? Math.round(num(form, 'vatRatePercent')! * 100)
      : vatRateBpAt(issueDate);

    const netInput = num(form, 'netAmount');
    const vatInput = num(form, 'vatAmount');
    const totalInput = num(form, 'totalAmount');

    const amounts = reconcileAmounts({
      netAgorot: netInput != null ? toAgorot(netInput) : null,
      vatAgorot: vatInput != null ? toAgorot(vatInput) : null,
      totalAgorot: totalInput != null ? toAgorot(totalInput) : null,
      rateBp,
    });

    if (amounts.totalAgorot === 0) {
      return { ok: false, error: 'יש להזין לפחות סכום אחד — לפני מע"מ, מע"מ, או סה"כ.' };
    }
    if (amounts.netAgorot < 0 || amounts.vatAgorot < 0) {
      return {
        ok: false,
        error: 'הסכומים אינם עקביים — התקבל ערך שלילי. לזיכוי יש להזין סכומים חיוביים ולסמן "חשבונית זיכוי".',
      };
    }

    const deductibleBp = direction === 'EXPENSE' ? Number(str(form, 'deductibleBp') || 10000) : 10000;
    const vatTreatment = (str(form, 'vatTreatment') || 'STANDARD') as VatTreatment;
    const docType = str(form, 'docType') as DocType;
    const isCredit = form.get('isCredit') === 'on' || docType === 'CREDIT_INVOICE';

    const data = {
      businessId: business.id,
      direction,
      docType,
      status: (str(form, 'status') || 'CONFIRMED') as 'DRAFT' | 'CONFIRMED' | 'VOID',
      issueDate,
      reportDate,
      number: str(form, 'number') || 'ללא מספר',
      allocationNumber: optionalStr(form, 'allocationNumber')?.replace(/\D/g, '') || null,
      counterpartyName: str(form, 'counterpartyName') || 'ללא שם',
      counterpartyVatId,
      netAgorot: amounts.netAgorot,
      vatAgorot: amounts.vatAgorot,
      totalAgorot: amounts.totalAgorot,
      vatRateBp: rateBp,
      isCredit,
      // מספר תשלומים מהטופס; שינוי מאפס את הסכום הקבוע כדי שייחשב מחדש
      installments: (num(form, 'installments') ?? 1) > 1 ? Math.trunc(num(form, 'installments')!) : null,
      installmentAgorot: null,
      firstInstallmentAgorot: null,
      vatTreatment,
      inputKind: direction === 'EXPENSE' ? ((str(form, 'inputKind') || 'OTHER') as InputKind) : null,
      deductibleBp,
      deductibleVatAgorot: direction === 'EXPENSE' ? deductibleVat(amounts.vatAgorot, deductibleBp) : 0,
      category: optionalStr(form, 'category'),
      notes: optionalStr(form, 'notes'),
    };

    let documentId: string;
    if (id) {
      const existing = await prisma.document.findUnique({
        where: { id },
        select: { vatPeriod: { select: { status: true, id: true } } },
      });
      if (existing?.vatPeriod?.status === 'FILED') {
        return {
          ok: false,
          error: 'המסמך שייך לתקופה שכבר דווחה לרשות המסים ולכן אי אפשר לשנות אותו. תיקון נעשה במסמך חדש.',
        };
      }
      await prisma.document.update({ where: { id }, data });
      documentId = id;
    } else {
      const created = await prisma.document.create({ data, select: { id: true } });
      documentId = created.id;
    }

    await assignToPeriod({
      businessId: business.id,
      documentId,
      reportDate,
      frequency: business.vatFrequency,
    });
    await syncSchedule(documentId);

    // לומדים את סיווג הספק לפעם הבאה
    if (direction === 'EXPENSE' && counterpartyVatId) {
      await prisma.contact.upsert({
        where: { businessId_vatId: { businessId: business.id, vatId: counterpartyVatId } },
        create: {
          businessId: business.id,
          vatId: counterpartyVatId,
          name: data.counterpartyName,
          type: 'SUPPLIER',
          defaultCategory: data.category,
          defaultInputKind: data.inputKind,
          defaultDeductibleBp: deductibleBp,
        },
        update: {
          name: data.counterpartyName,
          defaultCategory: data.category,
          defaultInputKind: data.inputKind,
          defaultDeductibleBp: deductibleBp,
        },
      });
    }

    revalidatePath('/expenses');
    revalidatePath('/income');
    revalidatePath('/reports/vat');
    revalidatePath('/');
    return { ok: true, message: 'המסמך נשמר.', data: { id: documentId } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'שמירת המסמך נכשלה.' };
  }
}

export async function setDocumentStatus(id: string, status: 'DRAFT' | 'CONFIRMED' | 'VOID'): Promise<ActionResult> {
  try {
    const existing = await prisma.document.findUnique({
      where: { id },
      select: { vatPeriod: { select: { status: true } } },
    });
    if (existing?.vatPeriod?.status === 'FILED') {
      return { ok: false, error: 'המסמך שייך לתקופה שכבר דווחה ולכן אי אפשר לשנות את מצבו.' };
    }
    await prisma.document.update({ where: { id }, data: { status } });
    revalidatePath('/expenses');
    revalidatePath('/income');
    revalidatePath('/reports/vat');
    revalidatePath('/');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'העדכון נכשל.' };
  }
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  try {
    const existing = await prisma.document.findUnique({
      where: { id },
      select: { status: true, source: true, vatPeriod: { select: { status: true } } },
    });
    if (!existing) return { ok: false, error: 'המסמך לא נמצא.' };
    if (existing.vatPeriod?.status === 'FILED') {
      return { ok: false, error: 'אי אפשר למחוק מסמך מתקופה שכבר דווחה.' };
    }
    // מסמך מאושר שנקלט מקארדקום מייצג חשבונית חוקית שהופקה — מבטלים ולא מוחקים.
    if (existing.source === 'CARDCOM' && existing.status === 'CONFIRMED') {
      return {
        ok: false,
        error: 'המסמך הופק בקארדקום ומהווה מסמך חוקי. אפשר לסמן אותו כמבוטל, אך לא למחוק אותו מהספרים.',
      };
    }
    await prisma.document.delete({ where: { id } });
    revalidatePath('/expenses');
    revalidatePath('/income');
    revalidatePath('/reports/vat');
    return { ok: true, message: 'המסמך נמחק.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'המחיקה נכשלה.' };
  }
}

// ---------------------------------------------------------------------------
// סנכרון קארדקום
// ---------------------------------------------------------------------------

export async function syncCardcom(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const provider = getInvoiceProvider();
    if (!provider.isConfigured()) {
      return { ok: false, error: 'פרטי קארדקום חסרים. יש להשלים אותם בקובץ .env.local ולהפעיל מחדש את השרת.' };
    }

    const fromDate = parseDateInput(str(form, 'fromDate'));
    const toDate = parseDateInput(str(form, 'toDate'));
    if (fromDate > toDate) return { ok: false, error: 'תאריך ההתחלה מאוחר מתאריך הסיום.' };

    const result = await syncCardcomDocuments({ businessId: business.id, fromDate, toDate });

    // שיוך המסמכים החדשים לתקופות
    const unassigned = await prisma.document.findMany({
      where: { businessId: business.id, vatPeriodId: null },
      select: { id: true, reportDate: true },
    });
    for (const doc of unassigned) {
      await assignToPeriod({
        businessId: business.id,
        documentId: doc.id,
        reportDate: doc.reportDate,
        frequency: business.vatFrequency,
      });
    }

    revalidatePath('/income');
    revalidatePath('/reports/vat');
    revalidatePath('/');

    const summary = `נמצאו ${result.fetched} מסמכים · נוספו ${result.created} · עודכנו ${result.updated}${
      result.skipped ? ` · דולגו ${result.skipped} (תקופה שדווחה)` : ''
    }`;
    if (result.errors.length) {
      return { ok: false, error: `${summary}. שגיאות: ${result.errors.slice(0, 3).join(' | ')}` };
    }
    return { ok: true, message: summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'הסנכרון נכשל.' };
  }
}

// ---------------------------------------------------------------------------
// הפקת חשבונית
// ---------------------------------------------------------------------------

export async function issueInvoice(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const provider = getInvoiceProvider();
    if (!provider.isConfigured()) {
      return { ok: false, error: 'פרטי קארדקום חסרים. יש להשלים אותם בקובץ .env.local ולהפעיל מחדש את השרת.' };
    }

    const customerVatId = normalizeVatId(str(form, 'customerVatId'));
    if (customerVatId && !isValidIsraeliId(customerVatId)) {
      return { ok: false, error: `מספר העוסק ${customerVatId} אינו תקין.` };
    }

    const descriptions = form.getAll('lineDescription').map(String);
    const quantities = form.getAll('lineQuantity').map((v) => Number(String(v)) || 0);
    const prices = form.getAll('lineUnitPrice').map((v) => Number(String(v)) || 0);

    const lines = descriptions
      .map((description, i) => ({
        description: description.trim(),
        quantity: quantities[i] ?? 1,
        unitPriceAgorot: toAgorot(prices[i] ?? 0),
      }))
      .filter((line) => line.description !== '' && line.unitPriceAgorot !== 0);

    if (!lines.length) return { ok: false, error: 'יש להזין לפחות שורת עסקה אחת עם תיאור וסכום.' };

    const customerName = str(form, 'customerName');
    if (!customerName) return { ok: false, error: 'יש להזין את שם הלקוח.' };

    const issueDate = str(form, 'issueDate') ? parseDateInput(str(form, 'issueDate')) : new Date();

    const issued = await provider.issueInvoice({
      documentKind: str(form, 'documentKind') as 'TAX_INVOICE' | 'TAX_INVOICE_RECEIPT' | 'RECEIPT',
      customer: {
        name: customerName,
        vatId: customerVatId ?? undefined,
        email: optionalStr(form, 'customerEmail') ?? undefined,
        phone: optionalStr(form, 'customerPhone') ?? undefined,
        address: optionalStr(form, 'customerAddress') ?? undefined,
        city: optionalStr(form, 'customerCity') ?? undefined,
      },
      lines,
      // המחירים בטופס כוללים מע"מ; הספק ממיר למוסכמת המסוף
      pricesIncludeVat: true,
      issueDate,
      comments: optionalStr(form, 'comments') ?? undefined,
      sendByEmail: form.get('sendByEmail') === 'on',
    });

    // רושמים מיד בספרים כדי שלא נסתמך על הסנכרון הבא
    const rateBp = vatRateBpAt(issueDate);
    const grossAgorot = lines.reduce((sum, l) => sum + Math.round(l.unitPriceAgorot * l.quantity), 0);
    const { netAgorot, vatAgorot } = fromGross(grossAgorot, rateBp);

    const created = await prisma.document.create({
      data: {
        businessId: business.id,
        direction: 'INCOME',
        docType: str(form, 'documentKind') === 'RECEIPT' ? 'RECEIPT' : (str(form, 'documentKind') as DocType),
        status: 'CONFIRMED',
        issueDate,
        reportDate: issueDate,
        number: issued.documentNumber,
        allocationNumber: issued.allocationNumber,
        counterpartyName: customerName,
        counterpartyVatId: customerVatId,
        netAgorot,
        vatAgorot,
        totalAgorot: netAgorot + vatAgorot,
        vatRateBp: rateBp,
        vatTreatment: 'STANDARD',
        source: 'CARDCOM',
        // אותו מפתח שהסנכרון משתמש בו, אחרת המסמך היה נמשך שוב ונספר פעמיים
        externalId: issued.externalId ?? `issued:${issued.documentKind}:${issued.documentNumber}`,
        notes: issued.documentUrl,
      },
      select: { id: true },
    });

    await assignToPeriod({
      businessId: business.id,
      documentId: created.id,
      reportDate: issueDate,
      frequency: business.vatFrequency,
    });

    revalidatePath('/income');
    revalidatePath('/reports/vat');
    revalidatePath('/');

    return {
      ok: true,
      message: `חשבונית ${issued.documentNumber} הופקה בהצלחה.`,
      data: { documentUrl: issued.documentUrl, documentNumber: issued.documentNumber },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'הפקת החשבונית נכשלה.' };
  }
}

// ---------------------------------------------------------------------------
// תקופות דיווח
// ---------------------------------------------------------------------------

export async function setPeriodStatus(
  year: number,
  periodNo: number,
  status: 'OPEN' | 'CLOSED' | 'FILED',
): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const period = buildPeriod(year, periodNo, business.vatFrequency);

    await prisma.vatPeriod.upsert({
      where: { businessId_year_periodNo: { businessId: business.id, year, periodNo } },
      create: {
        businessId: business.id,
        year,
        periodNo,
        startDate: period.startDate,
        endDate: period.endDate,
        status,
        closedAt: status !== 'OPEN' ? new Date() : null,
        filedAt: status === 'FILED' ? new Date() : null,
      },
      update: {
        status,
        closedAt: status !== 'OPEN' ? new Date() : null,
        filedAt: status === 'FILED' ? new Date() : null,
      },
    });

    revalidatePath('/reports/vat');
    return { ok: true, message: 'מצב התקופה עודכן.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'העדכון נכשל.' };
  }
}

// ---------------------------------------------------------------------------
// גוגל דרייב
// ---------------------------------------------------------------------------

/** מנתק את החיבור לדרייב. הקבצים שכבר גובו נשארים בדרייב — לא מוחקים כלום. */
export async function disconnectDrive(): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    await prisma.business.update({
      where: { id: business.id },
      data: {
        driveRefreshToken: null,
        driveAccountEmail: null,
        driveRootFolderId: null,
        driveConnectedAt: null,
      },
    });
    revalidatePath('/settings');
    return { ok: true, message: 'החיבור נותק. הקבצים שכבר גובו נשארו בדרייב.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'הניתוק נכשל.' };
  }
}

/** מגבה לדרייב את כל הצילומים שעדיין לא גובו. */
export async function runDriveBackup(): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const summary = await backupPending(business);

    revalidatePath('/settings');
    revalidatePath('/expenses');

    if (summary.pending === 0) return { ok: true, message: 'הכל כבר מגובה.' };
    if (summary.failed > 0) {
      return {
        ok: false,
        error: `גובו ${summary.uploaded} מתוך ${summary.pending}. שגיאות: ${summary.errors.slice(0, 2).join(' | ')}`,
      };
    }
    return { ok: true, message: `גובו ${summary.uploaded} קבצים לדרייב.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'הגיבוי נכשל.' };
  }
}

// ---------------------------------------------------------------------------
// פיצול תשלומים ידני
// ---------------------------------------------------------------------------

/**
 * קובע ביד באילו מועדים ובאילו סכומים שולם מסמך — למשל העברה של 12,000 ביולי
 * ועוד 5,900 בספטמבר, שקארדקום מציגה כמסמך אחד עם מועד העברה אחד. הלוח
 * הידני גובר על הסנכרון עד שמבטלים אותו.
 */
export async function savePaymentSplit(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const id = str(form, 'documentId');
    const doc = await prisma.document.findFirst({
      where: { id, businessId: business.id },
      include: { vatPeriod: { select: { status: true } } },
    });
    if (!doc) return { ok: false, error: 'המסמך לא נמצא.' };
    if (doc.vatPeriod?.status === 'FILED') return { ok: false, error: 'המסמך שייך לתקופה שכבר דווחה.' };

    const dates = form.getAll('date').map((v) => String(v).trim());
    const amounts = form.getAll('amount').map((v) => String(v).trim());
    const payments = dates
      .map((date, i) => ({ date, amount: amounts[i] ?? '' }))
      .filter((p) => p.date !== '' || p.amount !== '')
      .map((p) => {
        const agorot = toAgorot(Number(p.amount.replace(/[^\d.-]/g, '')));
        return { dueDate: parseDateInput(p.date), totalAgorot: agorot };
      });
    const rows = buildScheduleFromPayments(doc, payments);

    await prisma.$transaction([
      prisma.documentInstallment.deleteMany({ where: { documentId: doc.id } }),
      prisma.documentInstallment.createMany({ data: rows.map((r) => ({ ...r, documentId: doc.id })) }),
      prisma.document.update({
        where: { id: doc.id },
        data: {
          scheduleManual: true,
          installments: rows.length,
          installmentAgorot: null,
          firstInstallmentAgorot: null,
          // המסמך משויך לתקופה של התשלום הראשון; שאר התשלומים מוכרים דרך הלוח
          reportDate: rows[0].dueDate,
        },
      }),
    ]);
    await assignToPeriod({ businessId: business.id, documentId: doc.id, reportDate: rows[0].dueDate, frequency: business.vatFrequency });
    revalidatePath('/');
    revalidatePath('/income');
    revalidatePath('/expenses');
    return { ok: true, message: `נשמר פיצול ל-${rows.length} תשלומים.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'שמירת הפיצול נכשלה.' };
  }
}

/** מבטל פיצול ידני ומחזיר את המסמך ללוח שהסנכרון מחשב. */
export async function clearPaymentSplit(id: string): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const doc = await prisma.document.findFirst({ where: { id, businessId: business.id } });
    if (!doc) return { ok: false, error: 'המסמך לא נמצא.' };
    await prisma.document.update({
      where: { id: doc.id },
      data: { scheduleManual: false, installments: null, installmentAgorot: null, firstInstallmentAgorot: null },
    });
    await syncSchedule(doc.id);
    revalidatePath('/');
    revalidatePath('/income');
    revalidatePath('/expenses');
    return { ok: true, message: 'הפיצול בוטל.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'ביטול הפיצול נכשל.' };
  }
}

// ---------------------------------------------------------------------------
// עסקאות ותוכניות תשלום
// ---------------------------------------------------------------------------

export async function createDealAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const { createDeal } = await import('@/lib/services/deals');
    const customerVatId = normalizeVatId(str(form, 'customerVatId'));
    if (customerVatId && !isValidIsraeliId(customerVatId)) {
      return { ok: false, error: `מספר הזהות/העוסק ${customerVatId} אינו תקין.` };
    }
    const total = num(form, 'total');
    if (total === null || total <= 0) return { ok: false, error: 'יש להזין את סכום העסקה (כולל מע"מ).' };
    const deal = await createDeal(business.id, {
      customerName: str(form, 'customerName'),
      customerVatId: customerVatId || null,
      customerEmail: optionalStr(form, 'customerEmail'),
      customerPhone: optionalStr(form, 'customerPhone'),
      description: str(form, 'description'),
      totalAgorot: toAgorot(total),
      vatTreatment: (str(form, 'vatTreatment') || 'STANDARD') as VatTreatment,
      installments: Number(str(form, 'installments') || '1'),
      firstPaymentDate: str(form, 'firstPaymentDate') ? parseDateInput(str(form, 'firstPaymentDate')) : new Date(),
      notes: optionalStr(form, 'notes'),
    });
    revalidatePath('/deals');
    return { ok: true, message: 'העסקה נוצרה.', data: { id: deal.id } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'יצירת העסקה נכשלה.' };
  }
}

export async function recordDealChargeAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const { recordCharge } = await import('@/lib/services/deals');
    const dealId = str(form, 'dealId');
    const amount = num(form, 'amount');
    if (amount === null || amount <= 0) return { ok: false, error: 'יש להזין את סכום התקבול.' };
    await recordCharge(business.id, dealId, {
      paidAt: parseDateInput(str(form, 'paidAt')),
      amountAgorot: toAgorot(amount),
      method: (str(form, 'method') || 'BANK_TRANSFER') as PaymentMethod,
      cardInstallments: Number(str(form, 'cardInstallments') || '1'),
      reference: optionalStr(form, 'reference'),
      notes: optionalStr(form, 'notes'),
    });
    revalidatePath(`/deals/${dealId}`);
    revalidatePath('/deals');
    return { ok: true, message: 'התקבול נרשם.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'רישום התקבול נכשל.' };
  }
}

export async function issueDealDocumentAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const { issueDocumentForCharges } = await import('@/lib/services/deals');
    const dealId = str(form, 'dealId');
    const chargeIds = form.getAll('chargeId').map(String).filter(Boolean);
    const { document, issued } = await issueDocumentForCharges(business.id, dealId, {
      chargeIds,
      documentKind: str(form, 'documentKind') === 'RECEIPT' ? 'RECEIPT' : 'TAX_INVOICE_RECEIPT',
      sendByEmail: form.get('sendByEmail') === 'on',
      frequency: business.vatFrequency,
    });
    revalidatePath(`/deals/${dealId}`);
    revalidatePath('/deals');
    revalidatePath('/income');
    revalidatePath('/');
    return { ok: true, message: `מסמך ${issued.documentNumber} הופק ונרשם בספרים.`, data: { documentId: document.id } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'הפקת המסמך נכשלה.' };
  }
}

export async function setDealStatusAction(id: string, status: 'OPEN' | 'CANCELLED'): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const deal = await prisma.deal.findFirst({ where: { id, businessId: business.id }, include: { charges: true } });
    if (!deal) return { ok: false, error: 'העסקה לא נמצאה.' };
    if (status === 'CANCELLED' && deal.charges.some((c) => c.documentId)) {
      return { ok: false, error: 'לעסקה הופקו מסמכים. יש לבטל אותם בזיכוי לפני ביטול העסקה.' };
    }
    await prisma.deal.update({ where: { id }, data: { status } });
    if (status === 'OPEN') {
      const { refreshDealStatus } = await import('@/lib/services/deals');
      await refreshDealStatus(id);
    }
    revalidatePath(`/deals/${id}`);
    revalidatePath('/deals');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'הפעולה נכשלה.' };
  }
}

// ---------------------------------------------------------------------------
// קישורי תשלום
// ---------------------------------------------------------------------------

export async function createPaymentRequestAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const { createPaymentRequest, publicPayUrl } = await import('@/lib/services/payment-requests');
    const dealId = str(form, 'dealId');
    const amount = num(form, 'amount');
    if (amount === null || amount <= 0) return { ok: false, error: 'יש להזין סכום לתשלום.' };
    const request = await createPaymentRequest(business.id, dealId, {
      amountAgorot: toAgorot(amount),
      maxInstallments: Number(str(form, 'maxInstallments') || '1'),
      sendDocumentByEmail: form.get('sendByEmail') !== 'off',
    });
    revalidatePath(`/deals/${dealId}`);
    return { ok: true, message: 'קישור התשלום נוצר.', data: { url: publicPayUrl(request.id) } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'יצירת הקישור נכשלה.' };
  }
}

export async function cancelPaymentRequestAction(id: string): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const updated = await prisma.paymentRequest.updateMany({
      where: { id, businessId: business.id, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'CANCELLED', resolvedAt: new Date() },
    });
    if (updated.count === 0) return { ok: false, error: 'אי אפשר לבטל קישור ששולם או שכבר בוטל.' };
    revalidatePath('/deals');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'הביטול נכשל.' };
  }
}

export async function refreshPaymentRequestAction(id: string): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const request = await prisma.paymentRequest.findFirst({ where: { id, businessId: business.id }, select: { dealId: true } });
    if (!request) return { ok: false, error: 'הבקשה לא נמצאה.' };
    const { settlePaymentRequest } = await import('@/lib/services/payment-requests');
    const r = await settlePaymentRequest(id);
    revalidatePath(`/deals/${request.dealId}`);
    return { ok: true, message: r.status === 'PAID' ? 'התשלום נרשם.' : r.reason ?? 'טרם שולם.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'הבדיקה נכשלה.' };
  }
}

/**
 * מוחק עסקה. מותר רק כשלא הופק עליה מסמך: מסמך שהופק הוא רשומה חוקית
 * שנשארת בספרים, ועסקה שמאחוריו לא נעלמת — היא מתבטלת.
 */
export async function deleteDealAction(id: string): Promise<ActionResult> {
  try {
    const business = await getActiveBusiness();
    const deal = await prisma.deal.findFirst({
      where: { id, businessId: business.id },
      include: { documents: { select: { id: true } }, charges: { select: { documentId: true } }, paymentRequests: { select: { status: true } } },
    });
    if (!deal) return { ok: false, error: 'העסקה לא נמצאה.' };
    if (deal.documents.length > 0 || deal.charges.some((c) => c.documentId)) {
      return { ok: false, error: 'הופק על העסקה מסמך, ולכן אי אפשר למחוק אותה. אפשר לבטל אותה.' };
    }
    if (deal.paymentRequests.some((r) => r.status === 'SETTLING')) {
      return { ok: false, error: 'תשלום על העסקה נרשם כרגע. נסי שוב בעוד רגע.' };
    }
    await prisma.deal.delete({ where: { id } });
    revalidatePath('/deals');
    return { ok: true, message: 'העסקה נמחקה.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'המחיקה נכשלה.' };
  }
}
