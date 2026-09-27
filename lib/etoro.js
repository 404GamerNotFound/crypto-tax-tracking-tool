const crypto = require("node:crypto");

const ETORO_HISTORY_LIMIT = 2500;
const ETORO_PAGE_SIZE = 100;
const ETORO_REQUEST_GAP_MS = 1100;

const CRYPTO_ALIASES = Object.freeze({
  BITCOIN: "BTC", BTC: "BTC", XBT: "BTC",
  ETHEREUM: "ETH", ETH: "ETH",
  CARDANO: "ADA", ADA: "ADA",
  SOLANA: "SOL", SOL: "SOL", RIPPLE: "XRP", XRP: "XRP",
  DOGECOIN: "DOGE", DOGE: "DOGE", LITECOIN: "LTC", LTC: "LTC",
  BITCOINCASH: "BCH", BCH: "BCH", STELLAR: "XLM", XLM: "XLM",
  CHAINLINK: "LINK", LINK: "LINK", AVALANCHE: "AVAX", AVAX: "AVAX",
  POLKADOT: "DOT", DOT: "DOT", UNISWAP: "UNI", UNI: "UNI",
  POLYGON: "POL", MATIC: "POL", POL: "POL", COSMOS: "ATOM", ATOM: "ATOM",
  TEZOS: "XTZ", XTZ: "XTZ", TRON: "TRX", TRX: "TRX", NEAR: "NEAR",
  APTOS: "APT", APT: "APT", ARBITRUM: "ARB", ARB: "ARB", SUI: "SUI",
  CELO: "CELO", CELO: "CELO", ALGORAND: "ALGO", ALGO: "ALGO",
  FILECOIN: "FIL", FIL: "FIL", AAVE: "AAVE", MAKER: "MKR", MKR: "MKR",
  BITCOINUSD: "BTC", ETHEREUMUSD: "ETH", CARDANOUSD: "ADA", SOLANAUSD: "SOL",
  BTCUSD: "BTC", ETHUSD: "ETH", ADAUSD: "ADA", SOLUSD: "SOL", XRPUSD: "XRP",
});

function etoroHeaders({ apiKey, userKey, requestId = crypto.randomUUID() }) {
  return {
    "x-api-key": String(apiKey || ""),
    "x-user-key": String(userKey || ""),
    "x-request-id": requestId,
    Accept: "application/json",
  };
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function valueAt(entry, paths) {
  for (const path of paths) {
    let value = entry;
    for (const key of path.split(".")) value = value && value[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function cryptoAsset(entry) {
  const candidates = [
    valueAt(entry, ["instrument.symbolName", "instrument.symbol", "instrumentName", "symbolName", "symbol", "asset", "instrument"]),
  ];
  for (const candidate of candidates) {
    const compact = String(candidate || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!compact) continue;
    if (CRYPTO_ALIASES[compact]) return CRYPTO_ALIASES[compact];
    for (const quote of ["USDT", "USDC", "USD", "EUR"]) {
      if (compact.endsWith(quote) && CRYPTO_ALIASES[compact.slice(0, -quote.length)]) return CRYPTO_ALIASES[compact.slice(0, -quote.length)];
    }
  }
  return null;
}

function isCryptoEntry(entry, asset) {
  const classification = ["assetClass", "assetType", "instrumentType", "marketType", "category", "instrument.assetClass", "instrument.type"]
    .map((path) => String(valueAt(entry, [path]) || "")).join(" ").toLowerCase();
  return /crypto|cryptocurrency|digital.?asset/.test(classification) || Boolean(asset);
}

function normalizeEtoroTrade(entry) {
  const asset = cryptoAsset(entry);
  if (!asset || !isCryptoEntry(entry, asset)) return null;
  // eToro's monetary "amount" is often the invested USD amount. Import only
  // explicit unit fields, never turn a USD investment into crypto units.
  const amount = numberValue(valueAt(entry, ["units", "quantity", "amountInUnits", "closedUnits", "positionUnits", "volume"]));
  const timestampValue = valueAt(entry, ["timestamp", "time", "date", "executedAt", "closedAt", "openedAt", "openDate", "closeDate"]);
  const parsedDate = timestampValue ? new Date(timestampValue) : null;
  const timestamp = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null;
  const type = String(valueAt(entry, ["transactionType", "type", "action", "side", "direction", "status"]) || "").toLowerCase();
  const isBuy = valueAt(entry, ["isBuy", "isPurchase"]);
  const direction = /sell|close|withdraw|send|out/.test(type) || isBuy === false ? "out"
    : /buy|open|deposit|receive|in/.test(type) || isBuy === true ? "in" : null;
  const externalId = String(valueAt(entry, ["transactionId", "tradeId", "orderId", "positionId", "id"]) || "").trim();
  if (!amount || amount <= 0 || !timestamp || !direction || !externalId) return null;
  const priceCurrency = String(valueAt(entry, ["priceCurrency", "rateCurrency", "currency", "instrument.currency"]) || "").toUpperCase();
  const rawPrice = numberValue(valueAt(entry, ["priceEur", "rateEur", "executionPrice", "rate", "price"]));
  const priceEur = rawPrice && rawPrice > 0 && priceCurrency === "EUR" ? rawPrice : null;
  const feeCurrency = cryptoAsset({ instrument: { symbolName: valueAt(entry, ["feeCurrency", "commissionCurrency", "feeAsset"]) } });
  const rawFee = Math.abs(numberValue(valueAt(entry, ["fee", "fees", "commission", "spreadFee"])) || 0);
  // A brokerage fee can be USD. Without an explicit crypto fee currency it
  // must not reduce the imported coin quantity.
  const fee = feeCurrency === asset ? rawFee : 0;
  const purpose = direction === "in" ? "Kauf" : "Verkauf";
  return {
    externalId: `etoro:${externalId}:${asset}:${direction}`,
    hash: `etoro:${externalId}`,
    timestamp,
    direction,
    asset,
    amount,
    fee,
    feeAsset: asset,
    priceEur,
    purpose,
    counterparty: "eToro",
    raw: entry,
  };
}

function historyItems(payload) {
  if (Array.isArray(payload)) return payload;
  const data = payload?.data;
  for (const candidate of [data?.items, data?.trades, data?.history, data?.positions, data, payload?.items, payload?.trades, payload?.history, payload?.positions]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function hasNextPage(payload, itemCount, page, pageSize) {
  const data = payload?.data || payload || {};
  const totalPages = Number(data.totalPages ?? data.pageCount ?? data.pagination?.totalPages);
  if (Number.isFinite(totalPages) && totalPages > 0) return page < totalPages;
  if (data.nextPage || data.pagination?.nextPage || data.hasNext === true || data.pagination?.hasNext === true) return true;
  return itemCount >= pageSize;
}

async function fetchEtoroHistory({ apiBaseUrl, apiKey, userKey, fetchImpl = fetch, maxItems = ETORO_HISTORY_LIMIT, pageSize = ETORO_PAGE_SIZE, requestGapMs = ETORO_REQUEST_GAP_MS, startDate = "2015-01-01" }) {
  const base = new URL(`${String(apiBaseUrl || "https://public-api.etoro.com/api/v1").replace(/\/$/, "")}/`);
  const rows = [];
  const warnings = [];
  const maxPages = Math.ceil(maxItems / pageSize);
  for (let page = 1; page <= maxPages && rows.length < maxItems; page += 1) {
    const url = new URL("trading/info/trade/history", base);
    url.searchParams.set("minDate", startDate);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(pageSize));
    const response = await fetchImpl(url, { method: "GET", headers: etoroHeaders({ apiKey, userKey }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.message || payload?.error?.message || payload?.error || `eToro antwortet mit HTTP ${response.status}.`));
    const items = historyItems(payload);
    const normalized = items.map(normalizeEtoroTrade).filter(Boolean);
    rows.push(...normalized);
    if (items.length && !normalized.length) warnings.push("eToro lieferte Buchungen ohne explizite Krypto-Einheiten. Sie wurden nicht als historische Käufe geschätzt; bitte bei Bedarf den Kontoauszug als CSV nachtragen.");
    if (!hasNextPage(payload, items.length, page, pageSize)) break;
    if (requestGapMs) await new Promise((resolve) => setTimeout(resolve, requestGapMs));
  }
  return {
    rows: rows.slice(0, maxItems),
    limited: rows.length >= maxItems,
    warnings: [...new Set(warnings)],
  };
}

module.exports = {
  ETORO_HISTORY_LIMIT,
  ETORO_PAGE_SIZE,
  ETORO_REQUEST_GAP_MS,
  etoroHeaders,
  normalizeEtoroTrade,
  historyItems,
  fetchEtoroHistory,
};
