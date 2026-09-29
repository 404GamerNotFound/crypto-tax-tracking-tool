const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const {
  bsdexHeaders,
  bsdexWebSocketUrl,
  createBsdexLiveClient,
  fetchBsdexHistory,
  normalizeBsdexBalances,
  normalizeBsdexDeposit,
  normalizeBsdexTrade,
  normalizeBsdexWithdrawal,
} = require("../lib/bsdex");

test("signiert BSDEX-Read-only-Anfragen über den Date-Header", () => {
  const date = "Mon, 01 Jan 2024 00:00:00 GMT";
  const headers = bsdexHeaders({ apiKey: "api-key", apiSecret: "secret", date });
  const signature = crypto.createHmac("sha1", "secret").update(`date: ${date}`).digest("base64");
  assert.equal(headers.Date, date);
  assert.equal(headers.ApiKey, "api-key");
  assert.equal(headers.Authorization, `hmac username="api-key", algorithm="hmac-sha1", headers="date", signature="${signature}"`);
  assert.match(headers["X-Request-Id"], /^[0-9a-f-]{36}$/i);
  assert.equal(bsdexWebSocketUrl("https://api-public.bsdex.de"), "wss://api-public.bsdex.de/api/v1/ws");
});

test("normalisiert BSDEX-EUR-Trades und schließt Fiat aus Saldo-Snapshots aus", () => {
  const trade = normalizeBsdexTrade({
    id: "42", market: "btc-eur", local_ts: "1704067200000000000", quantity: "0.25", price: "42000", side: "buy", fee: "8.50",
  });
  assert.deepEqual({
    externalId: trade.externalId, timestamp: trade.timestamp, direction: trade.direction, asset: trade.asset,
    amount: trade.amount, fee: trade.fee, feeAsset: trade.feeAsset, priceEur: trade.priceEur, purpose: trade.purpose,
  }, {
    externalId: "bsdex:trade:btc-eur:42:base", timestamp: "2024-01-01T00:00:00.000Z", direction: "in", asset: "BTC",
    amount: 0.25, fee: 8.5, feeAsset: "EUR", priceEur: 42000, purpose: "Kauf",
  });
  assert.deepEqual(normalizeBsdexBalances([
    { asset_id: "BTC", available: "0.2", locked: "0.1" }, { asset_id: "EUR", available: "100", locked: "0" }, { asset_id: "XBT", available: "0.05", locked: "0" },
  ]), [{ asset: "BTC", free: 0.25, locked: 0.1, total: 0.35 }]);
  assert.equal(normalizeBsdexTrade({ id: "bad", market: "btc-usdt", local_ts: "1704067200000000000", quantity: "1", price: "1", side: "buy" }), null);
});

test("normalisiert nur abgeschlossene BSDEX-Krypto-Ein- und Auszahlungen als Transfers", () => {
  const deposit = normalizeBsdexDeposit({
    uuid: "deposit-1", amount: "0.25", asset_id: "btc", created_at: "2024-01-01T00:00:00Z", finalized_at: "2024-01-01T01:00:00Z",
    source_address: "bc1source", source_tag: null, transaction_state: "created",
  });
  const withdrawal = normalizeBsdexWithdrawal({
    uuid: "withdrawal-1", amount: "2.5", asset_id: "xrp", created_at: "2024-01-01T00:00:00Z", finalized_at: "2024-01-01T01:00:00Z",
    target_address: "rTarget", destination_tag: "123", transaction_state: "created",
  });
  assert.deepEqual({ externalId: deposit.externalId, direction: deposit.direction, asset: deposit.asset, amount: deposit.amount, purpose: deposit.purpose, timestamp: deposit.timestamp }, {
    externalId: "bsdex:deposit:deposit-1:btc", direction: "in", asset: "BTC", amount: 0.25, purpose: "Transfer", timestamp: "2024-01-01T01:00:00.000Z",
  });
  assert.equal(deposit.counterparty, "BSDEX · bc1source");
  assert.deepEqual({ externalId: withdrawal.externalId, direction: withdrawal.direction, asset: withdrawal.asset, amount: withdrawal.amount, purpose: withdrawal.purpose }, {
    externalId: "bsdex:withdrawal:withdrawal-1:xrp", direction: "out", asset: "XRP", amount: 2.5, purpose: "Transfer",
  });
  assert.equal(withdrawal.counterparty, "BSDEX · rTarget · Tag 123");
  assert.equal(normalizeBsdexWithdrawal({ uuid: "pending", amount: "1", asset_id: "btc", created_at: "2024-01-01T00:00:00Z", transaction_state: "created" }), null);
});

test("holt BSDEX-Salden, abgeschlossene Transfers und marktweise Trade-Seiten ausschließlich seriell per GET", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const requestUrl = new URL(url);
    calls.push({ path: requestUrl.pathname, cursor: requestUrl.searchParams.get("cursor"), page: requestUrl.searchParams.get("page"), asset: requestUrl.searchParams.get("asset_id"), method: options.method, headers: options.headers });
    const payload = requestUrl.pathname === "/markets" ? [{ id: "btc-eur" }, { id: "eth-usdt" }]
      : requestUrl.pathname === "/api/v1/balance" ? [{ asset_id: "BTC", available: "0.1", locked: "0" }]
        : requestUrl.pathname === "/api/v2/crypto/deposits" && requestUrl.searchParams.get("asset_id") === "btc" && requestUrl.searchParams.get("page") === "1" ? {
          data: [{ uuid: "deposit-1", asset_id: "btc", amount: "0.2", created_at: "2024-01-01T00:00:00Z", finalized_at: "2024-01-01T00:01:00Z", source_address: "bc1source", transaction_state: "created" }],
        }
          : requestUrl.pathname === "/api/v2/crypto/withdrawals" && requestUrl.searchParams.get("asset_id") === "btc" && requestUrl.searchParams.get("page") === "1" ? {
            data: [{ uuid: "withdrawal-1", asset_id: "btc", amount: "0.05", created_at: "2024-01-02T00:00:00Z", finalized_at: "2024-01-02T00:01:00Z", target_address: "bc1target", transaction_state: "created" }],
          }
            : requestUrl.pathname.startsWith("/api/v2/crypto/") ? { data: [] }
        : requestUrl.searchParams.get("cursor") ? [] : [{ id: "7", local_ts: "1704067200000000000", quantity: "0.1", price: "40000", side: "sell", fee: "2", market: "btc-eur" }];
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === "next-cursor" && requestUrl.pathname.endsWith("/trades") && !requestUrl.searchParams.get("cursor") ? "next-page" : null },
      json: async () => payload,
    };
  };
  const result = await fetchBsdexHistory({
    apiBaseUrl: "https://api-public.bsdex.de", apiKey: "api-key", apiSecret: "secret", fetchImpl, requestGapMs: 0,
  });
  assert.deepEqual(result.markets, ["btc-eur"]);
  assert.deepEqual(result.accountBalances, [{ asset: "BTC", free: 0.1, locked: 0, total: 0.1 }]);
  assert.deepEqual(result.rows.map((row) => [row.direction, row.asset, row.amount, row.purpose]), [["in", "BTC", 0.2, "Transfer"], ["out", "BTC", 0.05, "Transfer"], ["out", "BTC", 0.1, "Verkauf"]]);
  assert.deepEqual(calls.slice(0, 2).map((call) => [call.path, call.method]), [["/markets", "GET"], ["/api/v1/balance", "GET"]]);
  assert.equal(calls.some((call) => call.path === "/api/v2/crypto/deposits" && call.asset === "btc" && call.page === "1"), true);
  assert.equal(calls.some((call) => call.path === "/api/v2/crypto/withdrawals" && call.asset === "btc" && call.page === "1"), true);
  assert.deepEqual(calls.slice(-2).map((call) => [call.path, call.cursor, call.method]), [
    ["/api/v1/btc-eur/trades", null, "GET"], ["/api/v1/btc-eur/trades", "next-page", "GET"],
  ]);
  assert.equal(calls[0].headers.ApiKey, undefined);
  assert.equal(calls.slice(1).every((call) => call.headers.ApiKey === "api-key" && call.headers.Authorization.startsWith("hmac ")), true);
  assert.equal(calls.slice(1).every((call) => /^[0-9a-f-]{36}$/i.test(call.headers["X-Request-Id"])), true);
});

test("abonniert im Live-Modus ausschließlich private Saldo- und Trade-Kanäle", async () => {
  class FakeSocket extends EventEmitter {
    static OPEN = 1;
    static instance = null;
    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.readyState = FakeSocket.OPEN;
      this.sent = [];
      FakeSocket.instance = this;
      queueMicrotask(() => this.emit("open"));
    }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.emit("close"); }
  }
  const received = [];
  const client = createBsdexLiveClient({
    apiBaseUrl: "https://api-public.bsdex.de", apiKey: "api-key", apiSecret: "secret",
    markets: ["btc-eur", "eth-usdt"], assets: ["BTC", "EUR"], WebSocketImpl: FakeSocket, heartbeatMs: 5000,
    onTrade: (data, market) => received.push(["trade", market, data.id]),
    onBalance: (data) => received.push(["balance", data.asset_id, data.available]),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(FakeSocket.instance.url, "wss://api-public.bsdex.de/api/v1/ws");
  assert.deepEqual(FakeSocket.instance.sent, [
    { type: "subscribe", chan_name: "trade", subchan_name: "btc-eur" },
    { type: "subscribe", chan_name: "balance", subchan_name: "btc" },
  ]);
  FakeSocket.instance.emit("message", Buffer.from(JSON.stringify({ type: "data", chan_name: "trade", subchan_name: "btc-eur", data: { id: "t-1" } })));
  FakeSocket.instance.emit("message", Buffer.from(JSON.stringify({ type: "data", chan_name: "balance", data: { asset_id: "BTC", available: "0.2" } })));
  assert.deepEqual(received, [["trade", "btc-eur", "t-1"], ["balance", "BTC", "0.2"]]);
  client.close();
});
