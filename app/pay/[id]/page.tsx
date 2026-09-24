import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { formatILS } from '@/lib/money';
import { PayCard } from './pay-card';

export const dynamic = 'force-dynamic';

/**
 * דף התשלום הציבורי. מציג רק מה שהלקוחה צריכה כדי לשלם: על מה, כמה, ולמי.
 * הכרטיס עצמו מוזן בדף המתארח של הסולק.
 */
export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const request = await prisma.paymentRequest.findUnique({
    where: { id },
    include: { deal: { select: { description: true, customerName: true } }, business: { select: { name: true } } },
  });
  if (!request) notFound();

  return (
    <PayCard
      businessName={request.business.name}
      description={request.deal.description}
      customerName={request.deal.customerName}
      amount={formatILS(request.amountAgorot)}
      maxInstallments={request.maxInstallments}
      status={request.status}
      payUrl={request.status === 'PENDING' || request.status === 'FAILED' ? request.payUrl : null}
      failureReason={request.status === 'FAILED' ? request.failureReason : null}
    />
  );
}
