/**
 * מועד התשלום של מסמך קארדקום.
 *
 * תאריך ההפקה אינו מועד התשלום: חשבוניות מופקות לעיתים חודשים אחרי שהכסף
 * התקבל. קארדקום שומרת את המידע בכמה מקומות, לפי אופן התשלום:
 * - חיוב אשראי: העסקה עצמה מצביעה על המסמך (DocumentNumber), ומועד החיוב
 *   שלה הוא מועד התשלום. זה המקור המדויק ביותר.
 * - העברה בנקאית / תשלום חיצוני: TransferDate על המסמך.
 * - ValueDate — תאריך ערך; במסמכים שהופקו באיחור הוא פשוט שווה לתאריך ההפקה,
 *   ולכן הוא רק לפני ברירת המחדל.
 */

export type PaymentDateInputs = {
  invoiceDate: Date;
  valueDate?: Date | null;
  transferDate?: Date | null;
  transactionDate?: Date | null;
};

export function resolvePaymentDate(i: PaymentDateInputs): Date {
  return i.transactionDate ?? i.transferDate ?? i.valueDate ?? i.invoiceDate;
}

export type LinkedTransaction = { documentNumber: number | null; date: string; installments: number };

/**
 * אינדקס עסקאות לפי מספר המסמך שהן מצביעות עליו.
 * כמה עסקאות על אותו מסמך (למשל תשלום שנפרס ידנית) — נשמרת המוקדמת: הכסף
 * התחיל להגיע אז.
 */
export function indexByDocument<T extends LinkedTransaction>(transactions: T[]): Map<number, T> {
  const map = new Map<number, T>();
  for (const t of transactions) {
    if (t.documentNumber == null) continue;
    const prev = map.get(t.documentNumber);
    if (!prev || t.date < prev.date) map.set(t.documentNumber, t);
  }
  return map;
}
