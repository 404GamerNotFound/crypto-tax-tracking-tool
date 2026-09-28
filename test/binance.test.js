const test = require("node:test");
const assert = require("node:assert/strict");
const {
  signedQuery, signedUrl, normalizeSpotTrade, normalizeDeposit, normalizeWithdrawal,
  normalizeDividend, parseSymbols, candidateSymbols, normalizeBinanceHistoryState,
  historyProgress, fetchBinanceHistory, fetchBinanceHistoryBatch,
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
  assert.deepEqual(candidateSymbols({ balances: [] }, { symbols: [
    { symbol: "ETHEUR", status: "TRADING", isSpotTradingAllowed: true, baseAsset: "ETH", quoteAsset: "EUR" },
  ] }, ["ETH"]), ["ETHEUR"]);
});

test("normalisiert den fortsetzbaren Binance-Historienfortschritt", () => {
  const now = Date.UTC(2025, 0, 1);
  const state = normalizeBinanceHistoryState({ phase: "trades", startAt: Date.UTC(2020, 0, 1), endAt: now, symbols: ["btceur"], symbolIndex: 0, fromId: 42 }, now);
  assert.deepEqual({ phase: state.phase, symbols: state.symbols, fromId: state.fromId }, { phase: "trades", symbols: ["BTCEUR"], fromId: 42 });
  const progress = historyProgress(state, now);
  assert.equal(progress.total, 400);
  assert.equal(progress.phase, "trades");
});

test("holt Binance-Einzahlungen in einem zeitlich begrenzten und fortsetzbaren Fenster", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const requestUrl = new URL(url);
    calls.push(requestUrl);
    const deposit = { id: "d-1", txId: "tx-1", coin: "BTC", amount: "0.1", insertTime: Date.UTC(2020, 0, 1), address: "bc1example" };
    return { ok: true, json: async () => requestUrl.pathname === "/sapi/v1/capital/deposit/hisrec" ? [deposit] : {} };
  };
  const result = await fetchBinanceHistoryBatch({
    apiBaseUrl: "https://api.binance.com", apiKey: "public-key", apiSecret: "secret", fetchImpl, requestGapMs: 0,
    now: Date.UTC(2020, 0, 2), state: { phase: "deposits", startAt: Date.UTC(2020, 0, 1), endAt: Date.UTC(2020, 0, 1) },
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.nextState.phase, "withdrawals");
  assert.equal(calls[0].searchParams.get("startTime"), String(Date.UTC(2020, 0, 1)));
  assert.equal(calls[0].searchParams.get("offset"), "0");
});

test("paginiert Binance-Spot-Trades ab der gespeicherten Trade-ID", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const requestUrl = new URL(url);
    calls.push(requestUrl);
    if (requestUrl.pathname === "/api/v3/exchangeInfo") return { ok: true, json: async () => ({ symbols: [{ symbol: "BTCEUR", status: "TRADING", isSpotTradingAllowed: true, baseAsset: "BTC", quoteAsset: "EUR" }] }) };
    if (requestUrl.pathname === "/api/v3/myTrades") return { ok: true, json: async () => [{ id: 7, time: Date.UTC(2020, 0, 1), isBuyer: true, qty: "0.1", quoteQty: "800", commission: "0", commissionAsset: "BTC" }] };
    throw new Error(`Unexpected ${requestUrl.pathname}`);
  };
  const result = await fetchBinanceHistoryBatch({
    apiBaseUrl: "https://api.binance.com", apiKey: "public-key", apiSecret: "secret", fetchImpl, requestGapMs: 0,
    state: { phase: "trades", startAt: Date.UTC(2020, 0, 1), endAt: Date.UTC(2020, 0, 2), symbols: ["BTCEUR"], symbolIndex: 0, fromId: 0 },
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.complete, true);
  assert.equal(calls.find((call) => call.pathname === "/api/v3/myTrades").searchParams.get("fromId"), "0");
});

test("verwendet für folgende Trade-Seiten gespeicherte Marktmetadaten", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const requestUrl = new URL(url);
    calls.push(requestUrl.pathname);
    if (requestUrl.pathname === "/api/v3/myTrades") return { ok: true, json: async () => [] };
    throw new Error(`Unexpected ${requestUrl.pathname}`);
  };
  const result = await fetchBinanceHistoryBatch({
    apiBaseUrl: "https://api.binance.com", apiKey: "public-key", apiSecret: "secret", fetchImpl, requestGapMs: 0,
    state: {
      phase: "trades", startAt: Date.UTC(2020, 0, 1), endAt: Date.UTC(2020, 0, 2), symbols: ["BTCEUR"],
      markets: [{ symbol: "BTCEUR", baseAsset: "BTC", quoteAsset: "EUR" }], symbolIndex: 0, fromId: 8,
    },
  });
  assert.equal(result.complete, true);
  assert.deepEqual(calls, ["/api/v3/myTrades"]);
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
