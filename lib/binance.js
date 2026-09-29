const crypto = require("node:crypto");

const BINANCE_MAX_IMPORT_ROWS = 2500;
// Binance was founded in July 2017.  A historical import starts there unless
// a saved cursor says otherwise; this avoids asking the API for meaningless
// pre-Binance date ranges.
const BINANCE_HISTORY_START = Date.UTC(2017, 6, 14);
const BINANCE_HISTORY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const BINANCE_HISTORY_MIN_WINDOW_MS = 24 * 60 * 60 * 1000;
const BINANCE_HISTORY_PAGE_SIZE = 1000;
const BINANCE_DIVIDEND_PAGE_SIZE = 500;
const FIAT_ASSETS = new Set(["EUR", "USD", "GBP", "CHF", "TRY", "BRL", "AUD", "PLN", "UAH", "RUB"]);
const PREFERRED_QUOTES = ["EUR", "USDT", "USDC", "FDUSD", "BUSD", "BTC", "ETH", "BNB"];

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asset(value) {
  const symbol = String(value || "").trim().toUpperCase();
  return symbol === "XBT" ? "BTC" : symbol;
}

function isoTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (/^\d{11,}$/.test(text)) {
    const date = new Date(Number(text));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  // Binance returns millisecond timestamps on some endpoints and UTC strings
  // such as "2024-01-01 12:34:56" on others.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function queryString(params = {}) {
  return new URLSearchParams(Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, String(value)])).toString();
}

function signedQuery({ apiSecret, params = {} }) {
  const query = queryString(params);
  return { query, signature: crypto.createHmac("sha256", String(apiSecret || "")).update(query).digest("hex") };
}

function signedUrl(apiBaseUrl, pathname, { apiSecret, params = {} }) {
  const url = new URL(pathname, `${String(apiBaseUrl || "https://api.binance.com").replace(/\/$/, "")}/`);
  const { query, signature } = signedQuery({ apiSecret, params });
  url.search = query ? `${query}&signature=${signature}` : `signature=${signature}`;
  return url;
}

async function signedGet({ apiBaseUrl, apiKey, apiSecret, pathname, params, fetchImpl = fetch }) {
  const url = signedUrl(apiBaseUrl, pathname, { apiSecret, params });
  const response = await fetchImpl(url, { method: "GET", headers: { "X-MBX-APIKEY": apiKey, Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.msg || payload?.message || payload?.error || `Binance antwortet mit HTTP ${response.status}.`));
  return payload;
}

async function publicGet({ apiBaseUrl, pathname, fetchImpl = fetch }) {
  const url = new URL(pathname, `${String(apiBaseUrl || "https://api.binance.com").replace(/\/$/, "")}/`);
  const response = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.msg || payload?.message || payload?.error || `Binance antwortet mit HTTP ${response.status}.`));
  return payload;
}

function normalizeSpotTrade(trade, symbolInfo) {
  const base = asset(symbolInfo?.baseAsset);
  const quote = asset(symbolInfo?.quoteAsset);
  const quantity = numberValue(trade?.qty);
  const quoteQuantity = numberValue(trade?.quoteQty);
  const timestamp = isoTimestamp(trade?.time);
  const id = String(trade?.id ?? "");
  if (!base || !quote || !quantity || quantity <= 0 || !quoteQuantity || quoteQuantity <= 0 || !timestamp || !id) return [];
  const buyer = Boolean(trade.isBuyer);
  const priceEur = quote === "EUR" ? quoteQuantity / quantity : null;
  const rows = [{
    externalId: `binance:spot:${symbolInfo.symbol}:${id}:base`, hash: `binance:${symbolInfo.symbol}:${id}`, timestamp,
    direction: buyer ? "in" : "out", asset: base, amount: quantity,
    fee: 0, feeAsset: base, priceEur, purpose: buyer ? "Kauf" : "Verkauf", counterparty: `Binance Spot · ${symbolInfo.symbol}`, raw: trade,
  }];
  // Fiat legs never become a crypto holding. Crypto and stablecoin legs remain
  // visible, so a crypto-to-crypto trade does not silently lose its counter-leg.
  if (!FIAT_ASSETS.has(quote)) {
    rows.push({
      externalId: `binance:spot:${symbolInfo.symbol}:${id}:quote`, hash: `binance:${symbolInfo.symbol}:${id}`, timestamp,
      direction: buyer ? "out" : "in", asset: quote, amount: quoteQuantity, fee: 0, feeAsset: quote,
      priceEur: null, purpose: buyer ? "Verkauf" : "Kauf", counterparty: `Binance Spot · ${symbolInfo.symbol}`, raw: trade,
    });
  }
  const commission = numberValue(trade.commission) || 0;
  const commissionAsset = asset(trade.commissionAsset);
  if (commission > 0 && commissionAsset) {
    rows.push({
      externalId: `binance:spot:${symbolInfo.symbol}:${id}:fee:${commissionAsset}`, hash: `binance:${symbolInfo.symbol}:${id}`, timestamp,
      direction: "out", asset: commissionAsset, amount: commission, fee: 0, feeAsset: commissionAsset,
      priceEur: null, purpose: "Gebühr", counterparty: `Binance Spot · ${symbolInfo.symbol}`, raw: trade,
    });
  }
  return rows;
}

function normalizeDeposit(item) {
  const coin = asset(item?.coin);
  const amount = numberValue(item?.amount);
  const timestampValue = item?.completeTime || item?.insertTime;
  const timestamp = isoTimestamp(timestampValue);
  const id = String(item?.id || item?.txId || "");
  if (!coin || !amount || amount <= 0 || !timestamp || !id) return null;
  return { externalId: `binance:deposit:${id}:${coin}`, hash: String(item.txId || id), timestamp, direction: "in", asset: coin, amount, fee: 0, feeAsset: coin, priceEur: null, purpose: "Transfer", counterparty: item.address || "Binance Einzahlung", raw: item };
}

function normalizeWithdrawal(item) {
  const coin = asset(item?.coin);
  const amount = numberValue(item?.amount);
  const timestampValue = item?.completeTime || item?.applyTime || item?.applyTimeStamp;
  const timestamp = isoTimestamp(timestampValue);
  const id = String(item?.id || item?.withdrawOrderId || item?.txId || "");
  if (!coin || !amount || amount <= 0 || !timestamp || !id) return null;
  return { externalId: `binance:withdrawal:${id}:${coin}`, hash: String(item.txId || id), timestamp, direction: "out", asset: coin, amount, fee: numberValue(item.transactionFee) || 0, feeAsset: coin, priceEur: null, purpose: "Transfer", counterparty: item.address || "Binance Auszahlung", raw: item };
}

function normalizeDividend(item) {
  const coin = asset(item?.asset);
  const amount = numberValue(item?.amount);
  const timestamp = isoTimestamp(item?.divTime);
  const id = String(item?.id || item?.tranId || "");
  if (!coin || !amount || amount <= 0 || !timestamp || !id) return null;
  const description = String(item.enInfo || item.type || "");
  const purpose = /staking|earn|locked|flexible|launchpool/i.test(description) ? "Staking Rewards" : "Sonstiges";
  return { externalId: `binance:dividend:${id}:${coin}`, hash: `binance:${id}`, timestamp, direction: "in", asset: coin, amount, fee: 0, feeAsset: coin, priceEur: null, purpose, counterparty: description || "Binance Ausschüttung", raw: item };
}

function parseSymbols(value) {
  return [...new Set(String(value || "").toUpperCase().split(/[\s,;]+/).map((symbol) => symbol.replace(/[^A-Z0-9]/g, "")).filter((symbol) => /^[A-Z0-9]{5,24}$/.test(symbol)))].slice(0, 180);
}

function normalizeAccountBalances(account) {
  const balances = Array.isArray(account?.balances) ? account.balances : [];
  const normalized = new Map();
  for (const entry of balances) {
    const free = numberValue(entry?.free) || 0;
    const locked = numberValue(entry?.locked) || 0;
    const assetId = asset(entry?.asset);
    if (!assetId || !Number.isFinite(free) || !Number.isFinite(locked)) continue;
    const previous = normalized.get(assetId) || { asset: assetId, free: 0, locked: 0 };
    normalized.set(assetId, { asset: assetId, free: previous.free + free, locked: previous.locked + locked });
  }
  return [...normalized.values()].map((entry) => ({ ...entry, total: entry.free + entry.locked }))
    .filter((entry) => entry.total > 0)
    .sort((left, right) => left.asset.localeCompare(right.asset));
}

function candidateSymbols(account, exchangeInfo, knownAssets = []) {
  const owned = new Set([
    ...normalizeAccountBalances(account).map((entry) => entry.asset),
    ...knownAssets.map(asset).filter(Boolean),
  ]);
  return (Array.isArray(exchangeInfo?.symbols) ? exchangeInfo.symbols : [])
    // Historical trade data can remain available for a paused market.  Do
    // not filter it out simply because it is not tradeable today.
    .filter((entry) => entry.isSpotTradingAllowed !== false)
    .filter((entry) => owned.has(asset(entry.baseAsset)) && PREFERRED_QUOTES.includes(asset(entry.quoteAsset)))
    .map((entry) => entry.symbol)
    .slice(0, 180);
}

function inferredMarketInfo(symbol, knownAssets = []) {
  const normalized = String(symbol || "").trim().toUpperCase();
  const known = new Set(knownAssets.map(asset).filter(Boolean));
  for (const quote of [...PREFERRED_QUOTES].sort((left, right) => right.length - left.length)) {
    if (!normalized.endsWith(quote) || normalized.length <= quote.length) continue;
    const baseAsset = asset(normalized.slice(0, -quote.length));
    if (!baseAsset || (known.size && !known.has(baseAsset))) continue;
    return { symbol: normalized, baseAsset, quoteAsset: quote, isSpotTradingAllowed: true, inferred: true };
  }
  return null;
}

function marketInfoForSymbol(symbol, symbolByName, knownAssets = []) {
  const normalized = String(symbol || "").trim().toUpperCase();
  const market = symbolByName?.get(normalized);
  if (market) return market;
  return inferredMarketInfo(normalized, knownAssets);
}

async function fetchBinanceAccountBalances({ apiBaseUrl, apiKey, apiSecret, fetchImpl = fetch, now = Date.now() }) {
  const account = await signedGet({
    apiBaseUrl,
    apiKey,
    apiSecret,
    pathname: "/api/v3/account",
    params: { timestamp: now, recvWindow: 5000 },
    fetchImpl,
  });
  return { balances: normalizeAccountBalances(account), updatedAt: isoTimestamp(account?.updateTime) || new Date(now).toISOString() };
}

function milliseconds(value, fallback) {
  const parsed = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeHistoryInput(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function uniqueWarnings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 12);
}

function normalizeBinanceHistoryState(value, now = Date.now()) {
  const input = safeHistoryInput(value);
  const endAt = Math.max(BINANCE_HISTORY_START, milliseconds(input.endAt, now));
  const startAt = Math.min(endAt, Math.max(BINANCE_HISTORY_START, milliseconds(input.startAt, BINANCE_HISTORY_START)));
  const phases = new Set(["deposits", "withdrawals", "dividends", "trades", "complete"]);
  const phase = phases.has(input.phase) ? input.phase : "deposits";
  const cursorAt = Math.min(endAt + 1, Math.max(startAt, milliseconds(input.cursorAt, startAt)));
  const symbols = parseSymbols(Array.isArray(input.symbols) ? input.symbols.join(",") : input.symbols);
  const symbolsSet = new Set(symbols);
  const markets = (Array.isArray(input.markets) ? input.markets : [])
    .map((market) => ({
      symbol: String(market?.symbol || "").toUpperCase(),
      baseAsset: asset(market?.baseAsset),
      quoteAsset: asset(market?.quoteAsset),
      isSpotTradingAllowed: market?.isSpotTradingAllowed !== false,
    }))
    .filter((market) => symbolsSet.has(market.symbol) && market.baseAsset && market.quoteAsset)
    .slice(0, 180);
  const symbolIndex = Math.min(symbols.length, Math.max(0, Math.floor(Number(input.symbolIndex) || 0)));
  const fromId = Math.max(0, Math.floor(Number(input.fromId) || 0));
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
  const windowMs = Math.min(BINANCE_HISTORY_WINDOW_MS, Math.max(BINANCE_HISTORY_MIN_WINDOW_MS, Math.floor(Number(input.windowMs) || BINANCE_HISTORY_WINDOW_MS)));
  const unresolvedSymbols = parseSymbols(Array.isArray(input.unresolvedSymbols) ? input.unresolvedSymbols.join(",") : input.unresolvedSymbols);
  return {
    version: 1,
    phase,
    startAt,
    endAt,
    cursorAt,
    offset,
    windowMs,
    symbols,
    markets,
    symbolIndex,
    fromId,
    warnings: uniqueWarnings(Array.isArray(input.warnings) ? input.warnings : []),
    unresolvedSymbols,
  };
}

function historyProgress(value, now = Date.now()) {
  const state = normalizeBinanceHistoryState(value, now);
  const phaseOrder = ["deposits", "withdrawals", "dividends", "trades", "complete"];
  const phaseIndex = phaseOrder.indexOf(state.phase);
  if (state.phase === "complete") return { current: 400, total: 400, phase: "complete" };
  const timeFraction = state.endAt > state.startAt ? (state.cursorAt - state.startAt) / (state.endAt - state.startAt) : 1;
  const fraction = state.phase === "trades"
    ? (state.symbols.length ? state.symbolIndex / state.symbols.length : 1)
    : Math.min(1, Math.max(0, timeFraction));
  return { current: Math.min(399, Math.max(0, Math.round((Math.max(0, phaseIndex) + fraction) * 100))), total: 400, phase: state.phase };
}

function historyPhaseLabel(phase) {
  return ({
    deposits: "Einzahlungen", withdrawals: "Auszahlungen", dividends: "Erträge", trades: "Spot-Trades", complete: "vollständig",
  })[phase] || "Historie";
}

function historyWindow(state) {
  const endAt = Math.min(state.endAt, state.cursorAt + state.windowMs - 1);
  return { startTime: state.cursorAt, endTime: endAt };
}

function advanceHistoryWindow(state, nextPhase) {
  const { endTime } = historyWindow(state);
  if (endTime < state.endAt) return { ...state, cursorAt: endTime + 1, offset: 0, windowMs: BINANCE_HISTORY_WINDOW_MS };
  return {
    ...state,
    phase: nextPhase,
    cursorAt: state.startAt,
    offset: 0,
    windowMs: BINANCE_HISTORY_WINDOW_MS,
  };
}

function withHistoryWarnings(state, warnings) {
  return { ...state, warnings: uniqueWarnings([...(state.warnings || []), ...(warnings || [])]) };
}

function withUnresolvedSymbol(state, symbol) {
  return { ...state, unresolvedSymbols: parseSymbols([...(state.unresolvedSymbols || []), symbol].join(",")) };
}

function isUnavailableMarketError(error) {
  return /invalid symbol|unknown symbol|symbol .*not found|market .*not found|not available/i.test(String(error?.message || error || ""));
}

async function pause(millisecondsToWait) {
  if (millisecondsToWait > 0) await new Promise((resolve) => setTimeout(resolve, millisecondsToWait));
}

// Imports one bounded, serial part of the Binance account history.  The
// caller persists nextState and queues the following part, which means a
// restart never replays an unbounded account history or creates request fans.
async function fetchBinanceHistoryBatch({
  apiBaseUrl,
  apiKey,
  apiSecret,
  symbols = "",
  knownAssets = [],
  state: savedState,
  fetchImpl = fetch,
  now = Date.now(),
  requestGapMs = 180,
}) {
  const state = normalizeBinanceHistoryState(savedState, now);
  const requestedSymbolSet = new Set(parseSymbols(symbols));
  const warnings = [];
  let accountBalances = null;
  const signed = async (pathname, extra = {}) => {
    try {
      return await signedGet({
        apiBaseUrl, apiKey, apiSecret, pathname,
        params: { ...extra, timestamp: Date.now(), recvWindow: 5000 }, fetchImpl,
      });
    } finally {
      await pause(requestGapMs);
    }
  };
  const finish = (rows, nextState, extraWarnings = []) => {
    const storedState = withHistoryWarnings(nextState, [...warnings, ...extraWarnings]);
    return {
      rows: rows.slice(0, BINANCE_MAX_IMPORT_ROWS),
      warnings: storedState.warnings,
      nextState: storedState,
      complete: storedState.phase === "complete" && storedState.unresolvedSymbols.length === 0,
      settled: storedState.phase === "complete",
      selectedSymbols: storedState.symbols,
      progress: historyProgress(storedState, now),
      generatedAt: new Date(now).toISOString(),
      accountBalances,
    };
  };

  if (state.phase === "complete") return finish([], state);

  if (state.phase === "deposits" || state.phase === "withdrawals") {
    const endpoint = state.phase === "deposits" ? "/sapi/v1/capital/deposit/hisrec" : "/sapi/v1/capital/withdraw/history";
    const nextPhase = state.phase === "deposits" ? "withdrawals" : "dividends";
    const payload = await signed(endpoint, { ...historyWindow(state), offset: state.offset, limit: BINANCE_HISTORY_PAGE_SIZE });
    const sourceRows = Array.isArray(payload) ? payload : [];
    const rows = sourceRows.map(state.phase === "deposits" ? normalizeDeposit : normalizeWithdrawal).filter(Boolean);
    const nextState = sourceRows.length >= BINANCE_HISTORY_PAGE_SIZE
      ? { ...state, offset: state.offset + sourceRows.length }
      : advanceHistoryWindow(state, nextPhase);
    return finish(rows, nextState);
  }

  if (state.phase === "dividends") {
    const window = historyWindow(state);
    const payload = await signed("/sapi/v1/asset/assetDividend", { ...window, limit: BINANCE_DIVIDEND_PAGE_SIZE });
    const sourceRows = Array.isArray(payload?.rows) ? payload.rows : [];
    const total = Number(payload?.total);
    // This endpoint does not offer a documented offset.  When a 90-day range
    // is full, shrink it before importing so older rewards are not skipped.
    if (Number.isFinite(total) && total > sourceRows.length && state.windowMs > BINANCE_HISTORY_MIN_WINDOW_MS) {
      return finish([], { ...state, windowMs: Math.max(BINANCE_HISTORY_MIN_WINDOW_MS, Math.floor(state.windowMs / 2)) });
    }
    const rows = sourceRows.map(normalizeDividend).filter(Boolean);
    const extraWarnings = Number.isFinite(total) && total > sourceRows.length
      ? ["Binance hat mehr als 500 Erträge für einen einzelnen Tag geliefert. Bitte ergänze diese Ausnahme über den Binance-CSV-Export."]
      : [];
    return finish(rows, advanceHistoryWindow(state, "trades"), extraWarnings);
  }

  if (state.phase === "trades") {
    let nextState = state;
    let symbolByName = null;
    if (!nextState.symbols.length) {
      const account = await signed("/api/v3/account");
      accountBalances = normalizeAccountBalances(account);
      let exchangeInfo;
      try {
        exchangeInfo = await publicGet({ apiBaseUrl, pathname: "/api/v3/exchangeInfo", fetchImpl });
      } finally {
        await pause(requestGapMs);
      }
      symbolByName = new Map((Array.isArray(exchangeInfo?.symbols) ? exchangeInfo.symbols : []).map((entry) => [entry.symbol, entry]));
      const automaticSymbols = candidateSymbols(account, exchangeInfo, knownAssets);
      const requestedSymbols = parseSymbols(symbols);
      const selected = [...new Set([...requestedSymbols, ...automaticSymbols])].slice(0, 180);
      const knownMarketAssets = [...knownAssets, ...accountBalances.map((entry) => entry.asset)];
      const marketEntries = selected.map((marketSymbol) => marketInfoForSymbol(
        marketSymbol,
        symbolByName,
        requestedSymbolSet.has(marketSymbol) ? [] : knownMarketAssets,
      )).filter(Boolean);
      nextState = {
        ...nextState,
        symbols: selected,
        markets: marketEntries.map((market) => ({
          symbol: market.symbol, baseAsset: market.baseAsset, quoteAsset: market.quoteAsset, isSpotTradingAllowed: market.isSpotTradingAllowed !== false,
        })),
        symbolIndex: 0,
        fromId: 0,
      };
      if (!nextState.symbols.length) {
        return finish([], { ...nextState, phase: "complete" }, ["Keine Binance-Spot-Märkte automatisch erkannt. Für vollständig bereits verkaufte Assets ergänze die früheren Spot-Märkte in der Verbindung."]);
      }
    }
    if (nextState.symbolIndex >= nextState.symbols.length) return finish([], { ...nextState, phase: "complete" });
    const symbol = nextState.symbols[nextState.symbolIndex];
    if (!symbolByName && nextState.markets?.length) symbolByName = new Map(nextState.markets.map((market) => [market.symbol, market]));
    if (!symbolByName) {
      const exchangeInfo = await publicGet({ apiBaseUrl, pathname: "/api/v3/exchangeInfo", fetchImpl });
      await pause(requestGapMs);
      symbolByName = new Map((Array.isArray(exchangeInfo?.symbols) ? exchangeInfo.symbols : []).map((entry) => [entry.symbol, entry]));
      nextState = {
        ...nextState,
        markets: nextState.symbols.map((marketSymbol) => symbolByName.get(marketSymbol)).filter(Boolean).map((market) => ({
          symbol: market.symbol, baseAsset: market.baseAsset, quoteAsset: market.quoteAsset, isSpotTradingAllowed: market.isSpotTradingAllowed !== false,
        })),
      };
    }
    const info = marketInfoForSymbol(symbol, symbolByName, requestedSymbolSet.has(symbol) ? [] : knownAssets);
    if (!info || info.isSpotTradingAllowed === false) {
      const followingState = withUnresolvedSymbol({ ...nextState, symbolIndex: nextState.symbolIndex + 1, fromId: 0 }, symbol);
      return finish([], followingState.symbolIndex >= followingState.symbols.length ? { ...followingState, phase: "complete" } : followingState, [`Historischer Binance-Markt ist nicht auflösbar: ${symbol}. Bitte den vollständigen Binance-CSV-Export ergänzen.`]);
    }
    let trades;
    try {
      trades = await signed("/api/v3/myTrades", { symbol, fromId: nextState.fromId, limit: BINANCE_HISTORY_PAGE_SIZE });
    } catch (error) {
      if (!isUnavailableMarketError(error)) throw error;
      const followingState = withUnresolvedSymbol({ ...nextState, symbolIndex: nextState.symbolIndex + 1, fromId: 0 }, symbol);
      return finish([], followingState.symbolIndex >= followingState.symbols.length ? { ...followingState, phase: "complete" } : followingState, [`Binance stellt historische Trades für ${symbol} nicht per API bereit. Bitte den vollständigen Binance-CSV-Export ergänzen.`]);
    }
    const sourceRows = Array.isArray(trades) ? trades : [];
    const rows = [];
    let lastId = nextState.fromId - 1;
    let consumed = 0;
    for (const trade of sourceRows) {
      const normalized = normalizeSpotTrade(trade, info);
      if (rows.length + normalized.length > BINANCE_MAX_IMPORT_ROWS) break;
      rows.push(...normalized);
      const id = Number(trade?.id);
      if (Number.isSafeInteger(id) && id >= 0) lastId = id;
      consumed += 1;
    }
    if (sourceRows.length && lastId < nextState.fromId) {
      return finish(rows, withUnresolvedSymbol({ ...nextState, phase: "complete" }, symbol), [`Binance lieferte für ${symbol} keine verwertbare Trade-ID; der Markt wurde aus Sicherheitsgründen nicht weiter paginiert.`]);
    }
    const moreForSymbol = consumed < sourceRows.length || sourceRows.length >= BINANCE_HISTORY_PAGE_SIZE;
    const followingState = moreForSymbol
      ? { ...nextState, fromId: lastId + 1 }
      : { ...nextState, symbolIndex: nextState.symbolIndex + 1, fromId: 0 };
    return finish(rows, followingState.symbolIndex >= followingState.symbols.length && !moreForSymbol ? { ...followingState, phase: "complete" } : followingState);
  }

  return finish([], { ...state, phase: "complete" });
}

async function fetchBinanceHistory({ apiBaseUrl, apiKey, apiSecret, symbols = "", fetchImpl = fetch, now = Date.now(), requestGapMs = 180 }) {
  const timestamp = () => Date.now();
  const signed = (pathname, extra = {}) => signedGet({ apiBaseUrl, apiKey, apiSecret, pathname, params: { ...extra, timestamp: timestamp(), recvWindow: 5000 }, fetchImpl });
  const warnings = [];
  const request = async (pathname, extra) => {
    try { return await signed(pathname, extra); } catch (error) { warnings.push(error.message); return null; } finally { if (requestGapMs) await new Promise((resolve) => setTimeout(resolve, requestGapMs)); }
  };
  // Binance uses request weights. Keep the adapter deliberately serial so a
  // full history sync cannot create parallel bursts against the account API.
  const account = await request("/api/v3/account");
  const accountBalances = account ? normalizeAccountBalances(account) : null;
  let exchangeInfo = null;
  try {
    // This is public market metadata, so it must neither receive account
    // credentials nor contribute to the signed-request permission surface.
    exchangeInfo = await publicGet({ apiBaseUrl, pathname: "/api/v3/exchangeInfo", fetchImpl });
  } catch (error) {
    warnings.push(error.message);
  }
  if (requestGapMs) await new Promise((resolve) => setTimeout(resolve, requestGapMs));
  const deposits = await request("/sapi/v1/capital/deposit/hisrec", { limit: 1000 });
  const withdrawals = await request("/sapi/v1/capital/withdraw/history", { limit: 1000 });
  const dividends = await request("/sapi/v1/asset/assetDividend", { limit: 500 });
  const selectedSymbols = parseSymbols(symbols);
  const marketSymbols = selectedSymbols.length ? selectedSymbols : candidateSymbols(account, exchangeInfo);
  if (!marketSymbols.length) warnings.push("Keine Spot-Märkte automatisch erkannt. Für historische, bereits verkaufte Assets bitte die Märkte in der Verbindung ergänzen (z. B. BTCUSDT, ETHEUR).");
  const symbolByName = new Map((Array.isArray(exchangeInfo?.symbols) ? exchangeInfo.symbols : []).map((entry) => [entry.symbol, entry]));
  const records = [
    ...(Array.isArray(deposits) ? deposits.map(normalizeDeposit).filter(Boolean) : []),
    ...(Array.isArray(withdrawals) ? withdrawals.map(normalizeWithdrawal).filter(Boolean) : []),
    ...(Array.isArray(dividends?.rows) ? dividends.rows.map(normalizeDividend).filter(Boolean) : []),
  ];
  for (const symbol of marketSymbols) {
    if (records.length >= BINANCE_MAX_IMPORT_ROWS) break;
    const info = symbolByName.get(symbol);
    if (!info) { warnings.push(`Unbekannter Binance-Markt: ${symbol}`); continue; }
    const trades = await request("/api/v3/myTrades", { symbol, limit: 1000 });
    if (!Array.isArray(trades)) continue;
    for (const trade of trades) {
      records.push(...normalizeSpotTrade(trade, info));
      if (records.length >= BINANCE_MAX_IMPORT_ROWS) break;
    }
  }
  return { rows: records.slice(0, BINANCE_MAX_IMPORT_ROWS), warnings: [...new Set(warnings)].slice(0, 12), selectedSymbols: marketSymbols, generatedAt: new Date(now).toISOString(), accountBalances };
}

module.exports = {
  BINANCE_MAX_IMPORT_ROWS,
  BINANCE_HISTORY_START,
  signedQuery,
  signedUrl,
  normalizeSpotTrade,
  normalizeDeposit,
  normalizeWithdrawal,
  normalizeDividend,
  normalizeAccountBalances,
  parseSymbols,
  candidateSymbols,
  inferredMarketInfo,
  marketInfoForSymbol,
  normalizeBinanceHistoryState,
  historyProgress,
  historyPhaseLabel,
  fetchBinanceAccountBalances,
  fetchBinanceHistory,
  fetchBinanceHistoryBatch,
};
