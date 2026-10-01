const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const en = require('../src/renderer/src/locales/en/translation.json');
const tr = require('../src/renderer/src/locales/tr-TR/translation.json');
function flatten(value, prefix = '') {
  return Object.entries(value).flatMap(([key, item]) => typeof item === 'object'
    ? flatten(item, prefix + key + '.') : [[prefix + key, item]]);
}
test('Turkish has every English UI key and preserves interpolation fields', () => {
  const translations = new Map(flatten(tr));
  for (const [key, text] of flatten(en)) {
    assert.ok(translations.has(key), key);
    const translation = translations.get(key);
    assert.equal(typeof translation, 'string', key);
    assert.ok(translation.trim(), key);
    const fields = (s) => [...s.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(fields(translation), fields(text), key);
    assert.ok(!translation.includes('\uFFFD'), key);
  }
});
test('Turkish is the default and English is retained', () => {
  const source = fs.readFileSync('src/renderer/src/i18n.ts', 'utf8');
  assert.match(source, /fallbackLng:\s*["']tr-TR["']/);
  assert.match(source, /enTranslation/);
});
