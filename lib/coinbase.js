const crypto = require("node:crypto");

const COINBASE_PAGE_SIZE = 100;
const FIAT_ASSETS = new Set(["EUR", "USD", "GBP", "CHF", "TRY", "BRL", "AUD", "PLN", "UAH", "RUB", "CAD", "JPY", "SGD"]);

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
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function queryString(params = {}) {
  return new URLSearchParams(Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, String(value)])).toString();
}

// Coinbase Exchange specifies a base64-decoded secret and a base64-encoded
// HMAC-SHA256 digest over timestamp + method + requestPath + body. The
// documented request path excludes query parameters, including pagination.
function signedHeaders({ apiKey, apiSecret, passphrase, method = "GET", path, body = "", now = Date.now() }) {
  const timestamp = String(Math.floor(Number(now) / 1000));
  const requestPath = String(path || "");
  const secret = Buffer.from(String(apiSecret || ""), "base64");
  const signature = crypto.createHmac("sha256", secret)
    .update(`${timestamp}${String(method).toUpperCase()}${requestPath}${body}`)
    .digest("base64");
  return {
    Accept: "application/json",
    "CB-ACCESS-KEY": String(apiKey || ""),
    "CB-ACCESS-SIGN": signature,
    "CB-ACCESS-TIMESTAMP": timestamp,
    "CB-ACCESS-PASSPHRASE": String(passphrase || ""),
  };
}

function nextCursor(headers) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get("cb-after") || headers.get("CB-AFTER") || "").trim();
  return String(headers["cb-after"] || headers["CB-AFTER"] || "").trim();
}

async function signedGet({ apiBaseUrl, apiKey, apiSecret, passphrase, pathname, params, fetchImpl = fetch, now = Date.now() }) {
  const base = String(apiBaseUrl || "https://api.exchange.coinbase.com").replace(/\/$/, "");
  const query = queryString(params);
  const path = `${pathname}${query ? `?${query}` : ""}`;
  const response = await fetchImpl(`${base}${path}`, {
    method: "GET",
    headers: signedHeaders({ apiKey, apiSecret, passphrase, method: "GET", path: pathname, now }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(payload?.message || payload?.error || `Coinbase Exchange antwortet mit HTTP ${response.status}.`);
    throw new Error(message);
  }
  return { payload, cursor: nextCursor(response.headers) };
}

function normalizeAccountBalances(accounts) {
  const balances = new Map();
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const assetId = asset(account?.currency);
    const total = numberValue(account?.balance);
    const free = numberValue(account?.available);
    const locked = numberValue(account?.hold);
    if (!assetId || FIAT_ASSETS.has(assetId) || total === null || total <= 0) continue;
    const previous = balances.get(assetId) || { asset: assetId, free: 0, locked: 0, total: 0 };
    balances.set(assetId, {
      asset: assetId,
      free: previous.free + (free === null ? Math.max(0, total - (locked || 0)) : free),
      locked: previous.locked + (locked || 0),
      total: previous.total + total,
    });
  }
  return [...balances.values()].sort((left, right) => left.asset.localeCompare(right.asset));
}

function productAssets(productId) {
  const pieces = String(productId || "").trim().toUpperCase().split("-");
  if (pieces.length !== 2 || !pieces[0] || !pieces[1]) return null;
  return { base: asset(pieces[0]), quote: asset(pieces[1]) };
}

function normalizeFill(fill) {
  const product = productAssets(fill?.product_id);
  const amount = numberValue(fill?.size);
  const price = numberValue(fill?.price);
  const timestamp = isoTimestamp(fill?.created_at || fill?.trade_time);
  const side = String(fill?.side || "").trim().toLowerCase();
  const id = String(fill?.trade_id || fill?.entry_id || fill?.order_id || "").trim();
  if (!product || !amount || amount <= 0 || !price || price <= 0 || !timestamp || !id || !["buy", "sell"].includes(side)) return [];
  const quoteAmount = amount * price;
  const priceEur = product.quote === "EUR" ? price : null;
  const counterparty = `Coinbase Exchange · ${String(fill.product_id).toUpperCase()}`;
  const rows = [{
    externalId: `coinbase:fill:${id}:base`, hash: `coinbase:${id}`, timestamp,
    direction: side === "buy" ? "in" : "out", asset: product.base, amount, fee: 0, feeAsset: product.base,
    priceEur, purpose: side === "buy" ? "Kauf" : "Verkauf", counterparty, raw: fill,
  }];
  if (!FIAT_ASSETS.has(product.quote)) {
    rows.push({
      externalId: `coinbase:fill:${id}:quote`, hash: `coinbase:${id}`, timestamp,
      direction: side === "buy" ? "out" : "in", asset: product.quote, amount: quoteAmount, fee: 0, feeAsset: product.quote,
      priceEur: null, purpose: side === "buy" ? "Verkauf" : "Kauf", counterparty, raw: fill,
    });
  }
  const fee = numberValue(fill?.fee) || 0;
  const feeAsset = asset(fill?.fee_currency || product.quote);
  // Fiat fees are stored on the traded asset just like BSDEX fees. They are
  // a EUR/USD cost, not a separate crypto balance that could go negative.
  if (fee > 0 && FIAT_ASSETS.has(feeAsset)) {
    rows[0].fee = fee;
    rows[0].feeAsset = feeAsset;
  } else if (fee > 0 && feeAsset) {
    rows.push({
      externalId: `coinbase:fill:${id}:fee:${feeAsset}`, hash: `coinbase:${id}`, timestamp,
      direction: "out", asset: feeAsset, amount: fee, fee: 0, feeAsset,
      priceEur: null, purpose: "Gebühr", counterparty, raw: fill,
    });
  }
  return rows;
}

function ledgerPurpose(type) {
  const normalized = String(type || "").trim().toLowerCase();
  if (/staking|reward|earn|interest/.test(normalized)) return "Staking Rewards";
  if (/convert|conversion/.test(normalized)) return "DeFi Swap";
  if (/transfer|deposit|withdraw/.test(normalized)) return "Transfer";
  // A ledger can also contain rebates or administrative adjustments. Those
  // must stay visible but must not become a transfer suggestion merely
  // because the account entry has no paired order record.
  return "Sonstiges";
}

function normalizeLedgerEntry(entry, account) {
  const type = String(entry?.type || "").trim().toLowerCase();
  // A fill contains the paired trade, EUR price and fee currency.  Importing
  // its ledger legs as well would double every order.
  if (["match", "fee"].includes(type)) return null;
  const rawAmount = numberValue(entry?.amount);
  const assetId = asset(entry?.currency || account?.currency);
  const timestamp = isoTimestamp(entry?.created_at);
  const id = String(entry?.id || "").trim();
  if (!rawAmount || !assetId || FIAT_ASSETS.has(assetId) || !timestamp || !id) return null;
  const details = entry?.details && typeof entry.details === "object" ? entry.details : {};
  const reference = String(details.transfer_id || details.order_id || id);
  return {
    externalId: `coinbase:ledger:${id}:${assetId}`, hash: `coinbase:${reference}`, timestamp,
    direction: rawAmount > 0 ? "in" : "out", asset: assetId, amount: Math.abs(rawAmount), fee: 0, feeAsset: assetId,
    priceEur: null, purpose: ledgerPurpose(type), counterparty: `Coinbase Exchange · ${type || "Kontobewegung"}`,
    raw: entry,
  };
}

function safeState(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function normalizeCoinbaseHistoryState(value) {
  const input = safeState(value);
  const phases = new Set(["accounts", "ledgers", "fills", "complete"]);
  const accounts = (Array.isArray(input.accounts) ? input.accounts : []).map((item) => ({
    id: String(item?.id || "").trim(), currency: asset(item?.currency),
  })).filter((item) => item.id && item.currency).slice(0, 500);
  const phase = phases.has(input.phase) ? input.phase : "accounts";
  return {
    version: 1,
    phase,
    accountsCursor: String(input.accountsCursor || "").slice(0, 500),
    accounts,
    accountIndex: Math.min(accounts.length, Math.max(0, Math.floor(Number(input.accountIndex) || 0))),
    ledgerCursor: String(input.ledgerCursor || "").slice(0, 500),
    fillsCursor: String(input.fillsCursor || "").slice(0, 500),
    warnings: [...new Set((Array.isArray(input.warnings) ? input.warnings : []).map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 12),
  };
}

function coinbaseHistoryProgress(state) {
  const accountCount = Math.max(1, state.accounts.length);
  const total = accountCount + 2;
  if (state.phase === "complete") return { current: total, total, phase: "complete" };
  if (state.phase === "accounts") return { current: 0, total, phase: "accounts" };
  if (state.phase === "ledgers") return { current: Math.min(accountCount, 1 + state.accountIndex), total, phase: "ledgers" };
  return { current: accountCount + 1, total, phase: "fills" };
}

function coinbaseHistoryPhaseLabel(phase) {
  return ({ accounts: "Konten", ledgers: "Ein- und Auszahlungen", fills: "Trades und Gebühren", complete: "Abgeschlossen" })[phase] || "Historie";
}

async function fetchCoinbaseAccounts(options) {
  const accounts = [];
  let cursor = "";
  do {
    const result = await signedGet({ ...options, pathname: "/accounts", params: { limit: COINBASE_PAGE_SIZE, after: cursor || undefined } });
    accounts.push(...(Array.isArray(result.payload) ? result.payload : []));
    cursor = result.cursor;
  } while (cursor && accounts.length < 500);
  return { accounts, cursor };
}

async function fetchCoinbaseHistory({ apiBaseUrl, apiKey, apiSecret, passphrase, fetchImpl = fetch, now }) {
  const { accounts } = await fetchCoinbaseAccounts({ apiBaseUrl, apiKey, apiSecret, passphrase, fetchImpl, now });
  const rows = [];
  for (const account of accounts) {
    const ledger = await signedGet({ apiBaseUrl, apiKey, apiSecret, passphrase, pathname: `/accounts/${encodeURIComponent(account.id)}/ledger`, params: { limit: COINBASE_PAGE_SIZE }, fetchImpl, now });
    for (const entry of Array.isArray(ledger.payload) ? ledger.payload : []) {
      const normalized = normalizeLedgerEntry(entry, account);
      if (normalized) rows.push(normalized);
    }
  }
  const fills = await signedGet({ apiBaseUrl, apiKey, apiSecret, passphrase, pathname: "/fills", params: { limit: COINBASE_PAGE_SIZE }, fetchImpl, now });
  for (const fill of Array.isArray(fills.payload) ? fills.payload : []) rows.push(...normalizeFill(fill));
  return { rows, accountBalances: normalizeAccountBalances(accounts), warnings: [] };
}

async function fetchCoinbaseHistoryBatch({ apiBaseUrl, apiKey, apiSecret, passphrase, state, fetchImpl = fetch, now }) {
  const current = normalizeCoinbaseHistoryState(state);
  if (current.phase === "complete") return { rows: [], nextState: current, complete: true, settled: true, warnings: current.warnings, progress: coinbaseHistoryProgress(current) };
  let nextState = { ...current, accounts: [...current.accounts], warnings: [...current.warnings] };
  let rows = [];
  let accountBalances = null;
  if (current.phase === "accounts") {
    const result = await signedGet({ apiBaseUrl, apiKey, apiSecret, passphrase, pathname: "/accounts", params: { limit: COINBASE_PAGE_SIZE, after: current.accountsCursor || undefined }, fetchImpl, now });
    const accounts = Array.isArray(result.payload) ? result.payload : [];
    const known = new Set(nextState.accounts.map((account) => account.id));
    for (const account of accounts) {
      const id = String(account?.id || "").trim();
      const currency = asset(account?.currency);
      if (id && currency && !known.has(id)) { nextState.accounts.push({ id, currency }); known.add(id); }
    }
    if (result.cursor) nextState.accountsCursor = result.cursor;
    else { nextState.phase = "ledgers"; nextState.accountsCursor = ""; nextState.accountIndex = 0; nextState.ledgerCursor = ""; }
  } else if (current.phase === "ledgers") {
    const account = current.accounts[current.accountIndex];
    if (!account) {
      nextState.phase = "fills";
      nextState.ledgerCursor = "";
    } else {
      const result = await signedGet({ apiBaseUrl, apiKey, apiSecret, passphrase, pathname: `/accounts/${encodeURIComponent(account.id)}/ledger`, params: { limit: COINBASE_PAGE_SIZE, after: current.ledgerCursor || undefined }, fetchImpl, now });
      for (const entry of Array.isArray(result.payload) ? result.payload : []) {
        const normalized = normalizeLedgerEntry(entry, account);
        if (normalized) rows.push(normalized);
      }
      if (result.cursor) nextState.ledgerCursor = result.cursor;
      else { nextState.accountIndex = current.accountIndex + 1; nextState.ledgerCursor = ""; }
    }
  } else if (current.phase === "fills") {
    const result = await signedGet({ apiBaseUrl, apiKey, apiSecret, passphrase, pathname: "/fills", params: { limit: COINBASE_PAGE_SIZE, after: current.fillsCursor || undefined }, fetchImpl, now });
    for (const fill of Array.isArray(result.payload) ? result.payload : []) rows.push(...normalizeFill(fill));
    if (result.cursor) nextState.fillsCursor = result.cursor;
    else { nextState.phase = "complete"; nextState.fillsCursor = ""; }
  }
  nextState = normalizeCoinbaseHistoryState(nextState);
  const complete = nextState.phase === "complete";
  return { rows, nextState, complete, settled: complete, warnings: nextState.warnings, accountBalances, progress: coinbaseHistoryProgress(nextState) };
}

module.exports = {
  COINBASE_PAGE_SIZE,
  signedHeaders,
  normalizeAccountBalances,
  normalizeFill,
  normalizeLedgerEntry,
  normalizeCoinbaseHistoryState,
  coinbaseHistoryProgress,
  coinbaseHistoryPhaseLabel,
  fetchCoinbaseAccounts,
  fetchCoinbaseHistory,
  fetchCoinbaseHistoryBatch,
};
