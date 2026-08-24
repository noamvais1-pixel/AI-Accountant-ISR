import { prisma } from '../db';
import { deductibleVat, reconcileAmounts, vatRateBpAt } from '../vat';
import { toAgorot } from '../money';
import { normalizeVatId } from '../israeli-id';
import { buildPeriod, periodForDate, type VatFrequency } from '../periods';
import type { ExtractedDocument } from '../ocr/schema';
import type { DocType, Prisma } from '@prisma/client';

/** ממפה את סוג המסמך שה-AI זיהה לסוג במערכת. */
function mapDocumentKind(kind: ExtractedDocument['documentKind'], isCredit: boolean): DocType {
  if (isCredit) return 'CREDIT_INVOICE';
  switch (kind) {
    case 'TAX_INVOICE':
      return 'TAX_INVOICE';
    case 'TAX_INVOICE_RECEIPT':
      return 'TAX_INVOICE_RECEIPT';
    case 'RECEIPT':
      return 'RECEIPT';
    case 'CREDIT_INVOICE':
      return 'CREDIT_INVOICE';
    case 'IMPORT_DECLARATION':
      return 'IMPORT_DECLARATION';
    default:
      return 'OTHER_DOC';
  }
}

function parseIsoDate(value: string | null): Date {
  if (value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  // בלי תאריך אי אפשר לשייך לתקופת דיווח — נופלים להיום, והמשתמש יתקן באישור.
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * הופך את פלט ה-AI לטיוטת מסמך במסד הנתונים.
 * הטיוטה תמיד DRAFT — שום דבר לא נכנס לדוח בלי שהמשתמש אישר את הסכומים.
 */
export async function createDraftFromExtraction(args: {
  businessId: string;
  extraction: ExtractedDocument;
  fileKey: string | null;
  fileMime: string | null;
  rawResponse: unknown;
  direction?: 'INCOME' | 'EXPENSE';
  /** מזהה ייחודי למקור — בייבוא זה טביעת האצבע של הקובץ, כדי שלא ייקלט פעמיים. */
  externalId?: string | null;
}): Promise<{ id: string }> {
  const { extraction } = args;

  const issueDate = parseIsoDate(extraction.issueDate);
  const rateBp = extraction.vatRatePercent != null
    ? Math.round(extraction.vatRatePercent * 100)
    : vatRateBpAt(issueDate);

  const amounts = reconcileAmounts({
    netAgorot: extraction.netAmount != null ? toAgorot(extraction.netAmount) : null,
    vatAgorot: extraction.vatAmount != null ? toAgorot(extraction.vatAmount) : null,
    totalAgorot: extraction.totalAmount != null ? toAgorot(extraction.totalAmount) : null,
    rateBp,
  });

  const counterpartyVatId = normalizeVatId(extraction.counterpartyVatId);
  const docType = mapDocumentKind(extraction.documentKind, extraction.isCredit);

  // אם כבר קלטנו הוצאה מהספק הזה, נאמץ את הסיווג שנבחר בפעם הקודמת.
  const knownContact = counterpartyVatId
    ? await prisma.contact.findUnique({
        where: { businessId_vatId: { businessId: args.businessId, vatId: counterpartyVatId } },
      })
    : null;

  const deductibleBp = knownContact?.defaultDeductibleBp ?? (amounts.vatAgorot > 0 ? 10000 : 0);
  const inputKind = knownContact?.defaultInputKind ?? 'OTHER';

  const direction = args.direction ?? 'EXPENSE';

  const document = await prisma.document.create({
    data: {
      businessId: args.businessId,
      direction,
      docType,
      status: 'DRAFT',
      issueDate,
      reportDate: issueDate,
      number: extraction.documentNumber?.trim() || 'ללא מספר',
      allocationNumber: extraction.allocationNumber?.replace(/\D/g, '') || null,
      contactId: knownContact?.id ?? null,
      counterpartyName: extraction.counterpartyName?.trim() || 'לא מזוהה',
      counterpartyVatId,
      currency: extraction.currency?.toUpperCase() || 'ILS',
      netAgorot: amounts.netAgorot,
      vatAgorot: amounts.vatAgorot,
      totalAgorot: amounts.totalAgorot,
      vatRateBp: rateBp,
      isCredit: extraction.isCredit,
      vatTreatment: amounts.vatAgorot > 0 ? 'STANDARD' : 'NO_VAT',
      inputKind: direction === 'EXPENSE' ? inputKind : null,
      deductibleBp: direction === 'EXPENSE' ? deductibleBp : 10000,
      deductibleVatAgorot: direction === 'EXPENSE' ? deductibleVat(amounts.vatAgorot, deductibleBp) : 0,
      category: knownContact?.defaultCategory ?? extraction.categoryGuess?.trim() ?? null,
      source: 'SCAN',
      externalId: args.externalId ?? null,
      fileKey: args.fileKey,
      fileMime: args.fileMime,
      ocrRaw: args.rawResponse as Prisma.InputJsonValue,
      ocrConfidence: extraction.confidence,
      notes: extraction.warnings.length ? extraction.warnings.join(' · ') : null,
    },
    select: { id: true },
  });

  return document;
}

/**
 * משייך מסמך לתקופת הדיווח שלו, ויוצר את התקופה אם עוד אינה קיימת.
 */
export async function assignToPeriod(args: {
  businessId: string;
  documentId: string;
  reportDate: Date;
  frequency: VatFrequency;
}): Promise<string> {
  const period = periodForDate(args.reportDate, args.frequency);

  const record = await prisma.vatPeriod.upsert({
    where: {
      businessId_year_periodNo: {
        businessId: args.businessId,
        year: period.year,
        periodNo: period.periodNo,
      },
    },
    create: {
      businessId: args.businessId,
      year: period.year,
      periodNo: period.periodNo,
      startDate: period.startDate,
      endDate: period.endDate,
    },
    update: {},
  });

  await prisma.document.update({
    where: { id: args.documentId },
    data: { vatPeriodId: record.id },
  });

  return record.id;
}

/** מוודא שקיימות רשומות תקופה לשנה שלמה — נוח למסך הדוחות. */
export async function ensurePeriodsForYear(businessId: string, year: number, frequency: VatFrequency) {
  const count = frequency === 'MONTHLY' ? 12 : 6;
  for (let periodNo = 1; periodNo <= count; periodNo++) {
    const period = buildPeriod(year, periodNo, frequency);
    await prisma.vatPeriod.upsert({
      where: { businessId_year_periodNo: { businessId, year, periodNo } },
      create: {
        businessId,
        year,
        periodNo,
        startDate: period.startDate,
        endDate: period.endDate,
      },
      update: { startDate: period.startDate, endDate: period.endDate },
    });
  }
}
