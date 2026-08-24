import { prisma } from '../db';
import { readUpload } from '../storage';
import { periodForDate, type VatFrequency } from '../periods';
import { ensureFolder, getAccessToken, googleConfigFromEnv, sanitizeName, uploadFile } from './client';
import type { Business, Document } from '@prisma/client';

/**
 * גיבוי הצילומים לגוגל דרייב.
 *
 * הקובץ תמיד נשמר קודם מקומית, והגיבוי הוא שכבה נוספת מעליו. אם דרייב לא זמין
 * או ההרשאה פגה — הקליטה מצליחה בכל מקרה, והמסמך פשוט מסומן כלא מגובה.
 * גיבוי שנכשל אינו סיבה לאבד קבלה.
 */

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

/**
 * שם הקובץ בדרייב. הקובץ המקומי נקרא בשם אקראי (UUID) מטעמי אבטחה,
 * אבל בדרייב רוצים שם שאפשר לחפש לפיו בלי לפתוח את המערכת.
 * לדוגמה: 2026-07-12 מרכז הדפוס הדיגיטלי בעמ 2026-4471 3882.20.png
 */
export function driveFileName(doc: Pick<Document, 'issueDate' | 'counterpartyName' | 'number' | 'totalAgorot' | 'fileMime' | 'isCredit'>): string {
  const date = doc.issueDate.toISOString().slice(0, 10);
  const amount = (doc.totalAgorot / 100).toFixed(2);
  const credit = doc.isCredit ? ' זיכוי' : '';
  const extension = EXTENSION_BY_MIME[doc.fileMime ?? ''] ?? '';
  return `${sanitizeName(`${date} ${doc.counterpartyName}${credit} ${doc.number} ${amount}`)}${extension}`;
}

/** נתיב התיקיות בדרייב: <שורש>/<שנה>/<תקופת דיווח>/<הוצאות|הכנסות> */
export function driveFolderPath(
  doc: Pick<Document, 'reportDate' | 'direction'>,
  frequency: VatFrequency,
): string[] {
  const period = periodForDate(doc.reportDate, frequency);
  return [
    String(period.year),
    `${String(period.periodNo).padStart(2, '0')} ${period.label}`,
    doc.direction === 'EXPENSE' ? 'הוצאות' : 'הכנסות',
  ];
}

export function isDriveConnected(business: Pick<Business, 'driveRefreshToken'>): boolean {
  return Boolean(business.driveRefreshToken);
}

/**
 * מגבה מסמך יחיד. חוזר בשקט אם אין מה לגבות או שהמסמך כבר מגובה.
 * מחזיר את מזהה הקובץ בדרייב, או null אם דולג.
 */
export async function backupDocument(business: Business, doc: Document): Promise<string | null> {
  if (!doc.fileKey || doc.driveFileId || !business.driveRefreshToken) return null;

  const config = googleConfigFromEnv();
  const accessToken = await getAccessToken(config, business.driveRefreshToken);

  const rootName = process.env.DRIVE_FOLDER_NAME || 'רואה חשבון AI';
  let parentId = business.driveRootFolderId ?? (await ensureFolder(accessToken, rootName));

  if (!business.driveRootFolderId) {
    await prisma.business.update({ where: { id: business.id }, data: { driveRootFolderId: parentId } });
  }

  for (const segment of driveFolderPath(doc, business.vatFrequency)) {
    parentId = await ensureFolder(accessToken, segment, parentId);
  }

  const uploaded = await uploadFile(accessToken, {
    name: driveFileName(doc),
    mimeType: doc.fileMime || 'application/octet-stream',
    parentId,
    data: await readUpload(doc.fileKey),
    description: [
      doc.counterpartyName,
      doc.counterpartyVatId ? `ע.מ ${doc.counterpartyVatId}` : null,
      `מסמך ${doc.number}`,
      doc.allocationNumber ? `הקצאה ${doc.allocationNumber}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  });

  await prisma.document.update({
    where: { id: doc.id },
    data: { driveFileId: uploaded.id, driveBackedUpAt: new Date() },
  });

  return uploaded.id;
}

/**
 * גיבוי לא חוסם — לשימוש בזמן קליטת קבלה.
 * כישלון נבלע בכוונה: הקבלה כבר שמורה מקומית, והגיבוי יושלם בהרצה הבאה.
 */
export async function backupDocumentQuietly(business: Business, documentId: string): Promise<void> {
  try {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (doc) await backupDocument(business, doc);
  } catch (error) {
    console.warn('[drive] גיבוי נכשל, הקובץ שמור מקומית:', error instanceof Error ? error.message : error);
  }
}

export type BackupSummary = { pending: number; uploaded: number; failed: number; errors: string[] };

/** מגבה את כל המסמכים שיש להם קובץ ועדיין לא גובו. */
export async function backupPending(business: Business, limit = 200): Promise<BackupSummary> {
  const summary: BackupSummary = { pending: 0, uploaded: 0, failed: 0, errors: [] };
  if (!business.driveRefreshToken) {
    throw new Error('גוגל דרייב אינו מחובר.');
  }

  const pending = await prisma.document.findMany({
    where: { businessId: business.id, fileKey: { not: null }, driveFileId: null },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  summary.pending = pending.length;

  for (const doc of pending) {
    try {
      await backupDocument(business, doc);
      summary.uploaded++;
    } catch (error) {
      summary.failed++;
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${doc.counterpartyName} ${doc.number}: ${message}`);
      // הרשאה שפגה תיכשל על כל מסמך — אין טעם להמשיך ולשרוף קריאות.
      if (message.includes('חידוש ההרשאה')) break;
    }
  }

  return summary;
}
