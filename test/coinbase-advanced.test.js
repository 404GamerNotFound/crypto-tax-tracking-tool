const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const adapter = require('../lib/coinbase-advanced');
const apiKey = 'organizations/test-org/apiKeys/test-key';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
const apiSecret = Buffer.concat([seed, publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]).toString('base64');
const credentials = { apiKey, apiSecret, requestGapMs: 0, retryGapMs: 0 };
const fill = { entry_id: 'entry-1', trade_id: 'trade-1', product_id: 'BTC-EUR', trade_time: '2026-01-01T00:00:00Z', price: '100', size: '50', size_in_quote: true, side: 'BUY', commission: '2', trade_type: 'FILL' };
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
  for (const pathname of ['/api/v3/brokerage/orders', '/api/v3/brokerage/portfolios/move_funds', 'https://other.invalid/']) assert.throws(() => adapter.createReadJwt({ ...credentials, pathname }), /Nicht erlaubter/);
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
  assert.equal(result.rows.length,1); assert.equal(result.warnings.length,1);
  assert.deepEqual(calls, [[adapter.ACCOUNTS_PATH,null],[adapter.ACCOUNTS_PATH,'next'],[adapter.FILLS_PATH,null]]);
});
test('Historie setzt Cursor fort und behauptet keine Vollständigkeit für fehlende Transfers', async () => {
  const fetchImpl = async url => Response.json({ fills:[fill], cursor:new URL(url).searchParams.has('cursor')?'':'second-page' });
  const first = await adapter.fetchAdvancedHistoryBatch({ ...credentials, fetchImpl });
  assert.equal(first.settled,false);
  const second = await adapter.fetchAdvancedHistoryBatch({ ...credentials, fetchImpl, state:JSON.stringify(first.nextState) });
  assert.equal(second.settled,true); assert.equal(second.complete,false); assert.match(second.warnings[0], /Ein-\/Auszahlungen/);
});
test('Fehler, SCA-Freigabe und defekte Pagination bleiben sichtbar ohne Token- oder Rohdatenlecks', async () => {
  let calls = 0;
  await assert.rejects(adapter.readPage({ ...credentials, pathname:adapter.ACCOUNTS_PATH, fetchImpl:async () => { calls++;return Response.json({secret:'raw-secret-canary'}, {status:401}); } }), error => /HTTP 401/.test(error.message) && !error.message.includes('canary'));
  assert.equal(calls,1);
  const result = await adapter.readPage({ ...credentials, pathname:adapter.FILLS_PATH, fetchImpl:async () => { calls++;return calls < 3 ? new Response('raw-secret-canary',{status:500}) : Response.json({fills:[],cursor:''}); }});
  assert.equal(calls,3);assert.deepEqual(result.list,[]);
  for (const payload of [{fills:[],proof_token_required:true}, {fills:'bad'}, {fills:[fill],cursor:'same'}]) await assert.rejects(adapter.readPage({ ...credentials, pathname:adapter.FILLS_PATH,cursor:'same',fetchImpl:async()=>Response.json(payload) }));
});
