const crypto = require("node:crypto");

const ETORO_HISTORY_LIMIT = 2500;
const ETORO_PAGE_SIZE = 100;
const ETORO_REQUEST_GAP_MS = 1100;
const ETORO_INSTRUMENT_BATCH_SIZE = 50;
const ETORO_HISTORY_WINDOW_DAYS = 364;

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

function etoroError(response, payload) {
  if (response.status === 401) return new Error("eToro hat die Read-only-Zugangsdaten abgelehnt. Prüfe, dass Public API-Key und User-Key zusammengehören, für das richtige Konto (Real/Demo) erstellt wurden und weder abgelaufen noch IP-beschränkt sind.");
  if (response.status === 403) return new Error("eToro verweigert den Abruf. Der User-Key benötigt Leserechte für Trading-Historie und darf nicht durch eine IP-Freigabe blockiert sein.");
  if (response.status === 429) return new Error("eToro begrenzt den Abruf vorübergehend. CryptoBuch versucht den seriellen Import später erneut.");
  const detail = String(payload?.message || payload?.error?.message || payload?.error || "").trim();
  return new Error(detail ? `eToro antwortet mit HTTP ${response.status}: ${detail.slice(0, 300)}` : `eToro antwortet mit HTTP ${response.status}.`);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function parseStartDate(startDate) {
  const parsed = new Date(`${String(startDate || "").slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Das eToro-Startdatum ist ungültig.");
  return parsed;
}

function historyEndpoint(environment) {
  return environment === "demo" ? "trading/info/trade/demo/history" : "trading/info/trade/history";
}

function instrumentRows(payload) {
  return [
    payload?.instrumentDisplayDatas,
    payload?.data?.instrumentDisplayDatas,
    payload?.items,
    payload?.data?.items,
  ].find(Array.isArray) || [];
}

function instrumentId(entry) {
  const value = valueAt(entry, ["instrumentId", "instrumentID", "instrument.id", "instrument.instrumentId"]);
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function attachInstrument(entry, instrument) {
  if (!instrument) return entry;
  return {
    ...entry,
    instrument: {
      ...(entry.instrument && typeof entry.instrument === "object" ? entry.instrument : {}),
      symbolName: valueAt(instrument, ["symbolFull", "internalSymbolFull", "instrumentDisplayName", "displayName"]),
      assetClass: valueAt(instrument, ["assetClass", "instrumentType", "instrumentTypeName", "category"]),
    },
  };
}

function historicalTradeId(entry) {
  const id = valueAt(entry, ["orderId", "tradeId", "positionId", "id"]);
  const closeTimestamp = valueAt(entry, ["closeTimestamp", "closedAt", "closeDate"]);
  const amount = valueAt(entry, ["units", "quantity", "amountInUnits", "closedUnits", "positionUnits", "volume"]);
  return [id, closeTimestamp, amount].filter((value) => value !== undefined && value !== null && value !== "").join(":");
}

function normalizeEtoroHistoricalTrade(entry, instrument) {
  const enriched = attachInstrument(entry, instrument);
  const asset = cryptoAsset(enriched);
  const amount = numberValue(valueAt(enriched, ["units", "quantity", "amountInUnits", "closedUnits", "positionUnits", "volume"]));
  const openDate = valueAt(enriched, ["openTimestamp", "openedAt", "openDate"]);
  const closeDate = valueAt(enriched, ["closeTimestamp", "closedAt", "closeDate"]);
  const isBuy = valueAt(enriched, ["isBuy", "isPurchase"]);
  const leverage = numberValue(valueAt(enriched, ["leverage"]));
  const tradeId = historicalTradeId(enriched);
  if (!asset || !amount || amount <= 0 || !openDate || !closeDate || !tradeId) return { rows: [], reason: "incomplete" };
  const openedAt = new Date(openDate);
  const closedAt = new Date(closeDate);
  if (Number.isNaN(openedAt.getTime()) || Number.isNaN(closedAt.getTime())) return { rows: [], reason: "incomplete" };
  // A closed buy position represents two ledger events. A sell position can
  // be a short/CFD position and must never manufacture a negative coin lot.
  if (isBuy !== true || (leverage !== null && leverage !== 1)) return { rows: [], reason: "non_spot" };
  const key = `etoro:${tradeId}:${asset}`;
  return {
    rows: [
      {
        externalId: `${key}:open`, hash: `etoro:${tradeId}`, timestamp: openedAt.toISOString(),
        direction: "in", asset, amount, fee: 0, feeAsset: asset, priceEur: null,
        purpose: "Kauf", counterparty: "eToro", raw: enriched,
      },
      {
        externalId: `${key}:close`, hash: `etoro:${tradeId}`, timestamp: closedAt.toISOString(),
        direction: "out", asset, amount, fee: 0, feeAsset: asset, priceEur: null,
        purpose: "Verkauf", counterparty: "eToro", raw: enriched,
      },
    ],
    reason: null,
  };
}

async function fetchEtoroInstruments({ base, apiKey, userKey, ids, fetchImpl, cache, requestGapMs }) {
  const missing = [...new Set(ids.filter(Boolean))].filter((id) => !cache.has(id));
  for (let index = 0; index < missing.length; index += ETORO_INSTRUMENT_BATCH_SIZE) {
    const batch = missing.slice(index, index + ETORO_INSTRUMENT_BATCH_SIZE);
    const url = new URL("market-data/instruments", base);
    url.searchParams.set("instrumentIds", batch.join(","));
    const response = await fetchImpl(url, { method: "GET", headers: etoroHeaders({ apiKey, userKey }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw etoroError(response, payload);
    for (const instrument of instrumentRows(payload)) {
      const id = instrumentId(instrument);
      if (id) cache.set(id, instrument);
    }
    for (const id of batch) if (!cache.has(id)) cache.set(id, null);
    if (requestGapMs && index + ETORO_INSTRUMENT_BATCH_SIZE < missing.length) await new Promise((resolve) => setTimeout(resolve, requestGapMs));
  }
  return cache;
}

async function fetchEtoroHistory({ apiBaseUrl, apiKey, userKey, environment = "real", fetchImpl = fetch, maxItems = ETORO_HISTORY_LIMIT, pageSize = ETORO_PAGE_SIZE, requestGapMs = ETORO_REQUEST_GAP_MS, startDate = "2015-01-01", endDate = new Date() }) {
  const base = new URL(`${String(apiBaseUrl || "https://public-api.etoro.com/api/v1").replace(/\/$/, "")}/`);
  const rows = [];
  const warnings = [];
  const instrumentCache = new Map();
  const seenExternalIds = new Set();
  let windowStart = parseStartDate(startDate);
  const finalDate = new Date(endDate);
  if (Number.isNaN(finalDate.getTime())) throw new Error("Das eToro-Enddatum ist ungültig.");
  const maxPages = Math.max(1, Math.ceil(maxItems / pageSize));

  while (windowStart <= finalDate && rows.length < maxItems) {
    for (let page = 1; page <= maxPages && rows.length < maxItems; page += 1) {
      const url = new URL(historyEndpoint(environment), base);
      url.searchParams.set("minDate", toDateOnly(windowStart));
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));
      const response = await fetchImpl(url, { method: "GET", headers: etoroHeaders({ apiKey, userKey }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw etoroError(response, payload);
      const items = historyItems(payload);
      await fetchEtoroInstruments({
        base, apiKey, userKey, ids: items.map(instrumentId), fetchImpl, cache: instrumentCache, requestGapMs,
      });
      for (const item of items) {
        const normalized = normalizeEtoroHistoricalTrade(item, instrumentCache.get(instrumentId(item)));
        if (normalized.reason === "non_spot") warnings.push("eToro lieferte gehebelte oder Short-Positionen. Sie werden nicht als Krypto-Bestand importiert, damit keine negativen Coin-Lots entstehen.");
        if (normalized.reason === "incomplete") warnings.push("eToro lieferte eine Buchung ohne eindeutige Krypto-Einheiten oder Instrumentdaten. Sie wurde nicht geschätzt; bei Bedarf den Kontoauszug als CSV nachtragen.");
        for (const row of normalized.rows) {
          if (!seenExternalIds.has(row.externalId) && rows.length < maxItems) {
            seenExternalIds.add(row.externalId);
            rows.push(row);
          }
        }
      }
      if (!hasNextPage(payload, items.length, page, pageSize)) break;
      if (requestGapMs) await new Promise((resolve) => setTimeout(resolve, requestGapMs));
    }
    windowStart = addDays(windowStart, ETORO_HISTORY_WINDOW_DAYS + 1);
    if (requestGapMs && windowStart <= finalDate && rows.length < maxItems) await new Promise((resolve) => setTimeout(resolve, requestGapMs));
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
  normalizeEtoroHistoricalTrade,
  historyItems,
  historyEndpoint,
  etoroError,
  fetchEtoroHistory,
};
