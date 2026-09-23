import { periodsForYear, type VatFrequency } from '@/lib/periods';

/**
 * בורר תקופת דיווח.
 *
 * טופס GET רגיל ולא רכיב לקוח: הבחירה נשמרת בכתובת, כך שאפשר לשמור קישור
 * לתקופה מסוימת, לרענן בלי לאבד אותה, ולחזור אליה בכפתור "חזרה" של הדפדפן.
 */
export function PeriodPicker({
  year,
  periodNo,
  frequency,
  action,
}: {
  year: number;
  /** null = כל השנה */
  periodNo: number | null;
  frequency: VatFrequency;
  action: string;
}) {
  const thisYear = new Date().getUTCFullYear();
  const years = Array.from({ length: 5 }, (_, i) => thisYear + 1 - i);
  if (!years.includes(year)) years.push(year);
  years.sort((a, b) => b - a);

  const periods = periodsForYear(year, frequency);
  const field =
    'rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]" htmlFor="year">
          שנה
        </label>
        <select id="year" name="year" defaultValue={year} className={field}>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]" htmlFor="period">
          תקופה
        </label>
        <select id="period" name="period" defaultValue={periodNo ?? 'all'} className={field}>
          <option value="all">כל השנה</option>
          {periods.map((p) => (
            <option key={p.periodNo} value={p.periodNo}>{p.label}</option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium transition-colors hover:bg-ink-100 dark:hover:bg-ink-800"
      >
        הצגה
      </button>
    </form>
  );
}

/** קריאת הבחירה מהכתובת, עם נפילה לתקופה הנוכחית. */
export function readPeriodParams(
  params: { year?: string; period?: string },
  fallback: { year: number; periodNo: number },
): { year: number; periodNo: number | null } {
  const year = params.year ? Number(params.year) : fallback.year;
  if (params.period === 'all') return { year, periodNo: null };
  // תמיכה גם בפורמט הישן "YYYY-N" שהיה בקישורים קודמים
  if (params.period?.includes('-')) {
    const [y, p] = params.period.split('-').map(Number);
    return { year: y || year, periodNo: p || fallback.periodNo };
  }
  const periodNo = params.period ? Number(params.period) : fallback.periodNo;
  return { year: Number.isFinite(year) ? year : fallback.year, periodNo };
}
