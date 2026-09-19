const WEI_PER_ETH = 10n ** 18n;

function amountFromUnits(value, decimals = 18) {
  try {
    const raw = BigInt(String(value || "0"));
    const precision = Math.min(Math.max(Number(decimals) || 0, 0), 12);
    if (raw === 0n) return 0;
    const divisor = 10n ** BigInt(Math.max(Number(decimals) || 0, 0));
    const whole = raw / divisor;
    const remainder = raw % divisor;
    if (precision === 0) return Number(whole);
    const fraction = (remainder * (10n ** BigInt(precision)) / divisor).toString().padStart(precision, "0").replace(/0+$/, "");
    return Number(fraction ? `${whole}.${fraction}` : whole);
  } catch (_) {
    return 0;
  }
}

function sameAddress(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function safeText(value, maximum = 120) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function transactionFee(transaction) {
  try {
    return amountFromUnits(BigInt(String(transaction.gasUsed || 0)) * BigInt(String(transaction.gasPrice || 0)), 18);
  } catch (_) {
    return 0;
  }
}

function directionFor(transaction, address) {
  const fromWallet = sameAddress(transaction.from, address);
  const toWallet = sameAddress(transaction.to, address);
  if (fromWallet && toWallet) return "self";
  return fromWallet ? "out" : "in";
}

function normalizeEthereumTransaction(transaction, address) {
  if (String(transaction.isError) === "1" || String(transaction.txreceipt_status) === "0") return null;
  const amount = amountFromUnits(transaction.value, 18);
  if (amount <= 0 || (!sameAddress(transaction.from, address) && !sameAddress(transaction.to, address))) return null;
  const direction = directionFor(transaction, address);
  return {
    externalId: `eth:${transaction.hash}`,
    hash: transaction.hash,
    timestamp: Number.isFinite(Number(transaction.timeStamp)) ? new Date(Number(transaction.timeStamp) * 1000).toISOString() : null,
    direction,
    asset: "ETH",
    assetSymbol: "ETH",
    assetName: "Ethereum",
    assetDecimals: 18,
    assetContract: null,
    amount,
    fee: direction === "out" || direction === "self" ? transactionFee(transaction) : 0,
    feeAsset: "ETH",
    counterparty: direction === "in" ? transaction.from || null : transaction.to || null,
    historicalPrice: null,
    priceKind: "native",
    autoPurpose: null,
    rawJson: JSON.stringify(transaction),
  };
}

function normalizeErc20Transfer(transaction, address) {
  if (String(transaction.isError) === "1" || String(transaction.txreceipt_status) === "0") return null;
  const contract = String(transaction.contractAddress || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(contract) || (!sameAddress(transaction.from, address) && !sameAddress(transaction.to, address))) return null;
  const decimals = Math.min(Math.max(Number(transaction.tokenDecimal) || 0, 0), 36);
  const direction = directionFor(transaction, address);
  const symbol = safeText(transaction.tokenSymbol, 24) || "ERC-20";
  const name = safeText(transaction.tokenName, 120) || symbol;
  return {
    externalId: `erc20:${transaction.hash}:${transaction.logIndex || transaction.transactionIndex || "0"}:${contract}:${transaction.from || ""}:${transaction.to || ""}:${transaction.value || "0"}`,
    hash: transaction.hash,
    timestamp: Number.isFinite(Number(transaction.timeStamp)) ? new Date(Number(transaction.timeStamp) * 1000).toISOString() : null,
    direction,
    asset: `ERC20:${contract}`,
    assetSymbol: symbol,
    assetName: name,
    assetDecimals: decimals,
    assetContract: contract,
    amount: amountFromUnits(transaction.value, decimals),
    fee: direction === "out" || direction === "self" ? transactionFee(transaction) : 0,
    feeAsset: "ETH",
    counterparty: direction === "in" ? transaction.from || null : transaction.to || null,
    historicalPrice: null,
    priceKind: "erc20",
    autoPurpose: null,
    rawJson: JSON.stringify(transaction),
  };
}

module.exports = { WEI_PER_ETH, amountFromUnits, normalizeEthereumTransaction, normalizeErc20Transfer };
