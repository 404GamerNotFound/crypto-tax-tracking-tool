const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  XPUB_ADDRESS_TYPES,
  deriveXpubAddress,
  inspectXpub,
  isExtendedPublicKey,
  normalizeExtendedPublicKey,
} = require("./lib/bitcoin-xpub");
const { CHAIN_CONFIG, cleanLabel, isValidAddress, isValidCardanoStakeAddress } = require("./lib/validation");
const { isConfirmedStakingPayout, trustedPayoutAliases } = require("./lib/tezos-staking");
const { normalizeTronNativeTransfer } = require("./lib/tron");
const { normalizeCardanoTransaction } = require("./lib/cardano");
const { normalizeEthereumTransaction, normalizeErc20Transfer } = require("./lib/ethereum");
const { buildTopMarketCatalog } = require("./lib/market-catalog");
const {
  bitvavoDailyClosePrices,
  coinGeckoDate,
  coinGeckoHeaders,
  closestPriceForDate,
  needsExtendedCoinGeckoHistory,
  usesCoinGeckoPro,
} = require("./lib/historical-prices");
const {
  normalizeEvmNativeTransfer,
  normalizeSolscanTransfer,
  normalizeXrpPayment,
  normalizeStellarPayment,
  normalizeNearTransfer,
  normalizeTonMessage,
  normalizeBlockchairUtxoTransaction,
} = require("./lib/additional-chains");

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "cryptobuch.sqlite");
const DEFAULT_XPUB_GAP_LIMIT = boundedInteger(process.env.XPUB_GAP_LIMIT, 20, 1, 50);
const SETTINGS_DEFAULTS = Object.freeze({
  maxTransactionsPerSync: boundedInteger(process.env.MAX_TRANSACTIONS_PER_SYNC, 0, 0, 100000),
  bulkPurposeLimit: 2500,
  bitcoinExplorerBaseUrl: (process.env.BITCOIN_EXPLORER_BASE_URL || "https://blockstream.info/api").replace(/\/$/, ""),
  tzktApiBaseUrl: (process.env.TZKT_API_BASE_URL || "https://api.tzkt.io/v1").replace(/\/$/, ""),
  tronGridBaseUrl: (process.env.TRONGRID_BASE_URL || "https://api.trongrid.io").replace(/\/$/, ""),
  blockfrostBaseUrl: (process.env.BLOCKFROST_BASE_URL || "https://cardano-mainnet.blockfrost.io/api/v0").replace(/\/$/, ""),
  etherscanApiBaseUrl: (process.env.ETHERSCAN_API_BASE_URL || "https://api.etherscan.io/v2/api").replace(/\/$/, ""),
  bscScanApiBaseUrl: (process.env.BSCSCAN_API_BASE_URL || "https://api.bscscan.com/api").replace(/\/$/, ""),
  snowtraceApiBaseUrl: (process.env.SNOWTRACE_API_BASE_URL || "https://api.snowtrace.io/api").replace(/\/$/, ""),
  solscanApiBaseUrl: (process.env.SOLSCAN_API_BASE_URL || "https://pro-api.solscan.io/v2.0").replace(/\/$/, ""),
  xrplRpcUrl: (process.env.XRPL_RPC_URL || "https://xrplcluster.com/").replace(/\/$/, ""),
  stellarHorizonBaseUrl: (process.env.STELLAR_HORIZON_BASE_URL || "https://horizon.stellar.org").replace(/\/$/, ""),
  nearBlocksApiBaseUrl: (process.env.NEARBLOCKS_API_BASE_URL || "https://api.nearblocks.io/v1").replace(/\/$/, ""),
  tonApiBaseUrl: (process.env.TONAPI_BASE_URL || "https://tonapi.io/v2").replace(/\/$/, ""),
  blockchairApiBaseUrl: (process.env.BLOCKCHAIR_API_BASE_URL || "https://api.blockchair.com").replace(/\/$/, ""),
  blockCypherApiBaseUrl: (process.env.BLOCKCYPHER_API_BASE_URL || "https://api.blockcypher.com/v1").replace(/\/$/, ""),
  coinGeckoBaseUrl: (process.env.COINGECKO_API_BASE_URL || "https://api.coingecko.com/api/v3").replace(/\/$/, ""),
  bitvavoApiBaseUrl: (process.env.BITVAVO_API_BASE_URL || "https://api.bitvavo.com/v2").replace(/\/$/, ""),
  tronGridApiKey: String(process.env.TRONGRID_API_KEY || "").trim(),
  blockfrostProjectId: String(process.env.BLOCKFROST_PROJECT_ID || "").trim(),
  etherscanApiKey: String(process.env.ETHERSCAN_API_KEY || "").trim(),
  bscScanApiKey: String(process.env.BSCSCAN_API_KEY || "").trim(),
  snowtraceApiKey: String(process.env.SNOWTRACE_API_KEY || "").trim(),
  solscanApiKey: String(process.env.SOLSCAN_API_KEY || "").trim(),
  nearBlocksApiKey: String(process.env.NEARBLOCKS_API_KEY || "").trim(),
  tonApiKey: String(process.env.TONAPI_KEY || "").trim(),
  blockchairApiKey: String(process.env.BLOCKCHAIR_API_KEY || "").trim(),
  blockCypherApiToken: String(process.env.BLOCKCYPHER_API_TOKEN || "").trim(),
  coinGeckoApiKey: String(process.env.COINGECKO_API_KEY || "").trim(),
  xpubGapLimit: DEFAULT_XPUB_GAP_LIMIT,
  xpubMaxDerivationsPerBranch: boundedInteger(process.env.XPUB_MAX_DERIVATIONS_PER_BRANCH, 200, DEFAULT_XPUB_GAP_LIMIT, 1000),
  xtzStakingPayoutAliases: String(process.env.XTZ_STAKING_PAYOUT_ALIASES || "Stake.fish Payouts").trim(),
});
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
    chain TEXT NOT NULL,
    address TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'address' CHECK (source_type IN ('address', 'xpub', 'stake')),
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
    asset_symbol TEXT,
    asset_name TEXT,
    asset_decimals INTEGER,
    asset_contract TEXT,
    amount REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    fee_asset TEXT,
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
  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_transactions_wallet_timestamp
    ON transactions(wallet_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_purpose
    ON transactions(purpose) WHERE purpose IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_wallet_addresses_wallet_branch_index
    ON wallet_addresses(wallet_id, branch, derivation_index);
  PRAGMA optimize;
`);

function migrateWalletSchemaForChains() {
  const walletSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'wallets'").get()?.sql || "";
  if (!walletSql.includes("CHECK (chain IN")) return;
  const walletColumns = new Set(db.prepare("PRAGMA table_info(wallets)").all().map((column) => column.name));
  const sourceType = walletColumns.has("source_type") ? "source_type" : "'address'";
  const xpubAddressType = walletColumns.has("xpub_address_type") ? "xpub_address_type" : "NULL";

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE wallets_chain_migration (
      id INTEGER PRIMARY KEY,
      chain TEXT NOT NULL,
      address TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'address' CHECK (source_type IN ('address', 'xpub', 'stake')),
      xpub_address_type TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_synced_at TEXT,
      UNIQUE(chain, address)
    );
    INSERT INTO wallets_chain_migration (id, chain, address, label, source_type, xpub_address_type, created_at, last_synced_at)
    SELECT id, chain, address, label,
      COALESCE(${sourceType}, 'address'), ${xpubAddressType}, created_at, last_synced_at
    FROM wallets;
    DROP TABLE wallets;
    ALTER TABLE wallets_chain_migration RENAME TO wallets;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

migrateWalletSchemaForChains();

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
if (!transactionColumnNames.has("asset_symbol")) db.exec("ALTER TABLE transactions ADD COLUMN asset_symbol TEXT");
if (!transactionColumnNames.has("asset_name")) db.exec("ALTER TABLE transactions ADD COLUMN asset_name TEXT");
if (!transactionColumnNames.has("asset_decimals")) db.exec("ALTER TABLE transactions ADD COLUMN asset_decimals INTEGER");
if (!transactionColumnNames.has("asset_contract")) db.exec("ALTER TABLE transactions ADD COLUMN asset_contract TEXT");
if (!transactionColumnNames.has("fee_asset")) db.exec("ALTER TABLE transactions ADD COLUMN fee_asset TEXT");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

let currentPriceCache = { expiresAt: 0, data: {} };
let tokenPriceCache = { expiresAt: 0, data: {} };
let topMarketCache = { expiresAt: 0, data: null };

function asPositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function makeError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanServiceUrl(value, label) {
  const candidate = String(value || "").trim();
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.toString().replace(/\/$/, "");
  } catch (_) {
    throw makeError(`${label} muss eine vollständige HTTP(S)-Adresse sein.`);
  }
}

function cleanAliases(value) {
  if (typeof value !== "string") return "";
  return [...new Set(value.split(",").map((item) => cleanLabel(item, 80)).filter(Boolean))].join(", ");
}

function seedSettings() {
  const upsert = db.prepare(`
    INSERT INTO app_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(setting_key) DO NOTHING
  `);
  for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) upsert.run(key, String(value));
}

function rawSettings() {
  const values = Object.fromEntries(
    db.prepare("SELECT setting_key, setting_value FROM app_settings").all().map((row) => [row.setting_key, row.setting_value]),
  );
  return { ...Object.fromEntries(Object.entries(SETTINGS_DEFAULTS).map(([key, value]) => [key, String(value)])), ...values };
}

function runtimeSettings() {
  const values = rawSettings();
  const xpubGapLimit = boundedInteger(values.xpubGapLimit, SETTINGS_DEFAULTS.xpubGapLimit, 1, 50);
  return {
    maxTransactionsPerSync: boundedInteger(values.maxTransactionsPerSync, SETTINGS_DEFAULTS.maxTransactionsPerSync, 0, 100000),
    bulkPurposeLimit: boundedInteger(values.bulkPurposeLimit, SETTINGS_DEFAULTS.bulkPurposeLimit, 1, 2500),
    bitcoinExplorerBaseUrl: values.bitcoinExplorerBaseUrl || SETTINGS_DEFAULTS.bitcoinExplorerBaseUrl,
    tzktApiBaseUrl: values.tzktApiBaseUrl || SETTINGS_DEFAULTS.tzktApiBaseUrl,
    tronGridBaseUrl: values.tronGridBaseUrl || SETTINGS_DEFAULTS.tronGridBaseUrl,
    blockfrostBaseUrl: values.blockfrostBaseUrl || SETTINGS_DEFAULTS.blockfrostBaseUrl,
    etherscanApiBaseUrl: values.etherscanApiBaseUrl || SETTINGS_DEFAULTS.etherscanApiBaseUrl,
    bscScanApiBaseUrl: values.bscScanApiBaseUrl || SETTINGS_DEFAULTS.bscScanApiBaseUrl,
    snowtraceApiBaseUrl: values.snowtraceApiBaseUrl || SETTINGS_DEFAULTS.snowtraceApiBaseUrl,
    solscanApiBaseUrl: values.solscanApiBaseUrl || SETTINGS_DEFAULTS.solscanApiBaseUrl,
    xrplRpcUrl: values.xrplRpcUrl || SETTINGS_DEFAULTS.xrplRpcUrl,
    stellarHorizonBaseUrl: values.stellarHorizonBaseUrl || SETTINGS_DEFAULTS.stellarHorizonBaseUrl,
    nearBlocksApiBaseUrl: values.nearBlocksApiBaseUrl || SETTINGS_DEFAULTS.nearBlocksApiBaseUrl,
    tonApiBaseUrl: values.tonApiBaseUrl || SETTINGS_DEFAULTS.tonApiBaseUrl,
    blockchairApiBaseUrl: values.blockchairApiBaseUrl || SETTINGS_DEFAULTS.blockchairApiBaseUrl,
    blockCypherApiBaseUrl: values.blockCypherApiBaseUrl || SETTINGS_DEFAULTS.blockCypherApiBaseUrl,
    coinGeckoBaseUrl: values.coinGeckoBaseUrl || SETTINGS_DEFAULTS.coinGeckoBaseUrl,
    bitvavoApiBaseUrl: values.bitvavoApiBaseUrl || SETTINGS_DEFAULTS.bitvavoApiBaseUrl,
    tronGridApiKey: values.tronGridApiKey || "",
    blockfrostProjectId: values.blockfrostProjectId || "",
    etherscanApiKey: values.etherscanApiKey || "",
    bscScanApiKey: values.bscScanApiKey || "",
    snowtraceApiKey: values.snowtraceApiKey || "",
    solscanApiKey: values.solscanApiKey || "",
    nearBlocksApiKey: values.nearBlocksApiKey || "",
    tonApiKey: values.tonApiKey || "",
    blockchairApiKey: values.blockchairApiKey || "",
    blockCypherApiToken: values.blockCypherApiToken || "",
    coinGeckoApiKey: values.coinGeckoApiKey || "",
    xpubGapLimit,
    xpubMaxDerivationsPerBranch: boundedInteger(values.xpubMaxDerivationsPerBranch, SETTINGS_DEFAULTS.xpubMaxDerivationsPerBranch, xpubGapLimit, 1000),
    xtzStakingPayoutAliases: values.xtzStakingPayoutAliases || "",
    trustedStakingPayoutAliases: trustedPayoutAliases(values.xtzStakingPayoutAliases || ""),
  };
}

function settingsResponse() {
  const settings = runtimeSettings();
  return {
    maxTransactionsPerSync: settings.maxTransactionsPerSync,
    bulkPurposeLimit: settings.bulkPurposeLimit,
    bitcoinExplorerBaseUrl: settings.bitcoinExplorerBaseUrl,
    tzktApiBaseUrl: settings.tzktApiBaseUrl,
    tronGridBaseUrl: settings.tronGridBaseUrl,
    blockfrostBaseUrl: settings.blockfrostBaseUrl,
    etherscanApiBaseUrl: settings.etherscanApiBaseUrl,
    bscScanApiBaseUrl: settings.bscScanApiBaseUrl,
    snowtraceApiBaseUrl: settings.snowtraceApiBaseUrl,
    solscanApiBaseUrl: settings.solscanApiBaseUrl,
    xrplRpcUrl: settings.xrplRpcUrl,
    stellarHorizonBaseUrl: settings.stellarHorizonBaseUrl,
    nearBlocksApiBaseUrl: settings.nearBlocksApiBaseUrl,
    tonApiBaseUrl: settings.tonApiBaseUrl,
    blockchairApiBaseUrl: settings.blockchairApiBaseUrl,
    blockCypherApiBaseUrl: settings.blockCypherApiBaseUrl,
    coinGeckoBaseUrl: settings.coinGeckoBaseUrl,
    bitvavoApiBaseUrl: settings.bitvavoApiBaseUrl,
    tronGridApiKeyConfigured: Boolean(settings.tronGridApiKey),
    blockfrostProjectIdConfigured: Boolean(settings.blockfrostProjectId),
    etherscanApiKeyConfigured: Boolean(settings.etherscanApiKey),
    bscScanApiKeyConfigured: Boolean(settings.bscScanApiKey),
    snowtraceApiKeyConfigured: Boolean(settings.snowtraceApiKey),
    solscanApiKeyConfigured: Boolean(settings.solscanApiKey),
    nearBlocksApiKeyConfigured: Boolean(settings.nearBlocksApiKey),
    tonApiKeyConfigured: Boolean(settings.tonApiKey),
    blockchairApiKeyConfigured: Boolean(settings.blockchairApiKey),
    blockCypherApiTokenConfigured: Boolean(settings.blockCypherApiToken),
    coinGeckoApiKeyConfigured: Boolean(settings.coinGeckoApiKey),
    xpubGapLimit: settings.xpubGapLimit,
    xpubMaxDerivationsPerBranch: settings.xpubMaxDerivationsPerBranch,
    xtzStakingPayoutAliases: settings.xtzStakingPayoutAliases,
  };
}

function updateSettings(input) {
  const current = runtimeSettings();
  const maxTransactionsPerSync = boundedInteger(input.maxTransactionsPerSync, current.maxTransactionsPerSync, 0, 100000);
  if (String(input.maxTransactionsPerSync ?? "") !== "" && Number(input.maxTransactionsPerSync) !== maxTransactionsPerSync) {
    throw makeError("Das Transaktionslimit muss eine ganze Zahl zwischen 0 und 100.000 sein.");
  }
  const xpubGapLimit = boundedInteger(input.xpubGapLimit, current.xpubGapLimit, 1, 50);
  if (Number(input.xpubGapLimit) !== xpubGapLimit) throw makeError("Das xPub-Gap-Limit muss zwischen 1 und 50 liegen.");
  const xpubMaxDerivationsPerBranch = boundedInteger(input.xpubMaxDerivationsPerBranch, current.xpubMaxDerivationsPerBranch, xpubGapLimit, 1000);
  if (Number(input.xpubMaxDerivationsPerBranch) !== xpubMaxDerivationsPerBranch) {
    throw makeError("Die xPub-Sicherheitsgrenze muss mindestens dem Gap-Limit entsprechen und darf höchstens 1.000 sein.");
  }
  const bulkPurposeLimit = boundedInteger(input.bulkPurposeLimit, current.bulkPurposeLimit, 1, 2500);
  if (Number(input.bulkPurposeLimit) !== bulkPurposeLimit) throw makeError("Das Limit für die Sammelbearbeitung muss zwischen 1 und 2.500 liegen.");

  const next = {
    maxTransactionsPerSync,
    bulkPurposeLimit,
    bitcoinExplorerBaseUrl: cleanServiceUrl(input.bitcoinExplorerBaseUrl, "Die Bitcoin-Explorer-URL"),
    tzktApiBaseUrl: cleanServiceUrl(input.tzktApiBaseUrl, "Die TzKT-URL"),
    tronGridBaseUrl: cleanServiceUrl(input.tronGridBaseUrl, "Die TronGrid-URL"),
    blockfrostBaseUrl: cleanServiceUrl(input.blockfrostBaseUrl, "Die Blockfrost-URL"),
    etherscanApiBaseUrl: cleanServiceUrl(input.etherscanApiBaseUrl, "Die Etherscan-URL"),
    bscScanApiBaseUrl: cleanServiceUrl(input.bscScanApiBaseUrl, "Die BscScan-URL"),
    snowtraceApiBaseUrl: cleanServiceUrl(input.snowtraceApiBaseUrl, "Die Snowtrace-URL"),
    solscanApiBaseUrl: cleanServiceUrl(input.solscanApiBaseUrl, "Die Solscan-URL"),
    xrplRpcUrl: cleanServiceUrl(input.xrplRpcUrl, "Die XRPL-RPC-URL"),
    stellarHorizonBaseUrl: cleanServiceUrl(input.stellarHorizonBaseUrl, "Die Stellar-Horizon-URL"),
    nearBlocksApiBaseUrl: cleanServiceUrl(input.nearBlocksApiBaseUrl, "Die NearBlocks-URL"),
    tonApiBaseUrl: cleanServiceUrl(input.tonApiBaseUrl, "Die TonAPI-URL"),
    blockchairApiBaseUrl: cleanServiceUrl(input.blockchairApiBaseUrl, "Die Blockchair-URL"),
    blockCypherApiBaseUrl: cleanServiceUrl(input.blockCypherApiBaseUrl, "Die BlockCypher-URL"),
    coinGeckoBaseUrl: cleanServiceUrl(input.coinGeckoBaseUrl, "Die CoinGecko-URL"),
    bitvavoApiBaseUrl: cleanServiceUrl(input.bitvavoApiBaseUrl, "Die Bitvavo-URL"),
    xpubGapLimit,
    xpubMaxDerivationsPerBranch,
    xtzStakingPayoutAliases: cleanAliases(input.xtzStakingPayoutAliases),
    tronGridApiKey: input.clearTronGridApiKey ? "" : String(input.tronGridApiKey || "").trim() || current.tronGridApiKey,
    blockfrostProjectId: input.clearBlockfrostProjectId ? "" : String(input.blockfrostProjectId || "").trim() || current.blockfrostProjectId,
    etherscanApiKey: input.clearEtherscanApiKey ? "" : String(input.etherscanApiKey || "").trim() || current.etherscanApiKey,
    bscScanApiKey: input.clearAdditionalNetworkApiKeys ? "" : String(input.bscScanApiKey || "").trim() || current.bscScanApiKey,
    snowtraceApiKey: input.clearAdditionalNetworkApiKeys ? "" : String(input.snowtraceApiKey || "").trim() || current.snowtraceApiKey,
    solscanApiKey: input.clearAdditionalNetworkApiKeys ? "" : String(input.solscanApiKey || "").trim() || current.solscanApiKey,
    nearBlocksApiKey: input.clearAdditionalNetworkApiKeys ? "" : String(input.nearBlocksApiKey || "").trim() || current.nearBlocksApiKey,
    tonApiKey: input.clearAdditionalNetworkApiKeys ? "" : String(input.tonApiKey || "").trim() || current.tonApiKey,
    blockchairApiKey: input.clearAdditionalNetworkApiKeys ? "" : String(input.blockchairApiKey || "").trim() || current.blockchairApiKey,
    blockCypherApiToken: input.clearAdditionalNetworkApiKeys ? "" : String(input.blockCypherApiToken || "").trim() || current.blockCypherApiToken,
    coinGeckoApiKey: input.clearCoinGeckoApiKey ? "" : String(input.coinGeckoApiKey || "").trim() || current.coinGeckoApiKey,
  };
  if (next.tronGridApiKey.length > 300) throw makeError("Der TronGrid-API-Key ist zu lang.");
  if (next.blockfrostProjectId.length > 300) throw makeError("Die Blockfrost Project-ID ist zu lang.");
  if (next.etherscanApiKey.length > 300) throw makeError("Der Etherscan-API-Key ist zu lang.");
  for (const [key, value] of Object.entries(next).filter(([key]) => /(?:ApiKey|ApiToken)$/.test(key))) {
    if (String(value).length > 300) throw makeError(`Der Wert für ${key} ist zu lang.`);
  }

  const upsert = db.prepare(`
    INSERT INTO app_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now')
  `);
  db.exec("BEGIN");
  try {
    for (const [key, value] of Object.entries(next)) upsert.run(key, String(value));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  currentPriceCache = { expiresAt: 0, data: {} };
  tokenPriceCache = { expiresAt: 0, data: {} };
  topMarketCache = { expiresAt: 0, data: null };
  return settingsResponse();
}

seedSettings();

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
    if (response.status === 401 || response.status === 403) {
      throw makeError("Die Blockchain-Datenquelle hat den Zugriff abgelehnt. Bitte API-Key beziehungsweise Project-ID in den Einstellungen prüfen.", 502);
    }
    throw makeError(`Die Blockchain-Datenquelle ist momentan nicht verfügbar (HTTP ${response.status}).`, 502);
  }
  return response.json();
}

async function getCurrentPrices() {
  if (currentPriceCache.expiresAt > Date.now()) return currentPriceCache.data;

  try {
    const settings = runtimeSettings();
    const entries = Object.entries(CHAIN_CONFIG);
    const ids = entries.map(([, config]) => config.coinGeckoId).filter(Boolean).join(",");
    const data = await fetchJson(
      `${settings.coinGeckoBaseUrl}/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=eur&include_last_updated_at=true`,
      coinGeckoHeaders(settings.coinGeckoBaseUrl, settings.coinGeckoApiKey),
    );
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

async function getTopMarketCatalog() {
  if (topMarketCache.expiresAt > Date.now() && topMarketCache.data) return topMarketCache.data;

  try {
    const settings = runtimeSettings();
    const url = new URL(`${settings.coinGeckoBaseUrl}/coins/markets`);
    url.search = new URLSearchParams({
      vs_currency: "eur",
      order: "market_cap_desc",
      per_page: "30",
      page: "1",
      sparkline: "false",
      price_change_percentage: "24h",
    }).toString();
    const rows = await fetchJson(url.toString(), coinGeckoHeaders(settings.coinGeckoBaseUrl, settings.coinGeckoApiKey));
    const assets = buildTopMarketCatalog(rows, CHAIN_CONFIG);
    if (assets.length === 0) throw makeError("CoinGecko lieferte keine Marktdaten.", 502);
    const timestamps = assets
      .map((asset) => Date.parse(asset.lastUpdated || ""))
      .filter(Number.isFinite);
    const data = {
      assets,
      updatedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
      warning: null,
    };
    topMarketCache = { data, expiresAt: Date.now() + 5 * 60 * 1000 };
    return data;
  } catch (error) {
    return { assets: [], updatedAt: null, warning: error.message };
  }
}

async function getErc20CurrentPrices(contracts, settings) {
  const uniqueContracts = [...new Set(contracts.map((contract) => String(contract || "").toLowerCase()).filter((contract) => /^0x[a-f0-9]{40}$/.test(contract)))];
  if (uniqueContracts.length === 0) return {};
  if (tokenPriceCache.expiresAt > Date.now() && uniqueContracts.every((contract) => contract in tokenPriceCache.data)) {
    return Object.fromEntries(uniqueContracts.map((contract) => [contract, tokenPriceCache.data[contract]]));
  }
  const cached = { ...tokenPriceCache.data };
  for (const contract of uniqueContracts) {
    try {
      const payload = await fetchJson(
        `${settings.coinGeckoBaseUrl}/coins/ethereum/contract/${encodeURIComponent(contract)}`,
        coinGeckoHeaders(settings.coinGeckoBaseUrl, settings.coinGeckoApiKey),
      );
      cached[contract] = positiveNumber(payload.market_data?.current_price?.eur);
    } catch (_) {
      cached[contract] = null;
    }
  }
  tokenPriceCache = { expiresAt: Date.now() + 5 * 60 * 1000, data: cached };
  return Object.fromEntries(uniqueContracts.map((contract) => [contract, cached[contract] || null]));
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

async function hydrateBitvavoHistoricalPrices(chain, timestamps, settings) {
  const asset = CHAIN_CONFIG[chain]?.asset;
  const dates = [...new Set(timestamps.filter(Boolean).map(isoDay))].sort();
  if (!asset || dates.length === 0) return new Map();

  // Keep this cache separate from CoinGecko: the stored value retains its
  // provider context while the caller still receives one unified EUR price.
  const coinId = `bitvavo:${asset}`;
  const result = new Map();
  const missing = [];
  for (const date of dates) {
    const cached = cachedHistoricalPrice(coinId, date);
    if (cached) result.set(date, cached);
    else missing.push(date);
  }
  if (missing.length === 0) return result;

  // Bitvavo's daily candle endpoint accepts up to 1,000 candles. 330-day
  // chunks leave enough room for the inclusive range and keep old imports
  // reliable without requesting a full, unnecessary market history.
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
    const start = new Date(`${requestedDates[0]}T00:00:00.000Z`).getTime();
    const end = new Date(`${requestedDates.at(-1)}T23:59:59.999Z`).getTime();
    const url = new URL(`${settings.bitvavoApiBaseUrl}/${encodeURIComponent(asset)}-EUR/candles`);
    url.search = new URLSearchParams({
      interval: "1d",
      limit: "1000",
      start: String(start),
      end: String(end),
    }).toString();
    try {
      const prices = bitvavoDailyClosePrices(await fetchJson(url.toString()));
      for (const date of requestedDates) {
        const value = positiveNumber(prices.get(date));
        if (!value) continue;
        saveHistoricalPrice(coinId, date, value);
        result.set(date, value);
      }
    } catch (_) {
      // Not every asset has a EUR market. CoinGecko/Pro remains available for
      // those assets and ERC-20 contracts.
    }
  }
  return result;
}

async function hydrateHistoricalPrices(chain, timestamps, settings) {
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
        `${settings.coinGeckoBaseUrl}/coins/${coinId}/market_chart/range?vs_currency=eur&from=${from}&to=${to}`,
        coinGeckoHeaders(settings.coinGeckoBaseUrl, settings.coinGeckoApiKey),
      );
      const samples = Array.isArray(payload.prices) ? payload.prices : [];
      for (const date of requestedDates) {
        const value = closestPriceForDate(samples, date);
        // Daily samples are accepted only if they are close enough to the requested day.
        if (value) {
          saveHistoricalPrice(coinId, date, value);
          result.set(date, value);
        }
      }
    } catch (_) {
      // Historic price is optional metadata. The transaction itself remains usable.
    }
  }

  // CoinGecko's public history is time-limited. If it cannot answer a date,
  // use independent EUR daily candles for native assets where a market exists.
  const unresolvedDates = missing.filter((date) => !result.has(date));
  if (unresolvedDates.length > 0) {
    const fallback = await hydrateBitvavoHistoricalPrices(chain, unresolvedDates, settings);
    for (const [date, price] of fallback) result.set(date, price);
  }
  return result;
}

async function hydrateHistoricalTokenPrices(contract, timestamps, settings) {
  const normalizedContract = String(contract || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalizedContract)) return new Map();
  const dates = [...new Set(timestamps.filter(Boolean).map(isoDay))].sort();
  const coinId = `erc20:ethereum:${normalizedContract}`;
  const prices = new Map();
  for (const date of dates) {
    const cached = cachedHistoricalPrice(coinId, date);
    if (cached) {
      prices.set(date, cached);
      continue;
    }
    try {
      const payload = await fetchJson(
        `${settings.coinGeckoBaseUrl}/coins/ethereum/contract/${encodeURIComponent(normalizedContract)}/history?date=${coinGeckoDate(date)}`,
        coinGeckoHeaders(settings.coinGeckoBaseUrl, settings.coinGeckoApiKey),
      );
      const value = positiveNumber(payload.market_data?.current_price?.eur);
      if (value) {
        saveHistoricalPrice(coinId, date, value);
        prices.set(date, value);
      }
    } catch (_) {
      // Token prices are optional. Unknown contracts remain visible as k. A.
    }
  }
  return prices;
}

function hasBitcoinAddressActivity(summary) {
  return Number(summary.chain_stats?.tx_count || 0) + Number(summary.mempool_stats?.tx_count || 0) > 0;
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchBitcoinTransactions(address, settings, maxTransactions = settings.maxTransactionsPerSync) {
  const base = `${settings.bitcoinExplorerBaseUrl}/address/${encodeURIComponent(address)}`;
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

async function discoverXpubAddresses(wallet, settings) {
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
    for (let index = 0; index < settings.xpubMaxDerivationsPerBranch && unusedInARow < settings.xpubGapLimit; index += 1) {
      const address = deriveXpubAddress(wallet.address, branch, index, wallet.xpub_address_type);
      const summary = await fetchJson(`${settings.bitcoinExplorerBaseUrl}/address/${encodeURIComponent(address)}`);
      const isUsed = hasBitcoinAddressActivity(summary);
      saveAddress.run(wallet.id, address, branch, index, isUsed ? 1 : 0);
      if (isUsed) {
        discovered.push(address);
        unusedInARow = 0;
      } else {
        unusedInARow += 1;
      }
      // The public Esplora service is intentionally queried gently during an xPub scan.
      if (unusedInARow < settings.xpubGapLimit) await pause(120);
    }
    if (unusedInARow < settings.xpubGapLimit) capped = true;
  }
  return { addresses: discovered, capped };
}

async function fetchBitcoinTransactionsForAddresses(addresses, settings) {
  const transactions = new Map();
  for (const address of addresses) {
    const remaining = settings.maxTransactionsPerSync ? settings.maxTransactionsPerSync - transactions.size : 0;
    if (settings.maxTransactionsPerSync && remaining <= 0) break;
    const items = await fetchBitcoinTransactions(address, settings, remaining);
    for (const transaction of items) transactions.set(transaction.txid, transaction);
  }
  return [...transactions.values()];
}

async function fetchTezosTransactions(address, settings) {
  const output = [];
  const limit = 1000;
  let offset = 0;
  while (true) {
    if (settings.maxTransactionsPerSync && output.length >= settings.maxTransactionsPerSync) break;
    const query = new URLSearchParams({
      "anyof.sender.target": address,
      "sort.desc": "id",
      limit: String(limit),
      offset: String(offset),
      // TzKT derives this EUR value at the block timestamp, avoiding a broad
      // secondary price lookup for every Tezos transaction.
      quote: "eur",
    });
    const page = await fetchJson(`${settings.tzktApiBaseUrl}/operations/transactions?${query.toString()}`);
    if (!Array.isArray(page) || page.length === 0) break;
    output.push(...page);
    if (page.length < limit) break;
    offset += page.length;
  }
  return settings.maxTransactionsPerSync ? output.slice(0, settings.maxTransactionsPerSync) : output;
}

async function fetchTronTransactions(address, settings) {
  const output = [];
  let fingerprint = null;
  const pageSize = 200;
  const headers = settings.tronGridApiKey ? { "TRON-PRO-API-KEY": settings.tronGridApiKey } : {};

  while (true) {
    if (settings.maxTransactionsPerSync && output.length >= settings.maxTransactionsPerSync) break;
    const query = new URLSearchParams({
      only_confirmed: "true",
      limit: String(pageSize),
      order_by: "block_timestamp,desc",
    });
    if (fingerprint) query.set("fingerprint", fingerprint);
    const payload = await fetchJson(
      `${settings.tronGridBaseUrl}/v1/accounts/${encodeURIComponent(address)}/transactions?${query.toString()}`,
      headers,
    );
    const page = Array.isArray(payload.data) ? payload.data : [];
    if (page.length === 0) break;
    output.push(...page);
    const nextFingerprint = payload.meta?.fingerprint;
    if (page.length < pageSize || !nextFingerprint || nextFingerprint === fingerprint) break;
    fingerprint = nextFingerprint;
  }
  return settings.maxTransactionsPerSync ? output.slice(0, settings.maxTransactionsPerSync) : output;
}

function cardanoHeaders(settings) {
  if (!settings.blockfrostProjectId) {
    throw makeError("Für Cardano wird eine Blockfrost Project-ID benötigt. Bitte unter Einstellungen → Cardano hinterlegen.");
  }
  return { project_id: settings.blockfrostProjectId };
}

async function fetchCardanoAccountAddresses(stakeAddress, settings) {
  const addresses = [];
  const headers = cardanoHeaders(settings);
  let page = 1;
  while (true) {
    const query = new URLSearchParams({ count: "100", page: String(page), order: "asc" });
    const batch = await fetchJson(
      `${settings.blockfrostBaseUrl}/accounts/${encodeURIComponent(stakeAddress)}/addresses?${query.toString()}`,
      headers,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const item of batch) if (isValidAddress("ADA", item?.address)) addresses.push(item.address);
    if (batch.length < 100) break;
    page += 1;
  }
  return [...new Set(addresses)];
}

async function fetchCardanoTransactionReferences(address, settings, remaining = settings.maxTransactionsPerSync) {
  const references = [];
  const headers = cardanoHeaders(settings);
  const pageSize = 100;
  let page = 1;
  while (true) {
    if (remaining && references.length >= remaining) break;
    const query = new URLSearchParams({ count: String(pageSize), page: String(page), order: "desc" });
    const batch = await fetchJson(
      `${settings.blockfrostBaseUrl}/addresses/${encodeURIComponent(address)}/txs?${query.toString()}`,
      headers,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    references.push(...batch);
    if (batch.length < pageSize) break;
    page += 1;
  }
  return remaining ? references.slice(0, remaining) : references;
}

async function fetchCardanoTransactions(addresses, settings) {
  const paymentAddresses = [...new Set(Array.isArray(addresses) ? addresses : [addresses])];
  const references = [];
  const seen = new Set();
  for (const address of paymentAddresses) {
    const remaining = settings.maxTransactionsPerSync ? settings.maxTransactionsPerSync - references.length : 0;
    if (settings.maxTransactionsPerSync && remaining <= 0) break;
    for (const reference of await fetchCardanoTransactionReferences(address, settings, remaining)) {
      const hash = reference.tx_hash || reference.hash;
      if (hash && !seen.has(hash)) {
        seen.add(hash);
        references.push(reference);
      }
    }
  }
  const transactions = [];
  const headers = cardanoHeaders(settings);
  for (const reference of references) {
    const hash = reference.tx_hash || reference.hash;
    if (!hash) continue;
    const transaction = await fetchJson(`${settings.blockfrostBaseUrl}/txs/${encodeURIComponent(hash)}/utxos`, headers);
    if (!transaction.block_time && reference.block_time) transaction.block_time = reference.block_time;
    transactions.push(transaction);
  }
  return transactions;
}

async function fetchEtherscanRecords(address, action, settings, maxTransactions = settings.maxTransactionsPerSync) {
  if (!settings.etherscanApiKey) {
    throw makeError("Für Ethereum wird ein Etherscan-API-Key benötigt. Bitte unter Einstellungen → Ethereum hinterlegen.");
  }
  const output = [];
  const pageSize = 1000;
  let page = 1;
  while (true) {
    if (maxTransactions && output.length >= maxTransactions) break;
    const url = new URL(settings.etherscanApiBaseUrl);
    url.search = new URLSearchParams({
      chainid: "1",
      module: "account",
      action,
      address,
      startblock: "0",
      endblock: "99999999",
      page: String(page),
      offset: String(pageSize),
      sort: "desc",
      apikey: settings.etherscanApiKey,
    }).toString();
    const payload = await fetchJson(url.toString());
    const result = Array.isArray(payload.result) ? payload.result : [];
    if (String(payload.status) === "0" && result.length === 0) {
      const message = `${payload.message || ""} ${typeof payload.result === "string" ? payload.result : ""}`;
      if (/no transactions|no records/i.test(message)) break;
      throw makeError(`Etherscan konnte die Ethereum-Historie nicht laden: ${payload.result || payload.message || "unbekannter Fehler"}.`, 502);
    }
    if (!Array.isArray(payload.result)) throw makeError("Etherscan lieferte ein unerwartetes Antwortformat.", 502);
    output.push(...result);
    if (result.length < pageSize) break;
    page += 1;
  }
  return maxTransactions ? output.slice(0, maxTransactions) : output;
}

async function fetchExplorerNativeTransactions(address, { apiBaseUrl, apiKey, providerName }, settings) {
  if (!apiKey) throw makeError(`Für ${providerName} wird ein API-Key benötigt. Bitte unter Einstellungen → Weitere Netzwerke hinterlegen.`);
  const output = [];
  const pageSize = 1000;
  let page = 1;
  while (true) {
    if (settings.maxTransactionsPerSync && output.length >= settings.maxTransactionsPerSync) break;
    const url = new URL(apiBaseUrl);
    url.search = new URLSearchParams({
      module: "account",
      action: "txlist",
      address,
      startblock: "0",
      endblock: "99999999",
      page: String(page),
      offset: String(pageSize),
      sort: "desc",
      apikey: apiKey,
    }).toString();
    const payload = await fetchJson(url.toString());
    const result = Array.isArray(payload.result) ? payload.result : [];
    if (String(payload.status) === "0" && result.length === 0) {
      const message = `${payload.message || ""} ${typeof payload.result === "string" ? payload.result : ""}`;
      if (/no transactions|no records/i.test(message)) break;
      throw makeError(`${providerName} konnte die Transaktionshistorie nicht laden: ${payload.result || payload.message || "unbekannter Fehler"}.`, 502);
    }
    if (!Array.isArray(payload.result)) throw makeError(`${providerName} lieferte ein unerwartetes Antwortformat.`, 502);
    output.push(...result);
    if (result.length < pageSize) break;
    page += 1;
  }
  return settings.maxTransactionsPerSync ? output.slice(0, settings.maxTransactionsPerSync) : output;
}

async function postJson(url, body, additionalHeaders = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "CryptoBuch/1.0", ...additionalHeaders },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
  } catch (error) {
    throw makeError(`Externer Dienst nicht erreichbar: ${error.message}`, 502);
  }
  if (!response.ok) throw makeError(`Die Blockchain-Datenquelle ist momentan nicht verfügbar (HTTP ${response.status}).`, 502);
  return response.json();
}

async function fetchSolscanTransfers(address, settings) {
  if (!settings.solscanApiKey) throw makeError("Für Solana wird ein Solscan-API-Key benötigt. Bitte unter Einstellungen → Weitere Netzwerke hinterlegen.");
  const output = [];
  let page = 1;
  while (true) {
    if (settings.maxTransactionsPerSync && output.length >= settings.maxTransactionsPerSync) break;
    const url = new URL(`${settings.solscanApiBaseUrl}/account/transfer`);
    url.search = new URLSearchParams({ address, page: String(page), page_size: "100", sort_by: "block_time", sort_order: "desc" }).toString();
    const payload = await fetchJson(url.toString(), { token: settings.solscanApiKey });
    const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.result) ? payload.result : [];
    output.push(...rows);
    if (rows.length < 100) break;
    page += 1;
  }
  return settings.maxTransactionsPerSync ? output.slice(0, settings.maxTransactionsPerSync) : output;
}

async function fetchXrpTransactions(address, settings) {
  const output = [];
  let marker = null;
  while (true) {
    if (settings.maxTransactionsPerSync && output.length >= settings.maxTransactionsPerSync) break;
    const params = { account: address, ledger_index_min: -1, ledger_index_max: -1, binary: false, forward: false, limit: 200 };
    if (marker) params.marker = marker;
    const payload = await postJson(settings.xrplRpcUrl, { method: "account_tx", params: [params] });
    const result = payload.result || {};
    const rows = Array.isArray(result.transactions) ? result.transactions : [];
    output.push(...rows);
    marker = result.marker || null;
    if (!marker || rows.length === 0) break;
  }
  return settings.maxTransactionsPerSync ? output.slice(0, settings.maxTransactionsPerSync) : output;
}

async function fetchStellarPayments(address, settings) {
  const output = [];
  let next = `${settings.stellarHorizonBaseUrl}/accounts/${encodeURIComponent(address)}/payments?order=desc&limit=200`;
  while (next) {
    if (settings.maxTransactionsPerSync && output.length >= settings.maxTransactionsPerSync) break;
    const payload = await fetchJson(next);
    const rows = Array.isArray(payload._embedded?.records) ? payload._embedded.records : [];
    output.push(...rows);
    next = payload._links?.next?.href || null;
    if (rows.length === 0) break;
  }
  return settings.maxTransactionsPerSync ? output.slice(0, settings.maxTransactionsPerSync) : output;
}

async function fetchNearTransactions(address, settings) {
  if (!settings.nearBlocksApiKey) throw makeError("Für NEAR wird ein NearBlocks-API-Key benötigt. Bitte unter Einstellungen → Weitere Netzwerke hinterlegen.");
  const output = [];
  let page = 1;
  while (true) {
    if (settings.maxTransactionsPerSync && output.length >= settings.maxTransactionsPerSync) break;
    const url = new URL(`${settings.nearBlocksApiBaseUrl}/account/${encodeURIComponent(address)}/txns`);
    url.search = new URLSearchParams({ page: String(page), per_page: "100", order: "desc" }).toString();
    const payload = await fetchJson(url.toString(), { Authorization: `Bearer ${settings.nearBlocksApiKey}` });
    const rows = Array.isArray(payload.txns) ? payload.txns : Array.isArray(payload.transactions) ? payload.transactions : [];
    output.push(...rows);
    if (rows.length < 100) break;
    page += 1;
  }
  return settings.maxTransactionsPerSync ? output.slice(0, settings.maxTransactionsPerSync) : output;
}

async function fetchTonMessages(address, settings) {
  const headers = settings.tonApiKey ? { Authorization: `Bearer ${settings.tonApiKey}` } : {};
  const transactions = [];
  const seen = new Set();
  let beforeLt = null;
  while (true) {
    if (settings.maxTransactionsPerSync && transactions.length >= settings.maxTransactionsPerSync) break;
    const remaining = settings.maxTransactionsPerSync ? settings.maxTransactionsPerSync - transactions.length : 1000;
    const url = new URL(`${settings.tonApiBaseUrl}/blockchain/accounts/${encodeURIComponent(address)}/transactions`);
    url.search = new URLSearchParams({ limit: String(Math.min(1000, Math.max(1, remaining))), sort_order: "desc", ...(beforeLt ? { before_lt: String(beforeLt) } : {}) }).toString();
    const payload = await fetchJson(url.toString(), headers);
    const page = Array.isArray(payload.transactions) ? payload.transactions : [];
    for (const transaction of page) {
      const id = `${transaction.hash || ""}:${transaction.lt || ""}`;
      if (id !== ":" && !seen.has(id)) {
        seen.add(id);
        transactions.push(transaction);
      }
    }
    const lastLt = page.at(-1)?.lt;
    if (page.length === 0 || page.length < Math.min(1000, Math.max(1, remaining)) || !lastLt || String(lastLt) === String(beforeLt || "")) break;
    beforeLt = lastLt;
  }
  const messages = [];
  for (const transaction of transactions) {
    const inMessage = transaction.in_msg;
    // The endpoint is scoped to this account. Do not compare Friendly and raw
    // TON address encodings here, because they are equivalent but textually different.
    if (inMessage?.value) {
      messages.push({ externalId: `${transaction.hash}:in`, hash: transaction.hash, timestamp: transaction.utime, direction: "in", value: inMessage.value, counterparty: inMessage.source, fee: 0, raw: transaction });
    }
    for (const [index, outMessage] of (transaction.out_msgs || []).entries()) {
      if (!outMessage?.value) continue;
      messages.push({ externalId: `${transaction.hash}:out:${index}`, hash: transaction.hash, timestamp: transaction.utime, direction: "out", value: outMessage.value, counterparty: outMessage.destination, fee: transaction.total_fees || transaction.fees || 0, raw: transaction });
    }
  }
  return messages;
}

async function fetchBlockCypherTransactions(address, coin, settings) {
  const url = new URL(`${settings.blockCypherApiBaseUrl}/${coin}/main/addrs/${encodeURIComponent(address)}/full`);
  if (settings.blockCypherApiToken) url.searchParams.set("token", settings.blockCypherApiToken);
  const payload = await fetchJson(url.toString());
  return (payload.txs || []).map((transaction) => ({
    transaction: { hash: transaction.hash, time: transaction.confirmed || null, fee: transaction.fees || 0 },
    inputs: (transaction.inputs || []).map((input) => ({ recipient: input.addresses?.[0], value: input.output_value || 0 })),
    outputs: (transaction.outputs || []).map((output) => ({ recipient: output.addresses?.[0], value: output.value || 0 })),
  }));
}

async function fetchBlockchairTransactions(address, chain, settings) {
  const dashboard = new URL(`${settings.blockchairApiBaseUrl}/${chain}/dashboards/address/${encodeURIComponent(address)}`);
  if (settings.blockchairApiKey) dashboard.searchParams.set("key", settings.blockchairApiKey);
  const summary = await fetchJson(dashboard.toString());
  const addresses = Object.values(summary.data || {});
  const hashes = addresses.flatMap((entry) => Array.isArray(entry.transactions) ? entry.transactions : []);
  const unique = [...new Set(hashes)];
  const limited = settings.maxTransactionsPerSync ? unique.slice(0, settings.maxTransactionsPerSync) : unique;
  const rows = [];
  for (const hash of limited) {
    const url = new URL(`${settings.blockchairApiBaseUrl}/${chain}/dashboards/transaction/${encodeURIComponent(hash)}`);
    if (settings.blockchairApiKey) url.searchParams.set("key", settings.blockchairApiKey);
    const payload = await fetchJson(url.toString());
    const transaction = Object.values(payload.data || {})[0];
    if (transaction) rows.push(transaction);
  }
  return rows;
}

async function fetchEthereumTransactions(address, settings) {
  const [native, erc20] = await Promise.all([
    fetchEtherscanRecords(address, "txlist", settings),
    fetchEtherscanRecords(address, "tokentx", settings),
  ]);
  const rows = [
    ...native.map((transaction) => ({ type: "native", transaction })),
    ...erc20.map((transaction) => ({ type: "erc20", transaction })),
  ].sort((left, right) => Number(right.transaction.timeStamp || 0) - Number(left.transaction.timeStamp || 0));
  return settings.maxTransactionsPerSync ? rows.slice(0, settings.maxTransactionsPerSync) : rows;
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

function normalizeTezosTransaction(transaction, address, settings) {
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
    autoPurpose: isConfirmedStakingPayout(transaction, address, settings.trustedStakingPayoutAliases) ? "Staking Rewards" : null,
    rawJson: JSON.stringify(transaction),
  };
}

const CHAIN_ADAPTERS = {
  BTC: {
    async load(wallet, settings) {
      if (wallet.source_type === "xpub") {
        const discovery = await discoverXpubAddresses(wallet, settings);
        return {
          rawTransactions: await fetchBitcoinTransactionsForAddresses(discovery.addresses, settings),
          context: new Set(discovery.addresses),
          xpubCapped: discovery.capped,
        };
      }
      return {
        rawTransactions: await fetchBitcoinTransactions(wallet.address, settings),
        context: new Set([wallet.address]),
        xpubCapped: false,
      };
    },
    normalize: normalizeBitcoinTransaction,
  },
  XTZ: {
    async load(wallet, settings) {
      return { rawTransactions: await fetchTezosTransactions(wallet.address, settings), context: wallet.address, xpubCapped: false };
    },
    normalize: normalizeTezosTransaction,
  },
  TRX: {
    async load(wallet, settings) {
      return { rawTransactions: await fetchTronTransactions(wallet.address, settings), context: wallet.address, xpubCapped: false };
    },
    normalize: normalizeTronNativeTransfer,
  },
  ADA: {
    async load(wallet, settings) {
      if (wallet.source_type === "stake") {
        const addresses = await fetchCardanoAccountAddresses(wallet.address, settings);
        if (addresses.length === 0) {
          throw makeError("Zu dieser Cardano-Stake-Adresse wurden keine Zahlungsadressen gefunden. Prüfe, ob es eine Mainnet-Stake-Adresse ist.");
        }
        return { rawTransactions: await fetchCardanoTransactions(addresses, settings), context: new Set(addresses), xpubCapped: false };
      }
      return { rawTransactions: await fetchCardanoTransactions(wallet.address, settings), context: new Set([wallet.address]), xpubCapped: false };
    },
    normalize: normalizeCardanoTransaction,
  },
  ETH: {
    async load(wallet, settings) {
      return { rawTransactions: await fetchEthereumTransactions(wallet.address, settings), context: wallet.address, xpubCapped: false };
    },
    normalize(item, address) {
      return item.type === "erc20" ? normalizeErc20Transfer(item.transaction, address) : normalizeEthereumTransaction(item.transaction, address);
    },
  },
  BNB: {
    async load(wallet, settings) {
      return {
        rawTransactions: await fetchExplorerNativeTransactions(wallet.address, {
          apiBaseUrl: settings.bscScanApiBaseUrl,
          apiKey: settings.bscScanApiKey,
          providerName: "BscScan",
        }, settings),
        context: wallet.address,
        xpubCapped: false,
      };
    },
    normalize(transaction, address) { return normalizeEvmNativeTransfer(transaction, address, CHAIN_CONFIG.BNB); },
  },
  AVAX: {
    async load(wallet, settings) {
      return {
        rawTransactions: await fetchExplorerNativeTransactions(wallet.address, {
          apiBaseUrl: settings.snowtraceApiBaseUrl,
          apiKey: settings.snowtraceApiKey,
          providerName: "Snowtrace",
        }, settings),
        context: wallet.address,
        xpubCapped: false,
      };
    },
    normalize(transaction, address) { return normalizeEvmNativeTransfer(transaction, address, CHAIN_CONFIG.AVAX); },
  },
  SOL: {
    async load(wallet, settings) {
      return { rawTransactions: await fetchSolscanTransfers(wallet.address, settings), context: wallet.address, xpubCapped: false };
    },
    normalize: normalizeSolscanTransfer,
  },
  XRP: {
    async load(wallet, settings) {
      return { rawTransactions: await fetchXrpTransactions(wallet.address, settings), context: wallet.address, xpubCapped: false };
    },
    normalize: normalizeXrpPayment,
  },
  XLM: {
    async load(wallet, settings) {
      return { rawTransactions: await fetchStellarPayments(wallet.address, settings), context: wallet.address, xpubCapped: false };
    },
    normalize: normalizeStellarPayment,
  },
  NEAR: {
    async load(wallet, settings) {
      return { rawTransactions: await fetchNearTransactions(wallet.address, settings), context: wallet.address, xpubCapped: false };
    },
    normalize: normalizeNearTransfer,
  },
  TON: {
    async load(wallet, settings) {
      return { rawTransactions: await fetchTonMessages(wallet.address, settings), context: wallet.address, xpubCapped: false };
    },
    normalize: normalizeTonMessage,
  },
  DOGE: {
    async load(wallet, settings) {
      return { rawTransactions: await fetchBlockCypherTransactions(wallet.address, "doge", settings), context: wallet.address, xpubCapped: false };
    },
    normalize(transaction, address) { return normalizeBlockchairUtxoTransaction(transaction, address, CHAIN_CONFIG.DOGE); },
  },
  LTC: {
    async load(wallet, settings) {
      return { rawTransactions: await fetchBlockCypherTransactions(wallet.address, "ltc", settings), context: wallet.address, xpubCapped: false };
    },
    normalize(transaction, address) { return normalizeBlockchairUtxoTransaction(transaction, address, CHAIN_CONFIG.LTC); },
  },
  BCH: {
    async load(wallet, settings) {
      return { rawTransactions: await fetchBlockchairTransactions(wallet.address, "bitcoin-cash", settings), context: wallet.address, xpubCapped: false };
    },
    normalize(transaction, address) { return normalizeBlockchairUtxoTransaction(transaction, address, CHAIN_CONFIG.BCH); },
  },
  ZEC: {
    async load(wallet, settings) {
      return { rawTransactions: await fetchBlockchairTransactions(wallet.address, "zcash", settings), context: wallet.address, xpubCapped: false };
    },
    normalize(transaction, address) { return normalizeBlockchairUtxoTransaction(transaction, address, CHAIN_CONFIG.ZEC); },
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
  const settings = runtimeSettings();
  const { rawTransactions, context, xpubCapped } = await adapter.load(wallet, settings);
  const transactions = rawTransactions.map((item) => adapter.normalize(item, context, settings)).filter(Boolean).map((transaction) => ({
    ...transaction,
    assetSymbol: transaction.assetSymbol || transaction.asset,
    assetName: transaction.assetName || transaction.asset,
    assetDecimals: Number.isInteger(transaction.assetDecimals) ? transaction.assetDecimals : CHAIN_CONFIG[wallet.chain].decimals,
    assetContract: transaction.assetContract || null,
    feeAsset: transaction.feeAsset || transaction.asset,
    priceKind: transaction.priceKind || "native",
  }));
  const pricesByDate = await hydrateHistoricalPrices(
    wallet.chain,
    transactions.filter((transaction) => transaction.priceKind !== "erc20" && !positiveNumber(transaction.historicalPrice)).map((transaction) => transaction.timestamp),
    settings,
  );
  const tokenDates = new Map();
  for (const transaction of transactions) {
    if (transaction.priceKind !== "erc20" || !transaction.assetContract || positiveNumber(transaction.historicalPrice)) continue;
    if (!tokenDates.has(transaction.assetContract)) tokenDates.set(transaction.assetContract, []);
    tokenDates.get(transaction.assetContract).push(transaction.timestamp);
  }
  const tokenPricesByContract = new Map();
  for (const [contract, timestamps] of tokenDates) tokenPricesByContract.set(contract, await hydrateHistoricalTokenPrices(contract, timestamps, settings));

  const existingTransaction = db.prepare(
    "SELECT price_transaction_eur, purpose, purpose_origin FROM transactions WHERE wallet_id = ? AND external_id = ?",
  );
  const upsert = db.prepare(`
    INSERT INTO transactions (
      wallet_id, external_id, hash, timestamp, direction, asset, asset_symbol, asset_name, asset_decimals, asset_contract,
      amount, fee, fee_asset, counterparty,
      price_transaction_eur, purpose, purpose_origin, raw_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(wallet_id, external_id) DO UPDATE SET
      hash = excluded.hash,
      timestamp = excluded.timestamp,
      direction = excluded.direction,
      asset = excluded.asset,
      asset_symbol = excluded.asset_symbol,
      asset_name = excluded.asset_name,
      asset_decimals = excluded.asset_decimals,
      asset_contract = excluded.asset_contract,
      amount = excluded.amount,
      fee = excluded.fee,
      fee_asset = excluded.fee_asset,
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
        ?? (transaction.timestamp && transaction.priceKind === "erc20"
          ? positiveNumber(tokenPricesByContract.get(transaction.assetContract)?.get(isoDay(transaction.timestamp)))
          : transaction.timestamp ? positiveNumber(pricesByDate.get(isoDay(transaction.timestamp))) : null);
      upsert.run(
        wallet.id,
        transaction.externalId,
        transaction.hash,
        transaction.timestamp,
        transaction.direction,
        transaction.asset,
        transaction.assetSymbol,
        transaction.assetName,
        transaction.assetDecimals,
        transaction.assetContract,
        transaction.amount,
        transaction.fee,
        transaction.feeAsset,
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
    limited: Boolean(settings.maxTransactionsPerSync && rawTransactions.length >= settings.maxTransactionsPerSync),
    xpubCapped,
  };
}

async function backfillHistoricalPrices() {
  const settings = runtimeSettings();
  const candidates = db.prepare(`
    SELECT t.id, t.timestamp, t.asset_contract, w.chain
    FROM transactions t
    JOIN wallets w ON w.id = t.wallet_id
    WHERE t.timestamp IS NOT NULL
      AND (t.price_transaction_eur IS NULL OR t.price_transaction_eur <= 0)
  `).all();
  const nativeDates = new Map();
  const tokenDates = new Map();
  for (const transaction of candidates) {
    if (transaction.asset_contract) {
      const contract = String(transaction.asset_contract).toLowerCase();
      if (!tokenDates.has(contract)) tokenDates.set(contract, []);
      tokenDates.get(contract).push(transaction.timestamp);
    } else {
      if (!nativeDates.has(transaction.chain)) nativeDates.set(transaction.chain, []);
      nativeDates.get(transaction.chain).push(transaction.timestamp);
    }
  }

  const nativePrices = new Map();
  for (const [chain, timestamps] of nativeDates) nativePrices.set(chain, await hydrateHistoricalPrices(chain, timestamps, settings));
  const tokenPrices = new Map();
  for (const [contract, timestamps] of tokenDates) tokenPrices.set(contract, await hydrateHistoricalTokenPrices(contract, timestamps, settings));

  const update = db.prepare(`
    UPDATE transactions
    SET price_transaction_eur = ?, updated_at = datetime('now')
    WHERE id = ? AND (price_transaction_eur IS NULL OR price_transaction_eur <= 0)
  `);
  let updated = 0;
  db.exec("BEGIN");
  try {
    for (const transaction of candidates) {
      const date = isoDay(transaction.timestamp);
      const price = transaction.asset_contract
        ? positiveNumber(tokenPrices.get(String(transaction.asset_contract).toLowerCase())?.get(date))
        : positiveNumber(nativePrices.get(transaction.chain)?.get(date));
      if (price) updated += update.run(price, transaction.id).changes;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const unresolved = candidates.length - updated;
  const requiresExtendedHistory = candidates.some((transaction) => needsExtendedCoinGeckoHistory(isoDay(transaction.timestamp)));
  const usingPro = usesCoinGeckoPro(settings.coinGeckoBaseUrl, settings.coinGeckoApiKey);
  return {
    candidates: candidates.length,
    updated,
    unresolved,
    requiresExtendedHistory,
    usingPro,
    hint: unresolved && requiresExtendedHistory && !usingPro
      ? "Für ältere native Coins wurde der kostenlose EUR-Tageskurs-Fallback versucht. Für nicht verfügbare Märkte und ERC-20-Token bitte unter Einstellungen eine CoinGecko-Pro-API-Basisadresse und einen Pro-API-Key hinterlegen."
      : unresolved ? "Einige Kurse waren bei der Preisquelle nicht verfügbar und bleiben als k. A. markiert." : null,
  };
}

function nativeAssetDescriptors() {
  return Object.fromEntries(Object.entries(CHAIN_CONFIG).map(([chain, config]) => [config.asset, {
    id: config.asset,
    chain,
    name: config.name,
    symbol: config.asset,
    decimals: config.decimals,
    icon: config.icon,
    kind: "native",
  }]));
}

function assetDescriptorFromTransaction(transaction) {
  const native = CHAIN_CONFIG[transaction.chain];
  if (!transaction.asset_contract) return nativeAssetDescriptors()[transaction.asset] || {
    id: transaction.asset,
    chain: transaction.chain,
    name: transaction.asset_name || transaction.asset,
    symbol: transaction.asset_symbol || transaction.asset,
    decimals: Number.isInteger(transaction.asset_decimals) ? transaction.asset_decimals : native?.decimals || 6,
    icon: native?.icon || "◇",
    kind: "native",
  };
  return {
    id: transaction.asset,
    chain: transaction.chain,
    name: transaction.asset_name || transaction.asset_symbol || "ERC-20 Token",
    symbol: transaction.asset_symbol || "ERC-20",
    decimals: boundedInteger(transaction.asset_decimals, 18, 0, 36),
    icon: "◇",
    kind: "erc20",
    contractAddress: transaction.asset_contract.toLowerCase(),
  };
}

function emptyAssetAnalytics(asset, currentPrice, holdingAmount) {
  return {
    asset: asset.id,
    holdingAmount,
    holdingValueEur: currentPrice ? holdingAmount * currentPrice : null,
    currentPriceEur: currentPrice || null,
    purchases: {
      count: 0,
      acquiredAmount: 0,
      remainingAmount: 0,
      remainingCostEur: 0,
      hasUnknownCost: false,
      currentValueEur: null,
      profitEur: null,
    },
    staking: {
      count: 0,
      amount: 0,
      historicValueEur: 0,
      hasUnknownHistoricValue: false,
      currentValueEur: null,
    },
  };
}

function calculateAssetAnalytics(transactions, pricesByAsset, holdings, assets) {
  const analytics = Object.fromEntries(Object.entries(assets).map(([assetId, asset]) => [
    assetId,
    emptyAssetAnalytics(asset, positiveNumber(pricesByAsset[assetId]), Number(holdings[assetId] || 0)),
  ]));
  const purchaseLots = Object.fromEntries(Object.keys(assets).map((assetId) => [assetId, []]));
  const chronological = [...transactions].sort((left, right) => String(left.timestamp || "").localeCompare(String(right.timestamp || "")));

  for (const transaction of chronological) {
    const report = analytics[transaction.asset];
    if (!report) continue;
    const amount = Number(transaction.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const historicPrice = positiveNumber(transaction.price_transaction_eur);

    if (transaction.direction === "in" && transaction.purpose === "Kauf") {
      report.purchases.count += 1;
      report.purchases.acquiredAmount += amount;
      purchaseLots[transaction.asset].push({ amount, costPerAsset: historicPrice });
    }
    if (transaction.direction === "out" && transaction.purpose === "Verkauf") {
      let remainingToSell = amount;
      for (const lot of purchaseLots[transaction.asset]) {
        if (remainingToSell <= 0) break;
        const consumed = Math.min(lot.amount, remainingToSell);
        lot.amount -= consumed;
        remainingToSell -= consumed;
      }
    }
    if (transaction.direction === "in" && transaction.purpose === "Staking Rewards") {
      report.staking.count += 1;
      report.staking.amount += amount;
      if (historicPrice) report.staking.historicValueEur += amount * historicPrice;
      else report.staking.hasUnknownHistoricValue = true;
    }
  }

  for (const [assetId, report] of Object.entries(analytics)) {
    for (const lot of purchaseLots[assetId]) {
      if (lot.amount <= 0) continue;
      report.purchases.remainingAmount += lot.amount;
      if (lot.costPerAsset) report.purchases.remainingCostEur += lot.amount * lot.costPerAsset;
      else report.purchases.hasUnknownCost = true;
    }
    if (report.currentPriceEur) {
      report.purchases.currentValueEur = report.purchases.remainingAmount * report.currentPriceEur;
      report.staking.currentValueEur = report.staking.amount * report.currentPriceEur;
      if (!report.purchases.hasUnknownCost) report.purchases.profitEur = report.purchases.currentValueEur - report.purchases.remainingCostEur;
    }
  }
  return analytics;
}

async function portfolioResponse() {
  const wallets = db.prepare("SELECT * FROM wallets ORDER BY created_at DESC").all();
  const transactions = db.prepare(`
    SELECT t.*, w.chain, w.address, w.source_type, w.label AS wallet_label
    FROM transactions t
    JOIN wallets w ON w.id = t.wallet_id
    ORDER BY CASE WHEN t.timestamp IS NULL THEN 0 ELSE 1 END, t.timestamp DESC, t.id DESC
  `).all();
  const holdings = Object.fromEntries(Object.values(CHAIN_CONFIG).map((chain) => [chain.asset, 0]));
  const assets = nativeAssetDescriptors();
  for (const transaction of transactions) {
    assets[transaction.asset] = assets[transaction.asset] || assetDescriptorFromTransaction(transaction);
    const sign = transaction.direction === "in" ? 1 : transaction.direction === "out" ? -1 : 0;
    holdings[transaction.asset] = Number(holdings[transaction.asset] || 0) + sign * Number(transaction.amount);
  }
  const currentPrices = await getCurrentPrices();
  const tokenPrices = await getErc20CurrentPrices(
    Object.values(assets)
      .filter((asset) => asset.kind === "erc20" && Number(holdings[asset.id] || 0) !== 0)
      .map((asset) => asset.contractAddress),
    runtimeSettings(),
  );
  const pricesByAsset = Object.fromEntries(Object.entries(assets).map(([assetId, asset]) => [
    assetId,
    asset.kind === "erc20" ? tokenPrices[asset.contractAddress] || null : currentPrices[asset.chain] || null,
  ]));
  const enriched = transactions.map((transaction) => ({
    ...transaction,
    price_now_eur: pricesByAsset[transaction.asset] || null,
  }));
  const totalValueEur = Object.entries(holdings).reduce(
    (sum, [asset, amount]) => sum + amount * Number(pricesByAsset[asset] || 0),
    0,
  );
  const assetAnalytics = calculateAssetAnalytics(enriched, pricesByAsset, holdings, assets);

  return {
    wallets,
    transactions: enriched,
    holdings,
    assetAnalytics,
    assets,
    assetPrices: pricesByAsset,
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

app.get("/api/market/top-30", async (_request, response, next) => {
  try {
    response.json(await getTopMarketCatalog());
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings", (_request, response, next) => {
  try {
    response.json(settingsResponse());
  } catch (error) {
    next(error);
  }
});

app.put("/api/settings", (request, response, next) => {
  try {
    response.json(updateSettings(request.body || {}));
  } catch (error) {
    next(error);
  }
});

app.post("/api/prices/historical/backfill", async (_request, response, next) => {
  try {
    response.json(await backfillHistoricalPrices());
  } catch (error) {
    next(error);
  }
});

app.post("/api/wallets", (request, response, next) => {
  try {
    const chain = String(request.body?.chain || "").toUpperCase();
    let sourceType = String(request.body?.sourceType || "address").toLowerCase();
    const rawAddress = String(request.body?.address || "");
    let address = cleanLabel(rawAddress, 120);
    const label = cleanLabel(request.body?.label, 80);
    let xpubAddressType = String(request.body?.xpubAddressType || "p2wpkh").toLowerCase();
    if (!CHAIN_CONFIG[chain]) throw makeError("Bitte eine unterstützte Blockchain auswählen.");
    if (chain === "BTC" && (sourceType === "xpub" || isExtendedPublicKey(rawAddress))) {
      address = normalizeExtendedPublicKey(rawAddress);
      if (sourceType === "address" && isExtendedPublicKey(address)) sourceType = "xpub";
    }
    if (!['address', 'xpub', 'stake'].includes(sourceType)) throw makeError("Nicht unterstützte Wallet-Art.");
    if (sourceType === "xpub") {
      if (chain !== "BTC") throw makeError("xPub wird nur für Bitcoin unterstützt.");
      if (!XPUB_ADDRESS_TYPES.has(xpubAddressType)) throw makeError("Bitte ein unterstütztes Bitcoin-Adressformat auswählen.");
      try {
        const xpub = inspectXpub(address);
        if (xpub.addressType) xpubAddressType = xpub.addressType;
      } catch (error) {
        throw makeError(error.message);
      }
    } else if (sourceType === "stake") {
      if (chain !== "ADA") throw makeError("Eine Stake-Adresse wird nur für Cardano unterstützt.");
      if (!isValidCardanoStakeAddress(address)) throw makeError("Die Cardano-Stake-Adresse hat kein unterstütztes Mainnet-Format.");
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
    const bulkPurposeLimit = runtimeSettings().bulkPurposeLimit;
    if (ids.length > bulkPurposeLimit) throw makeError(`Maximal ${bulkPurposeLimit.toLocaleString("de-DE")} Transaktionen gleichzeitig bearbeiten.`);
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

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  maxAge: 0,
  setHeaders(response, filePath) {
    if (/\.(?:html|css|js)$/i.test(filePath)) response.setHeader("Cache-Control", "no-store");
  },
}));
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

module.exports = { app, backfillHistoricalPrices, db, runtimeSettings, settingsResponse, updateSettings };
