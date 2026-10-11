const test = require("node:test");
const assert = require("node:assert/strict");
const {
  bitvavoDailyClosePrices, coinbaseDailyClosePrices, coinGeckoDate, coinGeckoHeaders, closestPriceForDate,
  cryptoCompareDailyClosePrices, krakenDailyClosePrices, needsExtendedCoinGeckoHistory, usesCoinGeckoPro,
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

test("liest Tages-Schlusskurse aus den zusätzlichen Preisquellen", () => {
  assert.equal(coinbaseDailyClosePrices([[1745798400, "82661", "84255", "81785", "83318", "821.82"]]).get("2025-04-28"), 83318);
  assert.equal(cryptoCompareDailyClosePrices({ Data: { Data: [{ time: 1745798400, close: "83319" }] } }).get("2025-04-28"), 83319);
  assert.equal(krakenDailyClosePrices({ result: { BTCEUR: [[1745798400, "82661", "84255", "81785", "83320", "821.82"]], last: 1745884800 } }).get("2025-04-28"), 83320);
});

test('akzeptiert keine Nachbartage und dokumentiert den tatsächlichen Messzeitpunkt', () => {
  const { priceSampleForDate } = require('../lib/historical-prices');
  assert.equal(closestPriceForDate([[Date.parse('2025-09-04'), 123]], '2025-09-01'), null);
  assert.equal(closestPriceForDate([[Date.parse('2025-09-02'), 123]], '2025-09-01'), null);
  assert.deepEqual(priceSampleForDate([null, [Date.parse('2025-09-01T11:00:00Z'), 20], [Date.parse('2025-09-01T12:00:00Z'), 21]], '2025-09-01'),
    { price: 21, observedAt: '2025-09-01T12:00:00.000Z', method: 'daily_reference' });
});

test('berücksichtigt UTC-Tagesabschluss, Demo-Grenze und Retry-After', () => {
  const { historicalDayReady, coinGeckoHistoryAllowed, retryAfterMilliseconds } = require('../lib/historical-prices');
  const now = Date.parse('2026-10-11T00:40:00Z');
  assert.equal(historicalDayReady('2026-10-10', now - 1), false);
  assert.equal(historicalDayReady('2026-10-10', now), true);
  assert.equal(historicalDayReady('2026-10-11', now), false);
  assert.equal(coinGeckoHistoryAllowed('2025-01-01', 'https://api.coingecko.com/api/v3', now), false);
  assert.equal(coinGeckoHistoryAllowed('2025-01-01', 'https://pro-api.coingecko.com/api/v3', now), true);
  assert.equal(retryAfterMilliseconds('120', now), 120000);
  assert.equal(retryAfterMilliseconds(new Date(now + 180000).toUTCString(), now), 180000);
  assert.equal(retryAfterMilliseconds('unbekannt', now), 60000);
});
