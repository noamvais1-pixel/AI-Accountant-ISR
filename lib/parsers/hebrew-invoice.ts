/**
 * מפענח חשבוניות PDF שיש בהן שכבת טקסט.
 *
 * רוב המסמכים שמערכות חשבוניות מפיקות אינם סריקות אלא PDF עם טקסט אמיתי.
 * עבורם קריאה ב-AI היא בזבוז: היא עולה מכסה, לוקחת שניות, ויכולה לטעות —
 * בעוד שהטקסט עצמו מכיל את המספרים המדויקים. לכן הצינור מנסה קודם לפענח
 * טקסט, ונופל ל-AI רק כשאין טקסט או כשהפענוח לא עובר אימות.
 */

/** סימני כיווניות דו-כיוונית ש-pdftotext משאיר בטקסט עברי. */
const BIDI_MARKS = /[‎‏‪-‮⁦-⁩]/g;

export function stripBidi(text: string): string {
  return text.replace(BIDI_MARKS, '');
}

export type ParsedInvoice = {
  documentKind: 'TAX_INVOICE_RECEIPT' | 'TAX_INVOICE' | 'RECEIPT' | 'CREDIT_INVOICE';
  isCredit: boolean;
  documentNumber: string;
  issueDate: string; // YYYY-MM-DD
  counterpartyName: string | null;
  counterpartyVatId: string | null;
  netAmount: number | null;
  vatAmount: number | null;
  totalAmount: number | null;
  vatRatePercent: number | null;
  /** האם המסמך הופק על ידי העסק (הכנסה) או התקבל מספק (הוצאה). */
  direction: 'INCOME' | 'EXPENSE';
  /** מספר תשלומים בעסקת אשראי, אם צוין. null = לא צוין או תשלום אחד. */
  installments: number | null;
  warnings: string[];
};

/** מספר בפורמט ישראלי: 1,234.56 — עם או בלי סימן שקל. */
function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[₪\s,]/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function firstMatch(text: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}

const AMOUNT = String.raw`₪?\s*(-?[\d,]+\.?\d*)\s*₪?`;

/**
 * קובע אם המסמך הופק על ידי העסק או התקבל מספק.
 *
 * המבחן הוא מיקום: בחשבונית שהעסק הוציא, שמו מודפס בראש הדף — לפני "לכבוד".
 * בחשבונית שהתקבלה מספק, שם העסק מופיע אחרי "לכבוד" כי הוא הלקוח.
 * בדיקה של עצם הופעת מספר העוסק אינה מספיקה: הוא מופיע בשני המקרים.
 */
export function detectDirection(text: string, ownVatId: string, ownName: string): 'INCOME' | 'EXPENSE' {
  const addressee = text.search(/לכבוד/);
  if (addressee === -1) return text.includes(ownVatId) ? 'INCOME' : 'EXPENSE';

  const header = text.slice(0, addressee);
  const issuedByUs = header.includes(ownVatId) || header.includes(ownName);
  return issuedByUs ? 'INCOME' : 'EXPENSE';
}

function detectKind(text: string): { kind: ParsedInvoice['documentKind']; isCredit: boolean } {
  if (/חשבונית\s*זיכוי|זיכוי\s*והחזר\s*כספים/.test(text)) return { kind: 'CREDIT_INVOICE', isCredit: true };
  if (/חשבונית\s*מס[\s/-]*קבלה/.test(text)) return { kind: 'TAX_INVOICE_RECEIPT', isCredit: false };
  if (/חשבונית\s*מס/.test(text)) return { kind: 'TAX_INVOICE', isCredit: false };
  return { kind: 'RECEIPT', isCredit: false };
}

/** DD/MM/YYYY -> YYYY-MM-DD */
function toIsoDate(day: string, month: string, year: string): string {
  return `${year}-${month}-${day}`;
}

export function parseHebrewInvoice(
  rawText: string,
  options: { ownVatId: string; ownName: string },
): ParsedInvoice | null {
  const text = stripBidi(rawText);
  if (text.trim().length < 40) return null;

  const warnings: string[] = [];
  const { kind, isCredit } = detectKind(text);
  const direction = detectDirection(text, options.ownVatId, options.ownName);

  // --- מספר המסמך ---
  const numberMatch = firstMatch(text, [
    /(?:חשבונית\s*מס[\s/-]*קבלה|חשבונית\s*זיכוי|חשבונית\s*מס|קבלה)\s*#?\s*(\d{2,})/,
    /זיכוי\s*והחזר\s*כספים[_\s]*(\d+)/,
  ]);
  if (!numberMatch) return null;
  const documentNumber = numberMatch[1];

  // --- תאריך: הראשון במסמך הוא תאריך ההפקה בשני הפורמטים ---
  const dateMatch = text.match(/([0-3]\d)\/([01]\d)\/(20\d\d)/);
  if (!dateMatch) return null;
  const issueDate = toIsoDate(dateMatch[1], dateMatch[2], dateMatch[3]);

  // --- סכומים ---
  // פורמט א: "חייב במע"מ" / "מע"מ נגבה 18.00%" / "סה"כ שקל"
  // פורמט ב: "סה"כ" / "מע"מ 18%" / "סה"כ לתשלום"
  const net = parseAmount(
    firstMatch(text, [
      new RegExp(String.raw`${AMOUNT}\s*חייב\s*במע"?מ`),
      new RegExp(String.raw`${AMOUNT}\s*סה"?כ(?!\s*לתשלום)(?!\s*שקל)(?!\s*לזיכוי)`),
    ])?.[1],
  );
  const vatMatch = firstMatch(text, [
    new RegExp(String.raw`${AMOUNT}\s*מע"?מ\s*נגבה\s*([\d.]+)\s*%`),
    new RegExp(String.raw`${AMOUNT}\s*מע"?מ\s*([\d.]+)\s*%`),
  ]);
  const vat = parseAmount(vatMatch?.[1]);
  const vatRatePercent = vatMatch?.[2] ? Number(vatMatch[2]) : null;

  const total = parseAmount(
    firstMatch(text, [
      new RegExp(String.raw`${AMOUNT}\s*סה"?כ\s*לתשלום`),
      new RegExp(String.raw`${AMOUNT}\s*סה"?כ\s*שקל`),
      // חשבונית זיכוי משתמשת ב"סה"כ לזיכוי" באותו מקום
      new RegExp(String.raw`${AMOUNT}\s*סה"?כ\s*לזיכוי`),
    ])?.[1],
  );

  // --- הצד השני לעסקה: השורות שאחרי "לכבוד" ---
  let counterpartyName: string | null = null;
  let counterpartyVatId: string | null = null;
  const addresseeIndex = text.search(/לכבוד\s*:?/);
  if (addresseeIndex !== -1) {
    const after = text.slice(addresseeIndex).split('\n').slice(1, 6);
    for (const line of after) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // מספר בן 9 ספרות שאינו של העסק עצמו הוא ח.פ/ת.ז של הצד השני
      const id = trimmed.match(/\b(\d{9})\b/);
      if (id && id[1] !== options.ownVatId && !counterpartyVatId) {
        counterpartyVatId = id[1];
        continue;
      }
      // בפריסה החדשה שעת ההפקה והתאריך יושבים באותה שורה עם שם הלקוח
      // ("16:00 22/06/2026   פערי פוטש"). מסירים אותם לפני שהשורה נחשבת לשם.
      const withoutStamp = trimmed.replace(/\b\d{1,2}:\d{2}\b/g, '').replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, '').trim();
      // שם: שורה עם אותיות עבריות שאינה טלפון ואינה תווית
      if (!counterpartyName && /[֐-׿]/.test(withoutStamp) && !/^0\d|נייד|טלפון|תאריך|מקור/.test(withoutStamp)) {
        // pdftotext משתיל לעיתים רווח בתוך שם ("לקוחה שלי שית"). לא מנסים לתקן:
        // כל כלל שיאחד אות בודדת לשכנתה ישבש שמות לגיטימיים. ההתאמה בין
        // לקוחות נעשית לפי ח.פ, כך שהשם הוא לתצוגה בלבד וניתן לעריכה.
        counterpartyName = withoutStamp.replace(/\s{2,}/g, ' ').slice(0, 80);
      }
    }
  }

  if (!counterpartyName) warnings.push('לא זוהה שם הצד השני לעסקה');
  if (net === null && total === null) warnings.push('לא זוהו סכומים');

  // "מס' תשלומים: 12" — הסכום שבמסמך מגיע לאורך חודשים, לא ביום ההפקה.
  // "פרטי תשלומים" (כותרת עמודה) אינו סימן לתשלומים, ולכן דורשים מספר.
  const installmentsMatch = text.match(/מס'?\s*תשלומים\s*:?\s*(\d{1,2})|(\d{1,2})\s*תשלומים\b/);
  const installmentsRaw = installmentsMatch ? Number(installmentsMatch[1] ?? installmentsMatch[2]) : null;
  const installments = installmentsRaw && installmentsRaw > 1 ? installmentsRaw : null;
  if (installments) warnings.push(`עסקה ב-${installments} תשלומים — הסכום המלא מופיע במסמך`);

  /**
   * מסמך בלי שורת מע"מ הוא מסמך בלי מע"מ — לא מסמך שהמע"מ שלו לא נמצא.
   *
   * ההבחנה קריטית: אם מחזירים כאן null, שלב ההשלמה מניח ששיעור המע"מ הרגיל
   * חל ומוסיף 18% שאינם קיימים. בקבלה של עוסק פטור זה ממציא מע"מ יש מאין
   * ומנפח את ההכנסה. כשהטקסט לא מזכיר מע"מ כלל, אפס הוא התשובה הנכונה.
   */
  const mentionsVat = /מע"?מ/.test(text);
  const vatAmount = vat ?? (mentionsVat ? null : 0);
  const totalAmount = total ?? (vatAmount === 0 ? net : null);

  if (!mentionsVat && net !== null) {
    warnings.push('המסמך אינו מזכיר מע"מ — נרשם ללא מע"מ');
  }

  return {
    documentKind: kind,
    isCredit,
    documentNumber,
    issueDate,
    counterpartyName,
    counterpartyVatId,
    netAmount: net,
    vatAmount,
    totalAmount,
    vatRatePercent,
    direction,
    installments,
    warnings,
  };
}

/**
 * אימות: הסכומים חייבים להסתדר זה עם זה.
 * פענוח טקסט יכול לתפוס מספר מהמקום הלא נכון בלי להתלונן, ולכן מסמך שאינו
 * עובר את הבדיקה הזו נשלח ל-AI במקום להיכנס לספרים על סמך ניחוש.
 */
export function validateAmounts(parsed: ParsedInvoice, toleranceIls = 0.05): string | null {
  const { netAmount: net, vatAmount: vat, totalAmount: total } = parsed;
  if (net === null || total === null) return 'חסרים סכומים';
  const expectedTotal = net + (vat ?? 0);
  if (Math.abs(expectedTotal - total) > toleranceIls) {
    return `הסכומים אינם מסתדרים: ${net} + ${vat ?? 0} ≠ ${total}`;
  }
  if (vat !== null && parsed.vatRatePercent) {
    const expectedVat = (net * parsed.vatRatePercent) / 100;
    if (Math.abs(expectedVat - vat) > Math.max(0.05, net * 0.005)) {
      return `המע"מ אינו תואם את השיעור ${parsed.vatRatePercent}%: צפוי ${expectedVat.toFixed(2)}, נמצא ${vat}`;
    }
  }
  return null;
}
