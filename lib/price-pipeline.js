// Identity is resolved before selecting work: unknown symbols must not consume
// retry budgets. Mappings are scoped to a source wallet, never guessed globally.
function resolvePriceAsset(transaction, chains, exchangeAssets, mappings = new Map()) {
  if ((transaction.asset_type || transaction.assetType) === "nft") return null;
  const contract = String(transaction.asset_contract || transaction.assetContract || "").toLowerCase();
  if (contract) return /^0x[a-f0-9]{40}$/.test(contract) && transaction.chain === "ETH"
    ? { coinId: `erc20:ethereum:${contract}`, contract, symbol: transaction.asset }
    : null;
  const native = Object.values(chains).find((config) => config.asset === transaction.asset);
  const mapped = mappings.get(`${transaction.wallet_id}:${transaction.asset}`);
  const coinId = native?.coinGeckoId || exchangeAssets[transaction.asset]?.coinGeckoId || mapped;
  return coinId ? { coinId, symbol: transaction.asset, custom: !native && !exchangeAssets[transaction.asset] } : null;
}

function priceGroupKey(transaction) {
  return `${transaction.priceAsset.coinId}|${new Date(transaction.timestamp).toISOString().slice(0, 10)}`;
}

function selectPriceBatch(rows, { limit, force = false, walletId = null, now = Date.now() }) {
  const available = rows.filter((row) => row.priceAsset && Number.isFinite(Date.parse(row.timestamp)));
  const due = available.filter((row) => (!walletId || row.wallet_id === walletId)
    && (force || !row.next_attempt_at || Date.parse(row.next_attempt_at) <= now));
  due.sort((a, b) => (Date.parse(a.last_attempt_at) || 0) - (Date.parse(b.last_attempt_at) || 0)
    || Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id - b.id);
  const keys = [...new Set(due.map(priceGroupKey))];
  const selected = new Set(keys.slice(0, limit));
  return { rows: available.filter((row) => selected.has(priceGroupKey(row))), groups: selected.size, hasMore: keys.length > limit };
}

function validatePriceMapping(input) {
  const walletId = Number(input?.walletId);
  const asset = String(input?.asset || "").trim().toUpperCase();
  const coinGeckoId = String(input?.coinGeckoId || "").trim();
  if (!Number.isSafeInteger(walletId) || walletId <= 0 || !/^[A-Z0-9][A-Z0-9._-]{0,47}$/.test(asset)
    || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(coinGeckoId) || input?.confirmed !== true) {
    throw new Error("Bitte Quelle, Asset und gültige CoinGecko-ID angeben und die Zuordnung ausdrücklich bestätigen.");
  }
  return { walletId, asset, coinGeckoId };
}

module.exports = { resolvePriceAsset, priceGroupKey, selectPriceBatch, validatePriceMapping };
