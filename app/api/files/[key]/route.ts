import { NextResponse } from 'next/server';
import { readUpload } from '@/lib/storage';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

/** מגיש קובץ סרוק לצפייה. רק קבצים שרשומים כמסמך במערכת נגישים. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
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
