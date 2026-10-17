(() => {
  'use strict';
  const i18n = window.createCryptoBuchI18n(window.CryptoBuchLocaleData || {});
  window.CryptoBuchI18n = i18n;
  document.documentElement.lang = i18n.language;
  // Fetch is left intact. The preference cookie also localizes API errors;
  // non-browser API clients can send Accept-Language instead.
  function translate(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = i18n.t(element.dataset.i18n); });
    for (const attribute of ['title', 'aria-label', 'placeholder', 'alt', 'data-label']) {
      root.querySelectorAll('[data-i18n-' + attribute + ']').forEach(element => element.setAttribute(attribute, i18n.t(element.getAttribute('data-i18n-' + attribute))));
    }
  }
  function mount() {
    translate();
    const wrapper = document.createElement('label'); wrapper.className = 'language-selector';
    const label = document.createElement('span'); label.textContent = i18n.t('Sprache');
    const select = document.createElement('select'); select.setAttribute('aria-label', i18n.t('Sprache'));
    for (const [code, name] of [['de', 'Deutsch'], ['en', 'English'], ['es', 'Español']]) {
      const option = document.createElement('option'); option.value = code; option.textContent = name; select.append(option);
    }
    select.value = i18n.language;
    let dirty = false;
    document.addEventListener('input', event => { if (event.target !== select && event.target.closest('form')) dirty = true; });
    select.addEventListener('change', () => {
      if (dirty && !window.confirm(i18n.t('Sprache ändern? Nicht gespeicherte Eingaben können verloren gehen.'))) { select.value = i18n.language; return; }
      if (!['de', 'en', 'es'].includes(select.value)) return;
      document.cookie = `cryptobuch_language=${select.value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
      location.reload();
    });
    wrapper.append(label, select);
    const target = document.querySelector('.topbar') || document.querySelector('main') || document.body;
    target.prepend(wrapper);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
