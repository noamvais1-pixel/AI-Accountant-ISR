'use client';

import { useActionState, useState } from 'react';
import { issueInvoice, type ActionResult } from '@/app/actions';
import { Alert } from '@/components/ui';
import { formatILS } from '@/lib/money';
import { formatRateBp } from '@/lib/vat';

const field =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';
const label = 'block text-xs font-medium text-[var(--muted)] mb-1.5';

type Line = { id: number; description: string; quantity: string; unitPrice: string };

let nextId = 1;
const emptyLine = (): Line => ({ id: nextId++, description: '', quantity: '1', unitPrice: '' });

export function InvoiceForm({ vatRateBp, today, dryRun }: { vatRateBp: number; today: string; dryRun: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(issueInvoice, null);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

  function updateLine(id: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  // התצוגה המקדימה מחושבת בצד הלקוח בלבד. הסכום הקובע הוא זה שקארדקום תחזיר.
  // המחירים מוזנים כולל מע"מ — כמו שהלקוחה רואה אותם — והנטו נגזר מהם.
  const totalAgorot = lines.reduce((sum, line) => {
    const qty = Number(line.quantity) || 0;
    const price = Number(line.unitPrice) || 0;
    return sum + Math.round(price * 100 * qty);
  }, 0);
  const netAgorot = Math.round((totalAgorot * 10000) / (10000 + vatRateBp));
  const vatAgorot = totalAgorot - netAgorot;

  const issued = state?.ok ? (state.data as { documentUrl?: string; documentNumber?: string } | undefined) : undefined;

  return (
    <form action={action} className="space-y-5">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-4 text-sm font-semibold">פרטי הלקוח</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <label className={label} htmlFor="customerName">שם הלקוח</label>
            <input id="customerName" name="customerName" className={field} required />
          </div>
          <div>
            <label className={label} htmlFor="customerVatId">ח.פ / ע.מ</label>
            <input id="customerVatId" name="customerVatId" className={`${field} ltr-num`} inputMode="numeric" placeholder="9 ספרות" />
          </div>
          <div>
            <label className={label} htmlFor="customerEmail">דוא"ל</label>
            <input id="customerEmail" name="customerEmail" type="email" className={`${field} ltr-num`} />
          </div>
          <div>
            <label className={label} htmlFor="customerPhone">טלפון</label>
            <input id="customerPhone" name="customerPhone" className={`${field} ltr-num`} />
          </div>
          <div>
            <label className={label} htmlFor="customerCity">עיר</label>
            <input id="customerCity" name="customerCity" className={field} />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">שורות העסקה</h2>
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-ink-100 dark:hover:bg-ink-800"
          >
            הוספת שורה
          </button>
        </div>

        <div className="space-y-2">
          {lines.map((line, index) => {
            const lineTotal = Math.round((Number(line.unitPrice) || 0) * 100 * (Number(line.quantity) || 0));
            return (
              <div key={line.id} className="grid gap-2 sm:grid-cols-[1fr_90px_120px_110px_40px]">
                <input
                  name="lineDescription"
                  value={line.description}
                  onChange={(e) => updateLine(line.id, { description: e.target.value })}
                  className={field}
                  placeholder={index === 0 ? 'תיאור השירות או המוצר' : 'תיאור'}
                  required={index === 0}
                />
                <input
                  name="lineQuantity"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                  className={`${field} ltr-num`}
                  inputMode="decimal"
                  aria-label="כמות"
                />
                <input
                  name="lineUnitPrice"
                  value={line.unitPrice}
                  onChange={(e) => updateLine(line.id, { unitPrice: e.target.value })}
                  className={`${field} ltr-num`}
                  inputMode="decimal"
                  placeholder="מחיר כולל מע״מ"
                  aria-label="מחיר ליחידה כולל מע״מ"
                />
                <div className="flex items-center justify-end px-2 text-sm ltr-num text-[var(--muted)]">
                  {formatILS(lineTotal)}
                </div>
                <button
                  type="button"
                  onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== line.id) : prev))}
                  disabled={lines.length === 1}
                  className="rounded-lg text-sm text-[var(--muted)] hover:bg-ink-100 disabled:opacity-30 dark:hover:bg-ink-800"
                  aria-label="מחיקת שורה"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <p className="mt-2 text-xs text-[var(--muted)]">המחירים מוזנים כולל מע"מ.</p>

        <div className="mt-4 space-y-1 border-t border-[var(--border)] pt-4 text-sm">
          <div className="flex justify-between text-base font-semibold">
            <span>סה"כ לתשלום</span>
            <span className="ltr-num">{formatILS(totalAgorot)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">מתוכו מע"מ {formatRateBp(vatRateBp)}</span>
            <span className="ltr-num">{formatILS(vatAgorot)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">לפני מע"מ</span>
            <span className="ltr-num">{formatILS(netAgorot)}</span>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-4 text-sm font-semibold">פרטי המסמך</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={label} htmlFor="documentKind">סוג המסמך</label>
            <select id="documentKind" name="documentKind" defaultValue="TAX_INVOICE_RECEIPT" className={field}>
              <option value="TAX_INVOICE_RECEIPT">חשבונית מס/קבלה</option>
              <option value="TAX_INVOICE">חשבונית מס</option>
              <option value="RECEIPT">קבלה</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="issueDate">תאריך</label>
            <input id="issueDate" name="issueDate" type="date" defaultValue={today} className={`${field} ltr-num`} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="sendByEmail" className="h-4 w-4 rounded border-[var(--border)]" />
              שליחה ללקוח במייל
            </label>
          </div>
          <div className="lg:col-span-3">
            <label className={label} htmlFor="comments">הערות שיודפסו על המסמך</label>
            <input id="comments" name="comments" className={field} />
          </div>
        </div>
      </section>

      {dryRun && (
        <Alert tone="warning" title="מצב בטיחות פעיל">
          ההפקה חסומה כרגע. חשבונית שמופקת היא מסמך חוקי שאי אפשר למחוק — רק לבטל בזיכוי. כדי להפעיל, שני את{' '}
          <code className="ltr-num">CARDCOM_DRY_RUN</code> ל-<code className="ltr-num">false</code> בקובץ{' '}
          <code className="ltr-num">.env.local</code> והפעילי מחדש את השרת.
        </Alert>
      )}

      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      {state?.ok && (
        <Alert tone="success" title={state.message}>
          {issued?.documentUrl && (
            <a href={issued.documentUrl} target="_blank" rel="noreferrer" className="underline">
              פתיחת החשבונית
            </a>
          )}
        </Alert>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || dryRun}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? 'מפיק…' : 'הפקת חשבונית'}
        </button>
      </div>
    </form>
  );
}
