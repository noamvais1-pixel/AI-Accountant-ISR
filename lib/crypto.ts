import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * הצפנת סודות של לקוחות (סיסמת ה-API של קארדקום לכל עסק).
 *
 * AES-256-GCM עם מפתח ב-CREDENTIALS_KEY (32 בתים ב-base64). בלי מפתח אי אפשר
 * לשמור סוד — עדיף שהשמירה תיכשל בקול מאשר שסיסמה תישמר גלויה במסד.
 * הפורמט: v1.<iv>.<tag>.<ciphertext>, הכל ב-base64.
 */

function key(): Buffer {
  const raw = process.env.CREDENTIALS_KEY;
  if (!raw) throw new Error('חסר CREDENTIALS_KEY — אי אפשר לשמור או לקרוא סודות של לקוחות.');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('CREDENTIALS_KEY חייב להיות 32 בתים ב-base64.');
  return buf;
}

export function isCryptoConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('סוד בפורמט לא מוכר.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
