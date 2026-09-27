const test = require("node:test");
const assert = require("node:assert/strict");
const {
  signedQuery, signedUrl, normalizeSpotTrade, normalizeDeposit, normalizeWithdrawal,
  normalizeDividend, parseSymbols, candidateSymbols, fetchBinanceHistory,
} = require("../lib/binance");

test("signiert Binance-USER_DATA-Anfragen deterministisch", () => {
  const result = signedQuery({ apiSecret: "secret", params: { symbol: "BTCEUR", timestamp: 1700000000000, recvWindow: 5000 } });
  assert.equal(result.query, "symbol=BTCEUR&timestamp=1700000000000&recvWindow=5000");
  assert.equal(result.signature, "44ce9cc36f3c0eb01ca66050666130f18359602bb583aeda8ca16d7ce53747a5");
  assert.match(String(signedUrl("https://api.binance.com", "/api/v3/account", { apiSecret: "secret", params: { timestamp: 1 } })), /signature=/);
});

test("mappt einen Binance-Spot-Tausch samt Gegenbuchung und Gebühr", () => {
  const rows = normalizeSpotTrade({ id: 42, time: 1700000000000, isBuyer: true, qty: "0.1", quoteQty: "2500", commission: "0.01", commissionAsset: "BNB" }, { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => [row.direction, row.asset, row.amount, row.purpose]), [
    ["in", "BTC", 0.1, "Kauf"], ["out", "USDT", 2500, "Verkauf"], ["out", "BNB", 0.01, "Gebühr"],
  ]);
});

test("weist auch eine Gebühr im gekauften Asset als eigene Abgangsbuchung aus", () => {
  const rows = normalizeSpotTrade({ id: 43, time: 1700000000000, isBuyer: true, qty: "1", quoteQty: "100", commission: "0.001", commissionAsset: "ETH" }, { symbol: "ETHEUR", baseAsset: "ETH", quoteAsset: "EUR" });
  assert.deepEqual(rows.map((row) => [row.direction, row.asset, row.amount, row.purpose]), [
    ["in", "ETH", 1, "Kauf"], ["out", "ETH", 0.001, "Gebühr"],
  ]);
});

test("mappt Ein- und Auszahlung sowie Earn-Ausschüttungen", () => {
  const deposit = normalizeDeposit({ id: "d1", txId: "chain-d", coin: "ETH", amount: "1", insertTime: 1700000000000, address: "0xabc" });
  const withdrawal = normalizeWithdrawal({ id: "w1", txId: "chain-w", coin: "ETH", amount: "2", transactionFee: "0.01", applyTime: "2023-11-14 22:13:20" });
  const reward = normalizeDividend({ id: "r1", asset: "ADA", amount: "3", divTime: 1700000000000, enInfo: "Simple Earn Flexible Rewards" });
  assert.deepEqual([deposit.direction, deposit.purpose, deposit.counterparty], ["in", "Transfer", "0xabc"]);
  assert.deepEqual([withdrawal.direction, withdrawal.purpose, withdrawal.fee], ["out", "Transfer", 0.01]);
  assert.deepEqual([reward.direction, reward.purpose, reward.asset], ["in", "Staking Rewards", "ADA"]);
});

test("ermittelt Spot-Märkte aus Beständen oder expliziter Eingabe", () => {
  assert.deepEqual(parseSymbols("btc-usdt, ETHEUR; btcusdt invalid!"), ["BTCUSDT", "ETHEUR", "INVALID"]);
  const markets = candidateSymbols({ balances: [{ asset: "BTC", free: "0.1", locked: "0" }, { asset: "ETH", free: "0", locked: "0" }] }, { symbols: [
    { symbol: "BTCUSDT", status: "TRADING", isSpotTradingAllowed: true, baseAsset: "BTC", quoteAsset: "USDT" },
    { symbol: "BTCDAI", status: "TRADING", isSpotTradingAllowed: true, baseAsset: "BTC", quoteAsset: "DAI" },
  ] });
  assert.deepEqual(markets, ["BTCUSDT"]);
});

test("holt Binance-Daten seriell und hält öffentliche Metadaten von signierten Aufrufen getrennt", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const requestUrl = new URL(url);
    calls.push({ path: requestUrl.pathname, query: requestUrl.searchParams, apiKey: options.headers["X-MBX-APIKEY"] });
    const responses = {
      "/api/v3/account": { balances: [{ asset: "BTC", free: "0.1", locked: "0" }] },
      "/api/v3/exchangeInfo": { symbols: [{ symbol: "BTCUSDT", status: "TRADING", isSpotTradingAllowed: true, baseAsset: "BTC", quoteAsset: "USDT" }] },
      "/sapi/v1/capital/deposit/hisrec": [],
      "/sapi/v1/capital/withdraw/history": [],
      "/sapi/v1/asset/assetDividend": { rows: [] },
      "/api/v3/myTrades": [{ id: 1, time: 1700000000000, isBuyer: true, qty: "0.1", quoteQty: "2500", commission: "0", commissionAsset: "BTC" }],
    };
    return { ok: true, json: async () => responses[requestUrl.pathname] };
  };
  const result = await fetchBinanceHistory({ apiBaseUrl: "https://api.binance.com", apiKey: "public-key", apiSecret: "secret", fetchImpl, requestGapMs: 0 });
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.selectedSymbols, ["BTCUSDT"]);
  const marketInfo = calls.find((call) => call.path === "/api/v3/exchangeInfo");
  assert.equal(marketInfo.apiKey, undefined);
  assert.equal(marketInfo.query.has("signature"), false);
  assert.equal(calls.filter((call) => call.path !== "/api/v3/exchangeInfo").every((call) => call.apiKey === "public-key" && call.query.has("signature")), true);
});
