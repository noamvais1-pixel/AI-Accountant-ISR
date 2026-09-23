import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/auth/server';
import { isAllowed } from '@/lib/auth/allowlist';

export const dynamic = 'force-dynamic';

/** ממירה את הקוד שבקישור הכניסה לעוגיית התחברות. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';

  if (!code) return NextResponse.redirect(new URL('/login', url.origin));

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !isAllowed(data.user?.email)) {
    // כתובת שאינה ברשימה מקבלת התחברות תקפה מגוגל אך לא גישה למערכת.
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/login?denied=1', url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
