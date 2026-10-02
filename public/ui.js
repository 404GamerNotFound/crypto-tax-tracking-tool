(() => {
  "use strict";

  const currency = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  });

  const exchangeProviderLabels = Object.freeze({
    binance: "Binance Spot",
    coinbase: "Coinbase Exchange",
    bitvavo: "Bitvavo",
    etoro: "eToro",
    bsdex: "BSDEX",
    trade_republic: "Trade Republic",
  });

  const priceProviderLabels = Object.freeze({
    coingecko: "CoinGecko",
    bitvavo: "Bitvavo",
    coinbase: "Coinbase Exchange",
    kraken: "Kraken",
    cryptocompare: "CryptoCompare",
    tzkt: "TzKT",
    manual: "Manuelle Eingabe",
    legacy: "Quelle nicht nachträglich dokumentiert",
    "binance-api": "Binance-API",
    "binance-csv": "Binance-CSV",
    "coinbase-api": "Coinbase-API",
    "coinbase-csv": "Coinbase-CSV",
    "bitvavo-api": "Bitvavo-API",
    "bitvavo-csv": "Bitvavo-CSV",
    "etoro-api": "eToro-API",
    "etoro-csv": "eToro-CSV",
    "bsdex-api": "BSDEX-API",
    "bsdex-csv": "BSDEX-CSV",
    "trade_republic-api": "Trade-Republic-Import",
    "trade_republic-csv": "Trade-Republic-CSV",
    csv: "CSV-Import",
    adapter: "Blockchain-Adapter",
  });

  const purposePresentation = Object.freeze({
    "Staking Rewards": ["✦", "staking", "Staking-Ertrag"],
    Kauf: ["↗", "purchase", "Kauf"],
    Verkauf: ["↘", "sale", "Verkauf"],
    "Mining Reward": ["⛏", "mining", "Mining-Ertrag"],
    Airdrop: ["◇", "gift", "Airdrop"],
    "Lending-Ertrag": ["✦", "staking", "Lending-Ertrag"],
    "DeFi-Ertrag": ["✦", "staking", "DeFi-Ertrag"],
    "DeFi Swap": ["⇄", "transfer", "DeFi-Swap"],
    "Liquidity Pool": ["◒", "staking", "Liquiditätspool"],
    Bridge: ["⇆", "transfer", "Bridge"],
    NFT: ["▣", "gift", "NFT"],
    Spam: ["!", "other", "Spam / ignorieren"],
    Transfer: ["↔", "transfer", "Transfer"],
    Geschenk: ["◇", "gift", "Geschenk"],
    Gebühr: ["−", "fee", "Gebühr"],
    Sonstiges: ["•", "other", "Sonstiges"],
  });

  function el(id) {
    return document.getElementById(id);
  }

  function node(tag, className, text) {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  }

  function cell(value) {
    return node("td", "", value);
  }

  function hasNumber(value) {
    return value !== null && value !== "" && value !== undefined && Number.isFinite(Number(value));
  }

  function formatCurrency(value, fallback = "k. A.") {
    return hasNumber(value) ? currency.format(Number(value)) : fallback;
  }

  function parseDbDate(value) {
    if (!value) return null;
    const text = String(value);
    const date = new Date(text.includes("T") ? text : `${text}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function priceProviderLabel(provider, fallback = "nicht dokumentiert") {
    return priceProviderLabels[provider] || (provider ? String(provider) : fallback);
  }

  function exchangeProviderLabel(provider, fallback = "Börse") {
    return exchangeProviderLabels[provider] || fallback;
  }

  function purposeInfo(transaction = {}) {
    const [icon, tone, label] = purposePresentation[transaction.purpose]
      || (transaction.purpose ? ["•", "custom", transaction.purpose] : ["?", "unassigned", "Noch nicht zugeordnet"]);
    const origin = transaction.purpose_origin === "auto"
      ? "automatisch erkannt"
      : transaction.purpose_origin === "manual"
        ? "manuell zugeordnet"
        : "Herkunft prüfen";
    return { icon, tone, label, origin };
  }

  function toast(message, kind = "success", { duration = 4200 } = {}) {
    const container = el("toast");
    if (!container) return;
    container.textContent = message;
    container.className = `toast ${kind}`;
    container.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { container.hidden = true; }, duration);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Der Vorgang ist fehlgeschlagen.");
    return payload;
  }

  window.CryptoBuchUI = Object.freeze({
    api,
    cell,
    el,
    exchangeProviderLabel,
    formatCurrency,
    hasNumber,
    node,
    parseDbDate,
    priceProviderLabel,
    purposeInfo,
    toast,
  });
})();
