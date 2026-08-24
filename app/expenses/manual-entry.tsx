'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DocumentForm } from '@/components/document-form';

/** הזנה ידנית — למי שיש לה את המספרים ביד ולא צריכה סריקה. */
export function ManualEntryToggle() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-medium transition-colors hover:bg-ink-100 dark:hover:bg-ink-800"
      >
        {open ? 'סגירת ההזנה הידנית' : 'הזנה ידנית'}
      </button>

      {open && (
        <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm">
          <header className="border-b border-[var(--border)] px-5 py-3.5">
            <h2 className="text-sm font-semibold">הזנת הוצאה ידנית</h2>
          </header>
          <DocumentForm
            direction="EXPENSE"
            onDone={() => {
              setOpen(false);
              router.refresh();
            }}
          />
        </div>
      )}
    </>
  );
}
