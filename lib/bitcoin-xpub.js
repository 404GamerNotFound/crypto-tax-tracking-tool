const bitcoin = require("bitcoinjs-lib");
const bs58check = require("bs58check").default;
const ecc = require("tiny-secp256k1");
const { BIP32Factory } = require("bip32");

const bip32 = BIP32Factory(ecc);
const XPUB_ADDRESS_TYPES = new Set(["p2pkh", "p2sh-p2wpkh", "p2wpkh"]);
const XPUB_VERSION = 0x0488b21e;
const EXTENDED_PUBLIC_KEY_VARIANTS = new Map([
  [XPUB_VERSION, { prefix: "xpub", addressType: null }],
  [0x049d7cb2, { prefix: "ypub", addressType: "p2sh-p2wpkh" }],
  [0x04b24746, { prefix: "zpub", addressType: "p2wpkh" }],
]);

function isExtendedPublicKey(value) {
  return /^(?:xpub|ypub|zpub)/i.test(typeof value === "string" ? value.trim() : "");
}

function inspectXpub(value) {
  const extendedKey = typeof value === "string" ? value.trim() : "";
  if (!isExtendedPublicKey(extendedKey)) {
    if (/^(?:xprv|yprv|zprv)/i.test(extendedKey)) {
      throw new Error("Die Eingabe enthält einen privaten Schlüssel. Bitte niemals xPrv, yPrv, zPrv oder eine Seed-Phrase eingeben.");
    }
    throw new Error("Bitte einen Bitcoin-Mainnet-xPub, yPub oder zPub eingeben. Seed-Phrases werden nicht akzeptiert.");
  }

  try {
    const decoded = Buffer.from(bs58check.decode(extendedKey));
    if (decoded.length !== 78) throw new Error("Ungültiger Bitcoin-Extended-Public-Key.");
    const variant = EXTENDED_PUBLIC_KEY_VARIANTS.get(decoded.readUInt32BE(0));
    if (!variant) {
      throw new Error("Dieses Extended-Public-Key-Format wird nicht unterstützt. Unterstützt werden Mainnet-xPub, yPub und zPub.");
    }
    // bip32 understands the canonical xPub version. The key material and path
    // stay unchanged; only its serialization version is normalized.
    decoded.writeUInt32BE(XPUB_VERSION, 0);
    const node = bip32.fromBase58(bs58check.encode(decoded), bitcoin.networks.bitcoin);
    if (!node.isNeutered()) throw new Error("Die Eingabe enthält einen privaten Schlüssel.");
    return { node, ...variant };
  } catch (error) {
    throw new Error(error.message || "Ungültiger Bitcoin-Extended-Public-Key.");
  }
}

function parseXpub(value) {
  return inspectXpub(value).node;
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

module.exports = { XPUB_ADDRESS_TYPES, deriveXpubAddress, inspectXpub, isExtendedPublicKey, parseXpub };
