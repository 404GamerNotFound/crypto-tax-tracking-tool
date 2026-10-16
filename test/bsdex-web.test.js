const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { allowedBsdexRequest, bsdexConfirmationUrl, requirePrivateLoginTransport, createBsdexWebLogin } = require("../lib/bsdex-web-session");
const { fetchBsdexWebHistory, HISTORY_URL } = require("../lib/bsdex-web");
const { HEADERS } = require("../lib/bsdex-csv");

test("BSDEX-Browser blockiert Handel, fremde Hosts, Klartext, Web-API-Schreibzugriffe", () => {
  assert.equal(allowedBsdexRequest(HISTORY_URL, "GET"), true);
  assert.equal(allowedBsdexRequest('https://auth.bsdex.de/oauth/session', "POST", { authentication: true }), true);
  assert.equal(allowedBsdexRequest('https://auth.bsdex.de/oauth/session', "POST"), false);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(allowedBsdexRequest('https://api.bsdex.de/orders', method, { authentication: true }), false);
  for (const url of ['http://app.bsdex.de/', 'https://bsdex.de.evil.test/', 'https://user:password@app.bsdex.de/', 'https://app.bsdex.de:444/', 'file:///tmp/test', 'https://app.bsdex.de/logout']) assert.equal(allowedBsdexRequest(url, "GET"), false);
});

test("BSDEX-Gerätelink ist auf beobachteten Auth-Pfad beschränkt", () => {
  assert.equal(bsdexConfirmationUrl('https://auth.bsdex.de/oauth/device_confirmation/example/confirm'), 'https://auth.bsdex.de/oauth/device_confirmation/example/confirm');
  for (const link of ['https://evil.test/oauth/device_confirmation/a', 'https://auth.bsdex.de/orders', 'http://auth.bsdex.de/oauth/device_confirmation/a', 'https://user:pass@auth.bsdex.de/oauth/device_confirmation/a', 'not-a-url']) assert.throws(() => bsdexConfirmationUrl(link));
});

test("BSDEX-Anmeldung nimmt im HTTP-LAN keine Zugangsdaten an", () => {
  const req = (host, ip, origin = '', secure = false) => ({ get: name => name === 'host' ? host : name === 'origin' ? origin : '', secure, socket: { remoteAddress: ip } });
  assert.doesNotThrow(() => requirePrivateLoginTransport(req('localhost:3000', '127.0.0.1')));
  assert.doesNotThrow(() => requirePrivateLoginTransport(req('example.test', '127.0.0.1', 'https://example.test')));
  assert.throws(() => requirePrivateLoginTransport(req('192.168.1.154:3000', '192.168.1.20', 'http://192.168.1.154:3000')), /HTTPS/);
  assert.throws(() => requirePrivateLoginTransport(req('localhost:3000', '192.168.1.20')), /HTTPS/);
});

test("BSDEX-Loginfehler werden bereinigt, Browser geschlossen, keine Geheimnisse ausgegeben", async () => {
  let closed = 0;
  const login = createBsdexWebLogin({ launch: async () => ({ newContext: async () => { throw new Error('password=secret-cookie'); }, close: async () => { closed++; } }) });
  await assert.rejects(login.start(1, { email: 'test@example.test', password: 'secret-cookie' }), error => !error.message.includes('secret-cookie') && error.status === 400);
  assert.equal(closed, 1); assert.equal(login.status(1), 'login_required');
  await assert.rejects(login.confirm(1, '123456'), /abgelaufen/);
});

test("BSDEX meldet fehlendes Chromium ohne lokale Pfade oder Browser-Rohfehler", async () => {
  const login = createBsdexWebLogin({ launch: async () => { throw new Error("Executable doesn't exist at /private/secret-path/chrome"); } });
  await assert.rejects(login.start(1, { email: 'test@example.test', password: 'test' }), error => error.status === 503
    && error.message.includes('npx playwright install chromium') && !error.message.includes('secret-path'));
  assert.equal(login.status(1), 'login_required');
});

function loginBrowserFixture() {
  let state = 'landing', closed = 0, saved = 0;
  let currentUrl = 'https://app.bsdex.de/';
  const visible = key => key === '#user_email' ? state === 'login' : key === '#challenge_tan' ? state === 'tan'
    : key === 'Bitte überprüfen Sie Ihre E-Mails' ? state === 'device'
      : key === 'dialog' ? state === 'consent' : ['Historie', 'Wallet'].includes(key) ? ['ready', 'consent'].includes(state) : false;
  const locator = key => ({
    first: () => locator(key), last: () => locator('open-login'), filter: () => locator(key),
    isVisible: async () => visible(key), getAttribute: async () => '/oauth/session', fill: async () => {},
    innerText: async () => 'Zur Sicherung Ihres BSDEX-Accounts: Daten an Solaris. Ich stimme zu',
    getByRole: () => locator('consent-button'),
    waitFor: async ({ state: wanted }) => { if (visible(key) !== (wanted === 'visible')) throw new Error('not visible'); },
    click: async () => {
      if (key === 'open-login') { state = 'login'; currentUrl = 'https://auth.bsdex.de/oauth/session/new'; }
      else if (key === 'Anmelden') { state = 'tan'; currentUrl = 'https://auth.bsdex.de/oauth/multi_factor_auth/new'; }
      else if (key.includes('commit')) { state = 'device'; currentUrl = 'https://auth.bsdex.de/api/v2/oauth/device_confirmation'; }
      else if (key === 'consent-button') state = 'ready';
    },
  });
  const page = { url: () => currentUrl, locator, getByText: locator,
    getByRole: (role, options) => locator(role === 'dialog' ? 'dialog' : options?.name),
    goto: async url => { if (url.includes('/device_confirmation/')) { state = 'consent'; currentUrl = 'https://app.bsdex.de/invest/btc-eur'; } },
  };
  const context = { setDefaultTimeout: () => {}, setDefaultNavigationTimeout: () => {}, route: async () => {}, routeWebSocket: async () => {}, newPage: async () => page,
    storageState: async () => { saved++; return { cookies: [], origins: [] }; } };
  return { launch: async () => ({ newContext: async () => context, close: async () => { closed++; } }), counters: () => ({ closed, saved }) };
}

test('BSDEX-Anmeldestufen: TAN, E-Mail-Gerätelink und ausdrückliche aktuelle Zustimmung vor Sitzungsspeicherung', async () => {
  const fixture = loginBrowserFixture(); const login = createBsdexWebLogin(fixture);
  assert.equal((await login.start(1, { email: 'test@example.test', password: 'test', identity: 'account-hash' })).status, 'two_factor_required');
  assert.equal((await login.confirm(1, '123456')).status, 'device_confirmation_required');
  const consent = await login.confirmDevice(1, 'https://auth.bsdex.de/oauth/device_confirmation/example/confirm');
  assert.equal(consent.status, 'device_consent_required'); assert.equal(fixture.counters().saved, 0);
  await assert.rejects(login.consent(1, { accepted: true, digest: 'wrong' }), /ausdrücklich/);
  const result = await login.consent(1, { accepted: true, digest: consent.consentDigest });
  assert.equal(result.status, 'connected'); assert.equal(result.identity, 'account-hash');
  assert.deepEqual(fixture.counters(), { saved: 1, closed: 1 }); assert.equal(login.status(1), 'login_required');
});

test('BSDEX-Abbruch während Browserstart lässt keine verwaiste Anmeldung zu', async () => {
  let resolveLaunch, closed = 0;
  const login = createBsdexWebLogin({ launch: () => new Promise(resolve => { resolveLaunch = resolve; }) });
  const running = login.start(1, { email: 'test@example.test', password: 'test' });
  await new Promise(resolve => setImmediate(resolve));
  await login.cancel(1);
  resolveLaunch({ newContext: async () => ({ setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, route: async () => {}, routeWebSocket: async () => {}, newPage: async () => ({}) }), close: async () => { closed++; } });
  await assert.rejects(running, /nicht abgeschlossen/); assert.equal(closed, 1); assert.equal(login.status(1), 'login_required');
});

function browserFixture({ malformed = false, expired = false } = {}) {
  const events = []; let selected = '2021'; let resolveDownload;
  const download = text => ({ createReadStream: async () => Readable.from([Buffer.from(text)]), delete: async () => events.push('delete') });
  const page = {
    goto: async url => events.push(url), url: () => expired ? 'https://auth.bsdex.de/oauth/session/new' : HISTORY_URL,
    waitForEvent: () => new Promise(resolve => { resolveDownload = resolve; }),
    locator: () => ({
      allTextContents: async () => ['2021', '2022'],
      filter: ({ hasText }) => {
        if (String(hasText) === '/^2021$/') selected = '2021';
        if (String(hasText) === '/^2022$/') selected = '2022';
        return { first: () => ({ waitFor: async () => { if (expired) throw new Error('timeout'); } }),
          locator: () => ({ locator: () => ({ filter: () => ({ count: async () => 1, click: async () => {
            events.push('click:' + selected);
            resolveDownload(download(malformed && selected === '2022' ? 'bad format' : HEADERS.join(',') + `\nbuy-${selected},buy,${selected}-01-01 12:00:00 +0000,1.0,ETH,100.0,EUR,0.1,EUR,,`));
          } }) }) }) };
      },
    }),
  };
  return { events, openBrowser: async () => ({ page, context: { storageState: async () => ({ cookies: [], origins: [] }) }, browser: { close: async () => events.push('close') } }) };
}

test("BSDEX-Web-Import lädt Jahre seriell, validiert vor Rückgabe und räumt Downloads auf", async () => {
  const fixture = browserFixture();
  const result = await fetchBsdexWebHistory({ storageState: { cookies: [], origins: [] }, ...fixture, sleep: async () => fixture.events.push('pause') });
  assert.equal(result.rows.length, 2); assert.deepEqual(result.years, [2021, 2022]);
  assert.deepEqual(fixture.events, [HISTORY_URL, 'click:2021', 'delete', 'pause', 'click:2022', 'delete', 'pause', 'close']);
  const invalid = browserFixture({ malformed: true });
  await assert.rejects(fetchBsdexWebHistory({ storageState: { cookies: [], origins: [] }, ...invalid, sleep: async () => {} }), /unbekannte Spalten/);
  assert.equal(invalid.events.at(-1), 'close');
  const expired = browserFixture({ expired: true });
  await assert.rejects(fetchBsdexWebHistory({ storageState: { cookies: [], origins: [] }, ...expired }), error => error.code === 'BSDEX_LOGIN_REQUIRED');
  assert.equal(expired.events.at(-1), 'close');
});
