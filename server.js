const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const QRCode = require("qrcode");
const { z } = require("zod");
const { createPublicClient, http, parseAbi } = require("viem");
const { mainnet } = require("viem/chains");
const { BlockFrostAPI } = require("@blockfrost/blockfrost-js");
const {
  XPUB_ADDRESS_TYPES,
  deriveXpubAddress,
  inspectXpub,
  isExtendedPublicKey,
  normalizeExtendedPublicKey,
} = require("./lib/bitcoin-xpub");
const { previewPsbt } = require("./lib/bitcoin-psbt");
const { CHAIN_CONFIG, cleanLabel, isValidAddress, isValidCardanoStakeAddress } = require("./lib/validation");
const { isConfirmedStakingPayout, trustedPayoutAliases } = require("./lib/tezos-staking");
const { normalizeTronNativeTransfer } = require("./lib/tron");
const { normalizeCardanoTransaction } = require("./lib/cardano");
const { normalizeEthereumTransaction, normalizeErc20Transfer } = require("./lib/ethereum");
const { buildTopMarketCatalog } = require("./lib/market-catalog");
const { calculateAssetAnalytics } = require("./lib/portfolio-analytics");
const { calculateTaxReport } = require("./lib/tax-report");
const { germanyProfile, normalizeTaxProfile } = require("./lib/tax-profile");
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
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const DEFAULT_XPUB_GAP_LIMIT = boundedInteger(process.env.XPUB_GAP_LIMIT, 20, 1, 50);
const HISTORICAL_PRICE_REQUEST_GAP_MS = 1750;
const SETTINGS_DEFAULTS = Object.freeze({
  maxTransactionsPerSync: boundedInteger(process.env.MAX_TRANSACTIONS_PER_SYNC, 0, 0, 100000),
  bulkPurposeLimit: 2500,
  historicalPriceRetryIntervalMinutes: boundedInteger(process.env.HISTORICAL_PRICE_RETRY_INTERVAL_MINUTES, 15, 5, 1440),
  historicalPriceBackfillBatchSize: boundedInteger(process.env.HISTORICAL_PRICE_BACKFILL_BATCH_SIZE, 60, 1, 250),
  personalTaxRatePercent: 0,
  bitcoinExplorerBaseUrl: (process.env.BITCOIN_EXPLORER_BASE_URL || "https://blockstream.info/api").replace(/\/$/, ""),
  tzktApiBaseUrl: (process.env.TZKT_API_BASE_URL || "https://api.tzkt.io/v1").replace(/\/$/, ""),
  tronGridBaseUrl: (process.env.TRONGRID_BASE_URL || "https://api.trongrid.io").replace(/\/$/, ""),
  blockfrostBaseUrl: (process.env.BLOCKFROST_BASE_URL || "https://cardano-mainnet.blockfrost.io/api/v0").replace(/\/$/, ""),
  etherscanApiBaseUrl: (process.env.ETHERSCAN_API_BASE_URL || "https://api.etherscan.io/v2/api").replace(/\/$/, ""),
  ethereumRpcUrl: (process.env.ETHEREUM_RPC_URL || "https://cloudflare-eth.com").replace(/\/$/, ""),
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
  "Airdrop",
  "Lending-Ertrag",
  "DeFi-Ertrag",
  "Transfer",
  "Geschenk",
  "Gebühr",
  "Sonstiges",
];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
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
    price_source TEXT NOT NULL DEFAULT 'auto' CHECK (price_source IN ('auto', 'manual')),
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
  CREATE TABLE IF NOT EXISTS historical_price_retries (
    transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT NOT NULL,
    next_attempt_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS transaction_price_audit (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    price_eur REAL,
    source TEXT NOT NULL,
    note TEXT,
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sync_events (
    id INTEGER PRIMARY KEY,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('success', 'error')),
    imported_count INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  CREATE TABLE IF NOT EXISTS background_jobs (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('wallet_sync', 'price_backfill')),
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'error')),
    progress_current INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY,
    level TEXT NOT NULL CHECK (level IN ('info', 'success', 'warning', 'error')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tax_report_snapshots (
    id INTEGER PRIMARY KEY,
    year INTEGER NOT NULL,
    profile_id TEXT NOT NULL,
    profile_label TEXT NOT NULL,
    report_json TEXT NOT NULL,
    report_checksum TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_transactions_wallet_timestamp
    ON transactions(wallet_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_purpose
    ON transactions(purpose) WHERE purpose IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_wallet_addresses_wallet_branch_index
    ON wallet_addresses(wallet_id, branch, derivation_index);
  CREATE INDEX IF NOT EXISTS idx_historical_price_retries_next_attempt
    ON historical_price_retries(next_attempt_at);
  CREATE INDEX IF NOT EXISTS idx_transaction_price_audit_transaction
    ON transaction_price_audit(transaction_id, changed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sync_events_wallet_created
    ON sync_events(wallet_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_background_jobs_status_created
    ON background_jobs(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_read_created
    ON notifications(is_read, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tax_report_snapshots_year_created
    ON tax_report_snapshots(year, created_at DESC);
  PRAGMA optimize;
`);

function migrateWalletSchemaForChains() {
  const walletSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'wallets'").get()?.sql || "";
  const uniqueIndexes = db.prepare("PRAGMA index_list(wallets)").all();
  const hasChainScopedUniqueAddress = uniqueIndexes.some((index) => {
    if (!index.unique) return false;
    const indexName = String(index.name || "").replaceAll('"', '""');
    const columns = db.prepare(`PRAGMA index_info("${indexName}")`).all().map((column) => column.name);
    return columns.length === 2 && columns[0] === "chain" && columns[1] === "address";
  });
  // Older versions used UNIQUE(address), which prevents the same EVM address
  // from being added to ETH, BNB and AVAX independently. Rebuild both that
  // schema and the former fixed chain CHECK constraint without touching data.
  if (!walletSql.includes("CHECK (chain IN") && hasChainScopedUniqueAddress) return;
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
      COALESCE(${sourceType}, 'address'), ${xpubAddressType}, COALESCE(created_at, datetime('now')), last_synced_at
    FROM wallets;
    DROP TABLE wallets;
    ALTER TABLE wallets_chain_migration RENAME TO wallets;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

migrateWalletSchemaForChains();

// Erst nach einer möglichen Wallet-Tabellenmigration anlegen, damit bestehende
// Datenbanken mit älterem UNIQUE-Schema ohne Fremdschlüssel-Konflikt migrieren.
db.exec(`
  CREATE TABLE IF NOT EXISTS wallet_metadata (
    wallet_id INTEGER PRIMARY KEY REFERENCES wallets(id) ON DELETE CASCADE,
    group_name TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

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
if (!transactionColumnNames.has("price_source")) db.exec("ALTER TABLE transactions ADD COLUMN price_source TEXT NOT NULL DEFAULT 'auto'");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

let currentPriceCache = { expiresAt: 0, data: {} };
let tokenPriceCache = { expiresAt: 0, data: {} };
let topMarketCache = { expiresAt: 0, data: null };
let historicalPriceRequestTail = Promise.resolve();
let nextHistoricalPriceRequestAt = 0;

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

function storedTaxProfile(value, personalTaxRatePercent) {
  const fallback = germanyProfile(personalTaxRatePercent);
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return normalizeTaxProfile(parsed, fallback);
  } catch (_) {
    return fallback;
  }
}

function runtimeSettings() {
  const values = rawSettings();
  const xpubGapLimit = boundedInteger(values.xpubGapLimit, SETTINGS_DEFAULTS.xpubGapLimit, 1, 50);
  const personalTaxRatePercent = Math.min(100, Math.max(0, Number(values.personalTaxRatePercent) || 0));
  return {
    maxTransactionsPerSync: boundedInteger(values.maxTransactionsPerSync, SETTINGS_DEFAULTS.maxTransactionsPerSync, 0, 100000),
    bulkPurposeLimit: boundedInteger(values.bulkPurposeLimit, SETTINGS_DEFAULTS.bulkPurposeLimit, 1, 2500),
    historicalPriceRetryIntervalMinutes: boundedInteger(values.historicalPriceRetryIntervalMinutes, SETTINGS_DEFAULTS.historicalPriceRetryIntervalMinutes, 5, 1440),
    historicalPriceBackfillBatchSize: boundedInteger(values.historicalPriceBackfillBatchSize, SETTINGS_DEFAULTS.historicalPriceBackfillBatchSize, 1, 250),
    personalTaxRatePercent,
    taxProfile: storedTaxProfile(values.taxProfileJson, personalTaxRatePercent),
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
    historicalPriceRetryIntervalMinutes: settings.historicalPriceRetryIntervalMinutes,
    historicalPriceBackfillBatchSize: settings.historicalPriceBackfillBatchSize,
    personalTaxRatePercent: settings.personalTaxRatePercent,
    taxProfile: settings.taxProfile,
    bitcoinExplorerBaseUrl: settings.bitcoinExplorerBaseUrl,
    tzktApiBaseUrl: settings.tzktApiBaseUrl,
    tronGridBaseUrl: settings.tronGridBaseUrl,
    blockfrostBaseUrl: settings.blockfrostBaseUrl,
    etherscanApiBaseUrl: settings.etherscanApiBaseUrl,
    ethereumRpcUrl: settings.ethereumRpcUrl,
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
  const historicalPriceRetryIntervalMinutes = boundedInteger(input.historicalPriceRetryIntervalMinutes, current.historicalPriceRetryIntervalMinutes, 5, 1440);
  if (Number(input.historicalPriceRetryIntervalMinutes) !== historicalPriceRetryIntervalMinutes) {
    throw makeError("Der Wiederholungsabstand für historische Kurse muss zwischen 5 und 1.440 Minuten liegen.");
  }
  const historicalPriceBackfillBatchSize = boundedInteger(input.historicalPriceBackfillBatchSize, current.historicalPriceBackfillBatchSize, 1, 250);
  if (Number(input.historicalPriceBackfillBatchSize) !== historicalPriceBackfillBatchSize) {
    throw makeError("Die Anzahl historischer Kurse je Durchlauf muss zwischen 1 und 250 liegen.");
  }
  const personalTaxRatePercent = Number(input.personalTaxRatePercent);
  if (!Number.isFinite(personalTaxRatePercent) || personalTaxRatePercent < 0 || personalTaxRatePercent > 100) {
    throw makeError("Der persönliche Steuersatz muss zwischen 0 und 100 Prozent liegen.");
  }
  const suppliedTaxProfile = input.taxProfile && typeof input.taxProfile === "object" ? input.taxProfile : {};
  const taxProfile = normalizeTaxProfile({
    ...current.taxProfile,
    ...suppliedTaxProfile,
    incomePurposes: suppliedTaxProfile.incomePurposes ?? current.taxProfile.incomePurposes,
  }, current.taxProfile);

  const next = {
    maxTransactionsPerSync,
    bulkPurposeLimit,
    historicalPriceRetryIntervalMinutes,
    historicalPriceBackfillBatchSize,
    personalTaxRatePercent,
    taxProfileJson: JSON.stringify(taxProfile),
    bitcoinExplorerBaseUrl: cleanServiceUrl(input.bitcoinExplorerBaseUrl, "Die Bitcoin-Explorer-URL"),
    tzktApiBaseUrl: cleanServiceUrl(input.tzktApiBaseUrl, "Die TzKT-URL"),
    tronGridBaseUrl: cleanServiceUrl(input.tronGridBaseUrl, "Die TronGrid-URL"),
    blockfrostBaseUrl: cleanServiceUrl(input.blockfrostBaseUrl, "Die Blockfrost-URL"),
    etherscanApiBaseUrl: cleanServiceUrl(input.etherscanApiBaseUrl, "Die Etherscan-URL"),
    ethereumRpcUrl: cleanServiceUrl(input.ethereumRpcUrl, "Die Ethereum-RPC-URL"),
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
  // Apply a changed retry cadence at the next scheduler tick instead of
  // keeping a previously calculated interval alive.
  nextAutomaticHistoricalPriceBackfillAt = 0;
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
  const payload = await response.json();
  const parsed = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).safeParse(payload);
  if (!parsed.success) throw makeError("Die externe Datenquelle lieferte kein gültiges JSON-Objekt oder JSON-Array.", 502);
  return parsed.data;
}

function fetchHistoricalJson(url, additionalHeaders = {}) {
  const request = historicalPriceRequestTail.then(async () => {
    const waitFor = Math.max(0, nextHistoricalPriceRequestAt - Date.now());
    if (waitFor > 0) await pause(waitFor);
    nextHistoricalPriceRequestAt = Date.now() + HISTORICAL_PRICE_REQUEST_GAP_MS;
    return fetchJson(url, additionalHeaders);
  });
  // A failed provider response must not stop the queue for later retry jobs.
  historicalPriceRequestTail = request.catch(() => undefined);
  return request;
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
      const prices = bitvavoDailyClosePrices(await fetchHistoricalJson(url.toString()));
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
      const payload = await fetchHistoricalJson(
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
      const payload = await fetchHistoricalJson(
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

const cardanoRewardsSchema = z.array(z.object({ epoch: z.coerce.number().int(), amount: z.coerce.string(), pool_id: z.string().optional() }));

async function fetchCardanoRewards(stakeAddress, settings) {
  const client = new BlockFrostAPI({ projectId: settings.blockfrostProjectId, customBackend: settings.blockfrostBaseUrl });
  const result = await client.accountsRewards(stakeAddress, { count: 100, order: "desc" });
  return cardanoRewardsSchema.parse(result);
}

function normalizeCardanoReward(reward) {
  const amount = Number(reward.amount || 0) / 1000000;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    externalId: `ada-reward:${reward.epoch}:${reward.pool_id || "unknown"}:${reward.amount}`,
    hash: `cardano-reward:${reward.epoch}:${reward.pool_id || "unknown"}`,
    timestamp: null,
    direction: "in",
    asset: "ADA",
    assetSymbol: "ADA",
    assetName: "Cardano",
    assetDecimals: 6,
    amount,
    fee: 0,
    counterparty: reward.pool_id || null,
    historicalPrice: null,
    autoPurpose: "Staking Rewards",
    rawJson: JSON.stringify(reward),
  };
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

const ERC20_METADATA_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

async function enrichErc20Metadata(records, settings) {
  const contracts = [...new Set(records.map((record) => String(record.contractAddress || "").toLowerCase()).filter((contract) => /^0x[a-f0-9]{40}$/.test(contract)))];
  if (!contracts.length) return records;
  try {
    const client = createPublicClient({ chain: mainnet, transport: http(settings.ethereumRpcUrl, { timeout: 8000 }) });
    const calls = contracts.flatMap((address) => ["name", "symbol", "decimals"].map((functionName) => ({ address, abi: ERC20_METADATA_ABI, functionName })));
    const results = await client.multicall({ contracts: calls, allowFailure: true, batchSize: 1024 });
    const metadata = new Map();
    contracts.forEach((contract, index) => {
      const [name, symbol, decimals] = results.slice(index * 3, index * 3 + 3).map((result) => result.status === "success" ? result.result : null);
      metadata.set(contract, { name: typeof name === "string" ? name : null, symbol: typeof symbol === "string" ? symbol : null, decimals: Number.isInteger(Number(decimals)) ? Number(decimals) : null });
    });
    return records.map((record) => {
      const item = metadata.get(String(record.contractAddress || "").toLowerCase());
      return item ? { ...record, tokenName: item.name || record.tokenName, tokenSymbol: item.symbol || record.tokenSymbol, tokenDecimal: item.decimals ?? record.tokenDecimal } : record;
    });
  } catch (_) {
    // Etherscan metadata remains the fallback when a public RPC is unavailable.
    return records;
  }
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
  const enrichedErc20 = await enrichErc20Metadata(erc20, settings);
  const rows = [
    ...native.map((transaction) => ({ type: "native", transaction })),
    ...enrichedErc20.map((transaction) => ({ type: "erc20", transaction })),
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
        const [transactions, rewards] = await Promise.all([fetchCardanoTransactions(addresses, settings), fetchCardanoRewards(wallet.address, settings).catch(() => [])]);
        return { rawTransactions: [...transactions.map((transaction) => ({ type: "utxo", transaction })), ...rewards.map((reward) => ({ type: "reward", reward }))], context: new Set(addresses), xpubCapped: false };
      }
      return { rawTransactions: (await fetchCardanoTransactions(wallet.address, settings)).map((transaction) => ({ type: "utxo", transaction })), context: new Set([wallet.address]), xpubCapped: false };
    },
    normalize(item, address) { return item.type === "reward" ? normalizeCardanoReward(item.reward) : normalizeCardanoTransaction(item.transaction, address); },
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
  const wallet = db.prepare(`SELECT w.*, COALESCE(m.group_name, '') AS group_name, COALESCE(m.tags, '[]') AS tags
    FROM wallets w LEFT JOIN wallet_metadata m ON m.wallet_id = w.id WHERE w.id = ?`).get(id);
  if (!wallet) throw makeError("Wallet nicht gefunden.", 404);
  return wallet;
}

function cleanTags(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(raw.map((tag) => cleanLabel(tag, 32)).filter(Boolean))].slice(0, 12);
}

function updateWalletMetadata(walletId, groupName, tags) {
  const cleanGroup = cleanLabel(groupName, 48);
  const cleanTagList = cleanTags(tags);
  db.prepare(`INSERT INTO wallet_metadata (wallet_id, group_name, tags, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(wallet_id) DO UPDATE SET group_name = excluded.group_name, tags = excluded.tags, updated_at = datetime('now')`)
    .run(walletId, cleanGroup, JSON.stringify(cleanTagList));
  return { group_name: cleanGroup, tags: cleanTagList };
}

function createNotification(level, title, message) {
  db.prepare("INSERT INTO notifications (level, title, message) VALUES (?, ?, ?)")
    .run(level, cleanLabel(title, 100), cleanLabel(message, 500));
}

let jobWorkerScheduled = false;
function scheduleJobWorker() {
  if (jobWorkerScheduled) return;
  jobWorkerScheduled = true;
  setImmediate(async () => {
    jobWorkerScheduled = false;
    const job = db.prepare("SELECT * FROM background_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1").get();
    if (!job) return;
    db.prepare("UPDATE background_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?").run(job.id);
    try {
      const payload = JSON.parse(job.payload_json);
      let result;
      if (job.type === "wallet_sync") {
        const wallet = getWallet(payload.walletId);
        result = await syncWallet(wallet);
        recordSyncEvent(wallet.id, "success", result.imported);
        createNotification("success", "Wallet synchronisiert", `${wallet.label || wallet.address}: ${result.imported.toLocaleString("de-DE")} Transaktionen verarbeitet.`);
      } else {
        result = await backfillHistoricalPrices({ force: Boolean(payload.force) });
        if (result.remaining > 0) createNotification("warning", "Historische Kurse offen", `${result.remaining.toLocaleString("de-DE")} historische Kurse werden weiter automatisch geprüft.`);
        else createNotification("success", "Historische Kurse ergänzt", `${result.updated.toLocaleString("de-DE")} Kurse wurden ergänzt.`);
      }
      db.prepare("UPDATE background_jobs SET status = 'success', progress_current = 1, progress_total = 1, result_json = ?, finished_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(result), job.id);
    } catch (error) {
      db.prepare("UPDATE background_jobs SET status = 'error', error_message = ?, finished_at = datetime('now') WHERE id = ?")
        .run(String(error.message || error).slice(0, 500), job.id);
      createNotification("error", "Hintergrundjob fehlgeschlagen", String(error.message || error).slice(0, 400));
    }
    scheduleJobWorker();
  });
}

function enqueueJob(type, payload) {
  const result = db.prepare("INSERT INTO background_jobs (type, payload_json) VALUES (?, ?)").run(type, JSON.stringify(payload));
  const job = db.prepare("SELECT * FROM background_jobs WHERE id = ?").get(Number(result.lastInsertRowid));
  scheduleJobWorker();
  return job;
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
    "SELECT price_transaction_eur, price_source, purpose, purpose_origin FROM transactions WHERE wallet_id = ? AND external_id = ?",
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
      price_transaction_eur = CASE
        WHEN transactions.price_source = 'manual' THEN transactions.price_transaction_eur
        ELSE COALESCE(excluded.price_transaction_eur, transactions.price_transaction_eur)
      END,
      price_source = CASE
        WHEN transactions.price_source = 'manual' THEN 'manual'
        ELSE 'auto'
      END,
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

function pendingHistoricalPriceCount() {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM transactions
    WHERE timestamp IS NOT NULL
      AND price_source <> 'manual'
      AND (price_transaction_eur IS NULL OR price_transaction_eur <= 0)
  `).get().count || 0);
}

async function backfillHistoricalPrices({ force = false } = {}) {
  const settings = runtimeSettings();
  const totalPending = pendingHistoricalPriceCount();
  const retryFilter = force ? "1 = 1" : "(retry.next_attempt_at IS NULL OR retry.next_attempt_at <= ?)";
  const candidates = db.prepare(`
    SELECT t.id, t.timestamp, t.asset_contract, w.chain, retry.attempt_count AS retry_attempt_count
    FROM transactions t
    JOIN wallets w ON w.id = t.wallet_id
    LEFT JOIN historical_price_retries retry ON retry.transaction_id = t.id
    WHERE t.timestamp IS NOT NULL
      AND t.price_source <> 'manual'
      AND (t.price_transaction_eur IS NULL OR t.price_transaction_eur <= 0)
      AND ${retryFilter}
    ORDER BY retry.last_attempt_at ASC, t.timestamp ASC
    LIMIT ?
  `).all(...(force ? [] : [new Date().toISOString()]), settings.historicalPriceBackfillBatchSize);
  if (candidates.length === 0) {
    return {
      candidates: totalPending,
      attempted: 0,
      updated: 0,
      unresolved: totalPending,
      remaining: totalPending,
      retryIntervalMinutes: settings.historicalPriceRetryIntervalMinutes,
      hint: totalPending ? "Für die noch fehlenden Kurse läuft bereits eine gedrosselte Wiederholung." : null,
    };
  }
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
    WHERE id = ? AND price_source <> 'manual' AND (price_transaction_eur IS NULL OR price_transaction_eur <= 0)
  `);
  const removeRetry = db.prepare("DELETE FROM historical_price_retries WHERE transaction_id = ?");
  const saveRetry = db.prepare(`
    INSERT INTO historical_price_retries (transaction_id, attempt_count, last_attempt_at, next_attempt_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(transaction_id) DO UPDATE SET
      attempt_count = excluded.attempt_count,
      last_attempt_at = excluded.last_attempt_at,
      next_attempt_at = excluded.next_attempt_at
  `);
  let updated = 0;
  const unresolvedTransactions = [];
  db.exec("BEGIN");
  try {
    for (const transaction of candidates) {
      const date = isoDay(transaction.timestamp);
      const price = transaction.asset_contract
        ? positiveNumber(tokenPrices.get(String(transaction.asset_contract).toLowerCase())?.get(date))
        : positiveNumber(nativePrices.get(transaction.chain)?.get(date));
      if (price) {
        updated += update.run(price, transaction.id).changes;
        removeRetry.run(transaction.id);
      } else {
        unresolvedTransactions.push(transaction);
      }
    }
    const attemptedAt = new Date();
    for (const transaction of unresolvedTransactions) {
      const attempts = Number(transaction.retry_attempt_count || 0) + 1;
      const delayMinutes = Math.min(
        1440,
        settings.historicalPriceRetryIntervalMinutes * 2 ** Math.min(attempts - 1, 6),
      );
      saveRetry.run(
        transaction.id,
        attempts,
        attemptedAt.toISOString(),
        new Date(attemptedAt.getTime() + delayMinutes * 60000).toISOString(),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const unresolved = candidates.length - updated;
  const remaining = pendingHistoricalPriceCount();
  const requiresExtendedHistory = candidates.some((transaction) => needsExtendedCoinGeckoHistory(isoDay(transaction.timestamp)));
  const usingPro = usesCoinGeckoPro(settings.coinGeckoBaseUrl, settings.coinGeckoApiKey);
  return {
    candidates: totalPending,
    attempted: candidates.length,
    updated,
    unresolved,
    remaining,
    retryIntervalMinutes: settings.historicalPriceRetryIntervalMinutes,
    requiresExtendedHistory,
    usingPro,
    hint: unresolved && requiresExtendedHistory && !usingPro
      ? "Für ältere native Coins wurde der kostenlose EUR-Tageskurs-Fallback versucht. Für nicht verfügbare Märkte und ERC-20-Token bitte unter Einstellungen eine CoinGecko-Pro-API-Basisadresse und einen Pro-API-Key hinterlegen."
      : unresolved ? "Einige Kurse waren bei der Preisquelle nicht verfügbar und bleiben als k. A. markiert." : null,
  };
}

let historicalPriceBackfillInFlight = null;
let nextAutomaticHistoricalPriceBackfillAt = 0;

function runHistoricalPriceBackfill(options) {
  if (historicalPriceBackfillInFlight) return historicalPriceBackfillInFlight;
  historicalPriceBackfillInFlight = backfillHistoricalPrices(options)
    .finally(() => { historicalPriceBackfillInFlight = null; });
  return historicalPriceBackfillInFlight;
}

function scheduleHistoricalPriceBackfill() {
  const settings = runtimeSettings();
  if (Date.now() < nextAutomaticHistoricalPriceBackfillAt || historicalPriceBackfillInFlight) return;
  nextAutomaticHistoricalPriceBackfillAt = Date.now() + settings.historicalPriceRetryIntervalMinutes * 60000;
  runHistoricalPriceBackfill({ force: false }).catch((error) => {
    console.error("Automatische Preisergänzung fehlgeschlagen:", error.message);
  });
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

async function portfolioResponse() {
  const wallets = db.prepare(`SELECT w.*, COALESCE(m.group_name, '') AS group_name, COALESCE(m.tags, '[]') AS tags
    FROM wallets w LEFT JOIN wallet_metadata m ON m.wallet_id = w.id ORDER BY w.created_at DESC`).all()
    .map((wallet) => ({ ...wallet, tags: (() => { try { return JSON.parse(wallet.tags); } catch { return []; } })() }));
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
  const allocation = Object.entries(assetAnalytics)
    .map(([asset, report]) => ({ asset, valueEur: Number(report.holdingValueEur || 0), share: totalValueEur > 0 ? Number(report.holdingValueEur || 0) / totalValueEur : 0 }))
    .filter((entry) => entry.valueEur > 0)
    .sort((a, b) => b.valueEur - a.valueEur);
  const cumulativeByDay = new Map();
  let cumulativeValue = 0;
  for (const transaction of [...enriched].filter((item) => item.timestamp).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))) {
    const price = positiveNumber(transaction.price_transaction_eur);
    if (!price) continue;
    const sign = transaction.direction === "in" ? 1 : transaction.direction === "out" ? -1 : 0;
    cumulativeValue += sign * Number(transaction.amount || 0) * price;
    cumulativeByDay.set(isoDay(transaction.timestamp), cumulativeValue);
  }
  const valueHistory = [...cumulativeByDay.entries()].slice(-180).map(([day, valueEur]) => ({ day, valueEur }));
  const unrealizedProfitEur = Object.values(assetAnalytics).reduce((sum, report) => sum + Number(report.purchases?.profitEur || 0), 0);
  const remainingPurchaseCostEur = Object.values(assetAnalytics).reduce((sum, report) => sum + Number(report.purchases?.remainingCostEur || 0), 0);
  const realizedYear = calculateTaxReport(enriched, new Date().getFullYear(), runtimeSettings()).summary.realizedProfitEur;
  const netInvestmentEur = enriched.reduce((sum, transaction) => {
    if (!positiveNumber(transaction.price_transaction_eur)) return sum;
    const value = Number(transaction.amount) * Number(transaction.price_transaction_eur);
    return transaction.purpose === "Kauf" && transaction.direction === "in" ? sum + value
      : transaction.purpose === "Verkauf" && transaction.direction === "out" ? sum - value : sum;
  }, 0);
  const incomeHistoricValueEur = Object.values(assetAnalytics).reduce((sum, report) => sum + Number(report.staking?.historicValueEur || 0), 0);

  return {
    wallets,
    transactions: enriched,
    holdings,
    assetAnalytics,
    assets,
    assetPrices: pricesByAsset,
    totalValueEur,
    currentPrices,
    insights: {
      allocation,
      valueHistory,
      performance: {
        unrealizedProfitEur,
        realizedYearEur: realizedYear,
        netInvestmentEur,
        purchaseReturnPercent: remainingPurchaseCostEur > 0 ? unrealizedProfitEur / remainingPurchaseCostEur * 100 : null,
        incomeHistoricValueEur,
      },
    },
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
    response.json(await runHistoricalPriceBackfill({ force: true }));
  } catch (error) {
    next(error);
  }
});

function safeBackupName(value) {
  const name = String(value || "");
  return /^cryptobuch-\d{8}-\d{6}\.sqlite$/.test(name) ? name : null;
}

function backupPath(name) {
  const safeName = safeBackupName(name);
  if (!safeName) throw makeError("Ungültige Backup-Datei.");
  return path.join(BACKUP_DIR, safeName);
}

function listBackups() {
  return fs.readdirSync(BACKUP_DIR)
    .filter((name) => safeBackupName(name))
    .map((name) => {
      const stats = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: stats.size, createdAt: stats.mtime.toISOString() };
    })
    .sort((left, right) => right.name.localeCompare(left.name));
}

function createBackup() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
  const name = `cryptobuch-${stamp}.sqlite`;
  const destination = backupPath(name).replaceAll("'", "''");
  db.exec(`VACUUM INTO '${destination}'`);
  return listBackups().find((backup) => backup.name === name);
}

app.get("/api/backups", (_request, response, next) => {
  try {
    response.json({ backups: listBackups() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/backups", (_request, response, next) => {
  try {
    response.status(201).json(createBackup());
  } catch (error) {
    next(error);
  }
});

app.get("/api/backups/:name/download", (request, response, next) => {
  try {
    const name = safeBackupName(request.params.name);
    if (!name) throw makeError("Ungültige Backup-Datei.");
    response.download(backupPath(name), name);
  } catch (error) {
    next(error);
  }
});

app.post("/api/backups/:name/restore", (request, response, next) => {
  try {
    const source = backupPath(request.params.name);
    if (!fs.existsSync(source)) throw makeError("Backup nicht gefunden.", 404);
    // A restore deliberately terminates the process after the response. Docker
    // restarts the container and opens the restored database from the volume.
    db.close();
    for (const sidecar of [`${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }
    fs.copyFileSync(source, DB_PATH);
    response.json({ restored: request.params.name, restarting: true });
    setTimeout(() => process.exit(0), 500).unref();
  } catch (error) {
    next(error);
  }
});

function recordSyncEvent(walletId, status, importedCount = 0, message = null) {
  db.prepare(`
    INSERT INTO sync_events (wallet_id, status, imported_count, message)
    VALUES (?, ?, ?, ?)
  `).run(walletId, status, importedCount, message);
}

app.get("/api/system-status", (_request, response, next) => {
  try {
    const wallets = db.prepare(`
      SELECT w.id, w.chain, w.label, w.address, w.last_synced_at,
        event.status AS last_status, event.imported_count AS last_imported_count,
        event.message AS last_message, event.created_at AS last_event_at
      FROM wallets w
      LEFT JOIN sync_events event ON event.id = (
        SELECT id FROM sync_events WHERE wallet_id = w.id ORDER BY id DESC LIMIT 1
      )
      ORDER BY w.last_synced_at ASC, w.id ASC
    `).all();
    const retries = db.prepare(`
      SELECT COUNT(*) AS count, MIN(next_attempt_at) AS next_attempt_at
      FROM historical_price_retries
    `).get();
    response.json({
      wallets,
      priceRetry: {
        pending: pendingHistoricalPriceCount(),
        delayed: Number(retries.count || 0),
        nextAttemptAt: retries.next_attempt_at || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

function transactionQualityRows(condition, limit = 100) {
  return db.prepare(`
    SELECT t.id, t.hash, t.timestamp, t.direction, t.asset, t.asset_symbol, t.amount,
      t.price_transaction_eur, t.price_source, t.purpose, t.purpose_origin, w.chain, w.label AS wallet_label
    FROM transactions t
    JOIN wallets w ON w.id = t.wallet_id
    WHERE ${condition}
    ORDER BY t.timestamp ASC
    LIMIT ?
  `).all(limit);
}

app.get("/api/data-quality", (_request, response, next) => {
  try {
    const missingHistoricPrices = transactionQualityRows(`
      t.timestamp IS NOT NULL
      AND t.price_source <> 'manual'
      AND (t.price_transaction_eur IS NULL OR t.price_transaction_eur <= 0)
    `, 150);
    const unassignedPurposes = transactionQualityRows("t.purpose IS NULL OR trim(t.purpose) = ''", 150);
    const counts = {
      missingHistoricPrices: pendingHistoricalPriceCount(),
      unassignedPurposes: Number(db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE purpose IS NULL OR trim(purpose) = ''").get().count || 0),
      manualHistoricPrices: Number(db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE price_source = 'manual'").get().count || 0),
    };
    const possibleTransfers = db.prepare(`
      SELECT a.id AS outgoing_id, b.id AS incoming_id, a.asset, a.amount, a.timestamp AS outgoing_at, b.timestamp AS incoming_at,
        aw.label AS outgoing_wallet, bw.label AS incoming_wallet
      FROM transactions a
      JOIN transactions b ON b.asset = a.asset AND b.direction = 'in' AND a.direction = 'out'
        AND ABS(b.amount - a.amount) <= MAX(0.00000001, ABS(a.amount) * 0.002)
        AND ABS(strftime('%s', b.timestamp) - strftime('%s', a.timestamp)) <= 172800
      JOIN wallets aw ON aw.id = a.wallet_id JOIN wallets bw ON bw.id = b.wallet_id
      WHERE a.wallet_id <> b.wallet_id AND (a.purpose IS NULL OR a.purpose <> 'Transfer') AND (b.purpose IS NULL OR b.purpose <> 'Transfer')
      ORDER BY a.timestamp DESC LIMIT 80
    `).all();
    const possibleDuplicates = db.prepare(`
      SELECT hash, asset, amount, COUNT(*) AS occurrences, GROUP_CONCAT(id) AS transaction_ids
      FROM transactions WHERE hash <> '' GROUP BY hash, asset, amount HAVING COUNT(*) > 1 ORDER BY occurrences DESC LIMIT 80
    `).all();
    response.json({ counts, missingHistoricPrices, unassignedPurposes, possibleTransfers, possibleDuplicates });
  } catch (error) {
    next(error);
  }
});

app.get("/api/jobs/:id", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    const job = db.prepare("SELECT * FROM background_jobs WHERE id = ?").get(id);
    if (!job) throw makeError("Hintergrundjob nicht gefunden.", 404);
    response.json({ ...job, result: job.result_json ? JSON.parse(job.result_json) : null });
  } catch (error) { next(error); }
});

app.post("/api/jobs/sync", (request, response, next) => {
  try {
    const ids = [...new Set((Array.isArray(request.body?.walletIds) ? request.body.walletIds : [request.body?.walletId]).map(asPositiveId).filter(Boolean))];
    if (!ids.length) throw makeError("Bitte mindestens eine Wallet auswählen.");
    const jobs = ids.map((id) => { getWallet(id); return enqueueJob("wallet_sync", { walletId: id }); });
    response.status(202).json({ jobs });
  } catch (error) { next(error); }
});

app.post("/api/jobs/price-backfill", (request, response, next) => {
  try { response.status(202).json({ job: enqueueJob("price_backfill", { force: Boolean(request.body?.force) }) }); } catch (error) { next(error); }
});

app.get("/api/notifications", (_request, response, next) => {
  try {
    const notifications = db.prepare("SELECT * FROM notifications ORDER BY is_read ASC, id DESC LIMIT 40").all();
    response.json({ notifications, unread: notifications.filter((item) => !item.is_read).length });
  } catch (error) { next(error); }
});

app.patch("/api/notifications/read", (request, response, next) => {
  try {
    const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(asPositiveId).filter(Boolean) : [];
    if (ids.length) db.prepare(`UPDATE notifications SET is_read = 1 WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
    else db.prepare("UPDATE notifications SET is_read = 1 WHERE is_read = 0").run();
    response.json({ ok: true });
  } catch (error) { next(error); }
});

function reportYear(value) {
  const year = Number(value || new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2009 || year > 2100) throw makeError("Bitte ein gültiges Kalenderjahr angeben.");
  return year;
}

function taxReportResponse(year) {
  const transactions = db.prepare("SELECT * FROM transactions WHERE timestamp IS NOT NULL ORDER BY timestamp ASC").all();
  const report = calculateTaxReport(transactions, year, runtimeSettings());
  const availableYears = db.prepare(`
    SELECT DISTINCT substr(timestamp, 1, 4) AS year
    FROM transactions
    WHERE timestamp IS NOT NULL AND length(timestamp) >= 4
    ORDER BY year DESC
  `).all().map((row) => Number(row.year)).filter(Number.isInteger);
  return { ...report, availableYears };
}

function taxReportSnapshots(year) {
  return db.prepare(`
    SELECT id, year, profile_id AS profileId, profile_label AS profileLabel, report_checksum AS checksum, created_at AS createdAt
    FROM tax_report_snapshots
    WHERE year = ?
    ORDER BY id DESC
  `).all(year);
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[;"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

app.get("/api/tax-report", (request, response, next) => {
  try {
    response.json(taxReportResponse(reportYear(request.query.year)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/tax-report/snapshots", (request, response, next) => {
  try {
    const year = reportYear(request.query.year);
    response.json({ year, snapshots: taxReportSnapshots(year) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/tax-report/snapshots/:id", (request, response, next) => {
  try {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw makeError("Ungültige Snapshot-ID.");
    const snapshot = db.prepare(`
      SELECT id, year, profile_id AS profileId, profile_label AS profileLabel, report_json AS reportJson, report_checksum AS checksum, created_at AS createdAt
      FROM tax_report_snapshots WHERE id = ?
    `).get(id);
    if (!snapshot) throw makeError("Der Jahres-Snapshot wurde nicht gefunden.", 404);
    const checksumValid = crypto.createHash("sha256").update(snapshot.reportJson).digest("hex") === snapshot.checksum;
    response.json({ ...snapshot, report: JSON.parse(snapshot.reportJson), checksumValid });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tax-report/snapshots", (request, response, next) => {
  try {
    const year = reportYear(request.body?.year);
    const report = taxReportResponse(year);
    const reportJson = JSON.stringify({
      report: { year: report.year, profile: report.profile, summary: report.summary, sales: report.sales, income: report.income },
      generatedAt: new Date().toISOString(),
    });
    const checksum = crypto.createHash("sha256").update(reportJson).digest("hex");
    const result = db.prepare(`
      INSERT INTO tax_report_snapshots (year, profile_id, profile_label, report_json, report_checksum)
      VALUES (?, ?, ?, ?, ?)
    `).run(year, report.profile.id, report.profile.label, reportJson, checksum);
    createNotification("success", "Steuerreport archiviert", `Jahres-Snapshot ${year} wurde lokal mit Prüfsumme gespeichert.`);
    response.status(201).json({ id: Number(result.lastInsertRowid), year, profileId: report.profile.id, profileLabel: report.profile.label, checksum });
  } catch (error) {
    next(error);
  }
});

app.get("/api/tax-report.csv", (request, response, next) => {
  try {
    const report = taxReportResponse(reportYear(request.query.year));
    const rows = [
      ["Kategorie", "Asset", "Menge", "Datum", "Anschaffungsdatum", "Erlös EUR", "Kosten EUR", "Gebühr EUR", "Gewinn EUR", "Haltedauer Tage", "Haltefrist erfüllt", "Transaktions-ID", "Anschaffungs-ID", "Vollständig"],
      ...report.sales.map((sale) => ["Verkauf", sale.asset, sale.amount, sale.soldAt, sale.acquiredAt, sale.proceedsEur, sale.costEur, sale.feeEur, sale.profitEur, sale.holdingDays, sale.holdingPeriodMet === null ? "" : sale.holdingPeriodMet ? "ja" : "nein", sale.transactionId, sale.acquisitionTransactionId, sale.complete ? "ja" : "nein"]),
      ...report.income.map((entry) => [entry.type, entry.asset, entry.amount, entry.receivedAt, "", entry.valueEur, "", "", "", "", "", entry.transactionId, "", entry.complete ? "ja" : "nein"]),
    ];
    response
      .type("text/csv")
      .attachment(`cryptobuch-steuerreport-${report.year}.csv`)
      .send(rows.map((row) => row.map(csvCell).join(";")).join("\n"));
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
    updateWalletMetadata(Number(result.lastInsertRowid), request.body?.groupName, request.body?.tags);
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

app.patch("/api/wallets/:id", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Wallet-ID.");
    getWallet(id);
    const label = cleanLabel(request.body?.label, 80);
    db.prepare("UPDATE wallets SET label = ? WHERE id = ?").run(label, id);
    updateWalletMetadata(id, request.body?.groupName, request.body?.tags);
    response.json(getWallet(id));
  } catch (error) { next(error); }
});

function parseCsvRows(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw makeError("Die CSV benötigt eine Kopfzeile und mindestens eine Transaktion.");
  const split = (line) => line.split(line.includes(";") ? ";" : ",").map((value) => value.trim().replace(/^"|"$/g, "").replaceAll('""', '"'));
  const columns = split(lines.shift()).map((column) => column.toLowerCase());
  const required = ["timestamp", "direction", "asset", "amount"];
  if (required.some((column) => !columns.includes(column))) throw makeError("CSV-Spalten erforderlich: timestamp, direction, asset, amount. Optional: fee, purpose, price_eur, hash.");
  return lines.map((line) => Object.fromEntries(split(line).map((value, index) => [columns[index], value])));
}

app.post("/api/import/csv", (request, response, next) => {
  try {
    const walletId = asPositiveId(request.body?.walletId);
    if (!walletId) throw makeError("Bitte eine Ziel-Wallet auswählen.");
    const wallet = getWallet(walletId);
    const rows = parseCsvRows(request.body?.csv);
    if (rows.length > 2500) throw makeError("Maximal 2.500 CSV-Transaktionen gleichzeitig importieren.");
    const insert = db.prepare(`INSERT INTO transactions (wallet_id, external_id, hash, timestamp, direction, asset, asset_symbol, asset_name, asset_decimals, amount, fee, fee_asset, counterparty, price_transaction_eur, price_source, purpose, purpose_origin, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, 'manual', ?)
      ON CONFLICT(wallet_id, external_id) DO UPDATE SET timestamp=excluded.timestamp, direction=excluded.direction, amount=excluded.amount, fee=excluded.fee, price_transaction_eur=excluded.price_transaction_eur, purpose=excluded.purpose, purpose_origin='manual', raw_json=excluded.raw_json, updated_at=datetime('now')`);
    let imported = 0;
    db.exec("BEGIN");
    try {
      for (const [index, row] of rows.entries()) {
        const direction = String(row.direction || "").toLowerCase();
        const amount = Number(String(row.amount || "").replace(",", "."));
        const timestamp = new Date(row.timestamp).toISOString();
        if (!['in', 'out', 'self'].includes(direction) || !Number.isFinite(amount) || amount <= 0 || Number.isNaN(new Date(row.timestamp).getTime())) throw makeError(`Ungültige CSV-Zeile ${index + 2}.`);
        const asset = cleanLabel(row.asset, 48).toUpperCase();
        const price = row.price_eur === undefined || row.price_eur === "" ? null : Number(String(row.price_eur).replace(",", "."));
        if (!asset || (price !== null && (!Number.isFinite(price) || price <= 0))) throw makeError(`Ungültige CSV-Zeile ${index + 2}.`);
        const externalId = cleanLabel(row.external_id || row.hash || `csv-${wallet.id}-${index}-${timestamp}`, 180);
        insert.run(wallet.id, externalId, cleanLabel(row.hash || externalId, 180), timestamp, direction, asset, asset, asset, 8, amount, Number(String(row.fee || 0).replace(",", ".")) || 0, asset, cleanLabel(row.counterparty, 160) || null, price, cleanPurpose(row.purpose), JSON.stringify({ source: "csv", row }));
        imported += 1;
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    response.status(201).json({ imported, walletId: wallet.id });
  } catch (error) { next(error); }
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
  let wallet = null;
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Wallet-ID.");
    wallet = getWallet(id);
    const result = await syncWallet(wallet);
    recordSyncEvent(wallet.id, "success", result.imported);
    response.json(result);
  } catch (error) {
    if (wallet) recordSyncEvent(wallet.id, "error", 0, String(error.message || "Synchronisierung fehlgeschlagen.").slice(0, 500));
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

app.patch("/api/transactions/:id/historical-price", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Transaktions-ID.");
    const rawPrice = request.body?.priceTransactionEur;
    const note = cleanLabel(request.body?.note, 240) || null;
    if (rawPrice === null || rawPrice === undefined || rawPrice === "") {
      const result = db.prepare(`
        UPDATE transactions
        SET price_transaction_eur = NULL, price_source = 'auto', updated_at = datetime('now')
        WHERE id = ?
      `).run(id);
      if (!result.changes) throw makeError("Transaktion nicht gefunden.", 404);
      db.prepare("DELETE FROM historical_price_retries WHERE transaction_id = ?").run(id);
      db.prepare("INSERT INTO transaction_price_audit (transaction_id, price_eur, source, note) VALUES (?, ?, ?, ?)").run(id, null, "auto", note || "Automatische Preisermittlung wieder aktiviert");
      response.json({ id, price_transaction_eur: null, price_source: "auto" });
      return;
    }
    const price = positiveNumber(rawPrice);
    if (!price || price > 1000000000000) throw makeError("Der historische Preis muss eine positive EUR-Zahl sein.");
    const result = db.prepare(`
      UPDATE transactions
      SET price_transaction_eur = ?, price_source = 'manual', updated_at = datetime('now')
      WHERE id = ?
    `).run(price, id);
    if (!result.changes) throw makeError("Transaktion nicht gefunden.", 404);
    db.prepare("DELETE FROM historical_price_retries WHERE transaction_id = ?").run(id);
    db.prepare("INSERT INTO transaction_price_audit (transaction_id, price_eur, source, note) VALUES (?, ?, ?, ?)").run(id, price, "manual", note);
    response.json({ id, price_transaction_eur: price, price_source: "manual" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/transactions/:id/price-history", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Transaktions-ID.");
    const transaction = db.prepare("SELECT id, price_transaction_eur, price_source, updated_at FROM transactions WHERE id = ?").get(id);
    if (!transaction) throw makeError("Transaktion nicht gefunden.", 404);
    const changes = db.prepare(`
      SELECT price_eur, source, note, changed_at
      FROM transaction_price_audit
      WHERE transaction_id = ?
      ORDER BY id DESC
      LIMIT 20
    `).all(id);
    response.json({ transaction, changes });
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

app.get("/api/wallets/:id/qr", async (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Wallet-ID.");
    const wallet = getWallet(id);
    const dataUrl = await QRCode.toDataURL(wallet.address, { errorCorrectionLevel: "M", margin: 1, width: 320, color: { dark: "#10271f", light: "#fdfcf8" } });
    response.json({ label: wallet.label || wallet.address, address: wallet.address, dataUrl });
  } catch (error) {
    next(error);
  }
});

app.post("/api/bitcoin/psbt-preview", (request, response, next) => {
  try {
    const parsed = z.object({ psbt: z.string().trim().min(20).max(1_000_000) }).safeParse(request.body || {});
    if (!parsed.success) throw makeError("Bitte eine gültige PSBT im Base64-Format einfügen.");
    response.json(previewPsbt(parsed.data.psbt));
  } catch (error) {
    if (/PSBT|base64|magic|format/i.test(String(error.message))) return next(makeError("PSBT konnte nicht gelesen werden. Es werden ausschließlich Base64-PSBTs gelesen; signiert oder gesendet wird nichts."));
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

app.get("/vendor/uplot.js", (_request, response) => response.sendFile(path.join(__dirname, "node_modules", "uplot", "dist", "uPlot.iife.min.js")));
app.get("/vendor/uplot.css", (_request, response) => response.sendFile(path.join(__dirname, "node_modules", "uplot", "dist", "uPlot.min.css")));

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

// Runs without an open browser, but only processes one bounded batch. Historic
// requests are serialized above, so a provider is never hit in parallel.
const historicalPriceScheduler = setInterval(scheduleHistoricalPriceBackfill, 60000);
historicalPriceScheduler.unref();
const initialHistoricalPriceRetry = setTimeout(scheduleHistoricalPriceBackfill, 15000);
initialHistoricalPriceRetry.unref();

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`CryptoBuch läuft auf http://0.0.0.0:${PORT}`);
  });
}

module.exports = { app, backfillHistoricalPrices, db, runtimeSettings, settingsResponse, updateSettings };
