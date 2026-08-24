import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { getActiveBusiness } from '@/lib/services/business';
import { exchangeCodeForTokens, getAccountEmail, googleConfigFromEnv } from '@/lib/drive/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function backToSettings(params: Record<string, string>) {
  const base = process.env.APP_URL || 'http://localhost:3737';
  const url = new URL('/settings', base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

/** מקבל את קוד ההרשאה מגוגל ושומר את ה-refresh token. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const denied = url.searchParams.get('error');

  if (denied) return backToSettings({ driveError: 'ההרשאה בוטלה.' });
  if (!code) return backToSettings({ driveError: 'לא התקבל קוד הרשאה מגוגל.' });

  const jar = await cookies();
  const expected = jar.get('drive_oauth_state')?.value;
  jar.delete('drive_oauth_state');

  if (!expected || expected !== state) {
    return backToSettings({ driveError: 'אימות הבקשה נכשל. נסי להתחבר שוב.' });
  }

  try {
    const config = googleConfigFromEnv();
    const { refreshToken, accessToken } = await exchangeCodeForTokens(config, code);
    const email = await getAccountEmail(accessToken);
    const business = await getActiveBusiness();

    await prisma.business.update({
      where: { id: business.id },
      data: {
        driveRefreshToken: refreshToken,
        driveAccountEmail: email,
        driveConnectedAt: new Date(),
        // מאפסים את מזהה תיקיית השורש — חשבון אחר, תיקייה אחרת.
        driveRootFolderId: null,
      },
    });

    return backToSettings({ driveConnected: email ?? '1' });
  } catch (error) {
    return backToSettings({ driveError: error instanceof Error ? error.message : 'החיבור נכשל.' });
  }
}
