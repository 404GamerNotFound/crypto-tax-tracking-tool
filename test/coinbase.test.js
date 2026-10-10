const test = require("node:test");
const assert = require("node:assert/strict");
const {
  signedHeaders,
  normalizeAccountBalances,
  normalizeFill,
  normalizeLedgerEntry,
  normalizeCoinbaseHistoryState,
  fetchCoinbaseAccounts,
  fetchCoinbaseHistoryBatch,
  fetchCoinbaseHistory,
} = require("../lib/coinbase");

test("signiert Coinbase-Exchange-GET-Anfragen mit dem decodierten API-Secret", () => {
  const headers = signedHeaders({
    apiKey: "api-key", apiSecret: "c2VjcmV0", passphrase: "passphrase", method: "GET", path: "/accounts", now: 1700000000000,
  });
  assert.deepEqual(headers, {
    Accept: "application/json",
    "CB-ACCESS-KEY": "api-key",
    "CB-ACCESS-SIGN": "p4Xa5K4NJ1AtiEBmUbme6DmXWbRF8pYDmPmpNMdWvvc=",
    "CB-ACCESS-TIMESTAMP": "1700000000",
    "CB-ACCESS-PASSPHRASE": "passphrase",
  });
});

test("normalisiert Coinbase-Bestände, Fills und Ledger-Transfers ohne Fiat-Bestand", () => {
  assert.deepEqual(normalizeAccountBalances([
    { currency: "BTC", balance: "0.3", available: "0.2", hold: "0.1" },
    { currency: "BTC", balance: "0.2", available: "0.2", hold: "0" },
  ]), [{ asset: "BTC", free: 0.4, locked: 0.1, total: 0.5 }]);
  const rows = normalizeFill({ trade_id: "f-1", created_at: "2025-01-01T12:00:00Z", product_id: "ETH-USDC", side: "buy", size: "2", price: "2500", fee: "3", fee_currency: "USDC" });
  assert.deepEqual(rows.map((row) => [row.direction, row.asset, row.amount, row.purpose]), [
    ["in", "ETH", 2, "Kauf"], ["out", "USDC", 5000, "Verkauf"], ["out", "USDC", 3, "Gebühr"],
  ]);
  const transfer = normalizeLedgerEntry({ id: "l-1", type: "transfer", currency: "BTC", amount: "0.25", created_at: "2025-01-02T12:00:00Z", details: { transfer_id: "t-1" } }, { currency: "BTC" });
  assert.deepEqual([transfer.direction, transfer.asset, transfer.amount, transfer.purpose], ["in", "BTC", 0.25, "Transfer"]);
  assert.equal(normalizeLedgerEntry({ id: "l-2", type: "match", currency: "BTC", amount: "0.25", created_at: "2025-01-02T12:00:00Z" }, { currency: "BTC" }), null);
});

test("lädt die Coinbase-Historie seriell über Konten, Ledger und Fills", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const request = new URL(url);
    calls.push({ path: request.pathname, after: request.searchParams.get("after"), headers: options.headers });
    if (request.pathname === "/accounts") return { ok: true, headers: new Headers(), json: async () => [{ id: "account-btc", currency: "BTC", balance: "1", available: "1", hold: "0" }] };
    if (request.pathname === "/accounts/account-btc/ledger") return { ok: true, headers: new Headers(), json: async () => [{ id: "ledger-1", type: "transfer", currency: "BTC", amount: "1", created_at: "2025-01-02T12:00:00Z" }, { id: "match-1", type: "match", details: { order_id: "order-1" } }] };
    if (request.pathname === "/fills") { assert.equal(request.searchParams.get("order_id"), "order-1"); return { ok: true, headers: new Headers(), json: async () => [{ trade_id: "fill-1", created_at: "2025-01-03T12:00:00Z", product_id: "BTC-EUR", side: "buy", size: "0.1", price: "40000", fee: "4" }] }; }
    throw new Error(`Unexpected ${request.pathname}`);
  };
  const credentials = { apiBaseUrl: "https://api.exchange.coinbase.com", apiKey: "public-key", apiSecret: "c2VjcmV0", passphrase: "passphrase", fetchImpl, now: 1700000000000, requestGapMs: 0, retryGapMs: 0 };
  const accounts = await fetchCoinbaseHistoryBatch({ ...credentials, state: { phase: "accounts" } });
  assert.deepEqual(accounts.accountBalances, null);
  assert.equal(accounts.nextState.phase, "ledgers");
  const ledger = await fetchCoinbaseHistoryBatch({ ...credentials, state: accounts.nextState });
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.nextState.phase, "ledgers");
  const fillsReady = await fetchCoinbaseHistoryBatch({ ...credentials, state: ledger.nextState });
  assert.equal(fillsReady.nextState.phase, "fills");
  const fills = await fetchCoinbaseHistoryBatch({ ...credentials, state: fillsReady.nextState });
  assert.equal(fills.complete, true);
  assert.deepEqual(fills.rows.map((row) => [row.asset, row.purpose, row.fee, row.feeAsset]), [["BTC", "Kauf", 4, "EUR"]]);
  assert.deepEqual(calls.map((call) => call.path), ["/accounts", "/accounts/account-btc/ledger", "/fills"]);
  assert.ok(calls.every((call) => call.headers["CB-ACCESS-SIGN"]));
  assert.equal(normalizeCoinbaseHistoryState(JSON.stringify(fills.nextState)).phase, "complete");
});

const credentials = { apiBaseUrl: 'https://coinbase.fixture.invalid', apiKey: 'test-key', apiSecret: 'c2VjcmV0', passphrase: 'test-passphrase', requestGapMs: 0, retryGapMs: 0 };

test('Coinbase-Sync filtert Fills nach deduplizierten Ledger-Orders', async () => {
  const orders = [];
  const result = await fetchCoinbaseHistory({ ...credentials, fetchImpl: async (url) => {
    const u = new URL(url);
    if (u.pathname === '/accounts') return Response.json([{ id: 'btc', currency: 'BTC', balance: '1' }, { id: 'eur', currency: 'EUR', balance: '100' }]);
    if (u.pathname.endsWith('/ledger')) return Response.json([{ type: 'match', details: { order_id: 'order-1' } }]);
    assert.equal(u.pathname, '/fills');
    orders.push(u.searchParams.get('order_id'));
    return Response.json([{ trade_id: '1', product_id: 'BTC-EUR', created_at: '2026-10-01T00:00:00Z', size: '1', price: '100', side: 'buy' }]);
  } });
  assert.deepEqual(orders, ['order-1']); assert.equal(result.rows.length, 1);
});

test('Coinbase-Historie verarbeitet mehrere Orders und Cursor seriell', async () => {
  const calls = [];
  const fetchImpl = async url => {
    const u = new URL(url); const order = u.searchParams.get('order_id'); calls.push([order, u.searchParams.get('after')]);
    assert.ok(order);
    return Response.json([], { headers: order === 'order-1' && !u.searchParams.get('after') ? { 'cb-after': 'cursor-1' } : {} });
  };
  let state = { version: 2, phase: 'fills', orderIds: ['order-1', 'order-2'] };
  let result = await fetchCoinbaseHistoryBatch({ ...credentials, fetchImpl, state });
  assert.equal(result.complete, false); assert.equal(result.nextState.orderIndex, 0);
  result = await fetchCoinbaseHistoryBatch({ ...credentials, fetchImpl, state: result.nextState });
  assert.equal(result.nextState.orderIndex, 1); assert.equal(result.nextState.fillsCursor, '');
  result = await fetchCoinbaseHistoryBatch({ ...credentials, fetchImpl, state: result.nextState });
  assert.equal(result.complete, true);
  assert.deepEqual(calls, [['order-1', null], ['order-1', 'cursor-1'], ['order-2', null]]);
  assert.equal(normalizeCoinbaseHistoryState({ version: 1, phase: 'fills', fillsCursor: 'unsafe-cursor' }).phase, 'accounts');
});

test('Coinbase wiederholt vorübergehende HTTP- und Netzwerkfehler begrenzt und verrät keine Rohdaten', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return calls < 3 ? Response.json({ message: 'secret: raw-sensitive-body' }, { status: 500 }) : Response.json([]); };
  const result = await fetchCoinbaseHistoryBatch({ ...credentials, fetchImpl });
  assert.equal(calls, 3); assert.equal(result.nextState.phase, 'ledgers');
  calls = 0;
  await assert.rejects(fetchCoinbaseHistoryBatch({ ...credentials, fetchImpl: async () => {
    calls++; throw Object.assign(new TypeError('fetch failed: secret-value'), { cause: { code: 'ENOTFOUND' } });
  } }), error => /Coinbase Exchange · Konten: DNS/.test(error.message) && !/secret-value|fetch failed/.test(error.message));
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(fetchCoinbaseHistoryBatch({ ...credentials, fetchImpl: async () => { calls++; return Response.json({ message: 'secret: raw-sensitive-body' }, { status: 401 }); } }), /HTTP 401, Zugang abgelehnt/);
  assert.equal(calls, 1);
});

test('Coinbase markiert fehlerhafte Antworten nicht als erfolgreich importierte leere Historie', async () => {
  await assert.rejects(fetchCoinbaseHistoryBatch({ ...credentials, fetchImpl: async () => Response.json({ accounts: [] }) }), /Unerwartete Datenstruktur/);
  await assert.rejects(fetchCoinbaseHistoryBatch({ ...credentials, fetchImpl: async () => new Response('<html>error</html>', { status: 502 }) }), /HTTP 502, ungültige JSON/);
  await assert.rejects(fetchCoinbaseHistoryBatch({ ...credentials, state: { version: 2, phase: 'ledgers', accounts: [{ id: 'btc', currency: 'BTC' }] }, fetchImpl: async () => Response.json([{ type: 'match', details: {} }]) }), /Trade ohne verwertbare Order-ID/);
});

test('Coinbase-Konten verwenden den unpaginierten Endpunkt und ersetzen alte Teilstände', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    // Model a service that rejects undocumented account query parameters.
    assert.equal(new URL(url).search, '');
    return Response.json([{ id: 'current-account', currency: 'ADA', balance: '42' }], { headers: { 'cb-after': 'irrelevant-header' } });
  };
  const result = await fetchCoinbaseAccounts({ ...credentials, fetchImpl });
  assert.equal(result.accounts.length, 1);
  assert.equal(result.cursor, '');
  const batch = await fetchCoinbaseHistoryBatch({ ...credentials, fetchImpl, state: {
    version: 2, phase: 'accounts', accountsCursor: 'old-cursor', accounts: [{ id: 'stale-account', currency: 'BTC' }], accountIndex: 1,
  } });
  assert.deepEqual(batch.nextState.accounts, [{ id: 'current-account', currency: 'ADA' }]);
  assert.equal(batch.nextState.accountsCursor, '');
  assert.equal(batch.nextState.accountIndex, 0);
  assert.equal(batch.nextState.phase, 'ledgers');
  assert.equal(calls.length, 2);
});

test('Coinbase signiert die gesendeten Ledger- und Fill-Parameter einschließlich codierter Cursor', async () => {
  const fixtures = [
    { state: { version: 2, phase: 'ledgers', accounts: [{ id: 'account-btc', currency: 'BTC' }] },
      path: '/accounts/account-btc/ledger?limit=100', signature: 'mkZM7TGU8MSEiNCNZCd6KDdPjTvUTUy7OtPLWzhTdLI=' },
    { state: { version: 2, phase: 'fills', orderIds: ['order-1'], fillsCursor: 'cursor+/=' },
      path: '/fills?order_id=order-1&limit=100&after=cursor%2B%2F%3D', signature: '6I5+maXwZdkEvbJlEFpuDT2gORXYdRLWxUQr9tG2koI=' },
  ];
  for (const fixture of fixtures) {
    await fetchCoinbaseHistoryBatch({ ...credentials, now: 1700000000000, state: fixture.state, fetchImpl: async (url, options) => {
      assert.equal(url, credentials.apiBaseUrl + fixture.path);
      assert.equal(options.method, 'GET');
      assert.equal(options.headers['CB-ACCESS-TIMESTAMP'], '1700000000');
      // Fixed reference digests calculated independently with Python's HMAC.
      assert.equal(options.headers['CB-ACCESS-SIGN'], fixture.signature);
      return Response.json([]);
    } });
  }
});

test('Coinbase lehnt unvollständige oder abgeschnittene Kontenlisten ab', async () => {
  for (const payload of [[null], [{ id: 'account' }], [{ id: '', currency: 'BTC' }]]) {
    await assert.rejects(fetchCoinbaseAccounts({ ...credentials, fetchImpl: async () => Response.json(payload) }), /Unvollständige Kontodaten/);
  }
  await assert.rejects(fetchCoinbaseAccounts({ ...credentials, fetchImpl: async () => Response.json(
    Array.from({ length: 501 }, (_, i) => ({ id: `account-${i}`, currency: 'BTC' }))
  ) }), /Zu viele Konten/);
});
