const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const test = require("node:test");
const { RESOURCES, parseQuery } = require("../lib/app-api");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cryptobuch-app-api-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dataDir;
const { app, db } = require("../server");
let server;
let origin;

test.before(async () => {
  db.exec(`
    INSERT INTO wallets (id, chain, address, label) VALUES (1, 'BTC', 'public-test-address', 'Wallet');
    INSERT INTO wallets (id, chain, address, label, source_type) VALUES (2, 'EXCHANGE', 'exchange:binance:test', 'Börse', 'exchange');
    INSERT INTO wallet_metadata (wallet_id, group_name, tags) VALUES (1, 'Privat', '["Langfristig"]');
    INSERT INTO wallet_addresses (wallet_id, address, branch, derivation_index) VALUES (1, 'derived-public-address', 0, 0);
    INSERT INTO transactions (id, wallet_id, external_id, hash, direction, asset, amount, raw_json, price_source, price_transaction_eur, purpose, purpose_origin)
      VALUES (1, 1, 'first', 'hash1', 'in', 'BTC', 1, '{"privateProviderPayload":"never-expose"}', 'manual', 42000, 'Kauf', 'manual');
    INSERT INTO transactions (id, wallet_id, external_id, hash, direction, asset, amount, raw_json)
      VALUES (2, 2, 'second', 'hash2', 'out', 'BTC', 1, '{}');
    INSERT INTO exchange_connections (id, wallet_id, provider, api_key, api_secret, trade_republic_web_session)
      VALUES (1, 2, 'binance', 'credential-canary', 'credential-canary', 'credential-canary');
    INSERT INTO exchange_balance_snapshot_meta (connection_id) VALUES (1);
    INSERT INTO exchange_balance_snapshots (connection_id, asset, free_amount, locked_amount) VALUES (1, 'BTC', 2, 0.5);
    INSERT INTO transfer_links (outgoing_transaction_id, incoming_transaction_id) VALUES (2, 1);
    INSERT INTO transaction_documents (transaction_id, original_name, stored_name, mime_type, byte_size, sha256)
      VALUES (1, 'test.csv', 'hidden-storage-name', 'text/csv', 4, 'checksum');
    INSERT INTO price_history (coin_id, price_date, price_eur) VALUES ('ethereum:token/test', '2026-01-01', 2);
    INSERT INTO transaction_price_audit (transaction_id, price_eur, source) VALUES (1, 42000, 'manual');
    INSERT INTO historical_price_retries (transaction_id, attempt_count, last_attempt_at, next_attempt_at) VALUES (2, 1, '2026-01-01', '2100-01-01');
    INSERT INTO historical_price_runs (id, trigger, status, result_json) VALUES (1, 'manuell', 'success', '{"secret":"never-expose"}');
    INSERT INTO historical_price_fetch_events (run_id, source, asset, status) VALUES (1, 'test', 'BTC', 'success');
    INSERT INTO sync_events (wallet_id, status) VALUES (1, 'success');
    INSERT INTO background_jobs (type, status, payload_json, result_json, error_message)
      VALUES ('wallet_sync', 'success', '{"walletId":1,"secret":"never-expose"}', '{"secret":"never-expose"}', 'secret: credential-canary https://example.test/private');
    INSERT INTO notifications (level, title, message) VALUES ('info', 'Test', 'Hinweis');
    INSERT INTO tax_report_snapshots (year, profile_id, profile_label, report_json, report_checksum) VALUES (2026, 'de', 'Deutschland', '{}', 'checksum');
    UPDATE app_settings SET setting_value = 'credential-canary' WHERE setting_key = 'etherscanApiKey';
  `);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) { server.close(); await once(server, "close"); }
  db.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});
async function get(url, expectedStatus = 200) {
  const response = await fetch(`${origin}${url}`);
  assert.equal(response.status, expectedStatus, url);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}

test("liefert alle Ressourcen vollständig paginiert und navigierbare Einzelobjekte", async () => {
  const discovery = await get("/api/v1");
  assert.deepEqual(Object.keys(discovery.resources).sort(), Object.keys(RESOURCES).sort());
  for (const name of Object.keys(RESOURCES)) {
    const page = await get(`/api/v1/${name}?limit=1`);
    assert.equal(page.data.length, 1, name);
    assert.ok(page.pagination.total > 0, name);
    assert.deepEqual((await get(page.data[0].links.self)).data, page.data[0], name);
    assert.doesNotMatch(JSON.stringify(page), /never-expose|credential-canary|hidden-storage-name|payload_json|result_json|raw_json|api_secret|api_key|coinbase_passphrase|web_session/);
  }
  const first = await get("/api/v1/transactions?limit=1");
  assert.equal(first.data[0].id, 1);
  assert.equal(first.pagination.hasMore, true);
  const second = await get(first.links.next);
  assert.equal(second.data[0].id, 2);
  assert.equal(second.links.next, null);
  assert.equal(second.pagination.hasMore, false);
  assert.equal((await get("/api/v1/transactions?offset=100")).data.length, 0);
});

test("verknüpft Börsenkonten, Transfers, Belege, Audits und Jobs ohne Rohdaten", async () => {
  const wallet = (await get("/api/v1/wallets/1")).data;
  assert.deepEqual(wallet.tags, ["Langfristig"]);
  assert.equal(wallet.group_name, "Privat");
  const transaction = (await get(wallet.links["transactions.wallet_id"])).data[0];
  assert.equal(transaction.wallet_id, 1);
  assert.equal(transaction.price_source, "manual");
  assert.equal(transaction.price_transaction_eur, 42000);
  assert.equal(transaction.purpose_origin, "manual");
  assert.equal((await get(transaction.links["documents.transaction_id"])).data[0].transaction_id, 1);
  assert.equal((await get(transaction.links["price-audit.transaction_id"])).data.length, 1);
  const transfer = (await get(transaction.links["transfers.incoming_transaction_id"])).data[0];
  assert.equal((await get(transfer.links.outgoing_transaction_id)).data.id, 2);
  const exchange = (await get("/api/v1/exchange-connections/1")).data;
  assert.equal((await get(exchange.links.wallet_id)).data.source_type, "exchange");
  assert.equal((await get(exchange.links["exchange-balances.connection_id"])).data[0].locked_amount, 0.5);
  const job = (await get("/api/v1/jobs/1")).data;
  assert.equal(job.wallet_id, 1);
  assert.equal(job.connection_id, null);
  assert.equal((await get(job.links.wallet_id)).data.id, 1);
  assert.doesNotMatch(job.error_message, /credential-canary|https:/);
  assert.equal((await get("/api/v1/transactions/2")).data.price_transaction_eur, null);
});

test("filtert exakt, schützt SQL-Abfragen und verwirft fehlerhafte Parameter", async () => {
  const filtered = await get("/api/v1/transactions?wallet_id=1&asset=BTC&price_source=manual&limit=1");
  assert.equal(filtered.pagination.total, 1);
  assert.equal((await get("/api/v1/transactions?asset=BTC%27%20OR%201%3D1--")).data.length, 0);
  for (const suffix of ["?limit=0", "?limit=501", "?limit=1.5", "?limit=", "?limit=1&limit=2", "?offset=-1", "?offset=9007199254740992", "?wallet_id=abc", "?sort=id", "?raw_json=true"]) {
    assert.ok((await get(`/api/v1/transactions${suffix}`, 400)).error);
  }
  for (const url of ["/api/v1/wallets/0", "/api/v1/wallets/1.5", "/api/v1/wallets/1?include=secrets", "/api/v1/price-history?price_date=2026-02-30"]) await get(url, 400);
  await get("/api/v1/wallets/99999", 404);
  await get("/api/v1/unknown", 404);
  await get("/api/no-such-route", 404);
  const response = await fetch(`${origin}/api/v1/wallets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wallets").get().n, 2);
  assert.deepEqual(parseQuery(RESOURCES.transactions, {}), { limit: 100, offset: 0, filters: [] });
});

test("liefert Referenzdaten und Einstellungen ohne gespeicherte Zugangsschlüssel", async () => {
  const metadata = await get("/api/v1/metadata");
  assert.deepEqual(metadata.chains.BTC.sourceTypes, ["address", "xpub"]);
  assert.deepEqual(metadata.chains.ADA.sourceTypes, ["address", "stake"]);
  assert.ok(metadata.purposePresets.includes("Staking Rewards"));
  assert.ok(metadata.exchangeProviders.some((entry) => entry.id === "binance"));
  assert.ok(metadata.relationships.some((entry) => entry.from === "transactions" && entry.to === "wallets"));
  const settings = await get("/api/v1/settings");
  assert.equal(settings.etherscanApiKeyConfigured, true);
  assert.doesNotMatch(JSON.stringify(settings), /credential-canary/);
  assert.equal(Object.hasOwn(settings, "etherscanApiKey"), false);
});

test("dokumentiert jede registrierte API-Route und löst alle Schema-Verweise auf", async () => {
  const spec = await get("/api/openapi.json");
  const actual = app.router.stack.filter((layer) => layer.route?.path.startsWith("/api/")).flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method} ${layer.route.path.replace(/:([a-zA-Z_]+)/g, "{$1}")}`));
  const documented = Object.entries(spec.paths).flatMap(([route, methods]) => Object.keys(methods).map((method) => `${method} ${route}`));
  assert.deepEqual(documented.sort(), actual.sort());
  const operationIds = Object.values(spec.paths).flatMap((methods) => Object.values(methods).map((operation) => operation.operationId));
  assert.equal(new Set(operationIds).size, operationIds.length);
  assert.equal(spec.openapi, "3.1.0");
  assert.doesNotMatch(JSON.stringify(spec), /credential-canary/);
  for (const match of JSON.stringify(spec).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)) assert.ok(spec.components.schemas[match[1]], match[1]);
  for (const name of Object.keys(RESOURCES)) {
    const item = (await get(`/api/v1/${name}?limit=1`)).data[0];
    for (const field of spec.components.schemas[name].required) assert.ok(Object.hasOwn(item, field), `${name}.${field}`);
  }
  const page = await fetch(`${origin}/api-docs.html`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /api-endpoints/);
});
