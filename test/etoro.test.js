const test = require("node:test");
const assert = require("node:assert/strict");
const { etoroHeaders, normalizeEtoroTrade, normalizeEtoroHistoricalTrade, historyEndpoint, fetchEtoroHistory } = require("../lib/etoro");

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

test("ordnet abgeschlossene eToro-Krypto-Longs als Kauf und Verkauf zu", () => {
  const result = normalizeEtoroHistoricalTrade({
    orderId: 1001, positionId: 5001, instrumentId: 42, isBuy: true, leverage: 1, units: "0.25",
    openTimestamp: "2025-01-01T12:00:00Z", closeTimestamp: "2025-02-01T12:00:00Z",
  }, { instrumentID: 42, symbolFull: "BTC" });
  assert.equal(result.reason, null);
  assert.deepEqual(result.rows.map((row) => [row.direction, row.purpose, row.asset, row.amount, row.priceEur]), [
    ["in", "Kauf", "BTC", 0.25, null],
    ["out", "Verkauf", "BTC", 0.25, null],
  ]);
  assert.equal(normalizeEtoroHistoricalTrade({
    orderId: 1002, instrumentId: 42, isBuy: false, leverage: 2, units: "0.25",
    openTimestamp: "2025-01-01T12:00:00Z", closeTimestamp: "2025-02-01T12:00:00Z",
  }, { instrumentID: 42, symbolFull: "BTC" }).reason, "non_spot");
});

test("liest eToro-Historie seriell, löst Instrument-IDs auf und verwendet den Demo-Pfad", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ path: `${url.pathname}${url.search}`, method: options.method, headers: options.headers });
    if (url.pathname.endsWith("/market-data/instruments")) {
      const ids = new Set(url.searchParams.get("instrumentIds").split(",").map(Number));
      const items = [{ instrumentID: 42, symbolFull: "BTC" }, { instrumentID: 43, symbolFull: "ETH" }].filter((item) => ids.has(item.instrumentID));
      return { ok: true, status: 200, json: async () => ({ instrumentDisplayDatas: items }) };
    }
    const page = url.searchParams.get("page");
    if (page === "1") return { ok: true, status: 200, json: async () => ({ data: { items: [{ orderId: "1", instrumentId: 42, isBuy: true, leverage: 1, units: "0.1", openTimestamp: "2025-01-01T00:00:00Z", closeTimestamp: "2025-01-02T00:00:00Z" }], totalPages: 2 } }) };
    return { ok: true, status: 200, json: async () => ({ data: { items: [{ orderId: "2", instrumentId: 43, isBuy: true, leverage: 1, units: "0.5", openTimestamp: "2025-01-03T00:00:00Z", closeTimestamp: "2025-01-04T00:00:00Z" }], totalPages: 2 } }) };
  };
  const result = await fetchEtoroHistory({
    apiBaseUrl: "https://public-api.etoro.com/api/v1", apiKey: "public-key", userKey: "user-key", environment: "demo",
    fetchImpl, requestGapMs: 0, pageSize: 1, startDate: "2025-01-01", endDate: "2025-12-31",
  });
  assert.equal(result.rows.length, 4);
  assert.equal(result.rows[1].direction, "out");
  assert.equal(requests.length, 4);
  assert.equal(requests[0].path, "/api/v1/trading/info/trade/demo/history?minDate=2025-01-01&page=1&pageSize=1");
  assert.equal(requests[1].path, "/api/v1/market-data/instruments?instrumentIds=42");
  assert.equal(requests[2].path, "/api/v1/trading/info/trade/demo/history?minDate=2025-01-01&page=2&pageSize=1");
  assert.equal(requests.every((request) => request.method === "GET" && request.headers["x-api-key"] === "public-key" && request.headers["x-user-key"] === "user-key"), true);
});

test("nennt bei einer eToro-Ablehnung die prüfbaren Read-only-Ursachen", async () => {
  await assert.rejects(
    fetchEtoroHistory({
      apiBaseUrl: "https://public-api.etoro.com/api/v1", apiKey: "public-key", userKey: "user-key", requestGapMs: 0,
      startDate: "2025-01-01", endDate: "2025-01-01", fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    }),
    /abgelehnt.*Real\/Demo/i,
  );
  assert.equal(historyEndpoint("real"), "trading/info/trade/history");
  assert.equal(historyEndpoint("demo"), "trading/info/trade/demo/history");
});
