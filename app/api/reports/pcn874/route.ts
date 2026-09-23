import { apiUser } from '@/lib/auth/server';
import { getActiveBusiness } from '@/lib/services/business';
import { buildVatReport } from '@/lib/reports/vat-report';
import { documentsRecognizedInRange } from '@/lib/services/recognition';
import { generatePcn874 } from '@/lib/reports/pcn874';
import { buildPeriod } from '@/lib/periods';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** מוריד את קובץ הדיווח המפורט לתקופה. */
export async function GET(request: Request) {
  // ה-middleware כבר חוסם, אבל מסלול שמגיש מסמכים לא יסתמך על שכבה אחת בלבד.
  if (!(await apiUser())) return new Response('לא מורשה', { status: 401 });
  try {
    const business = await getActiveBusiness();
    const url = new URL(request.url);
    const year = Number(url.searchParams.get('year'));
    const periodNo = Number(url.searchParams.get('period'));

    if (!Number.isInteger(year) || !Number.isInteger(periodNo)) {
      return new Response('חסרים פרמטרים: year ו-period', { status: 400 });
    }

    const period = buildPeriod(year, periodNo, business.vatFrequency);
    // חשבונית בתשלומים מדווחת בכל תקופה בסכום התשלומים שחלו בה, תחת אותו מספר
    const documents = await documentsRecognizedInRange(business.id, period.startDate, period.endDate);

    const report = buildVatReport(period, documents);
    const { content } = generatePcn874({ vatId: business.vatId, period, report, documents });

    // הקובץ מכיל ספרות בלבד, אך ASCII מפורש מונע כל הפתעה בקליטה.
    return new Response(content, {
      headers: {
        'Content-Type': 'text/plain; charset=us-ascii',
        'Content-Disposition': `attachment; filename="PCN874_${business.vatId}_${year}${String(periodNo).padStart(2, '0')}.txt"`,
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'הפקת הקובץ נכשלה', { status: 500 });
  }
}
