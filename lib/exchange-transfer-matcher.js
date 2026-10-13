const EXCHANGE_TRANSFER_WINDOW_MS = 72 * 60 * 60 * 1000;
const EXCHANGE_TRANSFER_RELATIVE_TOLERANCE = 0.003;
const EXCHANGE_TRANSFER_ABSOLUTE_TOLERANCE = 0.00000001;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Provider record IDs and shortened display values are not blockchain hashes.
function transferHash(value) {
  const hash = String(value || "").trim();
  if (/^(?:0x)?[a-f0-9]{64}$/i.test(hash)) return hash.replace(/^0x/i, "").toLowerCase();
  if (/^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(hash)) return hash;
  return null;
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
  if (exchangeTransaction.wallet_id != null && exchangeTransaction.wallet_id === localTransaction.wallet_id) return null;
  const exchangeHash = transferHash(exchangeTransaction.hash);
  const localHash = transferHash(localTransaction.hash);
  if (exchangeHash && localHash && exchangeHash !== localHash) return null;
  const outgoing = exchangeTransaction.direction === 'out' ? exchangeTransaction : localTransaction;
  const incoming = exchangeTransaction.direction === 'in' ? exchangeTransaction : localTransaction;
  const exchangeTimestamp = Date.parse(exchangeTransaction.timestamp);
  const localTimestamp = Date.parse(localTransaction.timestamp);
  if (!Number.isFinite(exchangeTimestamp) || !Number.isFinite(localTimestamp)) return null;
  const timeDeltaMs = Math.abs(exchangeTimestamp - localTimestamp);
  if (timeDeltaMs > windowMs) return null;
  const localAmount = finiteNumber(incoming.amount);
  if (localAmount === null || localAmount <= 0) return null;

  let closest = null;
  for (const candidate of exchangeTransferAmounts(outgoing)) {
    const difference = Math.abs(localAmount - candidate.value);
    const tolerance = Math.max(absoluteTolerance, Math.abs(candidate.value) * relativeTolerance);
    if (difference <= tolerance && (!closest || difference < closest.difference)) {
      closest = { ...candidate, difference, tolerance };
    }
  }
  if (!closest) return null;

  return {
    outgoing,
    incoming,
    asset: exchangeAsset,
    amount: closest.value,
    amountDifference: closest.difference,
    feeAdjusted: closest.feeAdjusted,
    timeDeltaMs,
    hashMatched: Boolean(exchangeHash && localHash),
  };
}

module.exports = {
  EXCHANGE_TRANSFER_ABSOLUTE_TOLERANCE,
  EXCHANGE_TRANSFER_RELATIVE_TOLERANCE,
  EXCHANGE_TRANSFER_WINDOW_MS,
  exchangeTransferAmounts,
  matchExchangeTransfer,
  transferHash,
};
