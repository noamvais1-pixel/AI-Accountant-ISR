import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { extractDocument } from '../ocr/gemini';
import { isAllowedMime, saveUpload } from '../storage';
import { createDraftFromExtraction, assignToPeriod } from './documents';
import { extractPdfText } from '../parsers/pdf-text';
import { parseHebrewInvoice, validateAmounts } from '../parsers/hebrew-invoice';
import type { ExtractedDocument } from '../ocr/schema';
import type { Business } from '@prisma/client';

/**
 * ייבוא בכמות של תיקיית מסמכים קיימת.
 *
 * נועד לטעינה ראשונית של ארכיון — למשל תיקיית הדרייב של העסק. כל מסמך עובר
 * את אותו צינור כמו צילום בודד ונכנס כטיוטה: גם ייבוא של מאות קבצים לא נכנס
 * לספרים בלי עין אנושית.
 */

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

/**
 * שם התיקייה קובע את כיוון המסמך בלבד.
 * את סוג המסמך ואת שאלת הזיכוי משאירים ל-AI, שקורא את הכותרת בפועל —
 * תיקייה יכולה להיות מסווגת בטעות, הכותרת המודפסת לא.
 */
export type DirectionRule = { folderPattern: RegExp; direction: 'INCOME' | 'EXPENSE' };

export const DEFAULT_DIRECTION_RULES: DirectionRule[] = [
  { folderPattern: /הוצאות|expenses/i, direction: 'EXPENSE' },
  { folderPattern: /חשבוניות\s*מס|חשבוניות\s*זיכוי|קבלות|invoices|receipts/i, direction: 'INCOME' },
];

export function directionForPath(relativePath: string, rules = DEFAULT_DIRECTION_RULES): 'INCOME' | 'EXPENSE' | null {
  // התיקייה החיצונית ביותר שמתאימה לכלל היא הקובעת — תת-תיקיות הן חלוקה לתקופות.
  for (const segment of relativePath.split('/')) {
    for (const rule of rules) {
      if (rule.folderPattern.test(segment)) return rule.direction;
    }
  }
  return null;
}

export type ImportCandidate = {
  path: string;
  relativePath: string;
  mimeType: string;
  direction: 'INCOME' | 'EXPENSE';
  sizeBytes: number;
};

/** סורק תיקייה ומחזיר את הקבצים שאפשר לקלוט, עם הכיוון שנגזר מהמיקום. */
export async function collectCandidates(
  root: string,
  options: { rules?: DirectionRule[]; defaultDirection?: 'INCOME' | 'EXPENSE' } = {},
): Promise<{ candidates: ImportCandidate[]; skipped: Array<{ path: string; reason: string }> }> {
  const candidates: ImportCandidate[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  async function walk(dir: string, relative: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(full, rel);
        continue;
      }

      const mimeType = MIME_BY_EXT[extname(entry.name).toLowerCase()];
      if (!mimeType || !isAllowedMime(mimeType)) {
        skipped.push({ path: rel, reason: 'סוג קובץ שאינו מסמך' });
        continue;
      }

      const direction = directionForPath(rel, options.rules) ?? options.defaultDirection ?? null;
      if (!direction) {
        skipped.push({ path: rel, reason: 'לא ניתן לקבוע אם זו הכנסה או הוצאה' });
        continue;
      }

      const { size } = await stat(full);
      if (size > 15 * 1024 * 1024) {
        skipped.push({ path: rel, reason: 'גדול מ-15MB' });
        continue;
      }

      candidates.push({ path: full, relativePath: rel, mimeType, direction, sizeBytes: size });
    }
  }

  await walk(root, '');
  return { candidates, skipped };
}

/** באיזו דרך נקראו הנתונים — טקסט מקורי או פענוח AI. */
export type ExtractionMethod = 'text' | 'ai';

export type ImportOutcome =
  | { relativePath: string; status: 'imported'; id: string; confidence: number; method: ExtractionMethod }
  | { relativePath: string; status: 'duplicate' }
  | { relativePath: string; status: 'failed'; error: string };

export type ImportProgress = (done: number, total: number, last: ImportOutcome) => void;

/**
 * בקרת קצב פשוטה: מרווח מינימלי בין קריאות ל-API, משותף לכל העובדים.
 * המכסה של Gemini נמדדת בקריאות לדקה, ובלעדיה ייבוא של עשרות מסמכים
 * נחסם כבר אחרי כמה שניות.
 */
class RateLimiter {
  private next = 0;

  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.minIntervalMs;
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  }
}

/**
 * טביעת אצבע של תוכן הקובץ. שני עותקים של אותה קבלה — גם בשמות שונים
 * ובתיקיות שונות — ייקלטו פעם אחת בלבד. האילוץ נאכף גם במסד, כך שגם הרצה
 * חוזרת של הייבוא לא תיצור כפילויות.
 */
function fingerprint(data: Buffer): string {
  return `sha256:${createHash('sha256').update(data).digest('hex').slice(0, 32)}`;
}

/**
 * מנסה לקרוא את המסמך מהטקסט שבתוכו, בלי AI.
 * מחזיר null אם אין טקסט, אם התבנית אינה מוכרת, או אם הסכומים לא מסתדרים —
 * בכל אחד מהמקרים האלה עדיף לשלוח את המסמך ל-AI מאשר לנחש.
 */
async function tryTextExtraction(
  business: Business,
  candidate: ImportCandidate,
): Promise<{ extracted: ExtractedDocument; raw: unknown; direction: 'INCOME' | 'EXPENSE' } | null> {
  if (candidate.mimeType !== 'application/pdf') return null;

  const text = await extractPdfText(candidate.path);
  if (!text) return null;

  const parsed = parseHebrewInvoice(text, { ownVatId: business.vatId, ownName: business.name });
  if (!parsed) return null;

  // בקבלה אין מע"מ ולכן אין מה לאמת מולו; בכל שאר המסמכים אימות הוא תנאי.
  if (parsed.documentKind !== 'RECEIPT' && validateAmounts(parsed)) return null;

  const extracted: ExtractedDocument = {
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
    // הטקסט הוא המקור עצמו ולא פרשנות שלו — אין כאן אי-ודאות של קריאה.
    confidence: 1,
    warnings: parsed.warnings,
  };

  return { extracted, raw: { method: 'pdftotext', parsed }, direction: parsed.direction };
}

/** התנגשות באילוץ ייחודיות — כלומר מסמך זהה כבר נכתב. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function importOne(
  business: Business,
  candidate: ImportCandidate,
  limiter: RateLimiter,
): Promise<ImportOutcome> {
  try {
    const data = await readFile(candidate.path);
    const externalId = fingerprint(data);

    const existing = await prisma.document.findUnique({
      where: {
        businessId_source_externalId: { businessId: business.id, source: 'SCAN', externalId },
      },
      select: { id: true },
    });
    if (existing) return { relativePath: candidate.relativePath, status: 'duplicate' };

    // קודם טקסט — חינמי, מיידי ומדויק. AI רק כשאין ברירה.
    let method: ExtractionMethod = 'text';
    let direction = candidate.direction;
    let result = await tryTextExtraction(business, candidate);

    if (result) {
      // המסמך עצמו יודע טוב יותר מהתיקייה מי הוציא אותו.
      direction = result.direction;
    } else {
      method = 'ai';
      await limiter.wait();
      const ai = await extractDocument({
        data,
        mimeType: candidate.mimeType,
        direction: candidate.direction,
        ownVatId: business.vatId,
      });
      result = { extracted: ai.extracted, raw: ai.raw, direction: candidate.direction };
    }

    const { extracted, raw } = result;

    const { key } = await saveUpload(
      new File([new Uint8Array(data)], basename(candidate.path), { type: candidate.mimeType }),
    );

    // הבדיקה למעלה אינה מספיקה: שני עובדים יכולים לבדוק את אותו קובץ בו-זמנית,
    // שניהם לא ימצאו רשומה, ושניהם ינסו לכתוב. האילוץ במסד הוא ההגנה האמיתית.
    let draft: { id: string };
    try {
      draft = await createDraftFromExtraction({
        businessId: business.id,
        extraction: extracted,
        direction,
        externalId,
        fileKey: key,
        fileMime: candidate.mimeType,
        rawResponse: raw,
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { relativePath: candidate.relativePath, status: 'duplicate' };
      throw error;
    }

    await assignToPeriod({
      businessId: business.id,
      documentId: draft.id,
      reportDate: new Date(extracted.issueDate ?? new Date()),
      frequency: business.vatFrequency,
    });

    return {
      relativePath: candidate.relativePath,
      status: 'imported',
      id: draft.id,
      confidence: extracted.confidence,
      method,
    };
  } catch (error) {
    if (isUniqueViolation(error)) return { relativePath: candidate.relativePath, status: 'duplicate' };
    const message = error instanceof Error ? error.message : String(error);
    return {
      relativePath: candidate.relativePath,
      status: 'failed',
      // הודעה ריקה מסתירה את הסיבה; עדיף שם המחלקה מאשר כלום.
      error: message.trim() || (error instanceof Error ? error.name : 'שגיאה לא ידועה'),
    };
  }
}

/**
 * מייבא את כל המועמדים. רץ בכמה עובדים במקביל — עיבוד סדרתי של מאות מסמכים
 * לוקח שעה, אבל יותר מדי במקביל שורף את מכסת ה-API ומחזיר שגיאות 429.
 */
export async function importCandidates(
  business: Business,
  candidates: ImportCandidate[],
  options: { concurrency?: number; onProgress?: ImportProgress; requestsPerMinute?: number } = {},
): Promise<ImportOutcome[]> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));
  const rpm = Math.max(1, options.requestsPerMinute ?? 10);
  const limiter = new RateLimiter(Math.ceil(60000 / rpm));
  const results: ImportOutcome[] = [];
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor++];
      const outcome = await importOne(business, candidate, limiter);
      results.push(outcome);
      options.onProgress?.(++done, candidates.length, outcome);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  return results;
}
