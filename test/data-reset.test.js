const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cryptobuch-data-reset-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dataDir;
const { db, resetLocalData } = require("../server");

test.after(() => {
  db.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("setzt alle aktiven lokalen Daten zurück und behält Backups", () => {
  const walletId = Number(db.prepare("INSERT INTO wallets (chain, address, label, source_type) VALUES ('BTC', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', 'Reset-Test', 'address')").run().lastInsertRowid);
  const transactionId = Number(db.prepare("INSERT INTO transactions (wallet_id, external_id, hash, timestamp, direction, asset, amount, raw_json) VALUES (?, 'reset-transaction', 'reset-hash', '2026-01-01T00:00:00.000Z', 'in', 'BTC', 1, '{}')").run(walletId).lastInsertRowid);
  const secondTransactionId = Number(db.prepare("INSERT INTO transactions (wallet_id, external_id, hash, timestamp, direction, asset, amount, raw_json) VALUES (?, 'reset-transaction-2', 'reset-hash-2', '2026-01-02T00:00:00.000Z', 'out', 'BTC', 1, '{}')").run(walletId).lastInsertRowid);
  db.prepare("INSERT INTO wallet_metadata (wallet_id, group_name, tags) VALUES (?, 'Reset', '[]')").run(walletId);
  db.prepare("INSERT INTO wallet_addresses (wallet_id, address, branch, derivation_index) VALUES (?, 'bc1qresetaddress', 0, 0)").run(walletId);
  db.prepare("INSERT INTO sync_events (wallet_id, status) VALUES (?, 'success')").run(walletId);
  db.prepare("INSERT INTO historical_price_retries (transaction_id, attempt_count, last_attempt_at, next_attempt_at) VALUES (?, 1, '2026-01-01', '2026-01-02')").run(transactionId);
  db.prepare("INSERT INTO transaction_price_audit (transaction_id, price_eur, source) VALUES (?, 1, 'manual')").run(transactionId);
  db.prepare("INSERT INTO transfer_links (outgoing_transaction_id, incoming_transaction_id) VALUES (?, ?)").run(transactionId, secondTransactionId);
  const connectionId = Number(db.prepare("INSERT INTO exchange_connections (provider, wallet_id, label, api_key, api_secret) VALUES ('bitvavo', ?, 'Reset-Börse', 'key', 'secret')").run(walletId).lastInsertRowid);
  db.prepare("INSERT INTO exchange_balance_snapshot_meta (connection_id) VALUES (?)").run(connectionId);
  db.prepare("INSERT INTO exchange_balance_snapshots (connection_id, asset, free_amount, locked_amount) VALUES (?, 'BTC', 1, 0)").run(connectionId);
  db.prepare("INSERT INTO app_settings (setting_key, setting_value) VALUES ('reset-test', 'value')").run();
  db.prepare("INSERT INTO price_history (coin_id, price_date, price_eur) VALUES ('bitcoin', '2026-01-01', 42)").run();
  db.prepare("INSERT INTO background_jobs (type, payload_json) VALUES ('wallet_sync', '{}')").run();
  db.prepare("INSERT INTO notifications (level, title, message) VALUES ('info', 'Reset-Test', 'wird entfernt')").run();
  db.prepare("INSERT INTO tax_report_snapshots (year, profile_id, profile_label, report_json, report_checksum) VALUES (2026, 'test', 'Test', '{}', 'checksum')").run();
  db.prepare("INSERT INTO transaction_documents (transaction_id, original_name, stored_name, mime_type, byte_size, sha256) VALUES (?, 'beleg.csv', 'reset-document', 'text/csv', 1, 'checksum')").run(transactionId);
  fs.writeFileSync(path.join(dataDir, "documents", "reset-document"), "x");
  const backupPath = path.join(dataDir, "backups", "cryptobuch-20260101-000000.sqlite");
  fs.writeFileSync(backupPath, "backup");

  const deleted = resetLocalData();

  assert.deepEqual(deleted, { wallets: 1, transactions: 2, documents: 1 });
  for (const table of ["wallets", "wallet_metadata", "wallet_addresses", "transactions", "historical_price_retries", "transaction_price_audit", "sync_events", "transfer_links", "exchange_connections", "exchange_balance_snapshot_meta", "exchange_balance_snapshots", "app_settings", "price_history", "background_jobs", "notifications", "tax_report_snapshots", "transaction_documents"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, `${table} wurde nicht geleert`);
  }
  assert.equal(fs.existsSync(path.join(dataDir, "documents", "reset-document")), false);
  assert.equal(fs.existsSync(path.join(dataDir, "trade-republic-session.key")), false);
  assert.equal(fs.existsSync(backupPath), true);
});
