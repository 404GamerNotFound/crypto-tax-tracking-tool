const test = require("node:test");
const assert = require("node:assert/strict");
const { LOVELACE_PER_ADA, lovelaceFromAmounts, normalizeCardanoTransaction } = require("../lib/cardano");

const wallet = `addr1${"q".repeat(98)}`;
const sender = `addr1${"p".repeat(98)}`;
const recipient = `addr1${"r".repeat(98)}`;

test("liest Lovelace aus dem Blockfrost-Amount-Array", () => {
  assert.equal(lovelaceFromAmounts([{ unit: "asset", quantity: "5" }, { unit: "lovelace", quantity: "1250000" }]), 1_250_000);
  assert.equal(LOVELACE_PER_ADA, 1_000_000);
});

test("normalisiert einen Cardano-Eingang", () => {
  const transaction = normalizeCardanoTransaction({
    hash: "a".repeat(64),
    block_time: 1_700_000_000,
    fee: "170000",
    inputs: [{ address: sender, amount: [{ unit: "lovelace", quantity: "2500000" }] }],
    outputs: [{ address: wallet, amount: [{ unit: "lovelace", quantity: "2500000" }] }],
  }, wallet);
  assert.equal(transaction.direction, "in");
  assert.equal(transaction.asset, "ADA");
  assert.equal(transaction.amount, 2.5);
  assert.equal(transaction.counterparty, sender);
  assert.equal(transaction.timestamp, "2023-11-14T22:13:20.000Z");
});

test("normalisiert einen Cardano-Ausgang mit Wechselgeld", () => {
  const transaction = normalizeCardanoTransaction({
    hash: "b".repeat(64),
    block_time: 1_700_000_001,
    fee: "170000",
    inputs: [{ address: wallet, amount: [{ unit: "lovelace", quantity: "5000000" }] }],
    outputs: [
      { address: recipient, amount: [{ unit: "lovelace", quantity: "3000000" }] },
      { address: wallet, amount: [{ unit: "lovelace", quantity: "1830000" }] },
    ],
  }, wallet);
  assert.equal(transaction.direction, "out");
  assert.equal(transaction.amount, 3.17);
  assert.equal(transaction.fee, 0.17);
  assert.equal(transaction.counterparty, recipient);
});

test("fasst Transaktionen mehrerer einer Stake-Adresse zugeordneter Zahlungsadressen zusammen", () => {
  const secondAddress = `addr1${"s".repeat(98)}`;
  const transaction = normalizeCardanoTransaction({
    hash: "c".repeat(64),
    block_time: 1_700_000_002,
    inputs: [{ address: wallet, amount: [{ unit: "lovelace", quantity: "4000000" }] }],
    outputs: [
      { address: secondAddress, amount: [{ unit: "lovelace", quantity: "1000000" }] },
      { address: recipient, amount: [{ unit: "lovelace", quantity: "3000000" }] },
    ],
  }, new Set([wallet, secondAddress]));
  assert.equal(transaction.direction, "out");
  assert.equal(transaction.amount, 3);
  assert.equal(transaction.counterparty, recipient);
});
