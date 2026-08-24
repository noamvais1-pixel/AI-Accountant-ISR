import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getActiveBusinessOrNull } from '@/lib/services/business';
import { getInvoiceProvider } from '@/lib/invoicing';
import { Panel, Alert, Stat } from '@/components/ui';
import { DocumentTable } from '@/components/document-table';
import { SyncPanel } from './sync-panel';
import { formatILS } from '@/lib/money';
import { periodForDate } from '@/lib/periods';
import { toDateInputValue } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function IncomePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const business = await getActiveBusinessOrNull();
  if (!business) {
    return (
      <Alert tone="info" title="לא הוגדר עסק">
        <Link href="/settings" className="underline">
          הזיני קודם את פרטי העסק
        </Link>
        .
      </Alert>
    );
  }

  const { period: periodParam } = await searchParams;
  const current = periodForDate(new Date(), business.vatFrequency);
  const [year, periodNo] = periodParam ? periodParam.split('-').map(Number) : [current.year, current.periodNo];

  const documents = await prisma.document.findMany({
    where: { businessId: business.id, direction: 'INCOME', vatPeriod: { year, periodNo } },
    orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
  });

  const totals = documents.reduce(
    (acc, doc) => {
      if (doc.status !== 'CONFIRMED') return acc;
      const s = doc.isCredit ? -1 : 1;
      if (doc.vatTreatment === 'STANDARD') {
        acc.net += s * doc.netAgorot;
        acc.vat += s * doc.vatAgorot;
      } else if (doc.vatTreatment !== 'NO_VAT') {
        acc.exempt += s * doc.netAgorot;
      }
      return acc;
    },
    { net: 0, vat: 0, exempt: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">הכנסות</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            חשבוניות המס שהופקו. נמשכות אוטומטית מקארדקום.
          </p>
        </div>
        <Link
          href="/invoices/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          הפקת חשבונית חדשה
        </Link>
      </div>

      <SyncPanel
        configured={getInvoiceProvider().isConfigured()}
        defaultFrom={toDateInputValue(current.startDate)}
        defaultTo={toDateInputValue(new Date())}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="עסקאות חייבות בתקופה" value={formatILS(totals.net)} />
        <Stat label="מע&quot;מ עסקאות" value={formatILS(totals.vat)} tone="brand" />
        <Stat label="עסקאות פטורות / אפס" value={formatILS(totals.exempt)} />
      </div>

      <Panel title={`הכנסות — תקופה ${periodNo}/${year}`}>
        <DocumentTable documents={documents} direction="INCOME" />
      </Panel>
    </div>
  );
}
