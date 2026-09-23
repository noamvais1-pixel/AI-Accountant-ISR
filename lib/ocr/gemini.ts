import { GoogleGenAI } from '@google/genai';
import { ExtractedDocumentSchema, GEMINI_RESPONSE_SCHEMA, type ExtractedDocument } from './schema';

/**
 * ההנחיה תלויה בכיוון המסמך.
 *
 * זה לא ניואנס: בחשבונית שהעסק הוציא, פרטי העסק עצמו מודפסים בראש המסמך
 * ופרטי הלקוח מופיעים תחת "לכבוד". מודל שמחפש "ספק" יחזיר את פרטי העסק עצמו
 * כצד השני לעסקה, וכל ההכנסות יירשמו כאילו העסק הוא הלקוח של עצמו.
 */
function buildPrompt(direction: 'INCOME' | 'EXPENSE', ownVatId: string | null): string {
  const ownership = ownVatId
    ? `\nמספר העוסק של בעל המערכת הוא ${ownVatId}. הצד השני לעסקה הוא תמיד הצד שמספרו שונה ממנו.`
    : '';

  const roleRules =
    direction === 'EXPENSE'
      ? `לפניך מסמך הוצאה שהעסק **קיבל** מספק.
- counterpartyName ו-counterpartyVatId הם פרטי **הספק** — מי שהוציא את המסמך, בדרך כלל בראש הדף.`
      : `לפניך מסמך הכנסה שהעסק **הוציא** ללקוח.
- counterpartyName ו-counterpartyVatId הם פרטי **הלקוח** — מי שהמסמך מיועד אליו, בדרך כלל תחת "לכבוד".
- אל תחזיר את פרטי מוציא המסמך, שהם פרטי העסק עצמו.`;

  return `אתה מומחה להנהלת חשבונות ישראלית.

${roleRules}${ownership}

חלץ את הנתונים במדויק. כללים:
- קרא מספרים בדיוק כפי שהם מודפסים. אל תחשב מחדש ואל תתקן סכום שנראה לא עגול.
- אם שדה אינו מופיע במסמך או שאינך בטוח — החזר null. אל תנחש.
- "ע.מ", "ח.פ", "עוסק מורשה", "מספר עוסק" — כולם מסמנים מספר עוסק. החזר ספרות בלבד.
- "מספר הקצאה" הוא מספר נפרד שמנפיקה רשות המסים לחשבונית. אל תבלבל בינו לבין מספר החשבונית.
- חשבונית זיכוי מזוהה במילים "זיכוי", "ביטול", או בסכומים שליליים. סמן isCredit=true והחזר סכומים חיוביים.
- שים לב להבדל בין "חשבונית מס" (מזכה במע"מ תשומות) לבין "קבלה" בלבד (אינה מזכה).
- שיעור המע"מ בישראל הוא 18% מינואר 2025, ו-17% לפני כן. ודא שהשיעור שאתה מחזיר תואם את הסכומים.
- אם הסכומים אינם מסתדרים זה עם זה, החזר אותם כפי שהם וציין זאת ב-warnings.
- warnings: תמיד בעברית. הן מוצגות למשתמשת ליד המסמך.
- תאריכים בישראל נכתבים בדרך כלל DD/MM/YYYY. החזר תמיד YYYY-MM-DD.
- categoryGuess: סיווג קצר בעברית, למשל "דלק", "משרדיות", "אירוח", "תקשורת", "שכירות", "ייעוץ מקצועי".`;
}

export type OcrResult = {
  extracted: ExtractedDocument;
  modelUsed: string;
  raw: unknown;
  /** כמה ניסיונות נדרשו — שימושי כדי לדעת שהמכסה צפופה. */
  attempts: number;
};

/** ברירת מחדל: 5 ניסיונות עם השהיה מוכפלת, עד כדקה בין ניסיונות. */
export const DEFAULT_MAX_ATTEMPTS = 4;

/**
 * שגיאות מה-SDK חוזרות כ-JSON גולמי של ה-API. מתרגמים אותן להודעה שאפשר
 * לפעול לפיה, כי היא מוצגת למשתמשת ליד הקובץ שנכשל.
 */
function describeGeminiError(error: unknown, model: string): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (/INVALID_ARGUMENT|invalid argument/i.test(raw)) {
    return 'המודל לא הצליח לקרוא את הקובץ. בדרך כלל זה קובץ פגום או צילום לא תקין — נסי לצלם שוב.';
  }
  if (/NOT_FOUND|no longer available/i.test(raw)) {
    return `המודל ${model} אינו זמין. יש לעדכן את GEMINI_MODEL בקובץ .env.local.`;
  }
  if (/PERMISSION_DENIED|API key not valid|API_KEY_INVALID/i.test(raw)) {
    return 'מפתח ה-Gemini אינו תקף. בדקי את GEMINI_API_KEY בקובץ .env.local.';
  }
  if (/RESOURCE_EXHAUSTED|quota|429/i.test(raw)) {
    return 'חריגה ממכסת השימוש ב-Gemini. נסי שוב בעוד כמה דקות.';
  }
  if (/UNAVAILABLE|503|high demand/i.test(raw)) {
    return 'שירות Gemini עמוס כרגע. נסי שוב בעוד רגע.';
  }
  if (/SAFETY|blocked/i.test(raw)) {
    return 'המודל חסם את התשובה. אם זה קורה על מסמך תקין, אפשר להזין אותו ידנית.';
  }
  return `קריאת המסמך נכשלה: ${raw.slice(0, 200)}`;
}

/** שגיאות שחולפות מעצמן — כדאי לנסות שוב במקום להיכשל. */
function isTransient(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return /RESOURCE_EXHAUSTED|quota|rate limit|429|UNAVAILABLE|503|500|INTERNAL|deadline|ETIMEDOUT|ECONNRESET|fetch failed/i.test(raw);
}

/**
 * חריגה ממכסה **יומית** — להבדיל ממכסה לדקה.
 * ההבחנה קריטית: מכסה לדקה חולפת תוך שניות וכדאי להמתין לה, אבל מכסה יומית
 * לא תשתחרר היום בשום המתנה, ולכן צריך לעבור למודל אחר.
 */
function isDailyQuotaExhausted(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return /RequestsPerDay|PerDayPerProject/i.test(raw);
}

/** מודל שאינו קיים או שאינו זמין למפתח הזה — אין טעם לנסות אותו שוב. */
function isModelUnavailable(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return /NOT_FOUND|no longer available|is not found for API version/i.test(raw);
}

/**
 * שרשרת המודלים. המכסה החינמית נמדדת **לכל מודל בנפרד**, ולכן מעבר למודל הבא
 * מכפיל את הקיבולת היומית. הסדר הוא מהחזק לחלש — מודלי lite מהירים וזולים
 * אבל פחות מדויקים בקריאת מסמכים סרוקים, ולכן הם רק רשת ביטחון אחרונה.
 */
function modelChain(): string[] {
  const configured = process.env.GEMINI_MODELS?.split(',').map((m) => m.trim()).filter(Boolean);
  if (configured?.length) return configured;
  const primary = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const fallbacks = [
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-flash-latest',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-flash-lite-latest',
  ];
  return [primary, ...fallbacks.filter((m) => m !== primary)];
}

/**
 * מודלים שמכסתם היומית נגמרה. משותף לכל הקריאות בתהליך, כך שאחרי שמודל אחד
 * נגמר לא מבזבזים עליו עוד קריאה בכל מסמך.
 */
const exhaustedToday = new Set<string>();

export function exhaustedModels(): string[] {
  return [...exhaustedToday];
}

/** ההשהיה שגוגל מבקשת בגוף השגיאה, אם ציינה אחת. */
function retryDelayMs(error: unknown): number | null {
  const raw = error instanceof Error ? error.message : String(error);
  const match = /"retryDelay"\s*:\s*"(\d+)s"/.exec(raw);
  return match ? Number(match[1]) * 1000 : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('חסר GEMINI_API_KEY בקובץ .env.local — בלעדיו אי אפשר לקרוא קבלות מצילום.');
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

/**
 * קורא מסמך הוצאה מתמונה או PDF ומחזיר את השדות שחולצו.
 * מחזיר גם את הפלט הגולמי, כדי שאפשר יהיה לבדוק בדיעבד למה ה-AI טעה.
 */
export async function extractDocument(args: {
  data: Buffer;
  mimeType: string;
  direction?: 'INCOME' | 'EXPENSE';
  ownVatId?: string | null;
  maxAttempts?: number;
}): Promise<OcrResult> {
  const ai = getClient();
  const chain = modelChain().filter((m) => !exhaustedToday.has(m));
  if (!chain.length) {
    throw new Error(
      `המכסה היומית של כל מודלי Gemini נוצלה (${exhaustedModels().join(', ')}). ` +
        'אפשר להמשיך מחר, או להפעיל חיוב בחשבון Google AI Studio כדי להסיר את המגבלה.',
    );
  }

  const maxAttempts = args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let response;
  let attempts = 0;
  let model = chain[0];
  let modelIndex = 0;
  let lastError: unknown;

  // מכסה לדקה — ממתינים ומנסים שוב. מכסה יומית — עוברים למודל הבא.
  outer: for (modelIndex = 0; modelIndex < chain.length; modelIndex++) {
    model = chain[modelIndex];
    for (attempts = 1; attempts <= maxAttempts; attempts++) {
      try {
        response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildPrompt(args.direction ?? 'EXPENSE', args.ownVatId ?? null) },
          { inlineData: { mimeType: args.mimeType, data: args.data.toString('base64') } },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
          temperature: 0,
        },
        });
        break outer;
      } catch (error) {
        lastError = error;

        if (isDailyQuotaExhausted(error)) {
          exhaustedToday.add(model);
          console.warn(`[ocr] המכסה היומית של ${model} נוצלה — עובר למודל הבא`);
          continue outer;
        }
        if (isModelUnavailable(error)) {
          exhaustedToday.add(model);
          continue outer;
        }
        if (!isTransient(error) || attempts >= maxAttempts) {
          if (modelIndex < chain.length - 1) continue outer;
          throw new Error(describeGeminiError(error, model));
        }

        // מכבדים את ההשהיה שגוגל ביקשה; אחרת מכפילים, עם רעש קטן כדי שכמה
        // עובדים במקביל לא יחזרו לנסות באותו רגע בדיוק.
        const backoff = retryDelayMs(error) ?? Math.min(2000 * 2 ** (attempts - 1), 60000);
        await sleep(backoff + Math.floor(Math.random() * 1000));
      }
    }
  }

  if (!response) throw new Error(describeGeminiError(lastError, model));

  const text = response.text;
  if (!text) throw new Error('המודל לא החזיר תשובה. נסי שוב או בדקי את איכות הצילום.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`תשובת המודל אינה JSON תקין: ${text.slice(0, 200)}`);
  }

  const result = ExtractedDocumentSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`תשובת המודל אינה תואמת את המבנה הצפוי: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }

  return { extracted: result.data, modelUsed: model, raw: parsed, attempts };
}
