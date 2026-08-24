import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { buildConsentUrl, googleConfigFromEnv } from '@/lib/drive/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** פותח את מסך ההרשאה של גוגל. */
export async function GET() {
  try {
    const config = googleConfigFromEnv();

    // state מגן מפני זיוף בקשה — הערך נשמר בעוגייה ומושווה בחזרה.
    const state = randomUUID();
    const jar = await cookies();
    jar.set('drive_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });

    return NextResponse.redirect(buildConsentUrl(config, state));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'שגיאה';
    return NextResponse.redirect(new URL(`/settings?driveError=${encodeURIComponent(message)}`, process.env.APP_URL || 'http://localhost:3737'));
  }
}
