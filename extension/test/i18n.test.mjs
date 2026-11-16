import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  messages,
  resolveLanguage,
  translate,
} from '../src/i18n.mjs';

test('English is the default and language values fail back without rewriting storage', () => {
  assert.equal(DEFAULT_LANGUAGE, 'en');
  assert.equal(LANGUAGE_STORAGE_KEY, 'uiLanguage');
  assert.deepEqual(resolveLanguage(undefined), { language: 'en', unsupported: false });
  assert.deepEqual(resolveLanguage('pt-BR'), { language: 'pt-BR', unsupported: false });
  assert.deepEqual(resolveLanguage('pt'), { language: 'en', unsupported: true });
  assert.deepEqual(resolveLanguage('es'), { language: 'en', unsupported: true });
});

test('English and Brazilian Portuguese have matching stable keys and placeholders', () => {
  const englishKeys = Object.keys(messages.en).sort();
  const portugueseKeys = Object.keys(messages['pt-BR']).sort();
  assert.deepEqual(portugueseKeys, englishKeys);

  const placeholders = (text) =>
    [...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
  for (const key of englishKeys) {
    assert.deepEqual(placeholders(messages['pt-BR'][key]), placeholders(messages.en[key]), key);
  }
});

test('localized status interpolation preserves backend identifiers', () => {
  assert.equal(translate('en', 'apiResponseStatus', { status: 503 }), 'The API returned HTTP 503.');
  assert.equal(
    translate('pt-BR', 'apiResponseStatus', { status: 503 }),
    'A API respondeu com HTTP 503.',
  );
  assert.equal(translate('pt-BR', 'unknown-key'), 'unknown-key');
});
