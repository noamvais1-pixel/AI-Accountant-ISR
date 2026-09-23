import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth/server';
import { readUpload } from '@/lib/storage';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

/** מגיש קובץ סרוק לצפייה. רק קבצים שרשומים כמסמך במערכת נגישים. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  // ה-middleware כבר חוסם, אבל מסלול שמגיש מסמכים לא יסתמך על שכבה אחת בלבד.
  if (!(await apiUser())) return new NextResponse('לא מורשה', { status: 401 });
  const { key } = await params;

  const document = await prisma.document.findFirst({
    where: { fileKey: key },
    select: { fileMime: true },
  });
  if (!document) return new NextResponse('לא נמצא', { status: 404 });

  try {
    const bytes = await readUpload(key);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': document.fileMime || 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': 'inline',
      },
    });
  } catch {
    return new NextResponse('לא נמצא', { status: 404 });
  }
}
