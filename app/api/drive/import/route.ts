import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth/server';
import { getActiveBusiness } from '@/lib/services/business';
import { importFromDriveFolder } from '@/lib/drive/import';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * קולט אצווה אחת מתיקיית הדרייב ומחזיר כמה נשארו.
 * הלקוח קורא שוב כל עוד remaining גדול מאפס — כך סריקה של מאות מסמכים
 * מתחלקת לבקשות קצרות שאף אחת מהן אינה חורגת מתקרת הזמן.
 */
export async function POST(request: Request) {
  if (!(await apiUser())) return NextResponse.json({ error: 'לא מורשה' }, { status: 401 });

  try {
    const business = await getActiveBusiness();
    const body = await request.json().catch(() => ({}));
    const limit = Number(body.limit) || 5;

    const summary = await importFromDriveFolder({
      business,
      folderName: business.driveImportFolder || 'עסק',
      limit,
    });

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'הקליטה נכשלה.' },
      { status: 500 },
    );
  }
}
