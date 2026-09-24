import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/server';
import { getActiveBusinessOrNull } from '@/lib/services/business';
import { completedSteps, STEPS, ISRAELI_BANKS, type Step } from '@/lib/services/onboarding';
import { supplierConfigFromEnv } from '@/lib/cardcom/onboarding';
import { isCryptoConfigured } from '@/lib/crypto';
import { toDateInputValue } from '@/lib/format';
import { Wizard } from './wizard';

export const dynamic = 'force-dynamic';

/**
 * פתיחת עסק ובקשת חשבון סליקה, בחמישה צעדים. כל צעד נשמר בנפרד; אפשר לחזור
 * ולהמשיך. הצעד האחרון שולח את הבקשה לקארדקום דרך הסכם השותפים, או מחבר
 * חשבון קארדקום קיים.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const user = await requireUser();
  const business = await getActiveBusinessOrNull();
  const app = business ? await prisma.merchantApplication.findUnique({ where: { businessId: business.id } }) : null;
  const done = business ? completedSteps(business, app) : { business: false, owner: false, bank: false, documents: false, connect: false };
  const { step: requested } = await searchParams;
  const firstOpen = STEPS.find((s) => !done[s.key])?.key ?? 'connect';
  const step: Step = business && STEPS.some((s) => s.key === requested) ? (requested as Step) : business ? firstOpen : 'business';

  const kyc = (app?.kycAnswers ?? {}) as Record<string, unknown>;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{business ? `${business.name} — פתיחת חשבון סליקה` : 'ברוכה הבאה'}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {business
            ? 'כמה פרטים שהסולק צריך, ומהרגע שהחשבון מאושר — כל תשלום, חשבונית ודוח נעשים מכאן.'
            : 'נפתח את העסק שלך במערכת ונגיש בקשה לחשבון סליקה. לוקח כמה דקות, ואפשר לעצור ולהמשיך.'}
        </p>
      </div>
      <Wizard
        step={step}
        done={done}
        userEmail={user.email}
        banks={ISRAELI_BANKS}
        supplierConfigured={supplierConfigFromEnv() !== null}
        cryptoConfigured={isCryptoConfigured()}
        business={
          business
            ? {
                name: business.name,
                vatId: business.vatId,
                legalType: business.legalType,
                vatFrequency: business.vatFrequency,
                city: business.city ?? '',
                phone: business.phone ?? '',
                email: business.email ?? '',
                hasLogo: Boolean(business.logoFileKey),
                cardcomTerminal: business.cardcomTerminal ?? '',
                cardcomApiName: business.cardcomApiName ?? '',
                cardcomConnected: Boolean(business.cardcomApiName && business.cardcomApiPasswordEnc),
              }
            : null
        }
        application={
          app
            ? {
                status: app.status,
                street: app.street ?? '',
                houseNumber: app.houseNumber ?? '',
                zip: app.zip ?? '',
                activity: app.activity ?? '',
                websiteUrl: app.websiteUrl ?? '',
                ownerFirstName: app.ownerFirstName ?? '',
                ownerLastName: app.ownerLastName ?? '',
                ownerIdentityNumber: app.ownerIdentityNumber ?? '',
                ownerIdIssueDate: app.ownerIdIssueDate ? toDateInputValue(app.ownerIdIssueDate) : '',
                ownerBirthDate: app.ownerBirthDate ? toDateInputValue(app.ownerBirthDate) : '',
                ownerPhone: app.ownerPhone ?? '',
                ownerEmail: app.ownerEmail ?? '',
                ownerStreet: app.ownerStreet ?? '',
                ownerHouseNumber: app.ownerHouseNumber ?? '',
                ownerCity: app.ownerCity ?? '',
                ownerZip: app.ownerZip ?? '',
                bankCode: app.bankCode ?? '',
                bankBranch: app.bankBranch ?? '',
                bankAccount: app.bankAccount ?? '',
                maxInstallments: app.maxInstallments,
                monthlyTransactions: (kyc.monthlyTransactions as number | null) ?? null,
                averageAmount: (kyc.averageAmount as number | null) ?? null,
                maxAmount: (kyc.maxAmount as number | null) ?? null,
                typicalInstallments: (kyc.typicalInstallments as number | null) ?? null,
                clearedBefore: Boolean(kyc.clearedBefore),
                hasIdFile: Boolean(app.idFileKey),
                hasBankFile: Boolean(app.bankFileKey),
                hasCertificateFile: Boolean(app.certificateFileKey),
                submittedAt: app.submittedAt ? toDateInputValue(app.submittedAt) : null,
              }
            : null
        }
      />
    </div>
  );
}
