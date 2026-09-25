import type { Metadata } from 'next';
import { Heebo } from 'next/font/google';
import Link from 'next/link';
import { currentUser } from '@/lib/auth/server';
import { isPlatformAdmin } from '@/lib/auth/admin';
import { getActiveBusinessOrNull } from '@/lib/services/business';
import './globals.css';

const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo', display: 'swap' });

export const metadata: Metadata = {
  title: 'רואה חשבון AI',
  description: 'ניהול הוצאות, הכנסות ודוחות מע"מ',
};

const NAV = [
  { href: '/', label: 'סקירה' },
  { href: '/expenses', label: 'הוצאות' },
  { href: '/income', label: 'הכנסות' },
  { href: '/deals', label: 'עסקאות' },
  { href: '/invoices/new', label: 'הפקת חשבונית' },
  { href: '/reports/vat', label: 'דוח מע"מ' },
  { href: '/settings', label: 'הגדרות' },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const business = user ? await getActiveBusinessOrNull() : null;
  const nav = business ? [...NAV, ...(isPlatformAdmin(user?.email) ? [{ href: '/admin/customers', label: 'לקוחות' }] : [])] : [];
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="min-h-dvh font-sans">
        <div className="mx-auto flex min-h-dvh max-w-[1400px] flex-col">
          <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--panel)]/85 backdrop-blur">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-sm text-white">₪</span>
                רואה חשבון AI
              </Link>
              <nav className="flex flex-wrap items-center gap-1 text-sm">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-lg px-3 py-1.5 text-[var(--muted)] transition-colors hover:bg-ink-100 hover:text-[var(--text)] dark:hover:bg-ink-800"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              {user && (
                <form action="/auth/signout" method="post" className="ms-auto flex items-center gap-2">
                  <span className="ltr-num text-xs text-[var(--muted)]">{user.email}</span>
                  <button
                    type="submit"
                    className="rounded-lg px-2.5 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-ink-100 hover:text-[var(--text)] dark:hover:bg-ink-800"
                  >
                    יציאה
                  </button>
                </form>
              )}
            </div>
          </header>
          <main className="flex-1 px-5 py-6">{children}</main>
          <footer className="border-t border-[var(--border)] px-5 py-4 text-xs text-[var(--muted)]">
            המערכת מסייעת בניהול הרישום והדוחות. האחריות על נכונות הדיווח לרשות המסים היא של בעל העסק.
          </footer>
        </div>
      </body>
    </html>
  );
}
