function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function buildTaxOptimizer(report, currentPrices = {}) {
  const lots = (report.openLots || []).map((lot) => ({ ...lot, currentPriceEur: finitePositive(currentPrices[lot.asset]) }));
  const holdingCalendar = report.profile?.holdingPeriodEnabled ? lots
    .filter((lot) => !lot.holdingPeriodMet)
    .sort((left, right) => String(left.eligibleAt).localeCompare(String(right.eligibleAt)))
    .slice(0, 60) : [];
  const lossHarvesting = lots
    .map((lot) => {
      const currentPrice = lot.currentPriceEur;
      const potentialLossEur = currentPrice && finitePositive(lot.costPerAsset) ? (currentPrice - lot.costPerAsset) * lot.amount : null;
      return { ...lot, potentialLossEur };
    })
    .filter((lot) => lot.potentialLossEur !== null && lot.potentialLossEur < 0 && !lot.holdingPeriodMet)
    .sort((left, right) => left.potentialLossEur - right.potentialLossEur)
    .slice(0, 30);
  return { availableAssets: [...new Set(lots.map((lot) => lot.asset))].sort(), holdingCalendar, lossHarvesting };
}

function simulateSale(report, { asset, amount, priceEur }) {
  const requestedAmount = finitePositive(amount);
  const price = finitePositive(priceEur);
  if (!asset || !requestedAmount || !price) return null;
  let remaining = requestedAmount;
  const segments = [];
  for (const lot of (report.openLots || []).filter((item) => item.asset === asset)) {
    if (remaining <= 0) break;
    const sold = Math.min(remaining, lot.amount);
    remaining -= sold;
    const proceedsEur = sold * price;
    const costEur = finitePositive(lot.costPerAsset) ? sold * lot.costPerAsset : null;
    segments.push({ ...lot, amount: sold, proceedsEur, costEur, profitEur: costEur === null ? null : proceedsEur - costEur });
  }
  const complete = remaining <= 0 && segments.every((item) => item.profitEur !== null);
  const profile = report.profile;
  const taxableProfitEur = complete && profile.disposalTaxEnabled
    ? Math.max(0, segments.filter((item) => !item.holdingPeriodMet).reduce((sum, item) => sum + item.profitEur, 0))
    : null;
  const estimatedTaxEur = taxableProfitEur === null ? null : taxableProfitEur * (profile.disposalTaxRatePercent / 100);
  return { asset, requestedAmount, priceEur: price, availableAmount: requestedAmount - remaining, missingAmount: remaining, complete, segments, proceedsEur: segments.reduce((sum, item) => sum + item.proceedsEur, 0), profitEur: complete ? segments.reduce((sum, item) => sum + item.profitEur, 0) : null, taxableProfitEur, estimatedTaxEur };
}

module.exports = { buildTaxOptimizer, simulateSale };
