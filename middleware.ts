import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAllowed } from '@/lib/auth/allowlist';

/** מסלולים שחייבים להישאר פתוחים, אחרת אי אפשר בכלל להתחבר. */
const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/signout'];

export async function middleware(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    // בלי הגדרות Supabase אין התחברות. מקומית זה בסדר — המערכת מאזינה רק למחשב
    // עצמו. בפריסה לאינטרנט זה אומר שכל אחד רואה את הספרים, ולכן מוטב שהאתר
    // יסרב לעבוד מאשר ייפתח לרווחה בגלל משתנה סביבה שנשכח.
    const deployed = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
    if (deployed) {
      return new NextResponse(
        'האתר אינו מוגדר: חסרות הגדרות ההתחברות. עד להשלמתן הגישה חסומה.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
      );
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // getUser מאמת את הטוקן מול Supabase; getSession רק קורא עוגייה וניתן לזייף.
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return response;

  if (!isAllowed(email)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    if (email) url.searchParams.set('denied', '1');
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // הכל מוגן חוץ מקבצים סטטיים. גם מסלולי API — הם מחזירים את אותם נתונים.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
