const bitcoin = require("bitcoinjs-lib");
const ecc = require("tiny-secp256k1");
const { BIP32Factory } = require("bip32");

const bip32 = BIP32Factory(ecc);
const XPUB_ADDRESS_TYPES = new Set(["p2pkh", "p2sh-p2wpkh", "p2wpkh"]);

function parseXpub(value) {
  const xpub = typeof value === "string" ? value.trim() : "";
  if (!xpub.startsWith("xpub")) {
    throw new Error("Bitte einen Bitcoin-Mainnet-xPub eingeben. xPrv/Seed-Phrases werden nicht akzeptiert.");
  }
  try {
    const node = bip32.fromBase58(xpub, bitcoin.networks.bitcoin);
    if (!node.isNeutered()) throw new Error("Die Eingabe enthält einen privaten Schlüssel.");
    return node;
  } catch (error) {
    throw new Error(error.message || "Ungültiger Bitcoin-xPub.");
  }
}

function deriveXpubAddress(xpub, branch, index, addressType) {
  if (![0, 1].includes(branch) || !Number.isSafeInteger(index) || index < 0) {
    throw new Error("Ungültiger Ableitungspfad für den xPub.");
  }
  if (!XPUB_ADDRESS_TYPES.has(addressType)) throw new Error("Nicht unterstütztes Bitcoin-Adressformat.");

  const node = parseXpub(xpub).derive(branch).derive(index);
  const pubkey = Buffer.from(node.publicKey);
  const network = bitcoin.networks.bitcoin;
  let address;

  if (addressType === "p2pkh") {
    address = bitcoin.payments.p2pkh({ pubkey, network }).address;
  } else if (addressType === "p2sh-p2wpkh") {
    const redeem = bitcoin.payments.p2wpkh({ pubkey, network });
    address = bitcoin.payments.p2sh({ redeem, network }).address;
  } else {
    address = bitcoin.payments.p2wpkh({ pubkey, network }).address;
  }

  if (!address) throw new Error("Bitcoin-Adresse konnte nicht aus dem xPub abgeleitet werden.");
  return address;
}

module.exports = { XPUB_ADDRESS_TYPES, deriveXpubAddress, parseXpub };
