import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCardcomDocumentLines, paymentsTotal } from '../lib/parsers/cardcom-document';

const iso = (d: Date) => d.toISOString().slice(0, 10);

test('מסמך ששולם בשלושה חלקים: כל תשלום עם תאריך וסכום, ממוין לפי תאריך', () => {
  const r = parseCardcomDocumentLines([
    'חשבונית מס קבלה 40332',
    'תאריך',
    '00:07 24/09/2026',
    'אופן התשלום:',
    '₪12,000.00 הפקדה בנקאית',
    '₪5,900.00 חיוב/זיכוי לקוחות',
    'פירוט',
    '‫תיאור חיוב/זיכוי לקוחות | אסמכתא | תאריך ‪01/09/2026‬ | סכום ₪5,900.00',
    'תיאור הפקדה בנקאית | אסמכתא | תאריך 14/07/2026 | סכום ₪5,000.00',
    'תיאור הפקדה בנקאית | אסמכתא | תאריך 20/07/2026 | סכום ₪7,000.00',
  ]);
  assert.deepEqual(r.payments.map((p) => [iso(p.date), p.amountAgorot, p.method]), [
    ['2026-07-14', 500000, 'הפקדה בנקאית'],
    ['2026-07-20', 700000, 'הפקדה בנקאית'],
    ['2026-09-01', 590000, 'חיוב/זיכוי לקוחות'],
  ]);
  assert.equal(paymentsTotal(r.payments), 1790000);
  assert.equal(r.reversesNumber, null);
});

test('הפקדה בנקאית עם אסמכתא: התאריך במסמך גובר על תאריך ההפקה', () => {
  const r = parseCardcomDocumentLines([
    '21:36 27/07/2026',
    'תיאור הפקדה בנקאית | אסמכתא 99010330 | תאריך 24/06/2026 | סכום ₪1,575.00',
  ]);
  assert.equal(r.payments.length, 1);
  assert.equal(iso(r.payments[0].date), '2026-06-24');
  assert.equal(r.payments[0].reference, '99010330');
});

test('חשבונית זיכוי: מספר המסמך המבוטל, ושורת האשראי עם מספר תשלומים', () => {
  const r = parseCardcomDocumentLines([
    'מסמך זה מבטל מסמך מקורי - חשבונית מס קבלה, מספר: 40284',
    '₪16,880.00 כרטיס אשראי',
    'תאריך 15/09/2026 | כרטיס 8649 | אופן חיוב תשלומים | מספר תשלומים 1 | סכום ₪16,880.00 עסקה מספר 262921683',
  ]);
  assert.equal(r.reversesNumber, 40284);
  assert.equal(r.cardInstallments, 1);
  assert.deepEqual(r.payments.map((p) => [iso(p.date), p.amountAgorot, p.method]), [['2026-09-15', 1688000, 'כרטיס אשראי']]);
});

test('שורת תאריך ההפקה בלבד אינה תשלום', () => {
  const r = parseCardcomDocumentLines(['תאריך', '00:07 24/09/2026', 'סה"כ שקל ₪17,900.00']);
  assert.equal(r.payments.length, 0);
});
