/**
 * שכבת הפשטה להפקת חשבוניות.
 *
 * היום הספק היחיד הוא קארדקום. ההפשטה קיימת כדי שהחלפת ספק — או מעבר להפקה
 * עצמאית מול "חשבונית ישראל" — תדרוש מימוש חדש של הממשק הזה בלבד, בלי לגעת
 * במסכים או בדוחות.
 */

export type InvoiceLineInput = {
  description: string;
  quantity: number;
  unitPriceAgorot: number; // מחיר יחידה לפני מע"מ, באגורות
  isVatFree?: boolean;
};

export type IssueInvoiceInput = {
  documentKind: 'TAX_INVOICE' | 'TAX_INVOICE_RECEIPT' | 'RECEIPT' | 'PROFORMA' | 'CREDIT_INVOICE';
  customer: {
    name: string;
    vatId?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
  };
  lines: InvoiceLineInput[];
  issueDate?: Date;
  comments?: string;
  sendByEmail?: boolean;
  /** מזהה פנימי שלנו, נשמר אצל הספק כדי לאפשר התאמה חוזרת. */
  externalId?: string;
  /** האם כל המסמך פטור ממע"מ. */
  isVatFree?: boolean;
};

export type IssuedInvoice = {
  providerName: string;
  documentNumber: string;
  documentKind: string;
  documentUrl: string | null;
  /** מספר ההקצאה מרשות המסים, אם הספק החזיר אותו. */
  allocationNumber: string | null;
  raw: unknown;
};

export type ProviderDocument = {
  externalId: string;
  documentNumber: string;
  documentKind: 'TAX_INVOICE' | 'TAX_INVOICE_RECEIPT' | 'RECEIPT' | 'CREDIT_INVOICE' | 'OTHER_DOC';
  isCredit: boolean;
  issueDate: Date;
  customerName: string;
  customerVatId: string | null;
  customerEmail: string | null;
  netAgorot: number;
  vatAgorot: number;
  totalAgorot: number;
  vatFreeAgorot: number;
  raw: unknown;
};

export interface InvoiceProvider {
  readonly name: string;
  /** האם המערכת מוגדרת כראוי לעבודה מול הספק. */
  isConfigured(): boolean;
  /** מפיק מסמך חדש אצל הספק. פעולה בלתי הפיכה — המסמך הוא מסמך חוקי. */
  issueInvoice(input: IssueInvoiceInput): Promise<IssuedInvoice>;
  /** מבטל מסמך על ידי הפקת מסמך זיכוי נגדי. */
  cancelInvoice(args: { documentNumber: string; documentKind: string }): Promise<IssuedInvoice>;
  /** מושך את המסמכים שהופקו אצל הספק בטווח תאריכים. */
  listDocuments(args: { fromDate: Date; toDate: Date }): Promise<ProviderDocument[]>;
}
