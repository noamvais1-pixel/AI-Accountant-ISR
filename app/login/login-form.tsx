'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { Panel, Alert } from '@/components/ui';

export function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function send(formData: FormData) {
    setPending(true);
    setError(null);
    const address = String(formData.get('email') ?? '').trim();
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const next = params.get('next') ?? '/';
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setPending(false);
    if (error) setError(error.message);
    else {
      setEmail(address);
      setSent(true);
    }
  }

  return (
    <Panel title="כניסה למערכת" className="w-full">
      <form action={send} className="space-y-4 p-5">
        {params.get('denied') && (
          <Alert tone="error">
            הכתובת שאיתה התחברת אינה מורשית להיכנס למערכת. אם זו טעות, יש להוסיף אותה לרשימת
            המורשים בהגדרות הפריסה.
          </Alert>
        )}

        {sent ? (
          <Alert tone="success" title="נשלח קישור כניסה">
            שלחנו קישור לכתובת <span className="ltr-num">{email}</span>. פתחי אותו מאותו מכשיר כדי
            להיכנס. הקישור תקף לזמן מוגבל.
          </Alert>
        ) : (
          <>
            <p className="text-sm text-[var(--muted)]">
              המערכת מכילה את הספרים שלך ופרטים של לקוחות וספקים, ולכן היא סגורה. הזיני את כתובת
              הדוא"ל שלך ותקבלי אליה קישור כניסה — אין סיסמה לזכור.
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]" htmlFor="email">
                דוא"ל
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
                dir="ltr"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? 'שולח…' : 'שליחת קישור כניסה'}
            </button>
          </>
        )}
      </form>
    </Panel>
  );
}
