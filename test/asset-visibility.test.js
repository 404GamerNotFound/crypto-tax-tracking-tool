const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-visibility-'));
process.env.DATA_DIR = directory;
const realFetch = global.fetch;
global.fetch = async (url, options) => {
  if (String(url).startsWith('http://127.0.0.1:')) return realFetch(url, options);
  if (String(url).includes('/simple/price')) return Response.json({ bitcoin: { eur: 100 }, ethereum: { eur: 20 } });
  if (String(url).includes('/coins/ethereum/contract/')) return Response.json({ market_data: { current_price: { eur: 3 } } });
  throw new Error('Unexpected external request in visibility test');
};
const { app, db, replaceExchangeBalanceSnapshot } = require('../server');
const spam = 'ETH:0x' + 'a'.repeat(40);
const genuine = 'ETH:0x' + 'b'.repeat(40);
let server, origin;
test.before(async () => {
  db.exec("INSERT INTO wallets (id, chain, address) VALUES (1, 'ETH', 'public-test'), (2, 'BTC', 'public-btc')");
  const insert = db.prepare("INSERT INTO transactions (wallet_id, external_id, hash, timestamp, direction, asset, asset_symbol, asset_name, asset_contract, amount, price_transaction_eur, price_source, purpose, purpose_origin, raw_json) VALUES (?, ?, ?, '2026-01-01T12:00:00Z', 'in', ?, 'SAME', 'Same name', ?, ?, ?, 'manual', 'Kauf', 'manual', '{}')");
  insert.run(1, 'spam', 'spam', spam, spam.slice(4), 1e9, 2);
  insert.run(1, 'real', 'real', genuine, genuine.slice(4), 10, 2);
  insert.run(2, 'btc', 'btc', 'BTC', null, 1, 50);
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve)); db.close(); global.fetch = realFetch;
  fs.rmSync(directory, { recursive: true, force: true });
});
async function api(route, body, status = 200) {
  const response = await realFetch(origin + route, { method: body === undefined ? 'GET' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json(); assert.equal(response.status, status, JSON.stringify(json)); return json;
}
const visibility = (asset, hidden) => api('/api/asset-visibility', { asset, hidden });

test('blendet Milliarden-Token exakt aus, korrigiert Summen/Verlauf und erhält Buchungen sowie Steuerdaten', async () => {
  const before = await api('/api/portfolio');
  const taxBefore = await api('/api/tax-report?year=2026');
  assert.equal(before.totalValueEur, 3000000130);
  const storedBefore = db.prepare('SELECT * FROM transactions ORDER BY id').all();
  assert.deepEqual((await visibility(spam, true)).hiddenAssets, [spam]);
  await visibility(spam, true); // idempotent
  const after = await api('/api/portfolio');
  assert.equal(after.totalValueEur, 130);
  assert.equal(after.holdings[spam], 1e9); // original quantities remain available
  assert.equal(after.assetPrices[spam], null);
  assert.equal(after.assetPrices[genuine], 3);
  assert.deepEqual(after.insights.allocation.map(row => row.asset), ['BTC', genuine]);
  assert.equal(after.insights.valueHistory.at(-1).valueEur, 70);
  assert.equal(after.insights.performance.netInvestmentEur, 70);
  assert.equal(after.insights.performance.unrealizedProfitEur, 60);
  assert.deepEqual(db.prepare('SELECT * FROM transactions ORDER BY id').all(), storedBefore);
  assert.deepEqual((await api('/api/tax-report?year=2026')).summary, taxBefore.summary);
  assert.equal((await api('/api/v1/transactions')).data.length, 3);
  const reopened = new DatabaseSync(path.join(directory, 'cryptobuch.sqlite'));
  assert.equal(reopened.prepare('SELECT asset FROM hidden_assets').get().asset, spam); reopened.close();
  await visibility('BTC', true);
  assert.equal((await api('/api/portfolio')).totalValueEur, 30);
  await visibility('BTC', false);
  await visibility(spam, false);
  assert.equal((await api('/api/portfolio')).totalValueEur, before.totalValueEur);
});

test('weist falsche IDs und Wahrheitswerte ab und dokumentiert die API', async () => {
  for (const body of [{ asset: spam, hidden: 'false' }, { asset: spam }, { asset: ' ', hidden: true }, { asset: 'a'.repeat(201), hidden: true }, { asset: 1, hidden: true }]) await api('/api/asset-visibility', body, 400);
  for (const asset of ['UNKNOWN', '__proto__', 'constructor']) await api('/api/asset-visibility', { asset, hidden: true }, 404);
  assert.deepEqual((await api('/api/asset-visibility')).hiddenAssets, []);
  const docs = await api('/api/openapi.json');
  assert.ok(docs.paths['/api/asset-visibility'].patch);
  assert.equal((await api('/api/v1')).features.assetVisibility, '/api/asset-visibility');
});

test('berücksichtigt Börsensnapshots und behält ausgeblendete IDs nach Quelllöschung wiederherstellbar', async () => {
  const wallet = Number(db.prepare("INSERT INTO wallets (chain, address, source_type) VALUES ('EXCHANGE', 'exchange:visibility', 'exchange')").run().lastInsertRowid);
  const connection = Number(db.prepare("INSERT INTO exchange_connections (provider, wallet_id, label, api_key, api_secret) VALUES ('binance', ?, 'Test', '', '')").run(wallet).lastInsertRowid);
  replaceExchangeBalanceSnapshot(connection, [{ asset: 'BTC', free: 10, locked: 0 }]);
  assert.equal((await api(`/api/exchange-connections/${connection}/portfolio`)).totalValueEur, 1000);
  await visibility('BTC', true);
  const result = await api(`/api/exchange-connections/${connection}/portfolio`);
  assert.equal(result.totalValueEur, 0); assert.equal(result.assets.length, 0);
  assert.ok(result.hiddenAssets.includes('BTC'));
  await visibility('BTC', false);
  await visibility(spam, true);
  db.prepare('DELETE FROM transactions WHERE asset = ?').run(spam);
  assert.ok((await api('/api/asset-visibility')).hiddenAssets.includes(spam));
  await visibility(spam, false);
  assert.deepEqual((await api('/api/asset-visibility')).hiddenAssets, []);
});
