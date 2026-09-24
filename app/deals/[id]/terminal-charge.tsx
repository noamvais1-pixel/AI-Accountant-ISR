'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createTerminalChargeAction, refreshPaymentRequestAction, cancelPaymentRequestAction, type ActionResult } from '@/app/actions';
import { Alert } from '@/components/ui';

const field =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';
const label = 'mb-1.5 block text-xs font-medium text-[var(--muted)]';

/**
 * חיוב כרטיס מתוך המערכת, בלי לשלוח קישור. הטופס של הכרטיס הוא של הסולק,
 * מוטמע כאן: מספר הכרטיס נשלח מהדפדפן ישירות אליו ולא עובר בשרת שלנו.
 */
export function TerminalCharge({ dealId, defaultAmount, dryRun }: { dealId: string; defaultAmount: number; dryRun: boolean }) {
  const router = useRouter();
  const [session, setSession] = useState<{ id: string; url: string } | null>(null);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [state, action, opening] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const result = await createTerminalChargeAction(prev, form);
    if (result.ok && result.data && typeof result.data === 'object' && 'url' in result.data) {
      const d = result.data as { id: string; url: string | null };
      if (d.url) setSession({ id: d.id, url: d.url });
    }
    return result;
  }, null);

  function check() {
    if (!session) return;
    start(async () => {
      const r = await refreshPaymentRequestAction(session.id);
      setNote(r.ok ? (r.message ?? null) : r.error);
      if (r.ok && r.message === 'התשלום נרשם.') setSession(null);
      router.refresh();
    });
  }

  function cancel() {
    if (!session) return;
    start(async () => {
      await cancelPaymentRequestAction(session.id);
      setSession(null);
      setNote(null);
      router.refresh();
    });
  }

  if (session) {
    return (
      <div className="space-y-3">
        <p className="text-sm">הזיני את פרטי הכרטיס של הלקוחה בטופס. עם האישור התקבול והחשבונית נרשמים לבד.</p>
        <iframe
          src={session.url}
          title="מסוף חיוב"
          className="h-[620px] w-full rounded-lg border border-[var(--border)] bg-white"
          allow="payment"
        />
        {note && <Alert tone="info">{note}</Alert>}
        <div className="flex items-center gap-2">
          <button type="button" disabled={pending} onClick={check} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {pending ? 'בודק…' : 'סיימתי — בדיקת התשלום'}
          </button>
          <button type="button" disabled={pending} onClick={cancel} className="rounded-lg px-3 py-2 text-sm hover:bg-ink-100 dark:hover:bg-ink-800">
            ביטול
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="dealId" value={dealId} />
      {dryRun && <Alert tone="info">מצב בטיחות פעיל: חיוב חסום עד שמשנים את CARDCOM_DRY_RUN ל-false.</Alert>}
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="term-amount">סכום לחיוב</label>
          <input id="term-amount" name="amount" inputMode="decimal" defaultValue={defaultAmount.toFixed(2)} required className={`${field} ltr-num`} />
        </div>
        <div>
          <label className={label} htmlFor="term-installments">עד כמה תשלומים</label>
          <input id="term-installments" name="maxInstallments" type="number" min={1} max={36} defaultValue={1} className={`${field} ltr-num`} />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={opening || dryRun} className="w-full rounded-lg border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-950/40">
            {opening ? 'פותח…' : 'חיוב כרטיס עכשיו'}
          </button>
        </div>
      </div>
      <p className="text-xs text-[var(--muted)]">
        לחיוב טלפוני: את מזינה את הכרטיס בטופס של קארדקום שייפתח כאן. מספר הכרטיס לא נשמר במערכת.
      </p>
    </form>
  );
}
