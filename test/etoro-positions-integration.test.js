const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const { normalizeEtoroPosition, saveEtoroPositions } = require('../lib/etoro-positions');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-etoro-positions-'));
process.env.DATA_DIR = directory;
const realFetch = global.fetch;
global.fetch = async () => Response.json({ bitcoin: { eur: 40000 } });
const { app, db } = require('../server');
let server, origin;
test.before(async () => {
  db.exec(`INSERT INTO wallets(id,chain,address,label,source_type) VALUES (1,'EXCHANGE','exchange:etoro:test','eToro','exchange');
    INSERT INTO exchange_connections(id,provider,wallet_id,label,api_key,api_secret) VALUES(1,'etoro',1,'eToro','private-test-key','private-test-secret');
    INSERT INTO transactions(wallet_id,external_id,hash,timestamp,direction,asset,amount,purpose,purpose_origin,price_transaction_eur,price_source,raw_json)
    VALUES(1,'manual','manual','2025-01-01','in','BTC',0.1,'Kauf','manual',30000,'manual','{}')`);
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); global.fetch = realFetch; fs.rmSync(directory, { recursive: true, force: true }); });

test('API zeigt CFDs separat, schützt manuelle Buchungen und hält Coin-Guthaben unverändert', async () => {
  const position = normalizeEtoroPosition({ positionId: 123, instrumentId: 42, settlementTypeID: 0, isBuy: false, leverage: 5,
    openTimestamp: '2025-01-01', closeTimestamp: '2025-02-01', units: 30, netProfit: -200 }, { symbolFull: 'BTC' });
  saveEtoroPositions(db, 1, [position]); saveEtoroPositions(db, 1, [position]);
  const response = await realFetch(origin + '/api/exchange-connections/1/portfolio');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.derivativePositions.length, 1);
  assert.equal(data.derivativePositions[0].profit, -200);
  assert.equal(data.assets.find(row => row.id === 'BTC').amount, 0.1);
  assert.equal(data.transactions.length, 1);
  assert.equal(data.transactions[0].price_transaction_eur, 30000);
  assert.equal(data.transactions[0].purpose_origin, 'manual');
  assert.ok(!JSON.stringify(data).includes('private-test'));
  const portfolio = await (await realFetch(origin + '/api/portfolio')).json();
  assert.equal(portfolio.holdings.BTC, 0.1);
  assert.equal(portfolio.assetAnalytics.BTC.purchases.acquiredAmount, 0.1);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});
