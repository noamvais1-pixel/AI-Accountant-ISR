/**
 * כל הכסף במערכת נשמר כמספר שלם באגורות.
 * לעולם אין לשמור סכומים כ-float — עיגולים חוזרים יוצרים פערים בדוח המע"מ.
 */

export const AGOROT_PER_SHEKEL = 100;

/**
 * עיגול סימטרי — חצי מתעגל תמיד הרחק מאפס.
 * Math.round המובנה מעגל 0.5 כלפי מעלה תמיד, ולכן round(118.5)=119 אבל
 * round(-118.5)=-118. בהנהלת חשבונות זה שובר את הכלל שחשבונית זיכוי מבטלת
 * במדויק את החשבונית שכנגדה, ומשאיר שקל תלוי באוויר בדוח המע"מ.
 */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** ממיר שקלים (מספר או מחרוזת מהטופס) לאגורות שלמות. */
export function toAgorot(shekels: number | string): number {
  const n = typeof shekels === 'string' ? Number(shekels.replace(/[^\d.-]/g, '')) : shekels;
  if (!Number.isFinite(n)) throw new Error(`סכום לא תקין: ${shekels}`);
  // כפל ב-100 על float עלול לתת 1234.9999 — מעגלים אחרי הכפל.
  return roundHalfAwayFromZero(n * AGOROT_PER_SHEKEL);
}

/** ממיר אגורות לשקלים כמספר עשרוני (לתצוגה בלבד). */
export function toShekels(agorot: number): number {
  return agorot / AGOROT_PER_SHEKEL;
}

/** מעצב אגורות כמחרוזת ש"ח לתצוגה: 123456 -> "₪1,234.56" */
export function formatILS(agorot: number, opts: { withSymbol?: boolean } = {}): string {
  const { withSymbol = true } = opts;
  const formatted = new Intl.NumberFormat('he-IL', {
    style: withSymbol ? 'currency' : 'decimal',
    currency: 'ILS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toShekels(agorot));
  return formatted;
}

/** מעגל אגורות לשקלים שלמים — נדרש בקובץ PCN874, שבו כל הסכומים בשקלים שלמים. */
export function agorotToWholeShekels(agorot: number): number {
  return roundHalfAwayFromZero(agorot / AGOROT_PER_SHEKEL);
}

/**
 * חלק יחסי מסכום, בנקודות בסיס, עם עיגול יחיד בסוף.
 * למשל: percentOf(10000, 6667) => 6667  (שני שליש מ-100 ש"ח)
 */
export function percentOfBp(agorot: number, basisPoints: number): number {
  return roundHalfAwayFromZero((agorot * basisPoints) / 10000);
}
