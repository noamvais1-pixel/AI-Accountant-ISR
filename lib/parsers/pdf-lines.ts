/**
 * שורות הטקסט של PDF, ב-JavaScript טהור (pdf.js).
 *
 * pdftotext (poppler) אינו מותקן בשרת של Vercel, ולקריאת פרטי התשלום מכל
 * מסמך של קארדקום צריך משהו שרץ בכל מקום. pdf.js מחזיר מקטעי טקסט עם מיקום;
 * כאן הם מקובצים לשורות לפי גובה וממוינים משמאל לימין. העברית חוזרת בסדר
 * לוגי, כך שביטויים רגולריים על "תאריך" ו"סכום" עובדים ישירות.
 */
export async function extractPdfLines(bytes: Buffer | Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;
  const out: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const rows: { y: number; items: { x: number; s: string }[] }[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const y = item.transform[5];
        const x = item.transform[4];
        const row = rows.find((r) => Math.abs(r.y - y) <= 2);
        if (row) row.items.push({ x, s: item.str });
        else rows.push({ y, items: [{ x, s: item.str }] });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        out.push(row.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim());
      }
    }
  } finally {
    await doc.cleanup();
  }
  return out;
}
