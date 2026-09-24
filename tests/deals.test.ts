import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountsFromTotal, plannedSchedule, dealProgress } from '../lib/deals';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

test('סכום כולל → נטו ומע"מ, ומסתכמים בדיוק', () => {
  const a = amountsFromTotal(1790000, 1800, 'STANDARD');
  assert.deepEqual(a, { netAgorot: 1516949, vatAgorot: 273051, totalAgorot: 1790000 });
  assert.deepEqual(amountsFromTotal(50000, 1800, 'EXEMPT'), { netAgorot: 50000, vatAgorot: 0, totalAgorot: 50000 });
  assert.throws(() => amountsFromTotal(0, 1800, 'STANDARD'));
});

test('לוח צפוי: 12 תשלומים חודשיים, השארית על האחרון', () => {
  const plan = plannedSchedule({ totalAgorot: 1688000, installments: 12, firstPaymentDate: d('2026-01-31') });
  assert.equal(plan.length, 12);
  assert.equal(plan.reduce((a, p) => a + p.amountAgorot, 0), 1688000);
  assert.equal(plan[1].dueDate.toISOString().slice(0, 10), '2026-02-28');
  assert.equal(plan[11].dueDate.toISOString().slice(0, 10), '2026-12-31');
});

test('התקדמות: תקבולים מכסים תשלומים לפי הסדר, מה שנשאר מאחור — באיחור', () => {
  const deal = { totalAgorot: 300000, installments: 3, firstPaymentDate: d('2026-07-01') };
  const p = dealProgress(deal, [{ amountAgorot: 100000 }, { amountAgorot: 50000 }], d('2026-08-15'));
  assert.equal(p.paidAgorot, 150000);
  assert.equal(p.remainingAgorot, 150000);
  assert.equal(p.overdueAgorot, 50000); // תשלום 2 (1.8) כוסה רק בחצי
  assert.equal(p.nextDue?.seq, 3);
  assert.equal(p.nextDue?.amountAgorot, 100000);
  assert.equal(p.isPaid, false);
  assert.equal(dealProgress(deal, [{ amountAgorot: 300000 }], d('2026-08-15')).isPaid, true);
});
