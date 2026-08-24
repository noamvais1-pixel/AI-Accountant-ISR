import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapCardcomDocument } from '../lib/invoicing/cardcom-provider';
import { CARDCOM_TYPE_MAP, isImportableDocType } from '../lib/cardcom/client';
import type { CardcomDocument } from '../lib/cardcom/client';

/** מסמך קארדקום לבדיקות. */
function ccDoc(overrides: Partial<CardcomDocument> = {}): CardcomDocument {
  return {
    Invoice_Number: 1041,
    InvoiceType: 14,
    InvoiceDate: '2026-07-12T00:00:00',
    InvoiceDateOnly: '2026-07-12',
    Cust_Name: 'חברת אלפא בע"מ',
    Comp_ID: '514678150',
    Email: 'billing@alpha.co.il',
    TotalNoVatNIS: 1000,
    VATOnlyNIS: 180,
    TotalIncludeVATNIS: 1180,
    TotalVatFreeNIS: 0,
    IsNegetive: false,
    Terminal_Number: 1000,
    ExternalId: '',
    UserComments: '',
    ...overrides,
  } as CardcomDocument;
}

test('חשבונית זיכוי (סוג 15) נמשכת ומסומנת כזיכוי', () => {
  const d = mapCardcomDocument(ccDoc({ InvoiceType: 15, IsNegetive: true }));
  assert.ok(d);
  assert.equal(d.documentKind, 'CREDIT_INVOICE');
  assert.equal(d.isCredit, true);
});

test('זיכוי של חשבונית מס/קבלה (סוג 2) גם הוא זיכוי, לא חשבונית רגילה', () => {
  const d = mapCardcomDocument(ccDoc({ InvoiceType: 2 }));
  assert.ok(d);
  assert.equal(d.documentKind, 'CREDIT_INVOICE');
  assert.equal(d.isCredit, true, 'אחרת הזיכוי היה מנפח את ההכנסות במקום להקטין אותן');
});

test('חשבונית רגילה אינה מסומנת כזיכוי', () => {
  for (const type of [1, 14]) {
    const d = mapCardcomDocument(ccDoc({ InvoiceType: type }));
    assert.equal(d?.isCredit, false, `סוג ${type}`);
  }
});

test('כל סוגי הזיכוי בטבלה מסומנים isCredit', () => {
  for (const type of [2, 4, 15, 19]) {
    assert.equal(CARDCOM_TYPE_MAP[type]?.isCredit, true, `סוג ${type} חייב להיות מסומן כזיכוי`);
  }
});

test('IsNegetive מסמן זיכוי גם בסוג שאינו מוכר כזיכוי', () => {
  const d = mapCardcomDocument(ccDoc({ InvoiceType: 14, IsNegetive: true }));
  assert.equal(d?.isCredit, true, 'רשת ביטחון — עדיף לרשום כזיכוי מאשר להוסיף להכנסות');
});

test('הסכומים נשמרים תמיד חיוביים, גם כשקארדקום מחזירה שליליים', () => {
  const d = mapCardcomDocument(
    ccDoc({ InvoiceType: 15, TotalNoVatNIS: -1000, VATOnlyNIS: -180, TotalIncludeVATNIS: -1180, IsNegetive: true }),
  );
  assert.equal(d?.netAgorot, 100000);
  assert.equal(d?.vatAgorot, 18000);
  assert.equal(d?.totalAgorot, 118000);
  assert.equal(d?.isCredit, true, 'הסימן מובע דרך isCredit ולא דרך הסכום');
});

test('מסמכים שאינם אירוע חשבונאי מדולגים', () => {
  // 5=הצעת מחיר, 6=הזמנה, 9=תעודת משלוח, 11=פרופורמה, 12=דרישת תשלום
  for (const type of [5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18]) {
    assert.equal(mapCardcomDocument(ccDoc({ InvoiceType: type })), null, `סוג ${type} לא אמור להיכנס לספרים`);
    assert.equal(isImportableDocType(type), false);
  }
});

test('כל סוגי המסמכים שנכנסים לספרים ממופים', () => {
  for (const type of [1, 2, 3, 4, 14, 15, 16, 19]) {
    assert.ok(isImportableDocType(type), `סוג ${type} חסר בטבלה`);
    assert.ok(mapCardcomDocument(ccDoc({ InvoiceType: type })), `סוג ${type} לא ממופה`);
  }
});

test('מפתח הייחודיות מפריד בין סוגי מסמכים עם אותו מספר', () => {
  // חשבונית 1041 והזיכוי שלה יכולים לשאת את אותו מספר בסוגים שונים
  const invoice = mapCardcomDocument(ccDoc({ InvoiceType: 14, Invoice_Number: 1041 }));
  const credit = mapCardcomDocument(ccDoc({ InvoiceType: 15, Invoice_Number: 1041 }));
  assert.notEqual(invoice?.externalId, credit?.externalId, 'אחרת אחד מהם היה דורס את השני בסנכרון');
});

test('תאריך נשמר כתאריך UTC ולא זז יום לפי אזור זמן', () => {
  const d = mapCardcomDocument(ccDoc({ InvoiceDateOnly: '2026-07-01', InvoiceDate: '2026-07-01T23:30:00' }));
  assert.equal(d?.issueDate.toISOString(), '2026-07-01T00:00:00.000Z');
});

test('שדות ריקים מקארדקום לא שוברים את המיפוי', () => {
  const d = mapCardcomDocument(ccDoc({ Cust_Name: '', Comp_ID: '   ', Email: '' }));
  assert.equal(d?.customerName, 'לקוח ללא שם');
  assert.equal(d?.customerVatId, null);
  assert.equal(d?.customerEmail, null);
});

// ---------------------------------------------------------------------------
// מהמסמך של קארדקום עד השורה בדוח המע"מ
// ---------------------------------------------------------------------------

test('חשבונית זיכוי מקארדקום מגיעה לספרים כזיכוי שמקטין את המע"מ', async () => {
  const { toDocumentData } = await import('../lib/services/sync-cardcom');
  const { buildVatReport } = await import('../lib/reports/vat-report');
  const { buildPeriod } = await import('../lib/periods');
  const { doc: makeDoc } = await import('./helpers');

  const invoice = mapCardcomDocument(ccDoc({ InvoiceType: 14, Invoice_Number: 1041 }))!;
  const credit = mapCardcomDocument(
    ccDoc({ InvoiceType: 15, Invoice_Number: 1042, TotalNoVatNIS: 300, VATOnlyNIS: 54, TotalIncludeVATNIS: 354, IsNegetive: true }),
  )!;

  const rows = [invoice, credit].map((d) => {
    const data = toDocumentData('biz_1', d);
    assert.equal(data.vatTreatment, 'STANDARD', `${d.documentKind} חייב להיספר בדוח`);
    return makeDoc({ ...data, direction: 'INCOME', inputKind: null });
  });

  const report = buildVatReport(buildPeriod(2026, 4, 'BIMONTHLY'), rows);
  assert.equal(report.taxableSalesNet, 70000, 'עסקאות: 1000 - 300 = 700 ש"ח');
  assert.equal(report.taxableSalesVat, 12600, 'מע"מ: 180 - 54 = 126 ש"ח');
  assert.equal(report.creditInvoiceCount, 1);
});

test('קבלה מקארדקום נרשמת ללא מע"מ ולא נספרת כעסקה', async () => {
  const { toDocumentData } = await import('../lib/services/sync-cardcom');
  for (const type of [3, 4, 16, 19]) {
    const data = toDocumentData('biz_1', mapCardcomDocument(ccDoc({ InvoiceType: type }))!);
    assert.equal(data.vatTreatment, 'NO_VAT', `סוג ${type} — קבלה אינה אירוע מע"מ`);
  }
});

test('חשבונית בשיעור אפס מזוהה ככזו ולא כחייבת', async () => {
  const { toDocumentData } = await import('../lib/services/sync-cardcom');
  const data = toDocumentData(
    'biz_1',
    mapCardcomDocument(ccDoc({ InvoiceType: 14, VATOnlyNIS: 0, TotalIncludeVATNIS: 1000 }))!,
  );
  assert.equal(data.vatTreatment, 'ZERO_RATED');
});
