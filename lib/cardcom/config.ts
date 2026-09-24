import { cardcomConfigFromEnv, type CardcomConfig } from './client';
import { decryptSecret } from '../crypto';

/**
 * פרטי ההתחברות לקארדקום של עסק מסוים.
 *
 * לכל עסק המסוף שלו והסיסמה שלו (מוצפנת במסד). משתני הסביבה הם המסוף של
 * העסק הראשון בלבד — עסק אחר לעולם לא יקבל אותם, גם אם לא הגדיר פרטים משלו.
 * אחרת עסק חדש היה מפיק חשבוניות על המסוף של מישהי אחרת.
 */

type BusinessCreds = { cardcomTerminal: string | null; cardcomApiName: string | null; cardcomApiPasswordEnc: string | null };

function envTerminal(): string | null {
  return process.env.CARDCOM_TERMINAL_NUMBER?.trim() || null;
}

export function cardcomConfigFor(business: BusinessCreds): CardcomConfig {
  if (business.cardcomTerminal && business.cardcomApiName && business.cardcomApiPasswordEnc) {
    return {
      baseUrl: process.env.CARDCOM_BASE_URL || 'https://secure.cardcom.solutions',
      terminalNumber: Number(business.cardcomTerminal),
      apiName: business.cardcomApiName,
      apiPassword: decryptSecret(business.cardcomApiPasswordEnc),
    };
  }
  const env = envTerminal();
  if (env && (!business.cardcomTerminal || business.cardcomTerminal === env)) return cardcomConfigFromEnv();
  throw new Error('קארדקום אינה מחוברת לעסק הזה. חברי אותה במסך ההגדרות.');
}

export function isCardcomConnected(business: BusinessCreds): boolean {
  try {
    cardcomConfigFor(business);
    return true;
  } catch {
    return false;
  }
}
