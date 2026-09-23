/**
 * מי מורשה להיכנס למערכת.
 *
 * הגישה היא רשימת היתר מפורשת ולא "כל מי שנרשם": הספרים מכילים שמות ומספרי
 * זהות של לקוחות וספקים, ומערכת שפתוחה להרשמה חופשית חושפת מידע של צדדים
 * שלישיים. כתובת שאינה ברשימה נחסמת גם אם הצליחה לאמת את עצמה מול גוגל.
 */

export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = allowedEmails();
  // רשימה ריקה חוסמת הכל. ברירת מחדל פתוחה כאן היא בדיוק התקלה שאסור שתקרה
  // בפריסה שבה שכחו להגדיר משתנה סביבה.
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}
