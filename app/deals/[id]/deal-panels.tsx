'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordDealChargeAction, issueDealDocumentAction, setDealStatusAction, deleteDealAction, type ActionResult } from '@/app/actions';
import { Alert } from '@/components/ui';

const field =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';
const label = 'mb-1.5 block text-xs font-medium text-[var(--muted)]';

export function ChargeForm({ dealId, defaultDate, defaultAmount }: { dealId: string; defaultDate: string; defaultAmount: number }) {
  const router = useRouter();
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const result = await recordDealChargeAction(prev, form);
    if (result.ok) router.refresh();
    return result;
  }, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="dealId" value={dealId} />
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="paidAt">תאריך התקבול</label>
          <input id="paidAt" name="paidAt" type="date" defaultValue={defaultDate} required className={`${field} ltr-num`} />
        </div>
        <div>
          <label className={label} htmlFor="amount">סכום</label>
          <input id="amount" name="amount" inputMode="decimal" defaultValue={defaultAmount.toFixed(2)} required className={`${field} ltr-num`} />
        </div>
        <div>
          <label className={label} htmlFor="method">אופן התשלום</label>
          <select id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
            <option value="BANK_TRANSFER">העברה בנקאית</option>
            <option value="BIT">ביט</option>
            <option value="CARD">כרטיס אשראי</option>
            <option value="CASH">מזומן</option>
            <option value="CHEQUE">שיק</option>
            <option value="OTHER">אחר</option>
          </select>
        </div>
        {method === 'CARD' ? (
          <div>
            <label className={label} htmlFor="cardInstallments">תשלומים בכרטיס</label>
            <input id="cardInstallments" name="cardInstallments" type="number" min={1} max={36} defaultValue={1} className={`${field} ltr-num`} />
          </div>
        ) : (
          <div>
            <label className={label} htmlFor="reference">אסמכתא</label>
            <input id="reference" name="reference" className={`${field} ltr-num`} />
          </div>
        )}
      </div>
      <button type="submit" disabled={pending} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {pending ? 'רושם…' : 'רישום התקבול'}
      </button>
    </form>
  );
}

export function IssueForm({ dealId, charges, configured, dryRun }: { dealId: string; charges: { id: string; label: string }[]; configured: boolean; dryRun: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const result = await issueDealDocumentAction(prev, form);
    if (result.ok) router.refresh();
    return result;
  }, null);
  if (!configured) return <Alert tone="warning">קארדקום אינה מחוברת, אי אפשר להפיק מסמך.</Alert>;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="dealId" value={dealId} />
      <div className="text-sm font-medium">הפקת מסמך על תקבולים שטרם הופק להם מסמך</div>
      {dryRun && (
        <Alert tone="info">
          מצב בטיחות פעיל: ההפקה בקארדקום חסומה עד שמשנים את CARDCOM_DRY_RUN ל-false. אפשר לרשום תקבולים בינתיים.
        </Alert>
      )}
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      {state && state.ok && <Alert tone="success">{state.message}</Alert>}
      <div className="space-y-1">
        {charges.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="chargeId" value={c.id} defaultChecked />
            <span className="ltr-num">{c.label}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select name="documentKind" defaultValue="TAX_INVOICE_RECEIPT" className={`${field} w-auto`}>
          <option value="TAX_INVOICE_RECEIPT">חשבונית מס/קבלה</option>
          <option value="RECEIPT">קבלה בלבד</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="sendByEmail" defaultChecked />
          לשלוח ללקוח במייל
        </label>
        <button type="submit" disabled={pending || dryRun} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {pending ? 'מפיק…' : 'הפקה ורישום בספרים'}
        </button>
      </div>
    </form>
  );
}

export function DealStatusButtons({ dealId, status, deletable }: { dealId: string; status: 'OPEN' | 'PAID' | 'CANCELLED'; deletable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function set(next: 'OPEN' | 'CANCELLED') {
    start(async () => {
      const r = await setDealStatusAction(dealId, next);
      setError(r.ok ? null : r.error);
      router.refresh();
    });
  }
  function remove() {
    if (!confirm('למחוק את העסקה לצמיתות? התקבולים שנרשמו עליה יימחקו איתה.')) return;
    start(async () => {
      const r = await deleteDealAction(dealId);
      if (r.ok) router.push('/deals');
      else setError(r.error);
    });
  }
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-rose-700">{error}</span>}
      {deletable && (
        <button type="button" disabled={pending} onClick={remove} className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/40">מחיקה</button>
      )}
      {status === 'CANCELLED' ? (
        <button type="button" disabled={pending} onClick={() => set('OPEN')} className="rounded px-2 py-1 text-xs hover:bg-ink-100 dark:hover:bg-ink-800">שחזור</button>
      ) : (
        <button type="button" disabled={pending} onClick={() => { if (confirm('לבטל את העסקה?')) set('CANCELLED'); }} className="rounded px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40">ביטול העסקה</button>
      )}
    </span>
  );
}
