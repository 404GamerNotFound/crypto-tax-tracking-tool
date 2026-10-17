'use strict';
/* Shared message formatting. Catalogs contain plain text, never executable HTML. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createCryptoBuchI18n = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function ({ language = 'de', messages = {}, fallback = {} } = {}) {
  const locales = { de: 'de-DE', en: 'en-GB', es: 'es-ES' };
  if (!Object.hasOwn(locales, language)) language = 'de';
  const own = (object, key) => Object.hasOwn(object, key);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  function t(key, parameters = {}) {
    const text = own(messages, key) ? messages[key] : own(fallback, key) ? fallback[key] : key;
    return String(text).replace(/\{([a-zA-Z]\w*)\}/g, (token, name) => own(parameters, name) ? String(parameters[name] ?? '') : token);
  }
  // Existing HTML templates pass escaped text or deliberate HTML fragments as
  // parameters. Escape only catalog text; never evaluate translations as code.
  function html(key, parameters = {}) {
    return escapeHtml(t(key)).replace(/\{([a-zA-Z]\w*)\}/g, (token, name) => own(parameters, name) ? String(parameters[name] ?? '') : token);
  }
  let patterns;
  function message(value) {
    if (typeof value !== 'string' || language === 'de') return value;
    if (own(messages, value)) return t(value);
    if (value.length > 12000) return value;
    patterns ||= Object.keys(fallback).filter(key => /\{p\d+\}/.test(key) && key.replace(/\{p\d+\}/g, '').trim().length >= 8).map(key => {
      const names = [];
      const pattern = key.split(/(\{p\d+\})/g).map(part => {
        if (/^\{p\d+\}$/.test(part)) { names.push(part.slice(1, -1)); return '([\\s\\S]*?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      return { key, names, pattern: new RegExp('^' + pattern + '$') };
    }).sort((a, b) => b.key.length - a.key.length);
    for (const { key, names, pattern } of patterns) {
      const match = pattern.exec(value);
      if (match) return t(key, Object.fromEntries(names.map((name, i) => [name, match[i + 1]])));
    }
    return value;
  }
  return Object.freeze({ language, locale: locales[language], t, html, message,
    plural: (count, forms, parameters = {}) => t(forms[new Intl.PluralRules(locales[language]).select(count)] || forms.other, { count, ...parameters }) });
});
