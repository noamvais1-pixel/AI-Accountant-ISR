import { percentOfBp } from './money';

/**
 * שיעורי מע"מ בישראל לאורך השנים, בנקודות בסיס.
 * הדוח מחושב לפי השיעור שחל בתאריך המסמך — חשוב בתקופות שבהן חל שינוי.
 */
export type VatRateEntry = { from: string; rateBp: number };

export const VAT_RATE_HISTORY: VatRateEntry[] = [
  { from: '2010-01-01', rateBp: 1600 },
  { from: '2012-09-01', rateBp: 1700 },
  { from: '2013-06-02', rateBp: 1800 },
  { from: '2015-10-01', rateBp: 1700 },
  { from: '2025-01-01', rateBp: 1800 },
];

/** שיעור המע"מ שחל בתאריך נתון, בנקודות בסיס (1800 = 18%). */
export function vatRateBpAt(date: Date): number {
  const iso = date.toISOString().slice(0, 10);
  let rate = VAT_RATE_HISTORY[0].rateBp;
  for (const entry of VAT_RATE_HISTORY) {
    if (iso >= entry.from) rate = entry.rateBp;
    else break;
  }
  return rate;
}

/** שיעור המע"מ הנוכחי בנקודות בסיס. */
export function currentVatRateBp(): number {
  return vatRateBpAt(new Date());
}

/** 1800 -> "18%" */
export function formatRateBp(rateBp: number): string {
  return `${(rateBp / 100).toFixed(rateBp % 100 === 0 ? 0 : 2)}%`;
}

// ---------------------------------------------------------------------------
// חישוב הסכומים של מסמך
// ---------------------------------------------------------------------------

export type AmountTriplet = {
  netAgorot: number; // לפני מע"מ
  vatAgorot: number; // המע"מ
  totalAgorot: number; // כולל מע"מ
};

/** חישוב מע"מ מסכום שאינו כולל מע"מ ("הוספת מע"מ"). */
export function fromNet(netAgorot: number, rateBp: number): AmountTriplet {
  const vatAgorot = percentOfBp(netAgorot, rateBp);
  return { netAgorot, vatAgorot, totalAgorot: netAgorot + vatAgorot };
}

/**
 * חילוץ מע"מ מסכום כולל מע"מ.
 * net = total / (1 + rate). מחשבים את ה-net בעיגול יחיד, והמע"מ הוא ההפרש —
 * כך ההרכב תמיד מסתדר לסכום המקורי בדיוק, בלי אגורה נעלמת.
 */
export function fromGross(totalAgorot: number, rateBp: number): AmountTriplet {
  const netAgorot = Math.round((totalAgorot * 10000) / (10000 + rateBp));
  return { netAgorot, vatAgorot: totalAgorot - netAgorot, totalAgorot };
}

/**
 * השלמת שלישיית סכומים מתוך מה שהמשתמש (או ה-OCR) סיפק.
 * סדר העדיפות: אם יש שניים מתוך השלושה — נגזור את השלישי במדויק ולא נחשב מחדש,
 * כדי לא "לתקן" חשבונית אמיתית שיש בה עיגול חריג.
 */
export function reconcileAmounts(input: {
  netAgorot?: number | null;
  vatAgorot?: number | null;
  totalAgorot?: number | null;
  rateBp: number;
}): AmountTriplet {
  const { rateBp } = input;
  const net = input.netAgorot ?? null;
  const vat = input.vatAgorot ?? null;
  const total = input.totalAgorot ?? null;

  if (net !== null && vat !== null) return { netAgorot: net, vatAgorot: vat, totalAgorot: net + vat };
  if (net !== null && total !== null) return { netAgorot: net, vatAgorot: total - net, totalAgorot: total };
  if (vat !== null && total !== null) return { netAgorot: total - vat, vatAgorot: vat, totalAgorot: total };
  if (total !== null) return fromGross(total, rateBp);
  if (net !== null) return fromNet(net, rateBp);
  if (vat !== null && rateBp > 0) {
    const netFromVat = Math.round((vat * 10000) / rateBp);
    return { netAgorot: netFromVat, vatAgorot: vat, totalAgorot: netFromVat + vat };
  }
  return { netAgorot: 0, vatAgorot: 0, totalAgorot: 0 };
}

/**
 * בדיקת שפיות: האם המע"מ שבמסמך תואם את השיעור שחל?
 * מחזיר את הסטייה באגורות. סטייה של אגורה-שתיים היא עיגול לגיטימי;
 * סטייה גדולה מרמזת על טעות בקריאה או על מסמך מעורב (חלקו פטור).
 */
export function vatDeviation(amounts: AmountTriplet, rateBp: number): number {
  return amounts.vatAgorot - percentOfBp(amounts.netAgorot, rateBp);
}

// ---------------------------------------------------------------------------
// אחוזי ניכוי מע"מ תשומות
// ---------------------------------------------------------------------------

/**
 * אחוזי הניכוי המקובלים לפי תקנות מס ערך מוסף.
 * ברירת המחדל היא 100%. שני שליש נהוג בהוצאות מעורבות (עסקי/פרטי),
 * ורבע ברכב פרטי שאינו כלי עבודה. הבחירה היא של המשתמש — המערכת רק מציעה.
 */
export const DEDUCTIBLE_PRESETS = [
  { bp: 10000, label: '100% — הוצאה עסקית מלאה' },
  { bp: 6667, label: '⅔ (66.67%) — הוצאה מעורבת עסקית/פרטית' },
  { bp: 2500, label: '25% — רכב פרטי' },
  { bp: 0, label: '0% — לא מוכר בניכוי' },
] as const;

/** מע"מ התשומות המוכר בפועל, בעיגול יחיד. */
export function deductibleVat(vatAgorot: number, deductibleBp: number): number {
  return percentOfBp(vatAgorot, deductibleBp);
}
