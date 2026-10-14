const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-cardano-sync-'));
process.env.DATA_DIR = dir;
const { app, db } = require('../server');
const stake = `stake1${'q'.repeat(53)}`;
const address = `addr1${'q'.repeat(98)}`;
const base = 'https://cardano.fixture.invalid';
const fund = 'f'.repeat(64), claim = 'c'.repeat(64);
const at = Date.parse('2026-01-02T00:00:00Z') / 1000;
const utxo = (amount) => ({ address, amount: [{ unit: 'lovelace', quantity: String(amount * 1e6) }] });
let server, origin, failRewards = false, invalidReferences = false;
test.before(async () => {
  db.prepare("INSERT INTO wallets (id, chain, address, source_type) VALUES (1, 'ADA', ?, 'stake')").run(stake);
  for (const [key, value] of [['blockfrostBaseUrl', base], ['blockfrostProjectId', 'fixture']]) db.prepare('UPDATE app_settings SET setting_value = ? WHERE setting_key = ?').run(value, key);
  db.prepare("INSERT INTO price_history (coin_id, price_date, price_eur, source) VALUES ('cardano', '2026-01-02', 1, 'fixture')").run();
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  test.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(String(url));
    if (parsed.origin === origin) return originalFetch(url, options);
    assert.equal(parsed.origin, base, 'no real network requests');
    const route = parsed.pathname;
    if (route.endsWith('/rewards')) {
      if (failRewards) return Response.json({ error: 'fixture failure' }, { status: 403 });
      return Response.json([{ epoch: 600, amount: '52000000', pool_id: 'pool1test', type: 'member' }]);
    }
    if (route === '/epochs/latest') return Response.json({ epoch: 602 });
    if (route === '/epochs/602') return Response.json({ start_time: at });
    if (route.endsWith('/addresses')) return Response.json([{ address }]);
    if (route.endsWith('/transactions') && route.startsWith('/addresses/')) return Response.json(invalidReferences ? [fund, claim] : [{ tx_hash: fund, block_time: at }, { tx_hash: claim, block_time: at }]);
    if (route === `/txs/${fund}/utxos`) return Response.json({ hash: fund, inputs: [], outputs: [utxo(890)] });
    if (route === `/txs/${claim}/utxos`) return Response.json({ hash: claim, inputs: [utxo(890)], outputs: [utxo(909.83)] });
    if (route === `/txs/${fund}` || route === `/txs/${claim}`) return Response.json({ block_time: at, fees: '170000', valid_contract: true, withdrawal_count: route.endsWith(claim) ? 1 : 0 });
    if (route === `/txs/${claim}/withdrawals`) return Response.json([{ address: stake, amount: '20000000' }]);
    assert.fail(`Unexpected fixture path: ${route}`);
  });
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  test.mock.restoreAll(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
async function sync() {
  const response = await fetch(origin + '/api/wallets/1/sync', { method: 'POST' });
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data));
}
test('ADA-Sync repariert Altbestand und undatierte Rewards ohne Dubletten oder Verlust manueller Daten', async () => {
  await sync();
  const reward = db.prepare("SELECT * FROM transactions WHERE external_id LIKE 'ada-reward:%'").get();
  // Simulate the older importer and user edits.
  db.prepare("UPDATE transactions SET timestamp = NULL, price_source = 'manual', price_transaction_eur = 0.5 WHERE id = ?").run(reward.id);
  db.prepare("UPDATE transactions SET amount = 19.83, direction = 'in', purpose = 'Transfer', purpose_origin = 'manual' WHERE external_id = ?").run(claim);
  const oldReport = await (await fetch(origin + '/api/tax-report?year=2026')).json();
  assert.equal(oldReport.undatedIncome.length, 1);
  await sync();
  const rows = db.prepare('SELECT * FROM transactions').all();
  assert.equal(rows.length, 3);
  const balance = rows.reduce((sum, row) => sum + (row.direction === 'in' ? row.amount : row.direction === 'out' ? -row.amount : 0), 0);
  assert.equal(balance, 941.83);
  const repaired = rows.find(row => row.id === reward.id);
  assert.equal(repaired.timestamp, '2026-01-02T00:00:00.000Z');
  assert.equal(repaired.price_source, 'manual'); assert.equal(repaired.price_transaction_eur, 0.5);
  assert.equal(rows.find(row => row.external_id === claim).purpose_origin, 'manual');
  const report = await (await fetch(origin + '/api/tax-report?year=2026')).json();
  assert.equal(report.undatedIncome.length, 0);
  assert.equal(report.income.length, 1); assert.equal(report.income[0].asset, 'ADA');
  assert.equal(report.summary.incomeEur, 26);
});
test('fehlgeschlagener Prämienabruf überschreibt keine vorhandenen Buchungen', async () => {
  const before = db.prepare('SELECT * FROM transactions ORDER BY id').all();
  failRewards = true;
  const response = await fetch(origin + '/api/wallets/1/sync', { method: 'POST' });
  assert.ok(response.status >= 400);
  assert.deepEqual(db.prepare('SELECT * FROM transactions ORDER BY id').all(), before);
});

test('weist das frühere Hash-Listenformat zurück statt sämtliche UTXO-Buchungen still zu überspringen', async () => {
  failRewards = false; invalidReferences = true;
  const before = db.prepare('SELECT * FROM transactions ORDER BY id').all();
  const response = await fetch(origin + '/api/wallets/1/sync', { method: 'POST' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /ungültige Transaktionsliste/);
  assert.deepEqual(db.prepare('SELECT * FROM transactions ORDER BY id').all(), before);
});
