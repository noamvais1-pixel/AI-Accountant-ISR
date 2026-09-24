import { prisma } from '../db';
import { amountsFromTotal, dealProgress } from '../deals';
import { vatRateBpAt, fromGross } from '../vat';
import { getInvoiceProvider } from '../invoicing';
import { assignToPeriod } from './documents';
import { syncSchedule } from './recognition';
import type { PaymentLineInput } from '../invoicing/provider';
import type { PaymentMethod, VatTreatment, DealCharge } from '@prisma/client';

/**
 * עסקאות: מקור האמת לתקבולים ולמסמכים.
 *
 * הסדר הוא: עסקה → תקבול → מסמך. המסמך החוקי מופק אצל הספק מתוך מה שכבר
 * ידוע כאן — מי שילם, כמה, מתי ובאיזה אופן — ונרשם בספרים מיד, עם שורות
 * התשלום שלו. הסנכרון מהספק פוגש אותו אחר כך לפי אותו מפתח ולא מכפיל אותו.
 */

export type CreateDealInput = {
  customerName: string;
  customerVatId: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  description: string;
  totalAgorot: number;
  vatTreatment: VatTreatment;
  installments: number;
  firstPaymentDate: Date;
  notes: string | null;
};

export async function createDeal(businessId: string, input: CreateDealInput) {
  if (!input.customerName.trim()) throw new Error('יש להזין את שם הלקוח.');
  if (!input.description.trim()) throw new Error('יש להזין את תיאור השירות.');
  if (!Number.isInteger(input.installments) || input.installments < 1 || input.installments > 36) {
    throw new Error('מספר התשלומים חייב להיות בין 1 ל-36.');
  }
  const rateBp = vatRateBpAt(input.firstPaymentDate);
  const treatment = input.vatTreatment === 'NO_VAT' ? 'EXEMPT' : input.vatTreatment;
  const amounts = amountsFromTotal(input.totalAgorot, rateBp, treatment);
  return prisma.deal.create({
    data: {
      businessId,
      customerName: input.customerName.trim(),
      customerVatId: input.customerVatId,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      description: input.description.trim(),
      ...amounts,
      vatRateBp: rateBp,
      vatTreatment: treatment,
      installments: input.installments,
      firstPaymentDate: input.firstPaymentDate,
      notes: input.notes,
    },
  });
}

export type RecordChargeInput = {
  paidAt: Date;
  amountAgorot: number;
  method: PaymentMethod;
  cardInstallments: number;
  reference: string | null;
  notes: string | null;
};

/** רושם תקבול על חשבון העסקה. לא מפיק מסמך — זו פעולה נפרדת ומכוונת. */
export async function recordCharge(businessId: string, dealId: string, input: RecordChargeInput): Promise<DealCharge> {
  const deal = await prisma.deal.findFirst({ where: { id: dealId, businessId }, include: { charges: true } });
  if (!deal) throw new Error('העסקה לא נמצאה.');
  if (deal.status === 'CANCELLED') throw new Error('העסקה בוטלה.');
  if (!Number.isInteger(input.amountAgorot) || input.amountAgorot <= 0) throw new Error('סכום התקבול חייב להיות חיובי.');
  const progress = dealProgress(deal, deal.charges);
  if (input.amountAgorot > progress.remainingAgorot) {
    throw new Error(`התקבול (${(input.amountAgorot / 100).toFixed(2)}) גדול מהיתרה לתשלום (${(progress.remainingAgorot / 100).toFixed(2)}).`);
  }
  const charge = await prisma.dealCharge.create({
    data: {
      dealId,
      paidAt: input.paidAt,
      amountAgorot: input.amountAgorot,
      method: input.method,
      cardInstallments: input.method === 'CARD' ? Math.max(1, input.cardInstallments) : 1,
      reference: input.reference,
      notes: input.notes,
    },
  });
  await refreshDealStatus(dealId);
  return charge;
}

export async function refreshDealStatus(dealId: string): Promise<void> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { charges: true } });
  if (!deal || deal.status === 'CANCELLED') return;
  const status = dealProgress(deal, deal.charges).isPaid ? 'PAID' : 'OPEN';
  if (status !== deal.status) await prisma.deal.update({ where: { id: dealId }, data: { status } });
}

export type IssueForChargesInput = {
  chargeIds: string[];
  documentKind: 'TAX_INVOICE_RECEIPT' | 'RECEIPT';
  sendByEmail: boolean;
  frequency: 'MONTHLY' | 'BIMONTHLY';
};

/**
 * מפיק מסמך על תקבולים שטרם הופק להם מסמך, ורושם אותו בספרים.
 * הסכום במסמך הוא בדיוק סכום התקבולים; שורות התשלום במסמך הן התקבולים עצמם.
 */
export async function issueDocumentForCharges(businessId: string, dealId: string, input: IssueForChargesInput) {
  const deal = await prisma.deal.findFirst({ where: { id: dealId, businessId }, include: { charges: { orderBy: { paidAt: 'asc' } } } });
  if (!deal) throw new Error('העסקה לא נמצאה.');
  const charges = deal.charges.filter((c) => input.chargeIds.includes(c.id));
  if (charges.length === 0) throw new Error('יש לבחור לפחות תקבול אחד.');
  const alreadyIssued = charges.find((c) => c.documentId);
  if (alreadyIssued) throw new Error('לאחד התקבולים שנבחרו כבר הופק מסמך.');

  const totalAgorot = charges.reduce((a, c) => a + c.amountAgorot, 0);
  const rateBp = deal.vatRateBp;
  const isVatFree = deal.vatTreatment !== 'STANDARD';
  const amounts = isVatFree ? { netAgorot: totalAgorot, vatAgorot: 0, totalAgorot } : fromGross(totalAgorot, rateBp);
  const paymentLines: PaymentLineInput[] = charges.map((c) => ({
    date: c.paidAt,
    method: c.method,
    amountAgorot: c.amountAgorot,
    reference: c.reference ?? undefined,
  }));

  const provider = getInvoiceProvider();
  if (!provider.isConfigured()) throw new Error('ספק החשבוניות אינו מוגדר.');

  const issueDate = new Date();
  const issued = await provider.issueInvoice({
    documentKind: input.documentKind,
    customer: {
      name: deal.customerName,
      vatId: deal.customerVatId ?? undefined,
      email: deal.customerEmail ?? undefined,
      phone: deal.customerPhone ?? undefined,
    },
    // שורה אחת במחיר כולל מע"מ, כדי שסה"כ המסמך יהיה בדיוק סכום התקבול
    lines: [{ description: deal.description, quantity: 1, unitPriceAgorot: totalAgorot, isVatFree }],
    pricesIncludeVat: true,
    isVatFree,
    payments: paymentLines,
    issueDate,
    sendByEmail: input.sendByEmail,
    externalId: `deal:${deal.id}`,
  });

  // מסמך אחד מתקבול אשראי בתשלומים: הסכום המלא במסמך, הכסף מגיע חודש-חודש
  const cardInstallments = charges.length === 1 && charges[0].method === 'CARD' ? charges[0].cardInstallments : 1;
  const reportDate = charges[0].paidAt;

  const document = await prisma.document.create({
    data: {
      businessId,
      dealId: deal.id,
      direction: 'INCOME',
      docType: input.documentKind,
      status: 'CONFIRMED',
      issueDate,
      reportDate,
      number: issued.documentNumber,
      allocationNumber: issued.allocationNumber,
      counterpartyName: deal.customerName,
      counterpartyVatId: deal.customerVatId,
      netAgorot: amounts.netAgorot,
      vatAgorot: amounts.vatAgorot,
      totalAgorot: amounts.totalAgorot,
      vatRateBp: rateBp,
      // קבלה בלבד אינה עסקה לצורכי מע"מ — החשבונית שקדמה לה כבר דווחה
      vatTreatment: input.documentKind === 'RECEIPT' ? 'NO_VAT' : isVatFree ? 'EXEMPT' : 'STANDARD',
      installments: cardInstallments > 1 ? cardInstallments : null,
      source: 'CARDCOM',
      externalId: issued.externalId ?? `issued:${issued.documentKind}:${issued.documentNumber}`,
      paymentLines: paymentLines.map((p) => ({ date: p.date.toISOString(), amountAgorot: p.amountAgorot, method: methodLabel(p.method), reference: p.reference ?? null })),
      notes: issued.documentUrl,
      ocrRaw: issued.raw as object,
    },
  });
  await prisma.dealCharge.updateMany({ where: { id: { in: charges.map((c) => c.id) } }, data: { documentId: document.id } });
  await assignToPeriod({ businessId, documentId: document.id, reportDate, frequency: input.frequency });
  await syncSchedule(document.id);

  // ה-PDF של המסמך נשמר אצלנו כדי שאפשר יהיה לצפות בו; כישלון כאן אינו מבטל את ההפקה
  try {
    const { refreshPaymentsFromDocument } = await import('./document-payments');
    await refreshPaymentsFromDocument(document.id, { frequency: input.frequency });
  } catch {
    // המסמך יורד בסנכרון הבא
  }
  return { document, issued };
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CARD: 'כרטיס אשראי',
  BANK_TRANSFER: 'העברה בנקאית',
  BIT: 'ביט',
  CASH: 'מזומן',
  CHEQUE: 'שיק',
  OTHER: 'אחר',
};

export function methodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}
