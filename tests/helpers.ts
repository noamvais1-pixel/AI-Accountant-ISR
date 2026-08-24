import type { Document } from '@prisma/client';

let counter = 0;

/** בונה מסמך לבדיקות עם ברירות מחדל סבירות. */
export function doc(overrides: Partial<Document> = {}): Document {
  counter++;
  const net = overrides.netAgorot ?? 10000;
  const vat = overrides.vatAgorot ?? 1800;
  return {
    id: `doc_${counter}`,
    businessId: 'biz_1',
    direction: 'EXPENSE',
    docType: 'TAX_INVOICE',
    status: 'CONFIRMED',
    issueDate: new Date('2026-07-15T00:00:00Z'),
    reportDate: new Date('2026-07-15T00:00:00Z'),
    number: String(1000 + counter),
    allocationNumber: null,
    contactId: null,
    counterpartyName: 'ספק בדיקה',
    counterpartyVatId: '520000472',
    currency: 'ILS',
    fxRate: null,
    netAgorot: net,
    vatAgorot: vat,
    totalAgorot: overrides.totalAgorot ?? net + vat,
    vatRateBp: 1800,
    isCredit: false,
    vatTreatment: 'STANDARD',
    inputKind: 'OTHER',
    deductibleBp: 10000,
    deductibleVatAgorot: vat,
    category: null,
    notes: null,
    source: 'MANUAL',
    externalId: null,
    fileKey: null,
    fileMime: null,
    ocrRaw: null,
    ocrConfidence: null,
    vatPeriodId: null,
    createdAt: new Date('2026-07-15T00:00:00Z'),
    updatedAt: new Date('2026-07-15T00:00:00Z'),
    ...overrides,
  } as Document;
}

export function income(overrides: Partial<Document> = {}): Document {
  return doc({ direction: 'INCOME', inputKind: null, ...overrides });
}
