import { prisma } from '../db';

/**
 * היום המערכת מנהלת עסק אחד. כל שאילתה עוברת דרך הפונקציה הזו,
 * כך שהמעבר לריבוי לקוחות ידרוש להחליף אותה בלבד (בחירה לפי סשן/כתובת).
 */
export async function getActiveBusiness() {
  const business = await prisma.business.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!business) {
    throw new Error('לא הוגדר עסק במערכת. יש להיכנס למסך ההגדרות ולהזין את פרטי העסק.');
  }
  return business;
}

export async function getActiveBusinessOrNull() {
  return prisma.business.findFirst({ orderBy: { createdAt: 'asc' } });
}
