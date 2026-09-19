const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanLabel, isValidAddress } = require("../lib/validation");

test("validiert typische Bitcoin-Adressen", () => {
  assert.equal(isValidAddress("BTC", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080"), true);
  assert.equal(isValidAddress("BTC", "not-a-bitcoin-address"), false);
});

test("validiert typische Tezos-Adressen", () => {
  assert.equal(isValidAddress("XTZ", "tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb"), true);
  assert.equal(isValidAddress("XTZ", "tz1invalid"), false);
});

test("bereinigt Beschriftungen", () => {
  assert.equal(cleanLabel("  Meine   Wallet  "), "Meine Wallet");
});
