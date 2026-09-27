const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateTaxReport } = require("../lib/tax-report");
const { buildTaxOptimizer, simulateSale } = require("../lib/tax-optimizer");

const profile = {
  id: "TEST", countryCode: "XX", label: "Test", holdingPeriodEnabled: false,
  exemptionThresholdEnabled: false, disposalTaxEnabled: true, disposalTaxRatePercent: 25,
  incomeTaxEnabled: false, costBasisMethod: "LIFO",
};

test("berücksichtigt LIFO für offene Lots und Verkaufssimulation", () => {
  const report = calculateTaxReport([
    { id: 1, asset: "BTC", timestamp: "2024-01-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 10000 },
    { id: 2, asset: "BTC", timestamp: "2024-02-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 20000 },
  ], 2025, { taxProfile: profile });
  assert.equal(report.openLots[0].costPerAsset, 20000);
  const result = simulateSale(report, { asset: "BTC", amount: 0.5, priceEur: 30000 });
  assert.equal(result.complete, true);
  assert.equal(result.profitEur, 5000);
  assert.equal(result.estimatedTaxEur, 1250);
});

test("zeigt verlustträchtige offene Lots nur als Prüfhinweis", () => {
  const recent = new Date(Date.now() - 7 * 86400000).toISOString();
  const report = calculateTaxReport([
    { id: 1, asset: "ETH", timestamp: recent, direction: "in", purpose: "Kauf", amount: 2, price_transaction_eur: 3000 },
  ], 2025, { taxProfile: { ...profile, holdingPeriodEnabled: true, holdingPeriodDays: 365 } });
  const optimizer = buildTaxOptimizer(report, { ETH: 2000 });
  assert.equal(optimizer.holdingCalendar.length, 1);
  assert.equal(optimizer.lossHarvesting[0].potentialLossEur, -2000);
});
