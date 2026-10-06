const LOVELACE_PER_ADA = 1_000_000;

function lovelaceFromAmounts(amounts) {
  if (!Array.isArray(amounts)) return 0;
  const lovelace = amounts.find((amount) => amount?.unit === "lovelace");
  const quantity = Number(lovelace?.quantity || 0);
  return Number.isFinite(quantity) ? quantity : 0;
}

function lovelaceForAddress(rows, address) {
  if (!Array.isArray(rows)) return 0;
  const addresses = address?.addresses || (address instanceof Set ? address : new Set([address]));
  return rows.reduce((sum, row) => (addresses.has(row?.address) ? sum + lovelaceFromAmounts(row.amount) : sum), 0);
}

function decimal(value, decimals = 6) {
  return Math.round(Number(value || 0) * 10 ** decimals) / 10 ** decimals;
}

function normalizeCardanoTransaction(transaction, address) {
  const addresses = address?.addresses || (address instanceof Set ? address : new Set([address]));
  // Reference inputs never move funds. Failed scripts consume collateral only.
  const effective = (rows) => (rows || []).filter((row) => !row.reference
    && (transaction.valid_contract === false ? row.collateral === true : !row.collateral));
  const inputs = effective(transaction.inputs);
  const outputs = effective(transaction.outputs);
  const received = lovelaceForAddress(outputs, address);
  const spent = lovelaceForAddress(inputs, address);
  // Stake-wallet rewards are booked separately when they become available.
  // Their withdrawal into UTXOs is an internal move, not another acquisition.
  const withdrawn = address?.stakeAddress && transaction.valid_contract !== false
    ? (transaction.withdrawals || []).filter((row) => row.address === address.stakeAddress)
      .reduce((sum, row) => sum + Number(row.amount), 0) : 0;
  const net = received - spent - withdrawn;
  const direction = net > 0 ? "in" : net < 0 ? "out" : "self";
  const counterpartyRows = direction === "in" ? inputs : outputs;
  const counterparty = Array.isArray(counterpartyRows)
    ? counterpartyRows.find((row) => row?.address && !addresses.has(row.address))?.address || null
    : null;

  return {
    externalId: transaction.hash,
    hash: transaction.hash,
    timestamp: transaction.block_time != null && Number.isFinite(Number(transaction.block_time))
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

function normalizeCardanoReward(reward) {
  const amount = Number(reward.amount) / LOVELACE_PER_ADA;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    // Keep existing identities so a resync repairs dates instead of duplicating rewards.
    externalId: `ada-reward:${reward.epoch}:${reward.pool_id || "unknown"}:${reward.amount}`,
    hash: `cardano-reward:${reward.epoch}:${reward.pool_id || "unknown"}`,
    timestamp: reward.available_at || null,
    direction: "in", asset: "ADA", assetSymbol: "ADA", assetName: "Cardano", assetDecimals: 6,
    amount, fee: 0, counterparty: reward.pool_id || null, historicalPrice: null,
    autoPurpose: reward.type === "pool_deposit_refund" ? "Transfer" : "Staking Rewards",
    rawJson: JSON.stringify(reward),
  };
}

async function fetchCardanoRewardHistory(stakeAddress, get) {
  const latest = await get("/epochs/latest");
  if (!Number.isInteger(latest?.epoch)) throw new Error("Cardano: aktuelle Epoche fehlt.");
  const rewards = [];
  const epochs = new Map();
  for (let page = 1; ; page++) {
    const batch = await get(`/accounts/${encodeURIComponent(stakeAddress)}/rewards?count=100&page=${page}&order=asc`);
    if (!Array.isArray(batch)) throw new Error("Cardano: ungültige Prämienliste.");
    for (const reward of batch) {
      if (!Number.isInteger(reward?.epoch) || reward.epoch < 0 || !/^\d+$/.test(String(reward.amount))
        || ![undefined, "member", "leader", "pool_deposit_refund"].includes(reward.type)) {
        throw new Error("Cardano: ungültige Staking-Prämie.");
      }
      // Blockfrost exposes earned_epoch; member/leader rewards are spendable at N+2.
      const availableEpoch = reward.epoch + (reward.type === "pool_deposit_refund" ? 0 : 2);
      if (availableEpoch > latest.epoch) continue;
      if (!epochs.has(availableEpoch)) {
        const epoch = await get(`/epochs/${availableEpoch}`);
        if (!Number.isFinite(epoch?.start_time) || epoch.start_time <= 0) throw new Error("Cardano: Zeit der Prämiengutschrift fehlt.");
        epochs.set(availableEpoch, new Date(epoch.start_time * 1000).toISOString());
      }
      rewards.push({ ...reward, available_epoch: availableEpoch, available_at: epochs.get(availableEpoch), timestamp_source: "blockfrost_spendable_epoch_start" });
    }
    if (batch.length < 100) return rewards;
  }
}

module.exports = { LOVELACE_PER_ADA, lovelaceFromAmounts, normalizeCardanoTransaction, normalizeCardanoReward, fetchCardanoRewardHistory };
