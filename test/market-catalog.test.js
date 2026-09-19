const test = require("node:test");
const assert = require("node:assert/strict");
const { CHAIN_CONFIG } = require("../lib/validation");
const { buildTopMarketCatalog } = require("../lib/market-catalog");

test("ordnet Top-Marktwerte Wallet-Netzen, ERC-20 und Marktbeobachtung zu", () => {
  const catalog = buildTopMarketCatalog([
    { id: "bitcoin", symbol: "btc", name: "Bitcoin", market_cap_rank: 1, current_price: 71000 },
    { id: "usd-coin", symbol: "usdc", name: "USDC", market_cap_rank: 6, current_price: 0.87 },
    { id: "hyperliquid", symbol: "hype", name: "Hyperliquid", market_cap_rank: 7, current_price: 97 },
  ], CHAIN_CONFIG);

  assert.equal(catalog[0].import.type, "native");
  assert.equal(catalog[0].import.chain, "BTC");
  assert.equal(catalog[1].import.type, "erc20");
  assert.equal(catalog[1].import.chain, "ETH");
  assert.equal(catalog[2].import.type, "market");
  assert.equal(catalog[2].priceEur, 97);
});

test("begrenzt den Katalog auf 30 aktuelle Coins", () => {
  const rows = Array.from({ length: 31 }, (_, index) => ({ id: `coin-${index}`, symbol: `c${index}`, name: `Coin ${index}` }));
  assert.equal(buildTopMarketCatalog(rows, CHAIN_CONFIG).length, 30);
});
