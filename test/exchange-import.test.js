const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeExchangeRows } = require("../lib/exchange-import");

test("liest die Standard-CSV mit Semikolon und bewahrt eigene Spalten", () => {
  const { profile, rows } = normalizeExchangeRows("timestamp;direction;asset;amount;price_eur\n2025-01-01T12:00:00Z;in;BTC;0,25;42000\n", "generic");
  assert.equal(profile.id, "generic");
  assert.equal(rows[0].asset, "BTC");
  assert.equal(rows[0].amount, "0,25");
});

test("normalisiert Coinbase-Käufe und Binance-Abgänge in ein gemeinsames Format", () => {
  const coinbase = normalizeExchangeRows("Timestamp,Transaction Type,Asset ID,Quantity Transacted,Spot Price at Transaction,Transaction ID\n2025-01-01T12:00:00Z,Buy,BTC,0.1,42000,cb-1\n", "coinbase").rows[0];
  const binance = normalizeExchangeRows("Date(UTC),Operation,Coin,Change,Transaction ID\n2025-01-02 12:00:00,Withdraw,BTC,-0.2,bn-1\n", "binance").rows[0];
  assert.deepEqual({ direction: coinbase.direction, asset: coinbase.asset, amount: coinbase.amount, purpose: coinbase.purpose }, { direction: "in", asset: "BTC", amount: 0.1, purpose: "Kauf" });
  assert.deepEqual({ direction: binance.direction, asset: binance.asset, amount: binance.amount, purpose: binance.purpose }, { direction: "out", asset: "BTC", amount: 0.2, purpose: "Transfer" });
});

test("ordnet Binance-Earn, Gebühren und Convert-Zeilen nachvollziehbar zu", () => {
  const rows = normalizeExchangeRows("Date(UTC),Operation,Coin,Change,Transaction ID\n2025-01-02 12:00:00,Simple Earn Flexible Rewards,ADA,2.4,r-1\n2025-01-02 12:01:00,Transaction Fee,BNB,-0.01,f-1\n2025-01-02 12:02:00,Binance Convert,ETH,-0.5,c-1\n", "binance").rows;
  assert.deepEqual(rows.map((row) => [row.direction, row.purpose, row.external_id]), [
    ["in", "Staking Rewards", "r-1:simple earn flexible rewards:ADA"],
    ["out", "Gebühr", "f-1:transaction fee:BNB"],
    ["out", "DeFi Swap", "c-1:binance convert:ETH"],
  ]);
});
