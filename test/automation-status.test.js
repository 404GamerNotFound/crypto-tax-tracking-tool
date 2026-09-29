const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cryptobuch-automation-status-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dataDir;
const { automationStatusResponse, db } = require("../server");

test.after(() => {
  db.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("zeigt lokale Zeitsteuerungen und sichere Hintergrundjob-Metadaten", () => {
  const walletId = Number(db.prepare("INSERT INTO wallets (chain, address, label, source_type) VALUES ('EXCHANGE', 'exchange:bsdex:automation-test', 'BSDEX', 'exchange')").run().lastInsertRowid);
  db.prepare(`INSERT INTO exchange_connections (
    provider, wallet_id, label, api_key, api_secret, live_updates_enabled, live_status, live_last_reconciled_at
  ) VALUES ('bsdex', ?, 'BSDEX Test', 'key', 'secret', 1, 'connected', '2026-09-29 09:00:00')`).run(walletId);
  db.prepare("INSERT INTO historical_price_runs (trigger, status, updated_count, unresolved_count, finished_at) VALUES ('automatisch', 'success', 4, 1, '2026-09-29 09:05:00')").run();
  db.prepare("INSERT INTO background_jobs (type, payload_json, status) VALUES ('wallet_sync', '{\"walletId\":1}', 'queued')").run();

  const status = automationStatusResponse();
  assert.equal(status.schedules.length, 2);
  assert.deepEqual(status.schedules[0].lastRun, {
    id: 1,
    status: "success",
    startedAt: status.schedules[0].lastRun.startedAt,
    finishedAt: "2026-09-29 09:05:00",
    updatedCount: 4,
    unresolvedCount: 1,
    errorMessage: null,
  });
  assert.equal(status.schedules[1].status, "waiting");
  assert.deepEqual(status.schedules[1].connections.map((connection) => connection.label), ["BSDEX Test"]);
  assert.equal(status.queue.queued, 1);
  assert.deepEqual(status.queue.recent[0], {
    id: 1,
    label: "Wallet synchronisieren",
    status: "queued",
    progressCurrent: 0,
    progressTotal: 0,
    errorMessage: null,
    createdAt: status.queue.recent[0].createdAt,
    startedAt: null,
    finishedAt: null,
  });
  assert.equal(Object.hasOwn(status.queue.recent[0], "payload"), false);

  db.prepare("UPDATE background_jobs SET error_message = ? WHERE id = 1")
    .run("secret: nicht-zeigen https://example.test/private");
  const protectedStatus = automationStatusResponse();
  assert.equal(protectedStatus.queue.recent[0].errorMessage.includes("nicht-zeigen"), false);
  assert.equal(protectedStatus.queue.recent[0].errorMessage.includes("https://"), false);
});
