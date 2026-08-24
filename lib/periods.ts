/**
 * תקופות דיווח מע"מ.
 * בדיווח דו-חודשי התקופות הן ינו-פבר, מרץ-אפר, מאי-יוני, יולי-אוג, ספט-אוק, נוב-דצמ.
 * מועד ההגשה: ה-15 בחודש שאחרי סוף התקופה (23 בחודש בהגשה מקוונת).
 */

export type VatFrequency = 'MONTHLY' | 'BIMONTHLY';

export type Period = {
  year: number;
  periodNo: number; // 1..12 בחודשי, 1..6 בדו-חודשי
  startDate: Date;
  endDate: Date; // כולל — סוף היום האחרון
  label: string;
  dueDate: Date; // מועד ההגשה המקוונת (ה-23 בחודש העוקב)
};

const MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

/** תאריך UTC בחצות — כל התאריכים במערכת נשמרים כך כדי שאזור זמן לא יזיז חודש. */
export function utcDate(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day, 0, 0, 0, 0));
}

/** סוף היום האחרון של החודש, ב-UTC. */
function endOfMonth(year: number, month1: number): Date {
  return new Date(Date.UTC(year, month1, 0, 23, 59, 59, 999));
}

export function periodsPerYear(frequency: VatFrequency): number {
  return frequency === 'MONTHLY' ? 12 : 6;
}

/** בונה את התקופה מספר N בשנה נתונה. */
export function buildPeriod(year: number, periodNo: number, frequency: VatFrequency): Period {
  const perYear = periodsPerYear(frequency);
  if (periodNo < 1 || periodNo > perYear) {
    throw new Error(`תקופה ${periodNo} אינה קיימת בדיווח ${frequency === 'MONTHLY' ? 'חודשי' : 'דו-חודשי'}`);
  }

  const monthsInPeriod = frequency === 'MONTHLY' ? 1 : 2;
  const startMonth = (periodNo - 1) * monthsInPeriod + 1;
  const endMonth = startMonth + monthsInPeriod - 1;

  const startDate = utcDate(year, startMonth, 1);
  const endDate = endOfMonth(year, endMonth);

  const label =
    frequency === 'MONTHLY'
      ? `${MONTH_NAMES[startMonth - 1]} ${year}`
      : `${MONTH_NAMES[startMonth - 1]}–${MONTH_NAMES[endMonth - 1]} ${year}`;

  // ההגשה המקוונת עד ה-23 בחודש שאחרי תום התקופה.
  const dueMonth = endMonth === 12 ? 1 : endMonth + 1;
  const dueYear = endMonth === 12 ? year + 1 : year;
  const dueDate = utcDate(dueYear, dueMonth, 23);

  return { year, periodNo, startDate, endDate, label, dueDate };
}

/** התקופה שאליה משתייך תאריך נתון. */
export function periodForDate(date: Date, frequency: VatFrequency): Period {
  const year = date.getUTCFullYear();
  const month1 = date.getUTCMonth() + 1;
  const periodNo = frequency === 'MONTHLY' ? month1 : Math.ceil(month1 / 2);
  return buildPeriod(year, periodNo, frequency);
}

/** כל תקופות השנה. */
export function periodsForYear(year: number, frequency: VatFrequency): Period[] {
  return Array.from({ length: periodsPerYear(frequency) }, (_, i) => buildPeriod(year, i + 1, frequency));
}

/** התקופה הקודמת — בדרך כלל זו שצריך לדווח עליה עכשיו. */
export function previousPeriod(period: Period, frequency: VatFrequency): Period {
  const perYear = periodsPerYear(frequency);
  return period.periodNo === 1
    ? buildPeriod(period.year - 1, perYear, frequency)
    : buildPeriod(period.year, period.periodNo - 1, frequency);
}

/** מזהה התקופה בפורמט שדורש קובץ PCN874 — YYYYMM של החודש האחרון בתקופה. */
export function pcnReportMonth(period: Period): string {
  const y = period.endDate.getUTCFullYear();
  const m = String(period.endDate.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}
