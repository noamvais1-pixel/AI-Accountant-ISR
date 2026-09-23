'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getActiveBusiness, getActiveBusinessOrNull } from '@/lib/services/business';
import { assignToPeriod } from '@/lib/services/documents';
import { syncCardcomDocuments } from '@/lib/services/sync-cardcom';
import { deductibleVat, reconcileAmounts, vatRateBpAt } from '@/lib/vat';
import { toAgorot } from '@/lib/money';
import { isValidIsraeliId, normalizeVatId } from '@/lib/israeli-id';
import { buildPeriod } from '@/lib/periods';
import { getInvoiceProvider } from '@/lib/invoicing';
import { backupPending } from '@/lib/drive/backup';
import { syncSchedule } from '@/lib/services/recognition';
import type { DocType, Direction, InputKind, LegalType, VatFrequency, VatTreatment } from '@prisma/client';

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
      issueDate,
      comments: optionalStr(form, 'comments') ?? undefined,
      sendByEmail: form.get('sendByEmail') === 'on',
    });

    // רושמים מיד בספרים כדי שלא נסתמך על הסנכרון הבא
    const rateBp = vatRateBpAt(issueDate);
    const netAgorot = lines.reduce((sum, l) => sum + Math.round(l.unitPriceAgorot * l.quantity), 0);
    const vatAgorot = Math.round((netAgorot * rateBp) / 10000);

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
        externalId: `issued:${issued.documentKind}:${issued.documentNumber}`,
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
