import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { extractDocument } from '../ocr/gemini';
import { saveBytes } from '../storage';
import { parseHebrewInvoice, validateAmounts } from '../parsers/hebrew-invoice';
import { createDraftFromExtraction, assignToPeriod } from './documents';
import type { ExtractedDocument } from '../ocr/schema';
import type { Business } from '@prisma/client';

/**
 * קליטת מסמך יחיד לספרים — נקודת הכניסה היחידה לכל מקור.
 *
 * צילום מהאתר, ייבוא מתיקייה מקומית וקליטה מגוגל דרייב מגיעים כולם לכאן, כדי
 * שכללי הזיהוי, הדדופליקציה והאימות יהיו זהים בכל מסלול ולא ישתנו בין מקור למקור.
 */

export type ExtractionMethod = 'text' | 'ai';

export type IngestResult =
  | { status: 'imported'; id: string; method: ExtractionMethod; confidence: number }
  | { status: 'duplicate' };

/** טביעת אצבע של התוכן: אותו קובץ בשמות שונים ייקלט פעם אחת בלבד. */
export function fingerprint(data: Buffer): string {
  return `sha256:${createHash('sha256').update(data).digest('hex').slice(0, 32)}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** האם המסמך כבר קיים בספרים, לפי תוכן הקובץ. */
export async function alreadyIngested(businessId: string, externalId: string): Promise<boolean> {
  const existing = await prisma.document.findUnique({
    where: { businessId_source_externalId: { businessId, source: 'SCAN', externalId } },
    select: { id: true },
  });
  return Boolean(existing);
}

/**
 * האם אותו מסמך כבר בספרים, גם אם הקובץ שונה.
 *
 * טביעת אצבע של הקובץ אינה מספיקה: אותה חשבונית נשמרת לעיתים פעמיים, פעם
 * כ"מקור" ופעם כ"העתק נאמן למקור". הקבצים שונים בבתים שלהם, אבל מדובר
 * באותו מסמך חשבונאי — וספירה כפולה מנפחת את ההכנסות.
 */
async function sameDocumentExists(args: {
  businessId: string;
  direction: 'INCOME' | 'EXPENSE';
  number: string;
  issueDate: Date;
  totalAgorot: number;
}): Promise<boolean> {
  if (!args.number || args.number === 'ללא מספר') return false;
  const existing = await prisma.document.findFirst({
    where: {
      businessId: args.businessId,
      direction: args.direction,
      number: args.number,
      issueDate: args.issueDate,
      totalAgorot: args.totalAgorot,
      status: { not: 'VOID' },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

/**
 * קריאת המסמך מהטקסט שבתוכו. מחזיר null אם אין טקסט, אם התבנית אינה מוכרת,
 * או אם הסכומים אינם מסתדרים — בכל אלה עדיף לשלוח ל-AI מאשר לנחש.
 * דורש קובץ על הדיסק, ולכן רלוונטי רק בהרצה מקומית.
 */
async function textExtraction(
  business: Business,
  localPath: string | null,
  mimeType: string,
): Promise<{ extracted: ExtractedDocument; raw: unknown; direction: 'INCOME' | 'EXPENSE' } | null> {
  if (!localPath || mimeType !== 'application/pdf') return null;

  const { extractPdfText } = await import('../parsers/pdf-text');
  const text = await extractPdfText(localPath);
  if (!text) return null;

  const parsed = parseHebrewInvoice(text, { ownVatId: business.vatId, ownName: business.name });
  if (!parsed) return null;
  if (parsed.documentKind !== 'RECEIPT' && validateAmounts(parsed)) return null;

  return {
    extracted: {
      documentKind: parsed.documentKind,
      isCredit: parsed.isCredit,
      counterpartyName: parsed.counterpartyName,
      counterpartyVatId: parsed.counterpartyVatId,
      documentNumber: parsed.documentNumber,
      allocationNumber: null,
      issueDate: parsed.issueDate,
      currency: 'ILS',
      netAmount: parsed.netAmount,
      vatAmount: parsed.vatAmount,
      totalAmount: parsed.totalAmount,
      vatRatePercent: parsed.vatRatePercent,
      categoryGuess: null,
      lineItems: null,
      // הטקסט הוא המקור עצמו ולא פרשנות שלו.
      confidence: 1,
      warnings: parsed.warnings,
    },
    raw: { method: 'pdftotext', parsed },
    direction: parsed.direction,
  };
}

export async function ingestDocument(args: {
  business: Business;
  data: Buffer;
  mimeType: string;
  extension: string;
  /** ברירת מחדל לכיוון; המסמך עצמו גובר עליה כשאפשר לקרוא אותו. */
  direction: 'INCOME' | 'EXPENSE';
  /** נתיב מקומי, אם קיים — מאפשר קריאת טקסט בלי AI. */
  localPath?: string | null;
  externalId?: string;
}): Promise<IngestResult> {
  const { business, data, mimeType, extension } = args;
  const externalId = args.externalId ?? fingerprint(data);

  if (await alreadyIngested(business.id, externalId)) return { status: 'duplicate' };

  let method: ExtractionMethod = 'text';
  let direction = args.direction;
  let result = await textExtraction(business, args.localPath ?? null, mimeType);

  if (result) {
    direction = result.direction;
  } else {
    method = 'ai';
    const ai = await extractDocument({ data, mimeType, direction, ownVatId: business.vatId });
    result = { extracted: ai.extracted, raw: ai.raw, direction };
  }

  // בדיקה שנייה, אחרי שהמסמך נקרא: אותו מסמך יכול להגיע בקובץ אחר לגמרי.
  const amounts = result.extracted;
  if (
    amounts.documentNumber &&
    amounts.issueDate &&
    (await sameDocumentExists({
      businessId: business.id,
      direction,
      number: amounts.documentNumber,
      issueDate: new Date(amounts.issueDate),
      totalAgorot: Math.round((amounts.totalAmount ?? 0) * 100),
    }))
  ) {
    return { status: 'duplicate' };
  }

  const key = await saveBytes(data, mimeType, extension);

  // הבדיקה למעלה אינה מספיקה: שתי קליטות במקביל של אותו קובץ יעברו אותה שתיהן.
  // האילוץ במסד הוא ההגנה האמיתית.
  let draft: { id: string };
  try {
    draft = await createDraftFromExtraction({
      businessId: business.id,
      extraction: result.extracted,
      direction,
      externalId,
      fileKey: key,
      fileMime: mimeType,
      rawResponse: result.raw,
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'duplicate' };
    throw error;
  }

  await assignToPeriod({
    businessId: business.id,
    documentId: draft.id,
    reportDate: new Date(result.extracted.issueDate ?? new Date()),
    frequency: business.vatFrequency,
  });

  return { status: 'imported', id: draft.id, method, confidence: result.extracted.confidence };
}
