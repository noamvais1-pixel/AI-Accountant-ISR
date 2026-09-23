/**
 * העברת הספרים מהמחשב המקומי לענן.
 *
 *   npm run migrate:cloud -- [--dry] [--skip-files]
 *
 * מעביר שלושה דברים: סכימה, נתונים, וקבצים סרוקים. הסקריפט בטוח להרצה חוזרת —
 * רשומה שכבר הועברה מזוהה לפי המזהה שלה, וקובץ שכבר הועלה מדולג.
 *
 * המקור נקרא מ-LOCAL_DATABASE_URL (ברירת מחדל: DATABASE_URL שבסביבה המקומית),
 * והיעד מ-CLOUD_DATABASE_URL.
 */
import { readFileSync } from 'node:fs';
import type { Prisma as PrismaTypes } from '@prisma/client';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const skipFiles = args.includes('--skip-files');

const sourceUrl = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
const targetUrl = process.env.CLOUD_DATABASE_URL;
if (!targetUrl) {
  console.error('חסר CLOUD_DATABASE_URL בקובץ .env.local — כתובת מסד הנתונים בענן.');
  process.exit(1);
}

const { PrismaClient, Prisma } = await import('@prisma/client');

/**
 * Prisma מבחין בין "שדה JSON ריק" לבין "לא לגעת בשדה", ולכן null שנקרא מהמקור
 * חייב להיכתב כ-DbNull ולא כ-null.
 */
function jsonSafe(row: Record<string, unknown>, fields: string[]) {
  const copy: Record<string, unknown> = { ...row };
  for (const f of fields) if (copy[f] === null) copy[f] = Prisma.DbNull;
  return copy;
}
const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });

const businesses = await source.business.findMany();
const contacts = await source.contact.findMany();
const periods = await source.vatPeriod.findMany();
const documents = await source.document.findMany();

console.log('במקור:');
console.log(`   עסקים ${businesses.length} · אנשי קשר ${contacts.length} · תקופות ${periods.length} · מסמכים ${documents.length}`);

if (dryRun) {
  console.log('\n--dry: לא נכתב דבר.');
  process.exit(0);
}

// הסדר חשוב: מסמך מצביע על עסק, איש קשר ותקופה, ולכן הם נכתבים לפניו.
for (const row of businesses) {
  await target.business.upsert({ where: { id: row.id }, create: row, update: row });
}
console.log(`עסקים: ${businesses.length}`);

for (const row of contacts) {
  await target.contact.upsert({ where: { id: row.id }, create: row, update: row });
}
console.log(`אנשי קשר: ${contacts.length}`);

for (const row of periods) {
  const data = jsonSafe(row, ['snapshot']) as PrismaTypes.VatPeriodUncheckedCreateInput;
  await target.vatPeriod.upsert({ where: { id: row.id }, create: data, update: data });
}
console.log(`תקופות: ${periods.length}`);

let docsDone = 0;
for (const row of documents) {
  const data = jsonSafe(row, ['ocrRaw']) as PrismaTypes.DocumentUncheckedCreateInput;
  await target.document.upsert({ where: { id: row.id }, create: data, update: data });
  if (++docsDone % 50 === 0) console.log(`   מסמכים: ${docsDone}/${documents.length}`);
}
console.log(`מסמכים: ${documents.length}`);

// --- קבצים ---------------------------------------------------------------
if (!skipFiles) {
  const { createClient } = await import('@supabase/supabase-js');
  const { readFile } = await import('node:fs/promises');
  const { join, resolve, extname } = await import('node:path');

  const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'documents';
  const bucket = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  }).storage.from(bucketName);

  const MIME: Record<string, string> = {
    '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic',
  };

  const uploadDir = resolve(process.env.UPLOAD_DIR || './uploads');
  const keys = [...new Set(documents.map((d) => d.fileKey).filter((k): k is string => !!k))];
  console.log(`\nקבצים להעלאה: ${keys.length}`);

  let uploaded = 0, already = 0, failed = 0;
  for (const key of keys) {
    try {
      const bytes = await readFile(join(uploadDir, key));
      const { error } = await bucket.upload(key, bytes, {
        contentType: MIME[extname(key).toLowerCase()] ?? 'application/octet-stream',
        upsert: false,
      });
      if (error) {
        // קובץ שכבר קיים ביעד אינו שגיאה — הסקריפט נועד לרוץ שוב
        if (/exists/i.test(error.message)) already++;
        else { failed++; console.warn(`   ${key}: ${error.message}`); }
      } else uploaded++;
    } catch (e) {
      failed++;
      console.warn(`   ${key}: ${e instanceof Error ? e.message : e}`);
    }
    if ((uploaded + already + failed) % 50 === 0) {
      console.log(`   ${uploaded + already + failed}/${keys.length}`);
    }
  }
  console.log(`הועלו ${uploaded} · היו כבר ${already} · נכשלו ${failed}`);
}

await source.$disconnect();
await target.$disconnect();
console.log('\nההעברה הושלמה.');
