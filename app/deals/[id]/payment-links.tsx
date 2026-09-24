'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPaymentRequestAction, cancelPaymentRequestAction, refreshPaymentRequestAction, type ActionResult } from '@/app/actions';
import { Alert, Badge } from '@/components/ui';

const field =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';
const label = 'mb-1.5 block text-xs font-medium text-[var(--muted)]';

export type PaymentLinkRow = {
  id: string;
  url: string;
  amount: string;
  maxInstallments: number;
  status: 'PENDING' | 'SETTLING' | 'PAID' | 'FAILED' | 'CANCELLED';
  createdAt: string;
  failureReason: string | null;
};

const STATUS: Record<PaymentLinkRow['status'], { label: string; tone: 'gray' | 'green' | 'amber' | 'red' | 'blue' }> = {
  PENDING: { label: 'ממתין לתשלום', tone: 'blue' },
  SETTLING: { label: 'נרשם', tone: 'amber' },
  PAID: { label: 'שולם', tone: 'green' },
  FAILED: { label: 'ניסיון נכשל', tone: 'red' },
  CANCELLED: { label: 'בוטל', tone: 'gray' },
};

export function PaymentLinks({ dealId, links, defaultAmount, defaultInstallments, dryRun, canCreate }: {
  dealId: string;
  links: PaymentLinkRow[];
  defaultAmount: number;
  defaultInstallments: number;
  dryRun: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [state, action, creating] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const result = await createPaymentRequestAction(prev, form);
    if (result.ok) router.refresh();
    return result;
  }, null);

  const createdUrl =
    state?.ok && state.data && typeof state.data === 'object' && 'url' in state.data ? String((state.data as { url: string }).url) : null;

  async function copy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      prompt('העתיקי את הקישור:', url);
    }
  }

  function run(fn: () => Promise<ActionResult>) {
    start(async () => {
      const r = await fn();
      setError(r.ok ? null : r.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {canCreate && (
        <form action={action} className="space-y-3">
          <input type="hidden" name="dealId" value={dealId} />
          {dryRun && (
            <Alert tone="info">מצב בטיחות פעיל: יצירת קישורים חסומה עד שמשנים את CARDCOM_DRY_RUN ל-false. תשלום בקישור מפיק חשבונית אמיתית.</Alert>
          )}
          {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
          {createdUrl && (
            <Alert tone="success">
              הקישור נוצר: <span className="ltr-num break-all">{createdUrl}</span>
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor="pay-amount">סכום לתשלום</label>
              <input id="pay-amount" name="amount" inputMode="decimal" defaultValue={defaultAmount.toFixed(2)} required className={`${field} ltr-num`} />
            </div>
            <div>
              <label className={label} htmlFor="pay-installments">עד כמה תשלומים</label>
              <input id="pay-installments" name="maxInstallments" type="number" min={1} max={36} defaultValue={defaultInstallments} className={`${field} ltr-num`} />
            </div>
            <div className="flex items-end">
              <button type="submit" disabled={creating || dryRun} className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {creating ? 'יוצר…' : 'יצירת קישור לתשלום'}
              </button>
            </div>
          </div>
          <p className="text-xs text-[var(--muted)]">
            הלקוחה משלמת בדף מאובטח של קארדקום. עם אישור התשלום התקבול נרשם כאן, חשבונית מס/קבלה מופקת ונשלחת למייל שלה, והכל נכנס לספרים.
          </p>
        </form>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      {links.length > 0 && (
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
                <span className="ltr-num font-medium">{l.amount}</span>
                {l.maxInstallments > 1 && <span className="text-xs text-[var(--muted)]">עד {l.maxInstallments} תשלומים</span>}
                <span className="ltr-num text-xs text-[var(--muted)]">{l.createdAt}</span>
                {l.failureReason && <span className="text-xs text-rose-700">{l.failureReason}</span>}
              </div>
              <div className="flex items-center gap-1">
                {(l.status === 'PENDING' || l.status === 'FAILED') && (
                  <>
                    <button type="button" onClick={() => copy(l.url, l.id)} className="rounded px-2 py-1 text-xs hover:bg-ink-100 dark:hover:bg-ink-800">
                      {copied === l.id ? 'הועתק ✓' : 'העתקת קישור'}
                    </button>
                    <a href={l.url} target="_blank" rel="noreferrer" className="rounded px-2 py-1 text-xs hover:bg-ink-100 dark:hover:bg-ink-800">פתיחה</a>
                    <button type="button" disabled={pending} onClick={() => run(() => refreshPaymentRequestAction(l.id))} className="rounded px-2 py-1 text-xs hover:bg-ink-100 dark:hover:bg-ink-800">בדיקת מצב</button>
                    <button type="button" disabled={pending} onClick={() => run(() => cancelPaymentRequestAction(l.id))} className="rounded px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 dark:text-amber-400">ביטול</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
