/**
 * לקוח Google Drive — ללא ספריות חיצוניות.
 *
 * ה-API של דרייב פשוט מספיק כדי לעבוד מולו ישירות ב-fetch, וכך נחסכת תלות
 * כבדה (googleapis שוקלת עשרות מגהבייט) עבור שלוש קריאות.
 *
 * ההרשאה: OAuth 2.0 עם refresh token. חשבון שירות לא מתאים כאן — לחשבון שירות
 * אין מכסת אחסון משלו, והעלאה לתיקייה של חשבון Gmail פרטי נכשלת. עם Workspace
 * אפשר היה להשתמש ב-Shared Drive, אבל זו לא ההגדרה כאן.
 *
 * ההיקף המבוקש הוא drive.file בלבד — גישה אך ורק לקבצים שהאפליקציה עצמה יצרה.
 * היא לא רואה ולא נוגעת בשום דבר אחר בדרייב.
 */

/**
 * drive.file לבדו רואה רק קבצים שהאפליקציה עצמה יצרה, ולכן הוא מספיק לגיבוי
 * אבל לא לקליטה מתיקייה קיימת. drive.readonly נדרש כדי לקרוא את תיקיית "עסק".
 * זו הרשאה רחבה — קריאה לכל הדרייב — ולכן היא מבוקשת רק כשהקליטה מופעלת.
 */
export const DRIVE_SCOPE_BACKUP = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_SCOPE_IMPORT = 'https://www.googleapis.com/auth/drive.readonly';

export function driveScopes(): string {
  const withImport = process.env.DRIVE_IMPORT_ENABLED === 'true';
  return withImport ? `${DRIVE_SCOPE_BACKUP} ${DRIVE_SCOPE_IMPORT}` : DRIVE_SCOPE_BACKUP;
}

export const DRIVE_SCOPE = DRIVE_SCOPE_BACKUP;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function googleConfigFromEnv(): GoogleOAuthConfig {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL } = process.env;
  const missing = [!GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID', !GOOGLE_CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET'].filter(Boolean);
  if (missing.length) {
    throw new Error(`חסרים פרטי גוגל בקובץ .env.local: ${missing.join(', ')}`);
  }
  return {
    clientId: GOOGLE_CLIENT_ID!,
    clientSecret: GOOGLE_CLIENT_SECRET!,
    redirectUri: `${(APP_URL || 'http://localhost:3737').replace(/\/$/, '')}/api/drive/callback`,
  };
}

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export class DriveError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'DriveError';
  }
}

// ---------------------------------------------------------------------------
// זרימת ההרשאה
// ---------------------------------------------------------------------------

export function buildConsentUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: driveScopes(),
    // בלי שני אלה גוגל לא מחזירה refresh token בהרשאה חוזרת, והחיבור יפוג תוך שעה.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCodeForTokens(
  config: GoogleOAuthConfig,
  code: string,
): Promise<{ refreshToken: string; accessToken: string }> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new DriveError(`החלפת קוד ההרשאה נכשלה: ${json.error_description || json.error}`, response.status);
  }
  if (!json.refresh_token) {
    throw new DriveError(
      'גוגל לא החזירה refresh token. בדרך כלל זה קורה כשהאפליקציה כבר מאושרת בחשבון — ' +
        'יש להסיר אותה בהגדרות האבטחה של גוגל ולנסות שוב.',
      400,
    );
  }
  return { refreshToken: json.refresh_token, accessToken: json.access_token };
}

/**
 * access token תקף לשעה. אנחנו לא שומרים אותו — מייצרים חדש בכל פעולה.
 * זה מייתר ניהול תפוגה, ובעומס של אפליקציה מקומית העלות זניחה.
 */
export async function getAccessToken(config: GoogleOAuthConfig, refreshToken: string): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new DriveError(
      `חידוש ההרשאה לדרייב נכשל: ${json.error_description || json.error}. ייתכן שההרשאה בוטלה — יש להתחבר מחדש.`,
      response.status,
    );
  }
  return json.access_token as string;
}

export async function getAccountEmail(accessToken: string): Promise<string | null> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const json = await response.json();
  return json.email ?? null;
}

// ---------------------------------------------------------------------------
// תיקיות וקבצים
// ---------------------------------------------------------------------------

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** מנטרל תווים ששוברים שמות קבצים, ומשאיר עברית כמו שהיא. */
export function sanitizeName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'ללא-שם';
}

/**
 * מוצא תיקייה בשם נתון תחת הורה, או יוצר אותה.
 *
 * החיפוש מוגבל ל-drive.file, כלומר רואה רק תיקיות שהאפליקציה עצמה יצרה.
 * זה מכוון: אנחנו לא רוצים לכתוב בטעות לתיקייה קיימת של המשתמשת.
 */
export async function ensureFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const escaped = name.replace(/'/g, "\\'");
  const clauses = [
    `name = '${escaped}'`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
    parentId ? `'${parentId}' in parents` : `'root' in parents`,
  ];

  const query = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id,name)',
    pageSize: '1',
  });

  const search = await fetch(`${API}/files?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!search.ok) {
    throw new DriveError(`חיפוש תיקייה בדרייב נכשל: ${await search.text()}`, search.status);
  }
  const found = (await search.json()).files?.[0];
  if (found) return found.id as string;

  const create = await fetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined }),
  });
  if (!create.ok) {
    throw new DriveError(`יצירת תיקייה בדרייב נכשלה: ${await create.text()}`, create.status);
  }
  return (await create.json()).id as string;
}

export type UploadedFile = { id: string; webViewLink: string | null };

/** מעלה קובץ יחיד. multipart — מתאים לקבצים עד כמה עשרות מגהבייט. */
export async function uploadFile(
  accessToken: string,
  args: { name: string; mimeType: string; parentId: string; data: Buffer; description?: string },
): Promise<UploadedFile> {
  const boundary = `boundary${Math.trunc(performance.now() * 1000)}`;
  const metadata = JSON.stringify({
    name: args.name,
    parents: [args.parentId],
    description: args.description,
  });

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${args.mimeType}\r\n\r\n`),
    args.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const response = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: new Uint8Array(body),
  });

  if (!response.ok) {
    throw new DriveError(`העלאת הקובץ לדרייב נכשלה: ${await response.text()}`, response.status);
  }
  const json = await response.json();
  return { id: json.id, webViewLink: json.webViewLink ?? null };
}
