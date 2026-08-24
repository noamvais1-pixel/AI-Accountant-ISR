'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui';

type ScanResult = { fileName: string; id?: string; error?: string; confidence?: number };

/**
 * העלאת קבלות לסריקה. תומך בבחירת קבצים, גרירה, וצילום ישיר במובייל
 * (capture="environment" פותח את המצלמה האחורית).
 */
export function ScanUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ScanResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;

    setBusy(true);
    setError(null);
    setResults(null);

    try {
      const form = new FormData();
      list.forEach((file) => form.append('files', file));

      const response = await fetch('/api/scan', { method: 'POST', body: form });
      const json = await response.json();

      if (!response.ok) {
        setError(json.error ?? 'הקליטה נכשלה.');
        return;
      }
      setResults(json.results as ScanResult[]);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'הקליטה נכשלה.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const succeeded = results?.filter((r) => r.id) ?? [];
  const failed = results?.filter((r) => r.error) ?? [];

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-[var(--border)] bg-[var(--panel)]'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          capture="environment"
          className="hidden"
          onChange={(e) => e.target.files && void upload(e.target.files)}
        />
        <p className="text-sm font-medium">{busy ? 'קורא את המסמכים…' : 'גררי לכאן קבלות, או צלמי'}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">JPG, PNG, HEIC או PDF · עד 15MB לקובץ · אפשר כמה בבת אחת</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'מעבד…' : 'בחירת קבצים / צילום'}
        </button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {succeeded.length > 0 && (
        <Alert tone="success">
          נקלטו {succeeded.length} מסמכים והם ממתינים לאישור למטה.
          {succeeded.some((r) => (r.confidence ?? 1) < 0.8) && ' חלקם נקראו בביטחון נמוך — כדאי לבדוק את הסכומים.'}
        </Alert>
      )}

      {failed.length > 0 && (
        <Alert tone="error" title="קבצים שלא נקלטו">
          <ul className="mt-1 space-y-0.5">
            {failed.map((r) => (
              <li key={r.fileName}>
                <span className="font-medium">{r.fileName}</span> — {r.error}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
