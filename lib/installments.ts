import { roundHalfAwayFromZero } from './money';

/**
 * פריסת מסמך בתשלומים לתקבולים חודשיים.
 *
 * הסכום במסמך הוא הסכום המלא; הכסף מגיע חודש אחר חודש. לצורך שיוך לתקופות
 * ההכנסה מוכרת לפי מועד הפירעון של כל תשלום. שלושה כללים שאסור להפר:
 * - סכום כל התשלומים שווה בדיוק לסכום המסמך — אגורה לא נעלמת ולא נולדת.
 * - נטו ומע"מ מתפצלים באותו יחס כמו במסמך, ומסתכמים בדיוק לנטו ולמע"מ שלו.
 * - התשלום הראשון חל במועד התשלום (תאריך הדיווח); כל הבאים — חודש אחרי קודמו.
 */

export type InstallmentSource = {
  /** מועד התשלום הראשון — תאריך הדיווח של המסמך, לא בהכרח תאריך ההפקה. */
  reportDate: Date;
  netAgorot: number;
  vatAgorot: number;
  totalAgorot: number;
  installments: number | null;
  installmentAgorot: number | null; // סכום תשלום קבוע, אם ידוע (מקארדקום)
  firstInstallmentAgorot: number | null; // התשלום הראשון, אם שונה מהקבוע
};

export type ScheduledInstallment = {
  seq: number;
  dueDate: Date;
  netAgorot: number;
  vatAgorot: number;
  totalAgorot: number;
};

/** אותו יום בחודש הבא, ב-UTC. יום שאינו קיים בחודש היעד נצמד לסופו. */
export function addMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay)));
}

/**
 * מחלק סכום ל-n חלקים שלמים שמסתכמים בדיוק לסכום. שארית העיגול נופלת על
 * התשלום האחרון, כדי שכל התשלומים הרגילים יהיו זהים — כמו בחיוב אשראי.
 */
function split(total: number, n: number, first?: number | null, constant?: number | null): number[] {
  if (first != null && constant != null && n >= 2) {
    const parts = [first, ...Array(n - 1).fill(constant)];
    const diff = total - parts.reduce((a, b) => a + b, 0);
    parts[n - 1] += diff; // סטיית עיגול של הסולק נבלעת בתשלום האחרון
    return parts;
  }
  const base = Math.trunc(total / n);
  const parts = Array(n).fill(base);
  parts[n - 1] += total - base * n;
  return parts;
}

export function buildSchedule(doc: InstallmentSource): ScheduledInstallment[] | null {
  const n = doc.installments ?? 0;
  if (n < 2) return null;

  const totals = split(doc.totalAgorot, n, doc.firstInstallmentAgorot, doc.installmentAgorot);

  // נטו ומע"מ לפי יחס המסמך; האחרון סוגר את ההפרש כדי שהסכומים יסתכמו בדיוק
  const ratio = doc.totalAgorot === 0 ? 0 : doc.netAgorot / doc.totalAgorot;
  const nets = totals.map((t) => roundHalfAwayFromZero(t * ratio));
  nets[n - 1] += doc.netAgorot - nets.reduce((a, b) => a + b, 0);
  const vats = totals.map((t, i) => t - nets[i]);
  vats[n - 1] += doc.vatAgorot - vats.reduce((a, b) => a + b, 0);
  // אם מע"מ תוקן, הסה"כ של האחרון חייב לזוז איתו כדי שנטו+מע"מ=סה"כ בכל שורה
  totals[n - 1] = nets[n - 1] + vats[n - 1];

  return totals.map((totalAgorot, i) => ({
    seq: i + 1,
    dueDate: addMonthsUtc(doc.reportDate, i),
    netAgorot: nets[i],
    vatAgorot: vats[i],
    totalAgorot,
  }));
}

/** האם מועד נופל בטווח (כולל את שני הקצוות). */
export function inRange(date: Date, start: Date, end: Date): boolean {
  const t = date.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/**
 * לוח ההכרה של זיכוי שמבטל מסמך בתשלומים.
 *
 * תשלום שטרם נגבה במועד הזיכוי מתבטל בחודש שבו היה אמור להיגבות — הכסף
 * לעולם לא יגיע, ולכן גם ההכרה בו וגם ביטולה נופלים על אותו חודש ומתאפסים.
 * תשלום שכבר נגבה מוחזר ללקוח בפועל במועד הזיכוי, ולכן מוכר שם. כך זיכוי
 * לא משנה רטרואקטיבית תקופה שכבר דווחה, ועסקה שבוטלה מיד לא מפילה שנה
 * שלמה של תשלומים על חודש אחד.
 */
export function mirrorSchedule(
  original: ScheduledInstallment[],
  refundDate: Date,
): ScheduledInstallment[] {
  return original.map((s) => ({
    ...s,
    dueDate: s.dueDate.getTime() < refundDate.getTime() ? refundDate : s.dueDate,
  }));
}
