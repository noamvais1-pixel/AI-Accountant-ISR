'use client';

import { useActionState } from 'react';
import { saveBusiness, type ActionResult } from '../actions';
import { Alert } from '@/components/ui';
import type { Business } from '@prisma/client';

const field = 'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';
const label = 'block text-xs font-medium text-[var(--muted)] mb-1.5';

export function BusinessForm({ business }: { business: Business | null }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveBusiness, null);

  return (
    <form action={action} className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="name">שם העסק</label>
          <input id="name" name="name" defaultValue={business?.name ?? ''} className={field} required />
        </div>
        <div>
          <label className={label} htmlFor="vatId">מספר עוסק / ח.פ</label>
          <input
            id="vatId"
            name="vatId"
            defaultValue={business?.vatId ?? ''}
            className={`${field} ltr-num`}
            inputMode="numeric"
            placeholder="123456789"
            required
          />
        </div>
        <div>
          <label className={label} htmlFor="legalType">סוג העסק</label>
          <select id="legalType" name="legalType" defaultValue={business?.legalType ?? 'OSEK_MURSHE'} className={field}>
            <option value="OSEK_MURSHE">עוסק מורשה</option>
            <option value="OSEK_PATUR">עוסק פטור</option>
            <option value="COMPANY">חברה בע"מ</option>
            <option value="AMUTA">עמותה</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="vatFrequency">תדירות דיווח מע"מ</label>
          <select id="vatFrequency" name="vatFrequency" defaultValue={business?.vatFrequency ?? 'BIMONTHLY'} className={field}>
            <option value="BIMONTHLY">דו-חודשי</option>
            <option value="MONTHLY">חודשי</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="address">כתובת</label>
          <input id="address" name="address" defaultValue={business?.address ?? ''} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="city">עיר</label>
          <input id="city" name="city" defaultValue={business?.city ?? ''} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="phone">טלפון</label>
          <input id="phone" name="phone" defaultValue={business?.phone ?? ''} className={`${field} ltr-num`} />
        </div>
        <div>
          <label className={label} htmlFor="email">דוא"ל</label>
          <input id="email" name="email" type="email" defaultValue={business?.email ?? ''} className={`${field} ltr-num`} />
        </div>
      </div>

      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      {state?.ok && <Alert tone="success">{state.message}</Alert>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? 'שומר…' : 'שמירה'}
        </button>
      </div>
    </form>
  );
}
