import { prisma } from '../db';
import { getInvoiceProvider } from '../invoicing';
import { vatRateBpAt } from '../vat';
import type { DocType } from '@prisma/client';
import type { ProviderDocument } from '../invoicing/provider';

export type SyncResult = {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

const KIND_TO_DOC_TYPE: Record<string, DocType> = {
  TAX_INVOICE: 'TAX_INVOICE',
  TAX_INVOICE_RECEIPT: 'TAX_INVOICE_RECEIPT',
  RECEIPT: 'RECEIPT',
  CREDIT_INVOICE: 'CREDIT_INVOICE',
  OTHER_DOC: 'OTHER_DOC',
};

/**
 * הופך מסמך של הספק לשדות המסמך אצלנו.
 * הוצא החוצה כפונקציה טהורה כדי שההחלטה מה נספר בדוח המע"מ תהיה ניתנת לבדיקה
 * בלי לגעת ב-API — כאן נקבע אם חשבונית זיכוי תקטין את ההכנסות או תיבלע.
 */
export function toDocumentData(businessId: string, doc: ProviderDocument) {
  const docType = KIND_TO_DOC_TYPE[doc.documentKind] ?? 'OTHER_DOC';

  // קבלה מתעדת תקבול על חשבונית שכבר דווחה — ספירה שלה תיצור כפל בדוח.
  const countsForVat =
    docType === 'TAX_INVOICE' || docType === 'TAX_INVOICE_RECEIPT' || docType === 'CREDIT_INVOICE';
  const isZeroRated = countsForVat && doc.vatAgorot === 0 && doc.netAgorot > 0;

  return {
    businessId,
    direction: 'INCOME' as const,
    docType,
    status: 'CONFIRMED' as const,
    issueDate: doc.issueDate,
    reportDate: doc.issueDate,
    number: doc.documentNumber,
    counterpartyName: doc.customerName,
    counterpartyVatId: doc.customerVatId,
    netAgorot: doc.netAgorot,
    vatAgorot: doc.vatAgorot,
    totalAgorot: doc.totalAgorot,
    vatRateBp: vatRateBpAt(doc.issueDate),
    isCredit: doc.isCredit,
    vatTreatment: !countsForVat
      ? ('NO_VAT' as const)
      : isZeroRated
        ? ('ZERO_RATED' as const)
        : ('STANDARD' as const),
    source: 'CARDCOM' as const,
    externalId: doc.externalId,
    ocrRaw: doc.raw as object,
  };
}

/**
 * מושך מקארדקום את המסמכים שהופקו בטווח תאריכים ומכניס אותם לספר ההכנסות.
 *
 * המסמכים נכנסים ישירות במצב CONFIRMED — הם הופקו על ידי מערכת מוסמכת ואין
 * מה לאשר בהם ידנית. קבלות בלבד (RECEIPT) אינן עסקה לצורכי מע"מ ולכן מסומנות
 * NO_VAT: הן מתעדות תקבול על חשבונית שכבר דווחה, וספירה שלהן תיצור כפל.
 */
export async function syncCardcomDocuments(args: {
  businessId: string;
  fromDate: Date;
  toDate: Date;
}): Promise<SyncResult> {
  const result: SyncResult = { fetched: 0, created: 0, updated: 0, skipped: 0, errors: [] };
  const provider = getInvoiceProvider();

  const documents = await provider.listDocuments({ fromDate: args.fromDate, toDate: args.toDate });
  result.fetched = documents.length;

  for (const doc of documents) {
    try {
      const data = toDocumentData(args.businessId, doc);

      const existing = await prisma.document.findUnique({
        where: {
          businessId_source_externalId: {
            businessId: args.businessId,
            source: 'CARDCOM',
            externalId: doc.externalId,
          },
        },
        select: { id: true, vatPeriod: { select: { status: true } } },
      });

      // אותה חשבונית עשויה להיות כבר בספרים ממקור אחר — למשל קובץ PDF שנקלט
      // מהדרייב. בלי הבדיקה הזו הסנכרון היה סופר אותה פעם שנייה ומנפח את
      // ההכנסות. ההתאמה היא לפי מספר המסמך והכיוון, שהם הזיהוי החשבונאי שלה.
      if (!existing) {
        const sameDocument = await prisma.document.findFirst({
          where: {
            businessId: args.businessId,
            direction: 'INCOME',
            number: doc.documentNumber,
            source: { not: 'CARDCOM' },
          },
          select: { id: true },
        });
        if (sameDocument) {
          result.skipped++;
          continue;
        }
      }

      if (existing) {
        // מסמך ששויך לתקופה שכבר דווחה לא משתנה — שינוי רטרואקטיבי יסתור את הדוח שהוגש.
        if (existing.vatPeriod?.status === 'FILED') {
          result.skipped++;
          continue;
        }
        await prisma.document.update({ where: { id: existing.id }, data });
        result.updated++;
      } else {
        await prisma.document.create({ data });
        result.created++;
      }
    } catch (error) {
      result.errors.push(`מסמך ${doc.documentNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await prisma.business.update({
    where: { id: args.businessId },
    data: { cardcomLastSyncAt: new Date() },
  });

  return result;
}
