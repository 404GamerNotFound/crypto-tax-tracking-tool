const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/bsdex-web.js'), 'utf8');

function fixture() {
  const elements = new Map(), calls = [], replies = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', checked: false, hidden: true,
      addEventListener(event, fn) { this[event] = fn; }, focus() {},
      querySelectorAll: () => (id === 'bsdex-credentials' ? ['bsdex-email', 'bsdex-password']
        : id === 'bsdex-tan-field' ? ['bsdex-tan'] : id === 'bsdex-link-field' ? ['bsdex-link']
          : id === 'bsdex-consent-field' ? ['bsdex-consent-accepted'] : []).map(element),
    });
    return elements.get(id);
  };
  const dialog = { open: false, querySelector: selector => element(selector.replace(/^#/, '')),
    querySelectorAll: () => ['bsdex-email', 'bsdex-password', 'bsdex-tan', 'bsdex-link', 'bsdex-consent-accepted'].map(element),
    addEventListener(event, fn) { this["on" + event] = fn; }, showModal() { this.open = true; }, close() { this.open = false; },
  };
  const window = { isSecureContext: true };
  vm.runInNewContext(source, { window, location: { protocol: 'https:' },
    document: { createElement: () => dialog, body: { append() {} } },
    fetch: async (url, options) => {
      const action = url.split('/').at(-1); calls.push({ action, body: JSON.parse(options.body) });
      const reply = action === 'cancel' ? { data: { bsdexWeb: { status: 'login_required' } } } : replies.shift();
      if (reply instanceof Error) throw reply;
      assert.ok(reply, 'Unerwartete Anfrage');
      return { ok: reply.ok !== false, json: async () => reply.data };
    },
  });
  return { element, dialog, window, calls, replies,
    submit: () => element('form').submit({ preventDefault() {} }),
    open: completed => window.BsdexWeb.open({ id: 7 }, completed),
  };
}
const twoFactor = (remaining = 5) => ({ bsdexWeb: { status: 'two_factor_required', attemptsRemaining: remaining, expiresAt: '2026-10-16T15:10:00Z' } });

async function start(f) {
  await f.open(); f.element('bsdex-email').value = 'test@example.test'; f.element('bsdex-password').value = 'test-password';
  f.replies.push({ data: twoFactor() }); await f.submit();
}

test('BSDEX-Dialog behält 2FA bei Code- und Transportfehlern und leert Geheimnisse', async () => {
  const f = fixture(); await start(f);
  assert.equal(f.element('bsdex-tan-field').hidden, false);
  assert.equal(f.element('bsdex-password').value, '');
  assert.equal(f.element('bsdex-password').disabled, true);
  assert.match(f.element('bsdex-tan-hint').textContent, /5 Code-Versuche/);
  f.element('bsdex-tan').value = '111111';
  f.replies.push({ ok: false, data: { error: 'Code ungültig', ...twoFactor(4) } }); await f.submit();
  assert.equal(f.element('bsdex-tan-field').hidden, false);
  assert.equal(f.element('bsdex-tan').value, '');
  assert.equal(f.element('bsdex-login-error').hidden, false);
  assert.match(f.element('bsdex-tan-hint').textContent, /4 Code-Versuche/);
  f.element('bsdex-tan').value = '222222';
  f.replies.push(new Error('Verbindung unterbrochen')); await f.submit();
  assert.equal(f.element('bsdex-tan-field').hidden, false);
  assert.equal(f.element('bsdex-tan').value, '');
  f.element('bsdex-tan').value = '333333';
  f.replies.push({ data: { bsdexWeb: { status: 'device_confirmation_required' } } }); await f.submit();
  assert.equal(f.element('bsdex-link-field').hidden, false);
  assert.equal(f.element('bsdex-tan').disabled, true);
  assert.deepEqual(f.calls.map(call => call.action), ['cancel', 'start', 'confirm', 'confirm', 'confirm']);
  assert.deepEqual(f.calls.at(-1).body, { tan: '333333' });
});

test('BSDEX-Dialog bietet Neustart und kehrt nach endgültigem Ablauf zur Anmeldung zurück', async () => {
  const f = fixture(); await start(f);
  assert.equal(f.element('bsdex-login-restart').hidden, false);
  f.element('bsdex-tan').value = '111111';
  await f.element('bsdex-login-restart').click();
  assert.equal(f.calls.at(-1).action, 'cancel');
  assert.equal(f.element('bsdex-credentials').hidden, false);
  assert.equal(f.element('bsdex-tan').value, '');
  f.replies.push({ data: twoFactor() }); await f.submit();
  f.replies.push({ ok: false, data: { error: 'Anmeldung abgelaufen', bsdexWeb: { status: 'login_required' } } }); await f.submit();
  assert.equal(f.element('bsdex-credentials').hidden, false);
  assert.equal(f.element('bsdex-login-restart').hidden, true);
  assert.equal(f.element('bsdex-login-error').textContent, 'Anmeldung abgelaufen');
});

test('BSDEX-Dialog schließt nach Erfolg und behält die HTTPS-Prüfung', async () => {
  const f = fixture(); let completed = 0;
  await f.open(() => { completed++; });
  f.window.isSecureContext = false;
  await f.submit(); assert.equal(f.calls.length, 1);
  assert.match(f.element('bsdex-login-error').textContent, /HTTPS/);
  f.window.isSecureContext = true;
  f.replies.push({ data: twoFactor() }); await f.submit();
  f.element('bsdex-tan').value = '123456';
  f.replies.push({ data: { bsdexWeb: { status: 'connected' } } }); await f.submit();
  assert.equal(completed, 1); assert.equal(f.dialog.open, false);
  assert.equal(f.element('bsdex-tan').value, '');
});
