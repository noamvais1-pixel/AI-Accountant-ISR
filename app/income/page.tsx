import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getActiveBusinessOrNull } from '@/lib/services/business';
import { getInvoiceProvider } from '@/lib/invoicing';
import { Panel, Alert, Stat } from '@/components/ui';
import { DocumentTable } from '@/components/document-table';
import { SyncPanel } from './sync-panel';
import { formatILS } from '@/lib/money';
import { buildPeriod, periodForDate } from '@/lib/periods';
import { PeriodPicker, readPeriodParams } from '@/components/period-picker';
import { documentsRecognizedInRange } from '@/lib/services/recognition';
import { toDateInputValue } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function IncomePage({ searchParams }: { searchParams: Promise<{ year?: string; period?: string }> }) {
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

  const params = await searchParams;
  const current = periodForDate(new Date(), business.vatFrequency);
  const { year, periodNo } = readPeriodParams(params, current);
  const range = periodNo
    ? buildPeriod(year, periodNo, business.vatFrequency)
    : { startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) };
  // הכרטיסים מסכמים סכומים מוכרים — מסמך בתשלומים תורם רק את התשלומים שחלים בטווח.
  // הטבלה למטה מציגה מסמכים לפי תאריך ההפקה, ולכן שני המספרים יכולים להיבדל.
  const recognized = await documentsRecognizedInRange(business.id, range.startDate, range.endDate);
  const periodLabel = periodNo
    ? buildPeriod(year, periodNo, business.vatFrequency).label
    : `כל שנת ${year}`;

  const documents = await prisma.document.findMany({
    where: {
      businessId: business.id,
      direction: 'INCOME',
      vatPeriod: periodNo ? { year, periodNo } : { year },
    },
    orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
    include: { reverses: { select: { number: true } } },
  });

  const pendingCount = documents.filter((d) => d.status === 'DRAFT').length;

  const totals = recognized.filter((d) => d.direction === 'INCOME').reduce(
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
        // מתחילת השנה: הסנכרון בטוח לחזרה, ותקופה בודדת מפספסת חשבוניות שנוספו באיחור
        defaultFrom={toDateInputValue(new Date(Date.UTC(current.year, 0, 1)))}
        defaultTo={toDateInputValue(new Date())}
      />

      <PeriodPicker
        year={year}
        periodNo={periodNo}
        frequency={business.vatFrequency}
        action="/income"
      />

      {pendingCount > 0 && (
        <Alert tone="warning">
          {pendingCount} מסמכים בתקופה זו ממתינים לאישור ואינם נכללים בסכומים למעלה. אישור נעשה
          בכפתור "אישור" בשורת המסמך.
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="עסקאות חייבות" value={formatILS(totals.net)} />
        <Stat label="מע&quot;מ עסקאות" value={formatILS(totals.vat)} tone="brand" />
        <Stat label="עסקאות פטורות / אפס" value={formatILS(totals.exempt)} />
      </div>

      <Panel title={`הכנסות — ${periodLabel}`}>
        <DocumentTable documents={documents} direction="INCOME" />
      </Panel>
    </div>
  );
}
