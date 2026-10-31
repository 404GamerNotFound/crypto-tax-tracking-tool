const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-network-fees-'));
process.env.DATA_DIR = directory;
const realFetch = global.fetch;
global.fetch = async () => Response.json({ ethereum: { eur: 2000 }, bitcoin: { eur: 50000 } });
const { app, db } = require('../server');
let server, origin;

test.before(async () => {
  db.exec(`INSERT INTO wallets (id,chain,address,label,source_type) VALUES
    (1,'ETH','0x1111111111111111111111111111111111111111','ETH Wallet','address'),
    (2,'BTC','bc1qfixture','BTC Wallet','address');`);
  const insert = db.prepare(`INSERT INTO transactions (wallet_id,external_id,hash,timestamp,direction,asset,asset_type,amount,fee,fee_asset,purpose,price_transaction_eur,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'{}')`);
  insert.run(1,'eth:buy','0xbuy','2025-01-01T00:00:00Z','in','ETH','native',1,0,null,'Kauf',1000);
  insert.run(1,'eth:reward','0xrew','2025-03-01T00:00:00Z','in','ETH','native',0.2,0,null,'Staking Rewards',3000);
  // Eine Transaktion, zwei Journalzeilen: Gas darf nur einmal abgezogen werden.
  insert.run(1,'eth:out','0xmulti','2025-04-01T00:00:00Z','out','ETH','native',0.1,0.004,'ETH','Transfer',2500);
  insert.run(1,'erc20:out','0xmulti','2025-04-01T00:00:00Z','in','ERC20:0xabc','erc20',10,0,'ETH',null,null);
  insert.run(1,'eth:gas-only','0xtoken','2025-04-02T00:00:00Z','out','ERC20:0xabc','erc20',5,0.001,'ETH','Transfer',null);
  // BTC: Gebühr ist bereits im Netto-Betrag enthalten.
  insert.run(2,'btc:in','btcin','2025-01-01T00:00:00Z','in','BTC','native',1,0,null,'Kauf',40000);
  insert.run(2,'btc:out','btcout','2025-02-01T00:00:00Z','out','BTC','native',0.1001,0.0001,null,'Transfer',45000);
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); global.fetch = realFetch; fs.rmSync(directory, { recursive: true, force: true }); });

test('Portfolio zieht separat bezahltes ETH-Gas einmal pro Transaktion ab, BTC-Gebühren nicht doppelt', async () => {
  const response = await realFetch(origin + '/api/portfolio');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(Math.abs(result.holdings.ETH - (1 + 0.2 - 0.1 - 0.004 - 0.001)) < 1e-12);
  assert.ok(Math.abs(result.holdings.BTC - 0.8999) < 1e-12);
  assert.equal(result.sourceBalances.ETH.find((row) => row.walletId === 1).amount, result.holdings.ETH);
  // Die Transaktionsliste enthält keine synthetischen Gebührenzeilen.
  assert.ok(result.transactions.every((row) => !row.syntheticFee));
  assert.equal(result.assetAnalytics.ETH.valueHistory.holdingMismatch, false);
});

test('Steuerreport verbraucht Gas-Posten und bucht Rewards als Posten', async () => {
  db.prepare(`INSERT INTO transactions (wallet_id,external_id,hash,timestamp,direction,asset,amount,fee,fee_asset,purpose,price_transaction_eur,raw_json)
    VALUES (1,'eth:sell','0xsell','2025-05-01T00:00:00Z','out','ETH',1.09,0.001,'ETH','Verkauf',2000,'{}')`).run();
  const response = await realFetch(origin + '/api/tax-report?year=2025');
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.ok(report.feeConsumptions.length >= 2);
  assert.ok(report.sales.some((sale) => sale.acquisitionOrigin === 'income'));
  assert.ok(report.sales.every((sale) => sale.amount > 0));
});
