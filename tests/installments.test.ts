import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, addMonthsUtc, mirrorSchedule, buildScheduleFromPayments } from '../lib/installments';

const base = {
  reportDate: new Date('2026-01-13T00:00:00Z'),
  netAgorot: 1290000, vatAgorot: 0, totalAgorot: 1290000,
  installments: 12, installmentAgorot: null, firstInstallmentAgorot: null,
};

test('12 תשלומים מסתכמים בדיוק לסכום המסמך', () => {
  const s = buildSchedule(base)!;
  assert.equal(s.length, 12);
  assert.equal(s.reduce((a, i) => a + i.totalAgorot, 0), 1290000);
  assert.equal(s[0].totalAgorot, 107500, '12,900 / 12 = 1,075.00');
});

test('מועדי הפירעון: הראשון במועד התשלום, כל הבאים חודש אחרי קודמו', () => {
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
    reportDate: new Date('2026-09-08T00:00:00Z'),
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

test('חשבונית שהופקה באיחור נפרסת ממועד התשלום, לא מתאריך ההפקה', () => {
  // הופקה ב-15/09, שולמה ב-08/09 — התשלום הראשון חל ב-08/09
  const s = buildSchedule({ ...base, reportDate: new Date('2026-09-08T00:00:00Z'), installments: 3 })!;
  assert.equal(s[0].dueDate.toISOString().slice(0, 10), '2026-09-08');
  assert.equal(s[2].dueDate.toISOString().slice(0, 10), '2026-11-08');
});

test('זיכוי על עסקה בתשלומים: מה שטרם נגבה מתבטל בחודשו, מה שנגבה מוחזר במועד הזיכוי', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const original = [
    { seq: 1, dueDate: d('2026-04-26'), netAgorot: 37712, vatAgorot: 6788, totalAgorot: 44500 },
    { seq: 2, dueDate: d('2026-05-26'), netAgorot: 37712, vatAgorot: 6788, totalAgorot: 44500 },
    { seq: 3, dueDate: d('2026-06-26'), netAgorot: 37712, vatAgorot: 6788, totalAgorot: 44500 },
  ];
  const mirrored = mirrorSchedule(original, d('2026-05-30'));
  assert.deepEqual(
    mirrored.map((s) => s.dueDate.toISOString().slice(0, 10)),
    ['2026-05-30', '2026-05-30', '2026-06-26'],
  );
  // הסכומים אינם משתנים — רק המועדים
  assert.equal(mirrored.reduce((a, s) => a + s.totalAgorot, 0), 133500);
});

test('פיצול ידני: 12,000 ביולי ו-5,900 בספטמבר על מסמך של 17,900', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const doc = { netAgorot: 1516949, vatAgorot: 273051, totalAgorot: 1790000 };
  const rows = buildScheduleFromPayments(doc, [
    { dueDate: d('2026-09-24'), totalAgorot: 590000 },
    { dueDate: d('2026-07-14'), totalAgorot: 1200000 },
  ]);
  assert.deepEqual(rows.map((r) => [r.seq, r.dueDate.toISOString().slice(0, 10), r.totalAgorot]), [
    [1, '2026-07-14', 1200000],
    [2, '2026-09-24', 590000],
  ]);
  assert.equal(rows.reduce((a, r) => a + r.netAgorot, 0), doc.netAgorot);
  assert.equal(rows.reduce((a, r) => a + r.vatAgorot, 0), doc.vatAgorot);
  for (const r of rows) assert.equal(r.netAgorot + r.vatAgorot, r.totalAgorot);
});

test('פיצול ידני שאינו מסתכם לסכום המסמך נדחה', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  assert.throws(
    () => buildScheduleFromPayments({ netAgorot: 100, vatAgorot: 18, totalAgorot: 118 }, [{ dueDate: d('2026-07-01'), totalAgorot: 100 }]),
    /אינו שווה לסכום המסמך/,
  );
});
