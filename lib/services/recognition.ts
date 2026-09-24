import { prisma } from '../db';
import { buildSchedule, buildScheduleFromPayments, inRange, mirrorSchedule } from '../installments';
import { paymentLinesOf } from './document-payments';
import { percentOfBp } from '../money';
import type { Document } from '@prisma/client';

/**
 * הכרה בהכנסות והוצאות לפי תקופה.
 *
 * מסמך רגיל מוכר במלואו בתקופה שבה הופק. מסמך בתשלומים מוכר חלק-חלק: כל
 * תשלום בתקופה של מועד הפירעון שלו. הפונקציות כאן מחזירות רשומות בצורת
 * Document כדי שמנוע הדוח וקובץ PCN874 — שנבדקו — לא יצטרכו לדעת על ההבדל.
 */

/** כותב מחדש את לוח התשלומים של מסמך. נקרא בכל פעם שהמסמך או תשלומיו משתנים. */
export async function syncSchedule(documentId: string): Promise<number> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: { reverses: { include: { schedule: { orderBy: { seq: 'asc' } } } } },
  });
  if (!doc) return 0;
  // לוח שהוזן ביד הוא האמת — הסנכרון לא יודע יותר טוב
  if (doc.scheduleManual) return prisma.documentInstallment.count({ where: { documentId } });

  // שורות התשלום שנקראו מהמסמך עצמו הן הרשומה המחייבת: מסמך ששולם בכמה
  // חלקים מוכר לפי כל חלק במועדו.
  const fromDocument = paymentLinesOf(doc);
  if (fromDocument.length > 1 && fromDocument.reduce((a, p) => a + p.amountAgorot, 0) === doc.totalAgorot) {
    const rows = buildScheduleFromPayments(doc, fromDocument.map((p) => ({ dueDate: p.date, totalAgorot: p.amountAgorot })));
    await prisma.$transaction([
      prisma.documentInstallment.deleteMany({ where: { documentId } }),
      prisma.documentInstallment.createMany({ data: rows.map((r) => ({ ...r, documentId })) }),
    ]);
    return rows.length;
  }

  // זיכוי שמבטל מסמך בתשלומים: תשלומים שטרם נגבו מתבטלים בחודשים שלהם,
  // תשלומים שכבר נגבו מוחזרים במועד הזיכוי (ראו mirrorSchedule).
  const mirrored =
    doc.reverses && doc.reverses.schedule.length > 1 && doc.reverses.totalAgorot === doc.totalAgorot
      ? mirrorSchedule(
          doc.reverses.schedule.map((s) => ({
            seq: s.seq,
            dueDate: s.dueDate,
            netAgorot: s.netAgorot,
            vatAgorot: s.vatAgorot,
            totalAgorot: s.totalAgorot,
          })),
          doc.reportDate,
        )
      : null;
  const schedule = mirrored ?? buildSchedule(doc);
  await prisma.$transaction([
    prisma.documentInstallment.deleteMany({ where: { documentId } }),
    ...(schedule
      ? [prisma.documentInstallment.createMany({ data: schedule.map((s) => ({ ...s, documentId })) })]
      : []),
  ]);
  return schedule?.length ?? 0;
}

/**
 * המסמכים שמוכרים בטווח תאריכים, בסכומים המוכרים בו.
 *
 * מסמך בתשלומים מופיע פעם אחת לכל תשלום שחל בטווח, עם סכומי אותו תשלום ועם
 * מספר המסמך ותאריך ההפקה המקוריים — כך הוא מדווח בקובץ PCN874 תחת אותה
 * חשבונית, בסכום החלקי של התקופה.
 */
export async function documentsRecognizedInRange(
  businessId: string,
  start: Date,
  end: Date,
): Promise<Document[]> {
  const [whole, spread] = await Promise.all([
    prisma.document.findMany({
      where: {
        businessId,
        reportDate: { gte: start, lte: end },
        // מסמך עם לוח תשלומים מוכר דרך הלוח בלבד — גם זיכוי שמשקף לוח של מסמך אחר
        schedule: { none: {} },
      },
      orderBy: { issueDate: 'asc' },
    }),
    prisma.documentInstallment.findMany({
      where: { dueDate: { gte: start, lte: end }, document: { businessId } },
      include: { document: true },
      orderBy: [{ dueDate: 'asc' }, { seq: 'asc' }],
    }),
  ]);

  const partial: Document[] = spread
    .filter((i) => inRange(i.dueDate, start, end))
    .map((i) => ({
      ...i.document,
      // מזהה נפרד לכל תשלום — מסמך אחד יכול להופיע כמה פעמים בשנה
      id: `${i.document.id}:${i.seq}`,
      netAgorot: i.netAgorot,
      vatAgorot: i.vatAgorot,
      totalAgorot: i.totalAgorot,
      deductibleVatAgorot: percentOfBp(i.vatAgorot, i.document.deductibleBp),
      reportDate: i.dueDate,
    }));

  return [...whole, ...partial].sort((a, b) => a.issueDate.getTime() - b.issueDate.getTime());
}
