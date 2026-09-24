import { prisma } from '../db';
import { createLowProfile, getLowProfileResult } from '../cardcom/client';
import { cardcomConfigFor } from '../cardcom/config';
import { unitPriceForTerminal } from '../invoicing/cardcom-provider';
import { interpretLowProfileResult } from '../payments/lowprofile';
import { dealProgress } from '../deals';
import { fromGross } from '../vat';
import { assignToPeriod } from './documents';
import { syncSchedule } from './recognition';
import { refreshDealStatus } from './deals';
import type { PaymentRequest } from '@prisma/client';

/**
 * בקשות תשלום: הקישור שהלקוחה משלמת בו.
 *
 * יצירה: רושמים בקשה אצלנו, פותחים דף אצל הסולק עם פרטי העסקה והמסמך שיופק,
 * ושומרים את הכתובת. סגירה: כשמגיעה הודעה (webhook או חזרה לדף), שואלים את
 * הסולק מה קרה ורק לפי תשובתו רושמים תקבול ומסמך. הסגירה בטוחה לחזרה —
 * שתי הודעות על אותו תשלום לא ירשמו אותו פעמיים.
 */

export function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3737').replace(/\/$/, '');
}

export function publicPayUrl(requestId: string): string {
  return `${appUrl()}/pay/${requestId}`;
}

export async function createPaymentRequest(
  businessId: string,
  dealId: string,
  input: { amountAgorot: number; maxInstallments: number; sendDocumentByEmail: boolean; channel?: 'LINK' | 'TERMINAL' },
): Promise<PaymentRequest> {
  if (process.env.CARDCOM_DRY_RUN !== 'false') {
    throw new Error(
      'מצב בטיחות פעיל: יצירת קישורי תשלום חסומה. תשלום בקישור מפיק חשבונית אמיתית בקארדקום. ' +
        'כדי להפעיל, שני את CARDCOM_DRY_RUN ל-false.',
    );
  }
  const deal = await prisma.deal.findFirst({ where: { id: dealId, businessId }, include: { charges: true, business: true } });
  if (!deal) throw new Error('העסקה לא נמצאה.');
  if (deal.status === 'CANCELLED') throw new Error('העסקה בוטלה.');
  const progress = dealProgress(deal, deal.charges);
  if (!Number.isInteger(input.amountAgorot) || input.amountAgorot <= 0) throw new Error('סכום התשלום חייב להיות חיובי.');
  if (input.amountAgorot > progress.remainingAgorot) {
    throw new Error(`הסכום (${(input.amountAgorot / 100).toFixed(2)}) גדול מהיתרה לתשלום (${(progress.remainingAgorot / 100).toFixed(2)}).`);
  }

  const channel = input.channel ?? 'LINK';
  const request = await prisma.paymentRequest.create({
    data: { businessId, dealId, channel, amountAgorot: input.amountAgorot, maxInstallments: Math.max(1, Math.min(36, input.maxInstallments)) },
  });

  const isVatFree = deal.vatTreatment !== 'STANDARD';
  const unitCost = unitPriceForTerminal(input.amountAgorot, { rateBp: deal.vatRateBp, vatFree: isVatFree, includesVat: true }) / 100;
  try {
    const page = await createLowProfile(cardcomConfigFor(deal.business), {
      amountAgorot: input.amountAgorot,
      returnValue: request.id,
      productName: deal.description,
      successUrl: `${publicPayUrl(request.id)}/done`,
      failedUrl: `${publicPayUrl(request.id)}/failed`,
      cancelUrl: publicPayUrl(request.id),
      webhookUrl: `${appUrl()}/api/cardcom/webhook`,
      maxInstallments: request.maxInstallments,
      virtualTerminal: channel === 'TERMINAL',
      customer: {
        name: deal.customerName,
        taxId: deal.customerVatId ?? undefined,
        email: deal.customerEmail ?? undefined,
        phone: deal.customerPhone ?? undefined,
      },
      document: {
        typeName: 'TaxInvoiceAndReceipt',
        description: deal.description,
        unitCost,
        isVatFree,
        externalId: `deal:${deal.id}:${request.id}`,
        sendByEmail: input.sendDocumentByEmail,
      },
    });
    return prisma.paymentRequest.update({ where: { id: request.id }, data: { lowProfileId: page.lowProfileId, payUrl: page.url } });
  } catch (error) {
    await prisma.paymentRequest.delete({ where: { id: request.id } });
    throw error;
  }
}

export type SettleResult = { status: PaymentRequest['status']; reason?: string };

/**
 * סוגר בקשת תשלום לפי מה שהסולק אומר. נקרא מה-webhook ומדף החזרה, ובטוח
 * לקריאה חוזרת: הבקשה ננעלת ל-SETTLING, ורק מי שנעל אותה רושם.
 */
export async function settlePaymentRequest(requestId: string): Promise<SettleResult> {
  const request = await prisma.paymentRequest.findUnique({ where: { id: requestId }, include: { deal: { include: { business: true } } } });
  if (!request) throw new Error('בקשת התשלום לא נמצאה.');
  if (request.status === 'PAID' || request.status === 'CANCELLED') return { status: request.status };
  if (!request.lowProfileId) return { status: request.status, reason: 'אין דף תשלום' };

  const result = await getLowProfileResult(cardcomConfigFor(request.deal.business), request.lowProfileId);
  const outcome = interpretLowProfileResult(result, request.amountAgorot);

  if (outcome.outcome === 'pending') return { status: request.status };
  if (outcome.outcome === 'failed') {
    // כישלון אינו סופי: הלקוחה יכולה לנסות שוב באותו קישור
    await prisma.paymentRequest.updateMany({ where: { id: requestId, status: 'PENDING' }, data: { status: 'FAILED', failureReason: outcome.reason } });
    return { status: 'FAILED', reason: outcome.reason };
  }
  if (outcome.outcome === 'mismatch') {
    await prisma.paymentRequest.updateMany({ where: { id: requestId, status: { in: ['PENDING', 'FAILED'] } }, data: { failureReason: outcome.reason } });
    return { status: request.status, reason: outcome.reason };
  }

  // נעילה: רק קריאה אחת רושמת
  const claimed = await prisma.paymentRequest.updateMany({
    where: { id: requestId, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'SETTLING' },
  });
  if (claimed.count === 0) {
    const current = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: requestId } });
    return { status: current.status };
  }

  try {
    const deal = request.deal;
    const config = cardcomConfigFor(deal.business);
    const charge = await prisma.dealCharge.create({
      data: {
        dealId: deal.id,
        paidAt: outcome.paidAt,
        amountAgorot: outcome.amountAgorot,
        method: 'CARD',
        cardInstallments: outcome.installments,
        reference: [outcome.transactionId, outcome.last4 ? `כרטיס ${outcome.last4}` : null].filter(Boolean).join(' · '),
        notes: 'שולם בדף התשלום',
      },
    });

    let documentId: string | null = null;
    if (outcome.document) {
      const externalId = `${config.terminalNumber}:${outcome.document.typeId}:${outcome.document.number}`;
      const existing = await prisma.document.findUnique({ where: { businessId_source_externalId: { businessId: request.businessId, source: 'CARDCOM', externalId } }, select: { id: true } });
      if (existing) {
        documentId = existing.id;
        await prisma.document.update({ where: { id: existing.id }, data: { dealId: deal.id } });
      } else {
        const isVatFree = deal.vatTreatment !== 'STANDARD';
        const amounts = isVatFree
          ? { netAgorot: outcome.amountAgorot, vatAgorot: 0, totalAgorot: outcome.amountAgorot }
          : fromGross(outcome.amountAgorot, deal.vatRateBp);
        const created = await prisma.document.create({
          data: {
            businessId: request.businessId,
            dealId: deal.id,
            direction: 'INCOME',
            docType: outcome.document.typeName === 'Receipt' ? 'RECEIPT' : 'TAX_INVOICE_RECEIPT',
            status: 'CONFIRMED',
            issueDate: outcome.paidAt,
            reportDate: outcome.paidAt,
            number: outcome.document.number,
            counterpartyName: deal.customerName,
            counterpartyVatId: deal.customerVatId,
            netAgorot: amounts.netAgorot,
            vatAgorot: amounts.vatAgorot,
            totalAgorot: amounts.totalAgorot,
            vatRateBp: deal.vatRateBp,
            vatTreatment: isVatFree ? 'EXEMPT' : 'STANDARD',
            installments: outcome.installments > 1 ? outcome.installments : null,
            installmentAgorot: outcome.constAgorot,
            firstInstallmentAgorot: outcome.firstAgorot && outcome.firstAgorot !== outcome.constAgorot ? outcome.firstAgorot : null,
            source: 'CARDCOM',
            externalId,
            paymentLines: [{ date: outcome.paidAt.toISOString(), amountAgorot: outcome.amountAgorot, method: 'כרטיס אשראי', reference: outcome.transactionId }],
            notes: outcome.document.url,
            ocrRaw: result as object,
          },
          select: { id: true },
        });
        documentId = created.id;
        await assignToPeriod({ businessId: request.businessId, documentId: created.id, reportDate: outcome.paidAt, frequency: deal.business.vatFrequency });
        await syncSchedule(created.id);
      }
      await prisma.dealCharge.update({ where: { id: charge.id }, data: { documentId } });
    }

    await prisma.paymentRequest.update({
      where: { id: requestId },
      data: { status: 'PAID', chargeId: charge.id, transactionId: outcome.transactionId, resolvedAt: new Date(), failureReason: null },
    });
    await refreshDealStatus(deal.id);

    if (documentId) {
      try {
        const { refreshPaymentsFromDocument } = await import('./document-payments');
        await refreshPaymentsFromDocument(documentId, { frequency: deal.business.vatFrequency });
      } catch {
        // ה-PDF יורד בסנכרון הבא
      }
    }
    return { status: 'PAID' };
  } catch (error) {
    await prisma.paymentRequest.update({ where: { id: requestId }, data: { status: 'PENDING', failureReason: `רישום התשלום נכשל: ${error instanceof Error ? error.message : String(error)}` } });
    throw error;
  }
}
