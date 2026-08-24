import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveFileName, driveFolderPath } from '../lib/drive/backup';
import { sanitizeName } from '../lib/drive/client';
import { doc, income } from './helpers';

test('שם הקובץ בדרייב ניתן לחיפוש: תאריך, ספק, מספר וסכום', () => {
  const name = driveFileName(
    doc({
      issueDate: new Date('2026-07-12T00:00:00Z'),
      counterpartyName: 'מרכז הדפוס הדיגיטלי בע"מ',
      number: '2026-4471',
      totalAgorot: 388220,
      fileMime: 'image/png',
    }),
  );
  assert.equal(name, '2026-07-12 מרכז הדפוס הדיגיטלי בע-מ 2026-4471 3882.20.png');
});

test('חשבונית זיכוי מסומנת בשם הקובץ', () => {
  const name = driveFileName(
    doc({ isCredit: true, counterpartyName: 'ספק', number: '9', totalAgorot: 11800, fileMime: 'application/pdf' }),
  );
  assert.ok(name.includes('זיכוי'));
  assert.ok(name.endsWith('.pdf'));
});

test('סוג קובץ לא מוכר לא מוסיף סיומת שגויה', () => {
  const name = driveFileName(doc({ fileMime: null, number: '5', totalAgorot: 100 }));
  assert.ok(!name.includes('undefined'));
  assert.ok(!/\.$/.test(name));
});

test('תווים ששוברים שמות קבצים מנוטרלים, עברית נשמרת', () => {
  assert.equal(sanitizeName('חשבונית 7/2026: א*ב?'), 'חשבונית 7-2026- א-ב-');
  assert.equal(sanitizeName('  רווח   כפול  '), 'רווח כפול');
  assert.equal(sanitizeName('///'), '---');
  assert.equal(sanitizeName('   '), 'ללא-שם');
});

test('שם ארוך במיוחד נחתך ולא שובר את ההעלאה', () => {
  assert.ok(sanitizeName('א'.repeat(500)).length <= 120);
});

test('נתיב התיקיות בדרייב לפי שנה, תקופת דיווח וכיוון', () => {
  assert.deepEqual(
    driveFolderPath(doc({ reportDate: new Date('2026-07-12T00:00:00Z'), direction: 'EXPENSE' }), 'BIMONTHLY'),
    ['2026', '04 יולי–אוגוסט 2026', 'הוצאות'],
  );
  assert.deepEqual(
    driveFolderPath(income({ reportDate: new Date('2026-01-05T00:00:00Z') }), 'BIMONTHLY'),
    ['2026', '01 ינואר–פברואר 2026', 'הכנסות'],
  );
});

test('דיווח חודשי מייצר תיקייה לכל חודש', () => {
  assert.deepEqual(
    driveFolderPath(doc({ reportDate: new Date('2026-08-24T00:00:00Z'), direction: 'EXPENSE' }), 'MONTHLY'),
    ['2026', '08 אוגוסט 2026', 'הוצאות'],
  );
});

test('התיקיות ממוינות נכון אלפביתית — אפס מוביל במספר התקופה', () => {
  const names = [1, 2, 10, 11].map(
    (m) => driveFolderPath(doc({ reportDate: new Date(Date.UTC(2026, m - 1, 5)) }), 'MONTHLY')[1],
  );
  assert.deepEqual([...names].sort(), names, 'סדר אלפביתי = סדר כרונולוגי');
});
