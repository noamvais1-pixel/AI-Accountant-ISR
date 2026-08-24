/**
 * הגשה אוטומטית לרשות המסים — שלד להמשך.
 *
 * מה שכבר עובד היום: הפקת קובץ PCN874 תקין להעלאה ידנית באזור האישי.
 * מה שחסר כדי לסגור את הלולאה: חיבור מאומת לשירותי רשות המסים.
 *
 * שני מסלולים נפרדים, ואל תבלבלי ביניהם:
 *
 * 1. הגשת הדוח התקופתי (PCN874).
 *    כיום ההגשה נעשית באזור האישי באתר רשות המסים בהעלאת קובץ. אין ממשק
 *    מכונה-למכונה פתוח להגשה. בית תוכנה שרוצה להגיש בשם לקוחות נדרש לאישור
 *    מרשות המסים ולחתימה דיגיטלית על הקובץ.
 *
 * 2. חשבונית ישראל — מספרי הקצאה.
 *    כאן דווקא יש API ציבורי מבוסס OAuth, ומספר הקצאה חובה בחשבוניות מעל
 *    הסף (20,000 ש"ח נכון ל-2025). את זה לא צריך לממש כאן: קארדקום כבר
 *    מטפלת בהקצאה בעת הפקת המסמך, ולכן ההפקה עוברת דרכה.
 *
 * המימוש הנכון כשמגיעים לזה: ליצור מחלקה שמממשת את TaxAuthorityProvider,
 * לרשום אותה כאן, ולהחליף במסך הדוח את כפתור ההורדה בכפתור הגשה. שאר
 * המערכת לא צריכה להשתנות — הדוח והקובץ כבר מופקים נכון.
 */

export type FilingResult = {
  confirmationNumber: string;
  filedAt: Date;
  raw: unknown;
};

export interface TaxAuthorityProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** מגיש את קובץ הדיווח המפורט לתקופה. */
  submitPcn874(args: { vatId: string; reportMonth: string; content: string }): Promise<FilingResult>;
  /** בודק את מצב הגשה קודמת. */
  getFilingStatus(args: { vatId: string; reportMonth: string }): Promise<{ status: string; raw: unknown }>;
}

/** ספק שלא מוגדר — מחזיר הודעה ברורה במקום להיכשל בשקט. */
export class NotConnectedTaxAuthority implements TaxAuthorityProvider {
  readonly name = 'not-connected';

  isConfigured(): boolean {
    return false;
  }

  async submitPcn874(): Promise<FilingResult> {
    throw new Error(
      'הגשה אוטומטית לרשות המסים אינה מחוברת. כרגע יש להוריד את קובץ ה-PCN874 ולהעלות אותו באזור האישי.',
    );
  }

  async getFilingStatus(): Promise<{ status: string; raw: unknown }> {
    throw new Error('הגשה אוטומטית לרשות המסים אינה מחוברת.');
  }
}

let instance: TaxAuthorityProvider | null = null;

export function getTaxAuthorityProvider(): TaxAuthorityProvider {
  instance ??= new NotConnectedTaxAuthority();
  return instance;
}
