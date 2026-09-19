const ETHEREUM_ERC20_COIN_IDS = new Set([
  "tether",
  "usd-coin",
  "chainlink",
  "uniswap",
  "ethena-usde",
  "dai",
  "usds",
  "usd1-wlfi",
  "whitebit",
  "leo-token",
]);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function chainForCoinGeckoId(coinGeckoId, chainConfig) {
  return Object.entries(chainConfig).find(([, config]) => config.coinGeckoId === coinGeckoId)?.[0] || null;
}

function importSupportForCoin(coinGeckoId, chainConfig) {
  const chain = chainForCoinGeckoId(coinGeckoId, chainConfig);
  if (chain) {
    return {
      type: "native",
      chain,
      label: "Wallet-Import verfügbar",
      detail: `${chainConfig[chain].name}-Wallet synchronisieren`,
    };
  }
  if (ETHEREUM_ERC20_COIN_IDS.has(coinGeckoId)) {
    return {
      type: "erc20",
      chain: "ETH",
      label: "Über Ethereum importierbar",
      detail: "ERC-20 auf Ethereum Mainnet",
    };
  }
  return {
    type: "market",
    chain: null,
    label: "Marktbeobachtung",
    detail: "Wallet-Import noch nicht eingerichtet",
  };
}

function buildTopMarketCatalog(rows, chainConfig, limit = 30) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, limit).map((row, index) => {
    const coinGeckoId = String(row?.id || "").trim();
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    const directChain = chainForCoinGeckoId(coinGeckoId, chainConfig);
    const support = importSupportForCoin(coinGeckoId, chainConfig);
    return {
      id: coinGeckoId || `market-${index + 1}`,
      rank: Number.isSafeInteger(Number(row?.market_cap_rank)) ? Number(row.market_cap_rank) : index + 1,
      name: String(row?.name || symbol || "Unbekannter Coin").trim(),
      symbol: symbol || "?",
      icon: directChain ? chainConfig[directChain].icon : symbol.slice(0, 1) || "◇",
      priceEur: finiteNumber(row?.current_price),
      marketCapEur: finiteNumber(row?.market_cap),
      change24h: finiteNumber(row?.price_change_percentage_24h),
      lastUpdated: typeof row?.last_updated === "string" ? row.last_updated : null,
      import: support,
    };
  });
}

module.exports = { buildTopMarketCatalog, importSupportForCoin };
