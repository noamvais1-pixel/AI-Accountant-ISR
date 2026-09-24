'use client';

import { useActionState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addMemberAction, removeMemberAction, type ActionResult } from '@/app/actions';
import { Alert, Badge } from '@/components/ui';

const field =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';

export function MembersPanel({ members, me }: { members: { id: string; email: string; role: 'OWNER' | 'ACCOUNTANT' }[]; me: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, action, adding] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const r = await addMemberAction(prev, form);
    if (r.ok) router.refresh();
    return r;
  }, null);
  return (
    <div className="space-y-4 p-5">
      <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="ltr-num">{m.email}</span>
              <Badge tone={m.role === 'OWNER' ? 'green' : 'blue'}>{m.role === 'OWNER' ? 'בעלים' : 'רואת חשבון'}</Badge>
              {m.email === me && <span className="text-xs text-[var(--muted)]">(את)</span>}
            </span>
            {m.email !== me && (
              <button type="button" disabled={pending} onClick={() => start(async () => { await removeMemberAction(m.id); router.refresh(); })} className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">הסרה</button>
            )}
          </li>
        ))}
      </ul>
      <form action={action} className="flex flex-wrap items-end gap-2">
        {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
        <div className="min-w-64 flex-1">
          <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]" htmlFor="member-email">צירוף לפי מייל</label>
          <input id="member-email" name="email" type="email" required placeholder="accountant@example.com" className={`${field} ltr-num`} />
        </div>
        <select name="role" defaultValue="ACCOUNTANT" className={`${field} w-auto`}>
          <option value="ACCOUNTANT">רואת חשבון (צפייה ועבודה על הספרים)</option>
          <option value="OWNER">בעלים</option>
        </select>
        <button type="submit" disabled={adding} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">צירוף</button>
      </form>
      <p className="text-xs text-[var(--muted)]">מי שצורפה נכנסת עם המייל שלה (קישור קסם) ורואה את העסק הזה בלבד.</p>
    </div>
  );
}
