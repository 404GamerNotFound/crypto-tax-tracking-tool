function positiveFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function amountFromAtomic(value, decimals) {
  if (value === null || value === undefined || value === "") return 0;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount / 10 ** decimals : 0;
}

function isoFromUnix(value, milliseconds = false) {
  const number = Number(value);
  return Number.isFinite(number) ? new Date(milliseconds ? number : number * 1000).toISOString() : null;
}

function sameAddress(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function normalizeEvmNativeTransfer(transaction, address, config) {
  if (!transaction || String(transaction.isError || "0") !== "0") return null;
  const from = transaction.from || null;
  const to = transaction.to || null;
  const direction = sameAddress(from, address) && sameAddress(to, address) ? "self" : sameAddress(from, address) ? "out" : "in";
  const amount = amountFromAtomic(transaction.value, config.decimals);
  if (!amount) return null;
  return {
    externalId: transaction.hash,
    hash: transaction.hash,
    timestamp: isoFromUnix(transaction.timeStamp),
    direction,
    asset: config.asset,
    amount,
    fee: direction === "out" ? amountFromAtomic(BigInt(transaction.gasUsed || 0) * BigInt(transaction.gasPrice || 0), config.decimals) : 0,
    counterparty: direction === "in" ? from : to,
    historicalPrice: null,
    autoPurpose: null,
    rawJson: JSON.stringify(transaction),
  };
}

function normalizeSolscanTransfer(transaction, address) {
  const mint = String(transaction.token_address || transaction.token || "");
  const nativeMint = "So11111111111111111111111111111111111111111";
  if (mint && mint !== nativeMint) return null;
  const from = transaction.from_address || transaction.from || null;
  const to = transaction.to_address || transaction.to || null;
  const direction = sameAddress(from, address) && sameAddress(to, address) ? "self" : sameAddress(from, address) ? "out" : "in";
  const decimals = Number.isSafeInteger(Number(transaction.token_decimals)) ? Number(transaction.token_decimals) : 9;
  const amount = amountFromAtomic(transaction.amount ?? transaction.change_amount ?? transaction.amount_ui, decimals);
  if (!amount) return null;
  return {
    externalId: transaction.trans_id || transaction.tx_hash || transaction.signature,
    hash: transaction.trans_id || transaction.tx_hash || transaction.signature,
    timestamp: isoFromUnix(transaction.block_time || transaction.time, Boolean(transaction.block_time_ms)),
    direction,
    asset: "SOL",
    amount,
    fee: 0,
    counterparty: direction === "in" ? from : to,
    historicalPrice: null,
    autoPurpose: null,
    rawJson: JSON.stringify(transaction),
  };
}

function normalizeXrpPayment(entry, address) {
  const transaction = entry?.tx || entry;
  if (!transaction || transaction.TransactionType !== "Payment" || typeof transaction.Amount !== "string") return null;
  const from = transaction.Account || null;
  const to = transaction.Destination || null;
  const direction = sameAddress(from, address) && sameAddress(to, address) ? "self" : sameAddress(from, address) ? "out" : "in";
  const amount = amountFromAtomic(transaction.Amount, 6);
  if (!amount) return null;
  return {
    externalId: transaction.hash || transaction.Hash,
    hash: transaction.hash || transaction.Hash,
    timestamp: Number.isFinite(Number(transaction.date)) ? isoFromUnix(Number(transaction.date) + 946684800) : null,
    direction,
    asset: "XRP",
    amount,
    fee: direction === "out" ? amountFromAtomic(transaction.Fee, 6) : 0,
    counterparty: direction === "in" ? from : to,
    historicalPrice: null,
    autoPurpose: null,
    rawJson: JSON.stringify(entry),
  };
}

function normalizeStellarPayment(payment, address) {
  if (!payment || !["payment", "account_created"].includes(payment.type)) return null;
  const from = payment.from || null;
  const to = payment.to || payment.account || null;
  const direction = sameAddress(from, address) && sameAddress(to, address) ? "self" : sameAddress(from, address) ? "out" : "in";
  const amount = positiveFinite(payment.amount || payment.starting_balance);
  if (!amount || (payment.asset_type && payment.asset_type !== "native")) return null;
  return {
    externalId: payment.id || payment.paging_token || payment.transaction_hash,
    hash: payment.transaction_hash || payment.id || payment.paging_token,
    timestamp: payment.created_at || null,
    direction,
    asset: "XLM",
    amount,
    fee: 0,
    counterparty: direction === "in" ? from : to,
    historicalPrice: null,
    autoPurpose: null,
    rawJson: JSON.stringify(payment),
  };
}

function normalizeNearTransfer(transaction, address) {
  const from = transaction.signer_account_id || transaction.from || null;
  const to = transaction.receiver_account_id || transaction.to || null;
  const action = Array.isArray(transaction.actions) ? transaction.actions.find((item) => item.action === "TRANSFER" || item.action_type === "TRANSFER" || item.deposit) : null;
  const rawAmount = action?.deposit || action?.args?.deposit || transaction.deposit || transaction.amount;
  const amount = amountFromAtomic(rawAmount, 24);
  if (!amount) return null;
  const direction = sameAddress(from, address) && sameAddress(to, address) ? "self" : sameAddress(from, address) ? "out" : "in";
  return {
    externalId: transaction.transaction_hash || transaction.hash,
    hash: transaction.transaction_hash || transaction.hash,
    timestamp: transaction.block_timestamp ? isoFromUnix(Number(transaction.block_timestamp) / 1000000) : transaction.block_timestamp_iso || null,
    direction,
    asset: "NEAR",
    amount,
    fee: 0,
    counterparty: direction === "in" ? from : to,
    historicalPrice: null,
    autoPurpose: null,
    rawJson: JSON.stringify(transaction),
  };
}

function normalizeTonMessage(message, address) {
  const direction = message.direction;
  const amount = amountFromAtomic(message.value, 9);
  if (!amount || !["in", "out", "self"].includes(direction)) return null;
  return {
    externalId: message.externalId,
    hash: message.hash,
    timestamp: isoFromUnix(message.timestamp),
    direction,
    asset: "TON",
    amount,
    fee: direction === "out" ? amountFromAtomic(message.fee, 9) : 0,
    counterparty: message.counterparty || null,
    historicalPrice: null,
    autoPurpose: null,
    rawJson: JSON.stringify(message.raw || message),
  };
}

function normalizeBlockchairUtxoTransaction(payload, address, config) {
  const transaction = payload?.transaction || payload?.data?.transaction || {};
  const inputs = payload?.inputs || payload?.data?.inputs || [];
  const outputs = payload?.outputs || payload?.data?.outputs || [];
  const isWallet = (entry) => sameAddress(entry?.recipient || entry?.address, address);
  const inputAmount = inputs.filter(isWallet).reduce((sum, entry) => sum + Number(entry.value || 0), 0);
  const outputAmount = outputs.filter(isWallet).reduce((sum, entry) => sum + Number(entry.value || 0), 0);
  const net = outputAmount - inputAmount;
  if (!net) return null;
  const direction = net > 0 ? "in" : "out";
  const otherInput = inputs.find((entry) => !isWallet(entry));
  const otherOutput = outputs.find((entry) => !isWallet(entry));
  const hash = transaction.hash || payload?.hash;
  return {
    externalId: hash,
    hash,
    timestamp: transaction.time || transaction.time_utc || null,
    direction,
    asset: config.asset,
    amount: Math.abs(net) / 10 ** config.decimals,
    fee: direction === "out" ? Number(transaction.fee || 0) / 10 ** config.decimals : 0,
    counterparty: direction === "in" ? otherInput?.recipient || otherInput?.address || null : otherOutput?.recipient || otherOutput?.address || null,
    historicalPrice: null,
    autoPurpose: null,
    rawJson: JSON.stringify(payload),
  };
}

module.exports = {
  normalizeEvmNativeTransfer,
  normalizeSolscanTransfer,
  normalizeXrpPayment,
  normalizeStellarPayment,
  normalizeNearTransfer,
  normalizeTonMessage,
  normalizeBlockchairUtxoTransaction,
};
