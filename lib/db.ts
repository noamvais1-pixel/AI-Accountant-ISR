import { PrismaClient } from '@prisma/client';

// ב-dev, Next.js טוען מחדש מודולים בכל שינוי. בלי הקאש הזה נפתחות
// עשרות בריכות חיבורים ל-Postgres עד שהוא מסרב לקבל עוד.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
