'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPeriodStatus } from '@/app/actions';
import { Alert, Panel } from '@/components/ui';

export function PeriodActions({
  year,
  periodNo,
  status,
  hasErrors,
  downloadUrl,
}: {
  year: number;
  periodNo: number;
  status: 'OPEN' | 'CLOSED' | 'FILED';
  hasErrors: boolean;
  downloadUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function update(next: 'OPEN' | 'CLOSED' | 'FILED') {
    if (next === 'FILED' && !confirm('לסמן את התקופה כדווחה? מסמכים בתקופה יינעלו לשינויים.')) return;
    startTransition(async () => {
      const result = await setPeriodStatus(year, periodNo, next);
      if (!result.ok) setError(result.error);
      else setError(null);
      router.refresh();
    });
  }

  return (
    <Panel title="הגשה">
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={downloadUrl}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            הורדת קובץ PCN874
          </a>
          {status !== 'FILED' ? (
            <button
              type="button"
              onClick={() => update('FILED')}
              disabled={pending}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-ink-100 disabled:opacity-50 dark:hover:bg-ink-800"
            >
              סימון כדווח ונעילת התקופה
            </button>
          ) : (
            <button
              type="button"
              onClick={() => update('OPEN')}
              disabled={pending}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-ink-100 disabled:opacity-50 dark:hover:bg-ink-800"
            >
              פתיחת התקופה מחדש
            </button>
          )}
        </div>

        {hasErrors && (
          <Alert tone="error">
            יש בעיות שסומנו למעלה. קובץ שיוגש איתן עלול להידחות — כדאי לתקן לפני ההגשה.
          </Alert>
        )}

        {error && <Alert tone="error">{error}</Alert>}

        <Alert tone="info" title="איך מגישים">
          <ol className="mt-1 list-inside list-decimal space-y-1">
            <li>הורידי את קובץ ה-PCN874 ובדקי אותו מול הנתונים במסך.</li>
            <li>
              היכנסי לאזור האישי באתר רשות המסים והעלי את הקובץ בטופס הדיווח המפורט למע"מ.
            </li>
            <li>לאחר ההגשה בפועל, סמני כאן שהתקופה דווחה — כדי שהמסמכים יינעלו ולא ישתנו בטעות.</li>
          </ol>
          <p className="mt-2">
            הגשה אוטומטית ישירות מהמערכת עדיין אינה מחוברת. עד אז ההגשה נעשית ידנית באזור האישי.
          </p>
        </Alert>
      </div>
    </Panel>
  );
}
