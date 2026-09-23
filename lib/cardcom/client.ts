/**
 * לקוח HTTP ל-CardCom API v11.
 * המפרט הרשמי: https://secure.cardcom.solutions/Api/v11/Docs
 *
 * כל הקריאות הן POST עם JSON, והאימות נשלח בגוף הבקשה (ApiName / ApiPassword)
 * ולא בכותרת — כך קארדקום בנו את ה-API.
 */

export type CardcomConfig = {
  baseUrl: string;
  terminalNumber: number;
  apiName: string;
  apiPassword: string;
};

export function cardcomConfigFromEnv(): CardcomConfig {
  const { CARDCOM_TERMINAL_NUMBER, CARDCOM_API_NAME, CARDCOM_API_PASSWORD, CARDCOM_BASE_URL } = process.env;
  const missing = [
    !CARDCOM_TERMINAL_NUMBER && 'CARDCOM_TERMINAL_NUMBER',
    !CARDCOM_API_NAME && 'CARDCOM_API_NAME',
    !CARDCOM_API_PASSWORD && 'CARDCOM_API_PASSWORD',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`חסרים פרטי קארדקום בקובץ .env.local: ${missing.join(', ')}`);
  }
  return {
    baseUrl: CARDCOM_BASE_URL || 'https://secure.cardcom.solutions',
    terminalNumber: Number(CARDCOM_TERMINAL_NUMBER),
    apiName: CARDCOM_API_NAME!,
    apiPassword: CARDCOM_API_PASSWORD!,
  };
}

export class CardcomError extends Error {
  constructor(
    message: string,
    readonly responseCode: number,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = 'CardcomError';
  }
}

type CardcomResponse = { ResponseCode?: number; Description?: string };

async function call<T extends CardcomResponse>(
  config: CardcomConfig,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `${config.baseUrl}/api/v11/${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ApiName: config.apiName, ApiPassword: config.apiPassword, ...body }),
  });

  if (!response.ok) {
    throw new CardcomError(`קארדקום החזירה שגיאת HTTP ${response.status}`, response.status, endpoint);
  }

  const json = (await response.json()) as T;
  // ResponseCode 0 = הצלחה. כל ערך אחר הוא שגיאה, גם כאשר ה-HTTP הוא 200.
  if (json.ResponseCode !== 0) {
    throw new CardcomError(
      json.Description || `קארדקום החזירה קוד שגיאה ${json.ResponseCode}`,
      json.ResponseCode ?? -1,
      endpoint,
    );
  }
  return json;
}

// ---------------------------------------------------------------------------
// סוגי מסמכים
// ---------------------------------------------------------------------------

/** הערכים המותרים בשדה DocumentTypeToCreate בעת הפקת מסמך (מחרוזת). */
export type CardcomDocumentToCreate =
  | 'TaxInvoice'
  | 'TaxInvoiceAndReceipt'
  | 'Receipt'
  | 'ProformaInvoice'
  | 'TaxInvoiceRefund'
  | 'TaxInvoiceAndReceiptRefund'
  | 'ReceiptRefund';

/**
 * שדה InvoiceType שחוזר מ-GetReport הוא מספר — האינדקס באנומרציה DocumentType.
 * המיפוי הזה מתורגם ממנה.
 */
export const CARDCOM_DOC_TYPE_BY_ID: Record<number, string> = {
  0: 'Error',
  1: 'TaxInvoiceAndReceipt',
  2: 'TaxInvoiceAndReceiptRefund',
  3: 'Receipt',
  4: 'ReceiptRefund',
  5: 'Quote',
  6: 'Order',
  7: 'SiteCustomerOrder',
  8: 'SiteCustomerOrderRefund',
  9: 'DeliveryNote',
  10: 'DeliveryNoteRefund',
  11: 'ProformaInvoice',
  12: 'DemandForPayment',
  13: 'DemandForPaymentRefund',
  14: 'TaxInvoice',
  15: 'TaxInvoiceRefund',
  16: 'ReceiptForTaxInvoice',
  17: 'DonationReceipt',
  18: 'DonationReceiptRefund',
  19: 'ReceiptForTaxInvoiceRefund',
};

/** הסוג שלנו שאליו ממופה כל סוג מסמך של קארדקום. */
export type OurDocumentKind = 'TAX_INVOICE' | 'TAX_INVOICE_RECEIPT' | 'RECEIPT' | 'CREDIT_INVOICE' | 'OTHER_DOC';

/**
 * טבלת המיפוי המלאה מסוגי המסמכים של קארדקום לסוגים שלנו — נקודת האמת היחידה.
 *
 * סוג שאינו מופיע כאן פשוט לא נכנס לספרים: הצעת מחיר, הזמנה ותעודת משלוח אינן
 * אירוע חשבונאי. מסמך מסוג לא מוכר מדולג במפורש ולא נבלע בשקט.
 */
export const CARDCOM_TYPE_MAP: Record<number, { kind: OurDocumentKind; isCredit: boolean }> = {
  1: { kind: 'TAX_INVOICE_RECEIPT', isCredit: false }, // חשבונית מס/קבלה
  2: { kind: 'CREDIT_INVOICE', isCredit: true }, // זיכוי של חשבונית מס/קבלה
  3: { kind: 'RECEIPT', isCredit: false }, // קבלה
  4: { kind: 'RECEIPT', isCredit: true }, // זיכוי קבלה
  14: { kind: 'TAX_INVOICE', isCredit: false }, // חשבונית מס
  15: { kind: 'CREDIT_INVOICE', isCredit: true }, // חשבונית זיכוי
  16: { kind: 'RECEIPT', isCredit: false }, // קבלה על חשבונית מס
  19: { kind: 'RECEIPT', isCredit: true }, // זיכוי קבלה על חשבונית מס
};

/** האם הסוג הזה נכנס לספרים בכלל. */
export function isImportableDocType(typeId: number): boolean {
  return typeId in CARDCOM_TYPE_MAP;
}

// ---------------------------------------------------------------------------
// הפקת מסמך
// ---------------------------------------------------------------------------

export type CardcomProduct = {
  Description: string;
  Quantity: number;
  UnitCost: number;
  TotalLineCost?: number;
  IsVatFree?: boolean;
  ProductID?: string;
};

export type CreateDocumentInput = {
  documentType: CardcomDocumentToCreate;
  customerName: string;
  customerTaxId?: string;
  email?: string;
  sendByEmail?: boolean;
  addressLine1?: string;
  city?: string;
  phone?: string;
  comments?: string;
  isVatFree?: boolean;
  products: CardcomProduct[];
  documentDate?: string; // YYYY-MM-DD
  externalId?: string;
  /** סכום ששולם במזומן — משפיע על סוג המסמך שנוצר בפועל. */
  cash?: number;
};

export type CreateDocumentResult = {
  documentNumber: number;
  documentType: string;
  accountId: number;
  documentUrl: string | null;
  description: string;
};

export async function createDocument(
  config: CardcomConfig,
  input: CreateDocumentInput,
): Promise<CreateDocumentResult> {
  type Response = CardcomResponse & {
    DocumentNumber: number;
    DocumentType: string;
    AccountId: number;
    DocumentUrl?: string;
  };

  const json = await call<Response>(config, 'Documents/CreateDocument', {
    TerminalNumber: config.terminalNumber,
    Document: {
      DocumentTypeToCreate: input.documentType,
      Name: input.customerName,
      TaxId: input.customerTaxId,
      Email: input.email,
      IsSendByEmail: input.sendByEmail ?? false,
      AddressLine1: input.addressLine1,
      City: input.city,
      Phone: input.phone,
      Comments: input.comments,
      IsVatFree: input.isVatFree ?? false,
      DocumentDate: input.documentDate,
      ExternalId: input.externalId,
      Languge: 'he',
      ISOCoinID: 1,
      Products: input.products,
    },
    ...(input.cash !== undefined ? { Cash: input.cash } : {}),
  });

  return {
    documentNumber: json.DocumentNumber,
    documentType: json.DocumentType,
    accountId: json.AccountId,
    documentUrl: json.DocumentUrl ?? null,
    description: json.Description ?? '',
  };
}

// ---------------------------------------------------------------------------
// שליפת מסמכים קיימים
// ---------------------------------------------------------------------------

export type CardcomDocument = {
  Invoice_Number: number;
  InvoiceType: number;
  InvoiceDate: string;
  InvoiceDateOnly: string;
  ValueDate: string; // תאריך ערך — מועד התשלום
  Cust_Name: string;
  Comp_ID: string;
  Email: string;
  TotalNoVatNIS: number;
  VATOnlyNIS: number;
  TotalIncludeVATNIS: number;
  TotalVatFreeNIS: number;
  IsNegetive: boolean;
  Terminal_Number: number;
  ExternalId: string;
  UserComments: string;
};

/**
 * שולף את כל המסמכים בטווח תאריכים.
 * ה-API מחזיר עד 200 מסמכים בעמוד — הפונקציה מדפדפת עד הסוף.
 *
 * ברירת המחדל היא DocType -2 ("כל המסמכים") ולא -1 ("כל החשבוניות").
 * התיעוד של קארדקום מגדיר בנפרד -3 = "Refund only", ולכן אי אפשר לדעת ממנו
 * אם -1 כולל חשבוניות זיכוי או מסנן אותן החוצה. זיכוי שלא נמשך היה מנפח את
 * ההכנסות ואת המע"מ לתשלום בלי שאיש ישים לב, ולכן מושכים הכל ומסננים אצלנו
 * לפי CARDCOM_TYPE_MAP — כך ההחלטה מה נכנס לספרים היא שלנו ולא של פרשנות למפרט.
 */
export async function listDocuments(
  config: CardcomConfig,
  args: { fromDate: string; toDate: string; docType?: number },
): Promise<CardcomDocument[]> {
  type Response = CardcomResponse & { Documents: CardcomDocument[]; Page: number; Count: number };

  const all: CardcomDocument[] = [];
  const itemsPerPage = 200;
  let page = 1;

  // תקרת בטיחות: 100 עמודים = 20,000 מסמכים. מעבר לזה כנראה יש באג בדפדוף.
  for (; page <= 100; page++) {
    const json = await call<Response>(config, 'Documents/GetReport', {
      FromDateYYYYMMDD: args.fromDate.replace(/-/g, ''),
      ToDateYYYYMMDD: args.toDate.replace(/-/g, ''),
      DocType: args.docType ?? -2, // -2 = כל המסמכים; הסינון נעשה אצלנו
      // CoinId אינו נשלח בכוונה. התיעוד אומר ש-0 הוא "כל המטבעות", אבל בפועל
      // הוא מחזיר אפס מסמכים עם קוד הצלחה — כלומר תקלה שנראית כמו מסוף ריק.
      // השמטת השדה מחזירה את כל המסמכים.
      OpenClose: 0,
      PageNumber: page,
      ItemsPerPage: itemsPerPage,
    });

    const batch = json.Documents ?? [];
    all.push(...batch);
    if (batch.length < itemsPerPage) break;
  }

  return all;
}

// ---------------------------------------------------------------------------
// ביטול מסמך
// ---------------------------------------------------------------------------

export async function cancelDocument(
  config: CardcomConfig,
  args: { documentNumber: number; documentTypeId: number; sendEmail?: boolean },
): Promise<{ newDocumentNumber: number; newDocumentType: number }> {
  type Response = CardcomResponse & { NewDocumentNumber: number; NewDocumentType: number };

  const json = await call<Response>(config, 'Documents/CancelDoc', {
    TerminalNumber: config.terminalNumber,
    DocumentNumber: args.documentNumber,
    DocumentType: args.documentTypeId,
    IsCancelEmailSend: !(args.sendEmail ?? false),
  });

  return { newDocumentNumber: json.NewDocumentNumber, newDocumentType: json.NewDocumentType };
}

// ---------------------------------------------------------------------------
// עסקאות אשראי בתשלומים
// ---------------------------------------------------------------------------

export type CardcomInstallmentTransaction = {
  amountAgorot: number;
  date: string; // YYYY-MM-DD
  installments: number;
  firstAgorot: number;
  constAgorot: number;
};

/**
 * מסמכי קארדקום אינם נושאים את מספר התשלומים — רק העסקה עצמה. ה-endpoint הזה
 * משתמש במוסכמות אחרות מזה של המסמכים: תאריכים ב-DDMMYYYY, ו-Page/Page_size.
 */
export async function listInstallmentTransactions(
  config: CardcomConfig,
  args: { fromDate: string; toDate: string },
): Promise<CardcomInstallmentTransaction[]> {
  const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
  type Row = { Amount: number; CreateDate: string; NumberOfPayments: number; FirstPaymentAmount: number; ConstPaymentAmount: number };
  const out: CardcomInstallmentTransaction[] = [];
  for (let page = 1; page <= 20; page++) {
    const json = await call<CardcomResponse & { Tranzactions?: Row[] }>(config, 'Transactions/ListTransactions', {
      TerminalNumber: config.terminalNumber,
      FromDate: ddmmyyyy(args.fromDate),
      ToDate: ddmmyyyy(args.toDate),
      Page: page,
      Page_size: 500,
    });
    const rows = json.Tranzactions ?? [];
    for (const r of rows) {
      if (Number(r.NumberOfPayments) > 1) {
        out.push({
          amountAgorot: Math.round(Number(r.Amount) * 100),
          date: String(r.CreateDate).slice(0, 10),
          installments: Number(r.NumberOfPayments),
          firstAgorot: Math.round(Number(r.FirstPaymentAmount) * 100),
          constAgorot: Math.round(Number(r.ConstPaymentAmount) * 100),
        });
      }
    }
    if (rows.length < 500) break;
  }
  return out;
}
