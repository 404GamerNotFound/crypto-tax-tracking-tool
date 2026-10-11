const assert = require('node:assert/strict');
const test = require('node:test');
const { resolvePriceAsset, selectPriceBatch, validatePriceMapping } = require('../lib/price-pipeline');
const { CHAIN_CONFIG } = require('../lib/validation');

const maps = new Map([['1:IOST', 'iost']]);
const identify = (row) => resolvePriceAsset(row, CHAIN_CONFIG, {}, maps);
test('Preisidentität ist quellenbezogen und trennt native Coins, Contracts und unbekannte Symbole', () => {
  assert.equal(identify({ wallet_id: 1, asset: 'IOST' }).coinId, 'iost');
  assert.equal(identify({ wallet_id: 2, asset: 'IOST' }), null);
  assert.equal(identify({ wallet_id: 1, asset: 'BTC' }).coinId, 'bitcoin');
  assert.equal(identify({ wallet_id: 1, asset: 'BETH' }), null);
  const contract = '0x' + 'a'.repeat(40);
  assert.equal(identify({ chain: 'ETH', asset_contract: contract }).coinId, 'erc20:ethereum:' + contract);
  assert.equal(identify({ chain: 'BNB', asset_contract: contract }), null);
  assert.equal(identify({ asset: 'BTC', asset_type: 'nft' }), null);
});

test('Batchlimit zählt Asset-Tage; unbekannte Assets blockieren nichts und gemeinsame Werte überwinden alte Retries', () => {
  const row = (id, extra = {}) => ({ id, wallet_id: 1, asset: 'BTC', timestamp: '2025-01-01T12:00:00Z', priceAsset: { coinId: 'bitcoin' }, ...extra });
  const rows = [row(1, { priceAsset: null }), row(2), row(3, { next_attempt_at: '2100-01-01', wallet_id: 2 }), row(4, { timestamp: '2025-01-02T12:00:00Z' })];
  const batch = selectPriceBatch(rows, { limit: 1, walletId: 1 });
  assert.deepEqual(batch.rows.map(x => x.id), [2, 3]);
  assert.equal(batch.groups, 1);
  assert.equal(batch.hasMore, true);
});

test('neue Buchungen werden vor wiederholten Fehlern gewählt; ungültige Daten werden ausgeschlossen', () => {
  const row = (id, extra = {}) => ({ id, wallet_id: 1, timestamp: '2025-01-01', priceAsset: { coinId: String(id) }, ...extra });
  const batch = selectPriceBatch([row(1, { last_attempt_at: '2025-06-01' }), row(2), row(3, { timestamp: 'ungültig' })], { limit: 1 });
  assert.deepEqual(batch.rows.map(x => x.id), [2]);
});

test('Zuordnungen erfordern explizite Bestätigung und verhindern URL-/Pfadinjektion', () => {
  const input = { walletId: 1, asset: 'IOST', coinGeckoId: 'iost', confirmed: true };
  assert.deepEqual(validatePriceMapping(input), { walletId: 1, asset: 'IOST', coinGeckoId: 'iost' });
  for (const change of [{ confirmed: false }, { confirmed: 'true' }, { coinGeckoId: '../bitcoin' }, { coinGeckoId: 'https://evil.test' }, { walletId: -1 }, { asset: 'A'.repeat(49) }]) {
    assert.throws(() => validatePriceMapping({ ...input, ...change }));
  }
});
