const bitcoin = require("bitcoinjs-lib");

const SUN_PER_TRX = 1_000_000;
const TRON_BASE58_VERSION = 0x41;

function tronHexToAddress(value) {
  const hex = String(value || "").replace(/^0x/i, "");
  if (!/^[\da-f]{42}$/i.test(hex) || !hex.toLowerCase().startsWith("41")) return null;
  try {
    return bitcoin.address.toBase58Check(Buffer.from(hex.slice(2), "hex"), TRON_BASE58_VERSION);
  } catch (_) {
    return null;
  }
}

function tronAddressToHex(value) {
  try {
    const decoded = bitcoin.address.fromBase58Check(String(value || ""));
    if (decoded.version !== TRON_BASE58_VERSION || decoded.hash.length !== 20) return null;
    return `41${Buffer.from(decoded.hash).toString("hex")}`;
  } catch (_) {
    return null;
  }
}

function tronFee(transaction) {
  const cost = transaction.cost || {};
  const aggregate = Number(cost.fee || 0);
  if (Number.isFinite(aggregate) && aggregate > 0) return aggregate;
  return ["net_fee", "energy_fee", "multi_sign_fee", "memo_fee", "account_create_fee", "exchange_create_fee"]
    .reduce((sum, key) => sum + Number(cost[key] || 0), 0);
}

function normalizeTronNativeTransfer(transaction, walletAddress) {
  const contract = transaction.raw_data?.contract?.find((item) => item.type === "TransferContract");
  const value = contract?.parameter?.value;
  if (!value) return null;

  const sender = tronHexToAddress(value.owner_address);
  const target = tronHexToAddress(value.to_address);
  const externalId = transaction.txID || transaction.txid || null;
  if (!externalId || !sender || !target || (sender !== walletAddress && target !== walletAddress)) return null;
  const direction = sender === walletAddress && target === walletAddress ? "self" : sender === walletAddress ? "out" : "in";
  const amountSun = Number(value.amount || 0);
  if (!Number.isFinite(amountSun) || amountSun < 0) return null;

  return {
    externalId,
    hash: externalId,
    timestamp: Number.isFinite(Number(transaction.block_timestamp))
      ? new Date(Number(transaction.block_timestamp)).toISOString()
      : null,
    direction,
    asset: "TRX",
    amount: Math.round((amountSun / SUN_PER_TRX) * 10 ** 6) / 10 ** 6,
    fee: direction === "out" ? Math.round((tronFee(transaction) / SUN_PER_TRX) * 10 ** 6) / 10 ** 6 : 0,
    counterparty: direction === "in" ? sender : target,
    historicalPrice: null,
    autoPurpose: null,
    rawJson: JSON.stringify(transaction),
  };
}

module.exports = {
  SUN_PER_TRX,
  normalizeTronNativeTransfer,
  tronAddressToHex,
  tronHexToAddress,
};
