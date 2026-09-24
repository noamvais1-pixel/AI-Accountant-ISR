'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { savePaymentSplit, clearPaymentSplit, type ActionResult } from '@/app/actions';
import { formatILS } from '@/lib/money';
import { toDateInputValue } from '@/lib/format';

const field =
  'rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm ltr-num outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';

type Row = { date: string; amount: string };

/**
 * עורך פיצול תשלומים למסמך: באילו מועדים ובאילו סכומים שולם בפועל.
 * הסכומים חייבים להסתכם בדיוק לסכום המסמך — הבדיקה נעשית גם כאן, לפני השליחה,
 * כדי שהמשתמשת תראה את הפער בזמן ההקלדה.
 */
export function PaymentSplitEditor({
  document,
  schedule,
  onDone,
}: {
  document: { id: string; number: string; totalAgorot: number; reportDate: Date; scheduleManual: boolean };
  schedule: { dueDate: Date; totalAgorot: number }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const initial: Row[] =
    schedule.length > 0
      ? schedule.map((s) => ({ date: toDateInputValue(s.dueDate), amount: (s.totalAgorot / 100).toFixed(2) }))
      : [
          { date: toDateInputValue(document.reportDate), amount: (document.totalAgorot / 100).toFixed(2) },
          { date: '', amount: '' },
        ];
  const [rows, setRows] = useState<Row[]>(initial);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const result = await savePaymentSplit(prev, form);
    if (result.ok) {
      router.refresh();
      onDone();
    }
    return result;
  }, null);

  const sum = rows.reduce((a, r) => a + Math.round(Number(r.amount.replace(/[^\d.-]/g, '') || 0) * 100), 0);
  const diff = document.totalAgorot - sum;

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="documentId" value={document.id} />
      <div className="text-sm">
        <span className="font-medium">פיצול תשלומים למסמך {document.number}</span>
        <span className="text-[var(--muted)]"> · סה"כ המסמך {formatILS(document.totalAgorot)}</span>
      </div>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-xs text-[var(--muted)]">תשלום {i + 1}</span>
            <input type="date" name="date" value={row.date} onChange={(e) => update(i, { date: e.target.value })} className={field} />
            <input
              type="text"
              name="amount"
              inputMode="decimal"
              placeholder="סכום כולל מע&quot;מ"
              value={row.amount}
              onChange={(e) => update(i, { amount: e.target.value })}
              className={`${field} w-36`}
            />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              >
                הסרה
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button type="button" onClick={() => setRows((rs) => [...rs, { date: '', amount: '' }])} className="underline">
          + תשלום נוסף
        </button>
        <span className={diff === 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}>
          {diff === 0 ? 'הסכומים מסתכמים לסכום המסמך' : `נותרו ${formatILS(diff)} לפיצול`}
        </span>
      </div>
      {state && !state.ok && <p className="text-sm text-rose-700 dark:text-rose-400">{state.error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || diff !== 0}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? 'שומר…' : 'שמירת הפיצול'}
        </button>
        {document.scheduleManual && (
          <button
            type="button"
            disabled={pending}
            onClick={async () => {
              const r = await clearPaymentSplit(document.id);
              if (r.ok) {
                router.refresh();
                onDone();
              }
            }}
            className="rounded-lg px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40"
          >
            ביטול הפיצול הידני
          </button>
        )}
        <button type="button" onClick={onDone} className="rounded-lg px-3 py-1.5 text-sm hover:bg-ink-100 dark:hover:bg-ink-800">
          סגירה
        </button>
      </div>
    </form>
  );
}
