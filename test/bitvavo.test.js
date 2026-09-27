const test = require("node:test");
const assert = require("node:assert/strict");
const { signedHeaders, normalizeBitvavoHistoryItem, fetchBitvavoHistory } = require("../lib/bitvavo");

test("signiert Bitvavo-Leseanfragen mit Zeitstempel, GET und vollständigem Pfad", () => {
  const headers = signedHeaders({
    apiKey: "key", apiSecret: "secret", timestamp: 1700000000000,
    path: "/v2/account/history?page=1&maxItems=100",
  });
  assert.equal(headers["Bitvavo-Access-Signature"], "2a995af0be380fc763468069367a7e408e36f6dbe7d2986230dc86896059b986");
  assert.equal(headers["Bitvavo-Access-Key"], "key");
});

test("normalisiert Bitvavo-Kauf und -Auszahlung als einzelne Asset-Bewegung", () => {
  const buy = normalizeBitvavoHistoryItem({
    transactionId: "buy-1", executedAt: "2025-01-01T00:00:00.000Z", type: "buy", priceCurrency: "EUR", priceAmount: "4200",
    receivedCurrency: "BTC", receivedAmount: "0.1", sentCurrency: "EUR", sentAmount: "4200", feesCurrency: "EUR", feesAmount: "1",
  });
  const withdrawal = normalizeBitvavoHistoryItem({
    transactionId: "out-1", executedAt: "2025-01-02T00:00:00.000Z", type: "withdrawal", sentCurrency: "BTC", sentAmount: "0.1", address: "bc1example",
  });
  assert.deepEqual({ direction: buy.direction, purpose: buy.purpose, asset: buy.asset, price: buy.priceEur }, { direction: "in", purpose: "Kauf", asset: "BTC", price: 42000 });
  assert.deepEqual({ direction: withdrawal.direction, purpose: withdrawal.purpose, asset: withdrawal.asset, counterparty: withdrawal.counterparty }, { direction: "out", purpose: "Transfer", asset: "BTC", counterparty: "bc1example" });
});

test("ruft die Bitvavo-Historie seitenweise und begrenzt die Menge", async () => {
  const paths = [];
  const fetchImpl = async (url) => {
    paths.push(`${url.pathname}${url.search}`);
    return { ok: true, json: async () => ({ items: [{ transactionId: "1", executedAt: "2025-01-01T00:00:00Z", type: "deposit", receivedCurrency: "ETH", receivedAmount: "1" }], totalPages: 1 }) };
  };
  const rows = await fetchBitvavoHistory({ apiBaseUrl: "https://api.bitvavo.com/v2", apiKey: "key", apiSecret: "secret", fetchImpl });
  assert.equal(rows.length, 1);
  assert.equal(paths[0], "/v2/account/history?page=1&maxItems=100");
});
