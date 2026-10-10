const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { setTimeout: pause } = require('node:timers/promises');
const { DatabaseSync } = require('node:sqlite');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-advanced-integration-'));
process.env.DATA_DIR = dataDir;
const { privateKey } = crypto.generateKeyPairSync('ed25519');
const apiSecret = privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64');
const apiKey = 'organizations/integration/apiKeys/synthetic-key';
const localKey=crypto.randomBytes(32), iv=crypto.randomBytes(12);
fs.writeFileSync(path.join(dataDir,'trade-republic-session.key'),localKey,{mode:0o600});
const cipher=crypto.createCipheriv('aes-256-gcm',localKey,iv);
const ciphertext=Buffer.concat([cipher.update(JSON.stringify({apiSecret})),cipher.final()]);
const encryptedKey=JSON.stringify({v:1,iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),ciphertext:ciphertext.toString('base64url')});
// Real legacy CHECK + cascading child rows: migration must not delete balances.
const legacy = new DatabaseSync(path.join(dataDir,'cryptobuch.sqlite'));
legacy.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE wallets (id INTEGER PRIMARY KEY, chain TEXT NOT NULL, address TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'address', last_synced_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(chain,address));
INSERT INTO wallets(id,chain,address,label,source_type) VALUES(42,'EXCHANGE','exchange:legacy','Legacy Coinbase','exchange');
CREATE TABLE exchange_connections(id INTEGER PRIMARY KEY,provider TEXT NOT NULL CHECK(provider IN ('bitvavo','binance','coinbase','coinbase_advanced')),wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,label TEXT NOT NULL DEFAULT '',api_key TEXT NOT NULL,api_secret TEXT NOT NULL,last_synced_at TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),history_state TEXT NOT NULL DEFAULT '',history_completed_at TEXT,UNIQUE(provider,wallet_id,label));
INSERT INTO exchange_connections(id,provider,wallet_id,label,api_key,api_secret,created_at) VALUES(42,'coinbase',42,'Legacy Coinbase','legacy-key','legacy-secret','2025-01-01');
CREATE TABLE exchange_balance_snapshot_meta(connection_id INTEGER PRIMARY KEY REFERENCES exchange_connections(id) ON DELETE CASCADE,observed_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE exchange_balance_snapshots(connection_id INTEGER NOT NULL REFERENCES exchange_connections(id) ON DELETE CASCADE,asset TEXT NOT NULL,free_amount REAL NOT NULL,locked_amount REAL NOT NULL,PRIMARY KEY(connection_id,asset));
INSERT INTO exchange_balance_snapshot_meta(connection_id) VALUES(42);
INSERT INTO exchange_balance_snapshots VALUES(42,'ADA',890,0);`);
legacy.prepare("INSERT INTO wallets(id,chain,address,label,source_type) VALUES(43,'EXCHANGE','exchange:old-advanced','Old Advanced','exchange')").run();
legacy.prepare("INSERT INTO exchange_connections(id,provider,wallet_id,label,api_key,api_secret,history_state,history_completed_at) VALUES(43,'coinbase_advanced',43,'Old Advanced',?,?,?,datetime('now'))").run(apiKey,encryptedKey,JSON.stringify({version:1,phase:'complete',pages:1}));
legacy.prepare('INSERT INTO exchange_balance_snapshot_meta(connection_id) VALUES(43)').run();
legacy.close();
const { app, db } = require('../server');
const firstFill = {entry_id:'entry-1',trade_id:'same-trade',order_id:'order-1',product_id:'BTC-EUR',trade_time:'2026-01-01T00:00:00Z',price:'100',size:'1',size_in_quote:false,side:'BUY',commission:'1'};
let server, origin, connectionId, importedWalletId;
let lateFillsAvailable=false;
const originalFetch = global.fetch;
test.before(async () => {
  global.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname === '127.0.0.1') return originalFetch(input, options);
    if (url.hostname !== 'api.coinbase.com') return Response.json({}, {status:404});
    assert.equal(options.method,'GET');
    if(url.pathname==='/v2/accounts')return Response.json({data:[{id:'account-ada',currency:{code:'ADA',type:'crypto'},balance:{amount:'0'}}],pagination:{next_uri:null}});
    if(url.pathname==='/v2/accounts/account-ada/transactions'){
      const tx=(id,type,amount,extra={})=>({id,type,status:'completed',amount:{amount:String(amount),currency:'ADA'},native_amount:{amount:String(Math.abs(amount)*0.5),currency:'EUR'},created_at:'2025-01-01T00:00:00Z',...extra});
      const older=url.searchParams.has('starting_after');
      return Response.json({data:older?[tx('send','send',-2,{network:{hash:'public-hash',transaction_fee:{amount:'0.1',currency:'ADA'}}})]:[tx('buy','buy',5),tx('reward','staking_reward',0.5),tx('duplicate','advanced_trade_fill',1,{advanced_trade_fill:{order_id:'order-1'}}),tx('fallback','advanced_trade_fill',1,{advanced_trade_fill:{order_id:'late-order',order_side:'BUY',product_id:'ADA-EUR',fill_price:'0.5',commission:'0.01'}})],pagination:{next_uri:older?null:'/v2/accounts/account-ada/transactions?starting_after=reward'}});
    }
    if (url.pathname.endsWith('/accounts')) return Response.json({accounts:[{uuid:'account-btc',currency:'BTC',available_balance:{value:'2',currency:'BTC'},hold:{value:'0.5',currency:'BTC'}}],has_next:false,cursor:''});
    assert.equal(url.searchParams.get('product_types'),'SPOT');
    const fills=[url.searchParams.has('cursor') ? {...firstFill,entry_id:'entry-2',size:'0.5'}:firstFill];
    if(lateFillsAvailable && !url.searchParams.has('cursor'))fills.push({...firstFill,entry_id:'late-entry',order_id:'late-order',product_id:'ADA-EUR',price:'0.5'});
    return Response.json({fills,cursor:url.searchParams.has('cursor')?'':'older'});
  };
  server = app.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  for(let i=0;i<500 && db.prepare("SELECT COUNT(*) AS count FROM background_jobs WHERE status IN ('queued','running')").get().count;i++) await pause(20);
  global.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(dataDir,{recursive:true,force:true}); });
async function call(route,body) {
  const response = await fetch(origin+route,body ? {method:'POST',headers:{'Content-Type':'application/json','X-CryptoBuch-Request':'1'},body:JSON.stringify(body)}:{});
  return {status:response.status,data:await response.json()};
}
async function settled(id=connectionId) {
  for (let i=0;i<600;i++) {
    const c = db.prepare('SELECT * FROM exchange_connections WHERE id=?').get(id);
    if (c?.history_completed_at && JSON.parse(c.history_state).version===2) return c;
    await pause(20);
  }
  throw new Error('Historien-Test wurde nicht fertig');
}
test('Provider-Migration erhält IDs, Zugangsdaten und abhängige Salden', () => {
  assert.equal(db.prepare('SELECT api_secret FROM exchange_connections WHERE id=42').get().api_secret,'legacy-secret');
  assert.equal(db.prepare('SELECT free_amount FROM exchange_balance_snapshots WHERE connection_id=42').get().free_amount,890);
  assert.ok(db.prepare('SELECT * FROM exchange_balance_snapshot_meta WHERE connection_id=42').get());
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
});
test('bereits abgeschlossener Fill-only-Import lädt beim Start automatisch die Kontohistorie nach',async()=>{
  const connection=await settled(43);
  assert.equal(JSON.parse(connection.history_state).phase,'complete');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE wallet_id=43').get().n,6);
  const jobs=db.prepare("SELECT * FROM background_jobs WHERE type='exchange_history_sync'").all();
  assert.ok(jobs.some(j=>JSON.parse(j.payload_json).connectionId===43));
});
test('Advanced-Verbindung akzeptiert keine Passphrase, verschlüsselt den Schlüssel und importiert seriell', async () => {
  const invalid = await call('/api/exchange-connections',{provider:'coinbase_advanced',apiKey,apiSecret:'invalid-key'});
  assert.equal(invalid.status,400);
  const wrongProvider = await call('/api/exchange-connections',{provider:'coinbase',apiKey,apiSecret});
  assert.equal(wrongProvider.status,400);assert.match(wrongProvider.data.error,/Advanced Trade/);
  // A local reset can remove the sidecar while the process retains its key.
  const keyFile = path.join(dataDir,'trade-republic-session.key');
  fs.unlinkSync(keyFile);
  const created = await call('/api/exchange-connections',{provider:'coinbase_advanced',apiKey,apiSecret,label:'Advanced Test'});
  assert.equal(created.status,201);connectionId=created.data.id;
  const connection = await settled();importedWalletId=connection.wallet_id;
  assert.notEqual(connection.api_secret,apiSecret);assert.doesNotMatch(connection.api_secret,new RegExp(apiSecret.slice(0,12)));
  assert.equal(JSON.parse(connection.api_secret).v,1);
  const encrypted = JSON.parse(connection.api_secret);
  const decipher = crypto.createDecipheriv('aes-256-gcm',fs.readFileSync(keyFile),Buffer.from(encrypted.iv,'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.tag,'base64'));
  const persisted = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext,'base64')),decipher.final()]).toString());
  assert.equal(persisted.apiSecret,apiSecret);
  assert.equal(connection.coinbase_passphrase,'');
  const transactions = db.prepare('SELECT * FROM transactions WHERE wallet_id=?').all(importedWalletId);
  assert.equal(transactions.length,6);assert.equal(transactions.filter(r=>r.asset==='BTC').reduce((n,r)=>n+r.amount,0),1.5);
  assert.ok(transactions.some(r=>r.purpose==='Staking Rewards'));
  const send=transactions.find(r=>r.hash==='public-hash');assert.equal(send.amount,1.9);assert.equal(send.fee,0.1);
  assert.equal(db.prepare('SELECT free_amount+locked_amount AS total FROM exchange_balance_snapshots WHERE connection_id=?').get(connectionId).total,2.5);
  const status = await call('/api/exchange-connections');
  const safe = status.data.connections.find(c=>c.id===connectionId);
  assert.equal(safe.history.status,'complete');assert.deepEqual(safe.history.warnings,[]);
  assert.doesNotMatch(JSON.stringify(status),new RegExp(apiSecret.slice(0,12)));
  assert.doesNotMatch(JSON.stringify(status),/Authorization|Bearer |ciphertext/);
  const metadata = (await call('/api/v1/metadata')).data;
  assert.ok(JSON.stringify(metadata).includes('coinbase_advanced'));
  const openapi = (await call('/api/openapi.json')).data;
  assert.match(openapi.paths['/api/exchange-connections'].post.description,/coinbase_advanced/);
});
test('erneuter Sync dedupliziert und erhält manuelle Preise und Zwecke', async () => {
  db.prepare("UPDATE transactions SET purpose='Sonstiges',purpose_origin='manual',price_transaction_eur=123,price_source='manual' WHERE wallet_id=? AND external_id='coinbase-advanced:fill:entry-1:base'").run(importedWalletId);
  const result=await call(`/api/exchange-connections/${connectionId}/sync`,{});assert.equal(result.status,202);
  for(let i=0;i<200;i++) {
    if(db.prepare("SELECT status FROM background_jobs WHERE id=?").get(result.data.job.id)?.status==='success')break;
    await pause(20);
  }
  await settled();
  const rows=db.prepare('SELECT * FROM transactions WHERE wallet_id=?').all(importedWalletId);assert.equal(rows.length,6);
  const manual=rows.find(r=>r.external_id==='coinbase-advanced:fill:entry-1:base');
  assert.equal(manual.purpose,'Sonstiges');assert.equal(manual.price_transaction_eur,123);assert.equal(manual.price_source,'manual');
  const v1=await call('/api/v1/exchange-connections');assert.doesNotMatch(JSON.stringify(v1),/ciphertext|api_secret|api_key/);
});
test('später verfügbare Fills erzeugen keine Dublette und erhalten bearbeitete Kontojournal-Orders',async()=>{
  const fallback=db.prepare("SELECT id FROM transactions WHERE wallet_id=? AND json_extract(raw_json,'$.row.advanced_trade_fill.order_id')='late-order'").get(importedWalletId);
  db.prepare("UPDATE transactions SET purpose='Geschenk',purpose_origin='manual',price_transaction_eur=0.75,price_source='manual',price_provider='manual' WHERE id=?").run(fallback.id);
  lateFillsAvailable=true;
  const queued=await call(`/api/exchange-connections/${connectionId}/sync`,{});assert.equal(queued.status,202);
  for(let i=0;i<200;i++){
    if(db.prepare('SELECT status FROM background_jobs WHERE id=?').get(queued.data.job.id).status==='success')break;
    await pause(20);
  }
  await settled();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE wallet_id=?').get(importedWalletId).n,6);
  const row=db.prepare('SELECT * FROM transactions WHERE id=?').get(fallback.id);
  assert.equal(row.purpose,'Geschenk');assert.equal(row.price_transaction_eur,0.75);assert.equal(row.price_provider,'manual');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE wallet_id=? AND external_id='coinbase-advanced:fill:late-entry:base'").get(importedWalletId).n,0);
});
test('fehlende einfache Coinbase-Käufe lassen sich im Advanced-Konto per CSV ergänzen', async () => {
  const profiles=(await call('/api/import/csv-profiles')).data.profiles;
  assert.ok(profiles.find(p=>p.id==='coinbase').targetProviders.includes('coinbase_advanced'));
  const csv='Timestamp,Transaction Type,Asset ID,Quantity Transacted,Spot Price at Transaction,Transaction ID\n2025-01-01T12:00:00Z,Buy,ADA,10,0.5,cb-csv-only\n';
  const imported=await call('/api/import/csv',{profile:'coinbase',exchangeConnectionId:connectionId,csv});
  assert.equal(imported.status,201);assert.equal(imported.data.imported,1);
  const row=db.prepare("SELECT * FROM transactions WHERE wallet_id=? AND asset='ADA' AND hash='cb-csv-only'").get(importedWalletId);
  assert.equal(row.amount,10);assert.equal(row.purpose,'Kauf');
  assert.equal(row.purpose_origin,'manual');
});
