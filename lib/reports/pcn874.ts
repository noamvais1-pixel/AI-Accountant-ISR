import type { Document } from '@prisma/client';
import { agorotToWholeShekels } from '../money';
import { normalizeVatId } from '../israeli-id';
import { deductibleVat } from '../vat';
import { pcnReportMonth, type Period } from '../periods';
import { participatesInVatReport, type VatReport } from './vat-report';

/**
 * הפקת קובץ PCN874 — הדיווח המפורט המקוון למע"מ.
 *
 * מבנה הקובץ: שורת פתיחה אחת ('O'), שורת תנועה לכל מסמך, ושורת סגירה ('X').
 * כל השדות ברוחב קבוע, ספרות בלבד, מיושרים לימין עם אפסים מובילים.
 * כל הסכומים בשקלים שלמים (מעוגלים), לא באגורות.
 *
 * ⚠️ לפני ההגשה הראשונה יש לוודא את הקובץ מול הבודק של רשות המסים.
 *    פירוט מלא של מבנה השדות: docs/pcn874.md
 */

/** סוגי רשומות בקובץ. האות היא התו הראשון בכל שורת תנועה. */
export const ENTRY_TYPES = {
  SALE_REGULAR: 'S', // עסקה רגילה — לקוח מזוהה (יש ח.פ)
  SALE_UNIDENTIFIED: 'L', // עסקה ללקוח לא מזוהה — מרוכזת לפי יום
  SALE_SELF_INVOICE: 'M', // חשבונית עצמית — צד העסקה
  SALE_EXPORT: 'Y', // ייצוא
  SALE_PALESTINIAN: 'I', // לקוח רשות פלסטינית
  INPUT_REGULAR: 'T', // תשומה רגילה מספק ישראלי
  INPUT_PETTY_CASH: 'K', // קופה קטנה — מרוכזת לפי יום
  INPUT_IMPORT: 'R', // רשימון יבוא
  INPUT_PALESTINIAN: 'P', // ספק רשות פלסטינית
  INPUT_OTHER_DOC: 'H', // מסמך אחר המותר בניכוי
  INPUT_SELF_INVOICE: 'C', // חשבונית עצמית — צד התשומה
} as const;

export type EntryType = (typeof ENTRY_TYPES)[keyof typeof ENTRY_TYPES];

const UNIDENTIFIED_VAT_ID = '000000000';

// --- עזרי פורמט ---------------------------------------------------------

/** מספר לא-שלילי עם אפסים מובילים ברוחב קבוע. */
function digits(value: number, width: number): string {
  return String(Math.abs(Math.round(value))).padStart(width, '0').slice(-width);
}

/** מספר עם סימן מפורש (+/-) ואחריו ספרות ברוחב קבוע. סה"כ width+1 תווים. */
function signed(value: number, width: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? '-' : '+'}${digits(rounded, width)}`;
}

/** YYYYMMDD מתאריך UTC. */
function ymd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * מספר אסמכתא — 9 הספרות הימניות בלבד, בלי אותיות ותווים מיוחדים.
 * חותכים על המחרוזת ולא דרך Number, כדי שמספר ארוך במיוחד לא יאבד דיוק.
 */
function refNumber(value: string): string {
  const onlyDigits = value.replace(/\D/g, '');
  return (onlyDigits || '0').slice(-9).padStart(9, '0');
}

// --- מיפוי מסמך לסוג רשומה ----------------------------------------------

export function entryTypeFor(doc: Document): EntryType {
  if (doc.direction === 'INCOME') {
    if (doc.docType === 'SELF_INVOICE') return ENTRY_TYPES.SALE_SELF_INVOICE;
    if (doc.vatTreatment === 'ZERO_RATED' && !doc.counterpartyVatId) return ENTRY_TYPES.SALE_EXPORT;
    return doc.counterpartyVatId ? ENTRY_TYPES.SALE_REGULAR : ENTRY_TYPES.SALE_UNIDENTIFIED;
  }
  switch (doc.docType) {
    case 'IMPORT_DECLARATION':
      return ENTRY_TYPES.INPUT_IMPORT;
    case 'PETTY_CASH':
      return ENTRY_TYPES.INPUT_PETTY_CASH;
    case 'SELF_INVOICE':
      return ENTRY_TYPES.INPUT_SELF_INVOICE;
    case 'OTHER_DOC':
      return ENTRY_TYPES.INPUT_OTHER_DOC;
    default:
      return ENTRY_TYPES.INPUT_REGULAR;
  }
}

// --- שורות הקובץ ---------------------------------------------------------

export type PcnTransaction = {
  entryType: EntryType;
  vatId: string; // 9 ספרות
  invoiceDate: Date;
  refGroup: string; // 4 ספרות — קבוצת אסמכתא, בדרך כלל אפסים
  refNumber: string; // 9 ספרות
  vatShekels: number; // סכום המע"מ הנדרש — תמיד חיובי
  netShekels: number; // סכום לפני מע"מ — שלילי בזיכוי
  allocationNumber: string | null; // מספר הקצאה (חשבונית ישראל)
};

/**
 * שורת תנועה — 60 תווים:
 * [1] סוג רשומה | [9] ע.מ | [8] תאריך | [4] קבוצה | [9] אסמכתא |
 * [9] מע"מ | [11] סכום עם סימן | [9] מספר הקצאה
 */
export function buildTransactionLine(t: PcnTransaction): string {
  return [
    t.entryType,
    digits(Number(t.vatId), 9),
    ymd(t.invoiceDate),
    digits(Number(t.refGroup) || 0, 4),
    refNumber(t.refNumber),
    digits(t.vatShekels, 9),
    signed(t.netShekels, 10),
    t.allocationNumber ? digits(Number(t.allocationNumber.replace(/\D/g, '')), 9) : '0'.repeat(9),
  ].join('');
}

/**
 * שורת פתיחה — 100 תווים:
 * [1] O | [9] ע.מ | [6] YYYYMM | [1] סוג דוח | [8] תאריך הפקה |
 * [12] עסקאות חייבות | [10] מע"מ עסקאות | [12] עסקאות בשיעור אחר | [10] מע"מ בשיעור אחר |
 * [9] מס' עסקאות | [12] עסקאות פטורות/אפס | [10] תשומות אחרות | [10] תשומות ציוד |
 * [9] מס' תשומות | [12] סכום מדווח
 */
export function buildHeaderLine(args: {
  vatId: string;
  reportMonth: string; // YYYYMM
  generationDate: Date;
  report: VatReport;
}): string {
  const { vatId, reportMonth, generationDate, report } = args;
  const sh = agorotToWholeShekels;

  return [
    'O',
    digits(Number(vatId), 9),
    reportMonth,
    '1', // סוג דוח — קבוע 1
    ymd(generationDate),
    signed(sh(report.taxableSalesNet), 11),
    signed(sh(report.taxableSalesVat), 9),
    '+00000000000', // עסקאות בשיעור מע"מ אחר — שמור לשימוש עתידי
    '+000000000', // מע"מ על עסקאות בשיעור אחר — שמור לשימוש עתידי
    digits(report.salesRecordCount, 9),
    signed(sh(report.zeroRatedSales), 11),
    signed(sh(report.otherInputsVat), 9),
    signed(sh(report.equipmentInputsVat), 9),
    digits(report.inputsRecordCount, 9),
    signed(sh(report.vatDue), 11),
  ].join('');
}

export function buildFooterLine(vatId: string): string {
  return `X${digits(Number(vatId), 9)}`;
}

// --- הרכבת הקובץ המלא ----------------------------------------------------

/**
 * רשומות L (לקוח לא מזוהה) ו-K (קופה קטנה) מדווחות מרוכזות ולא אחת לאחת.
 * הריכוז נעשה לפי יום — סכומי היום מסוכמים לשורה אחת.
 */
function aggregateKey(t: PcnTransaction): string {
  return `${t.entryType}|${ymd(t.invoiceDate)}`;
}

function aggregate(transactions: PcnTransaction[]): PcnTransaction[] {
  const passthrough: PcnTransaction[] = [];
  const grouped = new Map<string, PcnTransaction>();

  for (const t of transactions) {
    const needsAggregation = t.entryType === ENTRY_TYPES.SALE_UNIDENTIFIED || t.entryType === ENTRY_TYPES.INPUT_PETTY_CASH;
    if (!needsAggregation) {
      passthrough.push(t);
      continue;
    }
    const key = aggregateKey(t);
    const existing = grouped.get(key);
    if (existing) {
      existing.vatShekels += t.vatShekels;
      existing.netShekels += t.netShekels;
    } else {
      grouped.set(key, { ...t, vatId: UNIDENTIFIED_VAT_ID, refNumber: '0', allocationNumber: null });
    }
  }

  return [...passthrough, ...grouped.values()].sort(
    (a, b) => a.invoiceDate.getTime() - b.invoiceDate.getTime() || a.entryType.localeCompare(b.entryType),
  );
}

export function documentToTransaction(doc: Document): PcnTransaction {
  const s = doc.isCredit ? -1 : 1;
  const vatAgorot =
    doc.direction === 'EXPENSE' ? deductibleVat(doc.vatAgorot, doc.deductibleBp) : doc.vatAgorot;

  return {
    entryType: entryTypeFor(doc),
    vatId: normalizeVatId(doc.counterpartyVatId) ?? UNIDENTIFIED_VAT_ID,
    invoiceDate: doc.issueDate,
    refGroup: '0',
    refNumber: doc.number,
    // סכום המע"מ ברשומה תמיד חיובי; הסימן מובע דרך סכום העסקה.
    vatShekels: Math.abs(agorotToWholeShekels(vatAgorot)),
    netShekels: s * agorotToWholeShekels(doc.netAgorot),
    allocationNumber: doc.allocationNumber,
  };
}

export type Pcn874Result = {
  content: string;
  fileName: string;
  lineCount: number;
};

export function generatePcn874(args: {
  vatId: string;
  period: Period;
  report: VatReport;
  documents: Document[];
  generationDate?: Date;
}): Pcn874Result {
  const { vatId, period, report, documents } = args;
  const generationDate = args.generationDate ?? new Date();

  // אותה נקודת אמת שמשמשת את ספירת הרשומות בכותרת — כך השתיים לא יכולות להתפצל.
  const eligible = documents.filter(participatesInVatReport);
  const transactions = aggregate(eligible.map(documentToTransaction));

  const lines = [
    buildHeaderLine({ vatId, reportMonth: pcnReportMonth(period), generationDate, report }),
    ...transactions.map(buildTransactionLine),
    buildFooterLine(vatId),
  ];

  return {
    content: lines.join('\r\n') + '\r\n',
    fileName: 'PCN874.txt',
    lineCount: lines.length,
  };
}
