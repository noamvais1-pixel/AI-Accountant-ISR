import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickReversedDocument } from '../lib/reversals';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const base = { isCredit: false, alreadyReversed: false, counterpartyName: 'לקוחה א', counterpartyVatId: '012345678' };
const credit = { issueDate: d('2026-09-15'), totalAgorot: 1688000, counterpartyName: 'לקוחה א', counterpartyVatId: '012345678           ' };

test('זיכוי מקושר למסמך האחרון של אותו לקוח באותו סכום שהופק לפניו', () => {
  const picked = pickReversedDocument(credit, [
    { ...base, id: 'old', issueDate: d('2026-03-01'), totalAgorot: 1688000 },
    { ...base, id: 'recent', issueDate: d('2026-09-08'), totalAgorot: 1688000 },
    { ...base, id: 'after', issueDate: d('2026-09-20'), totalAgorot: 1688000 },
    { ...base, id: 'other-amount', issueDate: d('2026-09-08'), totalAgorot: 19700 },
  ]);
  assert.equal(picked?.id, 'recent');
});

test('מזהה לקוח עם רווחים מיושר; בלי מזהה — לפי שם', () => {
  const byName = pickReversedDocument(
    { ...credit, counterpartyVatId: null },
    [{ ...base, id: 'x', counterpartyVatId: null, issueDate: d('2026-09-08'), totalAgorot: 1688000 }],
  );
  assert.equal(byName?.id, 'x');
  const otherId = pickReversedDocument(credit, [
    { ...base, id: 'y', counterpartyVatId: '999999999', issueDate: d('2026-09-08'), totalAgorot: 1688000 },
  ]);
  assert.equal(otherId, null);
});

test('מסמך שכבר בוטל, או זיכוי אחר, אינם מועמדים', () => {
  const picked = pickReversedDocument(credit, [
    { ...base, id: 'done', alreadyReversed: true, issueDate: d('2026-09-08'), totalAgorot: 1688000 },
    { ...base, id: 'credit', isCredit: true, issueDate: d('2026-09-08'), totalAgorot: 1688000 },
  ]);
  assert.equal(picked, null);
});
