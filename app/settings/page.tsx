import { prisma } from '@/lib/db';
import { getActiveBusinessOrNull } from '@/lib/services/business';
import { isGoogleConfigured } from '@/lib/drive/client';
import { DrivePanel } from './drive-panel';
import { DriveImportPanel } from './drive-import-panel';
import { getInvoiceProvider } from '@/lib/invoicing';
import { Panel, Alert, Badge } from '@/components/ui';
import { BusinessForm } from './business-form';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

function ConfigRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-3 last:border-0">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-[var(--muted)]">{detail}</div>
      </div>
      <Badge tone={ok ? 'green' : 'amber'}>{ok ? 'מוגדר' : 'חסר'}</Badge>
    </div>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ driveConnected?: string; driveError?: string }>;
}) {
  const business = await getActiveBusinessOrNull();
  const provider = getInvoiceProvider();
  const params = await searchParams;

  const [pendingBackup, backedUp] = business
    ? await Promise.all([
        prisma.document.count({ where: { businessId: business.id, fileKey: { not: null }, driveFileId: null } }),
        prisma.document.count({ where: { businessId: business.id, driveFileId: { not: null } } }),
      ])
    : [0, 0];

  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasCardcom = provider.isConfigured();
  const dryRun = process.env.CARDCOM_DRY_RUN !== 'false';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">הגדרות</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">פרטי העסק וחיבורים חיצוניים.</p>
      </div>

      {!business && (
        <Alert tone="info" title="ברוכה הבאה">
          כדי להתחיל, מלאי את פרטי העסק. מספר העוסק נדרש לכל דוח מע"מ ולקובץ הדיווח המקוון.
        </Alert>
      )}

      <Panel title="פרטי העסק">
        <BusinessForm business={business} />
      </Panel>

      <Panel title="חיבורים">
        <ConfigRow
          label="Gemini — קריאת קבלות מצילום"
          ok={hasGemini}
          detail={hasGemini ? `מודל: ${process.env.GEMINI_MODEL || 'gemini-3.6-flash'}` : 'הוסיפי GEMINI_API_KEY לקובץ .env.local'}
        />
        <ConfigRow
          label="קארדקום — משיכת חשבוניות והפקתן"
          ok={hasCardcom}
          detail={
            hasCardcom
              ? `מסוף ${process.env.CARDCOM_TERMINAL_NUMBER}${business?.cardcomLastSyncAt ? ` · סונכרן לאחרונה ${formatDateTime(business.cardcomLastSyncAt)}` : ' · טרם סונכרן'}`
              : 'הוסיפי CARDCOM_TERMINAL_NUMBER, CARDCOM_API_NAME ו-CARDCOM_API_PASSWORD לקובץ .env.local'
          }
        />
        <ConfigRow
          label="גוגל דרייב — גיבוי הצילומים"
          ok={Boolean(business?.driveAccountEmail)}
          detail={
            business?.driveAccountEmail
              ? `${business.driveAccountEmail} · ${backedUp} מגובים${pendingBackup ? `, ${pendingBackup} ממתינים` : ''}`
              : 'הצילומים נשמרים מקומית בלבד, ללא גיבוי'
          }
        />
        <ConfigRow
          label="רשות המסים — הגשה אוטומטית"
          ok={false}
          detail="טרם מחובר. כרגע הדוח מופק כקובץ PCN874 להעלאה ידנית באזור האישי."
        />
      </Panel>

      <Panel title="קליטת מסמכים מהדרייב">
        <div className="p-5">
          <DriveImportPanel
            connected={Boolean(business?.driveAccountEmail)}
            folderName={business?.driveImportFolder || 'עסק'}
          />
        </div>
      </Panel>

      <Panel title="גיבוי הצילומים">
        <DrivePanel
          configured={isGoogleConfigured()}
          connectedEmail={business?.driveAccountEmail ?? null}
          pendingCount={pendingBackup}
          backedUpCount={backedUp}
          rootFolderName={process.env.DRIVE_FOLDER_NAME || 'רואה חשבון AI'}
          notice={
            params.driveError
              ? { tone: 'error', text: params.driveError }
              : params.driveConnected
                ? { tone: 'success', text: `הדרייב חובר בהצלחה${params.driveConnected !== '1' ? ` — ${params.driveConnected}` : ''}.` }
                : null
          }
        />
      </Panel>

      {hasCardcom && dryRun && (
        <Alert tone="warning" title="מצב בטיחות פעיל">
          הפקת חשבוניות אמיתיות בקארדקום חסומה. חשבונית שהופקה היא מסמך חוקי שאי אפשר למחוק — רק לבטל בזיכוי.
          כשתהיי מוכנה, שני בקובץ <code className="ltr-num">.env.local</code> את{' '}
          <code className="ltr-num">CARDCOM_DRY_RUN</code> ל-<code className="ltr-num">false</code> והפעילי מחדש את השרת.
        </Alert>
      )}
    </div>
  );
}
