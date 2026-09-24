import type { Business, MerchantApplication } from '@prisma/client';

/**
 * שליחת בקשה לפתיחת חשבון סליקה דרך ה-API של קארדקום לשותפים.
 *
 * דורש פרטי שותף (CARDCOM_SUPPLIER_*) שמתקבלים בהסכם השותפים. בלי הפרטים
 * הבקשה נשמרת אצלנו במצב READY ותישלח כשהחיבור יופעל. עם הפרטים — נשלחת
 * קודם בדיקה בלבד (IsValidationOnly), ורק אם עברה, הבקשה האמיתית.
 *
 * קודי עיר ורחוב: הסולק דורש קודים מהרשימות שלו; כאן הם נפתרים לפי השם.
 */

export type SupplierConfig = { baseUrl: string; userName: string; password: string; secret: string };

export function supplierConfigFromEnv(): SupplierConfig | null {
  const { CARDCOM_SUPPLIER_USERNAME, CARDCOM_SUPPLIER_PASSWORD, CARDCOM_SUPPLIER_SECRET, CARDCOM_BASE_URL } = process.env;
  if (!CARDCOM_SUPPLIER_USERNAME || !CARDCOM_SUPPLIER_PASSWORD || !CARDCOM_SUPPLIER_SECRET) return null;
  return { baseUrl: CARDCOM_BASE_URL || 'https://secure.cardcom.solutions', userName: CARDCOM_SUPPLIER_USERNAME, password: CARDCOM_SUPPLIER_PASSWORD, secret: CARDCOM_SUPPLIER_SECRET };
}

type CodeRow = { Code?: number; code?: number; Id?: number; Name?: string; name?: string; Description?: string };

async function lookup(cfg: SupplierConfig, path: string, params: Record<string, string>): Promise<CodeRow[]> {
  const url = new URL(`${cfg.baseUrl}/api/v11/CompanyOperations/${path}`);
  url.searchParams.set('SupplierUserName', cfg.userName);
  url.searchParams.set('secret', cfg.secret);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`קארדקום החזירה ${res.status} עבור ${path}`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.Items ?? json.List ?? json.Content ?? []);
}

const norm = (s: string) => s.replace(/["'׳״\-–]/g, ' ').replace(/\s+/g, ' ').trim();

function pick(rows: CodeRow[], name: string): number | null {
  const target = norm(name);
  const exact = rows.find((r) => norm(r.Name ?? r.name ?? r.Description ?? '') === target);
  const row = exact ?? rows.find((r) => norm(r.Name ?? r.name ?? r.Description ?? '').startsWith(target));
  const code = row?.Code ?? row?.code ?? row?.Id;
  return typeof code === 'number' ? code : null;
}

export async function resolveCity(cfg: SupplierConfig, city: string): Promise<number | null> {
  return pick(await lookup(cfg, 'GetCities', { startwith: city.slice(0, 3) }), city);
}

export async function resolveStreet(cfg: SupplierConfig, cityCode: number, street: string): Promise<number | null> {
  return pick(await lookup(cfg, 'GetStreets', { cityCode: String(cityCode), startwith: street.slice(0, 3) }), street);
}

const ddmmyyyy = (d: Date | null) => (d ? `${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${d.getUTCFullYear()}` : undefined);
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

/** בונה את גוף הבקשה. טהור — כדי שאפשר יהיה לבדוק אותו בלי לשלוח. */
export function buildNewCompanyRequest(
  business: Business,
  app: MerchantApplication,
  codes: { cityCode: number; streetCode: number | null; ownerCityCode: number | null; ownerStreetCode: number | null },
  cfg: { userName: string; password: string; secret: string },
  validationOnly: boolean,
) {
  const kyc = (app.kycAnswers ?? {}) as Record<string, unknown>;
  const ownerAddressDiffers = Boolean(app.ownerCity && app.ownerCity !== business.city);
  return {
    SupplierUserName: cfg.userName,
    SupplierPassword: cfg.password,
    Secret: cfg.secret,
    IsValidationOnly: validationOnly,
    CompanyInfo: {
      Name: business.name,
      NameLegalCorporation: business.name,
      BusinessRegistrationNumber: business.vatId,
      Activity: app.activity ?? undefined,
      ContactPerson: [app.ownerFirstName, app.ownerLastName].filter(Boolean).join(' ') || undefined,
      Email: business.email ?? app.ownerEmail ?? undefined,
      PhoneNumber: business.phone ?? undefined,
      MobilePhone: app.ownerPhone ?? business.phone ?? undefined,
      CityCode: codes.cityCode,
      StreetCode: codes.streetCode ?? undefined,
      HouseNumber: app.houseNumber ?? undefined,
      ZipCode: app.zip ?? undefined,
      WebSiteUrl: app.websiteUrl ?? undefined,
      IsVatFreeCompany: business.legalType === 'AMUTA',
      Citizenship: 'Israel',
      CompanyInternalID: business.id,
    },
    UserInfo: {
      FirstName: app.ownerFirstName ?? undefined,
      LastName: app.ownerLastName ?? undefined,
      IdentityNumber: app.ownerIdentityNumber ?? undefined,
      IdentityIssueDate: ymd(app.ownerIdIssueDate),
      BirthDate: ymd(app.ownerBirthDate),
      Email: app.ownerEmail ?? business.email ?? undefined,
      MobilePhone: app.ownerPhone ?? undefined,
      CityCode: codes.ownerCityCode ?? codes.cityCode,
      StreetCode: codes.ownerStreetCode ?? codes.streetCode ?? undefined,
      ZipCode: app.ownerZip ?? app.zip ?? undefined,
    },
    TerminalInfo: {
      BankCode: app.bankCode ?? undefined,
      BankBranchCode: app.bankBranch ?? undefined,
      BankAccountNumber: app.bankAccount ?? undefined,
    },
    KycInfo: {
      KycInfoGeneric: {
        TypeOfPlannedService: app.activity ?? undefined,
        EstimatedMonthlyTransactionAmount: kyc.monthlyTransactions ?? undefined,
        AvarageTransactionAmountInCreditCard: kyc.averageAmount ?? undefined,
        MaximumAmountOfCreditTransaction: kyc.maxAmount ?? undefined,
        ExpectedPaymentNumberForAverageTransaction: kyc.typicalInstallments ?? undefined,
        IsTheBusinessPreviouslyClearedCreditCards: kyc.clearedBefore ?? undefined,
        CountriesTargetedMarket: 'ישראל',
        IsPaymentsFacilitator: false,
      },
      KycInfoOsekMurshe: {
        IsOwnerAddressDifferentFromBusinessAddress: ownerAddressDiffers,
        BusinessOwnerHomeNumber: ownerAddressDiffers ? app.ownerHouseNumber ?? undefined : undefined,
        BusinessOwnerCityCode: ownerAddressDiffers ? codes.ownerCityCode ?? undefined : undefined,
        BusinessOwnerStreetCode: ownerAddressDiffers ? codes.ownerStreetCode ?? undefined : undefined,
        BusinessOwnerZipCode: ownerAddressDiffers ? app.ownerZip ?? undefined : undefined,
      },
    },
    ...(ddmmyyyy(null) ? {} : {}),
  };
}

export type SubmitResult = { sent: boolean; companyInternalId?: string; response?: unknown; message: string };

export async function submitToCardcom(business: Business, app: MerchantApplication): Promise<SubmitResult> {
  const cfg = supplierConfigFromEnv();
  if (!cfg) return { sent: false, message: 'הבקשה נשמרה ותישלח לקארדקום אוטומטית כשהסכם השותפים יופעל.' };
  if (!business.city || !app.street) throw new Error('חסרים עיר ורחוב של העסק.');
  const cityCode = await resolveCity(cfg, business.city);
  if (cityCode == null) throw new Error(`העיר "${business.city}" לא נמצאה ברשימת קארדקום. בדקי את האיות.`);
  const streetCode = await resolveStreet(cfg, cityCode, app.street);
  const ownerCityCode = app.ownerCity ? await resolveCity(cfg, app.ownerCity) : null;
  const ownerStreetCode = ownerCityCode != null && app.ownerStreet ? await resolveStreet(cfg, ownerCityCode, app.ownerStreet) : null;

  const call = async (validationOnly: boolean) => {
    const res = await fetch(`${cfg.baseUrl}/api/v11/CompanyOperations/NewCompany`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildNewCompanyRequest(business, app, { cityCode, streetCode, ownerCityCode, ownerStreetCode }, cfg, validationOnly)),
    });
    const json = (await res.json()) as { ResponseCode?: number; Description?: string; CompanyInternalID?: string; [k: string]: unknown };
    if (!res.ok || json.ResponseCode !== 0) throw new Error(json.Description || `קארדקום החזירה ${res.status}`);
    return json;
  };
  await call(true);
  const real = await call(false);
  return { sent: true, companyInternalId: real.CompanyInternalID, response: real, message: 'הבקשה נשלחה לקארדקום. הם יבדקו אותה ויעדכנו.' };
}
