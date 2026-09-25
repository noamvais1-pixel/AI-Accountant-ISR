/**
 * מנהלות הפלטפורמה: רואות את כל העסקים (לוח הלקוחות), לא רק את שלהן.
 * רשימה מפורשת ב-PLATFORM_ADMINS; ריקה = אין מנהלות, הלוח סגור לכולם.
 */
export function platformAdmins(): string[] {
  return (process.env.PLATFORM_ADMINS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  if (email === 'local' && process.env.VERCEL !== '1') return true;
  return platformAdmins().includes(email.trim().toLowerCase());
}
