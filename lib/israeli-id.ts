/**
 * אימות מספר ח.פ / ע.מ / ת.ז ישראלי לפי ספרת ביקורת (אלגוריתם לוהן מותאם).
 * חשוב: מספר עוסק שגוי בקובץ PCN874 גורם לדחיית הדוח.
 */

export function isValidIsraeliId(value: string | null | undefined): boolean {
  if (!value) return false;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0 || digits.length > 9) return false;

  const padded = digits.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const digit = Number(padded[i]);
    const weighted = digit * ((i % 2) + 1);
    sum += weighted > 9 ? weighted - 9 : weighted;
  }
  return sum % 10 === 0;
}

/** מנרמל מספר עוסק ל-9 ספרות עם אפסים מובילים — הפורמט שקובץ PCN874 דורש. */
export function normalizeVatId(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  return digits.slice(-9).padStart(9, '0');
}
