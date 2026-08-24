/**
 * ייבוא תיקיית מסמכים לספרים.
 *
 *   npm run import -- <נתיב לתיקייה> [--dry] [--concurrency=3] [--rpm=10] [--direction=EXPENSE]
 *
 * --rpm מגביל את מספר הקריאות ל-Gemini בדקה. המכסה של התוכנית החינמית צפופה,
 * וחריגה ממנה מקבלת ניסיון חוזר אוטומטי — אבל עדיף לא להגיע אליה מלכתחילה.
 *
 * הכיוון נגזר משם התיקייה (הוצאות / חשבוניות / קבלות). --direction קובע ברירת
 * מחדל לקבצים שלא נמצא להם כלל מתאים.
 * --dry מציג מה ייקלט בלי לקרוא ל-AI ובלי לכתוב למסד.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// טוען .env.local — הסקריפט רץ מחוץ ל-Next ולכן לא מקבל אותו אוטומטית
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const { prisma } = await import('../lib/db');
const { collectCandidates, importCandidates } = await import('../lib/services/import-folder');

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry');
const concurrency = Number(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? 3);
const requestsPerMinute = Number(args.find((a) => a.startsWith('--rpm='))?.split('=')[1] ?? 10);
const defaultDirection = args.find((a) => a.startsWith('--direction='))?.split('=')[1] as
  | 'INCOME'
  | 'EXPENSE'
  | undefined;

if (!root) {
  console.error('שימוש: npm run import -- <נתיב לתיקייה> [--dry] [--concurrency=3] [--rpm=10] [--direction=EXPENSE]');
  process.exit(1);
}

const business = await prisma.business.findFirst({ orderBy: { createdAt: 'asc' } });
if (!business) {
  console.error('לא הוגדר עסק במערכת. יש להזין את פרטי העסק במסך ההגדרות תחילה.');
  process.exit(1);
}

console.log(`עסק: ${business.name} · ע.מ ${business.vatId}`);
console.log(`סורק ${resolve(root)}…\n`);

const { candidates, skipped } = await collectCandidates(resolve(root), { defaultDirection });

const byDirection = candidates.reduce<Record<string, number>>((acc, c) => {
  acc[c.direction] = (acc[c.direction] ?? 0) + 1;
  return acc;
}, {});

console.log(`נמצאו ${candidates.length} מסמכים לקליטה:`);
console.log(`   הכנסות: ${byDirection.INCOME ?? 0}`);
console.log(`   הוצאות: ${byDirection.EXPENSE ?? 0}`);
if (skipped.length) {
  console.log(`\nמדולגים (${skipped.length}):`);
  for (const s of skipped.slice(0, 15)) console.log(`   ${s.path} — ${s.reason}`);
  if (skipped.length > 15) console.log(`   … ועוד ${skipped.length - 15}`);
}

if (dryRun) {
  console.log('\n--dry: לא בוצעה קריאה ל-AI ולא נכתב דבר למסד.');
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`\nמתחיל ייבוא ב-${concurrency} במקביל, עד ${requestsPerMinute} קריאות לדקה. כל מסמך נכנס כטיוטה לאישור.\n`);
const started = Date.now();

const results = await importCandidates(business, candidates, {
  concurrency,
  requestsPerMinute,
  onProgress: (done, total, last) => {
    const mark = last.status === 'imported' ? (last.method === 'text' ? '✓' : '◆') : last.status === 'duplicate' ? '·' : '✗';
    const note = last.status === 'failed' ? ` — ${last.error.slice(0, 70)}` : '';
    console.log(`[${String(done).padStart(3)}/${total}] ${mark} ${last.relativePath}${note}`);
  },
});

const imported = results.filter((r) => r.status === 'imported');
const duplicates = results.filter((r) => r.status === 'duplicate');
const failed = results.filter((r) => r.status === 'failed');
const lowConfidence = imported.filter((r) => r.status === 'imported' && r.confidence < 0.8);
const byText = imported.filter((r) => r.status === 'imported' && r.method === 'text');
const byAi = imported.filter((r) => r.status === 'imported' && r.method === 'ai');

console.log(`\n${'─'.repeat(60)}`);
console.log(`נקלטו:    ${imported.length}  (${byText.length} מטקסט המסמך · ${byAi.length} בקריאת AI)`);
console.log(`כפילויות: ${duplicates.length}`);
console.log(`נכשלו:    ${failed.length}`);
if (lowConfidence.length) console.log(`ביטחון נמוך (כדאי לבדוק ידנית): ${lowConfidence.length}`);
console.log(`זמן: ${Math.round((Date.now() - started) / 1000)} שניות`);

if (failed.length) {
  console.log('\nכשלונות:');
  for (const f of failed) if (f.status === 'failed') console.log(`   ${f.relativePath} — ${f.error.slice(0, 120)}`);
}

console.log('\nכל המסמכים ממתינים לאישור במסכי ההוצאות וההכנסות.');
await prisma.$disconnect();
