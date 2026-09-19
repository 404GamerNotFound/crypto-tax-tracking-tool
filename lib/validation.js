const CHAIN_CONFIG = {
  BTC: {
    name: "Bitcoin",
    asset: "BTC",
    decimals: 8,
    icon: "₿",
    addressPlaceholder: "bc1… oder 1…",
    addressHint: "Bitcoin: Legacy-, SegWit- und Taproot-Adressen werden unterstützt.",
    coinGeckoId: "bitcoin",
    explorer: {
      address: "https://blockstream.info/address/{value}",
      transaction: "https://blockstream.info/tx/{value}",
    },
    explorerAddress: (address) => `https://blockstream.info/address/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://blockstream.info/tx/${encodeURIComponent(hash)}`,
  },
  XTZ: {
    name: "Tezos",
    asset: "XTZ",
    decimals: 6,
    icon: "ꜩ",
    addressPlaceholder: "tz1… oder KT1…",
    addressHint: "Tezos: tz1-, tz2-, tz3- und KT1-Adressen werden unterstützt.",
    coinGeckoId: "tezos",
    explorer: {
      address: "https://tzkt.io/{value}",
      transaction: "https://tzkt.io/{value}",
    },
    explorerAddress: (address) => `https://tzkt.io/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://tzkt.io/${encodeURIComponent(hash)}`,
  },
  TRX: {
    name: "TRON",
    asset: "TRX",
    decimals: 6,
    icon: "T",
    addressPlaceholder: "T…",
    addressHint: "TRON: Öffentliche Mainnet-Adressen beginnen mit T und haben 34 Zeichen.",
    coinGeckoId: "tron",
    explorer: {
      address: "https://tronscan.org/#/address/{value}",
      transaction: "https://tronscan.org/#/transaction/{value}",
    },
    explorerAddress: (address) => `https://tronscan.org/#/address/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://tronscan.org/#/transaction/${encodeURIComponent(hash)}`,
  },
  ADA: {
    name: "Cardano",
    asset: "ADA",
    decimals: 6,
    icon: "₳",
    addressPlaceholder: "addr1…",
    addressHint: "Cardano: öffentliche Mainnet-Zahlungsadressen beginnen mit addr1. Für den Import wird eine Blockfrost Project-ID benötigt.",
    coinGeckoId: "cardano",
    explorer: {
      address: "https://cardanoscan.io/address/{value}",
      transaction: "https://cardanoscan.io/transaction/{value}",
    },
    explorerAddress: (address) => `https://cardanoscan.io/address/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://cardanoscan.io/transaction/${encodeURIComponent(hash)}`,
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

  if (chain === "TRX") {
    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
  }

  if (chain === "ADA") {
    // Cardano mainnet payment addresses are lower-case Bech32 values. The
    // permissive range also covers enterprise and script payment addresses.
    return /^addr1[0-9a-z]{20,120}$/.test(value);
  }

  return false;
}

function cleanLabel(value, maximum = 80) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
}

module.exports = { CHAIN_CONFIG, cleanLabel, isValidAddress };
