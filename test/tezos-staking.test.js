const test = require("node:test");
const assert = require("node:assert/strict");
const { isConfirmedStakingPayout, trustedPayoutAliases } = require("../lib/tezos-staking");

const trustedAliases = trustedPayoutAliases("Stake.fish Payouts, My Trusted Baker");

test("erkennt einen bestätigten Stake.fish-Payout als Staking Reward", () => {
  assert.equal(isConfirmedStakingPayout({
    status: "applied",
    sender: { address: "tz1stake", alias: "Stake.fish Payouts" },
    target: { address: "tz1wallet" },
  }, "tz1wallet", trustedAliases), true);
});

test("markiert unbestätigte oder nicht vertrauenswürdige Eingänge nicht als Staking", () => {
  assert.equal(isConfirmedStakingPayout({
    status: "backtracked",
    sender: { address: "tz1stake", alias: "Stake.fish Payouts" },
    target: { address: "tz1wallet" },
  }, "tz1wallet", trustedAliases), false);

  assert.equal(isConfirmedStakingPayout({
    status: "applied",
    sender: { address: "tz1other", alias: "Unbekannte Auszahlung" },
    target: { address: "tz1wallet" },
  }, "tz1wallet", trustedAliases), false);
});
