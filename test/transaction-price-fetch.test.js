const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { setTimeout: pause } = require("node:timers/promises");
const test = require("node:test");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cryptobuch-transaction-price-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = directory;
const { app, db, updateSettings, backfillHistoricalPrices, historicalPricePipelineResponse } = require("../server");
const contract = "0x" + "a".repeat(40);
let server, origin, quote, requests;

test.before(async () => {
  updateSettings({ coinGeckoBaseUrl: "https://prices.example.test/api/v3" });
  db.exec("INSERT INTO wallets (id, chain, address) VALUES (1, 'ETH', 'public-fixture'), (2, 'ETH', 'second-fixture');");
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  test.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).startsWith(origin + "/")) return originalFetch(url, options);
    requests.push(String(url));
    assert.equal(new URL(url).hostname, "prices.example.test", "No real provider requests allowed");
    return quote(url);
  });
});
test.beforeEach(() => {
  db.exec("DELETE FROM transactions; DELETE FROM background_jobs; DELETE FROM price_history; DELETE FROM price_provider_cooldowns; DELETE FROM price_asset_mappings;");
  requests = [];
  quote = () => Response.json({ prices: [[Date.parse("2025-01-01T00:00:00Z"), 48000]] });
});
test.afterEach(() => {
  assert.ok(requests.every((url) => new URL(url).hostname === "prices.example.test"));
});
test.after(async () => {
  server.close();
  await once(server, "close");
  await new Promise(setImmediate);
  test.mock.restoreAll();
  db.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(directory, { recursive: true, force: true });
});

function booking(id, { price = null, source = "auto", asset = "BTC", token = null, type = "native", timestamp = "2025-01-01T12:00:00Z", walletId = 1 } = {}) {
  db.prepare(`INSERT INTO transactions (id, wallet_id, external_id, hash, timestamp, direction, asset, asset_contract, asset_type,
    amount, raw_json, price_transaction_eur, price_source, purpose, purpose_origin)
    VALUES (?, ?, ?, ?, ?, 'in', ?, ?, ?, 1, '{}', ?, ?, 'Kauf', 'manual')`)
    .run(id, walletId, `fixture-${id}`, `fixture-${id}`, timestamp, asset, token, type, price, source);
}
async function api(route, { method = "GET", body, status = 200 } = {}) {
  const response = await fetch(origin + route, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}
const enqueue = (id, status = 202) => api(`/api/transactions/${id}/historical-price/fetch`, { method: "POST", status });
async function finish(id) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const job = await api(`/api/jobs/${id}`);
    if (!['queued', 'running'].includes(job.status)) {
      assert.equal(job.status, "success", job.error_message);
      return job.result;
    }
    await pause(20);
  }
  assert.fail("Price job did not finish");
}

test("ruft nur den gewählten historischen Kurs neu ab, trotz Cache und Retry-Wartezeit", async () => {
  booking(1, { price: 42000 });
  booking(2);
  db.exec(`INSERT INTO price_history (coin_id, price_date, price_eur) VALUES ('bitcoin', '2025-01-01', 42000);
    INSERT INTO historical_price_retries (transaction_id, attempt_count, last_attempt_at, next_attempt_at) VALUES (1, 3, '2025-01-01', '2100-01-01');`);
  const receipt = await enqueue(1);
  assert.equal(receipt.transactionId, 1);
  assert.equal(receipt.reused, false);
  const result = await finish(receipt.job.id);
  assert.equal(result.transactionId, 1);
  assert.equal(result.outcome, "updated");
  assert.equal(result.updated, 1);
  assert.equal(requests.length, 1);
  const transaction = (await api(receipt.links.transaction)).data;
  assert.equal(transaction.price_transaction_eur, 48000);
  assert.equal(transaction.price_source, "auto");
  assert.equal(transaction.price_provider, "coingecko");
  assert.ok(transaction.price_recorded_at);
  assert.equal(transaction.purpose, "Kauf");
  assert.equal(transaction.purpose_origin, "manual");
  assert.equal(db.prepare("SELECT price_transaction_eur FROM transactions WHERE id = 2").get().price_transaction_eur, null);
  assert.equal((await api(receipt.links.priceAudit)).data.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM historical_price_retries WHERE transaction_id = 1").get().n, 0);
  const job = (await api(`/api/v1/jobs/${receipt.job.id}`)).data;
  assert.equal(job.transaction_id, 1);
  assert.equal(job.links.transaction_id, "/api/v1/transactions/1");
});

test("lehnt geschützte Kurse, ungültige IDs, fehlende Daten und nicht unterstützte Assets ab", async () => {
  booking(1, { price: 123, source: "manual" });
  booking(2, { timestamp: null });
  booking(3, { type: "nft" });
  booking(4, { asset: "UNKNOWN" });
  booking(5, { timestamp: "kein Datum" });
  for (const id of [0, -1, 'abc', '1.5', '9007199254740992']) await enqueue(id, 400);
  await enqueue(999, 404);
  await enqueue(1, 409);
  for (const id of [2, 3, 4, 5]) await enqueue(id, 422);
  assert.equal(requests.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM background_jobs").get().n, 0);
  assert.equal(db.prepare("SELECT price_transaction_eur FROM transactions WHERE id = 1").get().price_transaction_eur, 123);
});

test("fasst doppelte Anfragen zusammen und führt unterschiedliche Buchungen seriell aus", async () => {
  booking(1); booking(2);
  let release;
  let started;
  const hasStarted = new Promise((resolve) => { started = resolve; });
  quote = () => {
    started();
    return new Promise((resolve) => { release = () => resolve(Response.json({ prices: [[Date.parse('2025-01-01'), 48000]] })); });
  };
  const first = await enqueue(1);
  await hasStarted;
  try {
    const duplicate = await enqueue(1);
    assert.equal(duplicate.job.id, first.job.id);
    assert.equal(duplicate.reused, true);
    const second = await enqueue(2);
    await pause(50);
    assert.equal((await api(`/api/jobs/${second.job.id}`)).status, "queued");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM background_jobs WHERE status = 'running'").get().n, 1);
    // A manual edit while the provider request is pending must win.
    await api('/api/transactions/1/historical-price', { method: 'PATCH', body: { priceTransactionEur: 99 } });
    quote = () => Response.json({ prices: [[Date.parse('2025-01-01'), 48000]] });
    release();
    assert.equal((await finish(first.job.id)).outcome, "skipped");
    assert.equal((await finish(second.job.id)).outcome, "updated");
    assert.equal(db.prepare("SELECT price_transaction_eur FROM transactions WHERE id = 1").get().price_transaction_eur, 99);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transaction_price_audit WHERE transaction_id = 1 AND source = 'auto'").get().n, 0);
  } finally { release?.(); }
});

test("fehlende Token-Kurse überschreiben keinen vorhandenen Wert und bleiben bei fehlenden Werten offen", async () => {
  booking(1, { price: 7, asset: `ETH:${contract}`, token: contract, type: "erc20" });
  booking(2, { asset: `ETH:${contract}`, token: contract, type: "erc20" });
  db.prepare("INSERT INTO price_history (coin_id, price_date, price_eur) VALUES (?, '2025-01-01', 7)").run(`erc20:ethereum:${contract}`);
  quote = () => Response.json({ prices: [] });
  for (const id of [1, 2]) assert.equal((await finish((await enqueue(id)).job.id)).outcome, "unavailable");
  assert.equal(db.prepare("SELECT price_transaction_eur FROM transactions WHERE id = 1").get().price_transaction_eur, 7);
  assert.equal(db.prepare("SELECT price_transaction_eur FROM transactions WHERE id = 2").get().price_transaction_eur, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transaction_price_audit").get().n, 0);
  assert.equal(db.prepare("SELECT transaction_id FROM historical_price_retries").get().transaction_id, 2);
  assert.ok(requests.every((url) => url.includes(`/contract/${contract}/market_chart/range?vs_currency=eur&from=`)));
});

test("dokumentiert den Kursabruf einschließlich Status und Abhängigkeiten", async () => {
  const spec = await api('/api/openapi.json');
  const route = spec.paths['/api/transactions/{id}/historical-price/fetch'].post;
  assert.ok(route.responses['202']);
  assert.match(route.description, /updated, unavailable oder skipped/);
});

test('unbekannte Coins pausieren ohne künstliche Versuche; bestätigte ID gilt nur für die gewählte Quelle', async () => {
  booking(1, { asset: 'IOST' }); booking(2, { asset: 'IOST', walletId: 2 });
  const empty = await backfillHistoricalPrices({ force: true });
  assert.equal(empty.attempted, 0);
  assert.equal(empty.blocked, 2);
  assert.equal(requests.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM historical_price_retries').get().n, 0);
  assert.equal(historicalPricePipelineResponse().pipeline.blocked, 2);
  assert.equal(historicalPricePipelineResponse().pipeline.status, 'blocked');
  assert.equal(historicalPricePipelineResponse().pipeline.due, 0);
  const body = { walletId: 1, asset: 'IOST', coinGeckoId: 'iost', confirmed: true };
  await api('/api/price-asset-mappings', { method: 'PUT', body: { ...body, confirmed: false }, status: 400 });
  const saved = await api('/api/price-asset-mappings', { method: 'PUT', body, status: 202 });
  assert.equal((await finish(saved.job.id)).updated, 1);
  assert.equal(db.prepare('SELECT price_transaction_eur FROM transactions WHERE id=2').get().price_transaction_eur, null);
  assert.ok(requests[0].includes('/coins/iost/market_chart/range?'));
});

test('CSV-Nachtrag plant sofort einen Kursjob ein und übernimmt einen gemeinsamen Cache-Kurs für alle offenen Buchungen', async () => {
  db.exec("INSERT INTO price_history (coin_id, price_date, price_eur, source, price_method, price_observed_at) VALUES ('bitcoin', '2025-01-01', 42, 'bitvavo', 'daily_close', '2025-01-01T23:59:59.999Z')");
  const result = await api('/api/import/csv', { method: 'POST', status: 201,
    body: { walletId: 1, profile: 'generic', csv: 'timestamp,direction,asset,amount,price_eur\n2025-01-01T12:00:00Z,in,BTC,1,\n2025-01-01T13:00:00Z,in,BTC,2,\n2025-01-01T14:00:00Z,in,BTC,3,99' } });
  assert.ok(result.priceJob.id);
  assert.equal((await finish(result.priceJob.id)).updated, 2);
  assert.equal(requests.length, 0);
  const prices = db.prepare('SELECT price_transaction_eur, price_source, price_method FROM transactions ORDER BY id').all();
  assert.deepEqual(prices.map(row => row.price_transaction_eur), [42, 42, 99]);
  assert.equal(prices[0].price_method, 'daily_close');
  assert.equal(prices[2].price_source, 'manual');
});

test('Automatik plant einen gezielten Abruf; fehlendes Feld löscht keinen geschützten Wert', async () => {
  booking(1, { price: 99, source: 'manual' });
  await api('/api/transactions/1/historical-price', { method: 'PATCH', body: {}, status: 400 });
  assert.equal(db.prepare('SELECT price_transaction_eur FROM transactions WHERE id=1').get().price_transaction_eur, 99);
  const result = await api('/api/transactions/1/historical-price', { method: 'PATCH', body: { priceTransactionEur: null } });
  assert.equal((await finish(result.priceJob.id)).updated, 1);
});

test('Token-Chart speichert Messzeitpunkt; Rate-Limits pausieren weitere Anfragen auch bei Einzelabrufen', async () => {
  booking(1, { asset: `ETH:${contract}`, token: contract, type: 'erc20' });
  const result = await finish((await enqueue(1)).job.id);
  assert.equal(result.updated, 1);
  const tx = (await api('/api/v1/transactions/1')).data;
  assert.equal(tx.price_method, 'daily_reference');
  assert.equal(tx.price_observed_at, '2025-01-01T00:00:00.000Z');
  quote = () => Response.json({}, { status: 429, headers: { 'Retry-After': '120' } });
  assert.equal((await finish((await enqueue(1)).job.id)).outcome, 'unavailable');
  const requestsBefore = requests.length;
  assert.equal((await finish((await enqueue(1)).job.id)).outcome, 'unavailable');
  assert.equal(requests.length, requestsBefore);
  assert.ok(Date.parse(db.prepare('SELECT retry_at FROM price_provider_cooldowns').get().retry_at) > Date.now() + 100000);
  assert.equal(db.prepare('SELECT price_transaction_eur FROM transactions WHERE id=1').get().price_transaction_eur, 48000);
});

test('entfernte PSBT-Route lehnt auch ungültiges JSON vor dem Parsen ab', async () => {
  const response = await fetch(origin + '/api/bitcoin/psbt-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(response.status, 410);
  assert.equal((await api('/api/openapi.json')).paths['/api/bitcoin/psbt-preview'], undefined);
});

test('führt fällige Folge-Batches seriell weiter und zählt gemeinsame Asset-Tage', async () => {
  updateSettings({ historicalPriceBackfillBatchSize: 1 });
  try {
    booking(1); booking(2); booking(3, { timestamp: '2025-01-02T12:00:00Z' });
    booking(4, { asset: 'UNKNOWN' });
    quote = (url) => Response.json({ prices: [[Number(new URL(url).searchParams.get('from')) * 1000, 42]] });
    const receipt = await api('/api/jobs/price-backfill', { method: 'POST', body: { force: false }, status: 202 });
    const first = await finish(receipt.job.id);
    assert.equal(first.updated, 2);
    assert.equal(first.groups, 1);
    assert.equal(first.hasMore, true);
    for (let attempt = 0; attempt < 300; attempt++) {
      const active = db.prepare("SELECT * FROM background_jobs WHERE status IN ('queued','running') ORDER BY id DESC LIMIT 1").get();
      if (!active) break;
      await finish(active.id);
    }
    assert.equal(requests.length, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE price_transaction_eur=42').get().n, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM historical_price_retries WHERE transaction_id=4').get().n, 0);
  } finally { updateSettings({ historicalPriceBackfillBatchSize: 60 }); }
});
