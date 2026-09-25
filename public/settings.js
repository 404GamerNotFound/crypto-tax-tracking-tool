const el = (id) => document.getElementById(id);

function toast(message, kind = "success") {
  const container = el("toast");
  container.textContent = message;
  container.className = `toast ${kind}`;
  container.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { container.hidden = true; }, 4200);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Der Vorgang ist fehlgeschlagen.");
  return payload;
}

function render(settings) {
  el("max-transactions").value = settings.maxTransactionsPerSync;
  el("bulk-purpose-limit").value = settings.bulkPurposeLimit;
  el("historical-price-retry-interval").value = settings.historicalPriceRetryIntervalMinutes;
  el("historical-price-batch-size").value = settings.historicalPriceBackfillBatchSize;
  const profile = settings.taxProfile;
  el("personal-tax-rate").value = profile.incomeTaxRatePercent;
  el("tax-profile-label").value = profile.label;
  el("tax-country-code").value = profile.countryCode;
  el("tax-disposal-rate").value = profile.disposalTaxRatePercent;
  el("tax-income-rate").value = profile.incomeTaxRatePercent;
  el("tax-holding-days").value = profile.holdingPeriodDays;
  el("tax-threshold").value = profile.exemptionThresholdEur;
  el("tax-disposal-enabled").checked = profile.disposalTaxEnabled;
  el("tax-holding-enabled").checked = profile.holdingPeriodEnabled;
  el("tax-threshold-enabled").checked = profile.exemptionThresholdEnabled;
  el("tax-loss-offset-enabled").checked = profile.lossOffsetEnabled;
  el("tax-income-enabled").checked = profile.incomeTaxEnabled;
  el("tax-income-purposes").value = profile.incomePurposes.join(", ");
  el("tax-rule-note").value = profile.ruleNote;
  el("bitcoin-explorer").value = settings.bitcoinExplorerBaseUrl;
  el("tzkt-api").value = settings.tzktApiBaseUrl;
  el("trongrid-api").value = settings.tronGridBaseUrl;
  el("blockfrost-api").value = settings.blockfrostBaseUrl;
  el("etherscan-api").value = settings.etherscanApiBaseUrl;
  el("ethereum-rpc").value = settings.ethereumRpcUrl;
  el("bscscan-api").value = settings.bscScanApiBaseUrl;
  el("snowtrace-api").value = settings.snowtraceApiBaseUrl;
  el("solscan-api").value = settings.solscanApiBaseUrl;
  el("xrpl-rpc").value = settings.xrplRpcUrl;
  el("stellar-horizon").value = settings.stellarHorizonBaseUrl;
  el("nearblocks-api").value = settings.nearBlocksApiBaseUrl;
  el("tonapi-api").value = settings.tonApiBaseUrl;
  el("blockchair-api").value = settings.blockchairApiBaseUrl;
  el("blockcypher-api").value = settings.blockCypherApiBaseUrl;
  el("coingecko-api").value = settings.coinGeckoBaseUrl;
  el("bitvavo-api").value = settings.bitvavoApiBaseUrl;
  el("xpub-gap").value = settings.xpubGapLimit;
  el("xpub-maximum").value = settings.xpubMaxDerivationsPerBranch;
  el("staking-aliases").value = settings.xtzStakingPayoutAliases;
  el("trongrid-key-status").textContent = settings.tronGridApiKeyConfigured
    ? "Ein API-Key ist gespeichert. Leer lassen, um ihn beizubehalten."
    : "Kein API-Key gespeichert. Ohne Key gelten die öffentlichen Rate Limits.";
  el("blockfrost-project-id-status").textContent = settings.blockfrostProjectIdConfigured
    ? "Eine Project-ID ist gespeichert. Leer lassen, um sie beizubehalten."
    : "Keine Project-ID gespeichert. Cardano-Wallets können noch nicht synchronisiert werden.";
  el("etherscan-key-status").textContent = settings.etherscanApiKeyConfigured
    ? "Ein API-Key ist gespeichert. Leer lassen, um ihn beizubehalten."
    : "Kein API-Key gespeichert. Ethereum-Wallets können noch nicht synchronisiert werden.";
  el("bscscan-key-status").textContent = settings.bscScanApiKeyConfigured ? "Ein API-Key ist gespeichert." : "Kein API-Key gespeichert. BNB-Wallets können noch nicht synchronisiert werden.";
  el("snowtrace-key-status").textContent = settings.snowtraceApiKeyConfigured ? "Ein API-Key ist gespeichert." : "Kein API-Key gespeichert. AVAX-Wallets können noch nicht synchronisiert werden.";
  el("solscan-key-status").textContent = settings.solscanApiKeyConfigured ? "Ein API-Key ist gespeichert." : "Kein API-Key gespeichert. Solana-Wallets können noch nicht synchronisiert werden.";
  el("nearblocks-key-status").textContent = settings.nearBlocksApiKeyConfigured ? "Ein API-Key ist gespeichert." : "Kein API-Key gespeichert. NEAR-Wallets können noch nicht synchronisiert werden.";
  el("tonapi-key-status").textContent = settings.tonApiKeyConfigured ? "Ein API-Key ist gespeichert." : "Kein Key gespeichert; die öffentliche TonAPI-Rate kann begrenzt sein.";
  el("blockchair-key-status").textContent = settings.blockchairApiKeyConfigured ? "Ein API-Key ist gespeichert." : "Kein Key gespeichert; die öffentliche Blockchair-Rate kann begrenzt sein.";
  el("blockcypher-token-status").textContent = settings.blockCypherApiTokenConfigured ? "Ein Token ist gespeichert." : "Kein Token gespeichert; die öffentliche BlockCypher-Rate kann begrenzt sein.";
  el("coingecko-key-status").textContent = settings.coinGeckoApiKeyConfigured
    ? "Ein API-Key ist gespeichert. Bei pro-api.coingecko.com wird er als Pro-Key verwendet."
    : "Kein API-Key gespeichert. Die öffentliche CoinGecko-API liefert historische Daten nur für die letzten 365 Tage.";
}

function setSaving(button, saving) {
  button.disabled = saving;
  button.textContent = saving ? "Speichert …" : "Einstellungen speichern";
}

async function loadSettings() {
  try {
    render(await api("/api/settings"));
  } catch (error) {
    el("settings-error").textContent = error.message;
    el("settings-error").hidden = false;
  }
}

el("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const save = el("save-settings");
  const error = el("settings-error");
  error.hidden = true;
  try {
    setSaving(save, true);
    const settings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        maxTransactionsPerSync: form.get("maxTransactionsPerSync"),
        bulkPurposeLimit: form.get("bulkPurposeLimit"),
        historicalPriceRetryIntervalMinutes: form.get("historicalPriceRetryIntervalMinutes"),
        historicalPriceBackfillBatchSize: form.get("historicalPriceBackfillBatchSize"),
        personalTaxRatePercent: el("tax-income-rate").value,
        taxProfile: {
          id: `${String(el("tax-country-code").value || "CUSTOM").trim().toUpperCase()}-CUSTOM`,
          countryCode: el("tax-country-code").value,
          label: el("tax-profile-label").value,
          disposalTaxRatePercent: el("tax-disposal-rate").value,
          incomeTaxRatePercent: el("tax-income-rate").value,
          holdingPeriodDays: el("tax-holding-days").value,
          exemptionThresholdEur: el("tax-threshold").value,
          disposalTaxEnabled: el("tax-disposal-enabled").checked,
          holdingPeriodEnabled: el("tax-holding-enabled").checked,
          exemptionThresholdEnabled: el("tax-threshold-enabled").checked,
          lossOffsetEnabled: el("tax-loss-offset-enabled").checked,
          incomeTaxEnabled: el("tax-income-enabled").checked,
          incomePurposes: el("tax-income-purposes").value.split(",").map((value) => value.trim()).filter(Boolean),
          ruleNote: el("tax-rule-note").value,
        },
        bitcoinExplorerBaseUrl: form.get("bitcoinExplorerBaseUrl"),
        tzktApiBaseUrl: form.get("tzktApiBaseUrl"),
        tronGridBaseUrl: form.get("tronGridBaseUrl"),
        blockfrostBaseUrl: form.get("blockfrostBaseUrl"),
        etherscanApiBaseUrl: form.get("etherscanApiBaseUrl"),
        ethereumRpcUrl: form.get("ethereumRpcUrl"),
        bscScanApiBaseUrl: form.get("bscScanApiBaseUrl"),
        snowtraceApiBaseUrl: form.get("snowtraceApiBaseUrl"),
        solscanApiBaseUrl: form.get("solscanApiBaseUrl"),
        xrplRpcUrl: form.get("xrplRpcUrl"),
        stellarHorizonBaseUrl: form.get("stellarHorizonBaseUrl"),
        nearBlocksApiBaseUrl: form.get("nearBlocksApiBaseUrl"),
        tonApiBaseUrl: form.get("tonApiBaseUrl"),
        blockchairApiBaseUrl: form.get("blockchairApiBaseUrl"),
        blockCypherApiBaseUrl: form.get("blockCypherApiBaseUrl"),
        coinGeckoBaseUrl: form.get("coinGeckoBaseUrl"),
        bitvavoApiBaseUrl: form.get("bitvavoApiBaseUrl"),
        coinGeckoApiKey: form.get("coinGeckoApiKey"),
        clearCoinGeckoApiKey: form.get("clearCoinGeckoApiKey") === "on",
        xpubGapLimit: form.get("xpubGapLimit"),
        xpubMaxDerivationsPerBranch: form.get("xpubMaxDerivationsPerBranch"),
        xtzStakingPayoutAliases: form.get("xtzStakingPayoutAliases"),
        tronGridApiKey: form.get("tronGridApiKey"),
        clearTronGridApiKey: form.get("clearTronGridApiKey") === "on",
        blockfrostProjectId: form.get("blockfrostProjectId"),
        clearBlockfrostProjectId: form.get("clearBlockfrostProjectId") === "on",
        etherscanApiKey: form.get("etherscanApiKey"),
        clearEtherscanApiKey: form.get("clearEtherscanApiKey") === "on",
        bscScanApiKey: form.get("bscScanApiKey"),
        snowtraceApiKey: form.get("snowtraceApiKey"),
        solscanApiKey: form.get("solscanApiKey"),
        nearBlocksApiKey: form.get("nearBlocksApiKey"),
        tonApiKey: form.get("tonApiKey"),
        blockchairApiKey: form.get("blockchairApiKey"),
        blockCypherApiToken: form.get("blockCypherApiToken"),
        clearAdditionalNetworkApiKeys: form.get("clearAdditionalNetworkApiKeys") === "on",
      }),
    });
    el("trongrid-key").value = "";
    el("clear-trongrid-key").checked = false;
    el("blockfrost-project-id").value = "";
    el("clear-blockfrost-project-id").checked = false;
    el("etherscan-key").value = "";
    el("clear-etherscan-key").checked = false;
    el("coingecko-key").value = "";
    el("clear-coingecko-key").checked = false;
    for (const id of ["bscscan-key", "snowtrace-key", "solscan-key", "nearblocks-key", "tonapi-key", "blockchair-key", "blockcypher-token"]) el(id).value = "";
    el("clear-additional-network-keys").checked = false;
    render(settings);
    toast("Einstellungen gespeichert. Sie gelten beim nächsten Synchronisieren.");
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
  } finally {
    setSaving(save, false);
  }
});

loadSettings();
