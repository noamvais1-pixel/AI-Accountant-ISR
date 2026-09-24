import { CardcomProvider } from './cardcom-provider';
import { cardcomConfigFor } from '../cardcom/config';
import type { InvoiceProvider } from './provider';

export * from './provider';

type BusinessCreds = { cardcomTerminal: string | null; cardcomApiName: string | null; cardcomApiPasswordEnc: string | null };

/**
 * ספק החשבוניות של עסק מסוים. כרגע קארדקום; ההחלפה כאן בלבד.
 * עסק שאין לו חיבור מקבל ספק ש-isConfigured שלו שקר — המסכים מציגים הודעה.
 */
export function getInvoiceProvider(business: BusinessCreds): InvoiceProvider {
  try {
    return new CardcomProvider(cardcomConfigFor(business));
  } catch {
    return new CardcomProvider(unconfigured);
  }
}

/** config שמכשיל כל קריאה — כדי ש-isConfigured יחזיר שקר בלי לזרוק */
const unconfigured = null;
