const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cryptobuch-exchange-balance-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dataDir;
const { db, exchangePosition, exchangeTransferSuggestions, replaceExchangeBalanceSnapshot } = require("../server");

test.after(() => {
  db.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("verwendet den bestätigten Binance-Spot-Saldo statt eines negativen Buchungs-Saldos", () => {
  const walletId = Number(db.prepare("INSERT INTO wallets (chain, address, label, source_type) VALUES ('EXCHANGE', 'exchange:binance:balance-test', 'Binance', 'exchange')").run().lastInsertRowid);
  const connectionId = Number(db.prepare("INSERT INTO exchange_connections (provider, wallet_id, label, api_key, api_secret) VALUES ('binance', ?, 'Binance', 'key', 'secret')").run(walletId).lastInsertRowid);
  replaceExchangeBalanceSnapshot(connectionId, [{ asset: "BTC", free: 0.01, locked: 0 }]);

  const result = exchangePosition(
    { id: walletId, label: "Binance" },
    { id: connectionId, provider: "binance", label: "Binance" },
    new Map([["BTC", 0.01], ["XTZ", -104.006747]]),
  );

  assert.deepEqual([...result.positions.entries()], [["BTC", 0.01]]);
  assert.equal(result.reconciliations.length, 1);
  assert.deepEqual(result.reconciliations[0], {
    connectionId,
    walletId,
    provider: "binance",
    label: "Binance",
    asset: "XTZ",
    journalAmount: -104.006747,
    balanceAmount: 0,
    difference: 104.006747,
    source: "binance_spot_snapshot",
    observedAt: result.snapshot.observedAt,
  });
});

test("verwendet den bestätigten BSDEX-Saldo statt eines unvollständigen Journals", () => {
  const walletId = Number(db.prepare("INSERT INTO wallets (chain, address, label, source_type) VALUES ('EXCHANGE', 'exchange:bsdex:balance-test', 'BSDEX', 'exchange')").run().lastInsertRowid);
  const connectionId = Number(db.prepare("INSERT INTO exchange_connections (provider, wallet_id, label, api_key, api_secret) VALUES ('bsdex', ?, 'BSDEX', 'key', 'secret')").run(walletId).lastInsertRowid);
  replaceExchangeBalanceSnapshot(connectionId, [{ asset: "ETH", free: 1.5, locked: 0 }]);

  const result = exchangePosition(
    { id: walletId, label: "BSDEX" },
    { id: connectionId, provider: "bsdex", label: "BSDEX" },
    new Map([["ETH", -0.5]]),
  );

  assert.deepEqual([...result.positions.entries()], [["ETH", 1.5]]);
  assert.equal(result.reconciliations[0].source, "bsdex_snapshot");
  assert.equal(result.reconciliations[0].difference, 2);
});

test("verwendet den bestätigten Coinbase-Exchange-Saldo statt eines unvollständigen Journals", () => {
  const walletId = Number(db.prepare("INSERT INTO wallets (chain, address, label, source_type) VALUES ('EXCHANGE', 'exchange:coinbase:balance-test', 'Coinbase Exchange', 'exchange')").run().lastInsertRowid);
  const connectionId = Number(db.prepare("INSERT INTO exchange_connections (provider, wallet_id, label, api_key, api_secret, coinbase_passphrase) VALUES ('coinbase', ?, 'Coinbase Exchange', 'key', 'secret', 'passphrase')").run(walletId).lastInsertRowid);
  replaceExchangeBalanceSnapshot(connectionId, [{ asset: "BTC", free: 0.05, locked: 0 }]);

  const result = exchangePosition(
    { id: walletId, label: "Coinbase Exchange" },
    { id: connectionId, provider: "coinbase", label: "Coinbase Exchange" },
    new Map([["BTC", -0.2]]),
  );

  assert.deepEqual([...result.positions.entries()], [["BTC", 0.05]]);
  assert.equal(result.reconciliations[0].source, "coinbase_snapshot");
  assert.equal(result.reconciliations[0].difference, 0.25);
});

test("schlägt eine abgeschlossene BSDEX-Auszahlung zur lokalen Wallet als Transfer vor", () => {
  const exchangeWalletId = Number(db.prepare("INSERT INTO wallets (chain, address, label, source_type) VALUES ('EXCHANGE', 'exchange:bsdex:transfer-test', 'BSDEX', 'exchange')").run().lastInsertRowid);
  const localWalletId = Number(db.prepare("INSERT INTO wallets (chain, address, label) VALUES ('BTC', 'bc1-local-transfer-test', 'Hardware-Wallet')").run().lastInsertRowid);
  const insert = db.prepare(`INSERT INTO transactions (
    wallet_id, external_id, hash, timestamp, direction, asset, asset_symbol, asset_name, asset_decimals,
    amount, fee, fee_asset, purpose, purpose_origin, raw_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const timestamp = "2024-01-02T12:00:00.000Z";
  const outgoingId = Number(insert.run(
    exchangeWalletId, "bsdex:withdrawal:transfer-1:btc", "bsdex:withdrawal:transfer-1", timestamp,
    "out", "BTC", "BTC", "BTC", 8, 0.125, 0, "BTC", "Transfer", "auto", JSON.stringify({ source: "bsdex-api" }),
  ).lastInsertRowid);
  const incomingId = Number(insert.run(
    localWalletId, "wallet:transfer-1", "wallet:transfer-1", "2024-01-02T12:03:00.000Z",
    "in", "BTC", "BTC", "BTC", 8, 0.125, 0, "BTC", "Transfer", "auto", JSON.stringify({ source: "bitcoin" }),
  ).lastInsertRowid);

  const suggestion = exchangeTransferSuggestions(20).find((item) => item.outgoing_id === outgoingId && item.incoming_id === incomingId);
  assert.deepEqual(suggestion, {
    outgoing_id: outgoingId,
    incoming_id: incomingId,
    asset: "BTC",
    amount: 0.125,
    outgoing_at: timestamp,
    incoming_at: "2024-01-02T12:03:00.000Z",
    outgoing_wallet: "BSDEX · Börse",
    incoming_wallet: "Hardware-Wallet",
    origin: "exchange",
    fee_adjusted: false,
  });
});

test("schlägt eine Coinbase-Auszahlung zur lokalen Wallet als Transfer vor", () => {
  const exchangeWalletId = Number(db.prepare("INSERT INTO wallets (chain, address, label, source_type) VALUES ('EXCHANGE', 'exchange:coinbase:transfer-test', 'Coinbase Exchange', 'exchange')").run().lastInsertRowid);
  const localWalletId = Number(db.prepare("INSERT INTO wallets (chain, address, label) VALUES ('ETH', '0xcoinbase-transfer-test', 'Hardware-Wallet 2')").run().lastInsertRowid);
  const insert = db.prepare(`INSERT INTO transactions (
    wallet_id, external_id, hash, timestamp, direction, asset, asset_symbol, asset_name, asset_decimals,
    amount, fee, fee_asset, purpose, purpose_origin, raw_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const outgoingId = Number(insert.run(
    exchangeWalletId, "coinbase:ledger:withdrawal-1:ETH", "coinbase:withdrawal-1", "2024-02-02T12:00:00.000Z",
    "out", "ETH", "ETH", "ETH", 8, 0.5, 0, "ETH", "Transfer", "auto", JSON.stringify({ source: "coinbase-api" }),
  ).lastInsertRowid);
  const incomingId = Number(insert.run(
    localWalletId, "wallet:coinbase-transfer-1", "wallet:coinbase-transfer-1", "2024-02-02T12:04:00.000Z",
    "in", "ETH", "ETH", "ETH", 8, 0.5, 0, "ETH", "Transfer", "auto", JSON.stringify({ source: "ethereum" }),
  ).lastInsertRowid);

  const suggestion = exchangeTransferSuggestions(20).find((item) => item.outgoing_id === outgoingId && item.incoming_id === incomingId);
  assert.equal(suggestion?.origin, "exchange");
  assert.equal(suggestion?.outgoing_wallet, "Coinbase Exchange · Börse");
  assert.equal(suggestion?.incoming_wallet, "Hardware-Wallet 2");
});
