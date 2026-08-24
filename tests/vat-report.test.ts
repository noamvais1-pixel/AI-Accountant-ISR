import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVatReport } from '../lib/reports/vat-report';
import { buildPeriod } from '../lib/periods';
import { doc, income } from './helpers';

const period = buildPeriod(2026, 4, 'BIMONTHLY'); // יולי–אוגוסט 2026

test('דוח בסיסי: מע"מ עסקאות פחות מע"מ תשומות', () => {
  const r = buildVatReport(period, [
    income({ netAgorot: 100000, vatAgorot: 18000 }),
    doc({ netAgorot: 50000, vatAgorot: 9000, deductibleVatAgorot: 9000 }),
  ]);
  assert.equal(r.taxableSalesNet, 100000);
  assert.equal(r.taxableSalesVat, 18000);
  assert.equal(r.otherInputsVat, 9000);
  assert.equal(r.vatDue, 9000, 'לתשלום: 180 - 90 = 90 ש"ח');
  assert.equal(r.salesRecordCount, 1);
  assert.equal(r.inputsRecordCount, 1);
});

test('עודף תשומות מייצר החזר — סכום שלילי', () => {
  const r = buildVatReport(period, [
    income({ netAgorot: 10000, vatAgorot: 1800 }),
    doc({ netAgorot: 100000, vatAgorot: 18000, deductibleVatAgorot: 18000 }),
  ]);
  assert.equal(r.vatDue, -16200, 'החזר של 162 ש"ח');
});

test('חשבונית זיכוי בהכנסות מקטינה את העסקאות ואת המע"מ', () => {
  const r = buildVatReport(period, [
    income({ netAgorot: 100000, vatAgorot: 18000 }),
    income({ netAgorot: 30000, vatAgorot: 5400, isCredit: true, docType: 'CREDIT_INVOICE' }),
  ]);
  assert.equal(r.taxableSalesNet, 70000);
  assert.equal(r.taxableSalesVat, 12600);
  assert.equal(r.creditInvoiceCount, 1);
});

test('חשבונית זיכוי בהוצאות מקטינה את מע"מ התשומות', () => {
  const r = buildVatReport(period, [
    doc({ netAgorot: 100000, vatAgorot: 18000, deductibleVatAgorot: 18000 }),
    doc({ netAgorot: 20000, vatAgorot: 3600, isCredit: true, docType: 'CREDIT_INVOICE' }),
  ]);
  assert.equal(r.otherInputsVat, 14400);
});

test('תשומות ציוד נספרות בשורה נפרדת מתשומות שוטפות', () => {
  const r = buildVatReport(period, [
    doc({ netAgorot: 100000, vatAgorot: 18000, inputKind: 'EQUIPMENT' }),
    doc({ netAgorot: 50000, vatAgorot: 9000, inputKind: 'OTHER' }),
  ]);
  assert.equal(r.equipmentInputsVat, 18000);
  assert.equal(r.otherInputsVat, 9000);
  assert.equal(r.totalInputsVat, 27000);
});

test('ניכוי חלקי — רק החלק המוכר נכנס לדוח, השאר נרשם בנפרד', () => {
  const r = buildVatReport(period, [doc({ netAgorot: 100000, vatAgorot: 18000, deductibleBp: 6667 })]);
  assert.equal(r.otherInputsVat, 12001, 'שני שליש מ-18000');
  assert.equal(r.nonDeductibleVat, 5999, 'השליש שאינו מוכר');
  assert.equal(r.totalInputsVat + r.nonDeductibleVat, 18000, 'הכל מסתדר');
});

test('הוצאה שאינה מוכרת כלל אינה נספרת כרשומת תשומה', () => {
  const r = buildVatReport(period, [doc({ vatAgorot: 1800, deductibleBp: 0 })]);
  assert.equal(r.inputsRecordCount, 0);
  assert.equal(r.totalInputsVat, 0);
  assert.equal(r.nonDeductibleVat, 1800);
});

test('טיוטות אינן נכנסות לדוח ומדווחות כאזהרה', () => {
  const r = buildVatReport(period, [
    income({ netAgorot: 100000, vatAgorot: 18000 }),
    doc({ status: 'DRAFT', netAgorot: 999999, vatAgorot: 999999 }),
  ]);
  assert.equal(r.vatDue, 18000, 'הטיוטה לא השפיעה');
  assert.equal(r.draftCount, 1);
  assert.ok(r.warnings.some((w) => w.message.includes('ממתינים לאישור')));
});

test('מסמך מבוטל מתעלמים ממנו לגמרי', () => {
  const r = buildVatReport(period, [
    income({ netAgorot: 100000, vatAgorot: 18000 }),
    income({ status: 'VOID', netAgorot: 50000, vatAgorot: 9000 }),
  ]);
  assert.equal(r.taxableSalesNet, 100000);
  assert.equal(r.salesRecordCount, 1);
});

test('עסקה פטורה נספרת בנפרד ולא במע"מ', () => {
  const r = buildVatReport(period, [income({ netAgorot: 50000, vatAgorot: 0, vatTreatment: 'ZERO_RATED' })]);
  assert.equal(r.zeroRatedSales, 50000);
  assert.equal(r.taxableSalesVat, 0);
  assert.equal(r.salesRecordCount, 1);
});

test('עסקה מסומנת פטורה אך עם מע"מ — שגיאה', () => {
  const r = buildVatReport(period, [income({ vatAgorot: 1800, vatTreatment: 'EXEMPT' })]);
  assert.ok(r.warnings.some((w) => w.severity === 'error' && w.message.includes('נרשם בו מע"מ')));
});

test('הוצאה בלי מספר עוסק של הספק — שגיאה שתדחה את הדיווח המפורט', () => {
  const r = buildVatReport(period, [doc({ counterpartyVatId: null, vatAgorot: 1800 })]);
  assert.ok(r.warnings.some((w) => w.severity === 'error' && w.message.includes('חסר מספר עוסק')));
});

test('קבלה בלבד עם מע"מ — אזהרה שאינה מזכה בניכוי', () => {
  const r = buildVatReport(period, [doc({ docType: 'RECEIPT', vatAgorot: 1800 })]);
  assert.ok(r.warnings.some((w) => w.message.includes('קבלה ולא חשבונית מס')));
});

test('דוח ריק אינו קורס', () => {
  const r = buildVatReport(period, []);
  assert.equal(r.vatDue, 0);
  assert.equal(r.warnings.length, 0);
});

test('קבלה שנקלטה מקארדקום אינה נספרת כעסקה — היא תקבול על חשבונית שכבר דווחה', () => {
  const r = buildVatReport(period, [
    income({ netAgorot: 100000, vatAgorot: 18000 }),
    income({ docType: 'RECEIPT', vatTreatment: 'NO_VAT', netAgorot: 100000, vatAgorot: 0 }),
  ]);
  assert.equal(r.salesRecordCount, 1, 'רק החשבונית נספרת');
  assert.equal(r.zeroRatedSales, 0, 'הקבלה אינה עסקה פטורה');
  assert.equal(r.taxableSalesNet, 100000);
});
