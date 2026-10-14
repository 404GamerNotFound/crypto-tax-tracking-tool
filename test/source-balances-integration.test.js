const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-source-balances-'));
process.env.DATA_DIR = directory;
const realFetch = global.fetch;
global.fetch = async () => Response.json({ cardano: { eur: 1 } });
const { app, db, replaceExchangeBalanceSnapshot } = require('../server');
let server, origin;
test.before(async () => {
  db.exec(`INSERT INTO wallets (id,chain,address,label,source_type) VALUES
    (1,'EXCHANGE','exchange:test:1','Binance','exchange'),
    (2,'EXCHANGE','exchange:test:2','Coinbase','exchange'),
    (3,'ADA','public-fixture','Wallet','address');
    INSERT INTO exchange_connections (id,provider,wallet_id,label,api_key,api_secret) VALUES
    (1,'binance',1,'Binance','test','test'),(2,'coinbase_advanced',2,'Coinbase','test','test');`);
  // Binance's imported history is incomplete; Coinbase has no journal at all.
  const insert = db.prepare(`INSERT INTO transactions (wallet_id,external_id,hash,timestamp,direction,asset,amount,purpose,raw_json)
    VALUES (?,?,?,'2026-01-01T12:00:00Z',?,'ADA',?,'Transfer','{}')`);
  insert.run(1,'out','out','out',5); insert.run(3,'in','in','in',110); insert.run(3,'wallet-out','wallet-out','out',10);
  replaceExchangeBalanceSnapshot(1,[{asset:'ADA',free:25,locked:5}]);
  replaceExchangeBalanceSnapshot(2,[{asset:'ADA',free:20,locked:0}]);
  server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  origin=`http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise(resolve=>server.close(resolve)); db.close(); global.fetch=realFetch; fs.rmSync(directory,{recursive:true,force:true}); });
async function portfolio() { const response = await realFetch(origin+'/api/portfolio'); assert.equal(response.status,200); return response.json(); }

test('zeigt 30 ADA Binance, 20 Coinbase und 100 Wallet ohne Doppelzählung', async () => {
  const result=await portfolio();
  const entries=result.sourceBalances.ADA;
  assert.deepEqual(entries.map(row=>[row.label,row.amount]),[['Wallet',100],['Binance',30],['Coinbase',20]]);
  assert.equal(entries.reduce((sum,row)=>sum+row.amount,0),result.holdings.ADA);
  assert.equal(result.holdings.ADA,150);
  assert.equal(entries[0].basis,'journal');
  assert.equal(entries[1].basis,'exchange_snapshot');
  assert.ok(entries[1].observedAt);
  assert.equal(entries[2].basis,'exchange_snapshot');
});

test('erhält Mengen ausgeblendeter Coins und entfernt entleerte Snapshot-Konten', async () => {
  db.exec("INSERT INTO hidden_assets (asset) VALUES ('ADA')");
  assert.equal((await portfolio()).sourceBalances.ADA.length,3);
  replaceExchangeBalanceSnapshot(2,[]);
  const result=await portfolio();
  assert.deepEqual(result.sourceBalances.ADA.map(row=>row.walletId),[3,1]);
  assert.equal(result.holdings.ADA,130);
  assert.equal(result.assetPrices.ADA,null);
});

test('verwendet Börsenjournal nur ohne Snapshot und zeigt negative Wallet-Journale als unvollständig', async () => {
  db.exec("DELETE FROM exchange_balance_snapshot_meta WHERE connection_id=1; UPDATE transactions SET direction='out' WHERE wallet_id=3");
  const result=await portfolio();
  assert.equal(result.sourceBalances.ADA.length,1);
  assert.equal(result.sourceBalances.ADA[0].amount,-120);
  assert.equal(result.sourceBalances.ADA[0].incomplete,true);
  assert.equal(result.holdings.ADA,-120);
  db.exec("UPDATE transactions SET direction='in' WHERE wallet_id=1");
  const fallback=(await portfolio()).sourceBalances.ADA.find(row=>row.walletId===1);
  assert.equal(fallback.amount,5); assert.equal(fallback.basis,'journal'); assert.equal(fallback.observedAt,null);
});
