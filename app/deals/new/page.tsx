import Link from 'next/link';
import { getActiveBusinessOrNull } from '@/lib/services/business';
import { Alert } from '@/components/ui';
import { DealForm } from './deal-form';
import { toDateInputValue } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function NewDealPage() {
  const business = await getActiveBusinessOrNull();
  if (!business) {
    return (
      <Alert tone="info" title="לא הוגדר עסק">
        <Link href="/onboarding" className="underline">פתחי קודם את העסק שלך</Link>.
      </Alert>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">עסקה חדשה</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          מי, מה, כמה ובכמה תשלומים. המסמך יופק אחר כך מתוך התקבולים שיירשמו על העסקה.
        </p>
      </div>
      <DealForm defaultDate={toDateInputValue(new Date())} />
    </div>
  );
}
