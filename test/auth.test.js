const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { createAuth, readRecord, matches } = require('../lib/auth');
const password = 'test-only-password-long-enough';
let directory, app, server, origin, time;
async function start() {
  app = express(); app.use(express.json());
  createAuth({ dataDir: directory, passwordFile: '', now: () => time, sessionMs: 1000 }).register(app);
  app.get('/api/private.csv', (_req, res) => res.json({ secret: 'protected-data' }));
  app.post('/api/private', (_req, res) => res.json({ changed: true }));
  app.get('/', (_req, res) => res.send('protected-page'));
  app.get('/login.html', (_req, res) => res.send('login-page'));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
}
async function close() { await new Promise(resolve => server.close(resolve)); }
test.beforeEach(async () => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-auth-')); time = Date.now(); await start(); });
test.afterEach(async () => { await close(); fs.rmSync(directory, { recursive: true, force: true }); });
async function request(route, method = 'GET', body, headers = {}) {
  return fetch(origin + route, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-CryptoBuch-Request': '1', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function enable() { assert.equal((await request('/api/auth/password', 'PUT', { password })).status, 200); }
async function login() { const response = await request('/api/auth/login', 'POST', { password }); assert.equal(response.status, 200); return { data: await response.json(), cookie: response.headers.get('set-cookie') }; }

test('Passwortschutz speichert nur scrypt, schützt Seiten und APIs auch mit anderer Großschreibung', async () => {
  assert.equal((await request('/api/private.csv')).status, 200);
  await enable();
  const file = fs.readFileSync(path.join(directory, 'auth.json'), 'utf8');
  assert.ok(!file.includes(password)); assert.equal(fs.statSync(path.join(directory, 'auth.json')).mode & 0o777, 0o600);
  assert.equal(await matches(password, readRecord(path.join(directory, 'auth.json'))), true);
  assert.equal((await request('/api/private.csv')).status, 401);
  assert.equal((await request('/API/private.csv')).status, 401);
  assert.equal((await request('/')).status, 303);
  assert.equal((await request('/login.html')).status, 200);
  assert.equal((await request('/healthz')).status, 200);
  const status = await (await request('/api/auth/status')).json();
  assert.deepEqual(status, { enabled: true, authenticated: false });
  const { data, cookie } = await login();
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Strict/i);
  assert.equal((await request('/api/private.csv', 'GET', undefined, { Authorization: `Bearer ${data.token}` })).status, 200);
  assert.equal((await request('/api/private.csv', 'GET', undefined, { Cookie: cookie.split(';')[0] })).status, 200);
  time += 1001;
  assert.equal((await request('/api/private.csv', 'GET', undefined, { Authorization: `Bearer ${data.token}` })).status, 401);
});

test('begrenzt Fehlversuche und weist CSRF zurück', async () => {
  await enable();
  assert.equal((await request('/api/auth/login', 'POST', { password }, { Origin: 'https://foreign.example' })).status, 403);
  const { cookie } = await login();
  assert.equal((await request('/api/private', 'POST', {}, { Cookie: cookie.split(';')[0], Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await request('/api/private', 'POST', {}, { Cookie: cookie.split(';')[0], 'X-CryptoBuch-Request': '' })).status, 403);
  for (let i = 0; i < 10; i++) assert.equal((await request('/api/auth/login', 'POST', { password: 'wrong' })).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', { password })).status, 429);
  time += 15 * 60 * 1000 + 1;
  assert.equal((await request('/api/auth/login', 'POST', { password })).status, 200);
});

test('Passwortwechsel und Neustart widerrufen Sitzungen; Deaktivieren benötigt bisheriges Passwort', async () => {
  await enable(); const first = await login(); const second = await login();
  const headers = { Authorization: `Bearer ${first.data.token}` };
  assert.equal((await request('/api/auth/password', 'PUT', { password: 'new-long-password-value', currentPassword: 'wrong' }, headers)).status, 401);
  assert.equal((await request('/api/auth/password', 'PUT', { password: 'new-long-password-value', currentPassword: password }, headers)).status, 200);
  for (const token of [first.data.token, second.data.token]) assert.equal((await request('/api/private.csv', 'GET', undefined, { Authorization: `Bearer ${token}` })).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', { password })).status, 401);
  const next = await (await request('/api/auth/login', 'POST', { password: 'new-long-password-value' })).json();
  await close(); await start();
  assert.equal((await request('/api/private.csv', 'GET', undefined, { Authorization: `Bearer ${next.token}` })).status, 401);
  const current = await (await request('/api/auth/login', 'POST', { password: 'new-long-password-value' })).json();
  assert.equal((await request('/api/auth/password', 'PUT', { disable: true, currentPassword: 'new-long-password-value' }, { Authorization: `Bearer ${current.token}` })).status, 200);
  assert.equal((await request('/api/private.csv')).status, 200);
});

test('Logout widerruft die einzelne Sitzung; ungültige Konfiguration bleibt geschlossen', async () => {
  assert.equal((await request('/api/auth/password', 'PUT', { password: 'short' })).status, 400);
  await enable(); const first = await login(); const second = await login();
  assert.equal((await request('/api/auth/logout', 'POST', {}, { Authorization: `Bearer ${first.data.token}` })).status, 200);
  assert.equal((await request('/api/private.csv', 'GET', undefined, { Authorization: `Bearer ${first.data.token}` })).status, 401);
  assert.equal((await request('/api/private.csv', 'GET', undefined, { Authorization: `Bearer ${second.data.token}` })).status, 200);
  fs.writeFileSync(path.join(directory, 'auth.json'), '{"hash":"broken"}');
  assert.throws(() => createAuth({ dataDir: directory }), /Ungültige/);
});

test('Docker-Secret wird einmalig übernommen und HTTPs-Cookie ist Secure', async () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-secret-'));
  try {
    const secret = path.join(other, 'secret'); fs.writeFileSync(secret, password + '\n');
    createAuth({ dataDir: other, passwordFile: secret });
    assert.equal(await matches(password, readRecord(path.join(other, 'auth.json'))), true);
    fs.unlinkSync(secret);
    assert.doesNotThrow(() => createAuth({ dataDir: other, passwordFile: secret }));
  } finally { fs.rmSync(other, { recursive: true, force: true }); }
  await enable();
  const response = await request('/api/auth/login', 'POST', { password }, { Origin: origin.replace('http:', 'https:') });
  assert.match(response.headers.get('set-cookie'), /; Secure;/i);
});
