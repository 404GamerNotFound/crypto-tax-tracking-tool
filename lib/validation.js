const CHAIN_CONFIG = {
  BTC: {
    name: "Bitcoin",
    asset: "BTC",
    explorerAddress: (address) => `https://blockstream.info/address/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://blockstream.info/tx/${encodeURIComponent(hash)}`,
  },
  XTZ: {
    name: "Tezos",
    asset: "XTZ",
    explorerAddress: (address) => `https://tzkt.io/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://tzkt.io/${encodeURIComponent(hash)}`,
  },
};

function isValidAddress(chain, address) {
  if (typeof address !== "string") return false;
  const value = address.trim();

  if (chain === "BTC") {
    // Mainnet: Legacy, P2SH, native SegWit and Taproot. This is intentionally
    // a format check; the connected explorer remains the authority for validity.
    return /^(?:1|3)[A-HJ-NP-Za-km-z1-9]{25,34}$|^bc1[ac-hj-np-z02-9]{11,87}$/i.test(value);
  }

  if (chain === "XTZ") {
    return /^(?:tz1|tz2|tz3|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
  }

  return false;
}

function cleanLabel(value, maximum = 80) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
}

module.exports = { CHAIN_CONFIG, cleanLabel, isValidAddress };
