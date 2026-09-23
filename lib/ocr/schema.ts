import { z } from 'zod';

/**
 * המבנה שה-AI מחזיר מקריאת קבלה או חשבונית.
 * כל שדה יכול לחזור null — עדיף ריק מאשר ניחוש, כי המשתמש מאשר ידנית ממילא.
 */
export const ExtractedDocumentSchema = z.object({
  documentKind: z
    .enum(['TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'RECEIPT', 'CREDIT_INVOICE', 'IMPORT_DECLARATION', 'OTHER_DOC', 'UNKNOWN'])
    .describe('סוג המסמך כפי שהוא מזוהה מהכותרת'),
  isCredit: z.boolean().describe('האם זו חשבונית זיכוי / ביטול'),

  // הצד השני לעסקה: בהוצאה זה הספק, בהכנסה זה הלקוח.
  counterpartyName: z.string().nullable(),
  counterpartyVatId: z.string().nullable().describe('ח.פ או ע.מ של הצד השני, ספרות בלבד'),

  documentNumber: z.string().nullable(),
  allocationNumber: z.string().nullable().describe('מספר הקצאה של רשות המסים, אם מופיע'),

  issueDate: z.string().nullable().describe('תאריך המסמך בפורמט YYYY-MM-DD'),

  currency: z.string().nullable().describe('קוד מטבע בן 3 אותיות, ILS כברירת מחדל'),
  netAmount: z.number().nullable().describe('הסכום לפני מע"מ, ביחידות המטבע'),
  vatAmount: z.number().nullable().describe('סכום המע"מ'),
  totalAmount: z.number().nullable().describe('הסכום הכולל לתשלום'),
  vatRatePercent: z.number().nullable().describe('שיעור המע"מ באחוזים, למשל 18'),
  installments: z.number().int().nullable().describe('מספר תשלומים בעסקת אשראי, אם צוין ("מס\' תשלומים: 12"). null אם לא צוין'),

  categoryGuess: z.string().nullable().describe('סיווג הוצאה מוצע בעברית'),
  lineItems: z
    .array(z.object({ description: z.string(), amount: z.number().nullable() }))
    .nullable(),

  confidence: z.number().min(0).max(1).describe('מידת הביטחון בקריאה, 0 עד 1'),
  warnings: z.array(z.string()).describe('דברים שלא היו ברורים ודורשים בדיקה של המשתמש'),
});

export type ExtractedDocument = z.infer<typeof ExtractedDocumentSchema>;

/** סכימת JSON עבור Gemini — responseSchema דורש JSON Schema ולא Zod. */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    documentKind: {
      type: 'string',
      enum: ['TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'RECEIPT', 'CREDIT_INVOICE', 'IMPORT_DECLARATION', 'OTHER_DOC', 'UNKNOWN'],
    },
    isCredit: { type: 'boolean' },
    counterpartyName: { type: 'string', nullable: true },
    counterpartyVatId: { type: 'string', nullable: true },
    documentNumber: { type: 'string', nullable: true },
    allocationNumber: { type: 'string', nullable: true },
    issueDate: { type: 'string', nullable: true },
    currency: { type: 'string', nullable: true },
    netAmount: { type: 'number', nullable: true },
    vatAmount: { type: 'number', nullable: true },
    totalAmount: { type: 'number', nullable: true },
    vatRatePercent: { type: 'number', nullable: true },
    installments: { type: 'integer', nullable: true },
    categoryGuess: { type: 'string', nullable: true },
    lineItems: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        properties: { description: { type: 'string' }, amount: { type: 'number', nullable: true } },
        required: ['description'],
      },
    },
    confidence: { type: 'number' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['documentKind', 'isCredit', 'confidence', 'warnings'],
} as const;
