import Link from 'next/link';
import { getActiveBusinessOrNull } from '@/lib/services/business';
import { Panel, Alert, Stat, Badge, EmptyState } from '@/components/ui';
import { formatILS } from '@/lib/money';
import { buildPeriod, periodForDate } from '@/lib/periods';
import { PeriodPicker, readPeriodParams } from '@/components/period-picker';
import { documentsRecognizedInRange } from '@/lib/services/recognition';
import { formatDate, DOC_TYPE_LABELS, SOURCE_LABELS } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * פירוט העסקאות החייבות — בדיוק השורות שמרכיבות את המספר בכרטיס.
 *
 * מסמך בתשלומים מופיע כאן פעם לכל תשלום שחל בתקופה, בסכום התשלום; מסמך
 * שמועד התשלום שלו שונה מתאריך ההפקה מופיע לפי מועד התשלום. לכן הסכום כאן
 * זהה לכרטיס, גם כשטבלת ההכנסות (לפי תאריך הפקה) מראה משהו אחר.
 */
export default async function TaxableSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const business = await getActiveBusinessOrNull();
  if (!business) {
    return (
      <Alert tone="info" title="לא הוגדר עסק">
        <Link href="/settings" className="underline">הזיני קודם את פרטי העסק</Link>.
      </Alert>
    );
  }

  const params = await searchParams;
  const current = periodForDate(new Date(), business.vatFrequency);
  const { year, periodNo } = readPeriodParams(params, current);
  const range = periodNo
    ? buildPeriod(year, periodNo, business.vatFrequency)
    : { startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) };
  const periodLabel = periodNo ? buildPeriod(year, periodNo, business.vatFrequency).label : `כל שנת ${year}`;

  const rows = (await documentsRecognizedInRange(business.id, range.startDate, range.endDate))
    .filter((d) => d.direction === 'INCOME' && d.status === 'CONFIRMED' && d.vatTreatment === 'STANDARD')
    .sort((a, b) => a.reportDate.getTime() - b.reportDate.getTime());

  const totals = rows.reduce(
    (acc, d) => {
      const s = d.isCredit ? -1 : 1;
      acc.net += s * d.netAgorot;
      acc.vat += s * d.vatAgorot;
      acc.total += s * d.totalAgorot;
      return acc;
    },
    { net: 0, vat: 0, total: 0 },
  );
  const fromCardcom = rows.filter((d) => d.source === 'CARDCOM').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">עסקאות חייבות — {periodLabel}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            השורות שמרכיבות את הסכום בכרטיס. מסמך בתשלומים מופיע פעם לכל תשלום שחל בתקופה, ומסמך
            מופיע לפי מועד התשלום ולא לפי תאריך ההפקה.
          </p>
        </div>
        <Link href={`/income?year=${year}&period=${periodNo ?? 'all'}`} className="text-sm underline">
          → חזרה להכנסות
        </Link>
      </div>

      <PeriodPicker year={year} periodNo={periodNo} frequency={business.vatFrequency} action="/income/taxable" />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="עסקאות חייבות" value={formatILS(totals.net)} hint={`${rows.length} שורות, ${fromCardcom} מקארדקום`} />
        <Stat label="מע&quot;מ עסקאות" value={formatILS(totals.vat)} tone="brand" />
        <Stat label="סה&quot;כ כולל מע&quot;מ" value={formatILS(totals.total)} />
      </div>

      <Panel title={`פירוט — ${periodLabel}`}>
        {rows.length === 0 ? (
          <EmptyState title="אין עסקאות חייבות בתקופה" description="סנכרני חשבוניות מקארדקום במסך ההכנסות." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-right text-xs text-[var(--muted)]">
                  <th className="px-4 py-2.5 font-medium">מועד תשלום</th>
                  <th className="px-4 py-2.5 font-medium">הופק</th>
                  <th className="px-4 py-2.5 font-medium">לקוח</th>
                  <th className="px-4 py-2.5 font-medium">מסמך</th>
                  <th className="px-4 py-2.5 font-medium">מקור</th>
                  <th className="px-4 py-2.5 text-left font-medium">לפני מע"מ</th>
                  <th className="px-4 py-2.5 text-left font-medium">מע"מ</th>
                  <th className="px-4 py-2.5 text-left font-medium">סה"כ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const s = d.isCredit ? -1 : 1;
                  // שורה של תשלום בודד נושאת מזהה "מסמך:מספר תשלום"
                  const seq = d.id.includes(':') ? Number(d.id.split(':')[1]) : null;
                  return (
                    <tr key={d.id} className="border-b border-[var(--border)] last:border-0 hover:bg-ink-50/60 dark:hover:bg-ink-900/40">
                      <td className="whitespace-nowrap px-4 py-2.5 ltr-num">{formatDate(d.reportDate)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 ltr-num text-[var(--muted)]">{formatDate(d.issueDate)}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{d.counterpartyName}</div>
                        {d.counterpartyVatId && <div className="ltr-num text-xs text-[var(--muted)]">{d.counterpartyVatId}</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-[var(--muted)]">{DOC_TYPE_LABELS[d.docType]}</span>
                          <span className="ltr-num text-xs">{d.number}</span>
                          {d.isCredit && <Badge tone="red">זיכוי</Badge>}
                          {seq !== null && d.installments && (
                            <Badge tone="blue">תשלום {seq} מתוך {d.installments}</Badge>
                          )}
                          {d.fileKey && (
                            <a
                              href={`/api/files/${d.fileKey}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] hover:bg-ink-100 dark:hover:bg-ink-800"
                            >
                              צפייה במסמך
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={d.source === 'CARDCOM' ? 'green' : 'gray'}>{SOURCE_LABELS[d.source] ?? d.source}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-left ltr-num">{formatILS(s * d.netAgorot)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-left ltr-num text-[var(--muted)]">{formatILS(s * d.vatAgorot)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-left ltr-num font-semibold">{formatILS(s * d.totalAgorot)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border)] bg-ink-50/60 font-semibold dark:bg-ink-900/40">
                  <td className="px-4 py-2.5" colSpan={5}>סה"כ ({rows.length} שורות)</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-left ltr-num">{formatILS(totals.net)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-left ltr-num">{formatILS(totals.vat)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-left ltr-num">{formatILS(totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
