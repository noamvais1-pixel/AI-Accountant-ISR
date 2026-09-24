import { prisma } from '../db';
import { requireUser, apiUser } from '../auth/server';
import { allowedEmails } from '../auth/allowlist';
import { redirect } from 'next/navigation';

/**
 * העסק של המשתמשת המחוברת.
 *
 * כל שאילתה בנתונים עוברת דרך כאן. העסק נקבע לפי החברוּת (BusinessMember) של
 * כתובת המייל שהתחברה; משתמשת בלי עסק מופנית לפתיחת עסק. בהרצה מקומית בלי
 * התחברות — העסק הראשון, כמו קודם.
 */

export class NoBusinessError extends Error {
  constructor() {
    super('לא הוגדר עסק. פתחי קודם את העסק שלך.');
    this.name = 'NoBusinessError';
  }
}

async function businessForEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const membership = await prisma.businessMember.findFirst({
    where: { email: normalized },
    include: { business: true },
    orderBy: { createdAt: 'asc' },
  });
  if (membership) return membership.business;

  // מעבר מהמערכת החד-עסקית: מי שברשימת ההיתר ועדיין אין לעסק הראשון בעלים —
  // מצורפת אליו כבעלים. קורה פעם אחת, ואחר כך הכל עובר דרך החברוּת.
  if (allowedEmails().includes(normalized)) {
    const first = await prisma.business.findFirst({ orderBy: { createdAt: 'asc' }, include: { members: { where: { role: 'OWNER' } } } });
    if (first && first.members.length === 0) {
      await prisma.businessMember.create({ data: { businessId: first.id, email: normalized, role: 'OWNER' } });
      return first;
    }
  }
  return null;
}

async function resolve(user: { id: string; email: string } | null) {
  if (!user) return null;
  if (user.email === 'local') return prisma.business.findFirst({ orderBy: { createdAt: 'asc' } });
  return businessForEmail(user.email);
}

/** העסק הפעיל, או הפניה לפתיחת עסק. לעמודים ולפעולות שרת. */
export async function getActiveBusiness() {
  const user = await requireUser();
  const business = await resolve(user);
  if (!business) redirect('/onboarding');
  return business;
}

/** העסק הפעיל או null — לעמודים שמציגים מצב "אין עסק" בעצמם. */
export async function getActiveBusinessOrNull() {
  const user = await apiUser();
  return resolve(user);
}

/** לפעולות שרת שצריכות תשובה במקום הפניה. */
export async function getActiveBusinessOrThrow() {
  const user = await requireUser();
  const business = await resolve(user);
  if (!business) throw new NoBusinessError();
  return business;
}

/** מי חברה בעסק, לשימוש בהגדרות. */
export async function membersOf(businessId: string) {
  return prisma.businessMember.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } });
}
