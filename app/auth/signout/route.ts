import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', new URL(request.url).origin), { status: 303 });
}
