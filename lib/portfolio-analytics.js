const { buildAssetValueHistory } = require("./asset-history");
const { runCostBasis } = require("./cost-basis");

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function emptyAssetAnalytics(asset, currentPrice, holdingAmount) {
  return {
    asset: asset.id,
    holdingAmount,
    holdingValueEur: currentPrice ? holdingAmount * currentPrice : null,
    currentPriceEur: currentPrice || null,
    purchases: {
      count: 0,
      acquiredAmount: 0,
      remainingAmount: 0,
      remainingCostEur: 0,
      knownRemainingAmount: 0,
      unknownRemainingAmount: 0,
      knownCostLotCount: 0,
      unknownCostLotCount: 0,
      hasUnknownCost: false,
      currentValueEur: null,
      knownCurrentValueEur: null,
      profitEur: null,
      profitIsPartial: false,
    },
    staking: {
      count: 0,
      amount: 0,
      historicValueEur: 0,
      hasUnknownHistoricValue: false,
      currentValueEur: null,
    },
  };
}

/**
 * Kennzahlen je Asset. Kaufposten, Verkäufe, Tausch, Erträge und Gebühren
 * werden mit demselben Motor wie im Steuerzentrum fortgeschrieben
 * (inklusive Verfahren FIFO/LIFO/HIFO/Durchschnitt aus dem Steuerprofil).
 * `purchases` beschreibt nur die verbleibenden Kauf- bzw. Tauschposten;
 * Ertragsposten erscheinen getrennt unter `staking`.
 */
function calculateAssetAnalytics(transactions, pricesByAsset, holdings, assets, sourceBalances = {}, options = {}) {
  const analytics = Object.fromEntries(Object.entries(assets).map(([assetId, asset]) => [
    assetId,
    emptyAssetAnalytics(asset, positiveNumber(pricesByAsset[assetId]), Number(holdings[assetId] || 0)),
  ]));
  const ledger = runCostBasis(transactions, options);
  const rowsByAsset = new Map();
  for (const transaction of [...transactions, ...ledger.feeRows]) {
    if (!analytics[transaction.asset]) continue;
    if (!rowsByAsset.has(transaction.asset)) rowsByAsset.set(transaction.asset, []);
    rowsByAsset.get(transaction.asset).push(transaction);
  }

  for (const { transaction, lot } of ledger.acquisitions) {
    const report = analytics[transaction.asset];
    if (!report || lot.origin !== "purchase") continue;
    report.purchases.count += 1;
    report.purchases.acquiredAmount += lot.originalAmount;
  }
  for (const transaction of transactions) {
    const report = analytics[transaction.asset];
    if (!report || transaction.direction !== "in" || transaction.purpose !== "Staking Rewards") continue;
    const amount = Number(transaction.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const historicPrice = positiveNumber(transaction.price_transaction_eur);
    report.staking.count += 1;
    report.staking.amount += amount;
    if (historicPrice) report.staking.historicValueEur += amount * historicPrice;
    else report.staking.hasUnknownHistoricValue = true;
  }
  const purchaseLots = Object.fromEntries(Object.keys(assets).map((assetId) => [
    assetId,
    (ledger.lotsByAsset.get(assetId) || []).filter((lot) => lot.origin === "purchase"),
  ]));

  for (const [assetId, report] of Object.entries(analytics)) {
    for (const lot of purchaseLots[assetId]) {
      if (lot.amount <= 0) continue;
      report.purchases.remainingAmount += lot.amount;
      if (lot.costPerAsset) {
        report.purchases.knownRemainingAmount += lot.amount;
        report.purchases.knownCostLotCount += 1;
        report.purchases.remainingCostEur += lot.amount * lot.costPerAsset;
      } else {
        report.purchases.hasUnknownCost = true;
        report.purchases.unknownRemainingAmount += lot.amount;
        report.purchases.unknownCostLotCount += 1;
      }
    }
    report.holdingIsPartial = (sourceBalances[assetId] || []).some(source => source.incomplete);
    report.purchases.balanceMismatch = report.purchases.remainingAmount > Math.max(0, report.holdingAmount) + Math.max(1e-8, Math.abs(report.holdingAmount) * 1e-8);
    report.purchases.balanceUncertain = report.holdingIsPartial || report.purchases.balanceMismatch || (sourceBalances[assetId] || []).some(source => source.historyIncomplete);
    report.valueHistory = buildAssetValueHistory(rowsByAsset.get(assetId) || [], report);
    if (report.currentPriceEur) report.staking.currentValueEur = report.staking.amount * report.currentPriceEur;
    // A conflicting current balance cannot tell us which purchase lots remain.
    // Keep the journal calculation for diagnosis, but do not invent a profit.
    if (!report.currentPriceEur || report.purchases.balanceUncertain) continue;
    report.purchases.currentValueEur = report.purchases.remainingAmount * report.currentPriceEur;
    report.purchases.knownCurrentValueEur = report.purchases.knownRemainingAmount * report.currentPriceEur;
    report.staking.currentValueEur = report.staking.amount * report.currentPriceEur;
    if (report.purchases.knownRemainingAmount > 0) {
      report.purchases.profitEur = report.purchases.knownCurrentValueEur - report.purchases.remainingCostEur;
      report.purchases.profitIsPartial = report.purchases.hasUnknownCost;
    }
  }
  return analytics;
}

module.exports = { calculateAssetAnalytics };
