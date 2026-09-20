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
  const target = new Date(`${date}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(target) || !Array.isArray(samples)) return null;
  let closest = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const [at, value] of samples) {
    const price = Number(value);
    const nextDistance = Math.abs(Number(at) - target);
    if (Number.isFinite(price) && price > 0 && nextDistance < distance) {
      closest = price;
      distance = nextDistance;
    }
  }
  return distance <= 3 * 86400000 ? closest : null;
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

function usesCoinGeckoPro(apiBaseUrl, apiKey) {
  if (!String(apiKey || "").trim()) return false;
  try {
    const hostname = new URL(apiBaseUrl).hostname.toLowerCase();
    return hostname === "pro-api.coingecko.com" || hostname.startsWith("pro-api.");
  } catch (_) {
    return false;
  }
}

module.exports = { bitvavoDailyClosePrices, coinGeckoDate, coinGeckoHeaders, closestPriceForDate, needsExtendedCoinGeckoHistory, usesCoinGeckoPro };
