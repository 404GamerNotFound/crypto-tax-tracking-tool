(() => {
  "use strict";

  const currency = new Intl.NumberFormat(window.CryptoBuchI18n.locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  });

  const exchangeProviderLabels = Object.freeze({
    binance: "Binance Spot",
    coinbase: "Coinbase Exchange",
    bitvavo: window.CryptoBuchI18n.t("Bitvavo"),
    etoro: "eToro",
    bsdex: window.CryptoBuchI18n.t("BSDEX"),
    trade_republic: window.CryptoBuchI18n.t("Trade Republic"),
  });

  const priceProviderLabels = Object.freeze({
    coingecko: "CoinGecko",
    bitvavo: window.CryptoBuchI18n.t("Bitvavo"),
    coinbase: "Coinbase Exchange",
    kraken: window.CryptoBuchI18n.t("Kraken"),
    cryptocompare: window.CryptoBuchI18n.t("CryptoCompare"),
    tzkt: window.CryptoBuchI18n.t("TzKT"),
    manual: window.CryptoBuchI18n.t("Manuelle Eingabe"),
    legacy: window.CryptoBuchI18n.t("Quelle nicht nachträglich dokumentiert"),
    "binance-api": window.CryptoBuchI18n.t("Binance-API"),
    "binance-csv": window.CryptoBuchI18n.t("Binance-CSV"),
    "coinbase-api": window.CryptoBuchI18n.t("Coinbase-API"),
    "coinbase-csv": window.CryptoBuchI18n.t("Coinbase-CSV"),
    "bitvavo-api": window.CryptoBuchI18n.t("Bitvavo-API"),
    "bitvavo-csv": window.CryptoBuchI18n.t("Bitvavo-CSV"),
    "etoro-api": "eToro-API",
    "etoro-csv": "eToro-CSV",
    "bsdex-api": window.CryptoBuchI18n.t("BSDEX-API"),
    "bsdex-web": window.CryptoBuchI18n.t("BSDEX-Web-Export"),
    "bsdex-csv": window.CryptoBuchI18n.t("BSDEX-CSV"),
    "trade_republic-api": window.CryptoBuchI18n.t("Trade-Republic-Import"),
    "trade_republic-csv": window.CryptoBuchI18n.t("Trade-Republic-CSV"),
    csv: window.CryptoBuchI18n.t("CSV-Import"),
    adapter: window.CryptoBuchI18n.t("Blockchain-Adapter"),
  });

  const purposePresentation = Object.freeze({
    "Staking Rewards": ["✦", "staking", window.CryptoBuchI18n.t("Staking-Ertrag")],
    Kauf: ["↗", "purchase", "Kauf"],
    Verkauf: ["↘", "sale", "Verkauf"],
    "Mining Reward": ["⛏", "mining", window.CryptoBuchI18n.t("Mining-Ertrag")],
    Airdrop: ["◇", "gift", "Airdrop"],
    "Lending-Ertrag": ["✦", "staking", "Lending-Ertrag"],
    "DeFi-Ertrag": ["✦", "staking", "DeFi-Ertrag"],
    "DeFi Swap": ["⇄", "transfer", window.CryptoBuchI18n.t("DeFi-Swap")],
    "Liquidity Pool": ["◒", "staking", window.CryptoBuchI18n.t("Liquiditätspool")],
    Bridge: ["⇆", "transfer", "Bridge"],
    NFT: ["▣", "gift", "NFT"],
    Spam: ["!", "other", window.CryptoBuchI18n.t("Spam / ignorieren")],
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

  function formatCurrency(value, fallback = window.CryptoBuchI18n.t("k. A.")) {
    return hasNumber(value) ? currency.format(Number(value)) : fallback;
  }

  function parseDbDate(value) {
    if (!value) return null;
    const text = String(value);
    const date = new Date(text.includes("T") ? text : `${text}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function priceProviderLabel(provider, fallback = window.CryptoBuchI18n.t("nicht dokumentiert")) {
    return priceProviderLabels[provider] || (provider ? String(provider) : fallback);
  }

  function exchangeProviderLabel(provider, fallback = window.CryptoBuchI18n.t("Börse")) {
    return exchangeProviderLabels[provider] || fallback;
  }

  function purposeInfo(transaction = {}) {
    const [icon, tone, label] = purposePresentation[transaction.purpose]
      || (transaction.purpose ? ["•", "custom", transaction.purpose] : ["?", "unassigned", window.CryptoBuchI18n.t("Noch nicht zugeordnet")]);
    const origin = transaction.purpose_origin === "auto"
      ? window.CryptoBuchI18n.t("automatisch erkannt")
      : transaction.purpose_origin === "manual"
        ? window.CryptoBuchI18n.t("manuell zugeordnet")
        : window.CryptoBuchI18n.t("Herkunft prüfen");
    return { icon, tone, label: purposePresentation[transaction.purpose] ? window.CryptoBuchI18n.t(label) : label, origin };
  }

  function toast(message, kind = "success", { duration = 4200 } = {}) {
    const container = el("toast");
    if (!container) return;
    container.textContent = window.CryptoBuchI18n.message(message);
    container.className = `toast ${kind}`;
    container.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { container.hidden = true; }, duration);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", "X-CryptoBuch-Request": "1", ...(options.headers || {}) },
    });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && !String(url).startsWith("/api/auth/")) location.assign("/login.html");
    if (!response.ok) throw new Error(window.CryptoBuchI18n.message(payload.error) || window.CryptoBuchI18n.t("Der Vorgang ist fehlgeschlagen."));
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
