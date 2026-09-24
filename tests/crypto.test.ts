import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret, isCryptoConfigured } from '../lib/crypto';

test('הצפנה ופענוח של סוד, ועם מפתח אחר — כישלון', () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64');
  const enc = encryptSecret('סיסמה-סודית-123');
  assert.notEqual(enc, 'סיסמה-סודית-123');
  assert.equal(decryptSecret(enc), 'סיסמה-סודית-123');
  assert.notEqual(encryptSecret('x'), encryptSecret('x'), 'IV אקראי בכל הצפנה');
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64');
  assert.throws(() => decryptSecret(enc));
});

test('בלי מפתח — שמירה נכשלת בקול', () => {
  delete process.env.CREDENTIALS_KEY;
  assert.equal(isCryptoConfigured(), false);
  assert.throws(() => encryptSecret('x'), /CREDENTIALS_KEY/);
});
