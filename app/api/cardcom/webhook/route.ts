import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { settlePaymentRequest } from '@/lib/services/payment-requests';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * הודעה מהסולק על תשלום. התוכן אינו מהימן (כל אחד יכול לשלוח POST לכאן), ולכן
 * לוקחים ממנו רק את המזהה, ואת מה שקרה בפועל שואלים את הסולק ב-API מאומת.
 */
export async function POST(request: NextRequest) {
  const fields = await readFields(request);
  const returnValue = str(fields, 'ReturnValue') ?? str(fields, 'returnvalue');
  const lowProfileId = str(fields, 'LowProfileId') ?? str(fields, 'lowprofilecode') ?? str(fields, 'LowProfileCode');

  let requestId: string | null = null;
  if (returnValue && (await prisma.paymentRequest.findUnique({ where: { id: returnValue }, select: { id: true } }))) requestId = returnValue;
  else if (lowProfileId) {
    const found = await prisma.paymentRequest.findUnique({ where: { lowProfileId }, select: { id: true } });
    requestId = found?.id ?? null;
  }
  if (!requestId) return NextResponse.json({ ok: false, reason: 'unknown request' }, { status: 200 });

  try {
    const result = await settlePaymentRequest(requestId);
    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    // 200 בכל מקרה: הסולק לא צריך לנסות שוב, דף החזרה והסנכרון ישלימו
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 200 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}

async function readFields(request: NextRequest): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  request.nextUrl.searchParams.forEach((v, k) => (out[k] = v));
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) Object.assign(out, await request.json());
    else if (type.includes('form')) (await request.formData()).forEach((v, k) => (out[k] = String(v)));
  } catch {
    // גוף ריק או לא קריא — המזהה עשוי להיות בכתובת
  }
  return out;
}

function str(fields: Record<string, unknown>, key: string): string | null {
  const v = fields[key];
  return typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null;
}
