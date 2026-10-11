function coinGeckoHeaders(apiBaseUrl, apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) return {};
  let hostname = "";
  try {
    hostname = new URL(apiBaseUrl).hostname.toLowerCase();
  } catch (_) {
    return {};
  }
  return hostname === "pro-api.coingecko.com" || hostname.startsWith("pro-api.")
    ? { "x-cg-pro-api-key": key }
    : { "x-cg-demo-api-key": key };
}

function coinGeckoDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function closestPriceForDate(samples, date) {
  return priceSampleForDate(samples, date)?.price ?? null;
}

// A daily reference is an estimate, but must belong to the requested UTC day.
function priceSampleForDate(samples, date) {
  const target = new Date(`${date}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(target) || !Array.isArray(samples)) return null;
  let closest = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    if (!Array.isArray(sample)) continue;
    const [at, value] = sample;
    const timestamp = Number(at);
    if (!Number.isFinite(timestamp) || timestamp < target - 43200000 || timestamp >= target + 43200000) continue;
    const price = Number(value);
    const nextDistance = Math.abs(Number(at) - target);
    if (Number.isFinite(price) && price > 0 && nextDistance < distance) {
      closest = { price, observedAt: new Date(timestamp).toISOString(), method: "daily_reference" };
      distance = nextDistance;
    }
  }
  return closest;
}

function historicalDayReady(date, now = Date.now()) {
  return Date.parse(`${date}T00:00:00Z`) + 86400000 + 40 * 60000 <= now;
}

function coinGeckoHistoryAllowed(date, baseUrl, now = Date.now()) {
  // Custom endpoints and paid subscriptions may have different capabilities.
  return new URL(baseUrl).hostname !== "api.coingecko.com" || !needsExtendedCoinGeckoHistory(date, now);
}

function retryAfterMilliseconds(value, now = Date.now()) {
  if (!value) return 60000;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(1000, Math.min(delay, 86400000)) : 60000;
}

function needsExtendedCoinGeckoHistory(date, now = Date.now()) {
  const at = new Date(`${date}T00:00:00.000Z`).getTime();
  return Number.isFinite(at) && at < now - 365 * 86400000;
}

function bitvavoDailyClosePrices(candles) {
  const prices = new Map();
  for (const candle of Array.isArray(candles) ? candles : []) {
    const timestamp = Number(candle?.[0]);
    const close = Number(candle?.[4]);
    if (!Number.isFinite(timestamp) || !Number.isFinite(close) || close <= 0) continue;
    prices.set(new Date(timestamp).toISOString().slice(0, 10), close);
  }
  return prices;
}

function coinbaseDailyClosePrices(candles) {
  const prices = new Map();
  for (const candle of Array.isArray(candles) ? candles : []) {
    const timestamp = Number(candle?.[0]);
    const close = Number(candle?.[4]);
    if (!Number.isFinite(timestamp) || !Number.isFinite(close) || close <= 0) continue;
    prices.set(new Date(timestamp * 1000).toISOString().slice(0, 10), close);
  }
  return prices;
}

function cryptoCompareDailyClosePrices(payload) {
  const prices = new Map();
  for (const candle of Array.isArray(payload?.Data?.Data) ? payload.Data.Data : []) {
    const timestamp = Number(candle?.time);
    const close = Number(candle?.close);
    if (!Number.isFinite(timestamp) || !Number.isFinite(close) || close <= 0) continue;
    prices.set(new Date(timestamp * 1000).toISOString().slice(0, 10), close);
  }
  return prices;
}

function krakenDailyClosePrices(payload) {
  const prices = new Map();
  const result = payload?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return prices;
  const rows = Object.entries(result).find(([key, value]) => key !== "last" && Array.isArray(value))?.[1] || [];
  for (const candle of rows) {
    const timestamp = Number(candle?.[0]);
    const close = Number(candle?.[4]);
    if (!Number.isFinite(timestamp) || !Number.isFinite(close) || close <= 0) continue;
    prices.set(new Date(timestamp * 1000).toISOString().slice(0, 10), close);
  }
  return prices;
}

function usesCoinGeckoPro(apiBaseUrl, apiKey) {
  if (!String(apiKey || "").trim()) return false;
  try {
    const hostname = new URL(apiBaseUrl).hostname.toLowerCase();
    return hostname === "pro-api.coingecko.com" || hostname.startsWith("pro-api.");
  } catch (_) {
    return false;
  }
}

module.exports = {
  bitvavoDailyClosePrices,
  coinbaseDailyClosePrices,
  coinGeckoDate,
  coinGeckoHeaders,
  closestPriceForDate,
  priceSampleForDate,
  historicalDayReady,
  coinGeckoHistoryAllowed,
  retryAfterMilliseconds,
  cryptoCompareDailyClosePrices,
  krakenDailyClosePrices,
  needsExtendedCoinGeckoHistory,
  usesCoinGeckoPro,
};
