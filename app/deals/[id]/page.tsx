import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getActiveBusinessOrNull } from '@/lib/services/business';
import { Panel, Alert, Badge, Stat } from '@/components/ui';
import { formatILS } from '@/lib/money';
import { formatDate, toDateInputValue, DOC_TYPE_LABELS } from '@/lib/format';
import { dealProgress, plannedSchedule } from '@/lib/deals';
import { PAYMENT_METHOD_LABELS } from '@/lib/services/deals';
import { getInvoiceProvider } from '@/lib/invoicing';
import { ChargeForm, IssueForm, DealStatusButtons } from './deal-panels';

export const dynamic = 'force-dynamic';

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const business = await getActiveBusinessOrNull();
  if (!business) {
    return (
      <Alert tone="info" title="לא הוגדר עסק">
        <Link href="/settings" className="underline">הזיני קודם את פרטי העסק</Link>.
      </Alert>
    );
  }
  const { id } = await params;
  const deal = await prisma.deal.findFirst({
    where: { id, businessId: business.id },
    include: {
      charges: { orderBy: { paidAt: 'asc' }, include: { document: { select: { id: true, number: true, docType: true, fileKey: true } } } },
    },
  });
  if (!deal) notFound();

  const progress = dealProgress(deal, deal.charges);
  const plan = plannedSchedule(deal);
  const uninvoiced = deal.charges.filter((c) => !c.documentId);
  const dryRun = process.env.CARDCOM_DRY_RUN !== 'false';

  // כיסוי הלוח הצפוי לפי סדר: איזה תשלום מתוכנן כבר כוסה בתקבולים
  let covered = progress.paidAgorot;
  const planRows = plan.map((p) => {
    const paid = Math.min(p.amountAgorot, covered);
    covered -= paid;
    const status: 'paid' | 'partial' | 'overdue' | 'upcoming' =
      paid === p.amountAgorot ? 'paid' : p.dueDate.getTime() < Date.now() ? (paid > 0 ? 'partial' : 'overdue') : 'upcoming';
    return { ...p, paid, status };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/deals" className="text-xs text-[var(--muted)] hover:underline">→ כל העסקאות</Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{deal.customerName}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {deal.description} · נפתחה {formatDate(deal.createdAt)}
            {deal.customerVatId && <span className="ltr-num"> · {deal.customerVatId}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {deal.status === 'CANCELLED' ? <Badge tone="red">בוטלה</Badge> : deal.status === 'PAID' ? <Badge tone="green">שולמה במלואה</Badge> : <Badge tone="blue">פתוחה</Badge>}
          <DealStatusButtons dealId={deal.id} status={deal.status} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="סה&quot;כ העסקה" value={formatILS(deal.totalAgorot)} hint={deal.vatTreatment === 'STANDARD' ? `${formatILS(deal.netAgorot)} + מע"מ ${formatILS(deal.vatAgorot)}` : 'פטור ממע"מ'} />
        <Stat label="שולם" value={formatILS(progress.paidAgorot)} tone="positive" />
        <Stat label="יתרה" value={formatILS(progress.remainingAgorot)} />
        <Stat label="באיחור" value={formatILS(progress.overdueAgorot)} tone={progress.overdueAgorot > 0 ? 'negative' : 'neutral'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`תוכנית התשלום — ${deal.installments} תשלומים`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-right text-xs text-[var(--muted)]">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">מועד</th>
                <th className="px-4 py-2 text-left font-medium">סכום</th>
                <th className="px-4 py-2 font-medium">מצב</th>
              </tr>
            </thead>
            <tbody>
              {planRows.map((p) => (
                <tr key={p.seq} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2 ltr-num text-[var(--muted)]">{p.seq}</td>
                  <td className="whitespace-nowrap px-4 py-2 ltr-num">{formatDate(p.dueDate)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-left ltr-num">{formatILS(p.amountAgorot)}</td>
                  <td className="px-4 py-2">
                    {p.status === 'paid' && <Badge tone="green">שולם</Badge>}
                    {p.status === 'partial' && <Badge tone="amber">שולם חלקית {formatILS(p.paid)}</Badge>}
                    {p.status === 'overdue' && <Badge tone="red">באיחור</Badge>}
                    {p.status === 'upcoming' && <Badge tone="gray">צפוי</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="רישום תקבול">
          {deal.status === 'CANCELLED' ? (
            <p className="p-4 text-sm text-[var(--muted)]">העסקה בוטלה.</p>
          ) : progress.isPaid ? (
            <p className="p-4 text-sm text-[var(--muted)]">העסקה שולמה במלואה.</p>
          ) : (
            <div className="p-4">
              <ChargeForm dealId={deal.id} defaultDate={toDateInputValue(new Date())} defaultAmount={(progress.nextDue?.amountAgorot ?? progress.remainingAgorot) / 100} />
            </div>
          )}
        </Panel>
      </div>

      <Panel title="תקבולים">
        {deal.charges.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted)]">טרם נרשמו תקבולים.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-right text-xs text-[var(--muted)]">
                <th className="px-4 py-2 font-medium">תאריך</th>
                <th className="px-4 py-2 font-medium">אופן</th>
                <th className="px-4 py-2 font-medium">אסמכתא</th>
                <th className="px-4 py-2 text-left font-medium">סכום</th>
                <th className="px-4 py-2 font-medium">מסמך</th>
              </tr>
            </thead>
            <tbody>
              {deal.charges.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 ltr-num">{formatDate(c.paidAt)}</td>
                  <td className="px-4 py-2">
                    {PAYMENT_METHOD_LABELS[c.method]}
                    {c.method === 'CARD' && c.cardInstallments > 1 && <span className="text-xs text-[var(--muted)]"> · {c.cardInstallments} תשלומים</span>}
                  </td>
                  <td className="px-4 py-2 ltr-num text-[var(--muted)]">{c.reference ?? ''}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-left ltr-num font-medium">{formatILS(c.amountAgorot)}</td>
                  <td className="px-4 py-2">
                    {c.document ? (
                      <span className="flex items-center gap-2">
                        <Badge tone="green">{DOC_TYPE_LABELS[c.document.docType]} {c.document.number}</Badge>
                        {c.document.fileKey && (
                          <a href={`/api/files/${c.document.fileKey}`} target="_blank" rel="noreferrer" className="text-xs underline">צפייה</a>
                        )}
                      </span>
                    ) : (
                      <Badge tone="amber">טרם הופק מסמך</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {uninvoiced.length > 0 && deal.status !== 'CANCELLED' && (
          <div className="border-t border-[var(--border)] p-4">
            <IssueForm
              dealId={deal.id}
              charges={uninvoiced.map((c) => ({ id: c.id, label: `${formatDate(c.paidAt)} · ${PAYMENT_METHOD_LABELS[c.method]} · ${formatILS(c.amountAgorot)}` }))}
              configured={getInvoiceProvider().isConfigured()}
              dryRun={dryRun}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}
