const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateAssetAnalytics } = require("../lib/portfolio-analytics");

test("weist einen teilweisen Kaufgewinn aus, wenn nur einzelne verbleibende Kaufchargen keinen Kurs haben", () => {
  const analytics = calculateAssetAnalytics([
    { asset: "BTC", timestamp: "2023-01-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 20000 },
    { asset: "BTC", timestamp: "2023-02-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 0.5, price_transaction_eur: null },
  ], { BTC: 30000 }, { BTC: 1.5 }, { BTC: { id: "BTC" } });

  const purchases = analytics.BTC.purchases;
  assert.equal(purchases.hasUnknownCost, true);
  assert.equal(purchases.profitIsPartial, true);
  assert.equal(purchases.knownRemainingAmount, 1);
  assert.equal(purchases.unknownRemainingAmount, 0.5);
  assert.equal(purchases.profitEur, 10000);
});

test("weist keinen Kaufgewinn aus, wenn keine verbleibende Kaufcharge einen Kurs hat", () => {
  const analytics = calculateAssetAnalytics([
    { asset: "BTC", timestamp: "2023-01-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: null },
  ], { BTC: 30000 }, { BTC: 1 }, { BTC: { id: "BTC" } });

  assert.equal(analytics.BTC.purchases.profitEur, null);
  assert.equal(analytics.BTC.purchases.profitIsPartial, false);
});
