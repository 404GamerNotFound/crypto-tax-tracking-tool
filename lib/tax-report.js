function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isInYear(timestamp, year) {
  return String(timestamp || "").slice(0, 4) === String(year);
}

const { germanyProfile, normalizeTaxProfile } = require("./tax-profile");

function calculateTaxReport(transactions, year, { personalTaxRatePercent = 0, taxProfile = null } = {}) {
  const profile = normalizeTaxProfile(taxProfile || germanyProfile(personalTaxRatePercent));
  const lotsByAsset = new Map();
  const sales = [];
  const income = [];
  const chronological = [...transactions]
    .filter((transaction) => transaction.timestamp)
    .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)));

  for (const transaction of chronological) {
    const amount = Number(transaction.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const asset = transaction.asset;
    if (!lotsByAsset.has(asset)) lotsByAsset.set(asset, []);
    const historicPrice = positiveNumber(transaction.price_transaction_eur);

    if (transaction.direction === "in" && transaction.purpose === "Kauf") {
      lotsByAsset.get(asset).push({ amount, costPerAsset: historicPrice, acquiredAt: transaction.timestamp, transactionId: transaction.id || null });
    }
    if (transaction.direction === "out" && transaction.purpose === "Verkauf") {
      let outstanding = amount;
      for (const lot of lotsByAsset.get(asset)) {
        if (outstanding <= 0) break;
        const consumed = Math.min(outstanding, lot.amount);
        lot.amount -= consumed;
        outstanding -= consumed;
        if (!isInYear(transaction.timestamp, year)) continue;
        const proceedsEur = historicPrice ? consumed * historicPrice : null;
        const costEur = lot.costPerAsset ? consumed * lot.costPerAsset : null;
        const fee = Number(transaction.fee || 0);
        const feeEur = fee > 0 && String(transaction.fee_asset || asset) === asset && historicPrice ? fee * historicPrice : fee > 0 ? null : 0;
        const holdingDays = Math.floor((Date.parse(transaction.timestamp) - Date.parse(lot.acquiredAt)) / 86400000);
        const holdingPeriodMet = !profile.holdingPeriodEnabled || holdingDays >= profile.holdingPeriodDays;
        sales.push({
          asset,
          transactionId: transaction.id || null,
          acquisitionTransactionId: lot.transactionId,
          amount: consumed,
          soldAt: transaction.timestamp,
          acquiredAt: lot.acquiredAt,
          proceedsEur,
          costEur,
          feeEur,
          holdingDays,
          holdingPeriodMet,
          profitEur: proceedsEur !== null && costEur !== null && feeEur !== null ? proceedsEur - costEur - feeEur : null,
          complete: proceedsEur !== null && costEur !== null && feeEur !== null,
        });
      }
      if (outstanding > 0 && isInYear(transaction.timestamp, year)) {
        const proceedsEur = historicPrice ? outstanding * historicPrice : null;
        sales.push({ asset, transactionId: transaction.id || null, acquisitionTransactionId: null, amount: outstanding, soldAt: transaction.timestamp, acquiredAt: null, proceedsEur, costEur: null, profitEur: null, holdingPeriodMet: null, complete: false });
      }
    }
    if (transaction.direction === "in" && profile.incomePurposes.includes(transaction.purpose) && isInYear(transaction.timestamp, year)) {
      income.push({
        asset,
        transactionId: transaction.id || null,
        type: transaction.purpose,
        amount,
        receivedAt: transaction.timestamp,
        valueEur: historicPrice ? amount * historicPrice : null,
        complete: Boolean(historicPrice),
      });
    }
  }

  const completeSales = sales.filter((sale) => sale.complete);
  const completeIncome = income.filter((entry) => entry.complete);
  const realizedProfitEur = completeSales.reduce((sum, sale) => sum + sale.profitEur, 0);
  const incomeEur = completeIncome.reduce((sum, entry) => sum + entry.valueEur, 0);
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
  return {
    year: Number(year),
    profile,
    sales,
    income,
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
