const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cryptobuch-price-fetches-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dataDir;
const { backfillHistoricalPrices, db, historicalPricePipelineResponse } = require("../server");

test.after(() => {
  db.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("zeigt Preis-Pipeline, anstehende Werte und sichere Abrufereignisse", () => {
  const walletId = Number(db.prepare("INSERT INTO wallets (chain, address, label) VALUES ('BTC', 'bc1qpricefetchtest', 'Preis-Test')").run().lastInsertRowid);
  const transactionId = Number(db.prepare(`
    INSERT INTO transactions (wallet_id, external_id, hash, timestamp, direction, asset, asset_symbol, amount, raw_json)
    VALUES (?, 'price-fetch-transaction', 'price-fetch-hash', '2025-01-01T00:00:00.000Z', 'in', 'BTC', 'BTC', 1, '{}')
  `).run(walletId).lastInsertRowid);
  db.prepare(`
    INSERT INTO historical_price_retries (transaction_id, attempt_count, last_attempt_at, next_attempt_at)
    VALUES (?, 2, datetime('now', '-1 hour'), datetime('now', '-1 minute'))
  `).run(transactionId);
  const runId = Number(db.prepare(`
    INSERT INTO historical_price_runs (trigger, force_run, status, pending_count, attempted_count, updated_count, unresolved_count, result_json, finished_at)
    VALUES ('automatisch', 0, 'success', 1, 1, 0, 1, '{"hint":"Test-Hinweis"}', datetime('now'))
  `).run().lastInsertRowid);
  db.prepare(`
    INSERT INTO historical_price_fetch_events (run_id, source, asset, date_from, date_to, status, returned_prices, error_message)
    VALUES (?, 'coingecko', 'BTC', '2025-01-01', '2025-01-01', 'error', 0, 'Rate-Limit oder temporäre Begrenzung der Preisquelle.')
  `).run(runId);

  const response = historicalPricePipelineResponse();

  assert.equal(response.pipeline.pending, 1);
  assert.equal(response.pipeline.due, 1);
  assert.equal(response.upcoming.length, 1);
  assert.equal(response.upcoming[0].assetSymbol, "BTC");
  assert.equal(response.runs.length, 1);
  assert.equal(response.runs[0].trigger, "automatisch");
  assert.equal(response.runs[0].events[0].source, "coingecko");
  assert.equal(response.runs[0].events[0].errorMessage.includes("Rate-Limit"), true);
});

test("übernimmt die tatsächliche automatische Preisquelle in die Buchung", async () => {
  db.prepare(`
    INSERT INTO price_history (coin_id, price_date, price_eur, source)
    VALUES ('bitcoin', '2025-01-01', 42000, 'bitvavo')
  `).run();

  const result = await backfillHistoricalPrices({ force: true });
  const transaction = db.prepare(`
    SELECT price_transaction_eur, price_source, price_provider, price_recorded_at
    FROM transactions WHERE external_id = 'price-fetch-transaction'
  `).get();
  const audit = db.prepare(`
    SELECT source, note FROM transaction_price_audit
    WHERE transaction_id = (SELECT id FROM transactions WHERE external_id = 'price-fetch-transaction')
    ORDER BY id DESC LIMIT 1
  `).get();

  assert.equal(result.updated, 1);
  assert.equal(transaction.price_transaction_eur, 42000);
  assert.equal(transaction.price_source, "auto");
  assert.equal(transaction.price_provider, "bitvavo");
  assert.ok(transaction.price_recorded_at);
  assert.equal(audit.source, "auto");
  assert.equal(audit.note, "Automatisch ergänzt · bitvavo");
});
