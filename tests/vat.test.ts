import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromGross, fromNet, reconcileAmounts, vatRateBpAt, deductibleVat, vatDeviation } from '../lib/vat';
import { netForExactTotal } from '../lib/vat';
import { toAgorot, agorotToWholeShekels, percentOfBp } from '../lib/money';

test('שיעור המע"מ נקבע לפי תאריך המסמך', () => {
  assert.equal(vatRateBpAt(new Date('2024-12-31')), 1700, 'סוף 2024 — 17%');
  assert.equal(vatRateBpAt(new Date('2025-01-01')), 1800, 'תחילת 2025 — 18%');
  assert.equal(vatRateBpAt(new Date('2026-08-24')), 1800, '2026 — 18%');
  assert.equal(vatRateBpAt(new Date('2014-01-01')), 1800, '2014 — 18%');
  assert.equal(vatRateBpAt(new Date('2016-01-01')), 1700, '2016 — 17%');
});

test('הוספת מע"מ לסכום נטו', () => {
  const r = fromNet(toAgorot(100), 1800);
  assert.equal(r.netAgorot, 10000);
  assert.equal(r.vatAgorot, 1800);
  assert.equal(r.totalAgorot, 11800);
});

test('חילוץ מע"מ מסכום ברוטו מסתדר בדיוק, בלי אגורה נעלמת', () => {
  for (const gross of [11800, 10000, 1, 99, 123457, 777777]) {
    const r = fromGross(gross, 1800);
    assert.equal(r.netAgorot + r.vatAgorot, gross, `הרכב הסכומים חייב להסתדר עבור ${gross}`);
  }
});

test('חילוץ מע"מ מ-118 ש"ח נותן 100 ו-18', () => {
  const r = fromGross(toAgorot(118), 1800);
  assert.equal(r.netAgorot, 10000);
  assert.equal(r.vatAgorot, 1800);
});

test('reconcile מעדיף את מה שנקרא מהמסמך ולא מחשב מחדש', () => {
  // חשבונית אמיתית שבה המע"מ עוגל כלפי מטה — אסור "לתקן" אותה.
  const r = reconcileAmounts({ netAgorot: 10001, vatAgorot: 1800, totalAgorot: null, rateBp: 1800 });
  assert.equal(r.vatAgorot, 1800, 'המע"מ נשאר כפי שנקרא');
  assert.equal(r.totalAgorot, 11801);
});

test('reconcile גוזר את השדה החסר משני האחרים', () => {
  assert.equal(reconcileAmounts({ netAgorot: 10000, totalAgorot: 11800, rateBp: 1800 }).vatAgorot, 1800);
  assert.equal(reconcileAmounts({ vatAgorot: 1800, totalAgorot: 11800, rateBp: 1800 }).netAgorot, 10000);
});

test('reconcile עם ברוטו בלבד מחלץ לפי השיעור', () => {
  const r = reconcileAmounts({ totalAgorot: 11800, rateBp: 1800 });
  assert.deepEqual(r, { netAgorot: 10000, vatAgorot: 1800, totalAgorot: 11800 });
});

test('סטיית מע"מ מזהה חשבונית חשודה', () => {
  assert.equal(vatDeviation({ netAgorot: 10000, vatAgorot: 1800, totalAgorot: 11800 }, 1800), 0);
  // מסמך שחציו פטור — סטייה גדולה, סימן שצריך בדיקה ידנית
  assert.equal(vatDeviation({ netAgorot: 20000, vatAgorot: 1800, totalAgorot: 21800 }, 1800), -1800);
});

test('ניכוי חלקי של מע"מ תשומות מעוגל פעם אחת', () => {
  assert.equal(deductibleVat(1800, 10000), 1800, '100%');
  assert.equal(deductibleVat(1800, 6667), 1200, 'שני שליש');
  assert.equal(deductibleVat(1800, 2500), 450, 'רבע');
  assert.equal(deductibleVat(1800, 0), 0, 'לא מוכר');
});

test('percentOfBp מעגל ולא חותך', () => {
  assert.equal(percentOfBp(1, 6667), 1, '0.6667 מעוגל ל-1');
  assert.equal(percentOfBp(1, 2500), 0, '0.25 מעוגל ל-0');
});

test('עיגול לשקלים שלמים לקובץ PCN874', () => {
  assert.equal(agorotToWholeShekels(11849), 118);
  assert.equal(agorotToWholeShekels(11850), 119);
  assert.equal(agorotToWholeShekels(-11850), -119, 'זיכוי נשאר שלילי');
});

test('toAgorot לא נופל על שגיאת float', () => {
  assert.equal(toAgorot(1234.56), 123456);
  assert.equal(toAgorot(0.07), 7);
  assert.equal(toAgorot('₪1,234.56'), 123456);
});

test('חשבונית זיכוי מבטלת במדויק את החשבונית שכנגדה גם אחרי עיגול לשקלים', () => {
  // 118.50 ש"ח: החיוב מתעגל ל-119 והזיכוי חייב להתעגל ל--119, אחרת נשאר שקל בדוח.
  assert.equal(agorotToWholeShekels(11850) + agorotToWholeShekels(-11850), 0);
  assert.equal(agorotToWholeShekels(-11850), -119);
});

test('netForExactTotal: נטו שמחזיר בדיוק את הסכום כשקיים כזה, ואחרת הקרוב ביותר', () => {
  // ב-18% יש סכומים שאף נטו שלם לא מגיע אליהם בדיוק (למשל 1,575.00) — אז אגורה אחת לכל היותר
  for (const total of [1790000, 19700, 157500, 1688000, 100, 101, 117, 118, 119, 123457]) {
    const net = netForExactTotal(total, 1800);
    const back = net + Math.round((net * 1800) / 10000);
    assert.ok(Math.abs(back - total) <= 1, `total ${total} → ${back}`);
  }
  assert.equal(netForExactTotal(1790000, 1800), 1516949);
  assert.equal(netForExactTotal(1688000, 1800), 1430508);
});
