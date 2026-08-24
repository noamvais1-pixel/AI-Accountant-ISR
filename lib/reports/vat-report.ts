import type { Document } from '@prisma/client';
import { deductibleVat } from '../vat';
import type { Period } from '../periods';

/**
 * הדוח התקופתי למע"מ.
 * מבנה השדות מקביל לשדות שמזינים באזור האישי של רשות המסים.
 * כל הסכומים באגורות.
 */
export type VatReport = {
  period: Period;

  // צד העסקאות (מכר)
  taxableSalesNet: number; // עסקאות חייבות — סכום לפני מע"מ
  taxableSalesVat: number; // מע"מ על עסקאות חייבות
  zeroRatedSales: number; // עסקאות בשיעור אפס / פטורות
  salesRecordCount: number;

  // צד התשומות (רכש)
  equipmentInputsVat: number; // מע"מ תשומות ציוד — המוכר בניכוי
  otherInputsVat: number; // מע"מ תשומות אחרות — המוכר בניכוי
  inputsRecordCount: number;

  // הפרשים
  totalInputsVat: number;
  vatDue: number; // חיובי = לתשלום, שלילי = להחזר

  // מידע נלווה שאינו חלק מהדוח הרשמי אך נחוץ לבקרה
  nonDeductibleVat: number; // מע"מ ששולם ולא נדרש בניכוי
  totalExpensesNet: number; // סך ההוצאות לפני מע"מ (לרווח והפסד)
  creditInvoiceCount: number;
  draftCount: number; // מסמכים שעדיין לא אושרו ולכן לא נכללו
  warnings: ReportWarning[];
};

export type ReportWarning = {
  documentId: string | null;
  severity: 'error' | 'warning';
  message: string;
};

/** חשבונית זיכוי נספרת בסימן הפוך. */
function sign(doc: Pick<Document, 'isCredit'>): 1 | -1 {
  return doc.isCredit ? -1 : 1;
}

/**
 * האם המסמך משתתף בדוח המע"מ.
 *
 * זו נקודת האמת היחידה — גם ספירת הרשומות בדוח וגם השורות בקובץ PCN874
 * נגזרות ממנה. אם השתיים יתפצלו, הכותרת בקובץ תצהיר על מספר רשומות שאינו
 * תואם את מה שבפועל בקובץ, והבודק של רשות המסים ידחה אותו.
 *
 * לא משתתפים:
 * - מסמך שאינו מאושר או שבוטל.
 * - הכנסה שאינה אירוע מע"מ, למשל קבלה על חשבונית שכבר דווחה — ספירה שלה תיצור כפל.
 * - הוצאה שלא נדרש בה מע"מ תשומות כלל (ניכוי 0% או מסמך בלי מע"מ).
 */
export function participatesInVatReport(doc: Document): boolean {
  if (doc.status !== 'CONFIRMED') return false;
  if (doc.direction === 'INCOME') return doc.vatTreatment !== 'NO_VAT';
  return deductibleVat(doc.vatAgorot, doc.deductibleBp) !== 0;
}

/**
 * מחשב את הדוח התקופתי מתוך רשימת מסמכים.
 * נכללים רק מסמכים במצב CONFIRMED — טיוטות נספרות בנפרד כדי שלא יישכחו.
 */
export function buildVatReport(period: Period, documents: Document[]): VatReport {
  const report: VatReport = {
    period,
    taxableSalesNet: 0,
    taxableSalesVat: 0,
    zeroRatedSales: 0,
    salesRecordCount: 0,
    equipmentInputsVat: 0,
    otherInputsVat: 0,
    inputsRecordCount: 0,
    totalInputsVat: 0,
    vatDue: 0,
    nonDeductibleVat: 0,
    totalExpensesNet: 0,
    creditInvoiceCount: 0,
    draftCount: 0,
    warnings: [],
  };

  for (const doc of documents) {
    if (doc.status === 'VOID') continue;
    if (doc.status === 'DRAFT') {
      report.draftCount++;
      continue;
    }

    const s = sign(doc);
    if (doc.isCredit) report.creditInvoiceCount++;

    if (doc.direction === 'INCOME') {
      // הכנסה שאינה אירוע מע"מ (קבלה על חשבונית שכבר דווחה) אינה נספרת כלל.
      if (doc.vatTreatment === 'NO_VAT') continue;
      report.salesRecordCount++;
      if (doc.vatTreatment === 'STANDARD') {
        report.taxableSalesNet += s * doc.netAgorot;
        report.taxableSalesVat += s * doc.vatAgorot;
      } else {
        report.zeroRatedSales += s * doc.netAgorot;
        if (doc.vatAgorot !== 0) {
          report.warnings.push({
            documentId: doc.id,
            severity: 'error',
            message: `מסמך ${doc.number} מסווג כפטור/אפס אך נרשם בו מע"מ. יש לתקן את הסיווג או את הסכום.`,
          });
        }
      }
    } else {
      // הוצאה — נספרת בדוח רק אם נדרש בה מע"מ תשומות כלשהו
      const deductible = deductibleVat(doc.vatAgorot, doc.deductibleBp);
      report.totalExpensesNet += s * doc.netAgorot;
      report.nonDeductibleVat += s * (doc.vatAgorot - deductible);

      if (deductible !== 0) {
        report.inputsRecordCount++;
        if (doc.inputKind === 'EQUIPMENT') report.equipmentInputsVat += s * deductible;
        else report.otherInputsVat += s * deductible;
      }

      if (doc.vatAgorot > 0 && doc.docType === 'RECEIPT') {
        report.warnings.push({
          documentId: doc.id,
          severity: 'warning',
          message: `מסמך ${doc.number} הוא קבלה ולא חשבונית מס — קבלה בלבד אינה מזכה בניכוי מע"מ תשומות.`,
        });
      }
      if (doc.vatAgorot > 0 && doc.deductibleBp > 0 && !doc.counterpartyVatId) {
        report.warnings.push({
          documentId: doc.id,
          severity: 'error',
          message: `למסמך ${doc.number} חסר מספר עוסק של הספק. הדיווח המפורט יידחה בלעדיו.`,
        });
      }
    }
  }

  report.totalInputsVat = report.equipmentInputsVat + report.otherInputsVat;
  report.vatDue = report.taxableSalesVat - report.totalInputsVat;

  if (report.draftCount > 0) {
    report.warnings.push({
      documentId: null,
      severity: 'warning',
      message: `${report.draftCount} מסמכים בתקופה ממתינים לאישור ואינם נכללים בדוח.`,
    });
  }

  return report;
}
