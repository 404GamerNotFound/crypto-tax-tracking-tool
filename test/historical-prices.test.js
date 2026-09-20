const test = require("node:test");
const assert = require("node:assert/strict");
const {
  bitvavoDailyClosePrices, coinGeckoDate, coinGeckoHeaders, closestPriceForDate, needsExtendedCoinGeckoHistory, usesCoinGeckoPro,
} = require("../lib/historical-prices");

test("wählt den passenden CoinGecko-Authentifizierungsheader", () => {
  assert.deepEqual(coinGeckoHeaders("https://api.coingecko.com/api/v3", "demo-key"), { "x-cg-demo-api-key": "demo-key" });
  assert.deepEqual(coinGeckoHeaders("https://pro-api.coingecko.com/api/v3", "pro-key"), { "x-cg-pro-api-key": "pro-key" });
  assert.equal(usesCoinGeckoPro("https://pro-api.coingecko.com/api/v3", "pro-key"), true);
  assert.equal(usesCoinGeckoPro("https://api.coingecko.com/api/v3", "demo-key"), false);
});

test("ordnet tägliche Kurse deterministisch dem Transaktionsdatum zu", () => {
  assert.equal(coinGeckoDate("2025-04-28"), "28-04-2025");
  assert.equal(closestPriceForDate([[1745798400000, 81000], [1745884800000, 81500]], "2025-04-28"), 81000);
  assert.equal(needsExtendedCoinGeckoHistory("2025-04-28", new Date("2026-09-20T00:00:00Z").getTime()), true);
});

test("liest Bitvavo-Tages-Schlusskurse als EUR-Historie", () => {
  const prices = bitvavoDailyClosePrices([[1745798400000, "82661", "84255", "81785", "83318", "821.82"]]);
  assert.equal(prices.get("2025-04-28"), 83318);
});
