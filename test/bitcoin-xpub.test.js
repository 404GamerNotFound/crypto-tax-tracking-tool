const test = require("node:test");
const assert = require("node:assert/strict");
const ecc = require("tiny-secp256k1");
const { BIP32Factory } = require("bip32");
const { deriveXpubAddress, parseXpub } = require("../lib/bitcoin-xpub");

const bip32 = BIP32Factory(ecc);
const xpub = bip32.fromSeed(Buffer.alloc(32, 1)).neutered().toBase58();

test("leitet Legacy-, Nested- und Native-SegWit-Adressen aus einem xPub ab", () => {
  assert.match(deriveXpubAddress(xpub, 0, 0, "p2pkh"), /^1/);
  assert.match(deriveXpubAddress(xpub, 0, 0, "p2sh-p2wpkh"), /^3/);
  assert.match(deriveXpubAddress(xpub, 1, 0, "p2wpkh"), /^bc1q/);
});

test("akzeptiert keine privaten oder nicht-mainnet extended keys", () => {
  assert.throws(() => parseXpub("xprv9s21ZrQH143K3"), /xPub/i);
});
