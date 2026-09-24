/**
 * קריאת פרטי התשלום מתוך המסמך של קארדקום עצמו.
 *
 * ה-API של קארדקום מחזיר למסמך מועד העברה אחד, גם כשהוא שולם בשלושה חלקים
 * בחודשים שונים. המסמך המודפס הוא הרשומה המחייבת, ובו סעיף "פירוט" עם שורה
 * לכל תשלום: אופן התשלום, אסמכתא, תאריך וסכום. חשבונית זיכוי גם מצהירה
 * במפורש איזה מסמך היא מבטלת. הפונקציות כאן טהורות — מקבלות שורות טקסט
 * ומחזירות עובדות, כדי שאפשר יהיה לבדוק אותן בלי PDF.
 */

export type ParsedPayment = {
  date: Date; // UTC חצות
  amountAgorot: number;
  method: string; // "הפקדה בנקאית", "כרטיס אשראי", "חיוב/זיכוי לקוחות"...
  reference: string | null;
};

export type ParsedCardcomDocument = {
  payments: ParsedPayment[];
  /** מספר המסמך שהזיכוי מבטל, אם המסמך מצהיר על כך */
  reversesNumber: number | null;
  /** "מספר תשלומים" בחיוב אשראי, אם מופיע */
  cardInstallments: number | null;
};

const BIDI = /[‎‏‪-‮⁦-⁩]/g;
const DATE = /תאריך\s*(\d{2})\/(\d{2})\/(\d{4})/;
const AMOUNT = /סכום\s*₪?\s*(-?[\d,]+\.\d{2})/;

function toAgorot(text: string): number {
  return Math.round(Number(text.replace(/,/g, '')) * 100);
}

export function parseCardcomDocumentLines(rawLines: string[]): ParsedCardcomDocument {
  const lines = rawLines.map((l) => l.replace(BIDI, '').replace(/\s+/g, ' ').trim());
  const payments: ParsedPayment[] = [];
  let reversesNumber: number | null = null;
  let cardInstallments: number | null = null;

  for (const line of lines) {
    const rev = /מבטל מסמך מקורי.*?מספר\s*:?\s*(\d+)/.exec(line);
    if (rev) reversesNumber = Number(rev[1]);

    const date = DATE.exec(line);
    const amount = AMOUNT.exec(line);
    if (!date || !amount) continue;

    const inst = /מספר תשלומים\s*(\d+)/.exec(line);
    if (inst) cardInstallments = Number(inst[1]);

    const method = /תיאור\s+(.+?)\s*\|/.exec(line)?.[1] ?? (/כרטיס/.test(line) ? 'כרטיס אשראי' : 'אחר');
    const reference = /אסמכתא\s+([^|]+?)\s*\|/.exec(line)?.[1]?.trim() || null;
    payments.push({
      date: new Date(Date.UTC(Number(date[3]), Number(date[2]) - 1, Number(date[1]))),
      amountAgorot: Math.abs(toAgorot(amount[1])),
      method,
      reference,
    });
  }

  payments.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { payments, reversesNumber, cardInstallments };
}

/** סכום כל התשלומים שנקראו — לבדיקה מול סכום המסמך לפני שסומכים עליהם. */
export function paymentsTotal(payments: ParsedPayment[]): number {
  return payments.reduce((a, p) => a + p.amountAgorot, 0);
}
