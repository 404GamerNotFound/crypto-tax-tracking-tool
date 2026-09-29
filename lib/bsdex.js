const crypto = require("node:crypto");
const WebSocket = require("ws");

const BSDEX_HISTORY_LIMIT = 2500;
const FIAT_ASSETS = new Set(["EUR"]);
// The documented v2 crypto-history endpoints currently expose these assets.
// Keep this list separate from trade markets: querying every market asset
// would turn a normal, unsupported asset into a request error.
const CRYPTO_TRANSFER_ASSETS = ["BTC", "ETH", "LTC", "XRP"];

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asset(value) {
  const symbol = String(value || "").trim().toUpperCase();
  return symbol === "XBT" ? "BTC" : symbol;
}

function bsdexDate(value = new Date()) {
  return new Date(value).toUTCString();
}

function bsdexHeaders({ apiKey, apiSecret, date = bsdexDate() }) {
  const normalizedDate = String(date || "").trim();
  const signature = crypto.createHmac("sha1", String(apiSecret || ""))
    .update(`date: ${normalizedDate}`)
    .digest("base64");
  return {
    Date: normalizedDate,
    ApiKey: String(apiKey || ""),
    Authorization: `hmac username="${String(apiKey || "")}", algorithm="hmac-sha1", headers="date", signature="${signature}"`,
    Accept: "application/json",
    // Required by the v2 crypto-history routes. It is per-request only and
    // never persisted.
    "X-Request-Id": crypto.randomUUID(),
  };
}

function apiBase(value) {
  return String(value || "https://api-public.bsdex.de").replace(/\/$/, "");
}

function timestampFromLocalTs(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  try {
    if (/^\d+$/.test(text)) {
      const numeric = BigInt(text);
      // BSDEX returns local_ts in nanoseconds. Preserve sub-millisecond data
      // only insofar as JavaScript dates support it.
      const milliseconds = numeric > 9_999_999_999_999n ? numeric / 1_000_000n : numeric;
      const date = new Date(Number(milliseconds));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
  } catch {
    return null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function marketParts(market) {
  const [base, quote, ...rest] = String(market || "").trim().toUpperCase().split("-");
  return !rest.length && base && quote ? { base: asset(base), quote: asset(quote) } : null;
}

function normalizeBsdexTrade(trade, fallbackMarket = "") {
  const market = String(trade?.market || fallbackMarket || "").trim().toLowerCase();
  const parts = marketParts(market);
  const quantity = numberValue(trade?.quantity);
  const price = numberValue(trade?.price);
  const timestamp = timestampFromLocalTs(trade?.local_ts);
  const id = String(trade?.id ?? "").trim();
  const side = String(trade?.side || "").trim().toLowerCase();
  if (!parts || parts.quote !== "EUR" || !quantity || quantity <= 0 || !price || price <= 0 || !timestamp || !id || !["buy", "sell"].includes(side)) return null;
  const fee = Math.abs(numberValue(trade?.fee) || 0);
  return {
    externalId: `bsdex:trade:${market}:${id}:base`,
    hash: `bsdex:trade:${market}:${id}`,
    timestamp,
    direction: side === "buy" ? "in" : "out",
    asset: parts.base,
    amount: quantity,
    fee,
    feeAsset: "EUR",
    priceEur: price,
    purpose: side === "buy" ? "Kauf" : "Verkauf",
    counterparty: `BSDEX · ${market.toUpperCase()}`,
    raw: trade,
  };
}

function normalizeBsdexBalances(payload) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  const grouped = new Map();
  for (const item of rows) {
    const assetId = asset(item?.asset_id);
    const free = numberValue(item?.available) || 0;
    const locked = numberValue(item?.locked) || 0;
    if (!assetId || FIAT_ASSETS.has(assetId) || !Number.isFinite(free) || !Number.isFinite(locked)) continue;
    const current = grouped.get(assetId) || { asset: assetId, free: 0, locked: 0 };
    current.free += free;
    current.locked += locked;
    grouped.set(assetId, current);
  }
  return [...grouped.values()]
    .map((entry) => ({ ...entry, total: entry.free + entry.locked }))
    .filter((entry) => entry.total > 0)
    .sort((left, right) => left.asset.localeCompare(right.asset));
}

function resultRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.value)) return payload.value;
  return [];
}

function nextCursor(response, payload) {
  const headers = response?.headers;
  const header = typeof headers?.get === "function" ? headers.get("next-cursor") : null;
  return String(header || payload?.next_cursor || payload?.nextCursor || "").trim();
}

async function readJson(response, provider = "BSDEX") {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(payload?.message || payload?.error || payload?.detail || `${provider} antwortet mit HTTP ${response.status}.`));
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function signedGet({ apiBaseUrl, apiKey, apiSecret, pathname, params, fetchImpl = fetch }) {
  const url = new URL(pathname, `${apiBase(apiBaseUrl)}/`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetchImpl(url, { method: "GET", headers: bsdexHeaders({ apiKey, apiSecret }) });
  return { response, payload: await readJson(response) };
}

async function publicGet({ apiBaseUrl, pathname, fetchImpl = fetch }) {
  const response = await fetchImpl(new URL(pathname, `${apiBase(apiBaseUrl)}/`), { method: "GET", headers: { Accept: "application/json" } });
  return readJson(response);
}

function marketIds(payload) {
  return resultRows(payload)
    .map((entry) => String(entry?.id || entry?.market || entry || "").trim().toLowerCase())
    .filter((market) => marketParts(market)?.quote === "EUR")
    .filter((market, index, values) => values.indexOf(market) === index)
    .sort();
}

function isoTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function transferAddress(item, direction) {
  const rawAddress = direction === "in" ? item?.source_address : item?.target_address;
  const rawTag = direction === "in" ? item?.source_tag : item?.destination_tag;
  const address = rawAddress === null || rawAddress === undefined ? "" : String(rawAddress).trim();
  const tag = rawTag === null || rawTag === undefined ? "" : String(rawTag).trim();
  if (!address) return "BSDEX";
  return `BSDEX · ${address}${tag ? ` · Tag ${tag}` : ""}`;
}

function normalizeBsdexCryptoTransfer(item, direction) {
  const id = String(item?.uuid || item?.id || "").trim();
  const assetId = asset(item?.asset_id);
  const amount = numberValue(item?.amount);
  const finalizedAt = isoTimestamp(item?.finalized_at || item?.finalised_at || item?.completed_at);
  const timestamp = finalizedAt || isoTimestamp(item?.created_at || item?.timestamp);
  const state = String(item?.transaction_state || item?.state || "").trim().toLowerCase();
  const finalState = /^(?:settled|confirmed|finalized|finalised|completed|done|success)$/.test(state);
  // API examples use `created` for a finished transfer, but set finalized_at.
  // A merely created withdrawal has no finalized_at and is deliberately not
  // written to the journal yet.
  if (!id || !assetId || FIAT_ASSETS.has(assetId) || !amount || amount <= 0 || !timestamp || (!finalizedAt && !finalState)) return null;
  const type = direction === "in" ? "deposit" : "withdrawal";
  return {
    externalId: `bsdex:${type}:${id}:${assetId.toLowerCase()}`,
    hash: `bsdex:${type}:${id}`,
    timestamp,
    direction,
    asset: assetId,
    amount,
    fee: 0,
    feeAsset: assetId,
    purpose: "Transfer",
    counterparty: transferAddress(item, direction),
    raw: item,
  };
}

function normalizeBsdexDeposit(item) {
  return normalizeBsdexCryptoTransfer(item, "in");
}

function normalizeBsdexWithdrawal(item) {
  return normalizeBsdexCryptoTransfer(item, "out");
}

function pageHint(response, payload) {
  const readHeader = (name) => typeof response?.headers?.get === "function" ? response.headers.get(name) : null;
  const hint = readHeader("next-page") || readHeader("x-next-page")
    || payload?.next_page || payload?.nextPage || payload?.meta?.next_page || payload?.pagination?.next_page;
  const parsed = Number(hint);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function fetchBsdexCryptoTransfers({ apiBaseUrl, apiKey, apiSecret, fetchImpl = fetch, maxItems = BSDEX_HISTORY_LIMIT, requestGapMs = 350 }) {
  const limit = Math.max(1, Math.min(BSDEX_HISTORY_LIMIT, Math.floor(Number(maxItems) || BSDEX_HISTORY_LIMIT)));
  const rows = [];
  const warnings = [];
  for (const transferType of [
    { endpoint: "/api/v2/crypto/deposits", label: "Einzahlungen", normalize: normalizeBsdexDeposit },
    { endpoint: "/api/v2/crypto/withdrawals", label: "Auszahlungen", normalize: normalizeBsdexWithdrawal },
  ]) {
    for (const assetId of CRYPTO_TRANSFER_ASSETS) {
      let page = 1;
      let pages = 0;
      const seenIds = new Set();
      while (rows.length < limit && pages < 250) {
        let response;
        let payload;
        try {
          ({ response, payload } = await signedGet({
            apiBaseUrl, apiKey, apiSecret, pathname: transferType.endpoint,
            params: { asset_id: assetId.toLowerCase(), page }, fetchImpl,
          }));
        } catch (error) {
          // Transfer history may be unavailable for an older API account. The
          // rest of the read-only sync remains usable, while the omission is
          // explicit instead of being silently fabricated.
          warnings.push(`BSDEX-${transferType.label} für ${assetId} konnten nicht abgerufen werden: ${String(error.message || "unbekannter Fehler").slice(0, 180)}`);
          break;
        }
        const pageRows = resultRows(payload);
        if (!pageRows.length) break;
        let newItems = 0;
        for (const item of pageRows) {
          const normalized = transferType.normalize(item);
          const itemId = normalized?.externalId || String(item?.uuid || item?.id || "").trim();
          if (!normalized || !itemId || seenIds.has(itemId)) continue;
          seenIds.add(itemId);
          rows.push(normalized);
          newItems += 1;
          if (rows.length >= limit) break;
        }
        // A proxy which ignores the page parameter must not cause an endless
        // loop. Repeated records are deduplicated before this guard runs.
        if (!newItems || rows.length >= limit) break;
        const next = pageHint(response, payload);
        page = next && next > page ? next : page + 1;
        pages += 1;
        if (requestGapMs > 0) await new Promise((resolve) => setTimeout(resolve, requestGapMs));
      }
      if (rows.length >= limit) break;
      if (requestGapMs > 0) await new Promise((resolve) => setTimeout(resolve, requestGapMs));
    }
    if (rows.length >= limit) break;
  }
  if (rows.length >= limit) warnings.push(`Der BSDEX-Import wurde bei ${limit.toLocaleString("de-DE")} Buchungen begrenzt.`);
  return { rows, warnings, limited: rows.length >= limit };
}

async function fetchBsdexSubscriptionInfo({ apiBaseUrl, apiKey, apiSecret, fetchImpl = fetch }) {
  // Keep even this small bootstrap serial. The same local queue also uses the
  // calls for a full historical import, so a new connection never bursts a
  // provider with parallel authenticated requests.
  const marketsPayload = await publicGet({ apiBaseUrl, pathname: "/markets", fetchImpl });
  const balanceResult = await signedGet({ apiBaseUrl, apiKey, apiSecret, pathname: "/api/v1/balance", fetchImpl });
  return { markets: marketIds(marketsPayload), balances: normalizeBsdexBalances(balanceResult.payload) };
}

async function fetchBsdexHistory({ apiBaseUrl, apiKey, apiSecret, fetchImpl = fetch, maxItems = BSDEX_HISTORY_LIMIT, requestGapMs = 350 }) {
  const { markets, balances } = await fetchBsdexSubscriptionInfo({ apiBaseUrl, apiKey, apiSecret, fetchImpl });
  const limit = Math.max(1, Math.min(BSDEX_HISTORY_LIMIT, Math.floor(Number(maxItems) || BSDEX_HISTORY_LIMIT)));
  // Transfers are imported first, but use a separate bounded bucket from
  // trades. Neither a very active trading account nor an account with many
  // withdrawals may starve the other history class.
  const transfers = await fetchBsdexCryptoTransfers({
    apiBaseUrl, apiKey, apiSecret, fetchImpl, maxItems: limit, requestGapMs,
  });
  const tradeRows = [];
  const warnings = [...transfers.warnings];
  for (const market of markets) {
    if (tradeRows.length >= limit) break;
    let cursor = "";
    let pages = 0;
    do {
      const { response, payload } = await signedGet({
        apiBaseUrl, apiKey, apiSecret, pathname: `/api/v1/${encodeURIComponent(market)}/trades`, params: cursor ? { cursor } : {}, fetchImpl,
      });
      const pageRows = resultRows(payload);
      pageRows.forEach((trade) => {
        const normalized = normalizeBsdexTrade(trade, market);
        if (normalized && tradeRows.length < limit) tradeRows.push(normalized);
      });
      const upcomingCursor = nextCursor(response, payload);
      if (!upcomingCursor || upcomingCursor === cursor || !pageRows.length || tradeRows.length >= limit) break;
      cursor = upcomingCursor;
      pages += 1;
      if (requestGapMs > 0) await new Promise((resolve) => setTimeout(resolve, requestGapMs));
    } while (pages < 250 && tradeRows.length < limit);
    if (tradeRows.length >= limit) {
      warnings.push(`Die BSDEX-Trade-Historie wurde bei ${limit.toLocaleString("de-DE")} Buchungen begrenzt.`);
      break;
    }
    if (requestGapMs > 0 && market !== markets.at(-1)) await new Promise((resolve) => setTimeout(resolve, requestGapMs));
  }
  const rows = [...transfers.rows, ...tradeRows];
  return { rows, accountBalances: balances, markets, warnings, limited: transfers.limited || tradeRows.length >= limit };
}

function bsdexWebSocketUrl(apiBaseUrl) {
  const api = new URL(apiBase(apiBaseUrl));
  api.protocol = api.protocol === "http:" ? "ws:" : "wss:";
  api.pathname = `${api.pathname.replace(/\/$/, "")}/api/v1/ws`;
  api.search = "";
  return api.toString();
}

function createBsdexLiveClient({ apiBaseUrl, apiKey, apiSecret, markets = [], assets = [], onTrade, onBalance, onStatus, WebSocketImpl = WebSocket, heartbeatMs = 30000 }) {
  const subscriptions = {
    markets: [...new Set(markets.map((value) => String(value || "").trim().toLowerCase()).filter((value) => marketParts(value)?.quote === "EUR"))].slice(0, 100),
    assets: [...new Set(assets.map(asset).filter((value) => value && !FIAT_ASSETS.has(value)))].slice(0, 100),
  };
  let closed = false;
  let heartbeat = null;
  const socket = new WebSocketImpl(bsdexWebSocketUrl(apiBaseUrl), { headers: bsdexHeaders({ apiKey, apiSecret }) });
  const emitStatus = (status, error = "") => typeof onStatus === "function" && onStatus({ status, error: String(error || "").slice(0, 500) });
  socket.on("open", () => {
    if (closed) return;
    subscriptions.markets.forEach((market) => socket.send(JSON.stringify({ type: "subscribe", chan_name: "trade", subchan_name: market })));
    subscriptions.assets.forEach((assetId) => socket.send(JSON.stringify({ type: "subscribe", chan_name: "balance", subchan_name: assetId.toLowerCase() })));
    heartbeat = setInterval(() => {
      if (!closed && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
    }, Math.max(5000, Number(heartbeatMs) || 30000));
    heartbeat.unref?.();
    emitStatus("connected");
  });
  socket.on("message", (message) => {
    if (closed) return;
    try {
      const payload = JSON.parse(String(message));
      if (payload?.type !== "data") return;
      if (payload.chan_name === "trade" && payload.data && typeof onTrade === "function") onTrade(payload.data, payload.subchan_name);
      if (payload.chan_name === "balance" && payload.data && typeof onBalance === "function") onBalance(payload.data);
    } catch {
      // A malformed websocket frame cannot alter journal data; wait for the
      // regular REST reconciliation instead of logging raw payloads.
    }
  });
  socket.on("error", (error) => { if (!closed) emitStatus("error", error?.message); });
  socket.on("close", () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    if (!closed) emitStatus("closed");
  });
  return {
    close() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      socket.close();
    },
  };
}

module.exports = {
  BSDEX_HISTORY_LIMIT,
  bsdexDate,
  bsdexHeaders,
  bsdexWebSocketUrl,
  createBsdexLiveClient,
  fetchBsdexCryptoTransfers,
  fetchBsdexHistory,
  fetchBsdexSubscriptionInfo,
  normalizeBsdexBalances,
  normalizeBsdexDeposit,
  normalizeBsdexTrade,
  normalizeBsdexWithdrawal,
  timestampFromLocalTs,
};
