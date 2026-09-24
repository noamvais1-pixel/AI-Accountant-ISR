import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretLowProfileResult } from '../lib/payments/lowprofile';

const paid = {
  ResponseCode: 0,
  LowProfileId: 'abc',
  ReturnValue: 'req1',
  TranzactionInfo: {
    ResponseCode: 0, TranzactionId: 262921683, Amount: 1688, CreateDate: '2026-09-08T20:42:33', Last4CardDigitsString: '8649',
    NumberOfPayments: 12, FirstPaymentAmount: 141.4, ConstPaymentAmount: 140.6, CardOwnerName: 'Rivka',
  },
  DocumentInfo: { ResponseCode: 0, DocumentType: 'TaxInvoiceAndReceipt', DocumentNumber: 40284, DocumentUrl: 'https://x/doc' },
};

test('תשלום מאושר: סכום, מועד, תשלומים והמסמך שהופק', () => {
  const r = interpretLowProfileResult(paid, 168800);
  assert.equal(r.outcome, 'paid');
  if (r.outcome !== 'paid') return;
  assert.equal(r.transactionId, '262921683');
  assert.equal(r.paidAt.toISOString().slice(0, 10), '2026-09-08');
  assert.equal(r.installments, 12);
  assert.deepEqual([r.firstAgorot, r.constAgorot, r.last4], [14140, 14060, '8649']);
  assert.deepEqual(r.document, { number: '40284', typeId: 1, typeName: 'TaxInvoiceAndReceipt', url: 'https://x/doc' });
});

test('סכום שונה מהמבוקש אינו נרשם כתשלום', () => {
  assert.equal(interpretLowProfileResult(paid, 100000).outcome, 'mismatch');
});

test('בלי עסקה — ממתין; עסקה שנדחתה — נכשל עם סיבה', () => {
  assert.equal(interpretLowProfileResult({ ResponseCode: 1, Description: 'no deal' }, 100).outcome, 'pending');
  const failed = interpretLowProfileResult({ ResponseCode: 0, TranzactionInfo: { ResponseCode: 33, Description: 'כרטיס נדחה', TranzactionId: 1, Amount: 1 } }, 100);
  assert.deepEqual(failed, { outcome: 'failed', reason: 'כרטיס נדחה' });
});

test('סוג מסמך מספרי מתורגם לשם', () => {
  const r = interpretLowProfileResult({ ...paid, DocumentInfo: { ResponseCode: 0, DocumentType: 1, DocumentNumber: 5 } }, 168800);
  assert.equal(r.outcome === 'paid' && r.document?.typeName, 'TaxInvoiceAndReceipt');
});
