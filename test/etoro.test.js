const test = require("node:test");
const assert = require("node:assert/strict");
const { etoroHeaders, normalizeEtoroTrade, fetchEtoroHistory } = require("../lib/etoro");

test("verwendet für eToro ausschließlich die dokumentierten Read-only-Header", () => {
  const headers = etoroHeaders({ apiKey: "public-key", userKey: "user-key", requestId: "request-123" });
  assert.deepEqual(headers, {
    "x-api-key": "public-key", "x-user-key": "user-key", "x-request-id": "request-123", Accept: "application/json",
  });
});

test("normalisiert nur explizite Krypto-Einheiten und erfindet keine USD-Umrechnung", () => {
  const trade = normalizeEtoroTrade({
    id: "order-1", instrument: { symbolName: "BTC", assetClass: "Crypto" }, transactionType: "Buy",
    units: "0.25", timestamp: "2025-01-01T12:00:00Z", rate: "42000", currency: "USD",
  });
  assert.deepEqual({ asset: trade.asset, amount: trade.amount, direction: trade.direction, purpose: trade.purpose, priceEur: trade.priceEur }, {
    asset: "BTC", amount: 0.25, direction: "in", purpose: "Kauf", priceEur: null,
  });
  assert.equal(normalizeEtoroTrade({ id: "order-2", instrument: { symbolName: "ETH", assetClass: "Crypto" }, transactionType: "Buy", amount: "500", timestamp: "2025-01-01T12:00:00Z" }), null);
});

test("liest eToro-Historie seriell und normalisiert paginierte Buchungen", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ path: `${url.pathname}${url.search}`, method: options.method, headers: options.headers });
    const page = url.searchParams.get("page");
    if (page === "1") return { ok: true, json: async () => ({ data: { items: [{ id: "1", instrument: { symbolName: "BTC", assetClass: "Crypto" }, transactionType: "Buy", units: "0.1", timestamp: "2025-01-01T00:00:00Z" }], totalPages: 2 } }) };
    return { ok: true, json: async () => ({ data: { items: [{ id: "2", instrument: { symbolName: "ETH", assetClass: "Crypto" }, transactionType: "Sell", units: "0.5", timestamp: "2025-01-02T00:00:00Z" }], totalPages: 2 } }) };
  };
  const result = await fetchEtoroHistory({ apiBaseUrl: "https://public-api.etoro.com/api/v1", apiKey: "public-key", userKey: "user-key", fetchImpl, requestGapMs: 0, pageSize: 1 });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[1].direction, "out");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].path, "/api/v1/trading/info/trade/history?minDate=2015-01-01&page=1&pageSize=1");
  assert.equal(requests.every((request) => request.method === "GET" && request.headers["x-api-key"] === "public-key" && request.headers["x-user-key"] === "user-key"), true);
});
