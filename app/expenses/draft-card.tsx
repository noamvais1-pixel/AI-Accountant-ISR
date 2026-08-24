'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DocumentForm } from '@/components/document-form';
import { Badge } from '@/components/ui';
import { deleteDocument } from '@/app/actions';
import { formatILS } from '@/lib/money';
import { formatDate } from '@/lib/format';
import type { Document } from '@prisma/client';

/** כרטיס טיוטה: תצוגה מקדימה של הקובץ לצד השדות שחולצו, לבדיקה מהירה. */
export function DraftCard({ document }: { document: Document }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const confidence = document.ocrConfidence ?? 1;

  function remove() {
    if (!confirm(`למחוק את הטיוטה מ"${document.counterpartyName}"? הפעולה אינה הפיכה.`)) return;
    startTransition(async () => {
      await deleteDocument(document.id);
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-amber-300 bg-[var(--panel)] dark:border-amber-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-amber-50/60 px-4 py-3 dark:bg-amber-950/20">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{document.counterpartyName}</span>
          <span className="text-[var(--muted)]">·</span>
          <span className="ltr-num text-[var(--muted)]">{formatDate(document.issueDate)}</span>
          <span className="text-[var(--muted)]">·</span>
          <span className="ltr-num font-semibold">{formatILS(document.totalAgorot)}</span>
          {confidence < 0.8 && <Badge tone="amber">ביטחון נמוך {Math.round(confidence * 100)}%</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {document.fileKey && (
            <a
              href={`/api/files/${document.fileKey}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-ink-100 dark:hover:bg-ink-800"
            >
              צפייה במסמך
            </a>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-ink-100 dark:hover:bg-ink-800"
          >
            {expanded ? 'סגירה' : 'בדיקה ואישור'}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/40"
          >
            מחיקה
          </button>
        </div>
      </div>

      {document.notes && (
        <p className="border-b border-[var(--border)] px-4 py-2 text-xs text-amber-800 dark:text-amber-300">
          שים לב: {document.notes}
        </p>
      )}

      {expanded && (
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
          <DocumentForm document={document} direction="EXPENSE" compact onDone={() => router.refresh()} />
          {document.fileKey && (
            <div className="hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 lg:block">
              {document.fileMime === 'application/pdf' ? (
                <object data={`/api/files/${document.fileKey}`} type="application/pdf" className="h-[520px] w-full rounded">
                  <p className="p-4 text-xs text-[var(--muted)]">אין תצוגה מקדימה. פתחי את הקובץ בלשונית נפרדת.</p>
                </object>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/files/${document.fileKey}`}
                  alt={`מסמך מ${document.counterpartyName}`}
                  className="max-h-[520px] w-full rounded object-contain"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
