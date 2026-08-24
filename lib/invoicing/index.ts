import { CardcomProvider } from './cardcom-provider';
import type { InvoiceProvider } from './provider';

export * from './provider';

let instance: InvoiceProvider | null = null;

/** מחזיר את ספק החשבוניות הפעיל. כרגע קארדקום; ההחלפה כאן בלבד. */
export function getInvoiceProvider(): InvoiceProvider {
  instance ??= new CardcomProvider();
  return instance;
}
