const test = require("node:test");
const assert = require("node:assert/strict");
const {
  signedHeaders,
  normalizeAccountBalances,
  normalizeFill,
  normalizeLedgerEntry,
  normalizeCoinbaseHistoryState,
  fetchCoinbaseHistoryBatch,
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
    if (request.pathname === "/accounts/account-btc/ledger") return { ok: true, headers: new Headers(), json: async () => [{ id: "ledger-1", type: "transfer", currency: "BTC", amount: "1", created_at: "2025-01-02T12:00:00Z" }] };
    if (request.pathname === "/fills") return { ok: true, headers: new Headers(), json: async () => [{ trade_id: "fill-1", created_at: "2025-01-03T12:00:00Z", product_id: "BTC-EUR", side: "buy", size: "0.1", price: "40000", fee: "4" }] };
    throw new Error(`Unexpected ${request.pathname}`);
  };
  const credentials = { apiBaseUrl: "https://api.exchange.coinbase.com", apiKey: "public-key", apiSecret: "c2VjcmV0", passphrase: "passphrase", fetchImpl, now: 1700000000000 };
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
