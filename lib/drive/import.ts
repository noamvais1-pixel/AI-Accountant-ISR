import { prisma } from '../db';
import { getAccessToken, googleConfigFromEnv } from './client';
import { ingestDocument, alreadyIngested, fingerprint } from '../services/ingest';
import type { Business } from '@prisma/client';

/**
 * קליטת מסמכים מתיקייה קיימת בגוגל דרייב.
 *
 * העבודה נעשית באצוות קטנות ולא בריצה אחת ארוכה: בפריסה לענן לכל בקשה יש תקרת
 * זמן, וסריקה של מאות מסמכים חוצה אותה בוודאות. הלקוח קורא שוב ושוב עד שאין
 * יותר מה לקלוט, וכל אצווה עומדת בפני עצמה.
 */

const API = 'https://www.googleapis.com/drive/v3';

const IMPORTABLE_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  md5Checksum?: string;
  size?: string;
  parents?: string[];
};

async function driveGet(accessToken: string, path: string, params: Record<string, string>) {
  const url = `${API}/${path}?${new URLSearchParams(params)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 403 && /insufficient|scope/i.test(body)) {
      throw new Error(
        'אין הרשאת קריאה לדרייב. יש להתחבר מחדש לדרייב במסך ההגדרות כדי לאשר קריאת התיקייה.',
      );
    }
    throw new Error(`קריאה מדרייב נכשלה (${response.status}): ${body.slice(0, 200)}`);
  }
  return response.json();
}

/** מוצא תיקייה לפי שם. מחזיר null אם אינה קיימת או שאין אליה גישה. */
export async function findFolderByName(accessToken: string, name: string): Promise<string | null> {
  const escaped = name.replace(/'/g, "\\'");
  const json = await driveGet(accessToken, 'files', {
    q: `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name)',
    pageSize: '5',
  });
  return json.files?.[0]?.id ?? null;
}

/** כל הקבצים שניתן לקלוט, בתיקייה ובתת-תיקיות שלה. */
export async function listImportableFiles(accessToken: string, folderId: string): Promise<DriveFile[]> {
  const found: DriveFile[] = [];
  const queue = [folderId];
  // תקרת בטיחות מפני תיקייה שמצביעה על עצמה
  const seen = new Set<string>();

  while (queue.length && seen.size < 200) {
    const parent = queue.shift()!;
    if (seen.has(parent)) continue;
    seen.add(parent);

    let pageToken: string | undefined;
    do {
      const params: Record<string, string> = {
        q: `'${parent}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id,name,mimeType,md5Checksum,size)',
        pageSize: '200',
      };
      if (pageToken) params.pageToken = pageToken;
      const json = await driveGet(accessToken, 'files', params);

      for (const file of (json.files ?? []) as DriveFile[]) {
        if (file.mimeType === 'application/vnd.google-apps.folder') queue.push(file.id);
        else if (IMPORTABLE_MIME.has(file.mimeType)) found.push(file);
      }
      pageToken = json.nextPageToken;
    } while (pageToken);
  }

  return found;
}

async function downloadFile(accessToken: string, fileId: string): Promise<Buffer> {
  const response = await fetch(`${API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`הורדת הקובץ נכשלה (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export type DriveImportSummary = {
  scanned: number;
  imported: number;
  duplicates: number;
  failed: number;
  remaining: number;
  errors: string[];
};

/**
 * קולט עד `limit` מסמכים חדשים מהתיקייה. מחזיר כמה נשארו, כדי שהלקוח יידע
 * אם להמשיך לאצווה הבאה.
 *
 * הכיוון נקבע לפי שם התיקייה רק כברירת מחדל; מסמך שאפשר לקרוא את הטקסט שלו
 * קובע בעצמו אם הוא הכנסה או הוצאה.
 */
export async function importFromDriveFolder(args: {
  business: Business;
  folderName: string;
  limit?: number;
}): Promise<DriveImportSummary> {
  const { business, folderName } = args;
  const limit = Math.max(1, Math.min(args.limit ?? 5, 20));
  const summary: DriveImportSummary = {
    scanned: 0, imported: 0, duplicates: 0, failed: 0, remaining: 0, errors: [],
  };

  if (!business.driveRefreshToken) throw new Error('גוגל דרייב אינו מחובר.');

  const config = googleConfigFromEnv();
  const accessToken = await getAccessToken(config, business.driveRefreshToken);

  const folderId = await findFolderByName(accessToken, folderName);
  if (!folderId) throw new Error(`התיקייה "${folderName}" לא נמצאה בדרייב.`);

  const files = await listImportableFiles(accessToken, folderId);
  summary.scanned = files.length;

  // הדדופליקציה היא לפי תוכן הקובץ. ה-md5 שדרייב מספק מאפשר לזהות קובץ שכבר
  // נקלט בלי להוריד אותו — חוסך את רוב העבודה בהרצות החוזרות.
  const pending: DriveFile[] = [];
  for (const file of files) {
    if (file.md5Checksum && (await alreadyIngested(business.id, `md5:${file.md5Checksum}`))) continue;
    pending.push(file);
  }

  const batch = pending.slice(0, limit);
  for (const file of batch) {
    try {
      const data = await downloadFile(accessToken, file.id);

      // מזהה לפי md5 כשיש, אחרת לפי תוכן הקובץ שהורד
      const externalId = file.md5Checksum ? `md5:${file.md5Checksum}` : fingerprint(data);

      const result = await ingestDocument({
        business,
        data,
        mimeType: file.mimeType,
        extension: EXTENSION_BY_MIME[file.mimeType] ?? '',
        direction: /הוצא|expense/i.test(file.name) ? 'EXPENSE' : 'INCOME',
        externalId,
      });

      if (result.status === 'imported') summary.imported++;
      else summary.duplicates++;
    } catch (error) {
      summary.failed++;
      summary.errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  summary.remaining = Math.max(0, pending.length - batch.length);

  await prisma.business.update({
    where: { id: business.id },
    data: { driveImportSyncAt: new Date() },
  });

  return summary;
}
