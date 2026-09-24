import { prisma } from '../db';
import { encryptSecret, isCryptoConfigured } from '../crypto';
import { listDocuments } from '../cardcom/client';
import type { Business, MerchantApplication } from '@prisma/client';

/**
 * פתיחת עסק במערכת ובקשה לחשבון סליקה.
 *
 * העסק נפתח בצעד הראשון ומשויך למי שפתחה אותו. שאר הצעדים ממלאים את הבקשה
 * לסולק. חיבור לחשבון סליקה קיים (מסוף + פרטי API) נבדק מול הסולק לפני שמירה,
 * והסיסמה נשמרת מוצפנת בלבד.
 */

export type Step = 'business' | 'owner' | 'bank' | 'documents' | 'connect';
export const STEPS: { key: Step; label: string }[] = [
  { key: 'business', label: 'העסק' },
  { key: 'owner', label: 'בעלת העסק' },
  { key: 'bank', label: 'חשבון בנק' },
  { key: 'documents', label: 'מסמכים' },
  { key: 'connect', label: 'סליקה' },
];

export async function applicationFor(businessId: string): Promise<MerchantApplication> {
  return prisma.merchantApplication.upsert({ where: { businessId }, update: {}, create: { businessId } });
}

/** אילו צעדים הושלמו — נגזר מהנתונים, לא נשמר בנפרד */
export function completedSteps(business: Business, app: MerchantApplication | null): Record<Step, boolean> {
  const owner = Boolean(app?.ownerFirstName && app?.ownerLastName && app?.ownerIdentityNumber && app?.ownerBirthDate && app?.ownerIdIssueDate);
  const bank = Boolean(app?.bankCode && app?.bankBranch && app?.bankAccount);
  const documents = Boolean(app?.idFileKey && app?.bankFileKey);
  const connect = Boolean(business.cardcomTerminal && business.cardcomApiName && business.cardcomApiPasswordEnc) || app?.status === 'SUBMITTED' || app?.status === 'APPROVED';
  return { business: Boolean(business.name && business.vatId && business.city && app?.street), owner, bank, documents, connect };
}

export async function connectExistingCardcom(
  businessId: string,
  creds: { terminal: string; apiName: string; apiPassword: string },
): Promise<void> {
  if (!isCryptoConfigured()) throw new Error('המערכת אינה מוגדרת לשמירת סודות (CREDENTIALS_KEY חסר).');
  const terminalNumber = Number(creds.terminal.replace(/\D/g, ''));
  if (!terminalNumber) throw new Error('מספר המסוף חייב להיות מספר.');
  if (!creds.apiName.trim() || !creds.apiPassword) throw new Error('יש להזין שם משתמש וסיסמת API.');

  // בדיקה אמיתית מול הסולק לפני שמירה: פרטים שגויים לא נשמרים
  const config = { baseUrl: process.env.CARDCOM_BASE_URL || 'https://secure.cardcom.solutions', terminalNumber, apiName: creds.apiName.trim(), apiPassword: creds.apiPassword };
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 3600 * 1000);
  try {
    await listDocuments(config, { fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10) });
  } catch (error) {
    throw new Error(`קארדקום דחתה את הפרטים: ${error instanceof Error ? error.message : String(error)}`);
  }

  await prisma.business.update({
    where: { id: businessId },
    data: { cardcomTerminal: String(terminalNumber), cardcomApiName: creds.apiName.trim(), cardcomApiPasswordEnc: encryptSecret(creds.apiPassword) },
  });
}

export async function disconnectCardcom(businessId: string): Promise<void> {
  await prisma.business.update({ where: { id: businessId }, data: { cardcomApiName: null, cardcomApiPasswordEnc: null } });
}

/** רשימת הבנקים בישראל לטופס — קוד ושם. */
export const ISRAELI_BANKS: { code: string; name: string }[] = [
  { code: '10', name: 'לאומי' },
  { code: '12', name: 'הפועלים' },
  { code: '11', name: 'דיסקונט' },
  { code: '20', name: 'מזרחי טפחות' },
  { code: '31', name: 'הבינלאומי' },
  { code: '04', name: 'יהב' },
  { code: '14', name: 'אוצר החייל' },
  { code: '17', name: 'מרכנתיל דיסקונט' },
  { code: '46', name: 'מסד' },
  { code: '52', name: 'פועלי אגודת ישראל' },
  { code: '54', name: 'ירושלים' },
  { code: '26', name: 'יובנק' },
  { code: '13', name: 'איגוד' },
  { code: '09', name: 'בנק הדואר' },
  { code: '18', name: 'וואן זירו' },
  { code: '22', name: 'סיטיבנק' },
  { code: '23', name: 'HSBC' },
];
