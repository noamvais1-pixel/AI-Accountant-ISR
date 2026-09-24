import {
  cardcomConfigFromEnv,
  createDocument,
  listDocuments,
  cancelDocument,
  CARDCOM_DOC_TYPE_BY_ID,
  CARDCOM_TYPE_MAP,
  type CardcomConfig,
  type CardcomDocument,
  type CardcomDocumentToCreate,
  type CardcomProduct,
} from '../cardcom/client';
import { toAgorot, toShekels } from '../money';
import { netForExactTotal } from '../vat';
import { resolvePaymentDate } from '../cardcom/payment-date';
import { utcDate } from '../periods';
import { vatRateBpAt } from '../vat';
import type {
  InvoiceProvider,
  IssueInvoiceInput,
  IssuedInvoice,
  ProviderDocument,
} from './provider';

/** התיאור שמופיע בסעיף "פירוט" של המסמך לכל אופן תשלום */
const PAYMENT_DESCRIPTIONS: Record<NonNullable<IssueInvoiceInput['payments']>[number]['method'], string> = {
  CARD: 'כרטיס אשראי',
  BANK_TRANSFER: 'הפקדה בנקאית',
  BIT: 'ביט',
  CASH: 'מזומן',
  CHEQUE: 'שיק',
  OTHER: 'חיוב/זיכוי לקוחות',
};

const DOCUMENT_KIND_TO_CARDCOM: Record<IssueInvoiceInput['documentKind'], CardcomDocumentToCreate> = {
  TAX_INVOICE: 'TaxInvoice',
  TAX_INVOICE_RECEIPT: 'TaxInvoiceAndReceipt',
  RECEIPT: 'Receipt',
  PROFORMA: 'ProformaInvoice',
  CREDIT_INVOICE: 'TaxInvoiceRefund',
};

/** קארדקום מחזירה תאריך ISO; שומרים אותו כתאריך UTC בחצות כדי שלא יזוז יום. */
function parseCardcomDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return utcDate(Number(match[1]), Number(match[2]), Number(match[3]));
  const parsed = new Date(value);
  return utcDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * ממיר מסמך של קארדקום למסמך במונחים שלנו.
 * מחזיר null לסוג שאינו נכנס לספרים — הצעת מחיר, הזמנה, תעודת משלוח וכדומה.
 */
export function mapCardcomDocument(doc: CardcomDocument): ProviderDocument | null {
  const entry = CARDCOM_TYPE_MAP[doc.InvoiceType];
  if (!entry) return null;

  // IsNegetive הוא רשת ביטחון: אם קארדקום מסמנת מסמך כשלילי גם כשסוגו אינו
  // סוג זיכוי מוכר, עדיף לרשום אותו כזיכוי מאשר להוסיף אותו להכנסות.
  const isCredit = entry.isCredit || doc.IsNegetive;

  return {
    // מספר החשבונית לבדו אינו ייחודי בין סוגי מסמכים ומסופים — מרכיבים מפתח מורכב.
    externalId: `${doc.Terminal_Number}:${doc.InvoiceType}:${doc.Invoice_Number}`,
    documentNumber: String(doc.Invoice_Number),
    documentKind: entry.kind,
    isCredit,
    issueDate: parseCardcomDate(doc.InvoiceDateOnly || doc.InvoiceDate),
    // מועד התשלום מהמסמך עצמו; הסנכרון משפר אותו למועד החיוב כשיש עסקת
    // אשראי שמצביעה על המסמך. ראו lib/cardcom/payment-date.ts.
    paymentDate: resolvePaymentDate({
      invoiceDate: parseCardcomDate(doc.InvoiceDateOnly || doc.InvoiceDate),
      valueDate: doc.ValueDate ? parseCardcomDate(doc.ValueDate) : null,
      transferDate: doc.TransferDate ? parseCardcomDate(doc.TransferDate) : null,
    }),
    customerName: doc.Cust_Name || 'לקוח ללא שם',
    customerVatId: doc.Comp_ID?.trim() || null,
    customerEmail: doc.Email?.trim() || null,
    // הסכומים נשמרים תמיד חיוביים; הסימן מובע דרך isCredit.
    netAgorot: Math.abs(toAgorot(doc.TotalNoVatNIS ?? 0)),
    vatAgorot: Math.abs(toAgorot(doc.VATOnlyNIS ?? 0)),
    totalAgorot: Math.abs(toAgorot(doc.TotalIncludeVATNIS ?? 0)),
    vatFreeAgorot: Math.abs(toAgorot(doc.TotalVatFreeNIS ?? 0)),
    raw: doc,
  };
}

export class CardcomProvider implements InvoiceProvider {
  readonly name = 'cardcom';

  private config: CardcomConfig | null = null;

  private getConfig(): CardcomConfig {
    this.config ??= cardcomConfigFromEnv();
    return this.config;
  }

  isConfigured(): boolean {
    try {
      this.getConfig();
      return true;
    } catch {
      return false;
    }
  }

  /** מצב יבש — מונע הפקת מסמכים אמיתיים בטעות בזמן פיתוח. */
  private isDryRun(): boolean {
    return process.env.CARDCOM_DRY_RUN !== 'false';
  }

  async issueInvoice(input: IssueInvoiceInput): Promise<IssuedInvoice> {
    // האם המסוף מפרש את מחירי השורות ככוללים מע"מ. בדוח המסמכים של המסוף
    // הזה ValidateItemsisPriceIncludeVat=true, ולכן זו ברירת המחדל; אפשר לשנות
    // ב-CARDCOM_PRICES_INCLUDE_VAT. המחירים אצלנו מומרים לאותה מוסכמה, כדי
    // שסה"כ המסמך יהיה בדיוק הסכום ששולם.
    const terminalIncludesVat = process.env.CARDCOM_PRICES_INCLUDE_VAT !== 'false';
    const rateBp = vatRateBpAt(input.issueDate ?? new Date());
    const toUnit = (agorot: number, vatFree: boolean) => {
      if (vatFree || input.isVatFree) return agorot;
      const inputIncludesVat = input.pricesIncludeVat ?? false;
      if (inputIncludesVat === terminalIncludesVat) return agorot;
      // אצלנו נטו, במסוף כולל → מוסיפים מע"מ; אצלנו כולל, במסוף נטו → נטו שמחזיר בדיוק את הסכום
      return terminalIncludesVat ? agorot + Math.round((agorot * rateBp) / 10000) : netForExactTotal(agorot, rateBp);
    };
    const products: CardcomProduct[] = input.lines.map((line) => {
      const lineTotal = Math.round(line.unitPriceAgorot * line.quantity);
      const vatFree = line.isVatFree ?? false;
      return {
        Description: line.description,
        Quantity: line.quantity,
        UnitCost: toShekels(line.quantity === 1 ? toUnit(lineTotal, vatFree) : toUnit(line.unitPriceAgorot, vatFree)),
        // TotalLineCost מונע פערי עיגול כשהכמות עשרונית — קארדקום ממליצה לשלוח אותו.
        TotalLineCost: toShekels(toUnit(lineTotal, vatFree)),
        IsVatFree: vatFree,
      };
    });

    const payments = input.payments ?? [];
    const cashAgorot = payments.filter((p) => p.method === 'CASH').reduce((a, p) => a + p.amountAgorot, 0);
    const externalPayments = payments
      .filter((p) => p.method !== 'CASH')
      .map((p) => ({
        date: isoDateOnly(p.date),
        description: PAYMENT_DESCRIPTIONS[p.method],
        reference: p.reference,
        amount: toShekels(p.amountAgorot),
      }));
    const valueDate = payments.length
      ? isoDateOnly(payments.reduce((min, p) => (p.date < min ? p.date : min), payments[0].date))
      : undefined;

    if (this.isDryRun()) {
      throw new Error(
        'מצב בטיחות פעיל: הפקת חשבוניות חסומה. חשבונית שמופקת בקארדקום היא מסמך חוקי שאי אפשר למחוק — ' +
          'רק לבטל בזיכוי. כדי להפעיל הפקה אמיתית שני את CARDCOM_DRY_RUN ל-false בקובץ .env.local.',
      );
    }

    const result = await createDocument(this.getConfig(), {
      documentType: DOCUMENT_KIND_TO_CARDCOM[input.documentKind],
      customerName: input.customer.name,
      customerTaxId: input.customer.vatId,
      email: input.customer.email,
      sendByEmail: input.sendByEmail ?? false,
      addressLine1: input.customer.address,
      city: input.customer.city,
      phone: input.customer.phone,
      comments: input.comments,
      isVatFree: input.isVatFree,
      documentDate: input.issueDate ? isoDateOnly(input.issueDate) : undefined,
      valueDate,
      externalId: input.externalId,
      products,
      ...(cashAgorot > 0 ? { cash: toShekels(cashAgorot) } : {}),
      ...(externalPayments.length ? { externalPayments } : {}),
    });

    // המפתח שבו הסנכרון מזהה מסמכים: מסוף:סוג:מספר (ראו mapCardcomDocument)
    const typeId = Object.entries(CARDCOM_DOC_TYPE_BY_ID).find(([, name]) => name === result.documentType)?.[0];
    return {
      providerName: this.name,
      documentNumber: String(result.documentNumber),
      documentKind: result.documentType,
      documentUrl: result.documentUrl,
      // קארדקום מטפלת מול רשות המסים בהקצאה, אך אינה מחזירה את המספר בתשובה הזו.
      allocationNumber: null,
      externalId: typeId ? `${this.getConfig().terminalNumber}:${typeId}:${result.documentNumber}` : null,
      raw: result,
    };
  }

  async cancelInvoice(args: { documentNumber: string; documentKind: string }): Promise<IssuedInvoice> {
    if (this.isDryRun()) {
      throw new Error('מצב בטיחות פעיל: ביטול מסמכים בקארדקום חסום. שני את CARDCOM_DRY_RUN ל-false כדי לאפשר.');
    }
    const typeId = Number(
      Object.entries(CARDCOM_DOC_TYPE_BY_ID).find(([, name]) => name === args.documentKind)?.[0] ?? 14,
    );
    const result = await cancelDocument(this.getConfig(), {
      documentNumber: Number(args.documentNumber),
      documentTypeId: typeId,
    });
    return {
      providerName: this.name,
      documentNumber: String(result.newDocumentNumber),
      documentKind: CARDCOM_DOC_TYPE_BY_ID[result.newDocumentType] ?? String(result.newDocumentType),
      documentUrl: null,
      allocationNumber: null,
      externalId: `${this.getConfig().terminalNumber}:${result.newDocumentType}:${result.newDocumentNumber}`,
      raw: result,
    };
  }

  async listDocuments(args: { fromDate: Date; toDate: Date }): Promise<ProviderDocument[]> {
    const docs = await listDocuments(this.getConfig(), {
      fromDate: isoDateOnly(args.fromDate),
      toDate: isoDateOnly(args.toDate),
    });

    return docs.map(mapCardcomDocument).filter((d): d is ProviderDocument => d !== null);
  }
}
