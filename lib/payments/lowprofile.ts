import type { LowProfileResult } from '../cardcom/client';
import { CARDCOM_DOC_TYPE_BY_ID } from '../cardcom/client';

/**
 * פירוש תוצאת דף תשלום — טהור, כדי שאפשר יהיה לבדוק כל מקרה בלי קארדקום.
 *
 * שלוש תוצאות: שולם (יש עסקה מאושרת), נכשל (יש ניסיון עסקה שנדחה), או
 * ממתין (עדיין לא היה ניסיון). הסכום נבדק מול מה שביקשנו: דף שמישהו הצליח
 * לשנות בו את הסכום לא נרשם כתשלום.
 */

export type PaidOutcome = {
  outcome: 'paid';
  transactionId: string;
  amountAgorot: number;
  paidAt: Date;
  installments: number;
  firstAgorot: number | null;
  constAgorot: number | null;
  last4: string | null;
  cardOwnerName: string | null;
  document: { number: string; typeId: number; typeName: string; url: string | null } | null;
};

export type LowProfileOutcome =
  | PaidOutcome
  | { outcome: 'failed'; reason: string }
  | { outcome: 'pending' }
  | { outcome: 'mismatch'; reason: string };

const toAgorot = (n: number | undefined) => Math.round((n ?? 0) * 100);

function documentTypeId(value: string | number | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const entry = Object.entries(CARDCOM_DOC_TYPE_BY_ID).find(([, name]) => name === value);
  return entry ? Number(entry[0]) : Number.isFinite(Number(value)) ? Number(value) : null;
}

export function interpretLowProfileResult(result: LowProfileResult, expectedAgorot: number): LowProfileOutcome {
  const tx = result.TranzactionInfo;
  if (!tx) {
    // בלי עסקה = הלקוחה עוד לא שילמה (או סגרה את הדף)
    return { outcome: 'pending' };
  }
  if (tx.ResponseCode !== 0) {
    return { outcome: 'failed', reason: tx.Description || result.Description || `קוד ${tx.ResponseCode}` };
  }
  if (tx.IsRefund) return { outcome: 'mismatch', reason: 'העסקה היא זיכוי ולא חיוב' };
  const amountAgorot = toAgorot(tx.Amount);
  if (amountAgorot !== expectedAgorot) {
    return { outcome: 'mismatch', reason: `הסכום ששולם (${(amountAgorot / 100).toFixed(2)}) שונה מהסכום שנדרש (${(expectedAgorot / 100).toFixed(2)})` };
  }
  const docNumber = result.DocumentInfo?.DocumentNumber ?? tx.DocumentNumber;
  const docType = result.DocumentInfo?.DocumentType ?? tx.DocumentType;
  const typeId = documentTypeId(docType);
  const installments = Math.max(1, tx.NumberOfPayments ?? result.UIValues?.NumOfPayments ?? 1);
  const parsed = tx.CreateDate ? new Date(`${tx.CreateDate.slice(0, 10)}T00:00:00.000Z`) : new Date();
  return {
    outcome: 'paid',
    transactionId: String(tx.TranzactionId ?? result.TranzactionId ?? ''),
    amountAgorot,
    paidAt: Number.isNaN(parsed.getTime()) ? new Date() : parsed,
    installments,
    firstAgorot: installments > 1 && tx.FirstPaymentAmount ? toAgorot(tx.FirstPaymentAmount) : null,
    constAgorot: installments > 1 && tx.ConstPaymentAmount ? toAgorot(tx.ConstPaymentAmount) : null,
    last4: tx.Last4CardDigitsString ?? (tx.Last4CardDigits != null ? String(tx.Last4CardDigits).padStart(4, '0') : null),
    cardOwnerName: tx.CardOwnerName ?? result.UIValues?.CardOwnerName ?? null,
    document:
      docNumber && typeId != null
        ? { number: String(docNumber), typeId, typeName: CARDCOM_DOC_TYPE_BY_ID[typeId] ?? String(docType), url: result.DocumentInfo?.DocumentUrl ?? tx.DocumentUrl ?? null }
        : null,
  };
}
