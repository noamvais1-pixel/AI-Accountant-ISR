/**
 * נתוני דמו לבדיקת המערכת מקצה לקצה.
 * הרצה: npm run db:seed
 * מוחק כל מסמך קיים ומייצר תקופה מלאה עם הכנסות, הוצאות וזיכוי.
 */
import { PrismaClient } from '@prisma/client';
import { deductibleVat, vatRateBpAt } from '../lib/vat';
import { toAgorot } from '../lib/money';
import { periodForDate } from '../lib/periods';

const prisma = new PrismaClient();

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

async function main() {
  const business = await prisma.business.upsert({
    where: { vatId: '520000472' },
    create: {
      name: 'עסק לדוגמה',
      vatId: '520000472',
      legalType: 'OSEK_MURSHE',
      vatFrequency: 'BIMONTHLY',
      city: 'תל אביב',
    },
    update: {},
  });

  await prisma.document.deleteMany({ where: { businessId: business.id } });
  await prisma.vatPeriod.deleteMany({ where: { businessId: business.id } });

  const rows = [
    // הכנסות
    { dir: 'INCOME', type: 'TAX_INVOICE_RECEIPT', date: '2026-07-03', num: '1041', name: 'חברת אלפא בע"מ', vatId: '514678150', net: 12000 },
    { dir: 'INCOME', type: 'TAX_INVOICE', date: '2026-07-18', num: '1042', name: 'סטארטאפ בטא', vatId: '300000007', net: 8500 },
    { dir: 'INCOME', type: 'TAX_INVOICE_RECEIPT', date: '2026-08-05', num: '1043', name: 'לקוח פרטי', vatId: null, net: 1400 },
    { dir: 'INCOME', type: 'CREDIT_INVOICE', date: '2026-08-12', num: '1044', name: 'חברת אלפא בע"מ', vatId: '514678150', net: 2000, credit: true },
    // הוצאות
    { dir: 'EXPENSE', type: 'TAX_INVOICE', date: '2026-07-08', num: '77213', name: 'ספקית ענן', vatId: '514678150', net: 1800, cat: 'תשתיות' },
    { dir: 'EXPENSE', type: 'TAX_INVOICE', date: '2026-07-22', num: '5512', name: 'תחנת דלק', vatId: '300000007', net: 620, cat: 'דלק', ded: 6667 },
    { dir: 'EXPENSE', type: 'TAX_INVOICE', date: '2026-08-01', num: '9001', name: 'רהיטי משרד', vatId: '520000472', net: 7400, cat: 'ריהוט', kind: 'EQUIPMENT' },
    { dir: 'EXPENSE', type: 'PETTY_CASH', date: '2026-08-14', num: '31', name: 'מכולת', vatId: null, net: 90, cat: 'כיבוד', ded: 0 },
  ] as const;

  for (const row of rows) {
    const issueDate = utc(row.date);
    const rateBp = vatRateBpAt(issueDate);
    const netAgorot = toAgorot(row.net);
    const vatAgorot = Math.round((netAgorot * rateBp) / 10000);
    const deductibleBp = 'ded' in row ? row.ded! : 10000;

    const period = periodForDate(issueDate, business.vatFrequency);
    const periodRecord = await prisma.vatPeriod.upsert({
      where: { businessId_year_periodNo: { businessId: business.id, year: period.year, periodNo: period.periodNo } },
      create: {
        businessId: business.id,
        year: period.year,
        periodNo: period.periodNo,
        startDate: period.startDate,
        endDate: period.endDate,
      },
      update: {},
    });

    await prisma.document.create({
      data: {
        businessId: business.id,
        direction: row.dir,
        docType: row.type,
        status: 'CONFIRMED',
        issueDate,
        reportDate: issueDate,
        number: row.num,
        counterpartyName: row.name,
        counterpartyVatId: row.vatId,
        netAgorot,
        vatAgorot,
        totalAgorot: netAgorot + vatAgorot,
        vatRateBp: rateBp,
        isCredit: 'credit' in row ? row.credit! : false,
        vatTreatment: 'STANDARD',
        inputKind: row.dir === 'EXPENSE' ? ('kind' in row ? row.kind! : 'OTHER') : null,
        deductibleBp: row.dir === 'EXPENSE' ? deductibleBp : 10000,
        deductibleVatAgorot: row.dir === 'EXPENSE' ? deductibleVat(vatAgorot, deductibleBp) : 0,
        category: 'cat' in row ? row.cat! : null,
        source: row.dir === 'INCOME' ? 'CARDCOM' : 'MANUAL',
        externalId: row.dir === 'INCOME' ? `seed:${row.num}` : null,
        vatPeriodId: periodRecord.id,
      },
    });
  }

  console.log(`נזרעו ${rows.length} מסמכים עבור ${business.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
