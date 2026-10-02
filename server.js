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
const { normalizeEthereumTransaction, normalizeErc20Transfer, normalizeNftTransfer } = require("./lib/ethereum");
const { buildTopMarketCatalog } = require("./lib/market-catalog");
const { calculateAssetAnalytics } = require("./lib/portfolio-analytics");
const { buildBookValueHistory } = require("./lib/portfolio-history");
const { calculateTaxReport } = require("./lib/tax-report");
const { germanyProfile, normalizeTaxProfile } = require("./lib/tax-profile");
const { buildTaxOptimizer, simulateSale } = require("./lib/tax-optimizer");
const { classifyEvmTransaction, isLikelySpamAsset } = require("./lib/defi");
const { EXCHANGE_CSV_PROFILES, normalizeExchangeRows } = require("./lib/exchange-import");
const { fetchBitvavoHistory } = require("./lib/bitvavo");
const {
  fetchBinanceHistory,
  fetchBinanceHistoryBatch,
  parseSymbols,
  normalizeBinanceHistoryState,
  historyProgress,
  historyPhaseLabel,
} = require("./lib/binance");
const { fetchEtoroHistory } = require("./lib/etoro");
const {
  createBsdexLiveClient,
  fetchBsdexHistory,
  fetchBsdexSubscriptionInfo,
  normalizeBsdexTrade,
  normalizeBsdexBalances,
} = require("./lib/bsdex");
const {
  createTradeRepublicWebDeviceId,
  startTradeRepublicWebLogin,
  pollTradeRepublicWebLogin,
  refreshTradeRepublicWebSession,
  hasTradeRepublicWebSession,
  fetchTradeRepublicCryptoHistory,
} = require("./lib/trade-republic");
const { matchExchangeTransfer } = require("./lib/exchange-transfer-matcher");
const {
  bitvavoDailyClosePrices,
  coinbaseDailyClosePrices,
  coinGeckoDate,
  coinGeckoHeaders,
  closestPriceForDate,
  cryptoCompareDailyClosePrices,
  krakenDailyClosePrices,
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
const { toBitcoinCashUtxoPayload } = require("./lib/bitcoin-cash");
const { registerAppApi } = require("./lib/app-api");
const { buildOpenApi } = require("./lib/api-documentation");

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "cryptobuch.sqlite");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const DOCUMENT_DIR = path.join(DATA_DIR, "documents");
const TRADE_REPUBLIC_SESSION_KEY_PATH = path.join(DATA_DIR, "trade-republic-session.key");
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
  bitcoinCashApiBaseUrl: (process.env.BITCOIN_CASH_API_BASE_URL || "https://bch.fullstack.cash/v6").replace(/\/$/, ""),
  blockchairApiBaseUrl: (process.env.BLOCKCHAIR_API_BASE_URL || "https://api.blockchair.com").replace(/\/$/, ""),
  blockCypherApiBaseUrl: (process.env.BLOCKCYPHER_API_BASE_URL || "https://api.blockcypher.com/v1").replace(/\/$/, ""),
  coinGeckoBaseUrl: (process.env.COINGECKO_API_BASE_URL || "https://api.coingecko.com/api/v3").replace(/\/$/, ""),
  bitvavoApiBaseUrl: (process.env.BITVAVO_API_BASE_URL || "https://api.bitvavo.com/v2").replace(/\/$/, ""),
  coinbaseExchangeApiBaseUrl: (process.env.COINBASE_EXCHANGE_API_BASE_URL || "https://api.exchange.coinbase.com").replace(/\/$/, ""),
  krakenApiBaseUrl: (process.env.KRAKEN_API_BASE_URL || "https://api.kraken.com/0/public").replace(/\/$/, ""),
  cryptoCompareApiBaseUrl: (process.env.CRYPTOCOMPARE_API_BASE_URL || "https://min-api.cryptocompare.com/data/v2").replace(/\/$/, ""),
  binanceApiBaseUrl: (process.env.BINANCE_API_BASE_URL || "https://api.binance.com").replace(/\/$/, ""),
  etoroApiBaseUrl: (process.env.ETORO_API_BASE_URL || "https://public-api.etoro.com/api/v1").replace(/\/$/, ""),
  bsdexApiBaseUrl: (process.env.BSDEX_API_BASE_URL || "https://api-public.bsdex.de").replace(/\/$/, ""),
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
  cryptoCompareApiKey: String(process.env.CRYPTOCOMPARE_API_KEY || "").trim(),
  xpubGapLimit: DEFAULT_XPUB_GAP_LIMIT,
  xpubMaxDerivationsPerBranch: boundedInteger(process.env.XPUB_MAX_DERIVATIONS_PER_BRANCH, 200, DEFAULT_XPUB_GAP_LIMIT, 1000),
  xtzStakingPayoutAliases: String(process.env.XTZ_STAKING_PAYOUT_ALIASES || "Stake.fish Payouts").trim(),
});

const EXCHANGE_PROVIDERS = Object.freeze({
  bitvavo: Object.freeze({
    id: "bitvavo", label: "Bitvavo · Read-only API", defaultLabel: "Bitvavo", importMode: "api",
    apiKeyLabel: "Read-only API-Key", apiSecretLabel: "API-Secret",
    help: "Bitvavo: API-Key nur mit Leserecht erstellen; Trading und Auszahlungen deaktiviert lassen. Der Import verarbeitet Buchungen seriell und gleicht Ein- und Auszahlungen anschließend mit allen lokalen Wallets ab.",
  }),
  binance: Object.freeze({
    id: "binance", label: "Binance Spot · Read-only API", defaultLabel: "Binance Spot", importMode: "api",
    apiKeyLabel: "Read-only API-Key", apiSecretLabel: "API-Secret", supportsSymbols: true,
    help: "Binance: Nach dem ersten Sync wird die abrufbare Kontohistorie automatisch und gedrosselt nachgeladen. Märkte werden aus Beständen und bereits gefundenen Assets ergänzt; trage nur vollständig früher verkaufte Spot-Märkte zusätzlich ein.",
  }),
  etoro: Object.freeze({
    id: "etoro", label: "eToro · Read-only API", defaultLabel: "eToro", importMode: "api",
    apiKeyLabel: "eToro Public API-Key", apiSecretLabel: "eToro User-Key", supportsEnvironment: true,
    help: "eToro: Public API-Key und User-Key werden nur für lesende Historienabfragen verwendet. Wähle Real oder Demo passend zum User-Key; eToro-Keys funktionieren jeweils nur in ihrer Kontoart. CryptoBuch sendet keine Handels-, Auszahlungs- oder Transfer-Anfragen; die API wird seriell und gedrosselt abgefragt.",
  }),
  bsdex: Object.freeze({
    id: "bsdex", label: "BSDEX · Read-only API + Live", defaultLabel: "BSDEX", importMode: "api",
    apiKeyLabel: "BSDEX API-Key", apiSecretLabel: "BSDEX API-Secret", supportsLiveUpdates: true,
    help: "BSDEX: API-Zugang ausschließlich mit Leserechten erstellen. CryptoBuch ruft Salden, eigene Trades sowie abgeschlossene Krypto-Ein- und Auszahlungen ab und gleicht sie mit lokalen Wallets ab. Der optionale Live-Modus verarbeitet private Salden- und Trade-Updates. Orders, Stornos und Auszahlungen werden niemals ausgelöst.",
  }),
  trade_republic: Object.freeze({
    id: "trade_republic", label: "Trade Republic · inoffizieller Read-only-Import", defaultLabel: "Trade Republic", importMode: "api",
    apiKeyLabel: "Mobilnummer", apiSecretLabel: "Trade-Republic-PIN (nur für diese Anmeldung)", requiresExplicitConsent: true, requiresWebLogin: true,
    csvProfile: "trade_republic",
    help: "Inoffizieller, ausschließlich lesender Web-Import: Bestätige die Anmeldung in deiner Trade-Republic-App. Es gibt keine Geräteaktivierung; die PIN wird nicht gespeichert. CryptoBuch speichert ausschließlich eine verschlüsselte lokale Web-Sitzung für Timeline und Timeline-Details – niemals Orders, Auszahlungen oder Transfers.",
  }),
});
const PURPOSE_PRESETS = [
  "Kauf",
  "Verkauf",
  "Staking Rewards",
  "Mining Reward",
  "Airdrop",
  "Lending-Ertrag",
  "DeFi-Ertrag",
  "DeFi Swap",
  "Liquidity Pool",
  "Bridge",
  "NFT",
  "Spam",
  "Transfer",
  "Geschenk",
  "Gebühr",
  "Sonstiges",
];
// Exchange balances are not blockchain wallets. Stablecoins commonly appear
// as the counter-leg of a Binance trade nevertheless, so retain their own
// pricing identity instead of accidentally valuing them at the target
// wallet's native-coin price.
const EXCHANGE_ASSET_CONFIG = Object.freeze({
  USDT: { name: "Tether", symbol: "USDT", decimals: 6, icon: "₮", coinGeckoId: "tether" },
  USDC: { name: "USD Coin", symbol: "USDC", decimals: 6, icon: "$", coinGeckoId: "usd-coin" },
  DAI: { name: "Dai", symbol: "DAI", decimals: 18, icon: "◈", coinGeckoId: "dai" },
  FDUSD: { name: "First Digital USD", symbol: "FDUSD", decimals: 6, icon: "$", coinGeckoId: "first-digital-usd" },
  BUSD: { name: "Binance USD", symbol: "BUSD", decimals: 18, icon: "$", coinGeckoId: "binance-usd" },
});

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(DOCUMENT_DIR, { recursive: true });

function loadTradeRepublicSessionKey() {
  try {
    const key = fs.readFileSync(TRADE_REPUBLIC_SESSION_KEY_PATH);
    if (key.length === 32) return key;
    throw new Error("ungültige Länge");
  } catch (error) {
    if (error.code && error.code !== "ENOENT") throw new Error("Der lokale Schlüssel für Trade-Republic-Websitzungen konnte nicht gelesen werden.");
    const key = crypto.randomBytes(32);
    try { fs.writeFileSync(TRADE_REPUBLIC_SESSION_KEY_PATH, key, { mode: 0o600, flag: "wx" }); }
    catch (writeError) {
      if (writeError.code !== "EEXIST") throw new Error("Der lokale Schlüssel für Trade-Republic-Websitzungen konnte nicht angelegt werden.");
      return loadTradeRepublicSessionKey();
    }
    return key;
  }
}

const TRADE_REPUBLIC_SESSION_KEY = loadTradeRepublicSessionKey();

function encryptTradeRepublicSession(session) {
  const plaintext = JSON.stringify(session || {});
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", TRADE_REPUBLIC_SESSION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") });
}

function decryptTradeRepublicSession(value) {
  if (!value) return {};
  try {
    const payload = JSON.parse(value);
    if (payload?.v !== 1 || !payload.iv || !payload.tag || !payload.ciphertext) return {};
    const decipher = crypto.createDecipheriv("aes-256-gcm", TRADE_REPUBLIC_SESSION_KEY, Buffer.from(payload.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64url")), decipher.final()]).toString("utf8")) || {};
  } catch (_) { return {}; }
}
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY,
    chain TEXT NOT NULL,
    address TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'address' CHECK (source_type IN ('address', 'xpub', 'stake', 'exchange')),
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
    asset_type TEXT NOT NULL DEFAULT 'native' CHECK (asset_type IN ('native', 'erc20', 'nft')),
    amount REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    fee_asset TEXT,
    counterparty TEXT,
    price_transaction_eur REAL,
    price_source TEXT NOT NULL DEFAULT 'auto' CHECK (price_source IN ('auto', 'manual')),
    price_provider TEXT,
    price_recorded_at TEXT,
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
    source TEXT NOT NULL DEFAULT 'coingecko',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (coin_id, price_date)
  );
  CREATE TABLE IF NOT EXISTS historical_price_retries (
    transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT NOT NULL,
    next_attempt_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS historical_price_runs (
    id INTEGER PRIMARY KEY,
    trigger TEXT NOT NULL,
    force_run INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error', 'interrupted')),
    pending_count INTEGER,
    attempted_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    unresolved_count INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    error_message TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS historical_price_fetch_events (
    id INTEGER PRIMARY KEY,
    run_id INTEGER REFERENCES historical_price_runs(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    asset TEXT NOT NULL,
    date_from TEXT,
    date_to TEXT,
    status TEXT NOT NULL CHECK (status IN ('success', 'error')),
    returned_prices INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    type TEXT NOT NULL CHECK (type IN ('wallet_sync', 'price_backfill', 'exchange_sync', 'exchange_history_sync', 'exchange_transfer_check')),
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
  CREATE TABLE IF NOT EXISTS transfer_links (
    id INTEGER PRIMARY KEY,
    outgoing_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
    incoming_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
    match_origin TEXT NOT NULL DEFAULT 'manual' CHECK (match_origin IN ('manual', 'suggested')),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (outgoing_transaction_id <> incoming_transaction_id)
  );
  CREATE TABLE IF NOT EXISTS transaction_documents (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_transactions_wallet_timestamp
    ON transactions(wallet_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_asset_direction_timestamp
    ON transactions(asset, direction, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_purpose
    ON transactions(purpose) WHERE purpose IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_wallet_addresses_wallet_branch_index
    ON wallet_addresses(wallet_id, branch, derivation_index);
  CREATE INDEX IF NOT EXISTS idx_historical_price_retries_next_attempt
    ON historical_price_retries(next_attempt_at);
  CREATE INDEX IF NOT EXISTS idx_historical_price_runs_started
    ON historical_price_runs(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_historical_price_fetch_events_run
    ON historical_price_fetch_events(run_id, id DESC);
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
  CREATE INDEX IF NOT EXISTS idx_transfer_links_incoming
    ON transfer_links(incoming_transaction_id);
  CREATE INDEX IF NOT EXISTS idx_transaction_documents_transaction
    ON transaction_documents(transaction_id, id DESC);
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
  const needsExchangeSourceType = !walletSql.includes("'exchange'");
  if (!walletSql.includes("CHECK (chain IN") && hasChainScopedUniqueAddress && !needsExchangeSourceType) return;
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
      source_type TEXT NOT NULL DEFAULT 'address' CHECK (source_type IN ('address', 'xpub', 'stake', 'exchange')),
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

function migrateBackgroundJobSchema() {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'background_jobs'").get()?.sql || "";
  if (sql.includes("exchange_transfer_check") && sql.includes("exchange_history_sync")) return;
  db.exec(`
    BEGIN;
    CREATE TABLE background_jobs_migration (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('wallet_sync', 'price_backfill', 'exchange_sync', 'exchange_history_sync', 'exchange_transfer_check')),
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
    INSERT INTO background_jobs_migration
      SELECT id, type, payload_json, status, progress_current, progress_total, result_json, error_message, created_at, started_at, finished_at
      FROM background_jobs;
    DROP TABLE background_jobs;
    ALTER TABLE background_jobs_migration RENAME TO background_jobs;
    COMMIT;
    CREATE INDEX IF NOT EXISTS idx_background_jobs_status_created ON background_jobs(status, created_at);
  `);
}

migrateBackgroundJobSchema();
// A process restart must not leave the serial queue permanently blocked by a
// job that was marked running just before shutdown. Re-queueing is safe:
// imports are deduplicated by their external IDs and manual fields survive.
db.prepare("UPDATE background_jobs SET status = 'queued', started_at = NULL WHERE status = 'running'").run();
db.prepare(`UPDATE historical_price_runs
  SET status = 'interrupted', finished_at = datetime('now'), error_message = 'Lokaler Dienst wurde vor Abschluss beendet.'
  WHERE status = 'running'`).run();

// Erst nach einer möglichen Wallet-Tabellenmigration anlegen, damit bestehende
// Datenbanken mit älterem UNIQUE-Schema ohne Fremdschlüssel-Konflikt migrieren.
db.exec(`
  CREATE TABLE IF NOT EXISTS wallet_metadata (
    wallet_id INTEGER PRIMARY KEY REFERENCES wallets(id) ON DELETE CASCADE,
    group_name TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS exchange_connections (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL CHECK (provider IN ('bitvavo', 'binance', 'etoro', 'bsdex', 'trade_republic')),
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL,
    api_secret TEXT NOT NULL,
    etoro_environment TEXT NOT NULL DEFAULT 'real' CHECK (etoro_environment IN ('real', 'demo')),
    symbols TEXT NOT NULL DEFAULT '',
    import_mode TEXT NOT NULL DEFAULT 'api' CHECK (import_mode IN ('api', 'csv')),
    history_state TEXT NOT NULL DEFAULT '',
    history_started_at TEXT,
    history_completed_at TEXT,
    history_last_error TEXT,
    trade_republic_device_key TEXT NOT NULL DEFAULT '',
    trade_republic_activation_id TEXT NOT NULL DEFAULT '',
    trade_republic_activation_started_at TEXT,
    trade_republic_activation_error TEXT,
    trade_republic_activated_at TEXT,
    trade_republic_disclaimer_accepted_at TEXT,
    trade_republic_web_session TEXT NOT NULL DEFAULT '',
    trade_republic_web_pending_session TEXT NOT NULL DEFAULT '',
    trade_republic_web_device_id TEXT NOT NULL DEFAULT '',
    trade_republic_web_login_id TEXT NOT NULL DEFAULT '',
    trade_republic_web_login_started_at TEXT,
    trade_republic_web_login_error TEXT,
    trade_republic_web_connected_at TEXT,
    live_updates_enabled INTEGER NOT NULL DEFAULT 0 CHECK (live_updates_enabled IN (0, 1)),
    live_status TEXT NOT NULL DEFAULT 'disabled' CHECK (live_status IN ('disabled', 'connecting', 'connected', 'reconnecting', 'error')),
    live_connected_at TEXT,
    live_last_event_at TEXT,
    live_last_error TEXT,
    live_last_reconciled_at TEXT,
    last_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(provider, wallet_id, label)
  );
  CREATE INDEX IF NOT EXISTS idx_exchange_connections_wallet
    ON exchange_connections(wallet_id, id DESC);
`);

function migrateExchangeConnectionSchema() {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'exchange_connections'").get()?.sql || "";
  const columns = new Set(db.prepare("PRAGMA table_info(exchange_connections)").all().map((column) => column.name));
  if (sql.includes("binance") && sql.includes("etoro") && sql.includes("bsdex") && sql.includes("trade_republic") && columns.has("etoro_environment") && columns.has("symbols") && columns.has("import_mode") && columns.has("history_state") && columns.has("history_started_at") && columns.has("history_completed_at") && columns.has("history_last_error") && columns.has("trade_republic_device_key") && columns.has("trade_republic_activation_id") && columns.has("trade_republic_activation_started_at") && columns.has("trade_republic_activation_error") && columns.has("trade_republic_activated_at") && columns.has("trade_republic_disclaimer_accepted_at") && columns.has("trade_republic_web_session") && columns.has("trade_republic_web_pending_session") && columns.has("trade_republic_web_device_id") && columns.has("trade_republic_web_login_id") && columns.has("trade_republic_web_login_started_at") && columns.has("trade_republic_web_login_error") && columns.has("trade_republic_web_connected_at") && columns.has("live_updates_enabled") && columns.has("live_status") && columns.has("live_connected_at") && columns.has("live_last_event_at") && columns.has("live_last_error") && columns.has("live_last_reconciled_at")) return;
  const etoroEnvironment = columns.has("etoro_environment") ? "etoro_environment" : "'real'";
  const symbols = columns.has("symbols") ? "symbols" : "''";
  const importMode = columns.has("import_mode") ? "import_mode" : "'api'";
  const historyState = columns.has("history_state") ? "history_state" : "''";
  const historyStartedAt = columns.has("history_started_at") ? "history_started_at" : "NULL";
  const historyCompletedAt = columns.has("history_completed_at") ? "history_completed_at" : "NULL";
  const historyLastError = columns.has("history_last_error") ? "history_last_error" : "NULL";
  const tradeRepublicDeviceKey = columns.has("trade_republic_device_key") ? "trade_republic_device_key" : "''";
  const tradeRepublicActivationId = columns.has("trade_republic_activation_id") ? "trade_republic_activation_id" : "''";
  const tradeRepublicActivationStartedAt = columns.has("trade_republic_activation_started_at") ? "trade_republic_activation_started_at" : "NULL";
  const tradeRepublicActivationError = columns.has("trade_republic_activation_error") ? "trade_republic_activation_error" : "NULL";
  const tradeRepublicActivatedAt = columns.has("trade_republic_activated_at") ? "trade_republic_activated_at" : "NULL";
  const tradeRepublicDisclaimerAcceptedAt = columns.has("trade_republic_disclaimer_accepted_at") ? "trade_republic_disclaimer_accepted_at" : "NULL";
  const tradeRepublicWebSession = columns.has("trade_republic_web_session") ? "trade_republic_web_session" : "''";
  const tradeRepublicWebPendingSession = columns.has("trade_republic_web_pending_session") ? "trade_republic_web_pending_session" : "''";
  const tradeRepublicWebDeviceId = columns.has("trade_republic_web_device_id") ? "trade_republic_web_device_id" : "''";
  const tradeRepublicWebLoginId = columns.has("trade_republic_web_login_id") ? "trade_republic_web_login_id" : "''";
  const tradeRepublicWebLoginStartedAt = columns.has("trade_republic_web_login_started_at") ? "trade_republic_web_login_started_at" : "NULL";
  const tradeRepublicWebLoginError = columns.has("trade_republic_web_login_error") ? "trade_republic_web_login_error" : "NULL";
  const tradeRepublicWebConnectedAt = columns.has("trade_republic_web_connected_at") ? "trade_republic_web_connected_at" : "NULL";
  const liveUpdatesEnabled = columns.has("live_updates_enabled") ? "live_updates_enabled" : "0";
  const liveStatus = columns.has("live_status") ? "live_status" : "'disabled'";
  const liveConnectedAt = columns.has("live_connected_at") ? "live_connected_at" : "NULL";
  const liveLastEventAt = columns.has("live_last_event_at") ? "live_last_event_at" : "NULL";
  const liveLastError = columns.has("live_last_error") ? "live_last_error" : "NULL";
  const liveLastReconciledAt = columns.has("live_last_reconciled_at") ? "live_last_reconciled_at" : "NULL";
  db.exec(`
    BEGIN;
    CREATE TABLE exchange_connections_migration (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL CHECK (provider IN ('bitvavo', 'binance', 'etoro', 'bsdex', 'trade_republic')),
      wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL,
      api_secret TEXT NOT NULL,
      etoro_environment TEXT NOT NULL DEFAULT 'real' CHECK (etoro_environment IN ('real', 'demo')),
      symbols TEXT NOT NULL DEFAULT '',
      import_mode TEXT NOT NULL DEFAULT 'api' CHECK (import_mode IN ('api', 'csv')),
      history_state TEXT NOT NULL DEFAULT '',
      history_started_at TEXT,
      history_completed_at TEXT,
      history_last_error TEXT,
      trade_republic_device_key TEXT NOT NULL DEFAULT '',
      trade_republic_activation_id TEXT NOT NULL DEFAULT '',
      trade_republic_activation_started_at TEXT,
      trade_republic_activation_error TEXT,
      trade_republic_activated_at TEXT,
      trade_republic_disclaimer_accepted_at TEXT,
      trade_republic_web_session TEXT NOT NULL DEFAULT '',
      trade_republic_web_pending_session TEXT NOT NULL DEFAULT '',
      trade_republic_web_device_id TEXT NOT NULL DEFAULT '',
      trade_republic_web_login_id TEXT NOT NULL DEFAULT '',
      trade_republic_web_login_started_at TEXT,
      trade_republic_web_login_error TEXT,
      trade_republic_web_connected_at TEXT,
      live_updates_enabled INTEGER NOT NULL DEFAULT 0 CHECK (live_updates_enabled IN (0, 1)),
      live_status TEXT NOT NULL DEFAULT 'disabled' CHECK (live_status IN ('disabled', 'connecting', 'connected', 'reconnecting', 'error')),
      live_connected_at TEXT,
      live_last_event_at TEXT,
      live_last_error TEXT,
      live_last_reconciled_at TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, wallet_id, label)
    );
    INSERT INTO exchange_connections_migration (id, provider, wallet_id, label, api_key, api_secret, etoro_environment, symbols, import_mode, history_state, history_started_at, history_completed_at, history_last_error, trade_republic_device_key, trade_republic_activation_id, trade_republic_activation_started_at, trade_republic_activation_error, trade_republic_activated_at, trade_republic_disclaimer_accepted_at, trade_republic_web_session, trade_republic_web_pending_session, trade_republic_web_device_id, trade_republic_web_login_id, trade_republic_web_login_started_at, trade_republic_web_login_error, trade_republic_web_connected_at, live_updates_enabled, live_status, live_connected_at, live_last_event_at, live_last_error, live_last_reconciled_at, last_synced_at, created_at)
      SELECT id, provider, wallet_id, label, api_key, api_secret, ${etoroEnvironment}, ${symbols}, ${importMode}, ${historyState}, ${historyStartedAt}, ${historyCompletedAt}, ${historyLastError}, ${tradeRepublicDeviceKey}, ${tradeRepublicActivationId}, ${tradeRepublicActivationStartedAt}, ${tradeRepublicActivationError}, ${tradeRepublicActivatedAt}, ${tradeRepublicDisclaimerAcceptedAt}, ${tradeRepublicWebSession}, ${tradeRepublicWebPendingSession}, ${tradeRepublicWebDeviceId}, ${tradeRepublicWebLoginId}, ${tradeRepublicWebLoginStartedAt}, ${tradeRepublicWebLoginError}, ${tradeRepublicWebConnectedAt}, ${liveUpdatesEnabled}, ${liveStatus}, ${liveConnectedAt}, ${liveLastEventAt}, ${liveLastError}, ${liveLastReconciledAt}, last_synced_at, created_at FROM exchange_connections;
    DROP TABLE exchange_connections;
    ALTER TABLE exchange_connections_migration RENAME TO exchange_connections;
    COMMIT;
    CREATE INDEX IF NOT EXISTS idx_exchange_connections_wallet ON exchange_connections(wallet_id, id DESC);
  `);
}

migrateExchangeConnectionSchema();

// eToro trennt Real- und Demo-Historie über unterschiedliche Endpunkte. Eine
// additive Migration bewahrt alle bestehenden lokalen Zugangsdaten und ordnet
// vor der Einführung gespeicherte Verbindungen konservativ dem Realkonto zu.
const exchangeConnectionColumns = new Set(db.prepare("PRAGMA table_info(exchange_connections)").all().map((column) => column.name));
if (!exchangeConnectionColumns.has("etoro_environment")) {
  db.exec("ALTER TABLE exchange_connections ADD COLUMN etoro_environment TEXT NOT NULL DEFAULT 'real' CHECK (etoro_environment IN ('real', 'demo'))");
}

// Existing installations predate automatic purpose assignment. Preserve manual
// entries, while allowing unclassified legacy rows to be enriched on re-sync.
const walletColumnNames = new Set(db.prepare("PRAGMA table_info(wallets)").all().map((column) => column.name));
if (!walletColumnNames.has("source_type")) db.exec("ALTER TABLE wallets ADD COLUMN source_type TEXT NOT NULL DEFAULT 'address'");
if (!walletColumnNames.has("xpub_address_type")) db.exec("ALTER TABLE wallets ADD COLUMN xpub_address_type TEXT");

function exchangeAccountLabel(provider, label) {
  return cleanLabel(label, 80) || EXCHANGE_PROVIDERS[provider]?.defaultLabel || "Börsenkonto";
}

function createExchangeAccountWallet(provider, label, identifier = crypto.randomUUID()) {
  const address = "exchange:" + provider + ":" + identifier;
  const result = db.prepare(
    "INSERT INTO wallets (chain, address, label, source_type) VALUES ('EXCHANGE', ?, ?, 'exchange')",
  ).run(address, exchangeAccountLabel(provider, label));
  return Number(result.lastInsertRowid);
}

function migrateExchangeConnectionsToDedicatedAccounts() {
  const connections = db.prepare(
    "SELECT c.id, c.provider, c.label, c.wallet_id FROM exchange_connections c JOIN wallets w ON w.id = c.wallet_id WHERE w.source_type <> 'exchange'",
  ).all();
  if (!connections.length) return;
  db.exec("BEGIN");
  try {
    for (const connection of connections) {
      const accountWalletId = createExchangeAccountWallet(connection.provider, connection.label, connection.id);
      // Exchange records were formerly placed in an arbitrary wallet. Move
      // only rows that carry the explicit API-source marker, preserving their
      // IDs, manual purpose/price overrides, documents and transfer links.
      db.prepare("UPDATE transactions SET wallet_id = ? WHERE wallet_id = ? AND raw_json LIKE ?")
        .run(accountWalletId, connection.wallet_id, '%\"source\":\"' + connection.provider + '-api\"%');
      db.prepare("UPDATE exchange_connections SET wallet_id = ? WHERE id = ?").run(accountWalletId, connection.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

migrateExchangeConnectionsToDedicatedAccounts();

// Exchange history is an accounting journal, while the authenticated
// read-only balance is the authoritative statement of what is currently on
// an exchange.  Keep the latter separately: it must never be fabricated as
// a purchase, sale or tax lot when the history has a gap.
db.exec(`
  CREATE TABLE IF NOT EXISTS exchange_balance_snapshot_meta (
    connection_id INTEGER PRIMARY KEY REFERENCES exchange_connections(id) ON DELETE CASCADE,
    observed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS exchange_balance_snapshots (
    connection_id INTEGER NOT NULL REFERENCES exchange_connections(id) ON DELETE CASCADE,
    asset TEXT NOT NULL,
    free_amount REAL NOT NULL,
    locked_amount REAL NOT NULL,
    PRIMARY KEY (connection_id, asset)
  );
  CREATE INDEX IF NOT EXISTS idx_exchange_balance_snapshots_connection
    ON exchange_balance_snapshots(connection_id, asset);
`);

const transactionColumnNames = new Set(db.prepare("PRAGMA table_info(transactions)").all().map((column) => column.name));
if (!transactionColumnNames.has("purpose_origin")) {
  db.exec("ALTER TABLE transactions ADD COLUMN purpose_origin TEXT NOT NULL DEFAULT 'unspecified'");
  db.prepare("UPDATE transactions SET purpose_origin = 'manual' WHERE purpose IS NOT NULL").run();
}
if (!transactionColumnNames.has("asset_symbol")) db.exec("ALTER TABLE transactions ADD COLUMN asset_symbol TEXT");
if (!transactionColumnNames.has("asset_name")) db.exec("ALTER TABLE transactions ADD COLUMN asset_name TEXT");
if (!transactionColumnNames.has("asset_decimals")) db.exec("ALTER TABLE transactions ADD COLUMN asset_decimals INTEGER");
if (!transactionColumnNames.has("asset_contract")) db.exec("ALTER TABLE transactions ADD COLUMN asset_contract TEXT");
if (!transactionColumnNames.has("asset_type")) db.exec("ALTER TABLE transactions ADD COLUMN asset_type TEXT NOT NULL DEFAULT 'native'");
if (!transactionColumnNames.has("fee_asset")) db.exec("ALTER TABLE transactions ADD COLUMN fee_asset TEXT");
if (!transactionColumnNames.has("price_source")) db.exec("ALTER TABLE transactions ADD COLUMN price_source TEXT NOT NULL DEFAULT 'auto'");
if (!transactionColumnNames.has("price_provider")) db.exec("ALTER TABLE transactions ADD COLUMN price_provider TEXT");
if (!transactionColumnNames.has("price_recorded_at")) db.exec("ALTER TABLE transactions ADD COLUMN price_recorded_at TEXT");
// Earlier installations stored the amount and whether it was protected, but
// not the actual provider. Do not invent one retroactively: make that gap
// visible in the journal instead.
db.prepare(`
  UPDATE transactions
  SET price_provider = CASE WHEN price_source = 'manual' THEN 'manual' ELSE 'legacy' END
  WHERE price_provider IS NULL AND price_transaction_eur IS NOT NULL AND price_transaction_eur > 0
`).run();
db.prepare(`
  UPDATE transactions
  SET price_recorded_at = updated_at
  WHERE price_recorded_at IS NULL AND price_transaction_eur IS NOT NULL AND price_transaction_eur > 0
`).run();

const priceHistoryColumnNames = new Set(db.prepare("PRAGMA table_info(price_history)").all().map((column) => column.name));
if (!priceHistoryColumnNames.has("source")) db.exec("ALTER TABLE price_history ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'");

const app = express();
app.disable("x-powered-by");
app.use("/api", (_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "64kb" }));

let currentPriceCache = { expiresAt: 0, data: {} };
let tokenPriceCache = { expiresAt: 0, data: {} };
let exchangeAssetPriceCache = { expiresAt: 0, data: {} };
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
    ethereumRpcUrl: values.ethereumRpcUrl || SETTINGS_DEFAULTS.ethereumRpcUrl,
    bscScanApiBaseUrl: values.bscScanApiBaseUrl || SETTINGS_DEFAULTS.bscScanApiBaseUrl,
    snowtraceApiBaseUrl: values.snowtraceApiBaseUrl || SETTINGS_DEFAULTS.snowtraceApiBaseUrl,
    solscanApiBaseUrl: values.solscanApiBaseUrl || SETTINGS_DEFAULTS.solscanApiBaseUrl,
    xrplRpcUrl: values.xrplRpcUrl || SETTINGS_DEFAULTS.xrplRpcUrl,
    stellarHorizonBaseUrl: values.stellarHorizonBaseUrl || SETTINGS_DEFAULTS.stellarHorizonBaseUrl,
    nearBlocksApiBaseUrl: values.nearBlocksApiBaseUrl || SETTINGS_DEFAULTS.nearBlocksApiBaseUrl,
    tonApiBaseUrl: values.tonApiBaseUrl || SETTINGS_DEFAULTS.tonApiBaseUrl,
    bitcoinCashApiBaseUrl: values.bitcoinCashApiBaseUrl || SETTINGS_DEFAULTS.bitcoinCashApiBaseUrl,
    blockchairApiBaseUrl: values.blockchairApiBaseUrl || SETTINGS_DEFAULTS.blockchairApiBaseUrl,
    blockCypherApiBaseUrl: values.blockCypherApiBaseUrl || SETTINGS_DEFAULTS.blockCypherApiBaseUrl,
    coinGeckoBaseUrl: values.coinGeckoBaseUrl || SETTINGS_DEFAULTS.coinGeckoBaseUrl,
    bitvavoApiBaseUrl: values.bitvavoApiBaseUrl || SETTINGS_DEFAULTS.bitvavoApiBaseUrl,
    coinbaseExchangeApiBaseUrl: values.coinbaseExchangeApiBaseUrl || SETTINGS_DEFAULTS.coinbaseExchangeApiBaseUrl,
    krakenApiBaseUrl: values.krakenApiBaseUrl || SETTINGS_DEFAULTS.krakenApiBaseUrl,
    cryptoCompareApiBaseUrl: values.cryptoCompareApiBaseUrl || SETTINGS_DEFAULTS.cryptoCompareApiBaseUrl,
    binanceApiBaseUrl: values.binanceApiBaseUrl || SETTINGS_DEFAULTS.binanceApiBaseUrl,
    etoroApiBaseUrl: values.etoroApiBaseUrl || SETTINGS_DEFAULTS.etoroApiBaseUrl,
    bsdexApiBaseUrl: values.bsdexApiBaseUrl || SETTINGS_DEFAULTS.bsdexApiBaseUrl,
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
    cryptoCompareApiKey: values.cryptoCompareApiKey || "",
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
    bitcoinCashApiBaseUrl: settings.bitcoinCashApiBaseUrl,
    blockchairApiBaseUrl: settings.blockchairApiBaseUrl,
    blockCypherApiBaseUrl: settings.blockCypherApiBaseUrl,
    coinGeckoBaseUrl: settings.coinGeckoBaseUrl,
    bitvavoApiBaseUrl: settings.bitvavoApiBaseUrl,
    coinbaseExchangeApiBaseUrl: settings.coinbaseExchangeApiBaseUrl,
    krakenApiBaseUrl: settings.krakenApiBaseUrl,
    cryptoCompareApiBaseUrl: settings.cryptoCompareApiBaseUrl,
    binanceApiBaseUrl: settings.binanceApiBaseUrl,
    etoroApiBaseUrl: settings.etoroApiBaseUrl,
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
    cryptoCompareApiKeyConfigured: Boolean(settings.cryptoCompareApiKey),
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
    bitcoinCashApiBaseUrl: cleanServiceUrl(input.bitcoinCashApiBaseUrl, "Die Bitcoin-Cash-Indexer-URL"),
    blockchairApiBaseUrl: cleanServiceUrl(input.blockchairApiBaseUrl, "Die Blockchair-URL"),
    blockCypherApiBaseUrl: cleanServiceUrl(input.blockCypherApiBaseUrl, "Die BlockCypher-URL"),
    coinGeckoBaseUrl: cleanServiceUrl(input.coinGeckoBaseUrl, "Die CoinGecko-URL"),
    bitvavoApiBaseUrl: cleanServiceUrl(input.bitvavoApiBaseUrl, "Die Bitvavo-URL"),
    coinbaseExchangeApiBaseUrl: cleanServiceUrl(input.coinbaseExchangeApiBaseUrl, "Die Coinbase-Exchange-URL"),
    krakenApiBaseUrl: cleanServiceUrl(input.krakenApiBaseUrl, "Die Kraken-URL"),
    cryptoCompareApiBaseUrl: cleanServiceUrl(input.cryptoCompareApiBaseUrl, "Die CryptoCompare-URL"),
    binanceApiBaseUrl: cleanServiceUrl(input.binanceApiBaseUrl, "Die Binance-URL"),
    etoroApiBaseUrl: cleanServiceUrl(input.etoroApiBaseUrl, "Die eToro-URL"),
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
    cryptoCompareApiKey: input.clearCryptoCompareApiKey ? "" : String(input.cryptoCompareApiKey || "").trim() || current.cryptoCompareApiKey,
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
  exchangeAssetPriceCache = { expiresAt: 0, data: {} };
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

async function fetchJsonRequest(url, { method = "GET", body, additionalHeaders = {} } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      body,
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
    if (response.status === 430) {
      throw makeError("Die Blockchain-Datenquelle hat die Server-IP wegen zu hoher API-Nutzung vorübergehend gesperrt. Die Wallet-Adresse ist nicht fehlerhaft; bitte später erneut synchronisieren oder eine eigene API-Basisadresse verwenden.", 502);
    }
    if (response.status === 402) {
      throw makeError("Die Blockchain-Datenquelle verlangt für diese Abfrage eine Zahlung. CryptoBuch löst niemals automatische Zahlungen aus; bitte eine andere Read-only-API-Basisadresse verwenden.", 502);
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

function fetchJson(url, additionalHeaders = {}) {
  return fetchJsonRequest(url, { additionalHeaders });
}

function postJson(url, payload, additionalHeaders = {}) {
  return fetchJsonRequest(url, {
    method: "POST",
    body: JSON.stringify(payload),
    additionalHeaders: { "Content-Type": "application/json", ...additionalHeaders },
  });
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

function historicalPriceFetchError(error) {
  const status = Number(error?.status);
  const message = String(error?.message || "");
  if (status === 429 || /rate.?limit|begrenzt/i.test(message)) return "Rate-Limit oder temporäre Begrenzung der Preisquelle.";
  if (status === 401 || status === 403 || /zugriff abgelehnt/i.test(message)) return "Zugang zur Preisquelle wurde abgelehnt.";
  if (status >= 500 || /nicht verfügbar/i.test(message)) return "Preisquelle momentan nicht verfügbar.";
  return "Für diese Preisquelle waren keine verwertbaren historischen Daten verfügbar.";
}

function recordHistoricalPriceFetch({ runId, source, asset, dates, status, returnedPrices = 0, error = null, startedAt = null }) {
  if (!runId) return;
  const requestedDates = Array.isArray(dates) ? dates.filter(Boolean).sort() : [];
  db.prepare(`
    INSERT INTO historical_price_fetch_events (
      run_id, source, asset, date_from, date_to, status, returned_prices, error_message, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))
  `).run(
    runId,
    cleanLabel(source, 40) || "unbekannt",
    cleanLabel(asset, 80) || "unbekannt",
    requestedDates[0] || null,
    requestedDates.at(-1) || null,
    status,
    Math.max(0, Number(returnedPrices) || 0),
    error ? historicalPriceFetchError(error) : null,
    startedAt,
  );
}

function startHistoricalPriceRun({ trigger, force = false, pendingCount = null }) {
  const result = db.prepare(`
    INSERT INTO historical_price_runs (trigger, force_run, pending_count)
    VALUES (?, ?, ?)
  `).run(cleanLabel(trigger, 40) || "automatisch", force ? 1 : 0, Number.isFinite(pendingCount) ? pendingCount : null);
  return Number(result.lastInsertRowid);
}

function finishHistoricalPriceRun(runId, result) {
  if (!runId) return;
  const summary = {
    candidates: Number(result?.candidates || 0),
    attempted: Number(result?.attempted || 0),
    updated: Number(result?.updated || 0),
    unresolved: Number(result?.unresolved || 0),
    remaining: Number(result?.remaining || 0),
    hint: result?.hint || null,
  };
  db.prepare(`
    UPDATE historical_price_runs
    SET status = 'success', attempted_count = ?, updated_count = ?, unresolved_count = ?, result_json = ?, finished_at = datetime('now')
    WHERE id = ?
  `).run(summary.attempted, summary.updated, summary.unresolved, JSON.stringify(summary), runId);
}

function failHistoricalPriceRun(runId, error) {
  if (!runId) return;
  db.prepare(`
    UPDATE historical_price_runs
    SET status = 'error', error_message = ?, finished_at = datetime('now')
    WHERE id = ?
  `).run(historicalPriceFetchError(error), runId);
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

async function getExchangeAssetCurrentPrices(assetIds) {
  const requested = [...new Set(assetIds.filter((asset) => EXCHANGE_ASSET_CONFIG[asset]))];
  if (requested.length === 0) return {};
  if (exchangeAssetPriceCache.expiresAt > Date.now() && requested.every((asset) => asset in exchangeAssetPriceCache.data)) {
    return Object.fromEntries(requested.map((asset) => [asset, exchangeAssetPriceCache.data[asset]]));
  }
  const cached = { ...exchangeAssetPriceCache.data };
  try {
    const settings = runtimeSettings();
    const ids = requested.map((asset) => EXCHANGE_ASSET_CONFIG[asset].coinGeckoId).join(",");
    const payload = await fetchJson(
      `${settings.coinGeckoBaseUrl}/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=eur`,
      coinGeckoHeaders(settings.coinGeckoBaseUrl, settings.coinGeckoApiKey),
    );
    for (const asset of requested) cached[asset] = positiveNumber(payload[EXCHANGE_ASSET_CONFIG[asset].coinGeckoId]?.eur);
  } catch (_) {
    for (const asset of requested) cached[asset] = null;
  }
  exchangeAssetPriceCache = { data: cached, expiresAt: Date.now() + 5 * 60 * 1000 };
  return Object.fromEntries(requested.map((asset) => [asset, cached[asset] || null]));
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

function historicalPriceRecord(coinId, date) {
  return db.prepare(`
    SELECT price_eur, source, updated_at
    FROM price_history
    WHERE coin_id = ? AND price_date = ?
  `).get(coinId, date) || null;
}

function cachedHistoricalPrice(coinId, date) {
  const row = historicalPriceRecord(coinId, date);
  return row ? Number(row.price_eur) : null;
}

function saveHistoricalPrice(coinId, date, price, source = "coingecko") {
  if (!Number.isFinite(price) || price <= 0) return;
  db.prepare(`
    INSERT INTO price_history (coin_id, price_date, price_eur, source, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(coin_id, price_date) DO UPDATE SET price_eur = excluded.price_eur, source = excluded.source, updated_at = excluded.updated_at
  `).run(coinId, date, price, source);
}

function historicalDateRanges(dates, maximumDays) {
  const ranges = [];
  const maxRangeMs = maximumDays * 86400000;
  let range = [];
  let rangeStart = 0;
  for (const date of [...new Set(dates)].sort()) {
    const at = new Date(`${date}T00:00:00.000Z`).getTime();
    if (range.length && at - rangeStart > maxRangeMs) {
      ranges.push(range);
      range = [];
    }
    if (range.length === 0) rangeStart = at;
    range.push(date);
  }
  if (range.length) ranges.push(range);
  return ranges;
}

function mergeHistoricalPrices(result, prices, dates, coinId, source) {
  for (const date of dates) {
    const value = positiveNumber(prices.get(date));
    if (!value) continue;
    saveHistoricalPrice(coinId, date, value, source);
    result.set(date, value);
  }
}

async function hydrateBitvavoHistoricalPrices(asset, dates, settings, priceFetchRunId = null) {
  const result = new Map();
  if (!asset || dates.length === 0) return result;

  // Bitvavo accepts up to 1,000 candles. 330-day chunks leave enough room for
  // the inclusive bounds and keep old imports reliable.
  for (const requestedDates of historicalDateRanges(dates, 330)) {
    const start = new Date(`${requestedDates[0]}T00:00:00.000Z`).getTime();
    const end = new Date(`${requestedDates.at(-1)}T23:59:59.999Z`).getTime();
    const url = new URL(`${settings.bitvavoApiBaseUrl}/${encodeURIComponent(asset)}-EUR/candles`);
    url.search = new URLSearchParams({
      interval: "1d",
      limit: "1000",
      start: String(start),
      end: String(end),
    }).toString();
    const startedAt = new Date().toISOString();
    try {
      const prices = bitvavoDailyClosePrices(await fetchHistoricalJson(url.toString()));
      recordHistoricalPriceFetch({ runId: priceFetchRunId, source: "bitvavo", asset, dates: requestedDates, status: "success", returnedPrices: prices.size, startedAt });
      for (const date of requestedDates) {
        const value = positiveNumber(prices.get(date));
        if (!value) continue;
        result.set(date, value);
      }
    } catch (error) {
      recordHistoricalPriceFetch({ runId: priceFetchRunId, source: "bitvavo", asset, dates: requestedDates, status: "error", error, startedAt });
      // Not every asset has a Bitvavo EUR market.
    }
  }
  return result;
}

async function hydrateCoinbaseHistoricalPrices(asset, dates, settings, priceFetchRunId = null) {
  const result = new Map();
  if (!asset || dates.length === 0) return result;
  // Coinbase limits a request to 300 candles, so keep ranges below that cap.
  for (const requestedDates of historicalDateRanges(dates, 295)) {
    const start = `${requestedDates[0]}T00:00:00Z`;
    const end = `${requestedDates.at(-1)}T23:59:59Z`;
    const url = new URL(`${settings.coinbaseExchangeApiBaseUrl}/products/${encodeURIComponent(`${asset}-EUR`)}/candles`);
    url.search = new URLSearchParams({ granularity: "86400", start, end }).toString();
    const startedAt = new Date().toISOString();
    try {
      const prices = coinbaseDailyClosePrices(await fetchHistoricalJson(url.toString()));
      recordHistoricalPriceFetch({ runId: priceFetchRunId, source: "coinbase", asset, dates: requestedDates, status: "success", returnedPrices: prices.size, startedAt });
      for (const date of requestedDates) {
        const value = positiveNumber(prices.get(date));
        if (value) result.set(date, value);
      }
    } catch (error) {
      recordHistoricalPriceFetch({ runId: priceFetchRunId, source: "coinbase", asset, dates: requestedDates, status: "error", error, startedAt });
      // A product may not exist on Coinbase or may not have traded on a day.
    }
  }
  return result;
}

async function hydrateCryptoCompareHistoricalPrices(asset, dates, settings, priceFetchRunId = null) {
  const result = new Map();
  if (!asset || !settings.cryptoCompareApiKey || dates.length === 0) return result;
  // CryptoCompare's historic endpoint returns a bounded daily window. Keep
  // requests below its documented 2,000-day maximum.
  for (const requestedDates of historicalDateRanges(dates, 1900)) {
    const end = Math.floor(new Date(`${requestedDates.at(-1)}T23:59:59.999Z`).getTime() / 1000);
    const url = new URL(`${settings.cryptoCompareApiBaseUrl}/histoday`);
    url.search = new URLSearchParams({ fsym: asset, tsym: "EUR", limit: "1900", toTs: String(end), api_key: settings.cryptoCompareApiKey }).toString();
    const startedAt = new Date().toISOString();
    try {
      const prices = cryptoCompareDailyClosePrices(await fetchHistoricalJson(url.toString()));
      recordHistoricalPriceFetch({ runId: priceFetchRunId, source: "cryptocompare", asset, dates: requestedDates, status: "success", returnedPrices: prices.size, startedAt });
      for (const date of requestedDates) {
        const value = positiveNumber(prices.get(date));
        if (value) result.set(date, value);
      }
    } catch (error) {
      recordHistoricalPriceFetch({ runId: priceFetchRunId, source: "cryptocompare", asset, dates: requestedDates, status: "error", error, startedAt });
      // A configured key can still be rate-limited; later providers remain
      // isolated and the retry job applies exponential backoff.
    }
  }
  return result;
}

async function hydrateKrakenHistoricalPrices(asset, dates, settings, priceFetchRunId = null) {
  const result = new Map();
  const oldestRecentDay = Date.now() - 720 * 86400000;
  const recentDates = dates.filter((date) => new Date(`${date}T00:00:00.000Z`).getTime() >= oldestRecentDay);
  if (!asset || recentDates.length === 0) return result;
  const url = new URL(`${settings.krakenApiBaseUrl}/OHLC`);
  url.search = new URLSearchParams({ pair: `${asset}EUR`, interval: "1440", assetVersion: "1" }).toString();
  const startedAt = new Date().toISOString();
  try {
    const prices = krakenDailyClosePrices(await fetchHistoricalJson(url.toString()));
    recordHistoricalPriceFetch({ runId: priceFetchRunId, source: "kraken", asset, dates: recentDates, status: "success", returnedPrices: prices.size, startedAt });
    for (const date of recentDates) {
      const value = positiveNumber(prices.get(date));
      if (value) result.set(date, value);
    }
  } catch (error) {
    recordHistoricalPriceFetch({ runId: priceFetchRunId, source: "kraken", asset, dates: recentDates, status: "error", error, startedAt });
    // Kraken intentionally retains only its latest 720 OHLC entries.
  }
  return result;
}

async function hydrateHistoricalPrices(chain, timestamps, settings, coinIdOverride = null, assetOverride = null, priceFetchRunId = null) {
  const coinId = coinIdOverride || CHAIN_CONFIG[chain]?.coinGeckoId;
  const dates = [...new Set(timestamps.filter(Boolean).map(isoDay))].sort();
  const asset = assetOverride || CHAIN_CONFIG[chain]?.asset;
  if (!coinId || dates.length === 0) return new Map();

  const result = new Map();
  const missing = [];
  for (const date of dates) {
    const cached = cachedHistoricalPrice(coinId, date);
    if (cached) result.set(date, cached);
    else missing.push(date);
  }
  if (missing.length === 0) return result;

  // The public chart endpoint can omit dates from large spans. Query compact,
  // date-driven windows so old portfolio records are backfilled.
  for (const requestedDates of historicalDateRanges(missing, 330)) {
    const from = Math.floor(new Date(`${requestedDates[0]}T00:00:00.000Z`).getTime() / 1000) - 86400;
    const to = Math.floor(new Date(`${requestedDates.at(-1)}T23:59:59.999Z`).getTime() / 1000) + 86400;
    const startedAt = new Date().toISOString();
    try {
      const payload = await fetchHistoricalJson(
        `${settings.coinGeckoBaseUrl}/coins/${coinId}/market_chart/range?vs_currency=eur&from=${from}&to=${to}`,
        coinGeckoHeaders(settings.coinGeckoBaseUrl, settings.coinGeckoApiKey),
      );
      const samples = Array.isArray(payload.prices) ? payload.prices : [];
      let returnedPrices = 0;
      for (const date of requestedDates) {
        const value = closestPriceForDate(samples, date);
        // Daily samples are accepted only if they are close enough to the requested day.
        if (value) {
          saveHistoricalPrice(coinId, date, value, "coingecko");
          result.set(date, value);
          returnedPrices += 1;
        }
      }
      recordHistoricalPriceFetch({ runId: priceFetchRunId, source: "coingecko", asset: asset || coinId, dates: requestedDates, status: "success", returnedPrices, startedAt });
    } catch (error) {
      recordHistoricalPriceFetch({ runId: priceFetchRunId, source: "coingecko", asset: asset || coinId, dates: requestedDates, status: "error", error, startedAt });
      // Historic price is optional metadata. The transaction itself remains usable.
    }
  }

  // Stop at the first independent source that has a valid daily EUR close.
  // All historic requests are serialized by fetchHistoricalJson, so a limit at
  // one provider never creates a parallel burst at the remaining providers.
  const unresolvedDates = () => missing.filter((date) => !result.has(date));
  const fallbacks = [
    ["bitvavo", () => hydrateBitvavoHistoricalPrices(asset, unresolvedDates(), settings, priceFetchRunId)],
    ["coinbase", () => hydrateCoinbaseHistoricalPrices(asset, unresolvedDates(), settings, priceFetchRunId)],
    ["kraken", () => hydrateKrakenHistoricalPrices(asset, unresolvedDates(), settings, priceFetchRunId)],
    ["cryptocompare", () => hydrateCryptoCompareHistoricalPrices(asset, unresolvedDates(), settings, priceFetchRunId)],
  ];
  for (const [source, load] of fallbacks) {
    const unresolved = unresolvedDates();
    if (!unresolved.length) break;
    mergeHistoricalPrices(result, await load(), unresolved, coinId, source);
  }
  return result;
}

async function hydrateHistoricalTokenPrices(contract, timestamps, settings, priceFetchRunId = null) {
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
    const startedAt = new Date().toISOString();
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
      recordHistoricalPriceFetch({ runId: priceFetchRunId, source: "coingecko", asset: `ERC-20 ${normalizedContract}`, dates: [date], status: "success", returnedPrices: value ? 1 : 0, startedAt });
    } catch (error) {
      recordHistoricalPriceFetch({ runId: priceFetchRunId, source: "coingecko", asset: `ERC-20 ${normalizedContract}`, dates: [date], status: "error", error, startedAt });
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

function inChunks(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function bitcoinCashAddress(address) {
  return `bitcoincash:${String(address || "").trim().replace(/^bitcoincash:/i, "").toLowerCase()}`;
}

async function fetchBitcoinCashTransactionDetails(hashes, settings) {
  const rows = [];
  for (const hashesChunk of inChunks(hashes, 20)) {
    const payload = await postJson(`${settings.bitcoinCashApiBaseUrl}/fulcrum/tx/data`, { txids: hashesChunk, verbose: true });
    if (payload.success !== true || !Array.isArray(payload.transactions)) {
      throw makeError("Der Bitcoin-Cash-Indexer lieferte keine vollständigen Transaktionsdetails.", 502);
    }
    rows.push(...payload.transactions);
  }
  return rows;
}

async function fetchBitcoinCashTransactions(address, settings) {
  const historyUrl = new URL(`${settings.bitcoinCashApiBaseUrl}/fulcrum/transactions/${encodeURIComponent(bitcoinCashAddress(address))}`);
  historyUrl.searchParams.set("allTxs", "true");
  const history = await fetchJson(historyUrl.toString());
  if (history.success !== true || !Array.isArray(history.transactions)) {
    throw makeError("Der Bitcoin-Cash-Indexer lieferte keine gültige Transaktionshistorie.", 502);
  }

  const hashes = [...new Set(history.transactions.map((item) => item?.tx_hash).filter((hash) => /^[a-f0-9]{64}$/i.test(hash)))];
  const limited = settings.maxTransactionsPerSync ? hashes.slice(0, settings.maxTransactionsPerSync) : hashes;
  if (!limited.length) return [];

  const transactions = await fetchBitcoinCashTransactionDetails(limited, settings);
  const detailsByHash = new Map(transactions.map((entry) => [entry?.details?.txid || entry?.txid, entry]).filter(([hash]) => Boolean(hash)));
  const referencedHashes = [...new Set(transactions.flatMap((entry) => (entry?.details?.vin || []).map((input) => input?.txid).filter((hash) => /^[a-f0-9]{64}$/i.test(hash))))]
    .filter((hash) => !detailsByHash.has(hash));
  const referencedTransactions = await fetchBitcoinCashTransactionDetails(referencedHashes, settings);
  for (const entry of referencedTransactions) {
    const hash = entry?.details?.txid || entry?.txid;
    if (hash) detailsByHash.set(hash, entry);
  }
  return transactions.map((entry) => toBitcoinCashUtxoPayload(entry, detailsByHash));
}

async function fetchEthereumTransactions(address, settings) {
  const [native, erc20, nfts] = await Promise.all([
    fetchEtherscanRecords(address, "txlist", settings),
    fetchEtherscanRecords(address, "tokentx", settings),
    fetchEtherscanRecords(address, "tokennfttx", settings).catch(() => []),
  ]);
  const enrichedErc20 = await enrichErc20Metadata(erc20, settings);
  const rows = [
    ...native.map((transaction) => ({ type: "native", transaction })),
    ...enrichedErc20.map((transaction) => ({ type: "erc20", transaction })),
    ...nfts.map((transaction) => ({ type: "nft", transaction })),
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
    historicalPriceProvider: "tzkt",
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
      if (item.type === "erc20") return normalizeErc20Transfer(item.transaction, address);
      if (item.type === "nft") return normalizeNftTransfer(item.transaction, address);
      return normalizeEthereumTransaction(item.transaction, address);
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
      return { rawTransactions: await fetchBitcoinCashTransactions(wallet.address, settings), context: wallet.address, xpubCapped: false };
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

const LOCAL_DATA_RESET_CONFIRMATION = "ALLE DATEN LÖSCHEN";
let localDataResetting = false;
let jobWorkerScheduled = false;
function scheduleJobWorker() {
  if (jobWorkerScheduled) return;
  jobWorkerScheduled = true;
  setImmediate(async () => {
    jobWorkerScheduled = false;
    if (localDataResetting) return;
    const job = db.prepare("SELECT * FROM background_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1").get();
    if (!job) return;
    db.prepare("UPDATE background_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?").run(job.id);
    let payload = {};
    try {
      payload = JSON.parse(job.payload_json);
      let result;
      if (job.type === "wallet_sync") {
        const wallet = getWallet(payload.walletId);
        result = await syncWallet(wallet);
        recordSyncEvent(wallet.id, "success", result.imported);
        createNotification("success", "Wallet synchronisiert", `${wallet.label || wallet.address}: ${result.imported.toLocaleString("de-DE")} Transaktionen verarbeitet.`);
      } else if (job.type === "price_backfill") {
        result = await runHistoricalPriceBackfill({ force: Boolean(payload.force), trigger: "manuell" });
        if (result.remaining > 0) createNotification("warning", "Historische Kurse offen", `${result.remaining.toLocaleString("de-DE")} historische Kurse werden weiter automatisch geprüft.`);
        else createNotification("success", "Historische Kurse ergänzt", `${result.updated.toLocaleString("de-DE")} Kurse wurden ergänzt.`);
      } else if (job.type === "exchange_sync") {
        const connection = getExchangeConnection(payload.connectionId);
        result = await syncExchangeConnection(connection);
        createNotification("success", "Börse synchronisiert", `${connection.label || connection.provider}: ${result.imported.toLocaleString("de-DE")} Buchungen importiert.`);
        if (result.warnings?.length) createNotification("warning", "Börsen-Sync prüfen", result.warnings[0]);
        const historyJob = queueBinanceHistoryIfNeeded(connection);
        if (historyJob) {
          result.historyJobId = historyJob.id;
          result.historyInProgress = true;
          createNotification("info", "Binance-Historie wird nachgeladen", `${connection.label || "Binance"}: Einzahlungen, Auszahlungen, Erträge und Spot-Trades werden automatisch in gedrosselten Schritten ergänzt.`);
        }
        // The exchange request itself remains read-only and quick. Missing
        // execution prices are completed afterwards by the existing serial,
        // throttled price queue instead of making the account sync fan out.
        if (result.imported && !historyJob) {
          // A transfer reconciliation is deliberately separate from the API
          // import. It only creates reviewable suggestions and never changes
          // purposes, prices or FIFO lots by itself.
          enqueueJob("exchange_transfer_check", { connectionId: connection.id });
          enqueueJob("price_backfill", { force: false });
        }
      } else if (job.type === "exchange_history_sync") {
        const connection = getExchangeConnection(payload.connectionId);
        result = await syncBinanceHistoryBatch(connection);
        if (result.settled) {
          if (result.complete) {
            createNotification("success", "Binance-Historie vollständig", `${connection.label || "Binance"}: Die automatisch abrufbare Kontohistorie wurde vollständig verarbeitet.`);
          } else {
            createNotification("warning", "Binance-Historie unvollständig", `${connection.label || "Binance"}: Mindestens ein historischer Markt ist nur über einen Binance-CSV-Export ergänzbar.`);
          }
          if (result.warnings?.length) createNotification("warning", "Binance-Historie prüfen", result.warnings[0]);
          // Run dependent work only once after the complete history exists;
          // queuing it after every page would delay the serial importer.
          enqueueJob("exchange_transfer_check", { connectionId: connection.id });
          enqueueJob("price_backfill", { force: false });
        } else {
          const nextJob = queueBinanceHistoryIfNeeded(getExchangeConnection(connection.id), { ignoreJobId: job.id });
          result.nextJobId = nextJob?.id || null;
        }
      } else if (job.type === "exchange_transfer_check") {
        const connection = db.prepare("SELECT id, provider, label FROM exchange_connections WHERE id = ?").get(asPositiveId(payload.connectionId));
        const suggestions = exchangeTransferSuggestions(400);
        result = { connectionId: Number(payload.connectionId) || null, candidates: suggestions.length };
        const sourceName = connection?.label || connection?.provider || "Börsenbestand";
        if (suggestions.length) {
          createNotification("info", "Börsen-Transfers prüfen", `${sourceName}: ${suggestions.length.toLocaleString("de-DE")} mögliche Ein- oder Auszahlungen wurden unter Datenqualität vorgeschlagen.`);
        } else {
          createNotification("success", "Börsen-Transfers geprüft", `${sourceName}: Keine passenden lokalen Gegenbewegungen gefunden.`);
        }
      } else {
        throw makeError("Unbekannter Hintergrundjob.");
      }
      if (localDataResetting) return;
      db.prepare("UPDATE background_jobs SET status = 'success', progress_current = ?, progress_total = ?, result_json = ?, finished_at = datetime('now') WHERE id = ?")
        .run(result.progress?.current || 1, result.progress?.total || 1, JSON.stringify(result), job.id);
    } catch (error) {
      if (localDataResetting) return;
      db.prepare("UPDATE background_jobs SET status = 'error', error_message = ?, finished_at = datetime('now') WHERE id = ?")
        .run(String(error.message || error).slice(0, 500), job.id);
      if (job.type === "exchange_history_sync") {
        const connectionId = asPositiveId(payload?.connectionId);
        if (connectionId) db.prepare("UPDATE exchange_connections SET history_last_error = ? WHERE id = ?")
          .run(String(error.message || error).slice(0, 500), connectionId);
      }
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

function resumeBinanceHistoryImports() {
  const connections = db.prepare("SELECT * FROM exchange_connections WHERE provider = 'binance' AND import_mode = 'api'").all();
  for (const connection of connections) queueBinanceHistoryIfNeeded(connection);
}

function resumeMissingBinanceBalanceSnapshots() {
  const connections = db.prepare("SELECT * FROM exchange_connections WHERE provider = 'binance' AND import_mode = 'api'").all();
  for (const connection of connections) {
    if (exchangeBalanceSnapshot(connection.id)) continue;
    const active = db.prepare("SELECT id FROM background_jobs WHERE type = 'exchange_sync' AND status IN ('queued', 'running') AND payload_json LIKE ? LIMIT 1")
      .get(`%\"connectionId\":${connection.id}%`);
    if (!active) enqueueJob("exchange_sync", { connectionId: connection.id });
  }
}

const BSDEX_RECONCILE_INTERVAL_MS = boundedInteger(process.env.BSDEX_RECONCILE_INTERVAL_MINUTES, 15, 5, 1440) * 60 * 1000;
const bsdexLiveConnections = new Map();

function hasActiveExchangeSync(connectionId) {
  return Boolean(db.prepare("SELECT id FROM background_jobs WHERE type = 'exchange_sync' AND status IN ('queued', 'running') AND payload_json LIKE ? LIMIT 1")
    .get(`%\"connectionId\":${Number(connectionId)}%`));
}

function queueBsdexReconciliation(connectionId) {
  if (!connectionId || hasActiveExchangeSync(connectionId)) return null;
  return enqueueJob("exchange_sync", { connectionId });
}

function setBsdexLiveStatus(connectionId, status, error = "") {
  db.prepare(`UPDATE exchange_connections
    SET live_status = ?,
      live_connected_at = CASE WHEN ? = 'connected' THEN datetime('now') ELSE live_connected_at END,
      live_last_error = CASE WHEN ? THEN ? ELSE NULL END
    WHERE id = ?`).run(status, status, error ? 1 : 0, error ? String(error).slice(0, 500) : null, connectionId);
}

function stopBsdexLiveUpdates(connectionId, { persist = true } = {}) {
  const state = bsdexLiveConnections.get(Number(connectionId));
  if (state) {
    state.stopped = true;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.client?.close();
    bsdexLiveConnections.delete(Number(connectionId));
  }
  if (persist) db.prepare("UPDATE exchange_connections SET live_status = 'disabled', live_last_error = NULL WHERE id = ?").run(connectionId);
}

function handleBsdexLiveTrade(connectionId, rawTrade, market) {
  const connection = getExchangeConnection(connectionId);
  if (connection.provider !== "bsdex" || !connection.live_updates_enabled) return;
  const row = normalizeBsdexTrade(rawTrade, market);
  if (!row) return;
  importExternalRows(getWallet(connection.wallet_id), [row], { source: "bsdex-api", purposeOrigin: "auto" });
  db.prepare("UPDATE exchange_connections SET live_last_event_at = datetime('now') WHERE id = ?").run(connectionId);
}

function handleBsdexLiveBalance(connectionId, rawBalance) {
  const connection = getExchangeConnection(connectionId);
  if (connection.provider !== "bsdex" || !connection.live_updates_enabled) return;
  const asset = String(rawBalance?.asset_id || "").trim().toUpperCase();
  if (!asset || asset === "EUR") return;
  const free = Number(rawBalance?.available || 0);
  const locked = Number(rawBalance?.locked || 0);
  if (!Number.isFinite(free) || !Number.isFinite(locked)) return;
  updateExchangeBalanceSnapshotAsset(connectionId, { asset, free, locked });
  db.prepare("UPDATE exchange_connections SET live_last_event_at = datetime('now') WHERE id = ?").run(connectionId);
}

function scheduleBsdexReconnect(connectionId, state, error = "") {
  if (state.stopped || bsdexLiveConnections.get(Number(connectionId)) !== state) return;
  if (state.reconnectTimer) return;
  state.attempts += 1;
  const delay = Math.min(60000, 1000 * (2 ** Math.min(state.attempts, 6)));
  setBsdexLiveStatus(connectionId, "reconnecting", error);
  state.reconnectTimer = setTimeout(() => {
    if (state.stopped || bsdexLiveConnections.get(Number(connectionId)) !== state) return;
    bsdexLiveConnections.delete(Number(connectionId));
    let connection;
    try { connection = getExchangeConnection(connectionId); } catch { return; }
    startBsdexLiveUpdates(connection, { reconcileAfterConnect: true }).catch((startError) => {
      const next = bsdexLiveConnections.get(Number(connectionId));
      if (next) scheduleBsdexReconnect(connectionId, next, startError.message);
    });
  }, delay);
  state.reconnectTimer.unref?.();
}

async function startBsdexLiveUpdates(connection, { subscription = null, reconcileAfterConnect = false } = {}) {
  if (connection?.provider !== "bsdex" || !connection.live_updates_enabled || connection.import_mode !== "api") return null;
  const existing = bsdexLiveConnections.get(Number(connection.id));
  if (existing) return existing;
  const state = { stopped: false, attempts: 0, client: null, reconnectTimer: null, reconcileAfterConnect };
  bsdexLiveConnections.set(Number(connection.id), state);
  setBsdexLiveStatus(connection.id, "connecting");
  try {
    const settings = runtimeSettings();
    const details = subscription || await fetchBsdexSubscriptionInfo({
      apiBaseUrl: settings.bsdexApiBaseUrl, apiKey: connection.api_key, apiSecret: connection.api_secret,
    });
    state.client = createBsdexLiveClient({
      apiBaseUrl: settings.bsdexApiBaseUrl,
      apiKey: connection.api_key,
      apiSecret: connection.api_secret,
      markets: details.markets,
      // Subscribe to all currently available EUR-market base assets, not only
      // assets held at connection time. A first purchase of a new asset can
      // therefore update its balance without waiting for the REST fallback.
      assets: [...details.balances.map((entry) => entry.asset), ...details.markets.map((market) => String(market).split("-")[0])],
      onTrade: (trade, market) => {
        try { handleBsdexLiveTrade(connection.id, trade, market); }
        catch (error) { setBsdexLiveStatus(connection.id, "error", error.message); }
      },
      onBalance: (balance) => {
        try { handleBsdexLiveBalance(connection.id, balance); }
        catch (error) { setBsdexLiveStatus(connection.id, "error", error.message); }
      },
      onStatus: ({ status, error }) => {
        if (state.stopped || bsdexLiveConnections.get(Number(connection.id)) !== state) return;
        if (status === "connected") {
          state.attempts = 0;
          setBsdexLiveStatus(connection.id, "connected");
          if (state.reconcileAfterConnect) queueBsdexReconciliation(connection.id);
        } else if (status === "error") {
          setBsdexLiveStatus(connection.id, "error", error);
          scheduleBsdexReconnect(connection.id, state, error);
          state.client?.close();
        } else if (status === "closed") {
          scheduleBsdexReconnect(connection.id, state, error);
        }
      },
    });
  } catch (error) {
    setBsdexLiveStatus(connection.id, "error", error.message);
    scheduleBsdexReconnect(connection.id, state, error.message);
    // A WebSocket outage does not invalidate the completed read-only REST
    // reconciliation. Reconnect runs separately and never blocks accounting.
    return state;
  }
  return state;
}

function resumeBsdexLiveUpdates() {
  const connections = db.prepare("SELECT * FROM exchange_connections WHERE provider = 'bsdex' AND import_mode = 'api' AND live_updates_enabled = 1").all();
  // A serial REST sync creates a fresh balance snapshot before WebSocket data
  // is accepted. It also determines current subscription targets on restart.
  for (const connection of connections) {
    setBsdexLiveStatus(connection.id, "connecting");
    queueBsdexReconciliation(connection.id);
  }
}

function queueDueBsdexReconciliations() {
  const dueBefore = new Date(Date.now() - BSDEX_RECONCILE_INTERVAL_MS).toISOString().replace("T", " ").slice(0, 19);
  const connections = db.prepare(`SELECT id FROM exchange_connections
    WHERE provider = 'bsdex' AND import_mode = 'api' AND live_updates_enabled = 1
      AND (live_last_reconciled_at IS NULL OR live_last_reconciled_at < ?)`).all(dueBefore);
  for (const connection of connections) queueBsdexReconciliation(connection.id);
}

const bsdexReconciliationTimer = setInterval(queueDueBsdexReconciliations, 60000);
bsdexReconciliationTimer.unref?.();

// Existing Binance connections receive the same background import as newly
// created ones. A missing snapshot runs first so an old, incomplete journal
// cannot be shown as a live negative position while the serial history import
// continues in the background.
resumeMissingBinanceBalanceSnapshots();
resumeBinanceHistoryImports();
resumeBsdexLiveUpdates();

async function syncWallet(wallet) {
  if (wallet.source_type === "exchange") {
    throw makeError("Börsenkonten werden ausschließlich über ihre Read-only-Börsenverbindung synchronisiert.");
  }
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
    assetType: transaction.assetType || (transaction.assetContract ? "erc20" : "native"),
    feeAsset: transaction.feeAsset || transaction.asset,
    priceKind: transaction.priceKind || "native",
  }));
  const nativePriceTimestamps = transactions
    .filter((transaction) => transaction.priceKind === "native" && !positiveNumber(transaction.historicalPrice))
    .map((transaction) => transaction.timestamp)
    .filter(Boolean);
  const tokenDates = new Map();
  for (const transaction of transactions) {
    if (transaction.priceKind !== "erc20" || !transaction.assetContract || !transaction.timestamp || positiveNumber(transaction.historicalPrice)) continue;
    if (!tokenDates.has(transaction.assetContract)) tokenDates.set(transaction.assetContract, []);
    tokenDates.get(transaction.assetContract).push(transaction.timestamp);
  }
  let pricesByDate = new Map();
  const tokenPricesByContract = new Map();
  const requestedPriceCount = nativePriceTimestamps.length + [...tokenDates.values()].reduce((sum, timestamps) => sum + timestamps.length, 0);
  if (requestedPriceCount) {
    const priceRunId = startHistoricalPriceRun({ trigger: "wallet_sync", pendingCount: null });
    try {
      pricesByDate = await hydrateHistoricalPrices(wallet.chain, nativePriceTimestamps, settings, null, null, priceRunId);
      for (const [contract, timestamps] of tokenDates) {
        tokenPricesByContract.set(contract, await hydrateHistoricalTokenPrices(contract, timestamps, settings, priceRunId));
      }
      const resolvedPriceCount = nativePriceTimestamps.filter((timestamp) => positiveNumber(pricesByDate.get(isoDay(timestamp)))).length
        + [...tokenDates.entries()].reduce((sum, [contract, timestamps]) => sum + timestamps.filter((timestamp) => positiveNumber(tokenPricesByContract.get(contract)?.get(isoDay(timestamp)))).length, 0);
      finishHistoricalPriceRun(priceRunId, {
        candidates: requestedPriceCount,
        attempted: requestedPriceCount,
        updated: resolvedPriceCount,
        unresolved: Math.max(0, requestedPriceCount - resolvedPriceCount),
        remaining: pendingHistoricalPriceCount(),
      });
    } catch (error) {
      failHistoricalPriceRun(priceRunId, error);
      throw error;
    }
  }

  const existingTransaction = db.prepare(
    "SELECT price_transaction_eur, price_source, price_provider, price_recorded_at, updated_at, purpose, purpose_origin FROM transactions WHERE wallet_id = ? AND external_id = ?",
  );
  const upsert = db.prepare(`
    INSERT INTO transactions (
      wallet_id, external_id, hash, timestamp, direction, asset, asset_symbol, asset_name, asset_decimals, asset_contract,
      asset_type,
      amount, fee, fee_asset, counterparty,
      price_transaction_eur, price_source, price_provider, price_recorded_at,
      purpose, purpose_origin, raw_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(wallet_id, external_id) DO UPDATE SET
      hash = excluded.hash,
      timestamp = excluded.timestamp,
      direction = excluded.direction,
      asset = excluded.asset,
      asset_symbol = excluded.asset_symbol,
      asset_name = excluded.asset_name,
      asset_decimals = excluded.asset_decimals,
      asset_contract = excluded.asset_contract,
      asset_type = excluded.asset_type,
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
      price_provider = CASE
        WHEN transactions.price_source = 'manual' THEN transactions.price_provider
        WHEN excluded.price_transaction_eur IS NOT NULL THEN excluded.price_provider
        ELSE transactions.price_provider
      END,
      price_recorded_at = CASE
        WHEN transactions.price_source = 'manual' THEN transactions.price_recorded_at
        WHEN excluded.price_transaction_eur IS NOT NULL THEN excluded.price_recorded_at
        ELSE transactions.price_recorded_at
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
      const directHistoricPrice = positiveNumber(transaction.historicalPrice);
      const existingHistoricPrice = positiveNumber(existing?.price_transaction_eur);
      const mappedHistoricPrice = transaction.timestamp && transaction.priceKind === "erc20"
        ? positiveNumber(tokenPricesByContract.get(transaction.assetContract)?.get(isoDay(transaction.timestamp)))
        : transaction.timestamp && transaction.priceKind === "native" ? positiveNumber(pricesByDate.get(isoDay(transaction.timestamp)) ) : null;
      const historicPrice = directHistoricPrice ?? existingHistoricPrice ?? mappedHistoricPrice;
      let priceProvider = null;
      let priceRecordedAt = null;
      if (directHistoricPrice) {
        priceProvider = transaction.historicalPriceProvider || "adapter";
        priceRecordedAt = new Date().toISOString();
      } else if (existingHistoricPrice) {
        priceProvider = existing.price_provider || "legacy";
        priceRecordedAt = existing.price_recorded_at || existing.updated_at || null;
      } else if (mappedHistoricPrice) {
        const record = historicalPriceRecord(historicalPriceCoinId({ ...transaction, chain: wallet.chain }), isoDay(transaction.timestamp));
        priceProvider = record?.source || "legacy";
        priceRecordedAt = record?.updated_at || null;
      }
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
        transaction.assetType,
        transaction.amount,
        transaction.fee,
        transaction.feeAsset,
        transaction.counterparty,
        historicPrice,
        "auto",
        priceProvider,
        priceRecordedAt,
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
      AND asset_type <> 'nft'
      AND price_source <> 'manual'
      AND (price_transaction_eur IS NULL OR price_transaction_eur <= 0)
  `).get().count || 0);
}

function chainForNativeAsset(asset, fallbackChain = null) {
  const symbol = String(asset || "").toUpperCase();
  const mapped = Object.entries(CHAIN_CONFIG).find(([, config]) => config.asset === symbol)?.[0];
  if (mapped) return mapped;
  return CHAIN_CONFIG[fallbackChain]?.asset === symbol ? fallbackChain : null;
}

function historicalPriceCoinId(transaction) {
  const contract = String(transaction.assetContract || transaction.asset_contract || "").toLowerCase();
  if (contract) return `erc20:ethereum:${contract}`;
  const chain = chainForNativeAsset(transaction.asset, transaction.chain);
  if (chain && CHAIN_CONFIG[chain]?.coinGeckoId) return CHAIN_CONFIG[chain].coinGeckoId;
  return EXCHANGE_ASSET_CONFIG[transaction.asset]?.coinGeckoId || null;
}

async function backfillHistoricalPrices({ force = false, priceFetchRunId = null } = {}) {
  const settings = runtimeSettings();
  const totalPending = pendingHistoricalPriceCount();
  const retryFilter = force ? "1 = 1" : "(retry.next_attempt_at IS NULL OR retry.next_attempt_at <= ?)";
  const candidates = db.prepare(`
    SELECT t.id, t.timestamp, t.asset, t.asset_contract, t.asset_type, w.chain, retry.attempt_count AS retry_attempt_count
    FROM transactions t
    JOIN wallets w ON w.id = t.wallet_id
    LEFT JOIN historical_price_retries retry ON retry.transaction_id = t.id
    WHERE t.timestamp IS NOT NULL
      AND t.asset_type <> 'nft'
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
  const exchangeAssetDates = new Map();
  for (const transaction of candidates) {
    if (transaction.asset_contract) {
      const contract = String(transaction.asset_contract).toLowerCase();
      if (!tokenDates.has(contract)) tokenDates.set(contract, []);
      tokenDates.get(contract).push(transaction.timestamp);
    } else {
      const chain = chainForNativeAsset(transaction.asset, transaction.chain);
      if (chain) {
        if (!nativeDates.has(chain)) nativeDates.set(chain, []);
        nativeDates.get(chain).push(transaction.timestamp);
      } else if (EXCHANGE_ASSET_CONFIG[transaction.asset]) {
        if (!exchangeAssetDates.has(transaction.asset)) exchangeAssetDates.set(transaction.asset, []);
        exchangeAssetDates.get(transaction.asset).push(transaction.timestamp);
      }
    }
  }

  const nativePrices = new Map();
  for (const [chain, timestamps] of nativeDates) nativePrices.set(chain, await hydrateHistoricalPrices(chain, timestamps, settings, null, null, priceFetchRunId));
  const tokenPrices = new Map();
  for (const [contract, timestamps] of tokenDates) tokenPrices.set(contract, await hydrateHistoricalTokenPrices(contract, timestamps, settings, priceFetchRunId));
  const exchangeAssetPrices = new Map();
  for (const [asset, timestamps] of exchangeAssetDates) {
    exchangeAssetPrices.set(asset, await hydrateHistoricalPrices(null, timestamps, settings, EXCHANGE_ASSET_CONFIG[asset].coinGeckoId, asset, priceFetchRunId));
  }

  const update = db.prepare(`
    UPDATE transactions
    SET price_transaction_eur = ?, price_provider = ?, price_recorded_at = ?, updated_at = datetime('now')
    WHERE id = ? AND price_source <> 'manual' AND (price_transaction_eur IS NULL OR price_transaction_eur <= 0)
  `);
  const recordAutomaticPriceAudit = db.prepare(`
    INSERT INTO transaction_price_audit (transaction_id, price_eur, source, note)
    VALUES (?, ?, 'auto', ?)
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
      const mappedChain = chainForNativeAsset(transaction.asset, transaction.chain);
      const exchangeAsset = EXCHANGE_ASSET_CONFIG[transaction.asset];
      const price = transaction.asset_contract
        ? positiveNumber(tokenPrices.get(String(transaction.asset_contract).toLowerCase())?.get(date))
        : mappedChain ? positiveNumber(nativePrices.get(mappedChain)?.get(date))
          : exchangeAsset ? positiveNumber(exchangeAssetPrices.get(transaction.asset)?.get(date)) : null;
      if (price) {
        const record = historicalPriceRecord(historicalPriceCoinId(transaction), date);
        const provider = record?.source || "legacy";
        const recordedAt = record?.updated_at || null;
        const result = update.run(price, provider, recordedAt, transaction.id);
        updated += result.changes;
        if (result.changes) recordAutomaticPriceAudit.run(transaction.id, price, `Automatisch ergänzt · ${provider}`);
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
      ? "Für ältere native Coins wurden die verfügbaren EUR-Tageskursquellen seriell versucht. Für nicht verfügbare Märkte und ERC-20-Token kann unter Einstellungen ein CoinGecko-Pro- oder CryptoCompare-API-Key helfen."
      : unresolved ? "Einige Kurse waren bei der Preisquelle nicht verfügbar und bleiben als k. A. markiert." : null,
  };
}

let historicalPriceBackfillInFlight = null;
let nextAutomaticHistoricalPriceBackfillAt = 0;
const historicalPriceInitialCheckAt = Date.now() + 15000;

function runHistoricalPriceBackfill({ force = false, trigger = "automatisch" } = {}) {
  if (historicalPriceBackfillInFlight) return historicalPriceBackfillInFlight;
  const priceRunId = startHistoricalPriceRun({ trigger, force, pendingCount: pendingHistoricalPriceCount() });
  historicalPriceBackfillInFlight = backfillHistoricalPrices({ force, priceFetchRunId: priceRunId })
    .then((result) => {
      finishHistoricalPriceRun(priceRunId, result);
      return result;
    })
    .catch((error) => {
      failHistoricalPriceRun(priceRunId, error);
      throw error;
    })
    .finally(() => { historicalPriceBackfillInFlight = null; });
  return historicalPriceBackfillInFlight;
}

function scheduleHistoricalPriceBackfill() {
  const settings = runtimeSettings();
  if (Date.now() < nextAutomaticHistoricalPriceBackfillAt || historicalPriceBackfillInFlight) return;
  nextAutomaticHistoricalPriceBackfillAt = Date.now() + settings.historicalPriceRetryIntervalMinutes * 60000;
  runHistoricalPriceBackfill({ force: false, trigger: "automatisch" }).catch((error) => {
    console.error("Automatische Preisergänzung fehlgeschlagen:", error.message);
  });
}

const BACKGROUND_JOB_LABELS = Object.freeze({
  wallet_sync: "Wallet synchronisieren",
  price_backfill: "Historische Kurse ergänzen",
  exchange_sync: "Börse synchronisieren",
  exchange_history_sync: "Börsenhistorie nachladen",
  exchange_transfer_check: "Börsen-Transfers abgleichen",
});

function sqliteDate(value) {
  if (!value) return null;
  const text = String(value);
  const date = new Date(text.includes("T") ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeAutomationMessage(value) {
  const message = String(value || "")
    .replace(/https?:\/\/\S+/gi, "[URL verborgen]")
    .replace(/\b(api[ _-]?key|secret|authorization)\s*[:=]\s*\S+/gi, "$1: [verborgen]")
    .trim();
  return message ? message.slice(0, 220) : null;
}

function automationStatusResponse() {
  const settings = runtimeSettings();
  const now = new Date();
  const latestPriceRun = db.prepare(`
    SELECT id, status, started_at, finished_at, error_message, updated_count, unresolved_count
    FROM historical_price_runs
    WHERE trigger = 'automatisch'
    ORDER BY id DESC
    LIMIT 1
  `).get();
  const priceNextAt = historicalPriceBackfillInFlight ? null : new Date(Math.max(
    now.getTime(),
    nextAutomaticHistoricalPriceBackfillAt || historicalPriceInitialCheckAt,
  )).toISOString();
  const activeBsdexJobs = new Map(db.prepare(`
    SELECT status, payload_json
    FROM background_jobs
    WHERE type = 'exchange_sync' AND status IN ('queued', 'running')
  `).all().flatMap((job) => {
    const connectionId = Number(safeJson(job.payload_json, {})?.connectionId);
    return Number.isInteger(connectionId) && connectionId > 0 ? [[connectionId, job.status]] : [];
  }));
  const bsdexConnections = db.prepare(`
    SELECT id, label, live_status, live_last_reconciled_at, live_last_error
    FROM exchange_connections
    WHERE provider = 'bsdex' AND import_mode = 'api' AND live_updates_enabled = 1
    ORDER BY id ASC
  `).all().map((connection) => {
    const lastRun = sqliteDate(connection.live_last_reconciled_at);
    const nextRun = lastRun
      ? new Date(lastRun.getTime() + BSDEX_RECONCILE_INTERVAL_MS)
      : now;
    const jobStatus = activeBsdexJobs.get(connection.id) || null;
    return {
      id: connection.id,
      label: connection.label || "BSDEX",
      status: jobStatus || connection.live_status || "waiting",
      lastRunAt: lastRun?.toISOString() || null,
      nextRunAt: nextRun.toISOString(),
      lastError: safeAutomationMessage(connection.live_last_error),
    };
  });
  const queueRows = db.prepare(`
    SELECT id, type, status, progress_current, progress_total, error_message, created_at, started_at, finished_at
    FROM background_jobs
    ORDER BY id DESC
    LIMIT 25
  `).all();
  const queueCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
    FROM background_jobs
  `).get();
  const latestPriceRunView = latestPriceRun ? {
    id: latestPriceRun.id,
    status: latestPriceRun.status,
    startedAt: latestPriceRun.started_at,
    finishedAt: latestPriceRun.finished_at,
    updatedCount: Number(latestPriceRun.updated_count || 0),
    unresolvedCount: Number(latestPriceRun.unresolved_count || 0),
    errorMessage: safeAutomationMessage(latestPriceRun.error_message),
  } : null;
  const bsdexNextAt = bsdexConnections.length
    ? bsdexConnections.map((connection) => connection.nextRunAt).sort()[0]
    : null;
  return {
    generatedAt: now.toISOString(),
    schedules: [
      {
        id: "historical-price-backfill",
        label: "Historische Kurse ergänzen",
        description: "Prüft fehlende historische EUR-Kurse über die lokale, serielle Preis-Pipeline.",
        status: historicalPriceBackfillInFlight ? "running" : "waiting",
        intervalMinutes: settings.historicalPriceRetryIntervalMinutes,
        nextRunAt: priceNextAt,
        lastRun: latestPriceRunView,
      },
      {
        id: "bsdex-reconciliation",
        label: "BSDEX-REST-Abgleich",
        description: "Holt bei aktivierten Live-Updates Salden, Trades und Krypto-Transfers nach.",
        status: !bsdexConnections.length ? "inactive" : bsdexConnections.some((connection) => connection.status === "running") ? "running" : bsdexConnections.some((connection) => connection.status === "queued") ? "queued" : bsdexConnections.some((connection) => connection.status === "error") ? "attention" : "waiting",
        intervalMinutes: Math.round(BSDEX_RECONCILE_INTERVAL_MS / 60000),
        nextRunAt: bsdexNextAt,
        connections: bsdexConnections,
      },
    ],
    queue: {
      queued: Number(queueCounts.queued || 0),
      running: Number(queueCounts.running || 0),
      recent: queueRows.map((job) => ({
        id: job.id,
        label: BACKGROUND_JOB_LABELS[job.type] || job.type,
        status: job.status,
        progressCurrent: Number(job.progress_current || 0),
        progressTotal: Number(job.progress_total || 0),
        errorMessage: safeAutomationMessage(job.error_message),
        createdAt: job.created_at,
        startedAt: job.started_at,
        finishedAt: job.finished_at,
      })),
    },
  };
}

function safeJson(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function historicalPricePipelineResponse(page = 1) {
  const settings = runtimeSettings();
  const now = new Date();
  const nowIso = now.toISOString();
  const scheduledAt = Math.max(
    now.getTime(),
    nextAutomaticHistoricalPriceBackfillAt || historicalPriceInitialCheckAt,
  );
  const scheduledAtIso = new Date(scheduledAt).toISOString();
  const retryCondition = `t.timestamp IS NOT NULL
    AND t.asset_type <> 'nft'
    AND t.price_source <> 'manual'
    AND (t.price_transaction_eur IS NULL OR t.price_transaction_eur <= 0)`;
  const pending = pendingHistoricalPriceCount();
  const due = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM transactions t
    LEFT JOIN historical_price_retries retry ON retry.transaction_id = t.id
    WHERE ${retryCondition}
      AND (retry.next_attempt_at IS NULL OR retry.next_attempt_at <= ?)
  `).get(nowIso).count || 0);
  const upcoming = db.prepare(`
    SELECT t.id, t.timestamp, t.asset, COALESCE(NULLIF(t.asset_symbol, ''), t.asset) AS asset_symbol,
      COALESCE(NULLIF(w.label, ''), CASE WHEN w.source_type = 'exchange' THEN 'Börsenkonto' ELSE w.chain END) AS source_label,
      w.source_type, retry.attempt_count, retry.last_attempt_at, retry.next_attempt_at
    FROM transactions t
    JOIN wallets w ON w.id = t.wallet_id
    LEFT JOIN historical_price_retries retry ON retry.transaction_id = t.id
    WHERE ${retryCondition}
    ORDER BY
      CASE WHEN retry.next_attempt_at IS NULL OR retry.next_attempt_at <= ? THEN 0 ELSE 1 END,
      COALESCE(retry.next_attempt_at, ?) ASC,
      t.timestamp ASC
    LIMIT 120
  `).all(nowIso, scheduledAtIso).map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    asset: row.asset,
    assetSymbol: row.asset_symbol,
    sourceLabel: row.source_label,
    sourceType: row.source_type,
    attempts: Number(row.attempt_count || 0),
    lastAttemptAt: row.last_attempt_at || null,
    nextAttemptAt: row.next_attempt_at || scheduledAtIso,
    due: !row.next_attempt_at || row.next_attempt_at <= nowIso,
  }));

  const pageSize = 20;
  const currentPage = Math.max(1, Math.min(1000, Number.parseInt(page, 10) || 1));
  const totalRuns = Number(db.prepare("SELECT COUNT(*) AS count FROM historical_price_runs").get().count || 0);
  const rows = db.prepare(`
    SELECT * FROM historical_price_runs
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, (currentPage - 1) * pageSize);
  const ids = rows.map((row) => row.id);
  const eventsByRun = new Map(ids.map((id) => [id, []]));
  if (ids.length) {
    const events = db.prepare(`
      SELECT id, run_id, source, asset, date_from, date_to, status, returned_prices, error_message, started_at, finished_at
      FROM historical_price_fetch_events
      WHERE run_id IN (${ids.map(() => "?").join(",")})
      ORDER BY id ASC
    `).all(...ids);
    for (const event of events) eventsByRun.get(event.run_id)?.push({
      id: event.id,
      source: event.source,
      asset: event.asset,
      dateFrom: event.date_from,
      dateTo: event.date_to,
      status: event.status,
      returnedPrices: Number(event.returned_prices || 0),
      errorMessage: event.error_message || null,
      startedAt: event.started_at,
      finishedAt: event.finished_at,
    });
  }
  const runs = rows.map((row) => ({
    id: row.id,
    trigger: row.trigger,
    force: Boolean(row.force_run),
    status: row.status,
    pendingCount: row.pending_count === null ? null : Number(row.pending_count),
    attemptedCount: Number(row.attempted_count || 0),
    updatedCount: Number(row.updated_count || 0),
    unresolvedCount: Number(row.unresolved_count || 0),
    result: safeJson(row.result_json, null),
    errorMessage: row.error_message || null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    events: eventsByRun.get(row.id) || [],
  }));
  const jobs = db.prepare(`
    SELECT id, status, created_at, started_at
    FROM background_jobs
    WHERE type = 'price_backfill' AND status IN ('queued', 'running')
    ORDER BY id ASC
    LIMIT 12
  `).all().map((job) => ({ id: job.id, status: job.status, createdAt: job.created_at, startedAt: job.started_at }));

  return {
    pipeline: {
      status: historicalPriceBackfillInFlight ? "running" : jobs.length ? "queued" : "waiting",
      pending,
      ready: due,
      due: Math.min(due, settings.historicalPriceBackfillBatchSize),
      scheduled: Math.max(0, pending - Math.min(due, settings.historicalPriceBackfillBatchSize)),
      nextAutomaticAt: historicalPriceBackfillInFlight ? null : scheduledAtIso,
      retryIntervalMinutes: settings.historicalPriceRetryIntervalMinutes,
      batchSize: settings.historicalPriceBackfillBatchSize,
      jobs,
      sources: [
        { id: "coingecko", label: "CoinGecko", active: true },
        { id: "bitvavo", label: "Bitvavo", active: true },
        { id: "coinbase", label: "Coinbase Exchange", active: true },
        { id: "kraken", label: "Kraken", active: true },
        { id: "cryptocompare", label: "CryptoCompare", active: Boolean(settings.cryptoCompareApiKey) },
      ],
    },
    upcoming,
    runs,
    pagination: {
      page: currentPage,
      pageSize,
      total: totalRuns,
      totalPages: Math.max(1, Math.ceil(totalRuns / pageSize)),
    },
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
  const nativeChain = chainForNativeAsset(transaction.asset, transaction.chain);
  const native = CHAIN_CONFIG[nativeChain];
  if (transaction.asset_type === "nft") return {
    id: transaction.asset,
    chain: transaction.chain,
    name: transaction.asset_name || "NFT",
    symbol: transaction.asset_symbol || "NFT",
    decimals: 0,
    icon: "▣",
    kind: "nft",
    contractAddress: transaction.asset_contract || null,
  };
  if (!transaction.asset_contract) {
    const knownNative = nativeAssetDescriptors()[transaction.asset];
    if (knownNative) return knownNative;
    const exchangeAsset = EXCHANGE_ASSET_CONFIG[transaction.asset];
    if (exchangeAsset) return {
      id: transaction.asset,
      chain: "EXCHANGE",
      name: exchangeAsset.name,
      symbol: exchangeAsset.symbol,
      decimals: exchangeAsset.decimals,
      icon: exchangeAsset.icon,
      kind: "exchange",
    };
    return {
      id: transaction.asset,
      chain: nativeChain,
      name: transaction.asset_name || transaction.asset,
      symbol: transaction.asset_symbol || transaction.asset,
      decimals: Number.isInteger(transaction.asset_decimals) ? transaction.asset_decimals : native?.decimals || 6,
      icon: native?.icon || "◇",
      kind: native ? "native" : "unknown",
    };
  }
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

function assetDescriptorFromExchangeBalance(assetId) {
  const normalizedAsset = String(assetId || "").trim().toUpperCase();
  const native = nativeAssetDescriptors()[normalizedAsset];
  if (native) return native;
  const exchangeAsset = EXCHANGE_ASSET_CONFIG[normalizedAsset];
  if (exchangeAsset) return {
    id: normalizedAsset,
    chain: "EXCHANGE",
    name: exchangeAsset.name,
    symbol: exchangeAsset.symbol,
    decimals: exchangeAsset.decimals,
    icon: exchangeAsset.icon,
    kind: "exchange",
  };
  return {
    id: normalizedAsset,
    chain: "EXCHANGE",
    name: normalizedAsset,
    symbol: normalizedAsset,
    decimals: 8,
    icon: "◇",
    kind: "exchange",
  };
}

const HOLDING_EPSILON = 0.000000000001;

function transactionBalanceDelta(transaction) {
  const amount = Number(transaction?.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return transaction.direction === "in" ? amount : transaction.direction === "out" ? -amount : 0;
}

function addHolding(holdings, assetId, amount) {
  if (!assetId || !Number.isFinite(amount) || Math.abs(amount) <= HOLDING_EPSILON) return;
  holdings.set(assetId, Number(holdings.get(assetId) || 0) + amount);
}

function exchangeBalanceSnapshot(connectionId) {
  if (!connectionId) return null;
  const meta = db.prepare("SELECT observed_at FROM exchange_balance_snapshot_meta WHERE connection_id = ?").get(connectionId);
  if (!meta) return null;
  const balances = new Map(db.prepare(`
    SELECT asset, free_amount, locked_amount
    FROM exchange_balance_snapshots WHERE connection_id = ?
  `).all(connectionId).map((row) => [row.asset, Number(row.free_amount || 0) + Number(row.locked_amount || 0)]));
  return { observedAt: meta.observed_at, balances };
}

function replaceExchangeBalanceSnapshot(connectionId, balances) {
  if (!Array.isArray(balances)) return false;
  const insert = db.prepare(`
    INSERT INTO exchange_balance_snapshots (connection_id, asset, free_amount, locked_amount)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(connection_id, asset) DO UPDATE SET
      free_amount = excluded.free_amount, locked_amount = excluded.locked_amount
  `);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM exchange_balance_snapshots WHERE connection_id = ?").run(connectionId);
    for (const entry of balances) {
      const asset = cleanLabel(entry?.asset, 48).toUpperCase();
      const free = Number(entry?.free || 0);
      const locked = Number(entry?.locked || 0);
      if (!asset || !Number.isFinite(free) || !Number.isFinite(locked) || free + locked <= HOLDING_EPSILON) continue;
      insert.run(connectionId, asset, free, locked);
    }
    db.prepare(`INSERT INTO exchange_balance_snapshot_meta (connection_id, observed_at)
      VALUES (?, datetime('now'))
      ON CONFLICT(connection_id) DO UPDATE SET observed_at = excluded.observed_at`).run(connectionId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return true;
}

function updateExchangeBalanceSnapshotAsset(connectionId, balance) {
  const asset = cleanLabel(balance?.asset, 48).toUpperCase();
  const free = Number(balance?.free || 0);
  const locked = Number(balance?.locked || 0);
  if (!connectionId || !asset || !Number.isFinite(free) || !Number.isFinite(locked)) return false;
  db.exec("BEGIN");
  try {
    if (free + locked <= HOLDING_EPSILON) {
      db.prepare("DELETE FROM exchange_balance_snapshots WHERE connection_id = ? AND asset = ?").run(connectionId, asset);
    } else {
      db.prepare(`INSERT INTO exchange_balance_snapshots (connection_id, asset, free_amount, locked_amount)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(connection_id, asset) DO UPDATE SET
          free_amount = excluded.free_amount, locked_amount = excluded.locked_amount`).run(connectionId, asset, free, locked);
    }
    db.prepare(`INSERT INTO exchange_balance_snapshot_meta (connection_id, observed_at)
      VALUES (?, datetime('now'))
      ON CONFLICT(connection_id) DO UPDATE SET observed_at = excluded.observed_at`).run(connectionId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return true;
}

function exchangeSnapshotSource(provider) {
  return provider === "binance" ? "binance_spot_snapshot" : `${provider}_snapshot`;
}

function exchangePosition(wallet, connection, journalHoldings) {
  const snapshot = ["binance", "bsdex"].includes(connection?.provider) ? exchangeBalanceSnapshot(connection.id) : null;
  const assets = new Set([...journalHoldings.keys(), ...(snapshot?.balances.keys() || [])]);
  const positions = new Map();
  const reconciliations = [];
  for (const assetId of assets) {
    const journalAmount = Number(journalHoldings.get(assetId) || 0);
    // An authenticated exchange snapshot is an account fact. Without one,
    // the journal can only contribute non-negative amounts; a missing input
    // is a data-quality issue, never a negative crypto holding.
    const balanceAmount = snapshot ? Number(snapshot.balances.get(assetId) || 0) : Math.max(0, journalAmount);
    if (balanceAmount > HOLDING_EPSILON) positions.set(assetId, balanceAmount);
    const difference = balanceAmount - journalAmount;
    if (Math.abs(difference) > HOLDING_EPSILON) {
      reconciliations.push({
        connectionId: connection?.id || null,
        walletId: wallet.id,
        provider: connection?.provider || null,
        label: connection?.label || wallet.label || "Börsenkonto",
        asset: assetId,
        journalAmount,
        balanceAmount,
        difference,
        source: snapshot ? exchangeSnapshotSource(connection?.provider) : "journal_clamped",
        observedAt: snapshot?.observedAt || null,
      });
    }
  }
  return { positions, reconciliations, snapshot };
}

async function portfolioResponse() {
  const wallets = db.prepare(`SELECT w.*, COALESCE(m.group_name, '') AS group_name, COALESCE(m.tags, '[]') AS tags
    FROM wallets w LEFT JOIN wallet_metadata m ON m.wallet_id = w.id
    WHERE w.source_type <> 'exchange' ORDER BY w.created_at DESC`).all()
    .map((wallet) => ({ ...wallet, tags: (() => { try { return JSON.parse(wallet.tags); } catch { return []; } })() }));
  const transactions = db.prepare(`
    SELECT t.*, w.chain, w.address, w.source_type, w.label AS wallet_label
    FROM transactions t
    JOIN wallets w ON w.id = t.wallet_id
    ORDER BY CASE WHEN t.timestamp IS NULL THEN 0 ELSE 1 END, t.timestamp DESC, t.id DESC
  `).all();
  const holdings = Object.fromEntries(Object.values(CHAIN_CONFIG).map((chain) => [chain.asset, 0]));
  const assets = nativeAssetDescriptors();
  const exchangeJournalByWallet = new Map();
  for (const transaction of transactions) {
    assets[transaction.asset] = assets[transaction.asset] || assetDescriptorFromTransaction(transaction);
    const delta = transactionBalanceDelta(transaction);
    if (transaction.source_type === "exchange") {
      if (!exchangeJournalByWallet.has(transaction.wallet_id)) exchangeJournalByWallet.set(transaction.wallet_id, new Map());
      addHolding(exchangeJournalByWallet.get(transaction.wallet_id), transaction.asset, delta);
    } else {
      holdings[transaction.asset] = Number(holdings[transaction.asset] || 0) + delta;
    }
  }
  const exchangeWallets = db.prepare(`
    SELECT w.id, w.label, c.id AS connection_id, c.provider, c.label AS connection_label
    FROM wallets w
    LEFT JOIN exchange_connections c ON c.wallet_id = w.id
    WHERE w.source_type = 'exchange'
  `).all();
  const balanceReconciliations = [];
  for (const wallet of exchangeWallets) {
    const journal = exchangeJournalByWallet.get(wallet.id) || new Map();
    const connection = wallet.connection_id ? { id: wallet.connection_id, provider: wallet.provider, label: wallet.connection_label } : null;
    const position = exchangePosition(wallet, connection, journal);
    for (const [assetId, amount] of position.positions) {
      assets[assetId] = assets[assetId] || assetDescriptorFromExchangeBalance(assetId);
      holdings[assetId] = Number(holdings[assetId] || 0) + amount;
    }
    balanceReconciliations.push(...position.reconciliations);
  }
  const currentPrices = await getCurrentPrices();
  const tokenPrices = await getErc20CurrentPrices(
    Object.values(assets)
      .filter((asset) => asset.kind === "erc20" && Number(holdings[asset.id] || 0) !== 0)
      .map((asset) => asset.contractAddress),
    runtimeSettings(),
  );
  const exchangeAssetPrices = await getExchangeAssetCurrentPrices(
    Object.values(assets).filter((asset) => asset.kind === "exchange" && Number(holdings[asset.id] || 0) !== 0).map((asset) => asset.id),
  );
  const pricesByAsset = Object.fromEntries(Object.entries(assets).map(([assetId, asset]) => [
    assetId,
    asset.kind === "erc20" ? tokenPrices[asset.contractAddress] || null
      : asset.kind === "exchange" ? exchangeAssetPrices[assetId] || null
        : asset.kind === "nft" || asset.kind === "unknown" ? null : currentPrices[asset.chain] || null,
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
  const valueHistory = buildBookValueHistory(enriched);
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
    balanceReconciliations,
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
    response.json(await runHistoricalPriceBackfill({ force: true, trigger: "manuell" }));
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

function resetLocalData() {
  // Backups deliberately remain untouched: a reset must be reversible by a
  // conscious restore, even though the active local database starts empty.
  // Close local live sockets first so no previously authorized feed can write
  // to an account after its connection has been removed.
  for (const connectionId of bsdexLiveConnections.keys()) stopBsdexLiveUpdates(connectionId, { persist: false });
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM wallets) AS wallets,
      (SELECT COUNT(*) FROM transactions) AS transactions,
      (SELECT COUNT(*) FROM transaction_documents) AS documents
  `).get();

  db.exec(`
    BEGIN IMMEDIATE;
    DELETE FROM background_jobs;
    DELETE FROM notifications;
    DELETE FROM tax_report_snapshots;
    DELETE FROM app_settings;
    DELETE FROM historical_price_fetch_events;
    DELETE FROM historical_price_runs;
    DELETE FROM price_history;
    DELETE FROM transaction_documents;
    DELETE FROM transfer_links;
    DELETE FROM historical_price_retries;
    DELETE FROM transaction_price_audit;
    DELETE FROM sync_events;
    DELETE FROM wallet_addresses;
    DELETE FROM wallet_metadata;
    DELETE FROM exchange_balance_snapshots;
    DELETE FROM exchange_balance_snapshot_meta;
    DELETE FROM exchange_connections;
    DELETE FROM transactions;
    DELETE FROM wallets;
    COMMIT;
  `);

  fs.rmSync(DOCUMENT_DIR, { recursive: true, force: true });
  fs.mkdirSync(DOCUMENT_DIR, { recursive: true });
  if (fs.existsSync(TRADE_REPUBLIC_SESSION_KEY_PATH)) fs.unlinkSync(TRADE_REPUBLIC_SESSION_KEY_PATH);
  return {
    wallets: Number(counts.wallets || 0),
    transactions: Number(counts.transactions || 0),
    documents: Number(counts.documents || 0),
  };
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

app.post("/api/data/reset", (request, response, next) => {
  try {
    if (String(request.body?.confirmation || "").trim() !== LOCAL_DATA_RESET_CONFIRMATION) {
      throw makeError(`Zur Bestätigung bitte genau „${LOCAL_DATA_RESET_CONFIRMATION}“ eingeben.`);
    }
    localDataResetting = true;
    const deleted = resetLocalData();
    response.json({ reset: true, deleted, backupsPreserved: true, restarting: true });
    // Stop any in-flight importer as soon as the response has left the local
    // server. Docker then starts a clean process with the empty database.
    setTimeout(() => process.exit(0), 500).unref();
  } catch (error) {
    localDataResetting = false;
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
      WHERE w.source_type <> 'exchange'
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

app.get("/api/system-status/automations", (_request, response, next) => {
  try {
    // This is intentionally an observability endpoint only. It returns local
    // timer state and safe job metadata, never job payloads, API keys, or
    // provider request URLs.
    response.json(automationStatusResponse());
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
  `).all(limit).map((transaction) => ({
    ...transaction,
    chain: chainForNativeAsset(transaction.asset, transaction.chain) || (EXCHANGE_ASSET_CONFIG[transaction.asset] ? "EXCHANGE" : transaction.chain),
  }));
}

function exchangeProviderFromRaw(rawJson) {
  try {
    const source = JSON.parse(String(rawJson || "{}"))?.source;
    if (source === "binance-api") return "Binance";
    if (source === "bitvavo-api") return "Bitvavo";
    if (source === "bsdex-api") return "BSDEX";
  } catch {
    // Old or malformed raw payloads must simply not be presented as an
    // exchange proposal; normal transaction data remains untouched.
  }
  return null;
}

function exchangeTransferSuggestions(limit = 80) {
  const desired = boundedInteger(limit, 80, 1, 400);
  // The SQL prefilter narrows the comparison to matching asset, direction,
  // amount and time window. The matcher below then applies the fee-aware
  // exact comparison and assigns the human-readable direction.
  const rows = db.prepare(`
    SELECT
      exchange_row.id AS exchange_id, exchange_row.direction AS exchange_direction, exchange_row.asset AS exchange_asset,
      exchange_row.amount AS exchange_amount, exchange_row.fee AS exchange_fee, exchange_row.fee_asset AS exchange_fee_asset,
      exchange_row.timestamp AS exchange_timestamp, exchange_row.raw_json AS exchange_raw_json,
      local_row.id AS local_id, local_row.direction AS local_direction, local_row.asset AS local_asset,
      local_row.amount AS local_amount, local_row.timestamp AS local_timestamp,
      exchange_wallet.label AS exchange_wallet, local_wallet.label AS local_wallet
    FROM transactions exchange_row
    JOIN transactions local_row ON local_row.asset = exchange_row.asset
      AND ((exchange_row.direction = 'out' AND local_row.direction = 'in') OR (exchange_row.direction = 'in' AND local_row.direction = 'out'))
      AND ABS(strftime('%s', local_row.timestamp) - strftime('%s', exchange_row.timestamp)) <= 259200
      AND (
        ABS(local_row.amount - exchange_row.amount) <= MAX(0.00000001, ABS(exchange_row.amount) * 0.01)
        OR (
          exchange_row.fee_asset = exchange_row.asset AND exchange_row.fee > 0 AND exchange_row.fee < exchange_row.amount
          AND ABS(local_row.amount - (exchange_row.amount - exchange_row.fee)) <= MAX(0.00000001, ABS(exchange_row.amount - exchange_row.fee) * 0.01)
        )
      )
    JOIN wallets exchange_wallet ON exchange_wallet.id = exchange_row.wallet_id
    JOIN wallets local_wallet ON local_wallet.id = local_row.wallet_id
    LEFT JOIN transfer_links linked_out ON linked_out.outgoing_transaction_id = CASE WHEN exchange_row.direction = 'out' THEN exchange_row.id ELSE local_row.id END
    LEFT JOIN transfer_links linked_in ON linked_in.incoming_transaction_id = CASE WHEN exchange_row.direction = 'in' THEN exchange_row.id ELSE local_row.id END
    WHERE exchange_row.purpose = 'Transfer'
      AND (exchange_row.raw_json LIKE '%"source":"binance-api"%' OR exchange_row.raw_json LIKE '%"source":"bitvavo-api"%' OR exchange_row.raw_json LIKE '%"source":"bsdex-api"%')
      AND COALESCE(local_row.raw_json, '') NOT LIKE '%"source":"binance-api"%'
      AND COALESCE(local_row.raw_json, '') NOT LIKE '%"source":"bitvavo-api"%'
      AND COALESCE(local_row.raw_json, '') NOT LIKE '%"source":"bsdex-api"%'
      AND linked_out.id IS NULL AND linked_in.id IS NULL
    ORDER BY exchange_row.timestamp DESC
    LIMIT ?
  `).all(Math.min(desired * 4, 1600));
  const suggestions = [];
  const seen = new Set();
  for (const row of rows) {
    const provider = exchangeProviderFromRaw(row.exchange_raw_json);
    if (!provider) continue;
    const exchangeTransaction = {
      id: row.exchange_id, direction: row.exchange_direction, asset: row.exchange_asset, amount: row.exchange_amount,
      fee: row.exchange_fee, feeAsset: row.exchange_fee_asset, timestamp: row.exchange_timestamp,
    };
    const localTransaction = {
      id: row.local_id, direction: row.local_direction, asset: row.local_asset, amount: row.local_amount, timestamp: row.local_timestamp,
    };
    const match = matchExchangeTransfer(exchangeTransaction, localTransaction);
    if (!match) continue;
    const key = `${match.outgoing.id}:${match.incoming.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const exchangeIsOutgoing = match.outgoing.id === row.exchange_id;
    suggestions.push({
      outgoing_id: match.outgoing.id,
      incoming_id: match.incoming.id,
      asset: match.asset,
      amount: match.amount,
      outgoing_at: match.outgoing.timestamp,
      incoming_at: match.incoming.timestamp,
      outgoing_wallet: exchangeIsOutgoing ? `${provider} · Börse` : (row.local_wallet || "Lokale Wallet"),
      incoming_wallet: exchangeIsOutgoing ? (row.local_wallet || "Lokale Wallet") : `${provider} · Börse`,
      origin: "exchange",
      fee_adjusted: match.feeAdjusted,
    });
    if (suggestions.length >= desired) break;
  }
  return suggestions;
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
    const walletTransferSuggestions = db.prepare(`
      SELECT a.id AS outgoing_id, b.id AS incoming_id, a.asset, a.amount, a.timestamp AS outgoing_at, b.timestamp AS incoming_at,
        aw.label AS outgoing_wallet, bw.label AS incoming_wallet
      FROM transactions a
      JOIN transactions b ON b.asset = a.asset AND b.direction = 'in' AND a.direction = 'out'
        AND ABS(b.amount - a.amount) <= MAX(0.00000001, ABS(a.amount) * 0.002)
        AND ABS(strftime('%s', b.timestamp) - strftime('%s', a.timestamp)) <= 172800
      JOIN wallets aw ON aw.id = a.wallet_id JOIN wallets bw ON bw.id = b.wallet_id
      LEFT JOIN transfer_links linked_out ON linked_out.outgoing_transaction_id = a.id
      LEFT JOIN transfer_links linked_in ON linked_in.incoming_transaction_id = b.id
      WHERE a.wallet_id <> b.wallet_id AND (a.purpose IS NULL OR a.purpose <> 'Transfer') AND (b.purpose IS NULL OR b.purpose <> 'Transfer')
        AND linked_out.id IS NULL AND linked_in.id IS NULL
      ORDER BY a.timestamp DESC LIMIT 80
    `).all();
    const possibleTransfers = [...exchangeTransferSuggestions(80), ...walletTransferSuggestions]
      .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.outgoing_id === entry.outgoing_id && candidate.incoming_id === entry.incoming_id) === index)
      .slice(0, 80);
    const possibleDuplicates = db.prepare(`
      SELECT hash, asset, amount, COUNT(*) AS occurrences, GROUP_CONCAT(id) AS transaction_ids
      FROM transactions WHERE hash <> '' GROUP BY hash, asset, amount HAVING COUNT(*) > 1 ORDER BY occurrences DESC LIMIT 80
    `).all();
    response.json({ counts, missingHistoricPrices, unassignedPurposes, possibleTransfers, possibleDuplicates });
  } catch (error) {
    next(error);
  }
});

app.get("/api/data-quality/price-fetches", (request, response, next) => {
  try {
    response.json(historicalPricePipelineResponse(request.query?.page));
  } catch (error) {
    next(error);
  }
});

app.post("/api/transfers/link", (request, response, next) => {
  try {
    const outgoingId = asPositiveId(request.body?.outgoingTransactionId);
    const incomingId = asPositiveId(request.body?.incomingTransactionId);
    if (!outgoingId || !incomingId || outgoingId === incomingId) throw makeError("Bitte zwei unterschiedliche Transaktionen auswählen.");
    const outgoing = db.prepare("SELECT id, direction, asset FROM transactions WHERE id = ?").get(outgoingId);
    const incoming = db.prepare("SELECT id, direction, asset FROM transactions WHERE id = ?").get(incomingId);
    if (!outgoing || !incoming) throw makeError("Eine Transfer-Transaktion wurde nicht gefunden.", 404);
    if (outgoing.direction !== "out" || incoming.direction !== "in" || outgoing.asset !== incoming.asset) throw makeError("Ein Transfer benötigt einen Ausgang und Eingang desselben Assets.");
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO transfer_links (outgoing_transaction_id, incoming_transaction_id, match_origin, note) VALUES (?, ?, 'suggested', ?)").run(outgoingId, incomingId, cleanLabel(request.body?.note, 240) || null);
      db.prepare("UPDATE transactions SET purpose = 'Transfer', purpose_origin = 'manual', updated_at = datetime('now') WHERE id IN (?, ?)").run(outgoingId, incomingId);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    response.status(201).json({ outgoingTransactionId: outgoingId, incomingTransactionId: incomingId, purpose: "Transfer" });
  } catch (error) { next(error); }
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
  const transactions = db.prepare(`
    SELECT t.*, w.label AS source_label, w.source_type
    FROM transactions t JOIN wallets w ON w.id = t.wallet_id
    WHERE t.timestamp IS NOT NULL
    ORDER BY t.timestamp ASC
  `).all();
  const report = calculateTaxReport(transactions, year, runtimeSettings());
  const availableYears = db.prepare(`
    SELECT DISTINCT substr(timestamp, 1, 4) AS year
    FROM transactions
    WHERE timestamp IS NOT NULL AND length(timestamp) >= 4
    ORDER BY year DESC
  `).all().map((row) => Number(row.year)).filter(Number.isInteger);
  return { ...report, availableYears };
}

async function taxOptimizerResponse(year) {
  const report = taxReportResponse(year);
  const portfolio = await portfolioResponse();
  return { year, profile: report.profile, ...buildTaxOptimizer(report, portfolio.assetPrices) };
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

app.get("/api/tax-optimizer", async (request, response, next) => {
  try {
    response.json(await taxOptimizerResponse(reportYear(request.query.year)));
  } catch (error) { next(error); }
});

app.post("/api/tax-optimizer/simulate", async (request, response, next) => {
  try {
    const year = reportYear(request.body?.year);
    const report = taxReportResponse(year);
    const portfolio = await portfolioResponse();
    const asset = cleanLabel(request.body?.asset, 80);
    const priceEur = positiveNumber(request.body?.priceEur) || positiveNumber(portfolio.assetPrices[asset]);
    const result = simulateSale(report, { asset, amount: request.body?.amount, priceEur });
    if (!result) throw makeError("Bitte Asset, positive Menge und einen verfügbaren EUR-Preis angeben.");
    response.json({ year, profile: report.profile, ...result });
  } catch (error) { next(error); }
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

function safeDocumentName(value) {
  let decoded = "";
  try { decoded = decodeURIComponent(String(value || "")); } catch (_) { decoded = String(value || ""); }
  const name = path.basename(decoded).replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, " ").trim();
  return name.slice(0, 120) || "nachweis";
}

const DOCUMENT_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "text/csv", "application/octet-stream"]);

app.get("/api/transactions/:id/documents", (request, response, next) => {
  try {
    const transactionId = asPositiveId(request.params.id);
    if (!transactionId) throw makeError("Ungültige Transaktions-ID.");
    if (!db.prepare("SELECT id FROM transactions WHERE id = ?").get(transactionId)) throw makeError("Transaktion nicht gefunden.", 404);
    const documents = db.prepare(`
      SELECT id, original_name AS originalName, mime_type AS mimeType, byte_size AS byteSize, sha256, created_at AS createdAt
      FROM transaction_documents WHERE transaction_id = ? ORDER BY id DESC
    `).all(transactionId);
    response.json({ transactionId, documents });
  } catch (error) { next(error); }
});

app.post("/api/transactions/:id/documents", express.raw({ type: ["application/pdf", "image/jpeg", "image/png", "text/csv", "application/octet-stream"], limit: "5mb" }), (request, response, next) => {
  try {
    const transactionId = asPositiveId(request.params.id);
    if (!transactionId) throw makeError("Ungültige Transaktions-ID.");
    if (!db.prepare("SELECT id FROM transactions WHERE id = ?").get(transactionId)) throw makeError("Transaktion nicht gefunden.", 404);
    if (!Buffer.isBuffer(request.body) || !request.body.length) throw makeError("Bitte einen nicht leeren PDF-, Bild- oder CSV-Nachweis auswählen.");
    const mimeType = String(request.headers["content-type"] || "application/octet-stream").split(";", 1)[0].toLowerCase();
    if (!DOCUMENT_MIME_TYPES.has(mimeType)) throw makeError("Erlaubt sind PDF, PNG, JPEG und CSV-Dateien.");
    const originalName = safeDocumentName(request.headers["x-document-name"]);
    const storedName = crypto.randomUUID();
    const target = path.join(DOCUMENT_DIR, storedName);
    const sha256 = crypto.createHash("sha256").update(request.body).digest("hex");
    fs.writeFileSync(target, request.body, { flag: "wx", mode: 0o600 });
    try {
      const result = db.prepare(`
        INSERT INTO transaction_documents (transaction_id, original_name, stored_name, mime_type, byte_size, sha256)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(transactionId, originalName, storedName, mimeType, request.body.length, sha256);
      response.status(201).json({ id: Number(result.lastInsertRowid), transactionId, originalName, mimeType, byteSize: request.body.length, sha256 });
    } catch (error) {
      fs.unlinkSync(target);
      throw error;
    }
  } catch (error) { next(error); }
});

app.get("/api/transaction-documents/:id/download", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültiger Nachweis.");
    const document = db.prepare("SELECT original_name, stored_name, mime_type FROM transaction_documents WHERE id = ?").get(id);
    if (!document) throw makeError("Nachweis nicht gefunden.", 404);
    const documentPath = path.join(DOCUMENT_DIR, document.stored_name);
    if (!fs.existsSync(documentPath)) throw makeError("Die lokale Nachweisdatei fehlt. Bitte erneut anhängen.", 404);
    response.type(document.mime_type).download(documentPath, document.original_name, (error) => { if (error) next(error); });
  } catch (error) { next(error); }
});

app.delete("/api/transaction-documents/:id", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültiger Nachweis.");
    const document = db.prepare("SELECT stored_name FROM transaction_documents WHERE id = ?").get(id);
    if (!document) throw makeError("Nachweis nicht gefunden.", 404);
    db.prepare("DELETE FROM transaction_documents WHERE id = ?").run(id);
    const documentPath = path.join(DOCUMENT_DIR, document.stored_name);
    if (fs.existsSync(documentPath)) fs.unlinkSync(documentPath);
    response.json({ id, deleted: true });
  } catch (error) { next(error); }
});

function advisorPackage(year) {
  const report = taxReportResponse(year);
  const transactionIds = [...new Set([
    ...report.sales.flatMap((sale) => [sale.transactionId, sale.acquisitionTransactionId]),
    ...report.income.map((entry) => entry.transactionId),
  ].map(asPositiveId).filter(Boolean))];
  const placeholders = transactionIds.map(() => "?").join(",");
  const evidence = transactionIds.length ? db.prepare(`
    SELECT d.id, d.transaction_id AS transactionId, d.original_name AS originalName, d.mime_type AS mimeType,
      d.byte_size AS byteSize, d.sha256, d.created_at AS createdAt
    FROM transaction_documents d WHERE d.transaction_id IN (${placeholders}) ORDER BY d.transaction_id, d.id
  `).all(...transactionIds) : [];
  const priceAudit = transactionIds.length ? db.prepare(`
    SELECT transaction_id AS transactionId, price_eur AS priceEur, source, note, changed_at AS changedAt
    FROM transaction_price_audit WHERE transaction_id IN (${placeholders}) ORDER BY transaction_id, id
  `).all(...transactionIds) : [];
  const transfers = transactionIds.length ? db.prepare(`
    SELECT outgoing_transaction_id AS outgoingTransactionId, incoming_transaction_id AS incomingTransactionId,
      match_origin AS matchOrigin, note, created_at AS createdAt
    FROM transfer_links WHERE outgoing_transaction_id IN (${placeholders}) OR incoming_transaction_id IN (${placeholders})
  `).all(...transactionIds, ...transactionIds) : [];
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    year,
    scope: "Lokales CryptoBuch-Steuerberater-Paket; Organisationshilfe, keine Steuerberatung.",
    report: { year: report.year, profile: report.profile, summary: report.summary, sales: report.sales, income: report.income },
    dataQuality: {
      incompleteSaleSegments: report.summary.incompleteSaleSegments,
      incompleteIncomeEntries: report.summary.incompleteIncomeEntries,
      evidenceCount: evidence.length,
      linkedTransfers: transfers.length,
    },
    evidence,
    priceAudit,
    transfers,
    limitations: [
      "Historische Kurse, Steuerwerte und Simulationen sind Schätzungen.",
      "Anhänge bleiben lokal; dieses Paket enthält nur Metadaten und Prüfsummen.",
      "Unvollständige Anschaffungsdaten und Kurse sind nicht stillschweigend geschätzt.",
    ],
  };
}

app.get("/api/tax-report/advisor-package", (request, response, next) => {
  try {
    const year = reportYear(request.query.year);
    response.type("application/json").attachment(`cryptobuch-steuerberater-${year}.json`).send(JSON.stringify(advisorPackage(year), null, 2));
  } catch (error) { next(error); }
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

function parseCsvRows(text, profileId) {
  try {
    const { profile, rows } = normalizeExchangeRows(text, profileId);
    const required = ["timestamp", "direction", "asset", "amount"];
    if (profile.id === "generic" && rows.some((row) => required.some((column) => !(column in row)))) {
      throw makeError("Standard-CSV benötigt: timestamp, direction, asset, amount. Optional: fee, purpose, price_eur, hash.");
    }
    return { profile, rows };
  } catch (error) {
    throw makeError(error.message || "CSV konnte nicht verarbeitet werden.");
  }
}

function importExternalRows(wallet, rows, { source, profile = null, purposeOrigin = "manual" }) {
  const insert = db.prepare(`INSERT INTO transactions (wallet_id, external_id, hash, timestamp, direction, asset, asset_symbol, asset_name, asset_decimals, amount, fee, fee_asset, counterparty, price_transaction_eur, price_source, price_provider, price_recorded_at, purpose, purpose_origin, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wallet_id, external_id) DO UPDATE SET
      timestamp=excluded.timestamp, direction=excluded.direction, amount=excluded.amount, fee=excluded.fee, fee_asset=excluded.fee_asset,
      counterparty=excluded.counterparty, price_transaction_eur=CASE WHEN transactions.price_source='manual' THEN transactions.price_transaction_eur ELSE COALESCE(excluded.price_transaction_eur, transactions.price_transaction_eur) END,
      price_source=CASE WHEN transactions.price_source='manual' THEN 'manual' ELSE excluded.price_source END,
      price_provider=CASE WHEN transactions.price_source='manual' THEN transactions.price_provider WHEN excluded.price_transaction_eur IS NOT NULL THEN excluded.price_provider ELSE transactions.price_provider END,
      price_recorded_at=CASE WHEN transactions.price_source='manual' THEN transactions.price_recorded_at WHEN excluded.price_transaction_eur IS NOT NULL THEN excluded.price_recorded_at ELSE transactions.price_recorded_at END,
      purpose=CASE WHEN transactions.purpose_origin='manual' THEN transactions.purpose ELSE excluded.purpose END,
      purpose_origin=CASE WHEN transactions.purpose_origin='manual' THEN 'manual' ELSE excluded.purpose_origin END,
      raw_json=excluded.raw_json, updated_at=datetime('now')`);
  let imported = 0;
  db.exec("BEGIN");
  try {
    for (const [index, row] of rows.entries()) {
      const direction = String(row.direction || "").toLowerCase();
      const amount = Number(String(row.amount || "").replace(",", "."));
      const timestamp = new Date(row.timestamp).toISOString();
      if (!['in', 'out', 'self'].includes(direction) || !Number.isFinite(amount) || amount <= 0 || Number.isNaN(new Date(row.timestamp).getTime())) throw makeError(`Ungültige Importzeile ${index + 2}.`);
      const asset = cleanLabel(row.asset, 48).toUpperCase();
      const rawPrice = row.price_eur ?? row.priceEur;
      const price = rawPrice === undefined || rawPrice === "" || rawPrice === null ? null : Number(String(rawPrice).replace(",", "."));
      if (!asset || (price !== null && (!Number.isFinite(price) || price <= 0))) throw makeError(`Ungültige Importzeile ${index + 2}.`);
      const externalId = cleanLabel(row.external_id || row.externalId || row.hash || `import-${wallet.id}-${source}-${index}-${timestamp}`, 180);
      const fee = Number(String(row.fee || 0).replace(",", ".")) || 0;
      const feeAsset = cleanLabel(row.fee_asset || row.feeAsset || asset, 48).toUpperCase() || asset;
      const raw = row.raw || row;
      // An exchange-supplied EUR execution price is a source record and must
      // remain protected. Empty values are deliberately automatic so the
      // existing throttled historic-price job can keep completing them.
      const priceSource = price === null ? "auto" : "manual";
      insert.run(
        wallet.id, externalId, cleanLabel(row.hash || externalId, 180), timestamp, direction, asset, asset, asset, 8,
        amount, fee, feeAsset, cleanLabel(row.counterparty, 160) || null, price, priceSource,
        price === null ? null : source, price === null ? null : new Date().toISOString(), cleanPurpose(row.purpose), purposeOrigin,
        JSON.stringify({ source, profile, row: raw }),
      );
      imported += 1;
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return imported;
}

function getExchangeConnection(id) {
  const connection = db.prepare(`
    SELECT c.*, w.label AS account_label
    FROM exchange_connections c JOIN wallets w ON w.id = c.wallet_id WHERE c.id = ?
  `).get(id);
  if (!connection) throw makeError("Börsenverbindung nicht gefunden.", 404);
  return connection;
}

function tradeRepublicWebLoginView(connection) {
  if (connection.provider !== "trade_republic" || connection.import_mode !== "api") return null;
  const pending = Boolean(connection.trade_republic_web_login_id);
  const active = Boolean(connection.trade_republic_web_connected_at) && hasTradeRepublicWebSession(decryptTradeRepublicSession(connection.trade_republic_web_session)) && !pending;
  return {
    status: active ? "connected" : pending ? "approval_pending" : connection.trade_republic_web_login_error ? "login_error" : "login_required",
    connectedAt: connection.trade_republic_web_connected_at || null,
    loginStartedAt: connection.trade_republic_web_login_started_at || null,
    lastError: connection.trade_republic_web_login_error || null,
  };
}

function isActiveTradeRepublicConnection(connection) {
  return tradeRepublicWebLoginView(connection)?.status === "connected";
}

function tradeRepublicPhoneNumber(value) {
  const normalized = String(value || "").trim().replace(/[\s()-]/g, "");
  if (!/^\+?[0-9]{7,20}$/.test(normalized)) throw makeError("Bitte eine gültige Trade-Republic-Mobilnummer im internationalen Format eingeben.");
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

function tradeRepublicPin(value) {
  const pin = String(value || "").trim();
  if (!/^\d{4,16}$/.test(pin)) throw makeError("Die Trade-Republic-PIN muss aus 4 bis 16 Ziffern bestehen.");
  return pin;
}

async function startStoredTradeRepublicWebLogin(connectionId, pin) {
  const connection = getExchangeConnection(connectionId);
  if (connection.provider !== "trade_republic" || connection.import_mode !== "api") throw makeError("Diese Börsenverbindung verwendet keine Trade-Republic-Webanmeldung.");
  const phoneNumber = tradeRepublicPhoneNumber(connection.api_key);
  const cleanPin = tradeRepublicPin(pin);
  try {
    const login = await startTradeRepublicWebLogin({
      phoneNumber, pin: cleanPin, deviceId: connection.trade_republic_web_device_id || createTradeRepublicWebDeviceId(),
    });
    db.prepare(`UPDATE exchange_connections
      SET api_secret = '', trade_republic_web_device_id = ?, trade_republic_web_login_id = ?,
        trade_republic_web_pending_session = ?, trade_republic_web_login_started_at = datetime('now'),
        trade_republic_web_login_error = NULL
      WHERE id = ?`).run(login.deviceId, login.processId, encryptTradeRepublicSession(login.session), connection.id);
  } catch (error) {
    db.prepare("UPDATE exchange_connections SET trade_republic_web_login_error = ? WHERE id = ?")
      .run(String(error.message || error).slice(0, 500), connection.id);
  }
  return getExchangeConnection(connection.id);
}

async function pollStoredTradeRepublicWebLogin(connectionId) {
  const connection = getExchangeConnection(connectionId);
  if (connection.provider !== "trade_republic" || connection.import_mode !== "api") throw makeError("Diese Börsenverbindung verwendet keine Trade-Republic-Webanmeldung.");
  if (!connection.trade_republic_web_login_id || !connection.trade_republic_web_device_id) {
    throw makeError("Bitte die Trade-Republic-Webanmeldung zuerst neu starten.");
  }
  const startedAt = Date.parse(`${connection.trade_republic_web_login_started_at || ""}Z`);
  if (Number.isFinite(startedAt) && Date.now() - startedAt > 5 * 60 * 1000) {
    db.prepare("UPDATE exchange_connections SET trade_republic_web_login_id = '', trade_republic_web_pending_session = '', trade_republic_web_login_error = 'Die App-Bestätigung ist abgelaufen. Bitte erneut anmelden.' WHERE id = ?").run(connection.id);
    return { connection: getExchangeConnection(connection.id), completed: false };
  }
  try {
    const result = await pollTradeRepublicWebLogin({
      processId: connection.trade_republic_web_login_id,
      deviceId: connection.trade_republic_web_device_id,
      session: decryptTradeRepublicSession(connection.trade_republic_web_pending_session),
    });
    if (result.status === "approved") {
      db.prepare(`UPDATE exchange_connections SET trade_republic_web_session = ?, trade_republic_web_pending_session = '',
        trade_republic_web_login_id = '', trade_republic_web_login_error = NULL, trade_republic_web_connected_at = datetime('now') WHERE id = ?`)
        .run(encryptTradeRepublicSession(result.session), connection.id);
      return { connection: getExchangeConnection(connection.id), completed: true };
    }
    if (result.status === "rejected") {
      db.prepare("UPDATE exchange_connections SET trade_republic_web_login_id = '', trade_republic_web_pending_session = '', trade_republic_web_login_error = 'Die App-Bestätigung wurde abgelehnt oder ist abgelaufen.' WHERE id = ?").run(connection.id);
    } else {
      db.prepare("UPDATE exchange_connections SET trade_republic_web_pending_session = ? WHERE id = ?").run(encryptTradeRepublicSession(result.session), connection.id);
    }
  } catch (error) {
    db.prepare("UPDATE exchange_connections SET trade_republic_web_login_id = '', trade_republic_web_pending_session = '', trade_republic_web_login_error = ? WHERE id = ?")
      .run(String(error.message || error).slice(0, 500), connection.id);
    throw error;
  }
  return { connection: getExchangeConnection(connection.id), completed: false };
}

function binanceHistoryIsSettled(connection) {
  if (connection.provider !== "binance") return true;
  return Boolean(connection.history_completed_at) || normalizeBinanceHistoryState(connection.history_state).phase === "complete";
}

function binanceHistoryIsComplete(connection) {
  if (connection.provider !== "binance") return true;
  const state = normalizeBinanceHistoryState(connection.history_state);
  return binanceHistoryIsSettled(connection) && state.unresolvedSymbols.length === 0;
}

function binanceHistoryView(connection) {
  if (connection.provider !== "binance") return null;
  const state = normalizeBinanceHistoryState(connection.history_state);
  const complete = binanceHistoryIsComplete(connection);
  const settled = binanceHistoryIsSettled(connection);
  const progress = settled ? { current: 400, total: 400, phase: "complete" } : historyProgress(state);
  return {
    status: complete ? "complete" : settled ? "attention" : connection.history_started_at ? "running" : "pending",
    phase: settled ? "complete" : progress.phase,
    phaseLabel: historyPhaseLabel(settled ? "complete" : progress.phase),
    progressCurrent: progress.current,
    progressTotal: progress.total,
    startedAt: connection.history_started_at || null,
    completedAt: connection.history_completed_at || null,
    lastError: connection.history_last_error || null,
    markets: state.symbols || [],
    unresolvedMarkets: state.unresolvedSymbols || [],
    warnings: state.warnings || [],
  };
}

function exchangeBalanceView(connection) {
  if (!["binance", "bsdex"].includes(connection.provider)) return null;
  const snapshot = exchangeBalanceSnapshot(connection.id);
  return {
    status: snapshot ? "confirmed" : "pending",
    observedAt: snapshot?.observedAt || null,
    assetCount: snapshot?.balances.size || 0,
  };
}

function bsdexLiveView(connection) {
  if (connection.provider !== "bsdex") return null;
  return {
    enabled: Boolean(connection.live_updates_enabled),
    status: connection.live_updates_enabled ? (connection.live_status || "connecting") : "disabled",
    connectedAt: connection.live_connected_at || null,
    lastEventAt: connection.live_last_event_at || null,
    lastReconciledAt: connection.live_last_reconciled_at || null,
    lastError: connection.live_last_error || null,
    reconcileIntervalMinutes: Math.round(BSDEX_RECONCILE_INTERVAL_MS / 60000),
  };
}

function exchangeConnectionView(connection) {
  const provider = EXCHANGE_PROVIDERS[connection.provider] || null;
  const tradeRepublic = tradeRepublicWebLoginView(connection);
  return {
    id: connection.id,
    provider: connection.provider,
    label: connection.label,
    accountLabel: connection.account_label,
    etoroEnvironment: connection.provider === "etoro" ? (connection.etoro_environment || "real") : null,
    symbols: connection.symbols || "",
    importMode: connection.import_mode || provider?.importMode || "api",
    syncAvailable: (connection.import_mode || provider?.importMode || "api") === "api" && (!tradeRepublic || tradeRepublic.status === "connected"),
    csvProfile: provider?.csvProfile || null,
    lastSyncedAt: connection.last_synced_at,
    createdAt: connection.created_at,
    apiKeyConfigured: Boolean(connection.api_key),
    apiSecretConfigured: Boolean(connection.api_secret),
    history: binanceHistoryView(connection),
    balance: exchangeBalanceView(connection),
    live: bsdexLiveView(connection),
    tradeRepublic,
  };
}

function activeBinanceHistoryJob(connectionId) {
  const jobs = db.prepare("SELECT * FROM background_jobs WHERE type = 'exchange_history_sync' AND status IN ('queued', 'running') ORDER BY id ASC").all();
  return jobs.find((job) => {
    try { return Number(JSON.parse(job.payload_json || "{}").connectionId) === Number(connectionId); } catch { return false; }
  }) || null;
}

function queueBinanceHistoryIfNeeded(connection, { ignoreJobId = null } = {}) {
  if (connection.provider !== "binance" || binanceHistoryIsSettled(connection)) return null;
  const active = activeBinanceHistoryJob(connection.id);
  if (active && Number(active.id) !== Number(ignoreJobId)) return active;
  return enqueueJob("exchange_history_sync", { connectionId: connection.id });
}

async function exchangePortfolioResponse(id) {
  const connection = getExchangeConnection(id);
  const portfolio = await portfolioResponse();
  const transactions = portfolio.transactions.filter((transaction) => Number(transaction.wallet_id) === Number(connection.wallet_id));
  const journalHoldings = new Map();
  for (const transaction of transactions) {
    addHolding(journalHoldings, transaction.asset, transactionBalanceDelta(transaction));
  }
  const wallet = { id: connection.wallet_id, label: connection.account_label || connection.label };
  const position = exchangePosition(wallet, connection, journalHoldings);
  const assets = [...position.positions.entries()]
    .filter(([, amount]) => amount > HOLDING_EPSILON)
    .map(([assetId, amount]) => {
      const asset = portfolio.assets[assetId] || { id: assetId, name: assetId, symbol: assetId, decimals: 8, icon: "◇", kind: "unknown" };
      const priceEur = positiveNumber(portfolio.assetPrices[assetId]);
      return {
        ...asset,
        amount,
        currentPriceEur: priceEur,
        currentValueEur: priceEur ? amount * priceEur : null,
      };
    })
    .sort((left, right) => Number(right.currentValueEur || 0) - Number(left.currentValueEur || 0) || left.symbol.localeCompare(right.symbol));
  const totalValueEur = assets.reduce((sum, asset) => sum + Number(asset.currentValueEur || 0), 0);
  return {
    connection: exchangeConnectionView(connection),
    balance: {
      source: position.snapshot ? exchangeSnapshotSource(connection.provider) : "journal",
      observedAt: position.snapshot?.observedAt || null,
      reconciliations: position.reconciliations,
    },
    assets,
    transactions,
    transactionCount: transactions.length,
    totalValueEur,
  };
}

function containsForbiddenKeyMaterial(value) {
  const candidate = String(value || "").trim();
  return /^(?:xprv|yprv|zprv|tprv|uprv|vprv)/i.test(candidate)
    || /^(?:[a-z]+\s+){11,23}[a-z]+$/i.test(candidate);
}

async function syncExchangeConnection(connection) {
  const wallet = getWallet(connection.wallet_id);
  const settings = runtimeSettings();
  if (connection.import_mode === "csv") throw makeError("Für diese Quelle gibt es keine direkte Read-only-API. Bitte importiere die Buchungen als CSV in das zugehörige Börsenkonto.");
  let rows = [];
  let warnings = [];
  let selectedSymbols = [];
  let limited = false;
  let balanceSnapshotUpdated = false;
  let bsdexSubscription = null;
  if (connection.provider === "bitvavo") {
    rows = await fetchBitvavoHistory({ apiBaseUrl: settings.bitvavoApiBaseUrl, apiKey: connection.api_key, apiSecret: connection.api_secret });
  } else if (connection.provider === "binance") {
    const result = await fetchBinanceHistory({
      apiBaseUrl: settings.binanceApiBaseUrl, apiKey: connection.api_key, apiSecret: connection.api_secret, symbols: connection.symbols,
    });
    rows = result.rows;
    warnings = result.warnings;
    selectedSymbols = result.selectedSymbols;
    limited = result.rows.length >= 2500;
    if (Array.isArray(result.accountBalances)) balanceSnapshotUpdated = replaceExchangeBalanceSnapshot(connection.id, result.accountBalances);
  } else if (connection.provider === "etoro") {
    const result = await fetchEtoroHistory({
      apiBaseUrl: settings.etoroApiBaseUrl, apiKey: connection.api_key, userKey: connection.api_secret,
      environment: connection.etoro_environment || "real",
    });
    rows = result.rows;
    warnings = result.warnings;
    limited = result.limited;
  } else if (connection.provider === "bsdex") {
    const result = await fetchBsdexHistory({
      apiBaseUrl: settings.bsdexApiBaseUrl, apiKey: connection.api_key, apiSecret: connection.api_secret,
    });
    rows = result.rows;
    warnings = result.warnings;
    limited = result.limited;
    if (Array.isArray(result.accountBalances)) balanceSnapshotUpdated = replaceExchangeBalanceSnapshot(connection.id, result.accountBalances);
    bsdexSubscription = { markets: result.markets, balances: result.accountBalances };
  } else if (connection.provider === "trade_republic") {
    if (!isActiveTradeRepublicConnection(connection)) throw makeError("Bitte die Trade-Republic-Webanmeldung in der App bestätigen.");
    let session;
    try {
      session = await refreshTradeRepublicWebSession({
        session: decryptTradeRepublicSession(connection.trade_republic_web_session),
        deviceId: connection.trade_republic_web_device_id,
      });
    } catch (error) {
      db.prepare("UPDATE exchange_connections SET trade_republic_web_login_error = ? WHERE id = ?")
        .run("Die lokale Web-Sitzung ist abgelaufen. Bitte erneut anmelden.", connection.id);
      throw makeError("Die Trade-Republic-Websitzung ist abgelaufen. Bitte erneut anmelden.");
    }
    db.prepare("UPDATE exchange_connections SET trade_republic_web_session = ?, trade_republic_web_login_error = NULL WHERE id = ?")
      .run(encryptTradeRepublicSession(session), connection.id);
    const result = await fetchTradeRepublicCryptoHistory({
      session,
    });
    rows = result.rows;
    warnings = result.warnings;
    limited = result.limited;
  } else throw makeError("Für diese Börse ist noch kein Read-only-Adapter eingerichtet.");
  const imported = importExternalRows(wallet, rows, { source: `${connection.provider}-api`, purposeOrigin: "auto" });
  db.prepare(`UPDATE exchange_connections
    SET last_synced_at = datetime('now'),
      live_last_reconciled_at = CASE WHEN provider = 'bsdex' THEN datetime('now') ELSE live_last_reconciled_at END
    WHERE id = ?`).run(connection.id);
  if (connection.provider === "bsdex" && connection.live_updates_enabled) {
    // The private WebSocket is started only after the current journal and
    // balance snapshot were stored. External events are still deduplicated by
    // their BSDEX trade ID if a message overlaps with the REST import.
    await startBsdexLiveUpdates(connection, { subscription: bsdexSubscription });
  }
  return {
    imported,
    provider: connection.provider,
    // BSDEX has individually bounded trade and transfer buckets, so their
    // combined row count is not itself evidence of an incomplete import.
    limited: limited || (connection.provider !== "bsdex" && rows.length >= 2500),
    warnings,
    selectedSymbols,
    balanceSnapshotUpdated,
  };
}

async function syncBinanceHistoryBatch(connection) {
  if (connection.provider !== "binance") throw makeError("Ein historischer Hintergrundimport ist nur für Binance verfügbar.");
  if (connection.import_mode === "csv") throw makeError("Für diese Quelle gibt es keine direkte Read-only-API.");
  if (binanceHistoryIsSettled(connection)) {
    const history = binanceHistoryView(connection);
    return { imported: 0, provider: connection.provider, complete: history.status === "complete", settled: true, history, progress: { current: 400, total: 400, phase: "complete" }, warnings: history.warnings || [] };
  }
  const wallet = getWallet(connection.wallet_id);
  const settings = runtimeSettings();
  // Historical deposits, rewards and prior imports reveal markets that are no
  // longer in the live account balance.  They are safely added to the bounded
  // automatic market list; fully sold fiat pairs can still be entered by name.
  const knownAssets = db.prepare("SELECT DISTINCT asset FROM transactions WHERE wallet_id = ? AND asset IS NOT NULL LIMIT 500").all(wallet.id).map((row) => row.asset);
  const result = await fetchBinanceHistoryBatch({
    apiBaseUrl: settings.binanceApiBaseUrl,
    apiKey: connection.api_key,
    apiSecret: connection.api_secret,
    symbols: connection.symbols,
    knownAssets,
    state: connection.history_state,
  });
  const imported = importExternalRows(wallet, result.rows, { source: "binance-api", purposeOrigin: "auto" });
  if (Array.isArray(result.accountBalances)) replaceExchangeBalanceSnapshot(connection.id, result.accountBalances);
  const serializedState = JSON.stringify(result.nextState);
  db.prepare(`UPDATE exchange_connections
    SET history_state = ?,
      history_started_at = COALESCE(history_started_at, datetime('now')),
      history_completed_at = CASE WHEN ? THEN datetime('now') ELSE NULL END,
      history_last_error = NULL,
      last_synced_at = datetime('now')
    WHERE id = ?`).run(serializedState, result.settled ? 1 : 0, connection.id);
  return {
    imported,
    provider: connection.provider,
    complete: result.complete,
    settled: result.settled,
    warnings: result.warnings,
    selectedSymbols: result.selectedSymbols,
    progress: result.progress,
    history: binanceHistoryView(getExchangeConnection(connection.id)),
  };
}

app.get("/api/import/csv-profiles", (_request, response) => {
  response.json({ profiles: Object.values(EXCHANGE_CSV_PROFILES) });
});

app.get("/api/exchange-connections", (_request, response, next) => {
  try {
    const connections = db.prepare(`
      SELECT c.*, w.label AS account_label
      FROM exchange_connections c JOIN wallets w ON w.id = c.wallet_id ORDER BY c.id DESC
    `).all().map(exchangeConnectionView);
    response.json({ providers: Object.values(EXCHANGE_PROVIDERS), connections });
  } catch (error) { next(error); }
});

app.get("/api/exchange-connections/:id/portfolio", async (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Börsenverbindung.");
    response.json(await exchangePortfolioResponse(id));
  } catch (error) { next(error); }
});

app.post("/api/exchange-connections", async (request, response, next) => {
  try {
    const provider = String(request.body?.provider || "").trim().toLowerCase();
    const definition = EXCHANGE_PROVIDERS[provider];
    if (!definition) throw makeError("Bitte eine unterstützte Börse auswählen.");
    const label = cleanLabel(request.body?.label, 80) || definition.defaultLabel;
    let apiKey = String(request.body?.apiKey || "").trim();
    let apiSecret = String(request.body?.apiSecret || "").trim();
    const etoroEnvironment = provider === "etoro" ? String(request.body?.etoroEnvironment || "real").trim().toLowerCase() : "real";
    const symbols = parseSymbols(request.body?.symbols).join(",");
    const liveUpdatesEnabled = provider === "bsdex" && request.body?.liveUpdatesEnabled === true ? 1 : 0;
    if (provider === "etoro" && !["real", "demo"].includes(etoroEnvironment)) {
      throw makeError("Für eToro bitte Realkonto oder Demokonto auswählen.");
    }
    if (provider === "trade_republic") {
      if (request.body?.tradeRepublicConsent !== true) {
        throw makeError("Bitte bestätige ausdrücklich die Hinweise zur inoffiziellen Trade-Republic-Geräteanmeldung.");
      }
      apiKey = tradeRepublicPhoneNumber(apiKey);
      apiSecret = tradeRepublicPin(apiSecret);
    } else if (definition.importMode === "api" && (apiKey.length < 8 || apiKey.length > 512 || apiSecret.length < 8 || apiSecret.length > 512)) {
      throw makeError("Die Zugangsdaten müssen jeweils zwischen 8 und 512 Zeichen lang sein.");
    }
    if (definition.importMode === "api" && (containsForbiddenKeyMaterial(apiKey) || containsForbiddenKeyMaterial(apiSecret))) {
      throw makeError("Private Keys, xPrvs und Seed-Phrases werden niemals akzeptiert. Bitte ausschließlich die Read-only-Zugangsdaten der Börse verwenden.");
    }
    if (db.prepare("SELECT id FROM exchange_connections WHERE provider = ? AND label = ?").get(provider, label)) {
      throw makeError("Diese Börsenverbindung ist bereits hinterlegt.", 409);
    }
    db.exec("BEGIN");
    let result;
    try {
      const accountWalletId = createExchangeAccountWallet(provider, label);
      if (provider === "trade_republic") apiSecret = "";
      result = db.prepare(`INSERT INTO exchange_connections
        (provider, wallet_id, label, api_key, api_secret, etoro_environment, symbols, import_mode, live_updates_enabled, live_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(provider, accountWalletId, label, apiKey, apiSecret, etoroEnvironment, symbols, definition.importMode, liveUpdatesEnabled, liveUpdatesEnabled ? "connecting" : "disabled");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const connectionId = Number(result.lastInsertRowid);
    if (provider === "trade_republic") {
      db.prepare("UPDATE exchange_connections SET trade_republic_disclaimer_accepted_at = datetime('now') WHERE id = ?").run(connectionId);
      await startStoredTradeRepublicWebLogin(connectionId, request.body?.apiSecret);
    }
    const connection = exchangeConnectionView(getExchangeConnection(connectionId));
    // API sources start their serial import immediately. CSV-only sources are
    // deliberately left empty until the user selects a documented local file.
    const job = definition.importMode === "api" && provider !== "trade_republic" ? enqueueJob("exchange_sync", { connectionId: connection.id }) : null;
    response.status(201).json({ ...connection, job });
  } catch (error) {
    if (String(error.message).includes("UNIQUE constraint failed")) return next(makeError("Diese Börsenverbindung ist bereits hinterlegt."));
    next(error);
  }
});

app.post("/api/exchange-connections/:id/trade-republic/web-login/start", async (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Börsenverbindung.");
    const connection = await startStoredTradeRepublicWebLogin(id, request.body?.pin);
    response.status(202).json(exchangeConnectionView(connection));
  } catch (error) { next(error); }
});

app.post("/api/exchange-connections/:id/trade-republic/web-login/poll", async (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Börsenverbindung.");
    const result = await pollStoredTradeRepublicWebLogin(id);
    response.status(202).json({ ...exchangeConnectionView(result.connection), ...(result.completed ? { job: enqueueJob("exchange_sync", { connectionId: result.connection.id }) } : {}) });
  } catch (error) { next(error); }
});

app.patch("/api/exchange-connections/:id/binance-markets", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Börsenverbindung.");
    const connection = getExchangeConnection(id);
    if (connection.provider !== "binance" || connection.import_mode !== "api") {
      throw makeError("Historische Märkte können nur für eine Binance-Read-only-Verbindung geändert werden.");
    }
    const symbols = parseSymbols(request.body?.symbols);
    const priorState = normalizeBinanceHistoryState(connection.history_state);
    // Re-run only the trade phase.  Deposits, withdrawals and dividends are
    // already independently deduplicated; repeating them would delay a
    // targeted recovery without improving its result.
    const nextState = {
      ...priorState,
      phase: "trades",
      endAt: Date.now(),
      cursorAt: priorState.startAt,
      offset: 0,
      symbols: [],
      markets: [],
      symbolIndex: 0,
      fromId: 0,
      warnings: [],
      unresolvedSymbols: [],
    };
    db.prepare(`UPDATE exchange_connections
      SET symbols = ?, history_state = ?, history_started_at = datetime('now'),
        history_completed_at = NULL, history_last_error = NULL
      WHERE id = ?`).run(symbols.join(","), JSON.stringify(nextState), connection.id);
    const updated = getExchangeConnection(connection.id);
    response.status(202).json({ ...exchangeConnectionView(updated), job: queueBinanceHistoryIfNeeded(updated) });
  } catch (error) { next(error); }
});

app.patch("/api/exchange-connections/:id/live-updates", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Börsenverbindung.");
    const connection = getExchangeConnection(id);
    if (connection.provider !== "bsdex" || connection.import_mode !== "api") {
      throw makeError("Live-Updates stehen nur für eine BSDEX-Read-only-Verbindung zur Verfügung.");
    }
    const enabled = request.body?.enabled === true;
    if (!enabled) {
      db.prepare("UPDATE exchange_connections SET live_updates_enabled = 0 WHERE id = ?").run(connection.id);
      stopBsdexLiveUpdates(connection.id);
      response.json(exchangeConnectionView(getExchangeConnection(connection.id)));
      return;
    }
    db.prepare(`UPDATE exchange_connections
      SET live_updates_enabled = 1, live_status = 'connecting', live_last_error = NULL
      WHERE id = ?`).run(connection.id);
    const updated = getExchangeConnection(connection.id);
    // A new REST reconciliation establishes an authoritative snapshot before
    // the WebSocket is opened and provides a recovery point for missed data.
    response.status(202).json({ ...exchangeConnectionView(updated), job: queueBsdexReconciliation(connection.id) });
  } catch (error) { next(error); }
});

app.post("/api/exchange-connections/:id/sync", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Börsenverbindung.");
    const connection = getExchangeConnection(id);
    if (connection.import_mode === "csv") throw makeError("Diese Quelle wird über den lokalen CSV-Import aktualisiert.");
    if (connection.provider === "trade_republic" && !isActiveTradeRepublicConnection(connection)) {
      throw makeError("Bitte die Trade-Republic-Webanmeldung in der App bestätigen.");
    }
    response.status(202).json({ job: enqueueJob("exchange_sync", { connectionId: id }) });
  } catch (error) { next(error); }
});

app.delete("/api/exchange-connections/:id", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Börsenverbindung.");
    const connection = getExchangeConnection(id);
    if (connection.provider === "bsdex") stopBsdexLiveUpdates(connection.id, { persist: false });
    const deleted = db.prepare("DELETE FROM exchange_connections WHERE id = ?").run(id);
    if (!deleted.changes) throw makeError("Börsenverbindung nicht gefunden.", 404);
    response.status(204).end();
  } catch (error) { next(error); }
});

app.post("/api/import/csv", (request, response, next) => {
  try {
    const { profile, rows } = parseCsvRows(request.body?.csv, String(request.body?.profile || "generic").toLowerCase());
    if (rows.length > 2500) throw makeError("Maximal 2.500 CSV-Transaktionen gleichzeitig importieren.");
    const connectionId = asPositiveId(request.body?.exchangeConnectionId);
    if (connectionId) {
      const connection = getExchangeConnection(connectionId);
      const targetProviders = Array.isArray(profile.targetProviders) ? profile.targetProviders : [];
      if (!targetProviders.includes(connection.provider)) throw makeError("Dieses CSV-Profil passt nicht zu der ausgewählten Börsenquelle.");
      const wallet = getWallet(connection.wallet_id);
      const imported = importExternalRows(wallet, rows, { source: `${connection.provider}-csv`, profile: profile.id, purposeOrigin: "manual" });
      db.prepare("UPDATE exchange_connections SET last_synced_at = datetime('now') WHERE id = ?").run(connection.id);
      if (imported) {
        enqueueJob("exchange_transfer_check", { connectionId: connection.id });
        enqueueJob("price_backfill", { force: false });
      }
      response.status(201).json({ imported, exchangeConnectionId: connection.id, profile: profile.id });
      return;
    }
    const walletId = asPositiveId(request.body?.walletId);
    if (!walletId) throw makeError("Bitte eine Ziel-Wallet oder Börsenquelle auswählen.");
    if (Array.isArray(profile.targetProviders) && profile.targetProviders.length) {
      throw makeError("Dieses CSV-Profil benötigt das zugehörige Börsenkonto als Zielquelle.");
    }
    const wallet = getWallet(walletId);
    if (wallet.source_type === "exchange") throw makeError("Für Börsenbuchungen bitte ein passendes Börsenprofil und das zugehörige Börsenkonto auswählen.");
    const imported = importExternalRows(wallet, rows, { source: "csv", profile: profile.id, purposeOrigin: "manual" });
    response.status(201).json({ imported, walletId: wallet.id, profile: profile.id });
  } catch (error) { next(error); }
});

app.delete("/api/wallets/:id", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Wallet-ID.");
    getWallet(id);
    const documents = db.prepare(`
      SELECT d.stored_name FROM transaction_documents d
      JOIN transactions t ON t.id = d.transaction_id WHERE t.wallet_id = ?
    `).all(id);
    db.prepare("DELETE FROM wallets WHERE id = ?").run(id);
    for (const document of documents) {
      const documentPath = path.join(DOCUMENT_DIR, path.basename(document.stored_name));
      if (fs.existsSync(documentPath)) fs.unlinkSync(documentPath);
    }
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
        SET price_transaction_eur = NULL, price_source = 'auto', price_provider = NULL, price_recorded_at = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(id);
      if (!result.changes) throw makeError("Transaktion nicht gefunden.", 404);
      db.prepare("DELETE FROM historical_price_retries WHERE transaction_id = ?").run(id);
      db.prepare("INSERT INTO transaction_price_audit (transaction_id, price_eur, source, note) VALUES (?, ?, ?, ?)").run(id, null, "auto", note || "Automatische Preisermittlung wieder aktiviert");
      response.json(db.prepare("SELECT id, price_transaction_eur, price_source, price_provider, price_recorded_at FROM transactions WHERE id = ?").get(id));
      return;
    }
    const price = positiveNumber(rawPrice);
    if (!price || price > 1000000000000) throw makeError("Der historische Preis muss eine positive EUR-Zahl sein.");
    const result = db.prepare(`
      UPDATE transactions
      SET price_transaction_eur = ?, price_source = 'manual', price_provider = 'manual', price_recorded_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(price, id);
    if (!result.changes) throw makeError("Transaktion nicht gefunden.", 404);
    db.prepare("DELETE FROM historical_price_retries WHERE transaction_id = ?").run(id);
    db.prepare("INSERT INTO transaction_price_audit (transaction_id, price_eur, source, note) VALUES (?, ?, ?, ?)").run(id, price, "manual", note);
    response.json(db.prepare("SELECT id, price_transaction_eur, price_source, price_provider, price_recorded_at FROM transactions WHERE id = ?").get(id));
  } catch (error) {
    next(error);
  }
});

app.get("/api/transactions/:id/price-history", (request, response, next) => {
  try {
    const id = asPositiveId(request.params.id);
    if (!id) throw makeError("Ungültige Transaktions-ID.");
    const transaction = db.prepare("SELECT id, price_transaction_eur, price_source, price_provider, price_recorded_at, updated_at FROM transactions WHERE id = ?").get(id);
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

registerAppApi(app, {
  db, settingsResponse, chains: CHAIN_CONFIG, purposePresets: PURPOSE_PRESETS,
  exchangeProviders: EXCHANGE_PROVIDERS, csvProfiles: EXCHANGE_CSV_PROFILES, safeMessage: safeAutomationMessage,
});
app.get("/api/openapi.json", (_request, response) => response.json(buildOpenApi(settingsResponse(), { exchangeProviders: EXCHANGE_PROVIDERS })));
// Unknown API URLs must never return the HTML dashboard fallback.
app.use("/api", (_request, response) => response.status(404).json({ error: "API-Endpunkt nicht gefunden." }));

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
const initialHistoricalPriceRetry = setTimeout(scheduleHistoricalPriceBackfill, Math.max(0, historicalPriceInitialCheckAt - Date.now()));
initialHistoricalPriceRetry.unref();

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`CryptoBuch läuft auf http://0.0.0.0:${PORT}`);
  });
}

module.exports = {
  app,
  automationStatusResponse,
  backfillHistoricalPrices,
  db,
  historicalPricePipelineResponse,
  resetLocalData,
  runtimeSettings,
  settingsResponse,
  updateSettings,
  exchangePosition,
  exchangeTransferSuggestions,
  replaceExchangeBalanceSnapshot,
};
