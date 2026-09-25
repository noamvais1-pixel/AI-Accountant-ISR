import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/server';
import { isPlatformAdmin } from '@/lib/auth/admin';
import { Panel, Badge, Stat, EmptyState } from '@/components/ui';
import { formatILS } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { completedSteps, STEPS } from '@/lib/services/onboarding';

export const dynamic = 'force-dynamic';

/**
 * לוח הלקוחות של הפלטפורמה: כל העסקים שנרשמו, איפה כל אחד עומד בהצטרפות,
 * האם הסליקה מחוברת, וכמה פעילות עברה דרכו. נגיש למנהלות הפלטפורמה בלבד.
 */
export default async function CustomersPage() {
  const user = await requireUser();
  if (!isPlatformAdmin(user.email)) notFound();

  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const businesses = await prisma.business.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      members: { orderBy: { createdAt: 'asc' } },
      application: true,
      _count: { select: { deals: true, documents: true } },
    },
  });
  const ids = businesses.map((b) => b.id);
  const [paid30, paidAll, lastDocs, openDeals] = await Promise.all([
    prisma.paymentRequest.groupBy({ by: ['businessId'], where: { businessId: { in: ids }, status: 'PAID', resolvedAt: { gte: since30 } }, _sum: { amountAgorot: true }, _count: true }),
    prisma.paymentRequest.groupBy({ by: ['businessId'], where: { businessId: { in: ids }, status: 'PAID' }, _sum: { amountAgorot: true }, _count: true }),
    prisma.document.groupBy({ by: ['businessId'], where: { businessId: { in: ids } }, _max: { createdAt: true } }),
    prisma.deal.groupBy({ by: ['businessId'], where: { businessId: { in: ids }, status: 'OPEN' }, _count: true }),
  ]);
  const by = <T extends { businessId: string }>(rows: T[]) => new Map(rows.map((r) => [r.businessId, r]));
  const m30 = by(paid30), mAll = by(paidAll), mLast = by(lastDocs), mOpen = by(openDeals);

  const rows = businesses.map((b) => {
    const done = completedSteps(b, b.application);
    const stepsDone = STEPS.filter((s) => done[s.key]).length;
    const connected = Boolean(b.cardcomApiName && b.cardcomApiPasswordEnc) || (Boolean(process.env.CARDCOM_TERMINAL_NUMBER) && (!b.cardcomTerminal || b.cardcomTerminal === process.env.CARDCOM_TERMINAL_NUMBER));
    const lastActivity = [mLast.get(b.id)?._max.createdAt, b.cardcomLastSyncAt, b.updatedAt].filter((d): d is Date => Boolean(d)).sort((a, c) => c.getTime() - a.getTime())[0];
    return {
      b,
      owner: b.members.find((m) => m.role === 'OWNER')?.email ?? b.members[0]?.email ?? '—',
      members: b.members.length,
      stepsDone,
      connected,
      appStatus: b.application?.status ?? null,
      volume30: m30.get(b.id)?._sum.amountAgorot ?? 0,
      count30: m30.get(b.id)?._count ?? 0,
      volumeAll: mAll.get(b.id)?._sum.amountAgorot ?? 0,
      openDeals: mOpen.get(b.id)?._count ?? 0,
      lastActivity,
    };
  });

  const totals = {
    businesses: rows.length,
    connected: rows.filter((r) => r.connected).length,
    pendingApps: rows.filter((r) => r.appStatus === 'READY' || r.appStatus === 'SUBMITTED').length,
    volume30: rows.reduce((a, r) => a + r.volume30, 0),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">לקוחות הפלטפורמה</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">כל העסקים במערכת: איפה כל אחד עומד, האם הסליקה מחוברת, וכמה עובר דרכו.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="עסקים" value={String(totals.businesses)} />
        <Stat label="סליקה מחוברת" value={String(totals.connected)} tone="positive" />
        <Stat label="בקשות סליקה ממתינות" value={String(totals.pendingApps)} tone={totals.pendingApps ? 'brand' : 'neutral'} />
        <Stat label="נסלק ב-30 יום" value={formatILS(totals.volume30)} hint="דרך דפי התשלום של המערכת" />
      </div>

      <Panel title="עסקים">
        {rows.length === 0 ? (
          <EmptyState title="אין עדיין עסקים" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-right text-xs text-[var(--muted)]">
                  <th className="px-4 py-2.5 font-medium">נרשם</th>
                  <th className="px-4 py-2.5 font-medium">עסק</th>
                  <th className="px-4 py-2.5 font-medium">בעלים</th>
                  <th className="px-4 py-2.5 font-medium">הצטרפות</th>
                  <th className="px-4 py-2.5 font-medium">סליקה</th>
                  <th className="px-4 py-2.5 text-left font-medium">עסקאות פתוחות</th>
                  <th className="px-4 py-2.5 text-left font-medium">מסמכים</th>
                  <th className="px-4 py-2.5 text-left font-medium">נסלק 30 יום</th>
                  <th className="px-4 py-2.5 text-left font-medium">סה"כ נסלק</th>
                  <th className="px-4 py-2.5 font-medium">פעילות אחרונה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.b.id} className="border-b border-[var(--border)] last:border-0 hover:bg-ink-50/60 dark:hover:bg-ink-900/40">
                    <td className="whitespace-nowrap px-4 py-2.5 ltr-num text-[var(--muted)]">{formatDate(r.b.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.b.name}</div>
                      <div className="ltr-num text-xs text-[var(--muted)]">{r.b.vatId}{r.b.city ? ` · ${r.b.city}` : ''}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="ltr-num text-xs">{r.owner}</div>
                      {r.members > 1 && <div className="text-[10px] text-[var(--muted)]">+{r.members - 1} חברות</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                          <span className="block h-full bg-brand-600" style={{ width: `${(r.stepsDone / STEPS.length) * 100}%` }} />
                        </span>
                        <span className="text-xs text-[var(--muted)]">{r.stepsDone}/{STEPS.length}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {r.connected ? (
                        <Badge tone="green">מחוברת{r.b.cardcomTerminal ? ` · ${r.b.cardcomTerminal}` : ''}</Badge>
                      ) : r.appStatus === 'SUBMITTED' ? (
                        <Badge tone="blue">בקשה אצל קארדקום</Badge>
                      ) : r.appStatus === 'READY' ? (
                        <Badge tone="amber">בקשה מוכנה לשליחה</Badge>
                      ) : r.appStatus === 'REJECTED' ? (
                        <Badge tone="red">נדחתה</Badge>
                      ) : (
                        <Badge tone="gray">לא מחוברת</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-left ltr-num">{r.openDeals}</td>
                    <td className="px-4 py-2.5 text-left ltr-num">{r.b._count.documents}</td>
                    <td className="px-4 py-2.5 text-left ltr-num">{formatILS(r.volume30)}{r.count30 ? <span className="text-xs text-[var(--muted)]"> ({r.count30})</span> : null}</td>
                    <td className="px-4 py-2.5 text-left ltr-num">{formatILS(r.volumeAll)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 ltr-num text-[var(--muted)]">{r.lastActivity ? formatDate(r.lastActivity) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-xs text-[var(--muted)]">
        "נסלק" מונה תשלומים שעברו דרך דפי התשלום והמסוף של המערכת. חשבוניות שהופקו במקום אחר מופיעות במסמכים אך לא בסכומי הסליקה.{' '}
        <Link href="/settings" className="underline">הגדרות</Link>
      </p>
    </div>
  );
}
