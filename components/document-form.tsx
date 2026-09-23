'use client';

import { useActionState, useState } from 'react';
import { saveDocument, type ActionResult } from '@/app/actions';
import { Alert } from '@/components/ui';
import { DEDUCTIBLE_PRESETS } from '@/lib/vat';
import { toDateInputValue } from '@/lib/format';
import type { Document } from '@prisma/client';

const field =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';
const label = 'block text-xs font-medium text-[var(--muted)] mb-1.5';

function shekels(agorot: number): string {
  return (agorot / 100).toFixed(2);
}

/**
 * טופס אחד שמשמש גם לאישור טיוטה שנסרקה וגם להזנה ידנית.
 * שדות הסכומים נשארים כפי שנקראו — המשתמש מתקן, המערכת לא "מיישרת" בשבילו.
 */
export function DocumentForm({
  document,
  direction,
  onDone,
  compact = false,
}: {
  document?: Document | null;
  direction: 'INCOME' | 'EXPENSE';
  onDone?: () => void;
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, form) => {
      const result = await saveDocument(prev, form);
      if (result.ok) onDone?.();
      return result;
    },
    null,
  );

  const [docType, setDocType] = useState(document?.docType ?? (direction === 'EXPENSE' ? 'TAX_INVOICE' : 'TAX_INVOICE_RECEIPT'));
  const isExpense = direction === 'EXPENSE';

  return (
    <form action={action} className={compact ? 'space-y-3' : 'space-y-4 p-5'}>
      {document?.id && <input type="hidden" name="id" value={document.id} />}
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="status" value="CONFIRMED" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className={label} htmlFor={`cp-${document?.id ?? 'new'}`}>
            {isExpense ? 'שם הספק' : 'שם הלקוח'}
          </label>
          <input
            id={`cp-${document?.id ?? 'new'}`}
            name="counterpartyName"
            defaultValue={document?.counterpartyName ?? ''}
            className={field}
            required
          />
        </div>
        <div>
          <label className={label}>{isExpense ? 'ח.פ / ע.מ של הספק' : 'ח.פ / ע.מ של הלקוח'}</label>
          <input
            name="counterpartyVatId"
            defaultValue={document?.counterpartyVatId ?? ''}
            className={`${field} ltr-num`}
            inputMode="numeric"
            placeholder="9 ספרות"
          />
        </div>
        <div>
          <label className={label}>סוג מסמך</label>
          <select name="docType" value={docType} onChange={(e) => setDocType(e.target.value as typeof docType)} className={field}>
            <option value="TAX_INVOICE">חשבונית מס</option>
            <option value="TAX_INVOICE_RECEIPT">חשבונית מס/קבלה</option>
            <option value="RECEIPT">קבלה</option>
            <option value="CREDIT_INVOICE">חשבונית זיכוי</option>
            {isExpense && <option value="PETTY_CASH">קופה קטנה</option>}
            {isExpense && <option value="IMPORT_DECLARATION">רשימון יבוא</option>}
            <option value="OTHER_DOC">מסמך אחר</option>
          </select>
        </div>

        <div>
          <label className={label}>מספר מסמך</label>
          <input name="number" defaultValue={document?.number ?? ''} className={`${field} ltr-num`} required />
        </div>
        <div>
          <label className={label}>תאריך המסמך</label>
          <input
            name="issueDate"
            type="date"
            defaultValue={toDateInputValue(document?.issueDate ?? new Date())}
            className={`${field} ltr-num`}
            required
          />
        </div>
        <div>
          <label className={label}>
            מספר הקצאה <span className="opacity-60">(אם יש)</span>
          </label>
          <input name="allocationNumber" defaultValue={document?.allocationNumber ?? ''} className={`${field} ltr-num`} inputMode="numeric" />
        </div>
        <div>
          <label className={label}>
            תשלומים <span className="opacity-60">(עסקת אשראי)</span>
          </label>
          <input
            name="installments"
            type="number"
            min={1}
            max={36}
            defaultValue={document?.installments ?? 1}
            className={`${field} ltr-num`}
          />
        </div>
        <div>
          <label className={label}>סיווג</label>
          <input name="category" defaultValue={document?.category ?? ''} className={field} placeholder="דלק, משרדיות…" />
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={label}>לפני מע"מ</label>
            <input
              name="netAmount"
              defaultValue={document ? shekels(document.netAgorot) : ''}
              className={`${field} ltr-num`}
              inputMode="decimal"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className={label}>מע"מ</label>
            <input
              name="vatAmount"
              defaultValue={document ? shekels(document.vatAgorot) : ''}
              className={`${field} ltr-num`}
              inputMode="decimal"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className={label}>סה"כ לתשלום</label>
            <input
              name="totalAmount"
              defaultValue={document ? shekels(document.totalAgorot) : ''}
              className={`${field} ltr-num`}
              inputMode="decimal"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className={label}>שיעור מע"מ %</label>
            <input
              name="vatRatePercent"
              defaultValue={document ? String(document.vatRateBp / 100) : '18'}
              className={`${field} ltr-num`}
              inputMode="decimal"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          מספיק למלא שניים מתוך שלושת הסכומים — השלישי מחושב. הזנת שלושתם נשמרת כפי שהיא.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={label}>טיפול מע"מ</label>
          <select name="vatTreatment" defaultValue={document?.vatTreatment ?? 'STANDARD'} className={field}>
            <option value="STANDARD">חייב במע"מ</option>
            <option value="ZERO_RATED">מע"מ בשיעור אפס</option>
            <option value="EXEMPT">פטור ממע"מ</option>
            <option value="NO_VAT">ללא מע"מ</option>
          </select>
        </div>
        {isExpense && (
          <>
            <div>
              <label className={label}>סוג תשומה</label>
              <select name="inputKind" defaultValue={document?.inputKind ?? 'OTHER'} className={field}>
                <option value="OTHER">תשומות שוטפות</option>
                <option value="EQUIPMENT">תשומות ציוד</option>
              </select>
            </div>
            <div>
              <label className={label}>אחוז ניכוי מע"מ</label>
              <select name="deductibleBp" defaultValue={String(document?.deductibleBp ?? 10000)} className={field}>
                {DEDUCTIBLE_PRESETS.map((preset) => (
                  <option key={preset.bp} value={preset.bp}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      <div>
        <label className={label}>הערות</label>
        <input name="notes" defaultValue={document?.notes ?? ''} className={field} />
      </div>

      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      {state?.ok && <Alert tone="success">{state.message}</Alert>}

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? 'שומר…' : document?.status === 'DRAFT' ? 'אישור והכנסה לספרים' : 'שמירה'}
        </button>
      </div>
    </form>
  );
}
