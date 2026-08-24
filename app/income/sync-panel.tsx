'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { syncCardcom, type ActionResult } from '@/app/actions';
import { Alert } from '@/components/ui';

const field =
  'rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm ltr-num outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';

export function SyncPanel({
  configured,
  defaultFrom,
  defaultTo,
}: {
  configured: boolean;
  defaultFrom: string;
  defaultTo: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const result = await syncCardcom(prev, form);
    router.refresh();
    return result;
  }, null);

  if (!configured) {
    return (
      <Alert tone="warning" title="קארדקום אינה מחוברת">
        השלימי את <code className="ltr-num">CARDCOM_TERMINAL_NUMBER</code>, <code className="ltr-num">CARDCOM_API_NAME</code>{' '}
        ו-<code className="ltr-num">CARDCOM_API_PASSWORD</code> בקובץ <code className="ltr-num">.env.local</code> והפעילי מחדש את השרת.
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]" htmlFor="fromDate">
            מתאריך
          </label>
          <input id="fromDate" name="fromDate" type="date" defaultValue={defaultFrom} className={field} required />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]" htmlFor="toDate">
            עד תאריך
          </label>
          <input id="toDate" name="toDate" type="date" defaultValue={defaultTo} className={field} required />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? 'מסנכרן…' : 'משיכת חשבוניות מקארדקום'}
        </button>
        <p className="text-xs text-[var(--muted)]">
          הסנכרון בטוח לחזרה — מסמך שכבר נקלט מתעדכן ולא נוצר פעמיים.
        </p>
      </form>

      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      {state?.ok && <Alert tone="success">{state.message}</Alert>}
    </div>
  );
}
