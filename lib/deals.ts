import { addMonthsUtc } from './installments';
import { fromGross } from './vat';

/**
 * עסקה ותוכנית תשלום — החישובים הטהורים.
 *
 * העסקה נושאת את הסכום המלא; התקבולים מגיעים לאורך זמן. כאן נגזרים ממנה
 * הלוח הצפוי, מה שולם, מה נותר, ומה מצבה. אין כאן גישה למסד — הכל ניתן לבדיקה.
 */

export type DealAmounts = { netAgorot: number; vatAgorot: number; totalAgorot: number };

/** סכום כולל מע"מ → נטו ומע"מ, לפי שיעור המע"מ. עסקה פטורה: הכל נטו. */
export function amountsFromTotal(totalAgorot: number, rateBp: number, vatTreatment: 'STANDARD' | 'EXEMPT' | 'ZERO_RATED'): DealAmounts {
  if (!Number.isInteger(totalAgorot) || totalAgorot <= 0) throw new Error('סכום העסקה חייב להיות חיובי.');
  if (vatTreatment !== 'STANDARD') return { netAgorot: totalAgorot, vatAgorot: 0, totalAgorot };
  const t = fromGross(totalAgorot, rateBp);
  return { netAgorot: t.netAgorot, vatAgorot: t.vatAgorot, totalAgorot: t.totalAgorot };
}

export type PlannedInstallment = { seq: number; dueDate: Date; amountAgorot: number };

/** הלוח הצפוי: n תשלומים חודשיים מהתאריך הראשון, שארית העיגול על האחרון. */
export function plannedSchedule(deal: { totalAgorot: number; installments: number; firstPaymentDate: Date }): PlannedInstallment[] {
  const n = Math.max(1, deal.installments);
  const base = Math.trunc(deal.totalAgorot / n);
  return Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    dueDate: addMonthsUtc(deal.firstPaymentDate, i),
    amountAgorot: i === n - 1 ? deal.totalAgorot - base * (n - 1) : base,
  }));
}

export type DealProgress = {
  paidAgorot: number;
  remainingAgorot: number;
  /** תשלומים שמועדם עבר וטרם כוסו בתקבולים */
  overdueAgorot: number;
  nextDue: PlannedInstallment | null;
  isPaid: boolean;
};

export function dealProgress(
  deal: { totalAgorot: number; installments: number; firstPaymentDate: Date },
  charges: { amountAgorot: number }[],
  today: Date = new Date(),
): DealProgress {
  const paidAgorot = charges.reduce((a, c) => a + c.amountAgorot, 0);
  const remainingAgorot = Math.max(0, deal.totalAgorot - paidAgorot);
  const plan = plannedSchedule(deal);
  // התקבולים מכסים את התשלומים לפי הסדר; מה שנשאר חשוף הוא מה שבאיחור
  let covered = paidAgorot;
  let overdueAgorot = 0;
  let nextDue: PlannedInstallment | null = null;
  for (const p of plan) {
    const uncovered = Math.max(0, p.amountAgorot - covered);
    covered = Math.max(0, covered - p.amountAgorot);
    if (uncovered === 0) continue;
    if (p.dueDate.getTime() < today.getTime()) overdueAgorot += uncovered;
    else if (!nextDue) nextDue = { ...p, amountAgorot: uncovered };
  }
  return { paidAgorot, remainingAgorot, overdueAgorot, nextDue, isPaid: remainingAgorot === 0 };
}
