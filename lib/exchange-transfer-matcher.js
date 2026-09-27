const EXCHANGE_TRANSFER_WINDOW_MS = 72 * 60 * 60 * 1000;
const EXCHANGE_TRANSFER_RELATIVE_TOLERANCE = 0.003;
const EXCHANGE_TRANSFER_ABSOLUTE_TOLERANCE = 0.00000001;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function exchangeTransferAmounts(transaction) {
  const amount = finiteNumber(transaction?.amount);
  if (amount === null || amount <= 0) return [];
  const values = [{ value: amount, feeAdjusted: false }];
  const fee = finiteNumber(transaction?.fee);
  const asset = String(transaction?.asset || "").toUpperCase();
  const feeAsset = String(transaction?.feeAsset || transaction?.fee_asset || "").toUpperCase();
  // Some exchanges report a withdrawal before the network fee while the
  // receiving on-chain transaction naturally contains the net amount.
  if (fee !== null && fee > 0 && feeAsset === asset && fee < amount) {
    values.push({ value: amount - fee, feeAdjusted: true });
  }
  return values;
}

function matchExchangeTransfer(exchangeTransaction, localTransaction, options = {}) {
  const windowMs = Number(options.windowMs) || EXCHANGE_TRANSFER_WINDOW_MS;
  const relativeTolerance = Number(options.relativeTolerance) || EXCHANGE_TRANSFER_RELATIVE_TOLERANCE;
  const absoluteTolerance = Number(options.absoluteTolerance) || EXCHANGE_TRANSFER_ABSOLUTE_TOLERANCE;
  const exchangeAsset = String(exchangeTransaction?.asset || "").toUpperCase();
  const localAsset = String(localTransaction?.asset || "").toUpperCase();
  if (!exchangeAsset || exchangeAsset !== localAsset) return null;
  if (!['in', 'out'].includes(exchangeTransaction?.direction) || !['in', 'out'].includes(localTransaction?.direction)) return null;
  if (exchangeTransaction.direction === localTransaction.direction) return null;
  const exchangeTimestamp = Date.parse(exchangeTransaction.timestamp);
  const localTimestamp = Date.parse(localTransaction.timestamp);
  if (!Number.isFinite(exchangeTimestamp) || !Number.isFinite(localTimestamp)) return null;
  const timeDeltaMs = Math.abs(exchangeTimestamp - localTimestamp);
  if (timeDeltaMs > windowMs) return null;
  const localAmount = finiteNumber(localTransaction.amount);
  if (localAmount === null || localAmount <= 0) return null;

  let closest = null;
  for (const candidate of exchangeTransferAmounts(exchangeTransaction)) {
    const difference = Math.abs(localAmount - candidate.value);
    const tolerance = Math.max(absoluteTolerance, Math.abs(candidate.value) * relativeTolerance);
    if (difference <= tolerance && (!closest || difference < closest.difference)) {
      closest = { ...candidate, difference, tolerance };
    }
  }
  if (!closest) return null;

  const outgoing = exchangeTransaction.direction === 'out' ? exchangeTransaction : localTransaction;
  const incoming = exchangeTransaction.direction === 'in' ? exchangeTransaction : localTransaction;
  return {
    outgoing,
    incoming,
    asset: exchangeAsset,
    amount: closest.value,
    amountDifference: closest.difference,
    feeAdjusted: closest.feeAdjusted,
    timeDeltaMs,
  };
}

module.exports = {
  EXCHANGE_TRANSFER_ABSOLUTE_TOLERANCE,
  EXCHANGE_TRANSFER_RELATIVE_TOLERANCE,
  EXCHANGE_TRANSFER_WINDOW_MS,
  exchangeTransferAmounts,
  matchExchangeTransfer,
};
