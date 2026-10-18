'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-i18n-'));
process.env.DATA_DIR = directory;
const realFetch = global.fetch;
global.fetch = async () => Response.json({cardano:{eur:1}});
const {app,db} = require('../server');
let server,origin;
test.before(async()=>{
 db.exec(`INSERT INTO wallets (id,chain,address,label) VALUES (1,'ADA','public-i18n-fixture','Kauf');
 INSERT INTO transactions(wallet_id,external_id,hash,timestamp,direction,asset,amount,price_transaction_eur,price_source,purpose,purpose_origin,raw_json) VALUES
 (1,'buy','buy','2026-01-01T12:00:00Z','in','ADA',10,0.2,'manual','Kauf','manual','{}'),
 (1,'sale','sale','2026-02-01T12:00:00Z','out','ADA',1.5,0.4,'manual','Verkauf','manual','{}');`);
 server=app.listen(0,'127.0.0.1');await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();global.fetch=realFetch;fs.rmSync(directory,{recursive:true,force:true});});
test('localizes CSV presentation only when requested and never changes stored accounting values',async()=>{
 const before=db.prepare('SELECT * FROM transactions ORDER BY id').all();
 const legacy=await realFetch(origin+'/api/tax-report.csv?year=2026',{headers:{Cookie:'cryptobuch_language=es'}});
 assert.equal(legacy.headers.get('content-language'),'de');assert.match(await legacy.text(),/^Kategorie;Asset;Menge;/);
 for(const [language,heading,label]of [['en','Category;Asset;Quantity;','Sale'],['es','Categoría;Activo;Cantidad;','Venta']]){
  const csv=await realFetch(origin+'/api/tax-report.csv?year=2026&language='+language);
  assert.equal(csv.headers.get('content-language'),language);
  const body=await csv.text();assert.ok(body.startsWith(heading),body);assert.ok(body.includes(label+';ADA;1.5;'),body);
  const portfolio=await (await realFetch(origin+'/api/portfolio',{headers:{Cookie:'cryptobuch_language='+language}})).json();
  assert.equal(portfolio.wallets[0].label,'Kauf');assert.equal(portfolio.transactions.find(tx=>tx.external_id==='buy')?.purpose || portfolio.transactions.find(tx=>tx.hash==='buy').purpose,'Kauf');
 }
 assert.deepEqual(db.prepare('SELECT * FROM transactions ORDER BY id').all(),before);
});
