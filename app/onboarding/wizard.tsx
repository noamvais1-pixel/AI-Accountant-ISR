'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  onboardingBusinessAction, onboardingOwnerAction, onboardingBankAction, onboardingDocumentsAction,
  connectCardcomAction, disconnectCardcomAction, submitApplicationAction, type ActionResult,
} from '@/app/actions';
import { Alert, Badge } from '@/components/ui';

const field =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';
const label = 'mb-1.5 block text-xs font-medium text-[var(--muted)]';
const primary = 'rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';

type Step = 'business' | 'owner' | 'bank' | 'documents' | 'connect';
const STEPS: { key: Step; label: string }[] = [
  { key: 'business', label: 'העסק' },
  { key: 'owner', label: 'בעלת העסק' },
  { key: 'bank', label: 'חשבון בנק' },
  { key: 'documents', label: 'מסמכים' },
  { key: 'connect', label: 'סליקה' },
];

type BusinessView = {
  name: string; vatId: string; legalType: string; vatFrequency: string; city: string; phone: string; email: string; hasLogo: boolean;
  cardcomTerminal: string; cardcomApiName: string; cardcomConnected: boolean;
};
type AppView = {
  status: string; street: string; houseNumber: string; zip: string; activity: string; websiteUrl: string;
  ownerFirstName: string; ownerLastName: string; ownerIdentityNumber: string; ownerIdIssueDate: string; ownerBirthDate: string; ownerPhone: string; ownerEmail: string;
  ownerStreet: string; ownerHouseNumber: string; ownerCity: string; ownerZip: string;
  bankCode: string; bankBranch: string; bankAccount: string; maxInstallments: number;
  monthlyTransactions: number | null; averageAmount: number | null; maxAmount: number | null; typicalInstallments: number | null; clearedBefore: boolean;
  hasIdFile: boolean; hasBankFile: boolean; hasCertificateFile: boolean; submittedAt: string | null;
};

export function Wizard(props: {
  step: Step;
  done: Record<Step, boolean>;
  userEmail: string;
  banks: { code: string; name: string }[];
  supplierConfigured: boolean;
  cryptoConfigured: boolean;
  business: BusinessView | null;
  application: AppView | null;
}) {
  const router = useRouter();
  const { step, done, business, application: app } = props;
  const go = (next: string) => router.push(`/onboarding?step=${next}`);

  function useStep(action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>) {
    return useActionState<ActionResult | null, FormData>(async (prev, form) => {
      const r = await action(prev, form);
      if (r.ok) {
        router.refresh();
        const next = r.data && typeof r.data === 'object' && 'next' in r.data ? String((r.data as { next: string }).next) : null;
        if (next) go(next);
      }
      return r;
    }, null);
  }

  const [bState, bAction, bPending] = useStep(onboardingBusinessAction);
  const [oState, oAction, oPending] = useStep(onboardingOwnerAction);
  const [kState, kAction, kPending] = useStep(onboardingBankAction);
  const [dState, dAction, dPending] = useStep(onboardingDocumentsAction);
  const [cState, cAction, cPending] = useStep(connectCardcomAction);
  const [sPending, start] = useTransition();
  const [sMsg, setSMsg] = useState<ActionResult | null>(null);
  const [mode, setMode] = useState<'apply' | 'existing'>(business?.cardcomConnected ? 'existing' : 'apply');
  const [legalType, setLegalType] = useState(business?.legalType ?? 'OSEK_MURSHE');
  // עוסק פטור אינו מגיש דוחות מע"מ תקופתיים — רק הצהרה שנתית; תדירות הדיווח לא רלוונטית
  const exempt = legalType === 'OSEK_PATUR';

  const submitted = app?.status === 'SUBMITTED' || app?.status === 'APPROVED';
  const Err = ({ s }: { s: ActionResult | null }) => (s && !s.ok ? <Alert tone="error">{s.error}</Alert> : null);

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-2 text-sm">
        {STEPS.map((s, i) => {
          const active = s.key === step;
          const reachable = Boolean(business) || s.key === 'business';
          return (
            <li key={s.key}>
              <Link
                href={reachable ? `/onboarding?step=${s.key}` : '#'}
                aria-current={active ? 'step' : undefined}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${active ? 'border-brand-600 bg-brand-600 text-white' : 'border-[var(--border)] text-[var(--muted)]'} ${reachable ? '' : 'pointer-events-none opacity-50'}`}
              >
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${done[s.key] ? 'bg-emerald-500 text-white' : active ? 'bg-white/20' : 'bg-ink-100 dark:bg-ink-800'}`}>
                  {done[s.key] ? '✓' : i + 1}
                </span>
                {s.label}
              </Link>
            </li>
          );
        })}
      </ol>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
        {step === 'business' && (
          <form action={bAction} className="space-y-4">
            <Err s={bState} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className={label}>שם העסק *</label><input name="name" defaultValue={business?.name} required className={field} /></div>
              <div><label className={label}>מספר עוסק / ח.פ *</label><input name="vatId" defaultValue={business?.vatId} required inputMode="numeric" className={`${field} ltr-num`} /></div>
              <div>
                <label className={label}>סוג העסק</label>
                <select name="legalType" value={legalType} onChange={(e) => setLegalType(e.target.value)} className={field}>
                  <option value="OSEK_MURSHE">עוסק מורשה</option><option value="OSEK_PATUR">עוסק פטור</option><option value="COMPANY">חברה בע"מ</option><option value="AMUTA">עמותה</option>
                </select>
              </div>
              {exempt ? (
                <div className="self-end rounded-lg bg-ink-50 px-3 py-2 text-xs text-[var(--muted)] dark:bg-ink-900">
                  עוסק פטור אינו מגיש דוחות מע"מ תקופתיים, רק הצהרה שנתית על המחזור. המערכת תעקוב אחרי המחזור השנתי מול התקרה.
                  <input type="hidden" name="vatFrequency" value="BIMONTHLY" />
                </div>
              ) : (
                <div>
                  <label className={label}>תדירות דיווח מע"מ</label>
                  <select name="vatFrequency" defaultValue={business?.vatFrequency ?? 'BIMONTHLY'} className={field}>
                    <option value="BIMONTHLY">דו-חודשי</option><option value="MONTHLY">חודשי</option>
                  </select>
                </div>
              )}
              <div className="sm:col-span-2"><label className={label}>תחום הפעילות *</label><input name="activity" defaultValue={app?.activity} required placeholder='למשל "ליווי עסקי וקורסים לבעלות עסקים"' className={field} /></div>
              <div><label className={label}>רחוב *</label><input name="street" defaultValue={app?.street} required className={field} /></div>
              <div><label className={label}>מספר בית</label><input name="houseNumber" defaultValue={app?.houseNumber} className={`${field} ltr-num`} /></div>
              <div><label className={label}>עיר *</label><input name="city" defaultValue={business?.city} required className={field} /></div>
              <div><label className={label}>מיקוד</label><input name="zip" defaultValue={app?.zip} inputMode="numeric" className={`${field} ltr-num`} /></div>
              <div><label className={label}>טלפון *</label><input name="phone" defaultValue={business?.phone} required className={`${field} ltr-num`} /></div>
              <div><label className={label}>אימייל העסק</label><input name="email" type="email" defaultValue={business?.email || props.userEmail} className={`${field} ltr-num`} /></div>
              <div><label className={label}>אתר</label><input name="websiteUrl" defaultValue={app?.websiteUrl} className={`${field} ltr-num`} /></div>
              <div>
                <label className={label}>לוגו {business?.hasLogo && <Badge tone="green">הועלה</Badge>}</label>
                <input name="logo" type="file" accept="image/*" className={field} />
              </div>
            </div>
            <button type="submit" disabled={bPending} className={primary}>{bPending ? 'שומר…' : 'שמירה והמשך'}</button>
          </form>
        )}

        {step === 'owner' && (
          <form action={oAction} className="space-y-4">
            <Err s={oState} />
            <p className="text-sm text-[var(--muted)]">הסולק מחויב לזהות את בעלת העסק (הכר את הלקוח). הפרטים נשמרים אצלנו ומועברים אליו בלבד.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className={label}>שם פרטי *</label><input name="ownerFirstName" defaultValue={app?.ownerFirstName} required className={field} /></div>
              <div><label className={label}>שם משפחה *</label><input name="ownerLastName" defaultValue={app?.ownerLastName} required className={field} /></div>
              <div><label className={label}>תעודת זהות *</label><input name="ownerIdentityNumber" defaultValue={app?.ownerIdentityNumber} required inputMode="numeric" className={`${field} ltr-num`} /></div>
              <div><label className={label}>תאריך הנפקת ת"ז *</label><input name="ownerIdIssueDate" type="date" defaultValue={app?.ownerIdIssueDate} required className={`${field} ltr-num`} /></div>
              <div><label className={label}>תאריך לידה *</label><input name="ownerBirthDate" type="date" defaultValue={app?.ownerBirthDate} required className={`${field} ltr-num`} /></div>
              <div><label className={label}>נייד *</label><input name="ownerPhone" defaultValue={app?.ownerPhone || business?.phone} required className={`${field} ltr-num`} /></div>
              <div><label className={label}>אימייל</label><input name="ownerEmail" type="email" defaultValue={app?.ownerEmail || props.userEmail} className={`${field} ltr-num`} /></div>
            </div>
            <OwnerAddress app={app} />
            <button type="submit" disabled={oPending} className={primary}>{oPending ? 'שומר…' : 'שמירה והמשך'}</button>
          </form>
        )}

        {step === 'bank' && (
          <form action={kAction} className="space-y-4">
            <Err s={kState} />
            <p className="text-sm text-[var(--muted)]">החשבון שאליו הסולק יעביר את הכספים. חייב להיות על שם העסק או בעלת העסק.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className={label}>בנק *</label>
                <select name="bankCode" defaultValue={app?.bankCode ?? ''} required className={field}>
                  <option value="">בחרי</option>
                  {props.banks.map((b) => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
                </select>
              </div>
              <div><label className={label}>סניף *</label><input name="bankBranch" defaultValue={app?.bankBranch} required inputMode="numeric" className={`${field} ltr-num`} /></div>
              <div><label className={label}>מספר חשבון *</label><input name="bankAccount" defaultValue={app?.bankAccount} required inputMode="numeric" className={`${field} ltr-num`} /></div>
            </div>
            <h3 className="pt-2 text-sm font-semibold">כמה שאלות שהסולק שואל</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className={label}>עסקאות בחודש (משוער)</label><input name="monthlyTransactions" defaultValue={app?.monthlyTransactions ?? ''} inputMode="numeric" className={`${field} ltr-num`} /></div>
              <div><label className={label}>סכום ממוצע לעסקה (₪)</label><input name="averageAmount" defaultValue={app?.averageAmount ?? ''} inputMode="decimal" className={`${field} ltr-num`} /></div>
              <div><label className={label}>סכום מקסימלי לעסקה (₪)</label><input name="maxAmount" defaultValue={app?.maxAmount ?? ''} inputMode="decimal" className={`${field} ltr-num`} /></div>
              <div><label className={label}>מספר תשלומים טיפוסי</label><input name="typicalInstallments" defaultValue={app?.typicalInstallments ?? ''} inputMode="numeric" className={`${field} ltr-num`} /></div>
              <div><label className={label}>עד כמה תשלומים לאפשר</label><input name="maxInstallments" type="number" min={1} max={36} defaultValue={app?.maxInstallments ?? 12} className={`${field} ltr-num`} /></div>
              <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="clearedBefore" defaultChecked={app?.clearedBefore} /> העסק סלק כרטיסי אשראי בעבר</label>
            </div>
            <button type="submit" disabled={kPending} className={primary}>{kPending ? 'שומר…' : 'שמירה והמשך'}</button>
          </form>
        )}

        {step === 'documents' && (
          <form action={dAction} className="space-y-4">
            <Err s={dState} />
            <p className="text-sm text-[var(--muted)]">צילום או PDF. הקבצים נשמרים באחסון פרטי ומועברים לסולק בלבד.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className={label}>צילום תעודת זהות (כולל ספח) * {app?.hasIdFile && <Badge tone="green">הועלה</Badge>}</label><input name="idFile" type="file" accept="image/*,application/pdf" className={field} required={!app?.hasIdFile} /></div>
              <div><label className={label}>אישור ניהול חשבון בנק * {app?.hasBankFile && <Badge tone="green">הועלה</Badge>}</label><input name="bankFile" type="file" accept="image/*,application/pdf" className={field} required={!app?.hasBankFile} /></div>
              <div><label className={label}>תעודת עוסק / התאגדות {app?.hasCertificateFile && <Badge tone="green">הועלה</Badge>}</label><input name="certificateFile" type="file" accept="image/*,application/pdf" className={field} /></div>
            </div>
            <button type="submit" disabled={dPending} className={primary}>{dPending ? 'מעלה…' : 'שמירה והמשך'}</button>
          </form>
        )}

        {step === 'connect' && (
          <div className="space-y-5">
            {submitted ? (
              <Alert tone="success" title="הבקשה נשלחה לקארדקום">
                {app?.submittedAt && <span>נשלחה ב-{app.submittedAt}. </span>}
                קארדקום בודקת את הפרטים והמסמכים, בדרך כלל יום-יומיים. כשהחשבון יאושר המסוף יחובר כאן אוטומטית.
              </Alert>
            ) : business?.cardcomConnected ? (
              <Alert tone="success" title="קארדקום מחוברת">
                מסוף <span className="ltr-num">{business.cardcomTerminal}</span>. כל תשלום וחשבונית עוברים דרכו.
              </Alert>
            ) : null}

            {!submitted && (
              <div className="flex gap-2 text-sm">
                <button type="button" onClick={() => setMode('apply')} className={`rounded-lg border px-3 py-1.5 ${mode === 'apply' ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300' : 'border-[var(--border)]'}`}>פתיחת חשבון סליקה דרך המערכת</button>
                <button type="button" onClick={() => setMode('existing')} className={`rounded-lg border px-3 py-1.5 ${mode === 'existing' ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300' : 'border-[var(--border)]'}`}>יש לי כבר חשבון קארדקום</button>
              </div>
            )}

            {!submitted && mode === 'apply' && (
              <div className="space-y-3">
                <p className="text-sm">
                  הבקשה נשלחת לקארדקום עם הפרטים והמסמכים שהזנת. הן פותחות עבורך חשבון סליקה על שמך; המערכת מנהלת אותו מכאן.
                </p>
                {!props.supplierConfigured && (
                  <Alert tone="info">
                    הסכם השותפים עם קארדקום עדיין לא הופעל. הבקשה תישמר כמוכנה ותישלח אוטומטית ברגע שהחיבור יופעל — לא צריך להזין שוב.
                  </Alert>
                )}
                {sMsg && (sMsg.ok ? <Alert tone="success">{sMsg.message}</Alert> : <Alert tone="error">{sMsg.error}</Alert>)}
                <button
                  type="button"
                  disabled={sPending}
                  onClick={() => start(async () => { const r = await submitApplicationAction(); setSMsg(r); router.refresh(); })}
                  className={primary}
                >
                  {sPending ? 'שולח…' : app?.status === 'READY' ? 'הבקשה מוכנה — לשלוח שוב' : 'שליחת הבקשה לקארדקום'}
                </button>
              </div>
            )}

            {!submitted && mode === 'existing' && (
              <form action={cAction} className="space-y-3">
                <p className="text-sm">מספר המסוף ופרטי ה-API מופיעים בממשק הניהול של קארדקום תחת "הגדרות → API". הסיסמה נשמרת מוצפנת.</p>
                {!props.cryptoConfigured && <Alert tone="error">המערכת אינה מוגדרת לשמירת סודות (CREDENTIALS_KEY חסר).</Alert>}
                <Err s={cState} />
                {cState?.ok && <Alert tone="success">{cState.message}</Alert>}
                <div className="grid gap-4 sm:grid-cols-3">
                  <div><label className={label}>מספר מסוף</label><input name="terminal" defaultValue={business?.cardcomTerminal} required inputMode="numeric" className={`${field} ltr-num`} /></div>
                  <div><label className={label}>שם משתמש API</label><input name="apiName" defaultValue={business?.cardcomApiName} required className={`${field} ltr-num`} autoComplete="off" /></div>
                  <div><label className={label}>סיסמת API</label><input name="apiPassword" type="password" required className={`${field} ltr-num`} autoComplete="new-password" /></div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="submit" disabled={cPending || !props.cryptoConfigured} className={primary}>{cPending ? 'בודק מול קארדקום…' : 'בדיקה וחיבור'}</button>
                  {business?.cardcomConnected && (
                    <button type="button" disabled={sPending} onClick={() => start(async () => { await disconnectCardcomAction(); router.refresh(); })} className="rounded-lg px-3 py-2 text-sm text-amber-700 hover:bg-amber-50 dark:text-amber-400">ניתוק</button>
                  )}
                </div>
              </form>
            )}

            {(business?.cardcomConnected || submitted) && (
              <div className="border-t border-[var(--border)] pt-4">
                <Link href="/" className={primary}>למערכת</Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OwnerAddress({ app }: { app: AppView | null }) {
  const [same, setSame] = useState(!app?.ownerCity);
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sameAddress" checked={same} onChange={(e) => setSame(e.target.checked)} /> כתובת המגורים זהה לכתובת העסק</label>
      {!same && (
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2"><label className={label}>רחוב</label><input name="ownerStreet" defaultValue={app?.ownerStreet} className={field} /></div>
          <div><label className={label}>מספר</label><input name="ownerHouseNumber" defaultValue={app?.ownerHouseNumber} className={`${field} ltr-num`} /></div>
          <div><label className={label}>מיקוד</label><input name="ownerZip" defaultValue={app?.ownerZip} className={`${field} ltr-num`} /></div>
          <div className="sm:col-span-2"><label className={label}>עיר</label><input name="ownerCity" defaultValue={app?.ownerCity} className={field} /></div>
        </div>
      )}
    </div>
  );
}
