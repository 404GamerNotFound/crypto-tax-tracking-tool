const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBookValueHistory } = require("../lib/portfolio-history");

test("bildet historische Kapitalflüsse ohne Transfers als Buchwertverlauf ab", () => {
  const history = buildBookValueHistory([
    { id: 3, timestamp: "2025-01-03T12:00:00Z", direction: "out", purpose: "Verkauf", amount: 1, price_transaction_eur: 130 },
    { id: 1, timestamp: "2025-01-01T12:00:00Z", direction: "in", purpose: "Kauf", amount: 2, price_transaction_eur: 100 },
    { id: 2, timestamp: "2025-01-02T12:00:00Z", direction: "in", purpose: "Transfer", amount: 3, price_transaction_eur: 100 },
    { id: 4, timestamp: "2025-01-02T16:00:00Z", direction: "in", purpose: "Staking Rewards", amount: 0.5, price_transaction_eur: 50 },
  ]);
  assert.deepEqual(history, [
    { day: "2025-01-01", valueEur: 200 },
    { day: "2025-01-02", valueEur: 225 },
    { day: "2025-01-03", valueEur: 95 },
  ]);
});
