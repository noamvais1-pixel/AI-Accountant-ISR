import { prisma } from '../db';
import { readUpload, saveBytes } from '../storage';
import { cardcomConfigFromEnv, getDocumentUrl, CARDCOM_DOC_TYPE_BY_ID } from '../cardcom/client';
import { extractPdfLines } from '../parsers/pdf-lines';
import { parseCardcomDocumentLines, paymentsTotal, type ParsedPayment } from '../parsers/cardcom-document';
import { assignToPeriod } from './documents';
import type { Document, Prisma } from '@prisma/client';

/**
 * מועדי התשלום נקראים מהמסמך עצמו, לא רק מה-API של קארדקום.
 *
 * ה-API מחזיר למסמך מועד אחד; המסמך המודפס מפרט כל תשלום. כאן מורידים את
 * ה-PDF של המסמך (פעם אחת, ונשמר אצלנו — זה גם מה שמאפשר לצפות בו), קוראים
 * ממנו את שורות התשלום, ומשווים למה שקארדקום דיווחה. כשהמסמך אומר אחרת,
 * המסמך מנצח וההבדל נרשם בהערה.
 */

type StoredLine = { date: string; amountAgorot: number; method: string; reference: string | null };

export function paymentLinesOf(doc: { paymentLines: Prisma.JsonValue | null }): ParsedPayment[] {
  if (!Array.isArray(doc.paymentLines)) return [];
  return (doc.paymentLines as StoredLine[])
    .filter((l) => l && typeof l.date === 'string' && Number.isInteger(l.amountAgorot))
    .map((l) => ({ ...l, date: new Date(l.date) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

const fmt = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;

async function documentBytes(doc: Document): Promise<{ bytes: Buffer; fileKey: string | null }> {
  if (doc.fileKey) return { bytes: await readUpload(doc.fileKey), fileKey: null };
  if (doc.source !== 'CARDCOM') throw new Error('אין קובץ למסמך');
  const raw = doc.ocrRaw as { InvoiceType?: number } | null;
  const typeName = raw?.InvoiceType != null ? CARDCOM_DOC_TYPE_BY_ID[raw.InvoiceType] : null;
  if (!typeName) throw new Error('סוג המסמך בקארדקום אינו ידוע');
  const url = await getDocumentUrl(cardcomConfigFromEnv(), { documentTypeName: typeName, documentNumber: Number(doc.number) });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`הורדת המסמך מקארדקום נכשלה (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.subarray(0, 4).toString() !== '%PDF') throw new Error('קארדקום לא החזירה PDF');
  const fileKey = await saveBytes(bytes, 'application/pdf', '.pdf');
  return { bytes, fileKey };
}

export type RefreshResult = {
  status: 'updated' | 'unchanged' | 'mismatch' | 'no-payments';
  payments: number;
  note?: string;
};

/**
 * קורא את שורות התשלום מהמסמך ומעדכן את מועד ההכרה בהתאם.
 * לוח שהוזן ביד אינו נדרס; מסמך מתקופה שדווחה אינו זז.
 */
export async function refreshPaymentsFromDocument(
  documentId: string,
  opts: { frequency: 'MONTHLY' | 'BIMONTHLY' },
): Promise<RefreshResult> {
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId }, include: { vatPeriod: { select: { status: true } } } });
  const { bytes, fileKey } = await documentBytes(doc);
  const parsed = parseCardcomDocumentLines(await extractPdfLines(bytes));
  const fileData = fileKey ? { fileKey, fileMime: 'application/pdf' } : {};

  if (parsed.payments.length === 0) {
    await prisma.document.update({ where: { id: doc.id }, data: { ...fileData, paymentLines: [] } });
    return { status: 'no-payments', payments: 0 };
  }

  const lines: StoredLine[] = parsed.payments.map((p) => ({ date: p.date.toISOString(), amountAgorot: p.amountAgorot, method: p.method, reference: p.reference }));
  const sum = paymentsTotal(parsed.payments);
  if (sum !== doc.totalAgorot) {
    const note = `שורות התשלום במסמך מסתכמות ל-${(sum / 100).toFixed(2)} ולא לסכום המסמך — מועד התשלום לא שונה`;
    await prisma.document.update({ where: { id: doc.id }, data: { ...fileData, paymentLines: lines, notes: mergeNote(doc.notes, note) } });
    return { status: 'mismatch', payments: parsed.payments.length, note };
  }

  // זיכוי שמצהיר איזה מסמך הוא מבטל — הקישור המפורש גובר על ניחוש
  let reversesId: string | undefined;
  if (doc.isCredit && !doc.reversesId && parsed.reversesNumber != null) {
    const original = await prisma.document.findFirst({
      where: { businessId: doc.businessId, direction: doc.direction, number: String(parsed.reversesNumber), isCredit: false, status: { not: 'VOID' } },
      select: { id: true },
    });
    if (original) reversesId = original.id;
  }

  const firstPaid = parsed.payments[0].date;
  const locked = doc.scheduleManual || doc.vatPeriod?.status === 'FILED';
  const moved = !locked && doc.reportDate.getTime() !== firstPaid.getTime();
  const note = moved ? `מועד התשלום נקרא מהמסמך: ${fmt(firstPaid)} (לפני כן נרשם ${fmt(doc.reportDate)})` : null;

  await prisma.document.update({
    where: { id: doc.id },
    data: {
      ...fileData,
      paymentLines: lines,
      ...(reversesId ? { reversesId } : {}),
      ...(moved ? { reportDate: firstPaid, notes: mergeNote(doc.notes, note!) } : {}),
    },
  });
  if (moved) await assignToPeriod({ businessId: doc.businessId, documentId: doc.id, reportDate: firstPaid, frequency: opts.frequency });
  // הלוח נבנה מחדש תמיד: שורות תשלום חדשות משנות אותו גם כשהמועד הראשון לא זז
  const { syncSchedule } = await import('./recognition');
  await syncSchedule(doc.id);
  return { status: moved || reversesId ? 'updated' : 'unchanged', payments: parsed.payments.length, note: note ?? undefined };
}

function mergeNote(existing: string | null, note: string): string {
  if (existing?.includes(note)) return existing;
  // הערה קודמת מאותו סוג מוחלפת, לא נערמת
  const kept = (existing ?? '')
    .split(' · ')
    .filter((n) => n && !n.startsWith('מועד התשלום נקרא מהמסמך') && !n.startsWith('שורות התשלום במסמך'));
  return [...kept, note].join(' · ');
}
