const INCOME_PURPOSES = new Set([
  "Staking Rewards",
  "Mining Reward",
  "Airdrop",
  "Lending-Ertrag",
  "DeFi-Ertrag",
]);

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function dayOf(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function bookValueDelta(transaction) {
  const amount = positiveNumber(transaction?.amount);
  const price = positiveNumber(transaction?.price_transaction_eur);
  if (!amount || !price) return 0;
  const value = amount * price;
  if (transaction.direction === "in" && (transaction.purpose === "Kauf" || INCOME_PURPOSES.has(transaction.purpose))) return value;
  if (transaction.direction === "out" && transaction.purpose === "Verkauf") return -value;
  // Transfers, Swaps and unclassified movements must not simulate a capital
  // inflow or outflow. They are visible in the journal and tax centre instead.
  return 0;
}

function buildBookValueHistory(transactions) {
  const byDay = new Map();
  let cumulativeValue = 0;
  const chronological = [...(transactions || [])]
    .filter((transaction) => dayOf(transaction?.timestamp))
    .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)) || Number(left.id || 0) - Number(right.id || 0));
  for (const transaction of chronological) {
    const delta = bookValueDelta(transaction);
    if (!delta) continue;
    cumulativeValue += delta;
    byDay.set(dayOf(transaction.timestamp), cumulativeValue);
  }
  return [...byDay.entries()].map(([day, valueEur]) => ({ day, valueEur }));
}

module.exports = { INCOME_PURPOSES, bookValueDelta, buildBookValueHistory };
