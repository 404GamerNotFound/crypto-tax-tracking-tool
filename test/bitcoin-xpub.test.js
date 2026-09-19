const test = require("node:test");
const assert = require("node:assert/strict");
const ecc = require("tiny-secp256k1");
const { BIP32Factory } = require("bip32");
const bs58check = require("bs58check").default;
const { deriveXpubAddress, inspectXpub, parseXpub } = require("../lib/bitcoin-xpub");

const bip32 = BIP32Factory(ecc);
const xpub = bip32.fromSeed(Buffer.alloc(32, 1)).neutered().toBase58();

function withVersion(key, version) {
  const decoded = Buffer.from(bs58check.decode(key));
  decoded.writeUInt32BE(version, 0);
  return bs58check.encode(decoded);
}

test("leitet Legacy-, Nested- und Native-SegWit-Adressen aus einem xPub ab", () => {
  assert.match(deriveXpubAddress(xpub, 0, 0, "p2pkh"), /^1/);
  assert.match(deriveXpubAddress(xpub, 0, 0, "p2sh-p2wpkh"), /^3/);
  assert.match(deriveXpubAddress(xpub, 1, 0, "p2wpkh"), /^bc1q/);
});

test("erkennt yPub und zPub und verwendet ihr passendes Adressformat", () => {
  const ypub = withVersion(xpub, 0x049d7cb2);
  const zpub = withVersion(xpub, 0x04b24746);
  assert.equal(inspectXpub(ypub).addressType, "p2sh-p2wpkh");
  assert.equal(inspectXpub(zpub).addressType, "p2wpkh");
  assert.match(deriveXpubAddress(ypub, 0, 0, "p2sh-p2wpkh"), /^3/);
  assert.match(deriveXpubAddress(zpub, 0, 0, "p2wpkh"), /^bc1q/);
});

test("entfernt Einfüge-Leerzeichen und erklärt ungültige Base58-Zeichen", () => {
  const pasted = `“${xpub.slice(0, 30)}\n ${xpub.slice(30)}\u200b”`;
  assert.equal(parseXpub(pasted).neutered().toBase58(), xpub);
  assert.throws(() => parseXpub(`${xpub.slice(0, 20)}0${xpub.slice(21)}`), /ungültiges Zeichen/i);
});

test("akzeptiert keine privaten oder nicht-mainnet extended keys", () => {
  assert.throws(() => parseXpub("xprv9s21ZrQH143K3"), /privaten Schlüssel/i);
});
