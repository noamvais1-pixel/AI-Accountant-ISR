import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getActiveBusinessOrNull } from '@/lib/services/business';
import { Panel, Alert, Stat, Badge } from '@/components/ui';
import { buildVatReport } from '@/lib/reports/vat-report';
import { documentsRecognizedInRange } from '@/lib/services/recognition';
import { buildPeriod, periodForDate, periodsForYear, previousPeriod } from '@/lib/periods';
import { formatILS } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { PeriodActions } from './period-actions';

export const dynamic = 'force-dynamic';

function Row({ label, value, strong = false, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 px-5 py-2.5 ${strong ? 'font-semibold' : ''}`}>
      <div>
        <span className={strong ? '' : 'text-[var(--muted)]'}>{label}</span>
        {hint && <span className="mr-2 text-xs text-[var(--muted)]">{hint}</span>}
      </div>
      <span className="ltr-num tabular-nums">{value}</span>
    </div>
  );
}

export default async function VatReportPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const business = await getActiveBusinessOrNull();
  if (!business) {
    return (
      <Alert tone="info" title="לא הוגדר עסק">
        <Link href="/onboarding" className="underline">
          פתחי קודם את העסק שלך
        </Link>
        .
      </Alert>
    );
  }

  const params = await searchParams;
  const today = periodForDate(new Date(), business.vatFrequency);
  // ברירת המחדל היא התקופה הקודמת — זו שבפועל צריך לדווח עליה עכשיו.
  const defaultPeriod = previousPeriod(today, business.vatFrequency);
  const year = params.year ? Number(params.year) : defaultPeriod.year;
  const periodNo = params.period ? Number(params.period) : defaultPeriod.periodNo;
  const period = buildPeriod(year, periodNo, business.vatFrequency);

  // מסמך בתשלומים נכנס לדוח רק בחלק שחל בתקופה
  const documents = await documentsRecognizedInRange(business.id, period.startDate, period.endDate);

  const report = buildVatReport(period, documents);

  const periodRecord = await prisma.vatPeriod.findUnique({
    where: { businessId_year_periodNo: { businessId: business.id, year, periodNo } },
  });
  const status = periodRecord?.status ?? 'OPEN';
  const overdue = status !== 'FILED' && new Date() > period.dueDate;

  const yearOptions = [year + 1, year, year - 1, year - 2].filter((y, i, arr) => arr.indexOf(y) === i);
  const allPeriods = periodsForYear(year, business.vatFrequency);

  const errors = report.warnings.filter((w) => w.severity === 'error');
  const warnings = report.warnings.filter((w) => w.severity === 'warning');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">דוח מע"מ תקופתי</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {business.name} · ע.מ <span className="ltr-num">{business.vatId}</span> · דיווח{' '}
            {business.vatFrequency === 'MONTHLY' ? 'חודשי' : 'דו-חודשי'}
          </p>
        </div>
        <form className="flex items-end gap-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]" htmlFor="year">שנה</label>
            <select
              id="year"
              name="year"
              defaultValue={year}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm ltr-num"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]" htmlFor="period">תקופה</label>
            <select
              id="period"
              name="period"
              defaultValue={periodNo}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm"
            >
              {allPeriods.map((p) => (
                <option key={p.periodNo} value={p.periodNo}>{p.label}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-medium hover:bg-ink-100 dark:hover:bg-ink-800">
            הצגה
          </button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-5 py-3">
        <span className="text-sm font-medium">{period.label}</span>
        <span className="ltr-num text-xs text-[var(--muted)]">
          {formatDate(period.startDate)} – {formatDate(period.endDate)}
        </span>
        <span className="text-[var(--muted)]">·</span>
        <span className="text-xs text-[var(--muted)]">
          מועד הגשה מקוון: <span className="ltr-num">{formatDate(period.dueDate)}</span>
        </span>
        {status === 'FILED' && <Badge tone="green">דווח</Badge>}
        {status === 'CLOSED' && <Badge tone="blue">סגור</Badge>}
        {status === 'OPEN' && <Badge tone="gray">פתוח</Badge>}
        {overdue && <Badge tone="red">עבר מועד ההגשה</Badge>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="עסקאות חייבות" value={formatILS(report.taxableSalesNet)} hint={`${report.salesRecordCount} מסמכים`} />
        <Stat label="מע&quot;מ עסקאות" value={formatILS(report.taxableSalesVat)} />
        <Stat label="מע&quot;מ תשומות" value={formatILS(report.totalInputsVat)} hint={`${report.inputsRecordCount} מסמכים`} />
        <Stat
          label={report.vatDue >= 0 ? 'לתשלום לרשות המסים' : 'החזר מרשות המסים'}
          value={formatILS(Math.abs(report.vatDue))}
          tone={report.vatDue >= 0 ? 'negative' : 'positive'}
        />
      </div>

      {errors.length > 0 && (
        <Alert tone="error" title={`${errors.length} בעיות שימנעו הגשה תקינה`}>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {errors.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      {warnings.length > 0 && (
        <Alert tone="warning" title="נקודות לבדיקה">
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="צד העסקאות">
          <div className="divide-y divide-[var(--border)]">
            <Row label="עסקאות חייבות (לפני מע&quot;מ)" value={formatILS(report.taxableSalesNet)} />
            <Row label="מע&quot;מ על עסקאות חייבות" value={formatILS(report.taxableSalesVat)} />
            <Row label="עסקאות פטורות / בשיעור אפס" value={formatILS(report.zeroRatedSales)} />
            <Row label="סה&quot;כ מע&quot;מ עסקאות" value={formatILS(report.taxableSalesVat)} strong />
          </div>
        </Panel>

        <Panel title="צד התשומות">
          <div className="divide-y divide-[var(--border)]">
            <Row label="מע&quot;מ תשומות ציוד" value={formatILS(report.equipmentInputsVat)} />
            <Row label="מע&quot;מ תשומות אחרות" value={formatILS(report.otherInputsVat)} />
            <Row
              label="מע&quot;מ ששולם ולא נדרש"
              value={formatILS(report.nonDeductibleVat)}
              hint="ניכוי חלקי או הוצאה שאינה מוכרת"
            />
            <Row label="סה&quot;כ מע&quot;מ תשומות" value={formatILS(report.totalInputsVat)} strong />
          </div>
        </Panel>
      </div>

      <Panel title="סיכום">
        <div className="divide-y divide-[var(--border)]">
          <Row label="מע&quot;מ עסקאות" value={formatILS(report.taxableSalesVat)} />
          <Row label="בניכוי מע&quot;מ תשומות" value={formatILS(-report.totalInputsVat)} />
          <Row
            label={report.vatDue >= 0 ? 'סכום לתשלום' : 'סכום להחזר'}
            value={formatILS(Math.abs(report.vatDue))}
            strong
          />
        </div>
      </Panel>

      <PeriodActions
        year={year}
        periodNo={periodNo}
        status={status}
        hasErrors={errors.length > 0}
        downloadUrl={`/api/reports/pcn874?year=${year}&period=${periodNo}`}
      />
    </div>
  );
}
