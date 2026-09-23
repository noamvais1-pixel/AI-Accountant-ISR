import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { redirect } from 'next/navigation';
import { isAllowed } from './allowlist';

/** לקוח Supabase לצד השרת, שקורא וכותב את עוגיית ההתחברות. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options);
          } catch {
            // רכיב שרת אינו רשאי לכתוב עוגיות; הרענון נעשה ב-middleware.
          }
        },
      },
    },
  );
}

/** המשתמש המחובר, או null. */
export async function currentUser() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? null;
  return isAllowed(email) ? { id: data.user!.id, email: email! } : null;
}

/**
 * דורש משתמש מחובר. נקרא מכל עמוד ומכל פעולת שרת שנוגעת בנתונים.
 *
 * ההגנה ב-middleware לבדה אינה מספיקה: פעולות שרת נקראות ישירות בבקשת POST,
 * וקל להוסיף מסלול חדש ולשכוח להגן עליו. הבדיקה חוזרת כאן, קרוב לנתונים.
 */
export async function requireUser() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    if (process.env.VERCEL === '1') throw new Error('האתר אינו מוגדר: חסרות הגדרות ההתחברות.');
    // בהרצה מקומית המערכת נשארת פתוחה, כפי שהייתה עד היום.
    return { id: 'local', email: 'local' };
  }
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

/** כמו requireUser, אבל למסלולי API — מחזיר null במקום להפנות לדף התחברות. */
export async function apiUser() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    if (process.env.VERCEL === '1') return null;
    return { id: 'local', email: 'local' };
  }
  return currentUser();
}
