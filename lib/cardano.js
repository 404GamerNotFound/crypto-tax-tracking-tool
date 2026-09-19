const LOVELACE_PER_ADA = 1_000_000;

function lovelaceFromAmounts(amounts) {
  if (!Array.isArray(amounts)) return 0;
  const lovelace = amounts.find((amount) => amount?.unit === "lovelace");
  const quantity = Number(lovelace?.quantity || 0);
  return Number.isFinite(quantity) ? quantity : 0;
}

function lovelaceForAddress(rows, address) {
  if (!Array.isArray(rows)) return 0;
  const addresses = address instanceof Set ? address : new Set([address]);
  return rows.reduce((sum, row) => (addresses.has(row?.address) ? sum + lovelaceFromAmounts(row.amount) : sum), 0);
}

function decimal(value, decimals = 6) {
  return Math.round(Number(value || 0) * 10 ** decimals) / 10 ** decimals;
}

function normalizeCardanoTransaction(transaction, address) {
  const addresses = address instanceof Set ? address : new Set([address]);
  const received = lovelaceForAddress(transaction.outputs, address);
  const spent = lovelaceForAddress(transaction.inputs, address);
  const net = received - spent;
  const direction = net > 0 ? "in" : net < 0 ? "out" : "self";
  const counterpartyRows = direction === "in" ? transaction.inputs : transaction.outputs;
  const counterparty = Array.isArray(counterpartyRows)
    ? counterpartyRows.find((row) => row?.address && !addresses.has(row.address))?.address || null
    : null;

  return {
    externalId: transaction.hash,
    hash: transaction.hash,
    timestamp: Number.isFinite(Number(transaction.block_time))
      ? new Date(Number(transaction.block_time) * 1000).toISOString()
      : null,
    direction,
    asset: "ADA",
    amount: decimal(Math.abs(net) / LOVELACE_PER_ADA),
    fee: direction === "out" ? decimal(Number(transaction.fee || 0) / LOVELACE_PER_ADA) : 0,
    counterparty,
    historicalPrice: null,
    autoPurpose: null,
    rawJson: JSON.stringify(transaction),
  };
}

module.exports = { LOVELACE_PER_ADA, lovelaceFromAmounts, normalizeCardanoTransaction };
