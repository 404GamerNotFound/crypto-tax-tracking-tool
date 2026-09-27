const crypto = require("node:crypto");

const BITVAVO_HISTORY_LIMIT = 2500;

function signedHeaders({ apiKey, apiSecret, method = "GET", path, timestamp = Date.now(), accessWindow = 10000 }) {
  const upperMethod = String(method).toUpperCase();
  const payload = `${timestamp}${upperMethod}${path}`;
  const signature = crypto.createHmac("sha256", String(apiSecret || "")).update(payload).digest("hex");
  return {
    "Bitvavo-Access-Key": String(apiKey || ""),
    "Bitvavo-Access-Timestamp": String(timestamp),
    "Bitvavo-Access-Signature": signature,
    "Bitvavo-Access-Window": String(accessWindow),
    Accept: "application/json",
  };
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedAsset(value) {
  const asset = String(value || "").trim().toUpperCase();
  return asset === "XBT" ? "BTC" : asset;
}

function normalizeBitvavoHistoryItem(item) {
  const type = String(item?.type || "").toLowerCase();
  const incoming = ["buy", "staking", "fixed_staking", "deposit", "affiliate", "distribution", "rebate", "loan", "external_transferred_funds"].includes(type);
  const outgoing = ["sell", "withdrawal"].includes(type);
  if (!incoming && !outgoing) return null;
  const asset = normalizedAsset(incoming ? item.receivedCurrency : item.sentCurrency);
  const amount = numberValue(incoming ? item.receivedAmount : item.sentAmount);
  const timestamp = item.executedAt ? new Date(item.executedAt).toISOString() : null;
  if (!asset || !amount || amount <= 0 || !timestamp || Number.isNaN(Date.parse(timestamp))) return null;
  const priceCurrency = normalizedAsset(item.priceCurrency);
  const priceAmount = numberValue(item.priceAmount);
  const priceEur = priceCurrency === "EUR" && priceAmount && priceAmount > 0 ? priceAmount / amount : null;
  const feesCurrency = normalizedAsset(item.feesCurrency);
  const fee = numberValue(item.feesAmount) || 0;
  const purpose = type === "buy" ? "Kauf" : type === "sell" ? "Verkauf"
    : /staking|affiliate|distribution|rebate/.test(type) ? "Staking Rewards" : "Transfer";
  return {
    externalId: `bitvavo:${String(item.transactionId || "")}:${asset}`,
    hash: String(item.transactionId || ""),
    timestamp,
    direction: incoming ? "in" : "out",
    asset,
    amount,
    fee,
    feeAsset: feesCurrency || asset,
    priceEur,
    purpose,
    counterparty: item.address || null,
    raw: item,
  };
}

async function fetchBitvavoHistory({ apiBaseUrl, apiKey, apiSecret, fetchImpl = fetch, maxItems = BITVAVO_HISTORY_LIMIT }) {
  const base = new URL(String(apiBaseUrl || "https://api.bitvavo.com/v2").replace(/\/$/, "") + "/");
  const rows = [];
  for (let page = 1; rows.length < maxItems; page += 1) {
    const url = new URL("account/history", base);
    url.searchParams.set("page", String(page));
    url.searchParams.set("maxItems", "100");
    const path = `${url.pathname}${url.search}`;
    const headers = signedHeaders({ apiKey, apiSecret, path });
    const response = await fetchImpl(url, { method: "GET", headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.message || payload?.error || `Bitvavo antwortet mit HTTP ${response.status}.`));
    const items = Array.isArray(payload?.items) ? payload.items : [];
    rows.push(...items);
    if (!items.length || page >= Number(payload?.totalPages || page) || page >= Math.ceil(maxItems / 100)) break;
  }
  return rows.slice(0, maxItems).map(normalizeBitvavoHistoryItem).filter(Boolean);
}

module.exports = { BITVAVO_HISTORY_LIMIT, signedHeaders, normalizeBitvavoHistoryItem, fetchBitvavoHistory };
