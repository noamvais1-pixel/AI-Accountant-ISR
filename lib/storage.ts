import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * אחסון מקומי של הקבצים הסרוקים.
 * מכוון בכוונה לתיקייה על הדיסק ולא לענן — הקבלות הן מסמכים עסקיים,
 * ואין סיבה שיעזבו את המחשב עד שתהיה החלטה מפורשת אחרת.
 */

function uploadRoot(): string {
  return resolve(process.env.UPLOAD_DIR || './uploads');
}

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime);
}

/** מנטרל מעבר מחוץ לתיקייה גם אם המפתח הגיע ממקור חיצוני. */
function safeKey(key: string): string {
  const stripped = key.replace(/[/\\]/g, '');
  if (!stripped || stripped === '.' || stripped === '..') throw new Error('מפתח קובץ לא חוקי');
  return stripped;
}

export async function saveUpload(file: File): Promise<{ key: string; bytes: Buffer }> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = extname(file.name) || (file.type === 'application/pdf' ? '.pdf' : '.jpg');
  // שם הקובץ נקבע על ידינו ולא על ידי המשתמש — שם קובץ מהדפדפן עלול להכיל "../".
  const key = `${randomUUID()}${ext.toLowerCase()}`;

  const dir = uploadRoot();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, key), bytes);

  return { key, bytes };
}

/**
 * מוחק קובץ שנשמר. משמש כשחילוץ הנתונים נכשל אחרי שהקובץ כבר נכתב —
 * בלי זה נשארים על הדיסק קבצים בלי רשומה במסד שאיש לא יידע עליהם.
 */
export async function deleteUpload(key: string): Promise<void> {
  await rm(join(uploadRoot(), safeKey(key)), { force: true });
}

export async function readUpload(key: string): Promise<Buffer> {
  return readFile(join(uploadRoot(), safeKey(key)));
}
