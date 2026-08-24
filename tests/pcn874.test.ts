import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePcn874, buildTransactionLine, buildHeaderLine, entryTypeFor, documentToTransaction } from '../lib/reports/pcn874';
import { buildVatReport } from '../lib/reports/vat-report';
import { buildPeriod } from '../lib/periods';
import { doc, income } from './helpers';

const period = buildPeriod(2026, 4, 'BIMONTHLY');
const VAT_ID = '520000472';
const GEN_DATE = new Date('2026-09-10T00:00:00Z');

function generate(documents: Parameters<typeof generatePcn874>[0]['documents']) {
  const report = buildVatReport(period, documents);
  return generatePcn874({ vatId: VAT_ID, period, report, documents, generationDate: GEN_DATE });
}

test('שורת פתיחה באורך 131 תווים ומתחילה ב-O', () => {
  const report = buildVatReport(period, []);
  const line = buildHeaderLine({ vatId: VAT_ID, reportMonth: '202608', generationDate: GEN_DATE, report });
  assert.equal(line[0], 'O');
  assert.equal(line.length, 131, `אורך בפועל ${line.length}`);
  assert.ok(line.startsWith('O520000472202608120260910'), line.slice(0, 30));
});

test('שורת תנועה באורך 60 תווים', () => {
  const line = buildTransactionLine({
    entryType: 'T',
    vatId: '520000472',
    invoiceDate: new Date('2026-07-15T00:00:00Z'),
    refGroup: '0',
    refNumber: '1234',
    vatShekels: 180,
    netShekels: 1000,
    allocationNumber: null,
  });
  assert.equal(line.length, 60, `אורך בפועל ${line.length}`);
  assert.equal(line, 'T520000472202607150000000001234000000180+0000001000000000000');
});

test('שורת תנועה של זיכוי נושאת סימן מינוס בסכום ומע"מ חיובי', () => {
  const line = buildTransactionLine({
    entryType: 'S',
    vatId: '520000472',
    invoiceDate: new Date('2026-07-15T00:00:00Z'),
    refGroup: '0',
    refNumber: '55',
    vatShekels: 180,
    netShekels: -1000,
    allocationNumber: null,
  });
  assert.ok(line.includes('-0000001000'), 'סכום שלילי');
  assert.ok(line.includes('000000180'), 'מע"מ חיובי');
  assert.equal(line.length, 60);
});

test('מספר הקצאה נכנס ל-9 התווים האחרונים', () => {
  const line = buildTransactionLine({
    entryType: 'S',
    vatId: '520000472',
    invoiceDate: new Date('2026-07-15T00:00:00Z'),
    refGroup: '0',
    refNumber: '55',
    vatShekels: 180,
    netShekels: 1000,
    allocationNumber: '12345678',
  });
  assert.equal(line.slice(-9), '012345678');
});

test('מספר אסמכתא עם אותיות מצטמצם לספרות בלבד', () => {
  const line = buildTransactionLine({
    entryType: 'T',
    vatId: '520000472',
    invoiceDate: new Date('2026-07-15T00:00:00Z'),
    refGroup: '0',
    refNumber: 'INV-2026/0042',
    vatShekels: 0,
    netShekels: 0,
    allocationNumber: null,
  });
  assert.equal(line.slice(22, 31), '020260042', 'INV-2026/0042 -> 20260042 בהשלמה ל-9');
  assert.equal(line.length, 60);
});

test('סיווג רשומות לפי כיוון וסוג מסמך', () => {
  assert.equal(entryTypeFor(income({ counterpartyVatId: '520000472' })), 'S', 'לקוח מזוהה');
  assert.equal(entryTypeFor(income({ counterpartyVatId: null })), 'L', 'לקוח לא מזוהה');
  assert.equal(entryTypeFor(income({ counterpartyVatId: null, vatTreatment: 'ZERO_RATED' })), 'Y', 'ייצוא');
  assert.equal(entryTypeFor(income({ docType: 'SELF_INVOICE' })), 'M');
  assert.equal(entryTypeFor(doc({})), 'T', 'תשומה רגילה');
  assert.equal(entryTypeFor(doc({ docType: 'PETTY_CASH' })), 'K');
  assert.equal(entryTypeFor(doc({ docType: 'IMPORT_DECLARATION' })), 'R');
  assert.equal(entryTypeFor(doc({ docType: 'OTHER_DOC' })), 'H');
  assert.equal(entryTypeFor(doc({ docType: 'SELF_INVOICE' })), 'C');
});

test('בתשומות מדווח רק המע"מ המוכר בניכוי, לא המע"מ ששולם', () => {
  const t = documentToTransaction(doc({ netAgorot: 100000, vatAgorot: 18000, deductibleBp: 2500 }));
  assert.equal(t.vatShekels, 45, 'רבע מ-180 ש"ח');
  assert.equal(t.netShekels, 1000, 'הסכום נשאר 100%');
});

test('קובץ מלא: פתיחה, תנועות, סגירה', () => {
  const documents = [
    income({ netAgorot: 100000, vatAgorot: 18000, counterpartyVatId: '520000472', number: '501' }),
    doc({ netAgorot: 50000, vatAgorot: 9000, number: '77' }),
  ];
  const { content, lineCount } = generate(documents);
  const lines = content.trimEnd().split('\r\n');
  assert.equal(lineCount, 4);
  assert.equal(lines[0][0], 'O');
  assert.equal(lines[3], 'X520000472');
  assert.ok(lines.slice(1, 3).every((l) => l.length === 60));
});

test('טיוטות אינן נכנסות לקובץ', () => {
  const { content } = generate([
    income({ netAgorot: 100000, vatAgorot: 18000 }),
    doc({ status: 'DRAFT', netAgorot: 999999, vatAgorot: 999999 }),
  ]);
  assert.equal(content.trimEnd().split('\r\n').length, 3, 'פתיחה + תנועה אחת + סגירה');
});

test('מכירות ללקוחות לא מזוהים מרוכזות לשורה אחת ליום', () => {
  const { content } = generate([
    income({ counterpartyVatId: null, netAgorot: 10000, vatAgorot: 1800, issueDate: new Date('2026-07-01T00:00:00Z') }),
    income({ counterpartyVatId: null, netAgorot: 20000, vatAgorot: 3600, issueDate: new Date('2026-07-01T00:00:00Z') }),
    income({ counterpartyVatId: null, netAgorot: 5000, vatAgorot: 900, issueDate: new Date('2026-07-02T00:00:00Z') }),
  ]);
  const lines = content.trimEnd().split('\r\n');
  const lRows = lines.filter((l) => l[0] === 'L');
  assert.equal(lRows.length, 2, 'שני ימים, שתי שורות');
  assert.ok(lRows[0].includes('+0000000300'), 'יום ראשון: 100+200=300 ש"ח');
  assert.ok(lRows[0].includes('000000054'), 'מע"מ מרוכז 54 ש"ח');
  assert.ok(lRows.every((l) => l.slice(1, 10) === '000000000'), 'ע.מ מאופס בלקוח לא מזוהה');
});

test('קופה קטנה מרוכזת גם היא לפי יום', () => {
  const { content } = generate([
    doc({ docType: 'PETTY_CASH', netAgorot: 3000, vatAgorot: 540, issueDate: new Date('2026-07-05T00:00:00Z') }),
    doc({ docType: 'PETTY_CASH', netAgorot: 2000, vatAgorot: 360, issueDate: new Date('2026-07-05T00:00:00Z') }),
  ]);
  const kRows = content.trimEnd().split('\r\n').filter((l) => l[0] === 'K');
  assert.equal(kRows.length, 1);
  assert.ok(kRows[0].includes('+0000000050'), 'סכום מרוכז 50 ש"ח');
});

test('סכומי הכותרת תואמים את סכומי התנועות', () => {
  const documents = [
    income({ netAgorot: 100000, vatAgorot: 18000, counterpartyVatId: '520000472' }),
    income({ netAgorot: 30000, vatAgorot: 5400, isCredit: true, docType: 'CREDIT_INVOICE', counterpartyVatId: '520000472' }),
    doc({ netAgorot: 50000, vatAgorot: 9000 }),
  ];
  const { content } = generate(documents);
  const header = content.split('\r\n')[0];

  // עסקאות חייבות: 1000 - 300 = 700 ש"ח, מע"מ 180 - 54 = 126
  assert.equal(header.slice(25, 37), '+00000000700', 'עסקאות חייבות');
  assert.equal(header.slice(37, 47), '+000000126', 'מע"מ עסקאות');
  assert.equal(header.slice(69, 78), '000000002', 'מספר רשומות עסקאות');
  // תשומות אחרות 90, סכום מדווח 126 - 90 = 36
  assert.equal(header.slice(90, 100), '+000000090', 'תשומות אחרות');
  assert.equal(header.slice(110, 119), '000000001', 'מספר רשומות תשומות');
  assert.equal(header.slice(119, 131), '+00000000036', 'סכום מדווח');
});

test('החזר מע"מ מופיע בכותרת בסימן שלילי', () => {
  const { content } = generate([
    income({ netAgorot: 10000, vatAgorot: 1800 }),
    doc({ netAgorot: 100000, vatAgorot: 18000 }),
  ]);
  const header = content.split('\r\n')[0];
  assert.equal(header.slice(119, 131), '-00000000162', 'החזר של 162 ש"ח');
});

test('הקובץ מכיל רק תווי ASCII — עברית תישבר בקליטה ברשות המסים', () => {
  const { content } = generate([income({ counterpartyName: 'לקוח בעברית' }), doc({ counterpartyName: 'ספק בעברית' })]);
  assert.ok(/^[\x20-\x7E\r\n]*$/.test(content), 'נמצאו תווים שאינם ASCII');
});

test('מספר אסמכתא ארוך מאוד לא מאבד דיוק — נלקחות 9 הספרות הימניות', () => {
  const line = buildTransactionLine({
    entryType: 'T',
    vatId: '520000472',
    invoiceDate: new Date('2026-07-15T00:00:00Z'),
    refGroup: '0',
    refNumber: '99999999999912345678',
    vatShekels: 0,
    netShekels: 0,
    allocationNumber: null,
  });
  assert.equal(line.slice(22, 31), '912345678');
});

test('ספירת הרשומות בכותרת תואמת בדיוק את מספר השורות בקובץ', () => {
  const documents = [
    income({ counterpartyVatId: '520000472' }),
    income({ counterpartyVatId: '514678150' }),
    income({ vatTreatment: 'NO_VAT', docType: 'RECEIPT', netAgorot: 5000, vatAgorot: 0 }),
    doc({ netAgorot: 10000, vatAgorot: 1800 }),
    doc({ docType: 'PETTY_CASH', netAgorot: 9000, vatAgorot: 1620, deductibleBp: 0 }),
    doc({ netAgorot: 20000, vatAgorot: 3600, inputKind: 'EQUIPMENT' }),
  ];
  const { content } = generate(documents);
  const lines = content.trimEnd().split('\r\n');
  const header = lines[0];
  const body = lines.slice(1, -1);

  const declaredSales = Number(header.slice(69, 78));
  const declaredInputs = Number(header.slice(110, 119));
  const actualSales = body.filter((l) => 'SLMYI'.includes(l[0])).length;
  const actualInputs = body.filter((l) => 'TKRPHC'.includes(l[0])).length;

  assert.equal(declaredSales, actualSales, 'ספירת עסקאות בכותרת מול השורות בפועל');
  assert.equal(declaredInputs, actualInputs, 'ספירת תשומות בכותרת מול השורות בפועל');
  assert.equal(actualSales, 2, 'קבלה ללא מע"מ אינה עסקה לצורך הדוח');
  assert.equal(actualInputs, 2, 'הוצאה בניכוי 0% אינה משתתפת בדוח');
});

test('הוצאה שלא נדרש בה מע"מ אינה מופיעה בקובץ כלל', () => {
  const { content } = generate([
    income({ counterpartyVatId: '520000472' }),
    doc({ docType: 'PETTY_CASH', netAgorot: 9000, vatAgorot: 1620, deductibleBp: 0, number: '999' }),
  ]);
  assert.ok(!content.includes('999'), 'המסמך שאינו משתתף לא נכתב לקובץ');
  assert.equal(content.trimEnd().split('\r\n').length, 3);
});
