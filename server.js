const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { XPUB_ADDRESS_TYPES, deriveXpubAddress, parseXpub } = require("./lib/bitcoin-xpub");
const { CHAIN_CONFIG, cleanLabel, isValidAddress } = require("./lib/validation");
const { isConfirmedStakingPayout, trustedPayoutAliases } = require("./lib/tezos-staking");
const { normalizeTronNativeTransfer } = require("./lib/tron");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "cryptobuch.sqlite");
const MAX_TRANSACTIONS_PER_SYNC = Math.max(0, Number(process.env.MAX_TRANSACTIONS_PER_SYNC || 0));
const BITCOIN_EXPLORER_BASE_URL = (process.env.BITCOIN_EXPLORER_BASE_URL || "https://blockstream.info/api").replace(/\/$/, "");
const TRONGRID_BASE_URL = (process.env.TRONGRID_BASE_URL || "https://api.trongrid.io").replace(/\/$/, "");
const TRONGRID_API_KEY = String(process.env.TRONGRID_API_KEY || "").trim();
const XPUB_GAP_LIMIT = Math.min(50, Math.max(1, Number(process.env.XPUB_GAP_LIMIT || 20)));
const XPUB_MAX_DERIVATIONS_PER_BRANCH = Math.max(XPUB_GAP_LIMIT, Math.min(1000, Number(process.env.XPUB_MAX_DERIVATIONS_PER_BRANCH || 200)));
const XTZ_STAKING_PAYOUT_ALIASES = trustedPayoutAliases(process.env.XTZ_STAKING_PAYOUT_ALIASES || "Stake.fish Payouts");
const PURPOSE_PRESETS = [
  "Kauf",
  "Verkauf",
  "Staking Rewards",
  "Mining Reward",
  "Transfer",
  "Geschenk",
  "Gebühr",
  "Sonstiges",
];

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY,
    chain TEXT NOT NULL CHECK (chain IN ('BTC', 'XTZ', 'TRX')),
    address TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'address' CHECK (source_type IN ('address', 'xpub')),
    xpub_address_type TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_synced_at TEXT,
    UNIQUE(chain, address)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    timestamp TEXT,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out', 'self')),
    asset TEXT NOT NULL,
    amount REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    counterparty TEXT,
    price_transaction_eur REAL,
    purpose TEXT,
    purpose_origin TEXT NOT NULL DEFAULT 'unspecified' CHECK (purpose_origin IN ('unspecified', 'auto', 'manual')),
    raw_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(wallet_id, external_id)
  );
  CREATE TABLE IF NOT EXISTS price_history (
    coin_id TEXT NOT NULL,
    price_date TEXT NOT NULL,
    price_eur REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (coin_id, price_date)
  );
  CREATE TABLE IF NOT EXISTS wallet_addresses (
    id INTEGER PRIMARY KEY,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    branch INTEGER NOT NULL CHECK (branch IN (0, 1)),
    derivation_index INTEGER NOT NULL,
    is_used INTEGER NOT NULL DEFAULT 0,
    last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(wallet_id, address),
    UNIQUE(wallet_id, branch, derivation_index)
  );
  CREATE INDEX IF NOT EXISTS idx_transactions_wallet_timestamp
    ON transactions(wallet_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_purpose
    ON transactions(purpose) WHERE purpose IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_wallet_addresses_wallet_branch_index
    ON wallet_addresses(wallet_id, branch, derivation_index);
  PRAGMA optimize;
`);

function migrateWalletSchemaForTron() {
  const walletSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'wallets'").get()?.sql || "";
  if (walletSql.includes("'TRX'")) return;
  const walletColumns = new Set(db.prepare("PRAGMA table_info(wallets)").all().map((column) => column.name));
  const sourceType = walletColumns.has("source_type") ? "source_type" : "'address'";
  const xpubAddressType = walletColumns.has("xpub_address_type") ? "xpub_address_type" : "NULL";

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE wallets_trx_migration (
      id INTEGER PRIMARY KEY,
      chain TEXT NOT NULL CHECK (chain IN ('BTC', 'XTZ', 'TRX')),
      address TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'address' CHECK (source_type IN ('address', 'xpub')),
      xpub_address_type TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_synced_at TEXT,
      UNIQUE(chain, address)
    );
    INSERT INTO wallets_trx_migration (id, chain, address, label, source_type, xpub_address_type, created_at, last_synced_at)
    SELECT id, chain, address, label,
      COALESCE(${sourceType}, 'address'), ${xpubAddressType}, created_at, last_synced_at
    FROM wallets;
    DROP TABLE wallets;
    ALTER TABLE wallets_trx_migration RENAME TO wallets;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

migrateWalletSchemaForTron();

// Existing installations predate automatic purpose assignment. Preserve manual
// entries, while allowing unclassified legacy rows to be enriched on re-sync.
const walletColumnNames = new Set(db.prepare("PRAGMA table_info(wallets)").all().map((column) => column.name));
if (!walletColumnNames.has("source_type")) db.exec("ALTER TABLE wallets ADD COLUMN source_type TEXT NOT NULL DEFAULT 'address'");
if (!walletColumnNames.has("xpub_address_type")) db.exec("ALTER TABLE wallets ADD COLUMN xpub_address_type TEXT");

const transactionColumnNames = new Set(db.prepare("PRAGMA table_info(transactions)").all().map((column) => column.name));
if (!transactionColumnNames.has("purpose_origin")) {
  db.exec("ALTER TABLE transactions ADD COLUMN purpose_origin TEXT NOT NULL DEFAULT 'unspecified'");
  db.prepare("UPDATE transactions SET purpose_origin = 'manual' WHERE purpose IS NOT NULL").run();
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

let currentPriceCache = { expiresAt: 0, data: {} };

function asPositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function makeError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanPurpose(value) {
  if (value === null || value === undefined || value === "") return null;
  const cleaned = cleanLabel(value, 80);
  if (!cleaned) return null;
  return cleaned;
}

function decimal(value, decimals = 8) {
  return Math.round(Number(value || 0) * 10 ** decimals) / 10 ** decimals;
}

function isoFromUnix(seconds) {
  return Number.isFinite(Number(seconds)) ? new Date(Number(seconds) * 1000).toISOString() : null;
}

function isoDay(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

async function fetchJson(url, additionalHeaders = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "CryptoBuch/1.0", ...additionalHeaders },
      signal: AbortSignal.timeout(25000),
    });
  } catch (error) {
    throw makeError(`Externer Dienst nicht erreichbar: ${error.message}`, 502);
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw makeError("Die Blockchain-Datenquelle begrenzt Anfragen. Bitte kurz warten und die Synchronisierung erneut starten.", 429);
    }
    throw makeError(`Die Blockchain-Datenquelle ist momentan nicht verfügbar (HTTP ${response.status}).`, 502);
  }
  return response.json();
}

async function getCurrentPrices() {
  if (currentPriceCache.expiresAt > Date.now()) return currentPriceCache.data;

  try {
    const entries = Object.entries(CHAIN_CONFIG);
    const ids = entries.map(([, config]) => config.coinGeckoId).filter(Boolean).join(",");
    const data = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=eur&include_last_updated_at=true`);
    const prices = Object.fromEntries(entries.map(([chain, config]) => [chain, positiveNumber(data[config.coinGeckoId]?.eur)]));
    prices.updatedAt = Math.max(...entries.map(([, config]) => Number(data[config.coinGeckoId]?.last_updated_at || 0)), 0) || null;
    currentPriceCache = { data: prices, expiresAt: Date.now() + 5 * 60 * 1000 };
    return prices;
  } catch (error) {
    // An unavailable price service must not hide a locally stored portfolio.
    return {
      ...Object.fromEntries(Object.keys(CHAIN_CONFIG).map((chain) => [chain, null])),
      updatedAt: null,
      warning: error.message,
    };
  }
}

function cachedHistoricalPrice(coinId, date) {
  const row = db.prepare("SELECT price_eur FROM price_history WHERE coin_id = ? AND price_date = ?").get(coinId, date);
  return row ? Number(row.price_eur) : null;
}

function saveHistoricalPrice(coinId, date, price) {
  if (!Number.isFinite(price) || price <= 0) return;
  db.prepare(`
    INSERT INTO price_history (coin_id, price_date, price_eur, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(coin_id, price_date) DO UPDATE SET price_eur = excluded.price_eur, updated_at = excluded.updated_at
  `).run(coinId, date, price);
}

async function hydrateHistoricalPrices(chain, timestamps) {
  const coinId = CHAIN_CONFIG[chain]?.coinGeckoId;
  const dates = [...new Set(timestamps.filter(Boolean).map(isoDay))].sort();
  if (!coinId || dates.length === 0) return new Map();

  const result = new Map();
  const missing = [];
  for (const date of dates) {
    const cached = cachedHistoricalPrice(coinId, date);
    if (cached) result.set(date, cached);
    else missing.push(date);
  }
  if (missing.length === 0) return result;

  // The public chart endpoint can omit dates from very large time spans. Query
  // only compact, date-driven windows so old portfolio records are backfilled.
  const ranges = [];
  const maxRangeMs = 330 * 86400000;
  let range = [];
  let rangeStart = 0;
  for (const date of missing) {
    const at = new Date(`${date}T00:00:00.000Z`).getTime();
    if (range.length && at - rangeStart > maxRangeMs) {
      ranges.push(range);
      range = [];
    }
    if (range.length === 0) rangeStart = at;
    range.push(date);
  }
  if (range.length) ranges.push(range);

  for (const requestedDates of ranges) {
    const from = Math.floor(new Date(`${requestedDates[0]}T00:00:00.000Z`).getTime() / 1000) - 86400;
    const to = Math.floor(new Date(`${requestedDates.at(-1)}T23:59:59.999Z`).getTime() / 1000) + 86400;
    try {
      const payload = await fetchJson(
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=eur&from=${from}&to=${to}`,
      );
      const samples = Array.isArray(payload.prices) ? payload.prices : [];
      for (const date of requestedDates) {
        const target = new Date(`${date}T12:00:00.000Z`).getTime();
        let closest = null;
        let distance = Number.POSITIVE_INFINITY;
        for (const [at, price] of samples) {
          const nextDistance = Math.abs(Number(at) - target);
          if (nextDistance < distance) {
            closest = Number(price);
            distance = nextDistance;
          }
        }
        // Daily samples are accepted only if they are close enough to the requested day.
        if (Number.isFinite(closest) && closest > 0 && distance <= 3 * 86400000) {
          saveHistoricalPrice(coinId, date, closest);
          result.set(date, closest);
        }
      }
    } catch (_) {
      // Historic price is optional metadata. The transaction itself remains usable.
    }
  }
  return result;
}

function hasBitcoinAddressActivity(summary) {
  return Number(summary.chain_stats?.tx_count || 0) + Number(summary.mempool_stats?.tx_count || 0) > 0;
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchBitcoinTransactions(address, maxTransactions = MAX_TRANSACTIONS_PER_SYNC) {
  const base = `${BITCOIN_EXPLORER_BASE_URL}/address/${encodeURIComponent(address)}`;
  const output = [];
  const seen = new Set();
  const add = (items) => {
    for (const item of items) {
      if (!seen.has(item.txid)) {
        seen.add(item.txid);
        output.push(item);
      }
    }
  };

  add(await fetchJson(`${base}/txs/mempool`));
  let lastSeenTxid = null;
  while (true) {
    if (maxTransactions && output.length >= maxTransactions) break;
    const page = await fetchJson(`${base}/txs/chain${lastSeenTxid ? `/${lastSeenTxid}` : ""}`);
    if (!Array.isArray(page) || page.length === 0) break;
    add(page);
    if (page.length < 25) break;
    lastSeenTxid = page.at(-1).txid;
  }
  return maxTransactions ? output.slice(0, maxTransactions) : output;
}

async function discoverXpubAddresses(wallet) {
  const discovered = [];
  const saveAddress = db.prepare(`
    INSERT INTO wallet_addresses (wallet_id, address, branch, derivation_index, is_used, last_checked_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(wallet_id, address) DO UPDATE SET
      is_used = excluded.is_used,
      last_checked_at = datetime('now')
  `);
  let capped = false;

  for (const branch of [0, 1]) {
    let unusedInARow = 0;
    for (let index = 0; index < XPUB_MAX_DERIVATIONS_PER_BRANCH && unusedInARow < XPUB_GAP_LIMIT; index += 1) {
      const address = deriveXpubAddress(wallet.address, branch, index, wallet.xpub_address_type);
      const summary = await fetchJson(`${BITCOIN_EXPLORER_BASE_URL}/address/${encodeURIComponent(address)}`);
      const isUsed = hasBitcoinAddressActivity(summary);
      saveAddress.run(wallet.id, address, branch, index, isUsed ? 1 : 0);
      if (isUsed) {
        discovered.push(address);
        unusedInARow = 0;
      } else {
        unusedInARow += 1;
      }
      // The public Esplora service is intentionally queried gently during an xPub scan.
      if (unusedInARow < XPUB_GAP_LIMIT) await pause(120);
    }
    if (unusedInARow < XPUB_GAP_LIMIT) capped = true;
  }
  return { addresses: discovered, capped };
}

async function fetchBitcoinTransactionsForAddresses(addresses) {
  const transactions = new Map();
  for (const address of addresses) {
    const remaining = MAX_TRANSACTIONS_PER_SYNC ? MAX_TRANSACTIONS_PER_SYNC - transactions.size : 0;
    if (MAX_TRANSACTIONS_PER_SYNC && remaining <= 0) break;
    const items = await fetchBitcoinTransactions(address, remaining);
    for (const transaction of items) transactions.set(transaction.txid, transaction);
  }
  return [...transactions.values()];
}

async function fetchTezosTransactions(address) {
  const output = [];
  const limit = 1000;
  let offset = 0;
  while (true) {
    if (MAX_TRANSACTIONS_PER_SYNC && output.length >= MAX_TRANSACTIONS_PER_SYNC) break;
    const query = new URLSearchParams({
      "anyof.sender.target": address,
      "sort.desc": "id",
      limit: String(limit),
      offset: String(offset),
      // TzKT derives this EUR value at the block timestamp, avoiding a broad
      // secondary price lookup for every Tezos transaction.
      quote: "eur",
    });
    const page = await fetchJson(`https://api.tzkt.io/v1/operations/transactions?${query.toString()}`);
    if (!Array.isArray(page) || page.length === 0) break;
    output.push(...page);
    if (page.length < limit) break;
    offset += page.length;
  }
  return MAX_TRANSACTIONS_PER_SYNC ? output.slice(0, MAX_TRANSACTIONS_PER_SYNC) : output;
}

async function fetchTronTransactions(address) {
  const output = [];
  let fingerprint = null;
  const pageSize = 200;
  const headers = TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {};

  while (true) {
    if (MAX_TRANSACTIONS_PER_SYNC && output.length >= MAX_TRANSACTIONS_PER_SYNC) break;
    const query = new URLSearchParams({
      only_confirmed: "true",
      limit: String(pageSize),
      order_by: "block_timestamp,desc",
    });
    if (fingerprint) query.set("fingerprint", fingerprint);
    const payload = await fetchJson(
      `${TRONGRID_BASE_URL}/v1/accounts/${encodeURIComponent(address)}/transactions?${query.toString()}`,
      headers,
    );
    const page = Array.isArray(payload.data) ? payload.data : [];
    if (page.length === 0) break;
    output.push(...page);
    const nextFingerprint = payload.meta?.fingerprint;
    if (page.length < pageSize || !nextFingerprint || nextFingerprint === fingerprint) break;
    fingerprint = nextFingerprint;
  }
  return MAX_TRANSACTIONS_PER_SYNC ? output.slice(0, MAX_TRANSACTIONS_PER_SYNC) : output;
}

function normalizeBitcoinTransaction(transaction, addresses) {
  const isWalletAddress = (address) => Boolean(address && addresses.has(address));
  const inputAmount = transaction.vin.reduce(
    (sum, input) => sum + (isWalletAddress(input.prevout?.scriptpubkey_address) ? Number(input.prevout.value || 0) : 0),
    0,
  );
  const outputAmount = transaction.vout.reduce(
    (sum, output) => sum + (isWalletAddress(output.scriptpubkey_address) ? Number(output.value || 0) : 0),
    0,
  );
  const net = outputAmount - inputAmount;
  const direction = net > 0 ? "in" : net < 0 ? "out" : "self";
  const otherOutput = transaction.vout.find((output) => output.scriptpubkey_address && !isWalletAddress(output.scriptpubkey_address));
  const otherInput = transaction.vin.find((input) => input.prevout?.scriptpubkey_address && !isWalletAddress(input.prevout.scriptpubkey_address));

  return {
    externalId: transaction.txid,
    hash: transaction.txid,
    timestamp: transaction.status?.confirmed ? isoFromUnix(transaction.status.block_time) : null,
    direction,
    asset: "BTC",
    amount: decimal(Math.abs(net) / 100000000),
    fee: direction === "out" ? decimal(Number(transaction.fee || 0) / 100000000) : 0,
    counterparty: direction === "in" ? otherInput?.prevout?.scriptpubkey_address || null : otherOutput?.scriptpubkey_address || null,
    historicalPrice: null,
    autoPurpose: null,
    rawJson: JSON.stringify(transaction),
  };
}

function normalizeTezosTransaction(transaction, address) {
  const sender = transaction.sender?.address || null;
  const target = transaction.target?.address || null;
  const direction = sender === address && target === address ? "self" : sender === address ? "out" : "in";
  const feeMutez = [transaction.bakerFee, transaction.storageFee, transaction.allocationFee, transaction.revealFee]
    .reduce((sum, fee) => sum + Number(fee || 0), 0);

  return {
    externalId: String(transaction.id || `${transaction.hash}:${transaction.counter || 0}`),
    hash: transaction.hash || String(transaction.id),
    timestamp: transaction.timestamp || null,
    direction,
    asset: "XTZ",
    amount: decimal(Number(transaction.amount || 0) / 1000000, 6),
    fee: direction === "out" ? decimal(feeMutez / 1000000, 6) : 0,
    counterparty: direction === "in" ? sender : target,
    historicalPrice: positiveNumber(transaction.quote?.eur),
    autoPurpose: isConfirmedStakingPayout(transaction, address, XTZ_STAKING_PAYOUT_ALIASES) ? "Staking Rewards" : null,
    rawJson: JSON.stringify(transaction),
  };
}

const CHAIN_ADAPTERS = {
  BTC: {
    async load(wallet) {
      if (wallet.source_type === "xpub") {
        const discovery = await discoverXpubAddresses(wallet);
        return {
          rawTransactions: await fetchBitcoinTransactionsForAddresses(discovery.addresses),
          context: new Set(discovery.addresses),
          xpubCapped: discovery.capped,
        };
      }
      return {
        rawTransactions: await fetchBitcoinTransactions(wallet.address),
        context: new Set([wallet.address]),
        xpubCapped: false,
      };
    },
    normalize: normalizeBitcoinTransaction,
  },
  XTZ: {
    async load(wallet) {
      return { rawTransactions: await fetchTezosTransactions(wallet.address), context: wallet.address, xpubCapped: false };
    },
    normalize: normalizeTezosTransaction,
  },
  TRX: {
    async load(wallet) {
      return { rawTransactions: await fetchTronTransactions(wallet.address), context: wallet.address, xpubCapped: false };
    },
    normalize: normalizeTronNativeTransfer,
  },
};

function getWallet(id) {
  const wallet = db.prepare("SELECT * FROM wallets WHERE id = ?").get(id);
  if (!wallet) throw makeError("Wallet nicht gefunden.", 404);
  return wallet;
}

async function syncWallet(wallet) {
  const adapter = CHAIN_ADAPTERS[wallet.chain];
  if (!adapter) throw makeError("Für diese Blockchain ist keine Synchronisierung eingerichtet.");
  const { rawTransactions, context, xpubCapped } = await adapter.load(wallet);
  const transactions = rawTransactions.map((item) => adapter.normalize(item, context)).filter(Boolean);
  const pricesByDate = await hydrateHistoricalPrices(
    wallet.chain,
    transactions.filter((transaction) => !positiveNumber(transaction.historicalPrice)).map((transaction) => transaction.timestamp),
  );

  const existingTransaction = db.prepare(
    "SELECT price_transaction_eur, purpose, purpose_origin FROM transactions WHERE wallet_id = ? AND external_id = ?",
  );
  const upsert = db.prepare(`
    INSERT INTO transactions (
      wallet_id, external_id, hash, timestamp, direction, asset, amount, fee, counterparty,
      price_transaction_eur, purpose, purpose_origin, raw_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(wallet_id, external_id) DO UPDATE SET
      hash = excluded.hash,
      timestamp = excluded.timestamp,
      direction = excluded.direction,
      asset = excluded.asset,
      amount = excluded.amount,
      fee = excluded.fee,
      counterparty = excluded.counterparty,
      price_transaction_eur = COALESCE(excluded.price_transaction_eur, transactions.price_transaction_eur),
      purpose = CASE
        WHEN transactions.purpose_origin = 'manual' THEN transactions.purpose
        WHEN excluded.purpose IS NOT NULL THEN excluded.purpose
        ELSE transactions.purpose
      END,
      purpose_origin = CASE
        WHEN transactions.purpose_origin = 'manual' THEN 'manual'
        WHEN excluded.purpose IS NOT NULL THEN 'auto'
        ELSE transactions.purpose_origin
      END,
      raw_json = excluded.raw_json,
      updated_at = datetime('now')
  `);

  let imported = 0;
  db.exec("BEGIN");
  try {
    for (const transaction of transactions) {
      const existing = existingTransaction.get(wallet.id, transaction.externalId);
      const historicPrice = positiveNumber(transaction.historicalPrice)
        ?? positiveNumber(existing?.price_transaction_eur)
        ?? (transaction.timestamp ? positiveNumber(pricesByDate.get(isoDay(transaction.timestamp))) : null);
      upsert.run(
        wallet.id,
        transaction.externalId,
        transaction.hash,
        transaction.timestamp,
        transaction.direction,
        transaction.asset,
        transaction.amount,
        transaction.fee,
        transaction.counterparty,
        historicPrice,
        transaction.autoPurpose,
        transaction.autoPurpose ? "auto" : "unspecified",
        transaction.rawJson,
      );
      imported += 1;
    }
    db.prepare("UPDATE wallets SET last_synced_at = datetime('now') WHERE id = ?").run(wallet.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    imported,
    limited: Boolean(MAX_TRANSACTIONS_PER_SYNC && rawTransactions.length >= MAX_TRANSACTIONS_PER_SYNC),
    xpubCapped,
  };
}

async function portfolioResponse() {
  const wallets = db.prepare("SELECT * FROM wallets ORDER BY created_at DESC").all();
  const transactions = db.prepare(`
    SELECT t.*, w.chain, w.address, w.source_type, w.label AS wallet_label
    FROM transactions t
    JOIN wallets w ON w.id = t.wallet_id
    ORDER BY CASE WHEN t.timestamp IS NULL THEN 0 ELSE 1 END, t.timestamp DESC, t.id DESC
  `).all();
  const currentPrices = await getCurrentPrices();
  const enriched = transactions.map((transaction) => ({
    ...transaction,
    price_now_eur: currentPrices[transaction.chain] || null,
  }));
  const holdings = Object.fromEntries(Object.values(CHAIN_CONFIG).map((chain) => [chain.asset, 0]));
  for (const transaction of enriched) {
    const sign = transaction.direction === "in" ? 1 : transaction.direction === "out" ? -1 : 0;
    holdings[transaction.asset] = Number(holdings[transaction.asset] || 0) + sign * Number(transaction.amount);
  }
  const totalValueEur = Object.entries(holdings).reduce(
    (sum, [asset, amount]) => sum + amount * Number(currentPrices[asset] || 0),
    0,
  );

  return {
    wallets,
    transactions: enriched,
    holdings,
    totalValueEur,
    currentPrices,
    purposePresets: PURPOSE_PRESETS,
    chains: Object.fromEntries(Object.entries(CHAIN_CONFIG).map(([key, value]) => [key, {
      name: value.name,
      asset: value.asset,
      decimals: value.decimals,
      icon: value.icon,
      addressPlaceholder: value.addressPlaceholder,
      addressHint: value.addressHint,
      supportsXpub: key === "BTC",
      explorer: value.explorer,
    }])),
  };
}

app.get("/api/portfolio", async (_request, response, next) => {
  try {
    response.json(await portfolioResponse());
  } catch (error) {
    next(error);
  }
});

app.post("/api/wallets", (request, response, next) => {
  try {
    const chain = String(request.body?.chain || "").toUpperCase();
    const sourceType = String(request.body?.sourceType || "address").toLowerCase();
    const address = cleanLabel(request.body?.address, 120);
    const label = cleanLabel(request.body?.label, 80);
    const xpubAddressType = String(request.body?.xpubAddressType || "p2wpkh").toLowerCase();
    if (!CHAIN_CONFIG[chain]) throw makeError("Bitte eine unterstützte Blockchain auswählen.");
    if (!['address', 'xpub'].includes(sourceType)) throw makeError("Nicht unterstützte Wallet-Art.");
    if (sourceType === "xpub") {
      if (chain !== "BTC") throw makeError("xPub wird nur für Bitcoin unterstützt.");
      if (!XPUB_ADDRESS_TYPES.has(xpubAddressType)) throw makeError("Bitte ein unterstütztes Bitcoin-Adressformat auswählen.");
      try {
        parseXpub(address);
      } catch (error) {
        throw makeError(error.message);
      }
    } else if (!isValidAddress(chain, address)) {
      throw makeError(`Die ${CHAIN_CONFIG[chain].name}-Adresse hat kein unterstütztes Format.`);
    }

    const result = db.prepare(
      "INSERT INTO wallets (chain, address, label, source_type, xpub_address_type) VALUES (?, ?, ?, ?, ?)",
    ).run(chain, address, label, sourceType, sourceType === "xpub" ? xpubAddressType : null);
    const wallet = getWallet(Number(result.lastInsertRowid));
    response.status(201).json(wallet);
  } catch (error) {
    if (String(error.message).includes("UNIQUE constraint failed")) {
      next(makeError("Diese Wallet ist bereits im Portfolio vorhanden.", 409));
      return;
    }
    next(error);
  }
});

app.delete("/api/wallets/:id", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Wallet-ID.");
    getWallet(id);
    db.prepare("DELETE FROM wallets WHERE id = ?").run(id);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/wallets/:id/sync", async (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Wallet-ID.");
    const result = await syncWallet(getWallet(id));
    response.json(result);
  } catch (error) {
    next(error);
  }
});

// Static route first: otherwise Express interprets "bulk" as the :id parameter.
app.patch("/api/transactions/bulk", (request, response, next) => {
  try {
    const purpose = cleanPurpose(request.body?.purpose);
    const ids = Array.isArray(request.body?.ids) ? [...new Set(request.body.ids.map(asPositiveId).filter(Boolean))] : [];
    if (ids.length === 0) throw makeError("Bitte mindestens eine Transaktion auswählen.");
    if (ids.length > 2500) throw makeError("Maximal 2.500 Transaktionen gleichzeitig bearbeiten.");
    const placeholders = ids.map(() => "?").join(", ");
    const result = db.prepare(`UPDATE transactions SET purpose = ?, purpose_origin = 'manual', updated_at = datetime('now') WHERE id IN (${placeholders})`).run(purpose, ...ids);
    response.json({ updated: result.changes, purpose, purpose_origin: "manual" });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/transactions/:id", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    const purpose = cleanPurpose(request.body?.purpose);
    if (!id) throw makeError("Ungültige Transaktions-ID.");
    const updated = db.prepare("UPDATE transactions SET purpose = ?, purpose_origin = 'manual', updated_at = datetime('now') WHERE id = ?").run(purpose, id);
    if (!updated.changes) throw makeError("Transaktion nicht gefunden.", 404);
    response.json({ id, purpose, purpose_origin: "manual" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/explorer/:chain/address/:address", (request, response, next) => {
  try {
    const chain = String(request.params.chain || "").toUpperCase();
    if (!CHAIN_CONFIG[chain] || !isValidAddress(chain, request.params.address)) throw makeError("Ungültiger Explorer-Link.");
    response.json({ url: CHAIN_CONFIG[chain].explorerAddress(request.params.address) });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: "1h" }));
app.get("*splat", (_request, response) => response.sendFile(path.join(__dirname, "public", "index.html")));

app.use((error, _request, response, _next) => {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(error);
  response.status(status).json({ error: status >= 500 ? "Der Vorgang konnte nicht abgeschlossen werden." : error.message });
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`CryptoBuch läuft auf http://0.0.0.0:${PORT}`);
  });
}

module.exports = { app, db };
