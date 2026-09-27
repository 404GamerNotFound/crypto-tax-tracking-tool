const METHOD_PURPOSES = Object.freeze({
  "0x38ed1739": "DeFi Swap",
  "0x18cbafe5": "DeFi Swap",
  "0x7ff36ab5": "DeFi Swap",
  "0x8803dbee": "DeFi Swap",
  "0x04e45aaf": "DeFi Swap",
  "0x414bf389": "Bridge",
  "0xe8e33700": "Liquidity Pool",
  "0xf305d719": "Liquidity Pool",
  "0xbaa2abde": "Liquidity Pool",
  "0x02751cec": "Liquidity Pool",
});

function classifyEvmTransaction(transaction) {
  const method = String(transaction?.input || transaction?.methodId || "").trim().toLowerCase().slice(0, 10);
  const purpose = METHOD_PURPOSES[method] || null;
  if (!purpose) return null;
  return { purpose, method };
}

function isLikelySpamAsset(transaction) {
  const symbol = String(transaction?.tokenSymbol || transaction?.assetSymbol || "").toLowerCase();
  const name = String(transaction?.tokenName || transaction?.assetName || "").toLowerCase();
  return /visit|claim|airdrop|reward|http|www\./.test(symbol) || /visit|claim reward|airdrop.*now|http/.test(name);
}

module.exports = { classifyEvmTransaction, isLikelySpamAsset };
