import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, addMonthsUtc } from '../lib/installments';

const base = {
  issueDate: new Date('2026-01-13T00:00:00Z'),
  netAgorot: 1290000, vatAgorot: 0, totalAgorot: 1290000,
  installments: 12, installmentAgorot: null, firstInstallmentAgorot: null,
};

test('12 תשלומים מסתכמים בדיוק לסכום המסמך', () => {
  const s = buildSchedule(base)!;
  assert.equal(s.length, 12);
  assert.equal(s.reduce((a, i) => a + i.totalAgorot, 0), 1290000);
  assert.equal(s[0].totalAgorot, 107500, '12,900 / 12 = 1,075.00');
});

test('מועדי הפירעון: הראשון ביום ההפקה, כל הבאים חודש אחרי קודמו', () => {
  const s = buildSchedule(base)!;
  assert.equal(s[0].dueDate.toISOString().slice(0, 10), '2026-01-13');
  assert.equal(s[1].dueDate.toISOString().slice(0, 10), '2026-02-13');
  assert.equal(s[11].dueDate.toISOString().slice(0, 10), '2026-12-13');
});

test('סכום שאינו מתחלק — השארית נופלת על התשלום האחרון, לא נעלמת', () => {
  const s = buildSchedule({ ...base, netAgorot: 100000, totalAgorot: 100000, installments: 3 })!;
  assert.deepEqual(s.map((i) => i.totalAgorot), [33333, 33333, 33334]);
});

test('נטו ומע"מ מתפצלים לפי יחס המסמך ומסתכמים בדיוק', () => {
  // 16,880 = 14,305.08 + 2,574.92 מע"מ (18%), 12 תשלומים כפי שקארדקום חייבה
  const s = buildSchedule({
    issueDate: new Date('2026-09-08T00:00:00Z'),
    netAgorot: 1430508, vatAgorot: 257492, totalAgorot: 1688000,
    installments: 12, installmentAgorot: 140600, firstInstallmentAgorot: 141400,
  })!;
  assert.equal(s[0].totalAgorot, 141400, 'התשלום הראשון כפי שהסולק חייב');
  assert.equal(s[1].totalAgorot, 140600);
  assert.equal(s.reduce((a, i) => a + i.totalAgorot, 0), 1688000);
  assert.equal(s.reduce((a, i) => a + i.netAgorot, 0), 1430508, 'הנטו מסתכם בדיוק');
  assert.equal(s.reduce((a, i) => a + i.vatAgorot, 0), 257492, 'המע"מ מסתכם בדיוק');
  for (const i of s) assert.equal(i.netAgorot + i.vatAgorot, i.totalAgorot, `שורה ${i.seq}: נטו+מע"מ=סה"כ`);
});

test('סטיית עיגול של הסולק נבלעת בתשלום האחרון', () => {
  // ראשון 1,414 + 11×1,406 = 16,880 בדיוק; אם הסולק היה מדווח 1,405 היה חסר 11
  const s = buildSchedule({ ...base, netAgorot: 1688000, totalAgorot: 1688000, installments: 12, installmentAgorot: 140500, firstInstallmentAgorot: 141400 })!;
  assert.equal(s.reduce((a, i) => a + i.totalAgorot, 0), 1688000);
  assert.equal(s[11].totalAgorot, 140500 + 1100);
});

test('מסמך בלי תשלומים, או בתשלום אחד, אינו נפרס', () => {
  assert.equal(buildSchedule({ ...base, installments: null }), null);
  assert.equal(buildSchedule({ ...base, installments: 1 }), null);
});

test('הוספת חודש נצמדת לסוף חודש קצר', () => {
  assert.equal(addMonthsUtc(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(addMonthsUtc(new Date('2026-01-31T00:00:00Z'), 2).toISOString().slice(0, 10), '2026-03-31');
  assert.equal(addMonthsUtc(new Date('2026-11-13T00:00:00Z'), 2).toISOString().slice(0, 10), '2027-01-13', 'חוצה שנה');
});
