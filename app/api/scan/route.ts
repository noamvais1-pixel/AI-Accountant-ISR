import { NextResponse } from 'next/server';
import { extractDocument } from '@/lib/ocr/gemini';
import { createDraftFromExtraction } from '@/lib/services/documents';
import { getActiveBusiness } from '@/lib/services/business';
import { deleteUpload, isAllowedMime, saveUpload } from '@/lib/storage';
import { backupDocumentQuietly } from '@/lib/drive/backup';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * קליטת קבלה מצילום: שומר את הקובץ, שולח ל-Gemini לחילוץ, ויוצר טיוטה.
 * הטיוטה תמיד ממתינה לאישור — קריאת AI לא נכנסת לספרים בלי עין אנושית.
 */
export async function POST(request: Request) {
  try {
    const business = await getActiveBusiness();
    const form = await request.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);

    if (!files.length) {
      return NextResponse.json({ error: 'לא נשלח קובץ.' }, { status: 400 });
    }

    const results: Array<{ fileName: string; id?: string; error?: string; confidence?: number }> = [];

    for (const file of files) {
      try {
        if (!isAllowedMime(file.type)) {
          results.push({ fileName: file.name, error: `סוג קובץ לא נתמך (${file.type || 'לא ידוע'}). נתמכים: JPG, PNG, WEBP, HEIC, PDF.` });
          continue;
        }
        if (file.size > MAX_BYTES) {
          results.push({ fileName: file.name, error: `הקובץ גדול מ-15MB.` });
          continue;
        }

        const { key, bytes } = await saveUpload(file);

        let draft: { id: string };
        let confidence: number;
        try {
          const { extracted, raw } = await extractDocument({ data: bytes, mimeType: file.type });
          draft = await createDraftFromExtraction({
            businessId: business.id,
            extraction: extracted,
            fileKey: key,
            fileMime: file.type,
            rawResponse: raw,
          });
          confidence = extracted.confidence;
        } catch (error) {
          // הקובץ כבר נכתב לדיסק אבל לא נוצרה לו רשומה — בלי הניקוי הזה
          // הוא נשאר שם לנצח בלי שאיש יידע עליו.
          await deleteUpload(key);
          throw error;
        }

        // הגיבוי לדרייב לא חוסם ולא מפיל את הקליטה — הקובץ כבר שמור מקומית.
        await backupDocumentQuietly(business, draft.id);

        results.push({ fileName: file.name, id: draft.id, confidence });
      } catch (error) {
        results.push({ fileName: file.name, error: error instanceof Error ? error.message : 'שגיאה לא ידועה' });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'הקליטה נכשלה.' },
      { status: 500 },
    );
  }
}
