const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { HEADERS, parseBsdexCsv } = require('../lib/bsdex-csv');
const web = require('../lib/bsdex-web');
const sessions = require('../lib/bsdex-web-session');
const originalFetchHistory = web.fetchBsdexWebHistory, originalLogin = sessions.createBsdexWebLogin;
const secretState = { cookies: [{ name: 'session', value: 'PRIVATE-COOKIE', domain: '.bsdex.de' }], origins: [] };
const sample = HEADERS.join(',') + '\nbuy-1,buy,2021-01-01 12:00:00 +0000,1.0,ETH,100.0,EUR,0.1,EUR,,';
let expired = false, importedRequests = 0;
web.fetchBsdexWebHistory = async ({ storageState }) => {
  assert.equal(storageState.cookies[0].value, 'PRIVATE-COOKIE'); importedRequests++;
  if (expired) throw Object.assign(new Error('Sitzung abgelaufen'), { status: 400, code: 'BSDEX_LOGIN_REQUIRED' });
  return { ...parseBsdexCsv(sample), storageState: secretState, warnings: [] };
};
sessions.createBsdexWebLogin = () => ({
  status: () => 'login_required', cancel: async () => {}, close: async () => {},
  start: async (_id, { identity }) => ({ status: 'connected', storageState: secretState, identity }),
});
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-bsdex-web-'));
process.env.DATA_DIR = directory;
const realFetch = global.fetch;
global.fetch = async () => Response.json({ ethereum: { eur: 200 } });
const { app, db } = require('../server');
let server, origin;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`; });
async function request(route, body, method = 'POST') {
  const response = await realFetch(origin + route, { method, headers: { 'Content-Type': 'application/json', 'X-CryptoBuch-Request': '1' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}
async function idle() {
  for (let i = 0; i < 200; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    if (!db.prepare("SELECT id FROM background_jobs WHERE status IN ('queued','running')").get()) return;
  }
  throw new Error('Test jobs did not settle');
}
test.after(async () => {
  await idle(); await new Promise(resolve => server.close(resolve)); db.close();
  global.fetch = realFetch; web.fetchBsdexWebHistory = originalFetchHistory; sessions.createBsdexWebLogin = originalLogin;
  fs.rmSync(directory, { recursive: true, force: true });
});

test('BSDEX-Web: additive Quelle, verschlüsselte Sitzung, serielle Jobs, Dubletten- und Korrekturschutz', async () => {
  assert.equal((await request('/api/exchange-connections', { provider: 'bsdex_web' })).status, 400);
  const created = await request('/api/exchange-connections', { provider: 'bsdex_web', label: 'Test BSDEX Web', bsdexWebConsent: true, apiKey: 'not-used', apiSecret: 'not-used', liveUpdatesEnabled: true });
  assert.equal(created.status, 201); assert.equal(created.data.job, null); assert.equal(created.data.syncAvailable, false);
  assert.equal(created.data.accessMode, 'web'); assert.equal(created.data.live, null); assert.equal(created.data.balance, null);
  const id = created.data.id, base = `/api/exchange-connections/${id}`;
  assert.equal((await request(base + '/sync')).status, 400);
  assert.equal((await request(base + '/live-updates', { enabled: true }, 'PATCH')).status, 400);
  const auth = await request(base + '/bsdex/web-login/start', { email: 'test@example.test', password: 'PRIVATE-PASSWORD' });
  assert.equal(auth.status, 200); assert.equal(auth.data.bsdexWeb.status, 'connected'); assert.ok(auth.data.job.id);
  await idle(); assert.equal(importedRequests, 1);
  const stored = db.prepare('SELECT * FROM bsdex_web_sessions WHERE connection_id=?').get(id);
  assert.ok(stored.session_ciphertext.length); assert.ok(!stored.session_ciphertext.includes('PRIVATE-COOKIE'));
  const connection = db.prepare('SELECT * FROM exchange_connections WHERE id=?').get(id);
  assert.equal(connection.api_key, ''); assert.equal(connection.api_secret, '');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 1);
  db.prepare("UPDATE transactions SET price_transaction_eur=123, price_source='manual', purpose='Geschenk', purpose_origin='manual'").run();
  await request(base + '/sync'); await idle();
  const imported = await request('/api/import/csv', { profile: 'bsdex', exchangeConnectionId: id, csv: sample });
  assert.equal(imported.status, 201); await idle();
  const transactions = db.prepare('SELECT * FROM transactions').all();
  assert.equal(transactions.length, 1); assert.equal(transactions[0].price_transaction_eur, 123); assert.equal(transactions[0].purpose, 'Geschenk');
  const view = await request(base + '/portfolio', undefined, 'GET');
  assert.equal(view.status, 200); assert.equal(view.data.connection.live, null); assert.equal(view.data.balance.source, 'journal');
  const publicData = JSON.stringify([view.data, (await request('/api/exchange-connections', undefined, 'GET')).data, db.prepare('SELECT payload_json,result_json FROM background_jobs').all()]);
  assert.ok(!publicData.includes('PRIVATE-')); assert.ok(!publicData.includes('session_ciphertext')); assert.ok(!publicData.includes('test@example.test'));
  assert.equal((await request(base + '/bsdex/web-login/start', { email: 'other@example.test', password: 'password' })).status, 400);
  expired = true; await request(base + '/sync'); await idle();
  const expiredView = await request('/api/exchange-connections', undefined, 'GET');
  assert.equal(expiredView.data.connections[0].syncAvailable, false);
  assert.equal(db.prepare('SELECT session_ciphertext FROM bsdex_web_sessions WHERE connection_id=?').get(id).session_ciphertext, '');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 1);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  await request(base, undefined, 'DELETE');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bsdex_web_sessions').get().n, 0);
});
