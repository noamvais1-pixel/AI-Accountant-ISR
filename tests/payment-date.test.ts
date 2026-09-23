import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePaymentDate, indexByDocument } from '../lib/cardcom/payment-date';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

test('חיוב אשראי מקושר גובר על כל השאר', () => {
  const r = resolvePaymentDate({ invoiceDate: d('2026-09-23'), valueDate: d('2026-09-23'), transferDate: d('2026-07-02'), transactionDate: d('2026-07-21') });
  assert.equal(r.toISOString().slice(0, 10), '2026-07-21');
});

test('העברה בנקאית: TransferDate גובר על תאריך ערך שרק מהדהד את ההפקה', () => {
  const r = resolvePaymentDate({ invoiceDate: d('2026-09-23'), valueDate: d('2026-09-23'), transferDate: d('2026-07-02') });
  assert.equal(r.toISOString().slice(0, 10), '2026-07-02');
});

test('בלי עסקה ובלי העברה — תאריך ערך, ואם אין, תאריך ההפקה', () => {
  assert.equal(resolvePaymentDate({ invoiceDate: d('2026-08-11'), valueDate: d('2026-08-05') }).toISOString().slice(0, 10), '2026-08-05');
  assert.equal(resolvePaymentDate({ invoiceDate: d('2026-08-11') }).toISOString().slice(0, 10), '2026-08-11');
});

test('אינדקס עסקאות: לפי מספר מסמך, המוקדמת מנצחת, בלי מספר — מדולג', () => {
  const idx = indexByDocument([
    { documentNumber: 40269, date: '2026-07-19T05:17:57', installments: 1 },
    { documentNumber: 40269, date: '2026-07-10T05:17:57', installments: 1 },
    { documentNumber: null, date: '2026-07-01T00:00:00', installments: 1 },
  ]);
  assert.equal(idx.size, 1);
  assert.equal(idx.get(40269)?.date, '2026-07-10T05:17:57');
});
