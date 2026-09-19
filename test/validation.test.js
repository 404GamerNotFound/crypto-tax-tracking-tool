const test = require("node:test");
const assert = require("node:assert/strict");
const bitcoin = require("bitcoinjs-lib");
const { cleanLabel, isValidAddress, isValidCardanoStakeAddress } = require("../lib/validation");

test("validiert typische Bitcoin-Adressen", () => {
  assert.equal(isValidAddress("BTC", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080"), true);
  assert.equal(isValidAddress("BTC", "not-a-bitcoin-address"), false);
});

test("validiert typische Tezos-Adressen", () => {
  assert.equal(isValidAddress("XTZ", "tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb"), true);
  assert.equal(isValidAddress("XTZ", "tz1invalid"), false);
});

test("validiert typische TRON-Adressen", () => {
  const address = bitcoin.address.toBase58Check(Buffer.alloc(20, 7), 0x41);
  assert.equal(isValidAddress("TRX", address), true);
  assert.equal(isValidAddress("TRX", "TzuKurz"), false);
});

test("validiert Cardano-Mainnet-Zahlungsadressen", () => {
  const address = `addr1${"q".repeat(98)}`;
  assert.equal(isValidAddress("ADA", address), true);
  assert.equal(isValidAddress("ADA", "addr_test1qwerty"), false);
});

test("validiert Cardano-Mainnet-Stake-Adressen", () => {
  assert.equal(isValidCardanoStakeAddress(`stake1${"q".repeat(54)}`), true);
  assert.equal(isValidCardanoStakeAddress("addr1qwerty"), false);
});

test("validiert Ethereum-Mainnet-Adressen", () => {
  assert.equal(isValidAddress("ETH", "0x52908400098527886E0F7030069857D2E4169EE7"), true);
  assert.equal(isValidAddress("ETH", "0x1234"), false);
});

test("bereinigt Beschriftungen", () => {
  assert.equal(cleanLabel("  Meine   Wallet  "), "Meine Wallet");
});
