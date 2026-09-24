import type { ReactNode } from 'react';
import Link from 'next/link';

export function Panel({
  children,
  className = '',
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm ${className}`}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-3.5">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'positive' | 'negative' | 'brand';
  /** כרטיס שמוביל לפירוט — המספר צריך להיות ניתן לבדיקה, לא רק לקריאה */
  href?: string;
}) {
  const toneClass = {
    neutral: 'text-[var(--text)]',
    positive: 'text-emerald-600 dark:text-emerald-400',
    negative: 'text-rose-600 dark:text-rose-400',
    brand: 'text-brand-600 dark:text-brand-400',
  }[tone];

  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--muted)]">
        <span>{label}</span>
        {href && <span aria-hidden className="text-[10px]">פירוט ←</span>}
      </div>
      <div className={`mt-1.5 text-2xl font-semibold ltr-num ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-[var(--muted)]">{hint}</div>}
    </>
  );
  const box = 'block rounded-xl border border-[var(--border)] bg-[var(--panel)] px-5 py-4 shadow-sm';
  if (href) {
    return (
      <Link href={href} className={`${box} transition-colors hover:border-brand-500 hover:bg-ink-50/60 dark:hover:bg-ink-900/40`}>
        {body}
      </Link>
    );
  }
  return <div className={box}>{body}</div>;
}

const BADGE_TONES = {
  gray: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  red: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
} as const;

export function Badge({
  children,
  tone = 'gray',
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
}) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-[var(--muted)]">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = 'warning',
  title,
  children,
}: {
  tone?: 'warning' | 'error' | 'info' | 'success';
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    error: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
    info: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  }[tone];

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : ''}>{children}</div>
    </div>
  );
}
