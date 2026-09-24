import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getActiveBusinessOrNull } from '@/lib/services/business';
import { Panel, Alert, Badge, EmptyState, Stat } from '@/components/ui';
import { formatILS } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { dealProgress } from '@/lib/deals';

export const dynamic = 'force-dynamic';

export default async function DealsPage() {
  const business = await getActiveBusinessOrNull();
  if (!business) {
    return (
      <Alert tone="info" title="לא הוגדר עסק">
        <Link href="/settings" className="underline">הזיני קודם את פרטי העסק</Link>.
      </Alert>
    );
  }

  const deals = await prisma.deal.findMany({
    where: { businessId: business.id },
    include: { charges: { select: { amountAgorot: true, documentId: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const rows = deals.map((d) => ({ deal: d, progress: dealProgress(d, d.charges) }));
  const open = rows.filter((r) => r.deal.status === 'OPEN');
  const totals = {
    remaining: open.reduce((a, r) => a + r.progress.remainingAgorot, 0),
    overdue: open.reduce((a, r) => a + r.progress.overdueAgorot, 0),
    uninvoiced: rows.reduce((a, r) => a + r.deal.charges.filter((c) => !c.documentId).reduce((s, c) => s + c.amountAgorot, 0), 0),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">עסקאות</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            העסקה נוצרת כאן לפני שנגבה שקל. כל תקבול נרשם עליה, והמסמך מופק מתוך הרשומה.
          </p>
        </div>
        <Link href="/deals/new" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          עסקה חדשה
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="פתוח לגבייה" value={formatILS(totals.remaining)} hint={`${open.length} עסקאות פתוחות`} />
        <Stat label="באיחור" value={formatILS(totals.overdue)} tone={totals.overdue > 0 ? 'negative' : 'neutral'} />
        <Stat label="תקבולים ללא מסמך" value={formatILS(totals.uninvoiced)} tone={totals.uninvoiced > 0 ? 'brand' : 'neutral'} hint="נגבו וטרם הופקה עליהם חשבונית" />
      </div>

      <Panel title="כל העסקאות">
        {rows.length === 0 ? (
          <EmptyState title="אין עדיין עסקאות" description="פתחי עסקה חדשה: לקוח, שירות, סכום ומספר תשלומים." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-right text-xs text-[var(--muted)]">
                  <th className="px-4 py-2.5 font-medium">נפתחה</th>
                  <th className="px-4 py-2.5 font-medium">לקוח</th>
                  <th className="px-4 py-2.5 font-medium">שירות</th>
                  <th className="px-4 py-2.5 font-medium">תשלומים</th>
                  <th className="px-4 py-2.5 text-left font-medium">סה"כ</th>
                  <th className="px-4 py-2.5 text-left font-medium">שולם</th>
                  <th className="px-4 py-2.5 text-left font-medium">יתרה</th>
                  <th className="px-4 py-2.5 font-medium">מצב</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ deal, progress }) => (
                  <tr key={deal.id} className="border-b border-[var(--border)] last:border-0 hover:bg-ink-50/60 dark:hover:bg-ink-900/40">
                    <td className="whitespace-nowrap px-4 py-2.5 ltr-num text-[var(--muted)]">{formatDate(deal.createdAt)}</td>
                    <td className="px-4 py-2.5 font-medium">
                      <Link href={`/deals/${deal.id}`} className="hover:underline">{deal.customerName}</Link>
                    </td>
                    <td className="px-4 py-2.5">{deal.description}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 ltr-num">
                      {deal.installments}
                      {progress.nextDue && deal.status === 'OPEN' && (
                        <span className="block text-[10px] text-[var(--muted)]">הבא: {formatDate(progress.nextDue.dueDate)}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-left ltr-num">{formatILS(deal.totalAgorot)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-left ltr-num">{formatILS(progress.paidAgorot)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-left ltr-num font-semibold">{formatILS(progress.remainingAgorot)}</td>
                    <td className="px-4 py-2.5">
                      {deal.status === 'CANCELLED' ? (
                        <Badge tone="red">בוטלה</Badge>
                      ) : deal.status === 'PAID' ? (
                        <Badge tone="green">שולמה</Badge>
                      ) : progress.overdueAgorot > 0 ? (
                        <Badge tone="amber">באיחור {formatILS(progress.overdueAgorot)}</Badge>
                      ) : (
                        <Badge tone="blue">פתוחה</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
