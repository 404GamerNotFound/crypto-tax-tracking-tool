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

function calculateAssetAnalytics(transactions, pricesByAsset, holdings, assets) {
  const analytics = Object.fromEntries(Object.entries(assets).map(([assetId, asset]) => [
    assetId,
    emptyAssetAnalytics(asset, positiveNumber(pricesByAsset[assetId]), Number(holdings[assetId] || 0)),
  ]));
  const purchaseLots = Object.fromEntries(Object.keys(assets).map((assetId) => [assetId, []]));
  const chronological = [...transactions].sort((left, right) => String(left.timestamp || "").localeCompare(String(right.timestamp || "")));

  for (const transaction of chronological) {
    const report = analytics[transaction.asset];
    if (!report) continue;
    const amount = Number(transaction.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const historicPrice = positiveNumber(transaction.price_transaction_eur);

    if (transaction.direction === "in" && transaction.purpose === "Kauf") {
      report.purchases.count += 1;
      report.purchases.acquiredAmount += amount;
      purchaseLots[transaction.asset].push({ amount, costPerAsset: historicPrice });
    }
    if (transaction.direction === "out" && transaction.purpose === "Verkauf") {
      let remainingToSell = amount;
      for (const lot of purchaseLots[transaction.asset]) {
        if (remainingToSell <= 0) break;
        const consumed = Math.min(lot.amount, remainingToSell);
        lot.amount -= consumed;
        remainingToSell -= consumed;
      }
    }
    if (transaction.direction === "in" && transaction.purpose === "Staking Rewards") {
      report.staking.count += 1;
      report.staking.amount += amount;
      if (historicPrice) report.staking.historicValueEur += amount * historicPrice;
      else report.staking.hasUnknownHistoricValue = true;
    }
  }

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
    if (!report.currentPriceEur) continue;
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
