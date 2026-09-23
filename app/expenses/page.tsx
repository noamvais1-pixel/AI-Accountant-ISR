import { prisma } from '@/lib/db';
import { getActiveBusinessOrNull } from '@/lib/services/business';
import { Panel, Alert, Stat } from '@/components/ui';
import { DocumentTable } from '@/components/document-table';
import { ScanUploader } from './scan-uploader';
import { DraftCard } from './draft-card';
import { ManualEntryToggle } from './manual-entry';
import { formatILS } from '@/lib/money';
import { buildPeriod, periodForDate } from '@/lib/periods';
import { PeriodPicker, readPeriodParams } from '@/components/period-picker';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const business = await getActiveBusinessOrNull();
  if (!business) {
    return (
      <Alert tone="info" title="לא הוגדר עסק">
        <Link href="/settings" className="underline">
          הזיני קודם את פרטי העסק
        </Link>{' '}
        כדי להתחיל לקלוט הוצאות.
      </Alert>
    );
  }

  const params = await searchParams;
  const current = periodForDate(new Date(), business.vatFrequency);
  const { year, periodNo } = readPeriodParams(params, current);
  const periodLabel = periodNo
    ? buildPeriod(year, periodNo, business.vatFrequency).label
    : `כל שנת ${year}`;

  const drafts = await prisma.document.findMany({
    where: { businessId: business.id, direction: 'EXPENSE', status: 'DRAFT' },
    orderBy: { createdAt: 'desc' },
  });

  const confirmed = await prisma.document.findMany({
    where: {
      businessId: business.id,
      direction: 'EXPENSE',
      status: { not: 'DRAFT' },
      // בלי תקופה מסוימת מציגים את כל השנה
      vatPeriod: periodNo ? { year, periodNo } : { year },
    },
    orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
  });

  const totals = confirmed.reduce(
    (acc, doc) => {
      if (doc.status === 'VOID') return acc;
      const s = doc.isCredit ? -1 : 1;
      acc.net += s * doc.netAgorot;
      acc.deductibleVat += s * doc.deductibleVatAgorot;
      acc.total += s * doc.totalAgorot;
      return acc;
    },
    { net: 0, deductibleVat: 0, total: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">הוצאות</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            קליטת קבלות וחשבוניות ספקים. כל מסמך שנסרק ממתין לאישור לפני שהוא נכנס לספרים.
          </p>
        </div>
        <ManualEntryToggle />
      </div>

      <ScanUploader />

      {drafts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">
            ממתינים לאישור <span className="text-[var(--muted)]">({drafts.length})</span>
          </h2>
          {drafts.map((draft) => (
            <DraftCard key={draft.id} document={draft} />
          ))}
        </section>
      )}

      <PeriodPicker
        year={year}
        periodNo={periodNo}
        frequency={business.vatFrequency}
        action="/expenses"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="הוצאות לפני מע&quot;מ" value={formatILS(totals.net)} />
        <Stat label="מע&quot;מ תשומות מוכר" value={formatILS(totals.deductibleVat)} tone="brand" />
        <Stat label="סה&quot;כ ששולם" value={formatILS(totals.total)} />
      </div>

      <Panel title={`הוצאות מאושרות — ${periodLabel}`}>
        <DocumentTable documents={confirmed} direction="EXPENSE" />
      </Panel>
    </div>
  );
}
