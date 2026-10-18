'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const createI18n = require('../public/i18n-core');
const { catalogs, translators, requestLanguage, registerI18n } = require('../lib/i18n');
const publicDir = path.join(__dirname, '../public');
const decodeAttribute = text => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('all language catalogs have matching keys, nonempty translations and known placeholders', () => {
  const keys = Object.keys(catalogs.de).sort();
  assert.ok(keys.length > 2000);
  for (const [language, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(catalog).sort(), keys);
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(typeof value, 'string', `${language}: ${key}`);
      assert.ok(value.trim(), `${language}: ${key}`);
      const names = new Set([...key.matchAll(/\{([a-zA-Z]\w*)\}/g)].map(match => match[1]));
      for (const match of value.matchAll(/\{([a-zA-Z]\w*)\}/g)) assert.ok(names.has(match[1]), `${language}: unknown ${match[0]} in ${key}`);
    }
  }
});

test('every explicit HTML/JS message exists and pages load i18n before UI scripts', () => {
  for (const file of fs.readdirSync(publicDir).filter(file => /\.(html|js)$/.test(file) && !/ledger-connect/.test(file))) {
    const source = fs.readFileSync(path.join(publicDir, file), 'utf8');
    for (const match of source.matchAll(/CryptoBuchI18n\.(?:t|html)\(("(?:\\.|[^"\\])*")/g)) {
      const key = JSON.parse(match[1]); assert.ok(Object.hasOwn(catalogs.de, key), `${file}: ${key}`);
    }
    if (!file.endsWith('.html')) continue;
    for (const match of source.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]*)"/g)) {
      const key = decodeAttribute(match[1]); assert.ok(Object.hasOwn(catalogs.de, key), `${file}: ${key}`);
    }
    assert.match(source, /src="\/locales\/catalog.js" defer/);
    assert.ok(source.indexOf('src="/locales/catalog.js"') < source.indexOf('src="/i18n-core.js"'));
    assert.ok(source.indexOf('src="/i18n-core.js"') < source.indexOf('src="/i18n.js"'));
    if (source.includes('src="/ui.js')) assert.ok(source.indexOf('src="/i18n.js"') < source.indexOf('src="/ui.js'));
    assert.doesNotMatch(source, /<option[^>]*>\s*<span/);
  }
});

test('fallback, interpolation, plural selection and HTML escaping preserve opaque user data', () => {
  const i18n = createI18n({ language: 'es', messages: { 'Hello {name}': 'Hola {name}', html: '<script>{name}</script>', one: '{count} registro', many: '{count} registros' }, fallback: { missing: 'fallback' } });
  assert.equal(i18n.t('Hello {name}', { name: 'Kauf {p0}' }), 'Hola Kauf {p0}');
  assert.equal(i18n.t('missing'), 'fallback');
  assert.equal(i18n.t('unknown'), 'unknown');
  assert.equal(i18n.t('constructor'), 'constructor');
  assert.equal(i18n.html('html', { name: '&lt;user&gt;' }), '&lt;script&gt;&lt;user&gt;&lt;/script&gt;');
  assert.equal(i18n.plural(1, { one: 'one', other: 'many' }), '1 registro');
  assert.equal(i18n.plural(2, { one: 'one', other: 'many' }), '2 registros');
  assert.equal(createI18n({ language: '../../xx' }).locale, 'de-DE');
  assert.equal(translators.en.message('Ungültige Zielversion.'), 'Invalid target version.');
  assert.equal(translators.es.message('Unbekannter Binance-Markt: Kauf'), 'Mercado de Binance desconocido: Kauf');
  assert.equal(translators.es.message('custom user note'), 'custom user note');
  assert.equal(translators.en.locale, 'en-GB');
});

test('language cookies take priority, unsupported languages and zero quality are rejected', () => {
  assert.equal(requestLanguage({headers:{cookie:'x=1; cryptobuch_language=es', 'accept-language':'en'}}), 'es');
  assert.equal(requestLanguage({headers:{'accept-language':'fr, en-US;q=0.4, es-MX;q=0.8'}}), 'es');
  assert.equal(requestLanguage({headers:{'accept-language':'es;q=0,en;q=2'}}), 'de');
  assert.equal(requestLanguage({headers:{cookie:'cryptobuch_language=es<script>', 'accept-language':'en'}}), 'en');
  assert.equal(requestLanguage({headers:{}}), 'de');
});

test('public catalog has no account data and API localization preserves canonical fields', () => {
  const routes = {}, middleware = {};
  registerI18n({ get(route, handler) { routes[route] = handler; }, use(route, handler) { middleware[route] = handler; } });
  const headers = {}; let script;
  routes['/locales/catalog.js']({ headers: {cookie:'cryptobuch_language=es'} }, {
    set(values) { Object.assign(headers, values); }, type() { return this; }, send(value) { script = value; },
  });
  const context = { window: {} }; vm.runInNewContext(script, context);
  assert.equal(context.window.CryptoBuchLocaleData.language, 'es');
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['Content-Language'], 'es');
  assert.deepEqual(Object.keys(context.window.CryptoBuchLocaleData).sort(), ['fallback','language','messages']);
  let body; const response = { set() {}, json(value) { body = value; } };
  middleware['/api']({ headers: {cookie:'cryptobuch_language=en'} }, response, () => {});
  const original = { error:'Ungültige Zielversion.', purpose:'Kauf', label:'Kauf', amount:1.234, key:'literal' };
  response.json(original);
  assert.equal(body.error, 'Invalid target version.');
  assert.equal(original.error, 'Ungültige Zielversion.');
  for (const field of ['purpose','label','amount','key']) assert.equal(body[field], original[field]);
});

test('purpose presentation translates known labels and preserves custom user labels', () => {
  for (const language of ['de','en','es']) {
    const window = { CryptoBuchI18n: translators[language] };
    vm.runInNewContext(fs.readFileSync(path.join(publicDir,'ui.js'),'utf8'), { window, Intl });
    assert.equal(window.CryptoBuchUI.purposeInfo({purpose:'Kauf'}).label, translators[language].t('Kauf'));
    assert.equal(window.CryptoBuchUI.purposeInfo({purpose:'Meine private Buchung'}).label, 'Meine private Buchung');
  }
});
