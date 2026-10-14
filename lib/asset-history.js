function buildAssetValueHistory(transactions, { holdingAmount, currentPriceEur, holdingIsPartial = false, now = Date.now() } = {}) {
  let holding = 0, missingBalanceCount = 0, missingPriceCount = 0;
  const points = [];
  const rows = transactions.filter(row => row.timestamp && Number.isFinite(Date.parse(row.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || Number(a.id || 0) - Number(b.id || 0));
  for (const row of rows) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (row.direction === 'in') holding += amount;
    if (row.direction === 'out') holding -= amount;
    const price = Number(row.price_transaction_eur);
    const missingBalance = holding < -1e-8;
    if (missingBalance) missingBalanceCount++;
    if (!Number.isFinite(price) || price <= 0) missingPriceCount++;
    const value = !missingBalance && Number.isFinite(price) && price > 0 ? Math.max(0, holding) * price : null;
    const point = { timestamp: Date.parse(row.timestamp), value };
    // Equal timestamps form one portfolio state, not a vertical spike.
    if (points.at(-1)?.timestamp === point.timestamp) {
      if (points.at(-1).value === null) point.value = null;
      points[points.length - 1] = point;
    } else points.push(point);
  }
  const holdingMismatch = Number.isFinite(holdingAmount) && Math.abs(holding - holdingAmount) > Math.max(1e-8, Math.abs(holdingAmount) * 1e-8);
  if (!holdingIsPartial && Number.isFinite(holdingAmount) && holdingAmount >= 0 && currentPriceEur > 0 && (!points.length || now > points.at(-1).timestamp)) {
    if (holdingMismatch && points.length) points.push({ timestamp: now - 0.5, value: null });
    points.push({ timestamp: now, value: holdingAmount * currentPriceEur, current: true });
  }
  return { points, missingBalanceCount, missingPriceCount, journalAmount: holding, holdingMismatch };
}
module.exports = { buildAssetValueHistory };
