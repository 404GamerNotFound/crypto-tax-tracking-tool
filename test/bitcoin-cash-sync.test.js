const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { setTimeout: pause } = require("node:timers/promises");
const test = require("node:test");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cryptobuch-bch-sync-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dataDir;
const { app, db } = require("../server");
const walletAddress = "qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a";
const fundingHash = "a".repeat(64);
const spendingHash = "b".repeat(64);
const parentHash = "c".repeat(64);
const indexer = "https://bch.fixture.invalid/v6";
const details = {
  [parentHash]: { txid: parentHash, details: {
    txid: parentHash, vout: [{ n: 0, value: 2, scriptPubKey: { addresses: ["bitcoincash:qsender"] } }],
  } },
  [fundingHash]: { txid: fundingHash, details: {
    txid: fundingHash, blocktime: 1700000000, vin: [{ txid: parentHash, vout: 0 }],
    vout: [
      { n: 0, value: 1, scriptPubKey: { addresses: [`bitcoincash:${walletAddress}`] } },
      { n: 1, value: 0.99999, scriptPubKey: { addresses: ["bitcoincash:qsender"] } },
    ],
  } },
  [spendingHash]: { txid: spendingHash, details: {
    txid: spendingHash, blocktime: 1700000060, vin: [{ txid: fundingHash, vout: 0 }],
    vout: [
      { n: 0, value: 0.25, scriptPubKey: { addresses: ["bitcoincash:qrecipient"] } },
      { n: 1, value: 0.74999, scriptPubKey: { addresses: [`bitcoincash:${walletAddress}`] } },
    ],
  } },
};
let server;
let origin;
let history;
let requests;
let unexpectedRequests;

test.before(async () => {
  db.prepare("INSERT INTO wallets (id, chain, address) VALUES (1, 'BCH', ?)").run(walletAddress);
  db.prepare("UPDATE app_settings SET setting_value = ? WHERE setting_key = 'bitcoinCashApiBaseUrl'").run(indexer);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  test.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const address = String(url);
    if (new URL(address).origin === origin) return originalFetch(url, options);
    requests.push({ url: address, method: options.method || "GET", body: options.body });
    if (address === `${indexer}/fulcrum/transactions/${encodeURIComponent(`bitcoincash:${walletAddress}`)}?allTxs=true`) {
      return Response.json({ success: true, transactions: history });
    }
    if (address === `${indexer}/fulcrum/tx/data` && options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.verbose, true);
      assert.ok(body.txids.every((hash) => Object.hasOwn(details, hash)));
      return Response.json({ success: true, transactions: body.txids.map((hash) => details[hash]) });
    }
    unexpectedRequests.push(address);
    throw new Error("Unexpected external request in BCH regression test");
  });
});

test.beforeEach(() => {
  db.exec("DELETE FROM transactions; DELETE FROM background_jobs; DELETE FROM sync_events; DELETE FROM price_history;");
  db.exec("UPDATE wallets SET last_synced_at = NULL;");
  db.prepare("INSERT INTO price_history (coin_id, price_date, price_eur, source) VALUES ('bitcoin-cash', '2023-11-14', 220, 'fixture')").run();
  history = [{ tx_hash: fundingHash }, { tx_hash: spendingHash }];
  requests = [];
  unexpectedRequests = [];
});

test.afterEach(() => {
  assert.deepEqual(unexpectedRequests, [], "Tests must not contact real indexers or price providers");
});

test.after(async () => {
  if (server) { server.close(); await once(server, "close"); }
  // Let the serial worker observe its empty queue before closing the test database.
  await new Promise(setImmediate);
  test.mock.restoreAll();
  db.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function request(route, method = "GET", body, expectedStatus = 200) {
  const response = await fetch(`${origin}${route}`, {
    method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(payload));
  return payload;
}

async function syncThroughJob() {
  const { jobs } = await request("/api/jobs/sync", "POST", { walletIds: [1] }, 202);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const job = await request(`/api/jobs/${jobs[0].id}`);
    if (["success", "error"].includes(job.status)) {
      assert.equal(job.status, "success", job.error_message || "Wallet job must complete successfully");
      return job.result;
    }
    await pause(10);
  }
  assert.fail("BCH synchronization job did not finish");
}

test("speichert BCH-Eingänge, Ausgänge und Gebühren über den vollständigen Wallet-Job", { timeout: 10000 }, async () => {
  assert.equal((await syncThroughJob()).imported, 2);
  const rows = db.prepare("SELECT * FROM transactions ORDER BY external_id").all();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.wallet_id, row.external_id, row.hash, row.direction, row.amount, row.fee, row.counterparty]), [
    [1, fundingHash, fundingHash, "in", 1, 0, "bitcoincash:qsender"],
    [1, spendingHash, spendingHash, "out", 0.25001, 0.00001, "bitcoincash:qrecipient"],
  ]);
  for (const row of rows) {
    assert.equal(row.asset, "BCH");
    assert.equal(row.asset_symbol, "BCH");
    assert.equal(row.asset_name, "BCH");
    assert.equal(row.asset_decimals, 8);
    assert.equal(row.asset_contract, null);
    assert.equal(row.asset_type, "native");
    assert.equal(row.fee_asset, "BCH");
    assert.equal(row.price_transaction_eur, 220);
    assert.equal(row.price_source, "auto");
    assert.equal(row.price_provider, "fixture");
    assert.ok(row.price_recorded_at);
    assert.equal(row.purpose, null);
    assert.equal(row.purpose_origin, "unspecified");
    assert.equal(JSON.parse(row.raw_json).transaction.hash, row.hash);
    assert.ok(row.updated_at);
  }
  assert.equal(rows[0].timestamp, "2023-11-14T22:13:20.000Z");
  assert.equal(rows[1].timestamp, "2023-11-14T22:14:20.000Z");
  assert.ok(db.prepare("SELECT last_synced_at FROM wallets WHERE id = 1").get().last_synced_at);
  assert.equal(db.prepare("SELECT status FROM sync_events WHERE wallet_id = 1").get().status, "success");
  assert.deepEqual(requests.filter((entry) => entry.method === "POST").map((entry) => JSON.parse(entry.body).txids), [
    [fundingHash, spendingHash], [parentHash],
  ]);
});

test("erneuter BCH-Sync erzeugt keine Dubletten und erhält manuelle Kurse und Zwecke", { timeout: 10000 }, async () => {
  await syncThroughJob();
  const transaction = db.prepare("SELECT id FROM transactions WHERE external_id = ?").get(spendingHash);
  await request(`/api/transactions/${transaction.id}`, "PATCH", { purpose: "Transfer" });
  const price = await request(`/api/transactions/${transaction.id}/historical-price`, "PATCH", { priceTransactionEur: 321.45 });
  db.exec("UPDATE price_history SET price_eur = 999;");
  const result = await request("/api/wallets/1/sync", "POST", {});
  assert.equal(result.imported, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 2);
  const refreshed = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transaction.id);
  assert.equal(refreshed.price_transaction_eur, 321.45);
  assert.equal(refreshed.price_source, "manual");
  assert.equal(refreshed.price_provider, "manual");
  assert.equal(refreshed.price_recorded_at, price.price_recorded_at);
  assert.equal(refreshed.purpose, "Transfer");
  assert.equal(refreshed.purpose_origin, "manual");
  assert.equal(refreshed.amount, 0.25001);
  assert.equal(refreshed.fee, 0.00001);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transaction_price_audit WHERE transaction_id = ?").get(transaction.id).count, 1);
});

test("leere BCH-Historie schließt den Sync ohne erfundene Buchungen ab", { timeout: 10000 }, async () => {
  history = [];
  assert.equal((await syncThroughJob()).imported, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 0);
  assert.ok(db.prepare("SELECT last_synced_at FROM wallets WHERE id = 1").get().last_synced_at);
  assert.equal(requests.length, 1);
});
