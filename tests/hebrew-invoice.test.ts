import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHebrewInvoice, validateAmounts, detectDirection, stripBidi } from '../lib/parsers/hebrew-invoice';

const OWN = { ownVatId: '520000472', ownName: 'דנה כהן' };

/** קבלה של עוסק פטור — אין בה שורת מע"מ כלל. */
const EXEMPT_RECEIPT = `
                דנה כהן
                ייעוץ עסקי
                עוסק פטור 520000472
מקור                                    קבלה 50161
13/01/2026                              לכבוד:
                                        לקוחה ראשונה
                                        514678150
             ₪12,900.00   13/01/2026   אשראי
         ₪12,900.00        סה"כ
`;

const TAX_INVOICE = `
                דנה כהן
                עוסק מורשה 520000472
העתק נאמן למקור                    חשבונית מס קבלה 40062
10/03/2026                          לכבוד:
                                    לקוחה שנייה
                                    300000007
             ₪166.95   ₪166.95   שירות לדוגמה   1
             ₪166.95      סה"כ
              ₪30.05    מע"מ 18%
        ₪197.00      סה"כ לתשלום
`;

const CREDIT = `
                דנה כהן
                עוסק מורשה 520000472
מקור                                חשבונית זיכוי 60000
09/03/2026                          לכבוד:
                                    לקוחה שלי שית
                                    012345674
             ₪166.95      סה"כ
              ₪30.05    מע"מ 18%
         ₪197.00      סה"כ לזיכוי
`;

/** חשבונית שהתקבלה מספק — שם העסק מופיע אחרי "לכבוד", לא לפניו. */
const SUPPLIER_INVOICE = `
                ספק לדוגמה בע"מ
                ח.פ 514678150
חשבונית מס קבלה 7049
05/04/2026                          לכבוד:
                                    דנה כהן
                                    520000472
             ₪100.00      סה"כ
              ₪18.00    מע"מ 18%
        ₪118.00      סה"כ לתשלום
`;

test('קבלה ללא שורת מע"מ נרשמת ללא מע"מ, לא עם מע"מ מחושב', () => {
  const r = parseHebrewInvoice(EXEMPT_RECEIPT, OWN);
  assert.ok(r);
  assert.equal(r.documentKind, 'RECEIPT');
  assert.equal(r.netAmount, 12900);
  assert.equal(r.vatAmount, 0, 'אסור להמציא מע"מ במסמך שאינו מזכיר אותו');
  assert.equal(r.totalAmount, 12900, 'הסה"כ שווה לסכום, בלי תוספת');
  assert.ok(r.warnings.some((w) => w.includes('אינו מזכיר מע"מ')));
});

test('חשבונית מס נקראת במלואה', () => {
  const r = parseHebrewInvoice(TAX_INVOICE, OWN);
  assert.ok(r);
  assert.equal(r.documentKind, 'TAX_INVOICE_RECEIPT');
  assert.equal(r.documentNumber, '40062');
  assert.equal(r.issueDate, '2026-03-10');
  assert.equal(r.netAmount, 166.95);
  assert.equal(r.vatAmount, 30.05);
  assert.equal(r.totalAmount, 197);
  assert.equal(r.vatRatePercent, 18);
  assert.equal(r.counterpartyName, 'לקוחה שנייה');
  assert.equal(r.counterpartyVatId, '300000007');
  assert.equal(r.direction, 'INCOME');
  assert.equal(validateAmounts(r), null);
});

test('חשבונית זיכוי מזוהה ומסומנת', () => {
  const r = parseHebrewInvoice(CREDIT, OWN);
  assert.ok(r);
  assert.equal(r.documentKind, 'CREDIT_INVOICE');
  assert.equal(r.isCredit, true);
  assert.equal(r.totalAmount, 197, 'סה"כ לזיכוי נקרא כמו סה"כ לתשלום');
  assert.equal(validateAmounts(r), null);
});

test('חשבונית מספק מזוהה כהוצאה ולא כהכנסה', () => {
  const r = parseHebrewInvoice(SUPPLIER_INVOICE, OWN);
  assert.ok(r);
  assert.equal(r.direction, 'EXPENSE', 'שם העסק אחרי "לכבוד" משמעו שהוא הלקוח');
  assert.equal(r.counterpartyVatId, null, 'ע.מ של העסק עצמו אינו הצד השני');
});

test('הכיוון נקבע לפי המיקום ביחס ל"לכבוד", לא לפי עצם הופעת המספר', () => {
  assert.equal(detectDirection(TAX_INVOICE, OWN.ownVatId, OWN.ownName), 'INCOME');
  assert.equal(detectDirection(SUPPLIER_INVOICE, OWN.ownVatId, OWN.ownName), 'EXPENSE');
});

test('אימות תופס סכומים שאינם מסתדרים', () => {
  const r = parseHebrewInvoice(TAX_INVOICE, OWN)!;
  assert.ok(validateAmounts({ ...r, totalAmount: 500 }), 'סה"כ שגוי חייב להיתפס');
  assert.ok(validateAmounts({ ...r, vatAmount: 99 }), 'מע"מ שאינו תואם את השיעור חייב להיתפס');
});

test('טקסט ריק או קצר מדי לא מפוענח', () => {
  assert.equal(parseHebrewInvoice('', OWN), null);
  assert.equal(parseHebrewInvoice('שלום', OWN), null);
});

test('סימני כיווניות מוסרים', () => {
  assert.equal(stripBidi('‫שלום‬'), 'שלום');
});

test('שם עם רווח שנשתל על ידי pdftotext נשמר כפי שהוא, בלי תיקון מנחש', () => {
  const r = parseHebrewInvoice(CREDIT, OWN);
  assert.equal(r?.counterpartyName, 'לקוחה שלי שית');
});
