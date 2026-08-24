import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidIsraeliId, normalizeVatId } from '../lib/israeli-id';

test('מזהה מספרי ח.פ תקינים', () => {
  assert.ok(isValidIsraeliId('520000472'));
  assert.ok(isValidIsraeliId('514678150'));
  assert.ok(isValidIsraeliId('300000007'));
});

test('דוחה מספרים עם ספרת ביקורת שגויה', () => {
  assert.ok(!isValidIsraeliId('514678158'));
  assert.ok(!isValidIsraeliId('123456789'));
});

test('דוחה קלט ריק או ארוך מדי', () => {
  assert.ok(!isValidIsraeliId(''));
  assert.ok(!isValidIsraeliId(null));
  assert.ok(!isValidIsraeliId('1234567890'));
});

test('נרמול משלים ל-9 ספרות ומסיר תווים', () => {
  assert.equal(normalizeVatId('12345678'), '012345678');
  assert.equal(normalizeVatId('51-467-8150'), '514678150');
  assert.equal(normalizeVatId(''), null);
});
