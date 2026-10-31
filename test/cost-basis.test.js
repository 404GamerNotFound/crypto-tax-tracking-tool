const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateTaxReport } = require("../lib/tax-report");
const { calculateAssetAnalytics } = require("../lib/portfolio-analytics");
const { runCostBasis } = require("../lib/cost-basis");
const { networkFeeRows } = require("../lib/network-fees");
const { holdingPeriodRule, isHoldingPeriodMet } = require("../lib/holding-period");
const { germanyProfile } = require("../lib/tax-profile");

const DE = germanyProfile(0);

test("Haltefrist DE: steuerfrei erst ab dem Tag nach dem Jahrestag", () => {
  const bought = "2024-01-15T10:00:00Z";
  assert.equal(isHoldingPeriodMet(bought, "2025-01-14T10:00:00Z", DE), false);
  assert.equal(isHoldingPeriodMet(bought, "2025-01-15T22:00:00Z", DE), false, "Jahrestag selbst ist noch innerhalb der Frist");
  assert.equal(isHoldingPeriodMet(bought, "2025-01-16T00:30:00+01:00", DE), true);
  assert.equal(holdingPeriodRule(bought, DE).eligibleDate, "2025-01-16");
});

test("Haltefrist DE: Kalendertag in Europe/Berlin und Schaltjahr", () => {
  // 23:30 UTC am 14.01. ist in Berlin bereits der 15.01.
  assert.equal(holdingPeriodRule("2024-01-14T23:30:00Z", DE).eligibleDate, "2025-01-16");
  // 29.02. ohne Entsprechung: Frist endet am 28.02., frei ab 01.03.
  assert.equal(holdingPeriodRule("2024-02-29T12:00:00Z", DE).eligibleDate, "2025-03-01");
  assert.equal(new Date(holdingPeriodRule("2024-02-29T12:00:00Z", DE).eligibleAtMs).toISOString(), "2025-02-28T23:00:00.000Z");
  // Frei angelegte Tagesfristen bleiben Tagesfristen.
  const custom = { holdingPeriodEnabled: true, holdingPeriodDays: 180 };
  assert.equal(isHoldingPeriodMet("2025-01-01T00:00:00Z", "2025-06-30T00:00:00Z", custom), true);
  assert.equal(isHoldingPeriodMet("2025-01-01T00:00:00Z", "2025-06-29T23:59:59Z", custom), false);
});

test("Steuerreport markiert einen Verkauf am Jahrestag als steuerpflichtig", () => {
  const report = calculateTaxReport([
    { id: 1, asset: "BTC", timestamp: "2024-01-15T10:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 10000 },
    { id: 2, asset: "BTC", timestamp: "2025-01-15T10:00:00Z", direction: "out", purpose: "Verkauf", amount: 1, price_transaction_eur: 12000 },
  ], 2025);
  assert.equal(report.sales[0].holdingDays, 366);
  assert.equal(report.sales[0].holdingPeriodMet, false);
  assert.equal(report.summary.taxableSaleProfitBeforeThresholdEur, 2000);
});

test("Staking-Rewards werden Posten mit Zuflusswert und eigener Haltefrist", () => {
  const report = calculateTaxReport([
    { id: 1, asset: "ETH", timestamp: "2023-01-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 1000 },
    { id: 2, asset: "ETH", timestamp: "2023-06-01T00:00:00Z", direction: "out", purpose: "Verkauf", amount: 1, price_transaction_eur: 1500 },
    { id: 3, asset: "ETH", timestamp: "2025-01-10T00:00:00Z", direction: "in", purpose: "Staking Rewards", amount: 0.5, price_transaction_eur: 3000 },
    { id: 4, asset: "ETH", timestamp: "2025-03-01T00:00:00Z", direction: "out", purpose: "Verkauf", amount: 0.5, price_transaction_eur: 2000 },
  ], 2025);
  assert.equal(report.sales.length, 1);
  assert.equal(report.sales[0].complete, true);
  assert.equal(report.sales[0].acquisitionTransactionId, 3);
  assert.equal(report.sales[0].acquisitionOrigin, "income");
  assert.equal(report.sales[0].costEur, 1500);
  assert.equal(report.sales[0].profitEur, -500);
  assert.equal(report.sales[0].holdingPeriodMet, false);
  assert.equal(report.summary.incomeEur, 1500);
});

test("DeFi Swap ist Veräußerung plus Anschaffung; fehlender Kurs kommt aus dem Tauschwert", () => {
  const rows = [
    { id: 1, wallet_id: 7, hash: "0xbuy", asset: "ETH", timestamp: "2025-01-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 2, price_transaction_eur: 1000 },
    { id: 2, wallet_id: 7, hash: "0xswap", asset: "ETH", timestamp: "2025-02-01T00:00:00Z", direction: "out", purpose: "DeFi Swap", amount: 1, price_transaction_eur: 2500 },
    { id: 3, wallet_id: 7, hash: "0xswap", asset: "ERC20:0xusdc", timestamp: "2025-02-01T00:00:00Z", direction: "in", purpose: "DeFi Swap", amount: 2500, price_transaction_eur: null },
    { id: 4, wallet_id: 7, hash: "0xsell", asset: "ERC20:0xusdc", timestamp: "2025-03-01T00:00:00Z", direction: "out", purpose: "Verkauf", amount: 1000, price_transaction_eur: 1.01 },
  ];
  const report = calculateTaxReport(rows, 2025);
  const swap = report.sales.find((sale) => sale.transactionId === 2);
  assert.equal(swap.disposalType, "swap");
  assert.equal(swap.profitEur, 1500);
  const usdcSale = report.sales.find((sale) => sale.transactionId === 4);
  assert.equal(usdcSale.complete, true);
  assert.equal(usdcSale.costEur, 1000);
  assert.ok(Math.abs(usdcSale.profitEur - 10) < 1e-9);
  const openEth = report.openLots.find((lot) => lot.asset === "ETH");
  assert.equal(openEth.amount, 1);
});

test("EUR-Gebühren: Kauf erhöht Anschaffungskosten, Verkauf bleibt vollständig; Gebühr wird nicht je Segment vervielfacht", () => {
  const report = calculateTaxReport([
    { id: 1, asset: "BTC", timestamp: "2025-01-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 0.5, price_transaction_eur: 40000, fee: 10, fee_asset: "EUR" },
    { id: 2, asset: "BTC", timestamp: "2025-01-02T00:00:00Z", direction: "in", purpose: "Kauf", amount: 0.5, price_transaction_eur: 42000 },
    { id: 3, asset: "BTC", timestamp: "2025-02-01T00:00:00Z", direction: "out", purpose: "Verkauf", amount: 1, price_transaction_eur: 50000, fee: 20, fee_asset: "EUR" },
  ], 2025);
  assert.equal(report.sales.length, 2);
  assert.ok(report.sales.every((sale) => sale.complete));
  assert.equal(report.sales[0].costEur, 20010);
  assert.equal(report.summary.feeEur, 20);
  assert.equal(report.summary.realizedProfitEur, 50000 - 20010 - 21000 - 20);
});

test("Kauf und Verkauf mit identischem Zeitstempel: Zugang wird zuerst gebucht", () => {
  const report = calculateTaxReport([
    { id: 9, asset: "SOL", timestamp: "2025-05-01T12:00:00Z", direction: "out", purpose: "Verkauf", amount: 1, price_transaction_eur: 150 },
    { id: 10, asset: "SOL", timestamp: "2025-05-01T12:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 140 },
  ], 2025);
  assert.equal(report.sales.length, 1);
  assert.equal(report.sales[0].complete, true);
  assert.equal(report.sales[0].profitEur, 10);
});

test("Netzwerkgebühren: einmal pro Hash, nicht bei UTXO/Cardano und nicht bei Börsen", () => {
  const rows = [
    { id: 1, wallet_id: 1, chain: "ETH", hash: "0xa", asset: "ETH", direction: "out", amount: 1, fee: 0.002, fee_asset: "ETH", timestamp: "2025-01-01T00:00:00Z", price_transaction_eur: 3000 },
    { id: 2, wallet_id: 1, chain: "ETH", hash: "0xa", asset: "ERC20:0xt", direction: "out", amount: 5, fee: 0.002, fee_asset: "ETH", timestamp: "2025-01-01T00:00:00Z" },
    { id: 3, wallet_id: 1, chain: "ETH", hash: "0xb", asset: "ERC20:0xt", asset_type: "erc20", direction: "out", amount: 5, fee: 0.001, fee_asset: null, timestamp: "2025-01-02T00:00:00Z" },
    { id: 4, wallet_id: 2, chain: "BTC", hash: "btc1", asset: "BTC", direction: "out", amount: 0.1, fee: 0.0001, timestamp: "2025-01-03T00:00:00Z" },
    { id: 5, wallet_id: 3, chain: "ADA", hash: "ada1", asset: "ADA", direction: "out", amount: 10, fee: 0.2, timestamp: "2025-01-03T00:00:00Z" },
    { id: 6, wallet_id: 4, chain: "EXCHANGE", source_type: "exchange", hash: "x", asset: "ETH", direction: "out", amount: 1, fee: 0.01, fee_asset: "ETH", timestamp: "2025-01-03T00:00:00Z" },
    { id: 7, wallet_id: 5, chain: "XTZ", hash: "tz", asset: "XTZ", direction: "out", amount: 3, fee: 0.0015, fee_asset: "XTZ", timestamp: "2025-01-04T00:00:00Z" },
    { id: 8, wallet_id: 1, chain: "ETH", hash: "0xc", asset: "ETH", direction: "in", amount: 1, fee: 0.5, fee_asset: "ETH", timestamp: "2025-01-05T00:00:00Z" },
  ];
  const fees = networkFeeRows(rows);
  assert.deepEqual(fees.map((fee) => [fee.hash, fee.asset, fee.amount]), [["0xa", "ETH", 0.002], ["0xb", "ETH", 0.001], ["tz", "XTZ", 0.0015]]);
  assert.equal(fees[0].price_transaction_eur, 3000);
  assert.ok(fees.every((fee) => fee.syntheticFee && fee.purpose === "Netzwerkgebühr"));
});

test("Netzwerkgebühren verbrauchen Posten, gehen aber nicht als Verkauf in den Gewinn ein", () => {
  const rows = [
    { id: 1, wallet_id: 1, chain: "ETH", hash: "0x1", asset: "ETH", timestamp: "2025-01-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 2000 },
    { id: 2, wallet_id: 1, chain: "ETH", hash: "0x2", asset: "ETH", timestamp: "2025-02-01T00:00:00Z", direction: "out", purpose: "Transfer", amount: 0.5, fee: 0.01, fee_asset: "ETH", price_transaction_eur: 2500 },
  ];
  const report = calculateTaxReport(rows, 2025);
  assert.equal(report.sales.length, 0);
  assert.equal(report.feeConsumptions.length, 1);
  assert.equal(report.feeConsumptions[0].transactionId, 2);
  assert.equal(report.feeConsumptions[0].costEur, 20);
  assert.ok(Math.abs(report.openLots[0].amount - 0.99) < 1e-12);
});

test("Dashboard nutzt dasselbe Verfahren wie das Steuerprofil und zieht Gebühren im Verlauf ab", () => {
  const rows = [
    { id: 1, wallet_id: 1, chain: "ETH", hash: "0x1", asset: "ETH", timestamp: "2025-01-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 1000 },
    { id: 2, wallet_id: 1, chain: "ETH", hash: "0x2", asset: "ETH", timestamp: "2025-01-02T00:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 3000 },
    { id: 3, wallet_id: 1, chain: "ETH", hash: "0x3", asset: "ETH", timestamp: "2025-02-01T00:00:00Z", direction: "out", purpose: "Verkauf", amount: 1, price_transaction_eur: 2500, fee: 0.01, fee_asset: "ETH" },
  ];
  const holdings = { ETH: 0.99 };
  const assets = { ETH: { id: "ETH" } };
  const fifo = calculateAssetAnalytics(rows, { ETH: 2000 }, holdings, assets).ETH;
  assert.equal(fifo.purchases.remainingCostEur, 2970);
  const lifo = calculateAssetAnalytics(rows, { ETH: 2000 }, holdings, assets, {}, { taxProfile: { ...DE, costBasisMethod: "LIFO" } }).ETH;
  assert.equal(lifo.purchases.remainingCostEur, 990);
  assert.equal(lifo.valueHistory.holdingMismatch, false);
  assert.equal(lifo.valueHistory.missingPriceCount, 0);
  assert.equal(lifo.purchases.balanceMismatch, false);
});

test("Ohne Chain-Angabe entstehen keine Gebührenposten (rückwärtskompatibel)", () => {
  const ledger = runCostBasis([
    { id: 1, asset: "ETH", timestamp: "2025-01-01T00:00:00Z", direction: "in", purpose: "Kauf", amount: 1, price_transaction_eur: 1000 },
    { id: 2, asset: "ETH", timestamp: "2025-01-02T00:00:00Z", direction: "out", purpose: "Transfer", amount: 0.5, fee: 0.01, fee_asset: "ETH" },
  ]);
  assert.equal(ledger.feeRows.length, 0);
  assert.equal(ledger.lotsByAsset.get("ETH")[0].amount, 1);
});
