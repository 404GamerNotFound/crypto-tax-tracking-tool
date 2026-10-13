const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-transfers-'));
process.env.DATA_DIR = directory;
const { app, db, exchangeTransferSuggestions } = require('../server');
const realFetch = global.fetch;
let server, origin;
const hash = '88a865d502' + 'a'.repeat(47) + 'f2c04f1';
test.before(async () => {
  global.fetch = async () => Response.json({ cardano: { eur: 1 } });
  db.exec(`INSERT INTO wallets (id, chain, address, label, source_type) VALUES
    (1, 'EXCHANGE', 'exchange:test:coinbase', 'Coinbase Exchange', 'exchange'),
    (2, 'EXCHANGE', 'exchange:test:binance', 'Binance', 'exchange'),
    (3, 'ADA', 'public-fixture', 'Hardware', 'address');`);
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => db.exec('DELETE FROM transactions;'));
test.after(async () => {
  await new Promise(resolve => server.close(resolve)); db.close(); global.fetch = realFetch;
  fs.rmSync(directory, { recursive: true, force: true });
});
function booking(id, { wallet = id, direction = id === 1 ? 'out' : 'in', amount = 47.119979, txHash = hash, purpose = 'Transfer' } = {}) {
  db.prepare(`INSERT INTO transactions (id, wallet_id, external_id, hash, timestamp, direction, asset, amount,
    fee, fee_asset, price_transaction_eur, price_source, purpose, purpose_origin, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, 'ADA', ?, ?, 'ADA', 0.2104, 'manual', ?, 'auto', '{}')`)
    .run(id, wallet, `fixture:${id}`, txHash, `2021-04-19T16:${direction === 'out' ? '22' : '24'}:00Z`, direction, amount, direction === 'out' ? 0.180021 : 0, purpose);
}
async function api(route, body, status = 200) {
  const response = await realFetch(origin + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
}
const pair = { outgoingTransactionId: 1, incomingTransactionId: 2 };

test('Coinbase → Binance: schlägt markierte ADA-Transfers vor, verknüpft sie und zeigt beide Gegenbuchungen', async () => {
  booking(1); booking(2);
  const suggestions = (await api('/api/data-quality')).possibleTransfers;
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].transfer_kind, 'exchange_exchange');
  assert.equal(suggestions[0].hash_matched, true);
  assert.equal(suggestions[0].fee_adjusted, false);
  assert.equal(suggestions[0].fee, 0.180021);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transfer_links').get().n, 0);
  const before = db.prepare('SELECT amount, fee, fee_asset, price_transaction_eur, price_source, hash FROM transactions ORDER BY id').all();
  await api('/api/transfers/link', pair, 201);
  const quality = await api('/api/data-quality');
  assert.equal(quality.possibleTransfers.length, 0);
  assert.equal(quality.possibleDuplicates.length, 0);
  booking(3, { wallet: 2 });
  assert.equal((await api('/api/data-quality')).possibleDuplicates.length, 1);
  db.prepare('DELETE FROM transactions WHERE id=3').run();
  assert.deepEqual(db.prepare('SELECT amount, fee, fee_asset, price_transaction_eur, price_source, hash FROM transactions ORDER BY id').all(), before);
  assert.ok(db.prepare('SELECT purpose_origin FROM transactions').all().every(row => row.purpose_origin === 'manual'));
  const portfolio = await api('/api/portfolio');
  assert.equal(portfolio.transactions.find(row => row.id === 1).transferLink.transactionId, 2);
  assert.equal(portfolio.transactions.find(row => row.id === 2).transferLink.walletLabel, 'Coinbase Exchange');
  await api('/api/transfers/link', pair, 409);
});

test('schließt widersprüchliche Hashes, Trades und dasselbe Konto aus', async () => {
  booking(1); booking(2, { txHash: 'b'.repeat(64) });
  assert.equal(exchangeTransferSuggestions().length, 0);
  db.prepare('UPDATE transactions SET hash=?, purpose=? WHERE id=2').run(hash, 'Kauf');
  assert.equal(exchangeTransferSuggestions().length, 0);
  db.exec("UPDATE transactions SET purpose='Transfer', wallet_id=1 WHERE id=2");
  assert.equal(exchangeTransferSuggestions().length, 0);
  await api('/api/transfers/link', pair, 400);
});

test('erhält Betrag-Zeit-Vorschläge ohne Blockchain-Hash und berücksichtigt Gebührenabzug', () => {
  booking(1, { amount: 47.3, txHash: 'provider-withdrawal-id' });
  booking(2, { txHash: 'provider-deposit-id' });
  const [suggestion] = exchangeTransferSuggestions();
  assert.equal(suggestion.fee_adjusted, true);
  assert.equal(suggestion.hash_matched, false);
  assert.equal(suggestion.incoming_id, 2);
});

test('priorisiert vollständige Hash-Treffer vor ungesicherten Alternativen ohne Doppelvorschläge', () => {
  booking(1); booking(2, { txHash: 'unverified' }); booking(3);
  const suggestions = exchangeTransferSuggestions(1);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].incoming_id, 3);
  assert.equal(suggestions[0].hash_matched, true);
});
