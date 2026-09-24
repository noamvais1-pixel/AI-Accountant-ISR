export function PayCard({
  businessName,
  description,
  customerName,
  amount,
  maxInstallments,
  status,
  payUrl,
  failureReason,
  message,
}: {
  businessName: string;
  description: string;
  customerName: string;
  amount: string;
  maxInstallments: number;
  status: 'PENDING' | 'SETTLING' | 'PAID' | 'FAILED' | 'CANCELLED';
  payUrl: string | null;
  failureReason?: string | null;
  message?: string | null;
}) {
  return (
    <div className="mx-auto max-w-md space-y-6 py-10">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-sm">
        <div className="text-xs font-medium text-[var(--muted)]">{businessName}</div>
        <h1 className="mt-2 text-lg font-semibold tracking-tight">{description}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">עבור {customerName}</p>
        <div className="mt-5 text-3xl font-semibold ltr-num">{amount}</div>
        {maxInstallments > 1 && status !== 'PAID' && (
          <p className="mt-1 text-xs text-[var(--muted)]">אפשר לחלק עד {maxInstallments} תשלומים</p>
        )}

        {message && <p className="mt-4 text-sm">{message}</p>}

        {status === 'PAID' && (
          <div className="mt-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            התשלום התקבל, תודה! חשבונית מס/קבלה נשלחה למייל.
          </div>
        )}
        {status === 'CANCELLED' && (
          <div className="mt-5 rounded-lg bg-ink-100 p-3 text-sm dark:bg-ink-800">הקישור בוטל. אם זו טעות, פני לבעלת העסק.</div>
        )}
        {status === 'SETTLING' && (
          <div className="mt-5 rounded-lg bg-sky-50 p-3 text-sm text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">התשלום התקבל ונרשם כעת. אפשר לסגור את הדף.</div>
        )}
        {failureReason && status === 'FAILED' && (
          <div className="mt-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
            ניסיון התשלום הקודם לא אושר ({failureReason}). אפשר לנסות שוב.
          </div>
        )}

        {payUrl && (
          <a
            href={payUrl}
            className="mt-6 block rounded-xl bg-brand-600 px-4 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            לתשלום מאובטח בכרטיס אשראי
          </a>
        )}
        <p className="mt-4 text-[11px] text-[var(--muted)]">
          התשלום מתבצע בדף מאובטח של חברת הסליקה. פרטי הכרטיס אינם נשמרים אצל {businessName}.
        </p>
      </div>
    </div>
  );
}
