const test = require("node:test");
const assert = require("node:assert/strict");
const bitcoin = require("bitcoinjs-lib");
const { normalizeTronNativeTransfer, tronAddressToHex, tronHexToAddress } = require("../lib/tron");

const sender = bitcoin.address.toBase58Check(Buffer.alloc(20, 1), 0x41);
const recipient = bitcoin.address.toBase58Check(Buffer.alloc(20, 2), 0x41);

test("wandelt TRON-Adressformate verlustfrei um", () => {
  assert.equal(tronHexToAddress(tronAddressToHex(sender)), sender);
  assert.equal(tronAddressToHex("nicht-eine-tron-adresse"), null);
});

test("normalisiert bestätigte native TRX-Transfers", () => {
  const transfer = normalizeTronNativeTransfer({
    txID: "a".repeat(64),
    block_timestamp: 1_700_000_000_000,
    cost: { fee: 1234 },
    raw_data: {
      contract: [{
        type: "TransferContract",
        parameter: { value: { owner_address: tronAddressToHex(sender), to_address: tronAddressToHex(recipient), amount: 12_500_000 } },
      }],
    },
  }, sender);

  assert.equal(transfer.direction, "out");
  assert.equal(transfer.asset, "TRX");
  assert.equal(transfer.amount, 12.5);
  assert.equal(transfer.fee, 0.001234);
  assert.equal(transfer.counterparty, recipient);
  assert.equal(transfer.timestamp, "2023-11-14T22:13:20.000Z");
});
