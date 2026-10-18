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
    // Match legacy server templates without regex backtracking. Dynamic values
    // are opaque: never recursively translate user labels embedded in messages.
    patterns ||= Object.keys(fallback).filter(key => /\{p\d+\}/.test(key) && key.replace(/\{p\d+\}/g, '').trim().length >= 8 && !/\{p\d+\}\s*\{p\d+\}/.test(key)).map(key => ({
      key, names: [...key.matchAll(/\{(p\d+)\}/g)].map(match => match[1]), parts: key.split(/\{p\d+\}/g),
    })).sort((a, b) => b.key.length - a.key.length);
    for (const { key, names, parts } of patterns) {
      if (!value.startsWith(parts[0])) continue;
      const parameters = {};
      let offset = parts[0].length, matched = true;
      for (let i = 0; i < names.length; i++) {
        const separator = parts[i + 1];
        const last = i === names.length - 1;
        const end = last ? (value.endsWith(separator) ? value.length - separator.length : -1) : value.indexOf(separator, offset);
        if (end < offset) { matched = false; break; }
        parameters[names[i]] = value.slice(offset, end);
        offset = end + separator.length;
      }
      if (matched && offset === value.length) return t(key, parameters);
    }
    return value;
  }
  return Object.freeze({ language, locale: locales[language], t, html, message,
    plural: (count, forms, parameters = {}) => t(forms[new Intl.PluralRules(locales[language]).select(count)] || forms.other, { count, ...parameters }) });
});
