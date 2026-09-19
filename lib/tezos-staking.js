function normalizePayoutAlias(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") : "";
}

function trustedPayoutAliases(value) {
  return new Set(
    String(value || "Stake.fish Payouts")
      .split(",")
      .map(normalizePayoutAlias)
      .filter(Boolean),
  );
}

function isConfirmedStakingPayout(transaction, walletAddress, trustedAliases) {
  const alias = normalizePayoutAlias(transaction?.sender?.alias);
  return Boolean(
    transaction?.status === "applied"
      && transaction?.target?.address === walletAddress
      && transaction?.sender?.address !== walletAddress
      && alias
      && trustedAliases.has(alias),
  );
}

module.exports = { isConfirmedStakingPayout, normalizePayoutAlias, trustedPayoutAliases };
