const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateTaxReport } = require("../lib/tax-report");

test("bildet FIFO-Verkaufssegmente und Staking-Einkünfte mit Datenqualitätsmarkierung", () => {
  const report = calculateTaxReport([
    { asset: "BTC", timestamp: "2024-01-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 20000 },
    { asset: "BTC", timestamp: "2025-02-01T00:00:00Z", direction: "out", purpose: "Verkauf", amount: 0.4, price_transaction_eur: 30000 },
    { asset: "XTZ", timestamp: "2025-03-01T00:00:00Z", direction: "in", purpose: "Staking Rewards", amount: 10, price_transaction_eur: 1.2 },
    { asset: "BTC", timestamp: "2025-04-01T00:00:00Z", direction: "out", purpose: "Verkauf", amount: 0.1, price_transaction_eur: null },
  ], 2025);

  assert.equal(report.summary.realizedProfitEur, 4000);
  assert.equal(report.summary.incomeEur, 12);
  assert.equal(report.summary.incompleteSaleSegments, 1);
  assert.equal(report.summary.incompleteIncomeEntries, 0);
});

test("berücksichtigt bewertbare Gebühren, Haltedauer und weitere Ertragsarten", () => {
  const report = calculateTaxReport([
    { asset: "ETH", timestamp: "2024-01-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 2, price_transaction_eur: 1000 },
    { asset: "ETH", timestamp: "2025-01-10T00:00:00Z", direction: "out", purpose: "Verkauf", amount: 1, price_transaction_eur: 2000, fee: 0.01, fee_asset: "ETH" },
    { asset: "ADA", timestamp: "2025-02-01T00:00:00Z", direction: "in", purpose: "Airdrop", amount: 5, price_transaction_eur: 0.5 },
    { asset: "SOL", timestamp: "2025-03-01T00:00:00Z", direction: "in", purpose: "Lending-Ertrag", amount: 1, price_transaction_eur: 120 },
  ], 2025);

  assert.equal(report.sales[0].holdingDays, 375);
  assert.equal(report.sales[0].feeEur, 20);
  assert.equal(report.sales[0].profitEur, 980);
  assert.equal(report.summary.feeEur, 20);
  assert.equal(report.summary.incomeEntries, 2);
  assert.equal(report.summary.incomeEur, 122.5);
});

test("berechnet eine klar als Schätzung gekennzeichnete Steuerbasis mit persönlichem Satz", () => {
  const report = calculateTaxReport([
    { asset: "BTC", timestamp: "2024-06-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 10000 },
    { asset: "BTC", timestamp: "2025-01-01T00:00:00Z", direction: "out", purpose: "Verkauf", amount: 1, price_transaction_eur: 16000 },
    { asset: "XTZ", timestamp: "2025-02-01T00:00:00Z", direction: "in", purpose: "Staking Rewards", amount: 10, price_transaction_eur: 1 },
  ], 2025, { personalTaxRatePercent: 30 });

  assert.equal(report.summary.taxableEstimateBaseEur, 6010);
  assert.equal(report.summary.estimatedTaxEur, 1803);
  assert.equal(report.summary.personalTaxRatePercent, 30);
});

test("wendet ein anpassbares Steuerprofil mit Haltefrist, Freigrenze und getrennten Sätzen an", () => {
  const report = calculateTaxReport([
    { id: 1, asset: "BTC", timestamp: "2024-01-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 10000 },
    { id: 2, asset: "BTC", timestamp: "2025-01-02T00:00:00Z", direction: "out", purpose: "Verkauf", amount: 0.5, price_transaction_eur: 20000 },
    { id: 3, asset: "ETH", timestamp: "2025-02-01T00:00:00Z", direction: "in", purpose: "Staking Rewards", amount: 1, price_transaction_eur: 1000 },
    { id: 4, asset: "SOL", timestamp: "2024-12-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 100 },
    { id: 5, asset: "SOL", timestamp: "2025-01-01T00:00:00Z", direction: "out", purpose: "Verkauf", amount: 1, price_transaction_eur: 500 },
  ], 2025, { taxProfile: {
    id: "CUSTOM", countryCode: "XX", label: "Eigene Regel", holdingPeriodEnabled: true, holdingPeriodDays: 365,
    exemptionThresholdEnabled: true, exemptionThresholdEur: 500, lossOffsetEnabled: true,
    disposalTaxEnabled: true, disposalTaxRatePercent: 25, incomeTaxEnabled: true, incomeTaxRatePercent: 30,
  } });

  assert.equal(report.sales.find((sale) => sale.asset === "BTC").holdingPeriodMet, true);
  assert.equal(report.summary.taxableSaleProfitBeforeThresholdEur, 400);
  assert.equal(report.summary.exemptionApplied, true);
  assert.equal(report.summary.taxableSaleProfitEur, 0);
  assert.equal(report.summary.estimatedIncomeTaxEur, 300);
  assert.equal(report.summary.estimatedTaxEur, 300);
});
