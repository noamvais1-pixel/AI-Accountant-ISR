/** עזרי תצוגה משותפים לכל המסכים. */

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d);
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** תאריך לשדה input[type=date] — תמיד YYYY-MM-DD ב-UTC. */
export function toDateInputValue(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  TAX_INVOICE: 'חשבונית מס',
  TAX_INVOICE_RECEIPT: 'חשבונית מס/קבלה',
  RECEIPT: 'קבלה',
  CREDIT_INVOICE: 'חשבונית זיכוי',
  IMPORT_DECLARATION: 'רשימון יבוא',
  SELF_INVOICE: 'חשבונית עצמית',
  PETTY_CASH: 'קופה קטנה',
  OTHER_DOC: 'מסמך אחר',
};

export const VAT_TREATMENT_LABELS: Record<string, string> = {
  STANDARD: 'חייב במע"מ',
  ZERO_RATED: 'מע"מ בשיעור אפס',
  EXEMPT: 'פטור ממע"מ',
  NO_VAT: 'ללא מע"מ',
};

export const INPUT_KIND_LABELS: Record<string, string> = {
  EQUIPMENT: 'תשומות ציוד',
  OTHER: 'תשומות שוטפות',
};

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'ממתין לאישור',
  CONFIRMED: 'מאושר',
  VOID: 'מבוטל',
};

export const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'הזנה ידנית',
  SCAN: 'צילום',
  CARDCOM: 'קארדקום',
  EMAIL: 'מייל',
};
