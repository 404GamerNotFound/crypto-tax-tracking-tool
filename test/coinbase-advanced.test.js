const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const adapter = require('../lib/coinbase-advanced');
const apiKey = 'organizations/test-org/apiKeys/test-key';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
const apiSecret = Buffer.concat([seed, publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]).toString('base64');
const credentials = { apiKey, apiSecret, requestGapMs: 0, retryGapMs: 0 };
const fill = { entry_id: 'entry-1', trade_id: 'trade-1', order_id: 'order-1', product_id: 'BTC-EUR', trade_time: '2026-01-01T00:00:00Z', price: '100', size: '50', size_in_quote: true, side: 'BUY', commission: '2', trade_type: 'FILL' };
function verifyJwt(token, key, pathname) {
  const [h, p, sig] = token.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(header.kid, apiKey); assert.match(header.nonce, /^[a-f0-9]{32}$/);
  assert.equal(payload.sub, apiKey); assert.equal(payload.iss, 'cdp');
  assert.equal(payload.uri, `GET api.coinbase.com${pathname}`); assert.equal(payload.exp - payload.nbf, 120);
  assert.equal(crypto.verify(header.alg === 'EdDSA' ? null : 'sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), true);
  return header;
}
test('CDP-JWTs unterstützen Ed25519 und ECDSA und sind an freigegebene GET-Pfade gebunden', () => {
  const jwt = adapter.createReadJwt({ ...credentials, pathname: adapter.ACCOUNTS_PATH, now: 1700000000000 });
  assert.equal(verifyJwt(jwt, publicKey, adapter.ACCOUNTS_PATH).alg, 'EdDSA');
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' });
  const token = adapter.createReadJwt({ apiKey, apiSecret: pem.replace(/\n/g, '\\n'), pathname: adapter.FILLS_PATH });
  assert.equal(verifyJwt(token, pair.publicKey, adapter.FILLS_PATH).alg, 'ES256');
  verifyJwt(adapter.createReadJwt({...credentials,pathname:'/v2/accounts/account-1/transactions'}),publicKey,'/v2/accounts/account-1/transactions');
  for (const pathname of ['/api/v3/brokerage/orders', '/api/v3/brokerage/portfolios/move_funds', 'https://other.invalid/', '/v2/user', '/v2/accounts/a/transactions/b', '/v2/accounts/../transactions']) assert.throws(() => adapter.createReadJwt({ ...credentials, pathname }), /Nicht erlaubter/);
  for (const secret of ['xprv-private', 'abandon '.repeat(12), '%%%not-base64', crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' })]) assert.throws(() => adapter.signingKey(apiKey, secret), /API-Signaturschlüssel/);
});
test('Advanced-Fills rechnen Quote-Mengen um und trennen Krypto-Gegenbuchungen und Gebühren', () => {
  const rows = adapter.advancedFillRows([fill]);
  assert.deepEqual(rows.map(r => [r.externalId, r.asset, r.amount, r.priceEur, r.fee, r.feeAsset]), [['coinbase-advanced:fill:entry-1:base', 'BTC', 0.5, 100, 2, 'EUR']]);
  const swap = adapter.advancedFillRows([{ ...fill, entry_id: 'entry-2', product_id: 'ETH-USDC', side: 'SELL', size: '1', size_in_quote: false }]);
  assert.deepEqual(swap.map(r => [r.direction, r.asset, r.amount, r.purpose]), [['out','ETH',1,'Verkauf'],['in','USDC',100,'Kauf'],['out','USDC',2,'Gebühr']]);
  for (const changed of [{ size_in_quote: undefined }, { price: 'NaN' }, { commission: '-1' }, { side: '?' }, { product_type: 'FUTURE' }, { future_legs: [{}] }]) assert.throws(() => adapter.advancedFillRows([{ ...fill, ...changed }]));
});
test('Konten und gebundene Guthaben werden über alle Seiten seriell erfasst', async () => {
  const calls = [];
  const account = (uuid, amount, locked) => ({ uuid, currency:'BTC', available_balance:{value:amount,currency:'BTC'},hold:{value:locked,currency:'BTC'} });
  const result = await adapter.fetchAdvancedHistory({ ...credentials, fetchImpl: async (url, options) => {
    const u = new URL(url); calls.push([u.pathname, u.searchParams.get('cursor')]);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    verifyJwt(options.headers.Authorization.slice(7), publicKey, u.pathname);
    if (u.pathname === adapter.ACCOUNTS_PATH) return Response.json({ accounts:[account(u.searchParams.has('cursor')?'second':'first', '1','0.5')], has_next: !u.searchParams.has('cursor'),cursor:'next' });
    assert.equal(u.searchParams.get('product_types'), 'SPOT');
    return Response.json({fills:[fill],cursor:''});
  }});
  assert.deepEqual(result.accountBalances, [{asset:'BTC', free:2, locked:1, total:3}]);
  assert.equal(result.rows.length,0); assert.equal(result.warnings.length,0);
  assert.deepEqual(calls, [[adapter.ACCOUNTS_PATH,null],[adapter.ACCOUNTS_PATH,'next']]);
});
const appTx = (id,type,amount,extra={}) => ({id,type,status:'completed',amount:{amount:String(amount),currency:'BTC'},native_amount:{amount:String(Math.abs(amount)*100),currency:'EUR'},created_at:'2025-01-01T00:00:00Z',...extra});
test('Historie lädt auch Konten ohne Saldo paginiert und setzt jede Phase nach einem Neustart fort', async () => {
  const calls=[];
  const fetchImpl=async (url,options)=>{
    const u=new URL(url);calls.push(u.pathname);
    verifyJwt(options.headers.Authorization.slice(7),publicKey,u.pathname);
    assert.equal(options.method,'GET');
    if(u.pathname===adapter.FILLS_PATH)return Response.json({fills:[fill],cursor:u.searchParams.has('cursor')?'':'next-fill'});
    if(u.pathname===adapter.APP_ACCOUNTS_PATH)return Response.json({data:[{id:'empty-account',currency:{code:'BTC',type:'crypto'},balance:{amount:'0'}}],pagination:{next_uri:null}});
    const older=u.searchParams.has('starting_after');
    return Response.json({data:[appTx(older?'older-tx':'first-tx',older?'send':'buy',older?-0.1:1)],pagination:{next_uri:older?null:'/v2/accounts/empty-account/transactions?starting_after=first-tx&limit=100'}});
  };
  let state,total=0,result;
  do {result=await adapter.fetchAdvancedHistoryBatch({...credentials,fetchImpl,state:JSON.stringify(state)});state=result.nextState;total+=result.rows.length;}while(!result.settled);
  assert.equal(result.complete,true);assert.equal(total,4);assert.deepEqual(result.warnings,[]);
  assert.equal(calls.length,5);assert.equal(state.version,2);
  assert.equal(adapter.normalizeAdvancedState({version:1,phase:'complete',cursor:'old',warnings:['old warning']}).phase,'fills');
  assert.equal(adapter.normalizeAdvancedState({version:1,phase:'complete'}).warnings.length,0);
});
test('Fehler, SCA-Freigabe und defekte Pagination bleiben sichtbar ohne Token- oder Rohdatenlecks', async () => {
  let calls = 0;
  await assert.rejects(adapter.readPage({ ...credentials, pathname:adapter.ACCOUNTS_PATH, fetchImpl:async () => { calls++;return Response.json({secret:'raw-secret-canary'}, {status:401}); } }), error => /HTTP 401/.test(error.message) && !error.message.includes('canary'));
  assert.equal(calls,1);
  const result = await adapter.readPage({ ...credentials, pathname:adapter.FILLS_PATH, fetchImpl:async () => { calls++;return calls < 3 ? new Response('raw-secret-canary',{status:500}) : Response.json({fills:[],cursor:''}); }});
  assert.equal(calls,3);assert.deepEqual(result.list,[]);
  for (const payload of [{fills:[],proof_token_required:true}, {fills:'bad'}, {fills:[fill],cursor:'same'}]) await assert.rejects(adapter.readPage({ ...credentials, pathname:adapter.FILLS_PATH,cursor:'same',fetchImpl:async()=>Response.json(payload) }));
});
test('Coinbase-Kontobelege erhalten Käufe, Gebühren, Transfers und Erträge, ohne fehlende EUR-Kurse zu erfinden',()=>{
  const account={id:'account-1',currency:'BTC'};
  const {rows,warnings}=adapter.normalizeAppTransactions([
    appTx('buy','buy',1,{buy:{subtotal:{amount:'100',currency:'EUR'},fee:{amount:'2',currency:'EUR'}}}),
    appTx('sell','sell',-1),appTx('send','send',-1.1,{network:{hash:'onchain-hash',transaction_fee:{amount:'0.1',currency:'BTC'}}}),
    appTx('receive','receive',0.5),appTx('staking','staking_reward',0.01),appTx('interest','interest',0.02),appTx('earn','earn_payout',0.03),
    appTx('convert','trade',-0.2),appTx('pro','pro_withdrawal',0.4,{native_amount:{amount:'10',currency:'USD'}}),
    appTx('unknown','tx',0.001),appTx('failed','buy',1,{status:'failed'}),appTx('pending','send',-1,{status:'pending'})
  ],account);
  assert.equal(rows.length,10);assert.equal(warnings.length,1);
  assert.deepEqual(rows.map(r=>r.purpose),['Kauf','Verkauf','Transfer','Transfer','Staking Rewards','Lending-Ertrag','Airdrop','Verkauf','Transfer','Sonstiges']);
  assert.equal(rows[0].priceEur,100);assert.equal(rows[0].fee,2);assert.equal(rows[0].feeAsset,'EUR');
  assert.equal(rows[2].amount,1);assert.equal(rows[2].fee,0.1);assert.equal(rows[2].hash,'onchain-hash');
  assert.equal(rows[8].priceEur,null);
  for(const changed of [{amount:{amount:'NaN',currency:'BTC'}},{amount:{amount:'1',currency:'ETH'}},{created_at:'bad'}])assert.throws(()=>adapter.normalizeAppTransactions([appTx('bad','buy',1,changed)],account));
});
test('Kontohistorie liefert fehlende Advanced-Trade-Orders und überspringt nur belegte Fill-Orders',()=>{
  const tx=appTx('advanced-tx','advanced_trade_fill',0.5,{advanced_trade_fill:{order_id:'order-1',order_side:'BUY',product_id:'BTC-EUR',fill_price:'100',commission:'2'}});
  assert.equal(adapter.normalizeAppTransactions([tx],{id:'account',currency:'BTC'},['order-1']).rows.length,0);
  const rows=adapter.normalizeAppTransactions([tx],{id:'account',currency:'BTC'},[]).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].amount,0.5);assert.equal(rows[0].fee,2);assert.equal(rows[0].priceEur,100);
  assert.equal(adapter.normalizeAppTransactions([{...tx,advanced_trade_fill:{...tx.advanced_trade_fill,order_side:'buy'}}],{id:'account',currency:'BTC'},[]).rows.length,1);
  assert.throws(()=>adapter.normalizeAppTransactions([{...tx,advanced_trade_fill:{...tx.advanced_trade_fill,product_id:'BTC-USD-PERP'}}],{id:'account',currency:'BTC'},[]),/Derivate/);
  assert.throws(()=>adapter.normalizeAppTransactions([{...tx,advanced_trade_fill:{...tx.advanced_trade_fill,order_side:'SELL'}}],{id:'account',currency:'BTC'},[]),/Ungültige Spot/);
});
test('Vorhandene Kontojournal-Orders bleiben auch bei später verfügbaren Fills eindeutig',async()=>{
  const result=await adapter.fetchAdvancedHistoryBatch({...credentials,accountOrderIds:['order-1'],fetchImpl:async()=>Response.json({fills:[fill],cursor:''})});
  assert.deepEqual(result.rows,[]);assert.deepEqual(result.nextState.orderIds,[]);assert.equal(result.nextState.phase,'accounts');
});
test('Kontopagination lehnt fremde Ziele und zyklische Cursor ab',async()=>{
  for(const next_uri of ['https://evil.invalid/v2/accounts?starting_after=next','https://user:secret@api.coinbase.com/v2/accounts?starting_after=next','/v2/user?starting_after=next','/v2/accounts?starting_after=old']){
    await assert.rejects(adapter.readPage({...credentials,pathname:adapter.APP_ACCOUNTS_PATH,cursor:'old',fetchImpl:async()=>Response.json({data:[{}],pagination:{next_uri}})}),/Pagination/);
  }
  await assert.rejects(adapter.fetchAdvancedHistoryBatch({...credentials,state:{version:2,phase:'accounts',cursor:'one',seenCursors:['two']},fetchImpl:async()=>Response.json({data:[{}],pagination:{next_uri:'/v2/accounts?starting_after=two'}})}),/Wiederholter/);
});
