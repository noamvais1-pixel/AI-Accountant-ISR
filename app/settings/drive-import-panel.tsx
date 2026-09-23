'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui';

type Progress = { imported: number; duplicates: number; failed: number; remaining: number; scanned: number };

export function DriveImportPanel({ connected, folderName }: { connected: boolean; folderName: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  async function run() {
    setRunning(true);
    setDone(false);
    setErrors([]);
    const totals: Progress = { imported: 0, duplicates: 0, failed: 0, remaining: 0, scanned: 0 };

    // כל קריאה מטפלת באצווה קטנה; ממשיכים עד שאין יותר מה לקלוט.
    for (let round = 0; round < 500; round++) {
      const response = await fetch('/api/drive/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 5 }),
      });
      const data = await response.json();

      if (!response.ok) {
        setErrors([data.error ?? 'הקליטה נכשלה.']);
        break;
      }

      totals.imported += data.imported;
      totals.duplicates += data.duplicates;
      totals.failed += data.failed;
      totals.scanned = data.scanned;
      totals.remaining = data.remaining;
      setProgress({ ...totals });
      if (data.errors?.length) setErrors((prev) => [...prev, ...data.errors].slice(0, 5));
      if (data.remaining === 0) break;
    }

    setRunning(false);
    setDone(true);
    router.refresh();
  }

  if (!connected) {
    return (
      <p className="text-sm text-[var(--muted)]">
        כדי לקלוט מסמכים מהדרייב צריך קודם לחבר אותו, בחלק שמעל.
      </p>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-[var(--muted)]">
        המערכת תסרוק את התיקייה <strong>{folderName}</strong> ואת תת-התיקיות שלה, ותקלוט כל מסמך
        שעוד אינו בספרים. מסמך שכבר נקלט מזוהה לפי תוכנו ומדולג, כך שאפשר להריץ שוב בכל עת.
      </p>

      <button
        type="button"
        onClick={run}
        disabled={running}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
      >
        {running ? 'קולט…' : 'קליטה מהדרייב'}
      </button>

      {progress && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <span>נמצאו בתיקייה: <strong className="ltr-num">{progress.scanned}</strong></span>
          <span>נקלטו: <strong className="ltr-num">{progress.imported}</strong></span>
          <span>כבר היו: <strong className="ltr-num">{progress.duplicates}</strong></span>
          {progress.failed > 0 && <span>נכשלו: <strong className="ltr-num">{progress.failed}</strong></span>}
          {running && <span className="text-[var(--muted)]">נותרו {progress.remaining}…</span>}
        </div>
      )}

      {done && progress && !errors.length && (
        <Alert tone="success">
          הקליטה הושלמה. {progress.imported} מסמכים חדשים ממתינים לאישור.
        </Alert>
      )}

      {errors.length > 0 && (
        <Alert tone="error">
          <ul className="list-inside list-disc">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Alert>
      )}
    </div>
  );
}
