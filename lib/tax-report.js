const { germanyProfile, normalizeTaxProfile } = require("./tax-profile");
const { lotsForDisposal, runCostBasis, positiveNumber } = require("./cost-basis");
const { holdingPeriodRule } = require("./holding-period");

function isInYear(timestamp, year) {
  return String(timestamp || "").slice(0, 4) === String(year);
}

function incomeSource(transaction) {
  const isExchange = transaction.source_type === "exchange" || transaction.sourceType === "exchange" || transaction.chain === "EXCHANGE";
  return {
    sourceKind: isExchange ? "exchange" : "wallet",
    sourceLabel: String(transaction.source_label || transaction.sourceLabel || (isExchange ? "Börsenkonto" : "Wallet")),
  };
}

/**
 * Bewertet die Gebühr einer Veräußerung in EUR: EUR-Gebühren direkt,
 * Gebühren im verkauften Asset zum Verkaufskurs. Andere Gebühren-Assets
 * bleiben unbewertet (`null`) und machen den Verkauf unvollständig.
 */
function saleFeeEur(transaction) {
  const fee = Number(transaction.fee || 0);
  if (!Number.isFinite(fee) || fee <= 0) return 0;
  const feeAsset = String(transaction.fee_asset || transaction.feeAsset || transaction.asset);
  if (feeAsset.toUpperCase() === "EUR") return fee;
  const price = positiveNumber(transaction.price_transaction_eur);
  return feeAsset === transaction.asset && price ? fee * price : null;
}

function holdingDaysBetween(acquiredAt, disposedAt) {
  return Math.floor((Date.parse(disposedAt) - Date.parse(acquiredAt)) / 86400000);
}

function calculateTaxReport(transactions, year, { personalTaxRatePercent = 0, taxProfile = null } = {}) {
  const profile = normalizeTaxProfile(taxProfile || germanyProfile(personalTaxRatePercent));
  const ledger = runCostBasis(transactions, { profile });
  const sales = [];
  const income = [];

  for (const disposal of ledger.disposals) {
    const transaction = disposal.transaction;
    if (!isInYear(transaction.timestamp, year)) continue;
    const proceedsPerAsset = disposal.proceedsEur !== null ? disposal.proceedsEur / disposal.amount : null;
    const totalFeeEur = saleFeeEur(transaction);
    // Gebühren werden anteilig auf die verbrauchten Posten verteilt, damit sie
    // bei mehreren Segmenten nicht mehrfach abgezogen werden.
    const feeShare = (amount) => totalFeeEur === null ? null : totalFeeEur * amount / disposal.amount;
    for (const segment of disposal.segments) {
      const proceedsEur = proceedsPerAsset !== null ? segment.amount * proceedsPerAsset : null;
      const costEur = positiveNumber(segment.costPerAsset) ? segment.amount * segment.costPerAsset : null;
      const feeEur = feeShare(segment.amount);
      const rule = holdingPeriodRule(segment.acquiredAt, profile);
      sales.push({
        asset: disposal.asset,
        transactionId: transaction.id || null,
        acquisitionTransactionId: segment.acquisitionTransactionId,
        acquisitionOrigin: segment.origin,
        amount: segment.amount,
        soldAt: transaction.timestamp,
        acquiredAt: segment.acquiredAt,
        proceedsEur,
        costEur,
        feeEur,
        holdingDays: holdingDaysBetween(segment.acquiredAt, transaction.timestamp),
        holdingPeriodMet: rule ? rule.isMetAt(transaction.timestamp) : false,
        disposalType: transaction.purpose === "DeFi Swap" ? "swap" : "sale",
        profitEur: proceedsEur !== null && costEur !== null && feeEur !== null ? proceedsEur - costEur - feeEur : null,
        complete: proceedsEur !== null && costEur !== null && feeEur !== null,
      });
    }
    if (disposal.outstanding > 0) {
      const proceedsEur = proceedsPerAsset !== null ? disposal.outstanding * proceedsPerAsset : null;
      sales.push({
        asset: disposal.asset, transactionId: transaction.id || null, acquisitionTransactionId: null, acquisitionOrigin: null,
        amount: disposal.outstanding, soldAt: transaction.timestamp, acquiredAt: null, proceedsEur, costEur: null,
        feeEur: feeShare(disposal.outstanding), profitEur: null, holdingPeriodMet: null,
        disposalType: transaction.purpose === "DeFi Swap" ? "swap" : "sale", complete: false,
      });
    }
  }

  const feeConsumptions = ledger.consumptions
    .filter((entry) => isInYear(entry.transaction.timestamp, year))
    .map((entry) => ({
      asset: entry.asset,
      transactionId: entry.transaction.sourceTransactionId ?? entry.transaction.id ?? null,
      type: entry.transaction.purpose,
      amount: entry.amount,
      consumedAt: entry.transaction.timestamp,
      costEur: entry.outstanding === 0 && entry.segments.every((segment) => positiveNumber(segment.costPerAsset))
        ? entry.segments.reduce((sum, segment) => sum + segment.amount * segment.costPerAsset, 0) : null,
      uncoveredAmount: entry.outstanding,
    }));

  const chronological = [...transactions]
    .filter((transaction) => transaction.timestamp && !transaction.syntheticFee)
    .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)) || (Number(left.id) || 0) - (Number(right.id) || 0));
  for (const transaction of chronological) {
    const amount = Number(transaction.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (transaction.direction === "in" && profile.incomePurposes.includes(transaction.purpose) && isInYear(transaction.timestamp, year)) {
      const historicPrice = positiveNumber(transaction.price_transaction_eur);
      income.push({
        asset: transaction.asset,
        transactionId: transaction.id || null,
        type: transaction.purpose,
        amount,
        receivedAt: transaction.timestamp,
        valueEur: historicPrice ? amount * historicPrice : null,
        complete: Boolean(historicPrice),
        ...incomeSource(transaction),
      });
    }
  }

  const completeSales = sales.filter((sale) => sale.complete);
  const completeIncome = income.filter((entry) => entry.complete);
  const realizedProfitEur = completeSales.reduce((sum, sale) => sum + sale.profitEur, 0);
  const incomeEur = completeIncome.reduce((sum, entry) => sum + entry.valueEur, 0);
  const completeWalletIncome = completeIncome.filter((entry) => entry.sourceKind === "wallet");
  const completeExchangeIncome = completeIncome.filter((entry) => entry.sourceKind === "exchange");
  const taxableSales = completeSales.filter((sale) => !sale.holdingPeriodMet);
  const taxableSaleProfitBeforeThresholdEur = profile.disposalTaxEnabled
    ? taxableSales.reduce((sum, sale) => sum + (profile.lossOffsetEnabled ? sale.profitEur : Math.max(0, sale.profitEur)), 0)
    : 0;
  const positiveTaxableSaleProfitEur = Math.max(0, taxableSaleProfitBeforeThresholdEur);
  const exemptionApplied = profile.disposalTaxEnabled && profile.exemptionThresholdEnabled && positiveTaxableSaleProfitEur <= profile.exemptionThresholdEur;
  const taxableSaleProfitEur = exemptionApplied ? 0 : positiveTaxableSaleProfitEur;
  const taxableIncomeEur = profile.incomeTaxEnabled ? incomeEur : 0;
  const estimatedDisposalTaxEur = taxableSaleProfitEur * (profile.disposalTaxRatePercent / 100);
  const estimatedIncomeTaxEur = taxableIncomeEur * (profile.incomeTaxRatePercent / 100);
  const taxableEstimateBaseEur = taxableSaleProfitEur + taxableIncomeEur;
  const estimatedTaxEur = estimatedDisposalTaxEur + estimatedIncomeTaxEur;
  const now = Date.now();
  const openLots = [...ledger.lotsByAsset.entries()].flatMap(([asset, lots]) => lotsForDisposal(lots, profile.costBasisMethod)
    .filter((lot) => lot.amount > 0)
    .map((lot) => {
      const rule = holdingPeriodRule(lot.acquiredAt, profile);
      return {
        asset,
        amount: lot.amount,
        costPerAsset: lot.costPerAsset,
        acquiredAt: lot.acquiredAt,
        transactionId: lot.transactionId,
        origin: lot.origin,
        holdingDays: Math.max(0, Math.floor((now - Date.parse(lot.acquiredAt)) / 86400000)),
        holdingPeriodMet: rule ? rule.isMetAt(now) : false,
        eligibleAt: rule ? new Date(rule.eligibleAtMs).toISOString() : null,
      };
    }));
  return {
    year: Number(year),
    profile,
    sales,
    income,
    feeConsumptions,
    openLots,
    availableAssets: [...new Set(transactions.map((entry) => entry.asset).filter(Boolean))].sort(),
    undatedIncome: transactions.filter((entry) => !entry.timestamp && entry.direction === "in"
      && profile.incomePurposes.includes(entry.purpose) && positiveNumber(entry.amount))
      .map((entry) => ({ asset: entry.asset, transactionId: entry.id || null, type: entry.purpose,
        amount: Number(entry.amount), receivedAt: null, valueEur: null, complete: false, ...incomeSource(entry) })),
    summary: {
      saleSegments: sales.length,
      incompleteSaleSegments: sales.length - completeSales.length,
      proceedsEur: completeSales.reduce((sum, sale) => sum + sale.proceedsEur, 0),
      costEur: completeSales.reduce((sum, sale) => sum + sale.costEur, 0),
      realizedProfitEur,
      feeEur: completeSales.reduce((sum, sale) => sum + sale.feeEur, 0),
      incomeEntries: income.length,
      incompleteIncomeEntries: income.length - completeIncome.length,
      incomeEur,
      walletIncomeEntries: income.filter((entry) => entry.sourceKind === "wallet").length,
      exchangeIncomeEntries: income.filter((entry) => entry.sourceKind === "exchange").length,
      walletIncomeEur: completeWalletIncome.reduce((sum, entry) => sum + entry.valueEur, 0),
      exchangeIncomeEur: completeExchangeIncome.reduce((sum, entry) => sum + entry.valueEur, 0),
      personalTaxRatePercent: profile.incomeTaxRatePercent,
      taxableSaleSegments: taxableSales.length,
      holdingPeriodExemptSaleSegments: completeSales.filter((sale) => sale.holdingPeriodMet).length,
      taxableSaleProfitBeforeThresholdEur,
      taxableSaleProfitEur,
      taxableIncomeEur,
      exemptionApplied,
      estimatedDisposalTaxEur,
      estimatedIncomeTaxEur,
      taxableEstimateBaseEur,
      estimatedTaxEur,
    },
  };
}

module.exports = { calculateTaxReport };
