const crypto = require("node:crypto");

const BINANCE_MAX_IMPORT_ROWS = 2500;
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

function candidateSymbols(account, exchangeInfo) {
  const balances = Array.isArray(account?.balances) ? account.balances : [];
  const owned = new Set(balances.filter((entry) => (numberValue(entry.free) || 0) + (numberValue(entry.locked) || 0) > 0).map((entry) => asset(entry.asset)));
  return (Array.isArray(exchangeInfo?.symbols) ? exchangeInfo.symbols : [])
    .filter((entry) => entry.status === "TRADING" && entry.isSpotTradingAllowed !== false)
    .filter((entry) => owned.has(asset(entry.baseAsset)) && PREFERRED_QUOTES.includes(asset(entry.quoteAsset)))
    .map((entry) => entry.symbol)
    .slice(0, 180);
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
  return { rows: records.slice(0, BINANCE_MAX_IMPORT_ROWS), warnings: [...new Set(warnings)].slice(0, 12), selectedSymbols: marketSymbols, generatedAt: new Date(now).toISOString() };
}

module.exports = { BINANCE_MAX_IMPORT_ROWS, signedQuery, signedUrl, normalizeSpotTrade, normalizeDeposit, normalizeWithdrawal, normalizeDividend, parseSymbols, candidateSymbols, fetchBinanceHistory };
