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

test('weist bei mehr offenen Kaufchargen als Bestand keinen vermeintlichen Kaufgewinn aus', () => {
  const rows = [{ asset:'ADA', timestamp:'2021-01-01', direction:'in', purpose:'Kauf', amount:291, price_transaction_eur:0.4 }];
  const report=calculateAssetAnalytics(rows,{ADA:0.2},{ADA:102},{ADA:{id:'ADA'}}).ADA;
  assert.equal(report.purchases.acquiredAmount,291);
  assert.equal(report.purchases.remainingAmount,291); // Diagnostic calculation remains intact.
  assert.equal(report.purchases.balanceMismatch,true);
  assert.equal(report.purchases.balanceUncertain,true);
  assert.equal(report.purchases.profitEur,null);
  assert.equal(report.purchases.currentValueEur,null);
  const repaired=calculateAssetAnalytics(rows,{ADA:0.2},{ADA:400},{ADA:{id:'ADA'}}).ADA;
  assert.equal(repaired.purchases.balanceUncertain,false);
  assert.equal(repaired.purchases.profitEur,-58.2);
});

test('erhält kumulierte Rewards, kennzeichnet aber reine Teilbestände und sperrt Kaufgewinn', () => {
  const rows=[{asset:'ADA',timestamp:'2021-01-01',direction:'in',purpose:'Kauf',amount:1,price_transaction_eur:1},
    {asset:'ADA',timestamp:'2022-01-01',direction:'in',purpose:'Staking Rewards',amount:100,price_transaction_eur:0.2}];
  const report=calculateAssetAnalytics(rows,{ADA:0.2},{ADA:100},{ADA:{id:'ADA'}},{ADA:[{incomplete:true}]}).ADA;
  assert.equal(report.holdingIsPartial,true);
  assert.equal(report.purchases.profitEur,null);
  assert.equal(report.staking.amount,100);
  assert.equal(report.staking.currentValueEur,20);
});

test('bestätigter Saldo allein bestätigt keine Kaufchargen bei abweichender Börsenhistorie', () => {
  const rows = [{ asset:'ADA', timestamp:'2021-01-01', direction:'in', purpose:'Kauf', amount:291, price_transaction_eur:0.4 }];
  const report = calculateAssetAnalytics(rows,{ADA:0.2},{ADA:890},{ADA:{id:'ADA'}},{ADA:[{incomplete:false,historyIncomplete:true}]}).ADA;
  assert.equal(report.holdingIsPartial,false);
  assert.equal(report.purchases.balanceMismatch,false);
  assert.equal(report.purchases.balanceUncertain,true);
  assert.equal(report.purchases.profitEur,null);
});
