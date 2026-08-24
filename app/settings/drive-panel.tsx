'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { disconnectDrive, runDriveBackup } from '@/app/actions';
import { Alert, Badge } from '@/components/ui';

export function DrivePanel({
  configured,
  connectedEmail,
  pendingCount,
  backedUpCount,
  rootFolderName,
  notice,
}: {
  configured: boolean;
  connectedEmail: string | null;
  pendingCount: number;
  backedUpCount: number;
  rootFolderName: string;
  notice: { tone: 'success' | 'error'; text: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function act(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const r = await fn();
      setResult({ ok: r.ok, text: r.ok ? (r.message ?? 'בוצע.') : (r.error ?? 'נכשל.') });
      router.refresh();
    });
  }

  if (!configured) {
    return (
      <div className="space-y-3 p-5 text-sm">
        <Alert tone="info" title="גוגל דרייב אינו מוגדר">
          <p>
            הצילומים נשמרים כרגע מקומית בלבד, בתיקיית <code className="ltr-num">uploads/</code>. אין להם גיבוי.
          </p>
          <p className="mt-2">כדי להפעיל גיבוי, צריך פעם אחת ליצור אישורי OAuth בגוגל:</p>
          <ol className="mt-1 list-inside list-decimal space-y-1">
            <li>
              היכנסי ל-<span className="ltr-num">console.cloud.google.com</span>, צרי פרויקט, והפעילי את{' '}
              <span className="ltr-num">Google Drive API</span>.
            </li>
            <li>
              במסך <span className="ltr-num">OAuth consent screen</span> בחרי <span className="ltr-num">External</span>{' '}
              והוסיפי את עצמך כ-<span className="ltr-num">Test user</span>.
            </li>
            <li>
              ב-<span className="ltr-num">Credentials</span> צרי{' '}
              <span className="ltr-num">OAuth client ID</span> מסוג <span className="ltr-num">Web application</span>,
              עם <span className="ltr-num">Authorized redirect URI</span>:
              <br />
              <code className="ltr-num">http://localhost:3737/api/drive/callback</code>
            </li>
            <li>
              העתיקי את ה-<span className="ltr-num">Client ID</span> וה-<span className="ltr-num">Client secret</span>{' '}
              ל-<code className="ltr-num">GOOGLE_CLIENT_ID</code> ו-<code className="ltr-num">GOOGLE_CLIENT_SECRET</code>{' '}
              בקובץ <code className="ltr-num">.env.local</code>, והפעילי מחדש את השרת.
            </li>
          </ol>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-5 text-sm">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {connectedEmail ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="green">מחובר</Badge>
            <span className="ltr-num text-[var(--muted)]">{connectedEmail}</span>
          </div>

          <p className="text-[var(--muted)]">
            הצילומים נשמרים מקומית ומגובים לתיקייה <strong>{rootFolderName}</strong> בדרייב, מסודרים לפי שנה, תקופת
            דיווח, והוצאות מול הכנסות. המערכת רואה בדרייב אך ורק את הקבצים שהיא עצמה יצרה.
          </p>

          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <span>
              מגובים: <strong className="ltr-num">{backedUpCount}</strong>
            </span>
            <span>
              ממתינים: <strong className="ltr-num">{pendingCount}</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => act(runDriveBackup)}
              disabled={pending || pendingCount === 0}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? 'מגבה…' : pendingCount ? `גיבוי ${pendingCount} קבצים ממתינים` : 'הכל מגובה'}
            </button>
            <a
              href="/api/drive/connect"
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-ink-100 dark:hover:bg-ink-800"
            >
              חיבור חשבון אחר
            </a>
            <button
              type="button"
              onClick={() => {
                if (confirm('לנתק את החיבור לדרייב? הקבצים שכבר גובו יישארו שם.')) act(disconnectDrive);
              }}
              disabled={pending}
              className="rounded-lg px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/40"
            >
              ניתוק
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[var(--muted)]">
            הצילומים נשמרים מקומית בלבד ואין להם גיבוי. חיבור לדרייב יעלה אותם אוטומטית בכל קליטה, ויסדר אותם לפי
            שנה ותקופת דיווח.
          </p>
          <a
            href="/api/drive/connect"
            className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            חיבור לגוגל דרייב
          </a>
        </>
      )}

      {result && <Alert tone={result.ok ? 'success' : 'error'}>{result.text}</Alert>}
    </div>
  );
}
