'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { createDealAction, type ActionResult } from '@/app/actions';
import { Alert } from '@/components/ui';

const field =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';
const label = 'mb-1.5 block text-xs font-medium text-[var(--muted)]';

export function DealForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const result = await createDealAction(prev, form);
    if (result.ok && result.data && typeof result.data === 'object' && 'id' in result.data) {
      router.push(`/deals/${(result.data as { id: string }).id}`);
    }
    return result;
  }, null);

  return (
    <form action={action} className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">הלקוח</legend>
        <div>
          <label className={label} htmlFor="customerName">שם *</label>
          <input id="customerName" name="customerName" required className={field} />
        </div>
        <div>
          <label className={label} htmlFor="customerVatId">ת"ז / ע.מ</label>
          <input id="customerVatId" name="customerVatId" inputMode="numeric" className={`${field} ltr-num`} />
        </div>
        <div>
          <label className={label} htmlFor="customerEmail">אימייל</label>
          <input id="customerEmail" name="customerEmail" type="email" className={`${field} ltr-num`} />
        </div>
        <div>
          <label className={label} htmlFor="customerPhone">טלפון</label>
          <input id="customerPhone" name="customerPhone" type="tel" className={`${field} ltr-num`} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">העסקה</legend>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="description">השירות *</label>
          <input id="description" name="description" required placeholder='למשל "קורס הכשרת מאמנות" או "ליווי עסקי — 3 חודשים"' className={field} />
        </div>
        <div>
          <label className={label} htmlFor="total">סכום כולל מע"מ *</label>
          <input id="total" name="total" inputMode="decimal" required className={`${field} ltr-num`} />
        </div>
        <div>
          <label className={label} htmlFor="vatTreatment">מע"מ</label>
          <select id="vatTreatment" name="vatTreatment" defaultValue="STANDARD" className={field}>
            <option value="STANDARD">חייב במע"מ</option>
            <option value="EXEMPT">פטור ממע"מ</option>
            <option value="ZERO_RATED">מע"מ אפס</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="installments">מספר תשלומים</label>
          <input id="installments" name="installments" type="number" min={1} max={36} defaultValue={1} className={`${field} ltr-num`} />
        </div>
        <div>
          <label className={label} htmlFor="firstPaymentDate">מועד התשלום הראשון</label>
          <input id="firstPaymentDate" name="firstPaymentDate" type="date" defaultValue={defaultDate} className={`${field} ltr-num`} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="notes">הערות</label>
          <textarea id="notes" name="notes" rows={2} className={field} />
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {pending ? 'שומר…' : 'פתיחת העסקה'}
        </button>
        <span className="text-xs text-[var(--muted)]">שום דבר לא נגבה ולא מופק בשלב הזה.</span>
      </div>
    </form>
  );
}
