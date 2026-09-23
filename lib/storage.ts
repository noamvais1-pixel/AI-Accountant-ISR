import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * אחסון הקבצים הסרוקים.
 *
 * שני מימושים מאחורי אותו ממשק:
 * - דיסק מקומי, בהרצה על המחשב.
 * - Supabase Storage, בפריסה לענן — שם אין מערכת קבצים קבועה, וכל מה שנכתב
 *   לדיסק נעלם בפריסה הבאה.
 *
 * הבחירה נעשית לפי הימצאות הגדרות Supabase, כדי שאותו קוד ירוץ בשני המקומות.
 */

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'documents';

function useSupabaseStorage(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * לקוח עם הרשאת שירות. הוא עוקף את מדיניות הגישה של Supabase, ולכן הוא נוצר
 * רק בצד השרת ומפתחו לעולם אינו נשלח לדפדפן.
 */
async function storageClient() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  }).storage.from(STORAGE_BUCKET);
}

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

  if (useSupabaseStorage()) {
    const bucket = await storageClient();
    const { error } = await bucket.upload(key, bytes, { contentType: file.type, upsert: false });
    if (error) throw new Error(`שמירת הקובץ נכשלה: ${error.message}`);
    return { key, bytes };
  }

  const dir = uploadRoot();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, key), bytes);

  return { key, bytes };
}

/** שומר בתים שכבר נקראו (למשל בייבוא מדרייב), בלי לעבור דרך File. */
export async function saveBytes(bytes: Buffer, mimeType: string, extension: string): Promise<string> {
  const key = `${randomUUID()}${extension.toLowerCase()}`;
  if (useSupabaseStorage()) {
    const bucket = await storageClient();
    const { error } = await bucket.upload(key, bytes, { contentType: mimeType, upsert: false });
    if (error) throw new Error(`שמירת הקובץ נכשלה: ${error.message}`);
    return key;
  }
  const dir = uploadRoot();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, key), bytes);
  return key;
}

/**
 * מוחק קובץ שנשמר. משמש כשחילוץ הנתונים נכשל אחרי שהקובץ כבר נכתב —
 * בלי זה נשארים על הדיסק קבצים בלי רשומה במסד שאיש לא יידע עליהם.
 */
export async function deleteUpload(key: string): Promise<void> {
  if (useSupabaseStorage()) {
    const bucket = await storageClient();
    await bucket.remove([safeKey(key)]);
    return;
  }
  await rm(join(uploadRoot(), safeKey(key)), { force: true });
}

export async function readUpload(key: string): Promise<Buffer> {
  if (useSupabaseStorage()) {
    const bucket = await storageClient();
    const { data, error } = await bucket.download(safeKey(key));
    if (error || !data) throw new Error(`קריאת הקובץ נכשלה: ${error?.message ?? 'לא נמצא'}`);
    return Buffer.from(await data.arrayBuffer());
  }
  return readFile(join(uploadRoot(), safeKey(key)));
}
