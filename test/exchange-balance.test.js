const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cryptobuch-exchange-balance-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dataDir;
const { db, exchangePosition, replaceExchangeBalanceSnapshot } = require("../server");

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
