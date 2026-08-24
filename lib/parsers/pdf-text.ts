import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * חילוץ שכבת הטקסט מ-PDF באמצעות pdftotext (חבילת poppler).
 *
 * זו תלות חיצונית מכוונת: היא זמינה בכל מערכת, מהירה בסדרי גודל מקריאת AI,
 * ומחזירה את הטקסט המקורי במקום פרשנות שלו. אם היא אינה מותקנת, הצינור
 * ממשיך כרגיל דרך ה-AI — אין כאן שבירה, רק ויתור על קיצור הדרך.
 */

let available: boolean | null = null;

export async function isPdfTextAvailable(): Promise<boolean> {
  if (available !== null) return available;
  try {
    await run('pdftotext', ['-v']);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

/** מחזיר את הטקסט שב-PDF, או null אם אין בו שכבת טקסט (סריקה). */
export async function extractPdfText(path: string): Promise<string | null> {
  if (!(await isPdfTextAvailable())) return null;
  try {
    // -layout שומר על מיקום העמודות, שקריטי לזיהוי שורות הסכומים.
    const { stdout } = await run('pdftotext', ['-layout', path, '-'], {
      maxBuffer: 20 * 1024 * 1024,
      timeout: 15000,
    });
    // פחות מכמה עשרות תווים משמעו PDF סרוק — שם רק AI יעזור.
    return stdout.trim().length >= 40 ? stdout : null;
  } catch {
    return null;
  }
}
