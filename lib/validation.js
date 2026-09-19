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
  ETH: {
    name: "Ethereum",
    asset: "ETH",
    decimals: 18,
    icon: "◆",
    addressPlaceholder: "0x…",
    addressHint: "Ethereum: öffentliche Mainnet-Adressen beginnen mit 0x. Native ETH- und ERC-20-Transfers werden importiert.",
    coinGeckoId: "ethereum",
    explorer: {
      address: "https://etherscan.io/address/{value}",
      transaction: "https://etherscan.io/tx/{value}",
    },
    explorerAddress: (address) => `https://etherscan.io/address/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://etherscan.io/tx/${encodeURIComponent(hash)}`,
  },
  BNB: {
    name: "BNB Smart Chain",
    asset: "BNB",
    decimals: 18,
    icon: "B",
    addressPlaceholder: "0x…",
    addressHint: "BNB Smart Chain: öffentliche EVM-Adresse. Native BNB-Transfers werden über BscScan synchronisiert.",
    coinGeckoId: "binancecoin",
    explorer: {
      address: "https://bscscan.com/address/{value}",
      transaction: "https://bscscan.com/tx/{value}",
    },
    explorerAddress: (address) => `https://bscscan.com/address/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://bscscan.com/tx/${encodeURIComponent(hash)}`,
  },
  SOL: {
    name: "Solana",
    asset: "SOL",
    decimals: 9,
    icon: "S",
    addressPlaceholder: "Base58-Adresse…",
    addressHint: "Solana: öffentliche Base58-Wallet-Adresse. Native SOL-Transfers werden über Solscan synchronisiert.",
    coinGeckoId: "solana",
    explorer: {
      address: "https://solscan.io/account/{value}",
      transaction: "https://solscan.io/tx/{value}",
    },
    explorerAddress: (address) => `https://solscan.io/account/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://solscan.io/tx/${encodeURIComponent(hash)}`,
  },
  XRP: {
    name: "XRP Ledger",
    asset: "XRP",
    decimals: 6,
    icon: "X",
    addressPlaceholder: "r…",
    addressHint: "XRP Ledger: öffentliche Classic-Adresse. Native XRP-Payments werden über einen XRPL-RPC-Server synchronisiert.",
    coinGeckoId: "ripple",
    explorer: {
      address: "https://livenet.xrpl.org/accounts/{value}",
      transaction: "https://livenet.xrpl.org/transactions/{value}",
    },
    explorerAddress: (address) => `https://livenet.xrpl.org/accounts/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://livenet.xrpl.org/transactions/${encodeURIComponent(hash)}`,
  },
  DOGE: {
    name: "Dogecoin",
    asset: "DOGE",
    decimals: 8,
    icon: "Ð",
    addressPlaceholder: "D…",
    addressHint: "Dogecoin: öffentliche Mainnet-Adresse. Transaktionen werden über BlockCypher synchronisiert.",
    coinGeckoId: "dogecoin",
    explorer: {
      address: "https://live.blockcypher.com/doge/address/{value}",
      transaction: "https://live.blockcypher.com/doge/tx/{value}",
    },
    explorerAddress: (address) => `https://live.blockcypher.com/doge/address/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://live.blockcypher.com/doge/tx/${encodeURIComponent(hash)}`,
  },
  XLM: {
    name: "Stellar",
    asset: "XLM",
    decimals: 7,
    icon: "✦",
    addressPlaceholder: "G…",
    addressHint: "Stellar: öffentliche G…-Account-ID. Native XLM-Payments werden über Horizon synchronisiert.",
    coinGeckoId: "stellar",
    explorer: {
      address: "https://stellar.expert/explorer/public/account/{value}",
      transaction: "https://stellar.expert/explorer/public/tx/{value}",
    },
    explorerAddress: (address) => `https://stellar.expert/explorer/public/account/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://stellar.expert/explorer/public/tx/${encodeURIComponent(hash)}`,
  },
  BCH: {
    name: "Bitcoin Cash",
    asset: "BCH",
    decimals: 8,
    icon: "Ƀ",
    addressPlaceholder: "bitcoincash:q…",
    addressHint: "Bitcoin Cash: öffentliche CashAddr-Adresse. Transaktionen werden über Blockchair synchronisiert.",
    coinGeckoId: "bitcoin-cash",
    explorer: {
      address: "https://blockchair.com/bitcoin-cash/address/{value}",
      transaction: "https://blockchair.com/bitcoin-cash/transaction/{value}",
    },
    explorerAddress: (address) => `https://blockchair.com/bitcoin-cash/address/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://blockchair.com/bitcoin-cash/transaction/${encodeURIComponent(hash)}`,
  },
  NEAR: {
    name: "NEAR Protocol",
    asset: "NEAR",
    decimals: 24,
    icon: "N",
    addressPlaceholder: "name.near oder 64-stellig…",
    addressHint: "NEAR: öffentliche Konto-ID oder implizite 64-stellige Adresse. Native Transfers werden über NearBlocks synchronisiert.",
    coinGeckoId: "near",
    explorer: {
      address: "https://nearblocks.io/address/{value}",
      transaction: "https://nearblocks.io/txns/{value}",
    },
    explorerAddress: (address) => `https://nearblocks.io/address/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://nearblocks.io/txns/${encodeURIComponent(hash)}`,
  },
  LTC: {
    name: "Litecoin",
    asset: "LTC",
    decimals: 8,
    icon: "Ł",
    addressPlaceholder: "ltc1… oder L…",
    addressHint: "Litecoin: öffentliche Legacy- oder SegWit-Adresse. Transaktionen werden über BlockCypher synchronisiert.",
    coinGeckoId: "litecoin",
    explorer: {
      address: "https://live.blockcypher.com/ltc/address/{value}",
      transaction: "https://live.blockcypher.com/ltc/tx/{value}",
    },
    explorerAddress: (address) => `https://live.blockcypher.com/ltc/address/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://live.blockcypher.com/ltc/tx/${encodeURIComponent(hash)}`,
  },
  AVAX: {
    name: "Avalanche C-Chain",
    asset: "AVAX",
    decimals: 18,
    icon: "A",
    addressPlaceholder: "0x…",
    addressHint: "Avalanche C-Chain: öffentliche EVM-Adresse. Native AVAX-Transfers werden über Snowtrace synchronisiert.",
    coinGeckoId: "avalanche-2",
    explorer: {
      address: "https://snowtrace.io/address/{value}",
      transaction: "https://snowtrace.io/tx/{value}",
    },
    explorerAddress: (address) => `https://snowtrace.io/address/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://snowtrace.io/tx/${encodeURIComponent(hash)}`,
  },
  TON: {
    name: "The Open Network",
    asset: "TON",
    decimals: 9,
    icon: "◉",
    addressPlaceholder: "UQ… oder EQ…",
    addressHint: "TON: öffentliche Friendly-Address. Native TON-Transfers werden über TonAPI synchronisiert.",
    coinGeckoId: "the-open-network",
    explorer: {
      address: "https://tonviewer.com/{value}",
      transaction: "https://tonviewer.com/transaction/{value}",
    },
    explorerAddress: (address) => `https://tonviewer.com/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://tonviewer.com/transaction/${encodeURIComponent(hash)}`,
  },
  ZEC: {
    name: "Zcash",
    asset: "ZEC",
    decimals: 8,
    icon: "Z",
    addressPlaceholder: "t1…",
    addressHint: "Zcash: nur öffentliche transparente t1-Adressen. Shielded-Adressen sind absichtlich nicht mit einer öffentlichen Historie auslesbar.",
    coinGeckoId: "zcash",
    explorer: {
      address: "https://blockchair.com/zcash/address/{value}",
      transaction: "https://blockchair.com/zcash/transaction/{value}",
    },
    explorerAddress: (address) => `https://blockchair.com/zcash/address/${encodeURIComponent(address)}`,
    explorerTx: (hash) => `https://blockchair.com/zcash/transaction/${encodeURIComponent(hash)}`,
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

  if (chain === "ETH") {
    return /^0x[a-fA-F0-9]{40}$/.test(value);
  }

  if (chain === "BNB" || chain === "AVAX") {
    return /^0x[a-fA-F0-9]{40}$/.test(value);
  }

  if (chain === "SOL") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  if (chain === "XRP") return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value);
  if (chain === "DOGE") return /^D[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value);
  if (chain === "XLM") return /^G[A-Z2-7]{55}$/.test(value);
  if (chain === "BCH") return /^(?:bitcoincash:)?q[0-9a-z]{41}$/i.test(value);
  if (chain === "NEAR") return /^(?:[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]|[a-f0-9]{64})$/.test(value);
  if (chain === "LTC") return /^(?:L|M)[A-HJ-NP-Za-km-z1-9]{25,34}$|^ltc1[ac-hj-np-z02-9]{11,87}$/i.test(value);
  if (chain === "TON") return /^(?:[EU]Q[A-Za-z0-9_-]{46}|0:[a-fA-F0-9]{64})$/.test(value);
  if (chain === "ZEC") return /^t1[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);

  return false;
}

function isValidCardanoStakeAddress(address) {
  return typeof address === "string" && /^stake1[0-9a-z]{20,120}$/.test(address.trim());
}

function cleanLabel(value, maximum = 80) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
}

module.exports = { CHAIN_CONFIG, cleanLabel, isValidAddress, isValidCardanoStakeAddress };
