const { api, el, toast } = window.CryptoBuchUI;

function assign(id, property, value) {
  const field = el(id);
  if (field) field[property] = value;
}

function render(settings) {
  assign("max-transactions", "value", settings.maxTransactionsPerSync);
  assign("bulk-purpose-limit", "value", settings.bulkPurposeLimit);
  assign("historical-price-retry-interval", "value", settings.historicalPriceRetryIntervalMinutes);
  assign("historical-price-batch-size", "value", settings.historicalPriceBackfillBatchSize);
  const profile = settings.taxProfile;
  assign("personal-tax-rate", "value", profile.incomeTaxRatePercent);
  assign("tax-profile-label", "value", profile.label);
  assign("tax-country-code", "value", profile.countryCode);
  assign("tax-disposal-rate", "value", profile.disposalTaxRatePercent);
  assign("tax-income-rate", "value", profile.incomeTaxRatePercent);
  assign("tax-cost-basis-method", "value", profile.costBasisMethod || "FIFO");
  assign("tax-holding-days", "value", profile.holdingPeriodDays);
  assign("tax-threshold", "value", profile.exemptionThresholdEur);
  assign("tax-disposal-enabled", "checked", profile.disposalTaxEnabled);
  assign("tax-holding-enabled", "checked", profile.holdingPeriodEnabled);
  assign("tax-threshold-enabled", "checked", profile.exemptionThresholdEnabled);
  assign("tax-loss-offset-enabled", "checked", profile.lossOffsetEnabled);
  assign("tax-income-enabled", "checked", profile.incomeTaxEnabled);
  assign("tax-income-purposes", "value", profile.incomePurposes.join(", "));
  assign("tax-rule-note", "value", profile.ruleNote);
  assign("bitcoin-explorer", "value", settings.bitcoinExplorerBaseUrl);
  assign("tzkt-api", "value", settings.tzktApiBaseUrl);
  assign("trongrid-api", "value", settings.tronGridBaseUrl);
  assign("blockfrost-api", "value", settings.blockfrostBaseUrl);
  assign("etherscan-api", "value", settings.etherscanApiBaseUrl);
  assign("ethereum-rpc", "value", settings.ethereumRpcUrl);
  assign("bscscan-api", "value", settings.bscScanApiBaseUrl);
  assign("snowtrace-api", "value", settings.snowtraceApiBaseUrl);
  assign("solscan-api", "value", settings.solscanApiBaseUrl);
  assign("xrpl-rpc", "value", settings.xrplRpcUrl);
  assign("stellar-horizon", "value", settings.stellarHorizonBaseUrl);
  assign("nearblocks-api", "value", settings.nearBlocksApiBaseUrl);
  assign("tonapi-api", "value", settings.tonApiBaseUrl);
  assign("bitcoin-cash-api", "value", settings.bitcoinCashApiBaseUrl);
  assign("blockchair-api", "value", settings.blockchairApiBaseUrl);
  assign("blockcypher-api", "value", settings.blockCypherApiBaseUrl);
  assign("coingecko-api", "value", settings.coinGeckoBaseUrl);
  assign("bitvavo-api", "value", settings.bitvavoApiBaseUrl);
  assign("coinbase-exchange-api", "value", settings.coinbaseExchangeApiBaseUrl);
  assign("kraken-api", "value", settings.krakenApiBaseUrl);
  assign("cryptocompare-api", "value", settings.cryptoCompareApiBaseUrl);
  assign("binance-api", "value", settings.binanceApiBaseUrl);
  assign("etoro-api", "value", settings.etoroApiBaseUrl);
  assign("xpub-gap", "value", settings.xpubGapLimit);
  assign("xpub-maximum", "value", settings.xpubMaxDerivationsPerBranch);
  assign("staking-aliases", "value", settings.xtzStakingPayoutAliases);
  assign("trongrid-key-status", "textContent", settings.tronGridApiKeyConfigured
    ? window.CryptoBuchI18n.t("Ein API-Key ist gespeichert. Leer lassen, um ihn beizubehalten.")
    : window.CryptoBuchI18n.t("Kein API-Key gespeichert. Ohne Key gelten die öffentlichen Rate Limits."));
  assign("blockfrost-project-id-status", "textContent", settings.blockfrostProjectIdConfigured
    ? window.CryptoBuchI18n.t("Eine Project-ID ist gespeichert. Leer lassen, um sie beizubehalten.")
    : window.CryptoBuchI18n.t("Keine Project-ID gespeichert. Cardano-Wallets können noch nicht synchronisiert werden."));
  assign("etherscan-key-status", "textContent", settings.etherscanApiKeyConfigured
    ? window.CryptoBuchI18n.t("Ein API-Key ist gespeichert. Leer lassen, um ihn beizubehalten.")
    : window.CryptoBuchI18n.t("Kein API-Key gespeichert. Ethereum-Wallets können noch nicht synchronisiert werden."));
  assign("bscscan-key-status", "textContent", settings.bscScanApiKeyConfigured ? window.CryptoBuchI18n.t("Ein API-Key ist gespeichert.") : window.CryptoBuchI18n.t("Kein API-Key gespeichert. BNB-Wallets können noch nicht synchronisiert werden."));
  assign("snowtrace-key-status", "textContent", settings.snowtraceApiKeyConfigured ? window.CryptoBuchI18n.t("Ein API-Key ist gespeichert.") : window.CryptoBuchI18n.t("Kein API-Key gespeichert. AVAX-Wallets können noch nicht synchronisiert werden."));
  assign("solscan-key-status", "textContent", settings.solscanApiKeyConfigured ? window.CryptoBuchI18n.t("Ein API-Key ist gespeichert.") : window.CryptoBuchI18n.t("Kein API-Key gespeichert. Solana-Wallets können noch nicht synchronisiert werden."));
  assign("nearblocks-key-status", "textContent", settings.nearBlocksApiKeyConfigured ? window.CryptoBuchI18n.t("Ein API-Key ist gespeichert.") : window.CryptoBuchI18n.t("Kein API-Key gespeichert. NEAR-Wallets können noch nicht synchronisiert werden."));
  assign("tonapi-key-status", "textContent", settings.tonApiKeyConfigured ? window.CryptoBuchI18n.t("Ein API-Key ist gespeichert.") : window.CryptoBuchI18n.t("Kein Key gespeichert; die öffentliche TonAPI-Rate kann begrenzt sein."));
  assign("blockchair-key-status", "textContent", settings.blockchairApiKeyConfigured ? window.CryptoBuchI18n.t("Ein API-Key ist gespeichert.") : window.CryptoBuchI18n.t("Kein Key gespeichert; die öffentliche Blockchair-Rate für Zcash kann begrenzt sein."));
  assign("blockcypher-token-status", "textContent", settings.blockCypherApiTokenConfigured ? window.CryptoBuchI18n.t("Ein Token ist gespeichert.") : window.CryptoBuchI18n.t("Kein Token gespeichert; die öffentliche BlockCypher-Rate kann begrenzt sein."));
  assign("coingecko-key-status", "textContent", settings.coinGeckoApiKeyConfigured
    ? window.CryptoBuchI18n.t("Ein API-Key ist gespeichert. Bei pro-api.coingecko.com wird er als Pro-Key verwendet.")
    : window.CryptoBuchI18n.t("Kein API-Key gespeichert. Die öffentliche CoinGecko-API liefert historische Daten nur für die letzten 365 Tage."));
  assign("cryptocompare-key-status", "textContent", settings.cryptoCompareApiKeyConfigured
    ? window.CryptoBuchI18n.t("Ein API-Key ist gespeichert. Die Quelle wird erst nach den vier vorherigen Preisquellen verwendet.")
    : window.CryptoBuchI18n.t("Kein API-Key gespeichert; CryptoCompare wird übersprungen, die vier öffentlichen Quellen bleiben aktiv."));
}

function settingsPayload(formElement) {
  // Only submit controls present on this subpage; other settings remain server-side.
  const payload = Object.fromEntries(new FormData(formElement));
  for (const field of formElement.querySelectorAll('input[type="checkbox"][name]')) {
    payload[field.name] = field.checked;
  }
  if (el("tax-country-code")) {
    payload.personalTaxRatePercent = el("tax-income-rate").value;
    payload.taxProfile = {
      id: `${String(el("tax-country-code").value || window.CryptoBuchI18n.t("CUSTOM")).trim().toUpperCase()}-CUSTOM`,
      countryCode: el("tax-country-code").value,
      label: el("tax-profile-label").value,
      disposalTaxRatePercent: el("tax-disposal-rate").value,
      incomeTaxRatePercent: el("tax-income-rate").value,
      costBasisMethod: el("tax-cost-basis-method").value,
      holdingPeriodDays: el("tax-holding-days").value,
      exemptionThresholdEur: el("tax-threshold").value,
      disposalTaxEnabled: el("tax-disposal-enabled").checked,
      holdingPeriodEnabled: el("tax-holding-enabled").checked,
      exemptionThresholdEnabled: el("tax-threshold-enabled").checked,
      lossOffsetEnabled: el("tax-loss-offset-enabled").checked,
      incomeTaxEnabled: el("tax-income-enabled").checked,
      incomePurposes: el("tax-income-purposes").value.split(",").map((value) => value.trim()).filter(Boolean),
      ruleNote: el("tax-rule-note").value,
    };
  }
  return payload;
}

function setSaving(button, saving) {
  button.disabled = saving;
  button.textContent = saving ? window.CryptoBuchI18n.t("Speichert …") : window.CryptoBuchI18n.t("Einstellungen speichern");
}

async function loadSettings() {
  try {
    render(await api("/api/settings"));
  } catch (error) {
    el("settings-error").textContent = window.CryptoBuchI18n.message(error.message);
    el("settings-error").hidden = false;
  }
}

el("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const save = el("save-settings");
  const error = el("settings-error");
  error.hidden = true;
  try {
    setSaving(save, true);
    const settings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settingsPayload(formElement)),
    });
    for (const field of formElement.querySelectorAll('input[type="password"]')) field.value = "";
    for (const field of formElement.querySelectorAll('input[type="checkbox"][name^="clear"]')) field.checked = false;
    render(settings);
    toast(window.CryptoBuchI18n.t("Einstellungen gespeichert. Sie gelten beim nächsten Synchronisieren."));
  } catch (requestError) {
    error.textContent = window.CryptoBuchI18n.message(requestError.message);
    error.hidden = false;
  } finally {
    setSaving(save, false);
  }
});

loadSettings();
