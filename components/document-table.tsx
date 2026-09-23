'use client';

import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DocumentForm } from '@/components/document-form';
import { Badge, EmptyState } from '@/components/ui';
import { deleteDocument, setDocumentStatus } from '@/app/actions';
import { formatILS } from '@/lib/money';
import { DOC_TYPE_LABELS, SOURCE_LABELS, formatDate } from '@/lib/format';
import type { Document } from '@prisma/client';

function DeductibleBadge({ document }: { document: Document }) {
  if (document.direction !== 'EXPENSE') return null;
  if (document.deductibleBp === 10000) return null;
  if (document.deductibleBp === 0) return <Badge tone="red">לא מוכר</Badge>;
  return <Badge tone="amber">ניכוי {(document.deductibleBp / 100).toFixed(document.deductibleBp % 100 ? 2 : 0)}%</Badge>;
}

export function DocumentTable({
  documents,
  direction,
  locked = false,
}: {
  documents: (Document & { reverses?: { number: string } | null })[];
  direction: 'INCOME' | 'EXPENSE';
  locked?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!documents.length) {
    return (
      <EmptyState
        title={direction === 'EXPENSE' ? 'אין עדיין הוצאות' : 'אין עדיין הכנסות'}
        description={
          direction === 'EXPENSE'
            ? 'צלמי קבלה או הזיני מסמך ידנית כדי להתחיל.'
            : 'סנכרני מקארדקום או הפיקי חשבונית חדשה.'
        }
      />
    );
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? 'הפעולה נכשלה.');
      else setError(null);
      router.refresh();
    });
  }

  return (
    <div>
      {error && (
        <p className="border-b border-[var(--border)] bg-rose-50 px-4 py-2 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-right text-xs text-[var(--muted)]">
              <th className="px-4 py-2.5 font-medium">תאריך</th>
              <th className="px-4 py-2.5 font-medium">{direction === 'EXPENSE' ? 'ספק' : 'לקוח'}</th>
              <th className="px-4 py-2.5 font-medium">מסמך</th>
              <th className="px-4 py-2.5 text-left font-medium">לפני מע"מ</th>
              <th className="px-4 py-2.5 text-left font-medium">מע"מ</th>
              <th className="px-4 py-2.5 text-left font-medium">סה"כ</th>
              <th className="px-4 py-2.5 font-medium">מצב</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => {
              const isEditing = editing === doc.id;
              const s = doc.isCredit ? -1 : 1;
              return (
                <Fragment key={doc.id}>
                  <tr className="border-b border-[var(--border)] last:border-0 hover:bg-ink-50/60 dark:hover:bg-ink-900/40">
                    <td className="whitespace-nowrap px-4 py-2.5 ltr-num text-[var(--muted)]">{formatDate(doc.issueDate)}
                      {doc.reportDate.toISOString().slice(0, 10) !== doc.issueDate.toISOString().slice(0, 10) && (
                        // תאריך ההפקה לתצוגה; התקופה נקבעת לפי מועד התשלום
                        <span className="block text-[10px] text-[var(--muted)]">שולם {formatDate(doc.reportDate)}</span>
                      )}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{doc.counterpartyName}</div>
                      {doc.counterpartyVatId && <div className="ltr-num text-xs text-[var(--muted)]">{doc.counterpartyVatId}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-[var(--muted)]">{DOC_TYPE_LABELS[doc.docType]}</span>
                        <span className="ltr-num text-xs">{doc.number}</span>
                        {doc.isCredit && (
                          <Badge tone="red">{doc.reverses ? `זיכוי · מבטל ${doc.reverses.number}` : 'זיכוי'}</Badge>
                        )}
                        {doc.installments && doc.installments > 1 && (
                          <Badge tone="blue">
                            {doc.installments} תשלומים
                            {doc.installmentAgorot ? ` · ${formatILS(doc.installmentAgorot)} לתשלום` : ''}
                          </Badge>
                        )}
                        <DeductibleBadge document={doc} />
                      </div>
                      {doc.category && <div className="text-xs text-[var(--muted)]">{doc.category}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-left ltr-num">{formatILS(s * doc.netAgorot)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-left ltr-num text-[var(--muted)]">{formatILS(s * doc.vatAgorot)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-left ltr-num font-semibold">{formatILS(s * doc.totalAgorot)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        {/* טיוטה אינה "מאושר": היא לא נספרת בסכומים, והתג חייב לומר זאת */}
                        {doc.status === 'VOID' ? (
                          <Badge tone="red">מבוטל</Badge>
                        ) : doc.status === 'DRAFT' ? (
                          <Badge tone="amber">ממתין לאישור</Badge>
                        ) : (
                          <Badge tone="green">מאושר</Badge>
                        )}
                        <span className="text-[10px] text-[var(--muted)]">{SOURCE_LABELS[doc.source]}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-left">
                      {!locked && (
                        <div className="flex items-center justify-end gap-1">
                          {doc.fileKey && (
                            <a
                              href={`/api/files/${doc.fileKey}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-ink-100 dark:hover:bg-ink-800"
                            >
                              מסמך
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => setEditing(isEditing ? null : doc.id)}
                            className="rounded px-2 py-1 text-xs hover:bg-ink-100 dark:hover:bg-ink-800"
                          >
                            {isEditing ? 'סגירה' : 'עריכה'}
                          </button>
                          {doc.status === 'DRAFT' && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => act(() => setDocumentStatus(doc.id, 'CONFIRMED'))}
                              className="rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                            >
                              אישור
                            </button>
                          )}
                          {doc.status !== 'VOID' ? (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => act(() => setDocumentStatus(doc.id, 'VOID'))}
                              className="rounded px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-400 dark:hover:bg-amber-950/40"
                            >
                              ביטול
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => act(() => setDocumentStatus(doc.id, 'CONFIRMED'))}
                              className="rounded px-2 py-1 text-xs hover:bg-ink-100 disabled:opacity-50 dark:hover:bg-ink-800"
                            >
                              שחזור
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              if (confirm(`למחוק את המסמך ${doc.number}?`)) act(() => deleteDocument(doc.id));
                            }}
                            className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/40"
                          >
                            מחיקה
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {isEditing && (
                    <tr className="border-b border-[var(--border)] bg-[var(--surface)]">
                      <td colSpan={8} className="p-4">
                        <DocumentForm
                          document={doc}
                          direction={direction}
                          compact
                          onDone={() => {
                            setEditing(null);
                            router.refresh();
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
