import Link from 'next/link';
import { getActiveBusinessOrNull } from '@/lib/services/business';
import { getInvoiceProvider } from '@/lib/invoicing';
import { Alert } from '@/components/ui';
import { currentVatRateBp } from '@/lib/vat';
import { InvoiceForm } from './invoice-form';

export const dynamic = 'force-dynamic';

export default async function NewInvoicePage() {
  const business = await getActiveBusinessOrNull();
  if (!business) {
    return (
      <Alert tone="info" title="לא הוגדר עסק">
        <Link href="/settings" className="underline">
          הזיני קודם את פרטי העסק
        </Link>
        .
      </Alert>
    );
  }

  const provider = getInvoiceProvider();
  if (!provider.isConfigured()) {
    return (
      <Alert tone="warning" title="קארדקום אינה מחוברת">
        הפקת חשבוניות נעשית דרך קארדקום, שמטפלת גם במספרי ההקצאה מול רשות המסים. השלימי את פרטי ה-API בקובץ{' '}
        <code className="ltr-num">.env.local</code> והפעילי מחדש את השרת.
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">הפקת חשבונית</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          המסמך מופק בקארדקום ונרשם אוטומטית בספר ההכנסות.
        </p>
      </div>

      <InvoiceForm
        vatRateBp={currentVatRateBp()}
        today={new Date().toISOString().slice(0, 10)}
        dryRun={process.env.CARDCOM_DRY_RUN !== 'false'}
      />
    </div>
  );
}
