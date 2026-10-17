'use strict';
const fs = require('node:fs');
const path = require('node:path');
const createI18n = require('../public/i18n-core');
const languages = ['de', 'en', 'es'];
const catalogs = Object.fromEntries(languages.map(language => [language, JSON.parse(fs.readFileSync(path.join(__dirname, '../public/locales', language + '.json'), 'utf8'))]));
const translators = Object.fromEntries(languages.map(language => [language, createI18n({ language, messages: catalogs[language], fallback: catalogs.de })]));
function requestLanguage(request) {
  const cookie = String(request.headers?.cookie || '').match(/(?:^|;\s*)cryptobuch_language=(de|en|es)(?:;|$)/)?.[1];
  if (cookie) return cookie;
  const requested = String(request.headers?.['accept-language'] || '').split(',').map((entry, index) => {
    const [tag, quality] = entry.trim().split(';');
    return { language: tag.toLowerCase().split('-')[0], quality: quality ? Number(quality.trim().replace(/^q=/, '')) : 1, index };
  }).filter(entry => languages.includes(entry.language) && entry.quality > 0 && entry.quality <= 1).sort((a,b) => b.quality - a.quality || a.index - b.index);
  return requested[0]?.language || 'de';
}
function registerI18n(app) {
  // Public, including on the password screen. No account data is included.
  app.get('/locales/catalog.js', (request, response) => {
    // Default UI remains German until a language is explicitly selected.
    const language = requestLanguage({ headers: { cookie: request.headers.cookie } });
    response.set({ 'Cache-Control': 'no-store', Vary: 'Cookie', 'Content-Language': language });
    response.type('application/javascript').send('window.CryptoBuchLocaleData = ' + JSON.stringify({ language, messages: catalogs[language], fallback: catalogs.de }).replace(/</g, '\\u003c') + ';');
  });
  app.use('/api', (request, response, next) => {
    const language = requestLanguage(request);
    response.set('Content-Language', language);
    const json = response.json;
    response.json = function (body) {
      if (body && typeof body === 'object' && typeof body.error === 'string') body = { ...body, error: translators[language].message(body.error) };
      return json.call(this, body);
    };
    next();
  });
}
module.exports = { registerI18n, requestLanguage, catalogs, translators };
