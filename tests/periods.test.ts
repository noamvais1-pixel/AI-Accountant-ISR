import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPeriod, periodForDate, pcnReportMonth, previousPeriod, periodsForYear } from '../lib/periods';

test('תקופה דו-חודשית מכסה שני חודשים מלאים', () => {
  const p = buildPeriod(2026, 1, 'BIMONTHLY');
  assert.equal(p.startDate.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(p.endDate.toISOString(), '2026-02-28T23:59:59.999Z');
  assert.equal(p.label, 'ינואר–פברואר 2026');
});

test('פברואר בשנה מעוברת נכלל עד ה-29', () => {
  const p = buildPeriod(2028, 1, 'BIMONTHLY');
  assert.equal(p.endDate.toISOString(), '2028-02-29T23:59:59.999Z');
});

test('שיוך תאריך לתקופה דו-חודשית', () => {
  assert.equal(periodForDate(new Date('2026-08-24T00:00:00Z'), 'BIMONTHLY').periodNo, 4);
  assert.equal(periodForDate(new Date('2026-08-24T00:00:00Z'), 'BIMONTHLY').label, 'יולי–אוגוסט 2026');
  assert.equal(periodForDate(new Date('2026-01-01T00:00:00Z'), 'BIMONTHLY').periodNo, 1);
  assert.equal(periodForDate(new Date('2026-12-31T00:00:00Z'), 'BIMONTHLY').periodNo, 6);
});

test('שיוך תאריך לתקופה חודשית', () => {
  assert.equal(periodForDate(new Date('2026-08-24T00:00:00Z'), 'MONTHLY').periodNo, 8);
  assert.equal(periodForDate(new Date('2026-08-24T00:00:00Z'), 'MONTHLY').label, 'אוגוסט 2026');
});

test('מועד ההגשה הוא ה-23 בחודש שאחרי תום התקופה', () => {
  assert.equal(buildPeriod(2026, 4, 'BIMONTHLY').dueDate.toISOString().slice(0, 10), '2026-09-23');
  assert.equal(buildPeriod(2026, 6, 'BIMONTHLY').dueDate.toISOString().slice(0, 10), '2027-01-23', 'סוף שנה גולש לשנה הבאה');
});

test('התקופה הקודמת חוצה גבול שנה נכון', () => {
  const first = buildPeriod(2026, 1, 'BIMONTHLY');
  const prev = previousPeriod(first, 'BIMONTHLY');
  assert.equal(prev.year, 2025);
  assert.equal(prev.periodNo, 6);
  assert.equal(prev.label, 'נובמבר–דצמבר 2025');
});

test('reportMonth בקובץ PCN הוא החודש האחרון בתקופה', () => {
  assert.equal(pcnReportMonth(buildPeriod(2026, 4, 'BIMONTHLY')), '202608');
  assert.equal(pcnReportMonth(buildPeriod(2026, 8, 'MONTHLY')), '202608');
});

test('שנה דו-חודשית מכילה 6 תקופות רציפות בלי חורים', () => {
  const periods = periodsForYear(2026, 'BIMONTHLY');
  assert.equal(periods.length, 6);
  for (let i = 1; i < periods.length; i++) {
    const gapMs = periods[i].startDate.getTime() - periods[i - 1].endDate.getTime();
    assert.equal(gapMs, 1, 'אין חור בין תקופות');
  }
});

test('תקופה מחוץ לטווח נדחית', () => {
  assert.throws(() => buildPeriod(2026, 7, 'BIMONTHLY'));
  assert.throws(() => buildPeriod(2026, 13, 'MONTHLY'));
});
