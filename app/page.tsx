import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getActiveBusinessOrNull } from '@/lib/services/business';
import { Panel, Alert, Stat, Badge, EmptyState } from '@/components/ui';
import { buildVatReport } from '@/lib/reports/vat-report';
import { documentsRecognizedInRange } from '@/lib/services/recognition';
import { periodForDate, previousPeriod } from '@/lib/periods';
import { formatILS } from '@/lib/money';
import { formatDate, DOC_TYPE_LABELS } from '@/lib/format';

export const dynamic = 'force-dynamic';

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

export default async function DashboardPage() {
  const business = await getActiveBusinessOrNull();

  // בלי עסק אין מה להציג — הכניסה הראשונה מתחילה בפתיחת העסק
  if (!business) redirect('/onboarding');

  const current = periodForDate(new Date(), business.vatFrequency);
  const reporting = previousPeriod(current, business.vatFrequency);

  const [currentDocs, reportingDocs, drafts, recent] = await Promise.all([
    documentsRecognizedInRange(business.id, current.startDate, current.endDate),
    documentsRecognizedInRange(business.id, reporting.startDate, reporting.endDate),
    prisma.document.count({ where: { businessId: business.id, status: 'DRAFT' } }),
    prisma.document.findMany({
      where: { businessId: business.id, status: { not: 'DRAFT' } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
  ]);

  const currentReport = buildVatReport(current, currentDocs);
  const taxableHref = `/income/taxable?year=${current.year}&period=${current.periodNo}`;
  const reportingReport = buildVatReport(reporting, reportingDocs);

  const reportingPeriodRecord = await prisma.vatPeriod.findUnique({
    where: { businessId_year_periodNo: { businessId: business.id, year: reporting.year, periodNo: reporting.periodNo } },
  });
  const filed = reportingPeriodRecord?.status === 'FILED';
  const days = daysUntil(reporting.dueDate);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{business.name}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          ע.מ <span className="ltr-num">{business.vatId}</span> · דיווח{' '}
          {business.vatFrequency === 'MONTHLY' ? 'חודשי' : 'דו-חודשי'}
        </p>
      </div>

      {!filed && (
        <Alert tone={days < 0 ? 'error' : days <= 7 ? 'warning' : 'info'} title={`דיווח ${reporting.label}`}>
          {days < 0
            ? `מועד ההגשה חלף לפני ${Math.abs(days)} ימים (${formatDate(reporting.dueDate)}).`
            : `יש להגיש עד ${formatDate(reporting.dueDate)} — נותרו ${days} ימים.`}{' '}
          הסכום המחושב: <strong className="ltr-num">{formatILS(Math.abs(reportingReport.vatDue))}</strong>{' '}
          {reportingReport.vatDue >= 0 ? 'לתשלום' : 'להחזר'}.{' '}
          <Link href={`/reports/vat?year=${reporting.year}&period=${reporting.periodNo}`} className="underline">
            למסך הדוח
          </Link>
        </Alert>
      )}

      {drafts > 0 && (
        <Alert tone="warning">
          {drafts} מסמכים שנסרקו ממתינים לאישור ואינם נכללים בדוחות.{' '}
          <Link href="/expenses" className="underline">
            לאישור
          </Link>
        </Alert>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-[var(--muted)]">התקופה הנוכחית — {current.label}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="עסקאות חייבות" value={formatILS(currentReport.taxableSalesNet)} href={taxableHref} />
          <Stat label="מע&quot;מ עסקאות" value={formatILS(currentReport.taxableSalesVat)} href={taxableHref} />
          <Stat label="מע&quot;מ תשומות" value={formatILS(currentReport.totalInputsVat)} />
          <Stat
            label={currentReport.vatDue >= 0 ? 'צפי לתשלום' : 'צפי להחזר'}
            value={formatILS(Math.abs(currentReport.vatDue))}
            tone={currentReport.vatDue >= 0 ? 'negative' : 'positive'}
            hint="מצטבר, התקופה עוד פתוחה"
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="מסמכים אחרונים">
          {recent.length === 0 ? (
            <EmptyState title="אין עדיין מסמכים" description="צלמי קבלה במסך ההוצאות, או סנכרני חשבוניות מקארדקום." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {recent.map((doc) => {
                const s = doc.isCredit ? -1 : 1;
                return (
                  <li key={doc.id} className="flex items-center justify-between gap-4 px-5 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{doc.counterpartyName}</span>
                        <Badge tone={doc.direction === 'INCOME' ? 'green' : 'gray'}>
                          {doc.direction === 'INCOME' ? 'הכנסה' : 'הוצאה'}
                        </Badge>
                        {doc.isCredit && <Badge tone="red">זיכוי</Badge>}
                      </div>
                      <div className="ltr-num text-xs text-[var(--muted)]">
                        {formatDate(doc.issueDate)} · {DOC_TYPE_LABELS[doc.docType]} {doc.number}
                      </div>
                    </div>
                    <span className="whitespace-nowrap ltr-num font-medium">{formatILS(s * doc.totalAgorot)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="פעולות">
          <div className="flex flex-col gap-2 p-4 text-sm">
            <Link href="/expenses" className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-center font-medium hover:bg-ink-100 dark:hover:bg-ink-800">
              צילום קבלה
            </Link>
            <Link href="/invoices/new" className="rounded-lg bg-brand-600 px-4 py-2.5 text-center font-medium text-white hover:bg-brand-700">
              הפקת חשבונית
            </Link>
            <Link href="/income" className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-center font-medium hover:bg-ink-100 dark:hover:bg-ink-800">
              סנכרון מקארדקום
            </Link>
            <Link href="/reports/vat" className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-center font-medium hover:bg-ink-100 dark:hover:bg-ink-800">
              דוח מע"מ
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}
