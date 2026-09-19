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
  el("bitcoin-explorer").value = settings.bitcoinExplorerBaseUrl;
  el("tzkt-api").value = settings.tzktApiBaseUrl;
  el("trongrid-api").value = settings.tronGridBaseUrl;
  el("blockfrost-api").value = settings.blockfrostBaseUrl;
  el("coingecko-api").value = settings.coinGeckoBaseUrl;
  el("xpub-gap").value = settings.xpubGapLimit;
  el("xpub-maximum").value = settings.xpubMaxDerivationsPerBranch;
  el("staking-aliases").value = settings.xtzStakingPayoutAliases;
  el("trongrid-key-status").textContent = settings.tronGridApiKeyConfigured
    ? "Ein API-Key ist gespeichert. Leer lassen, um ihn beizubehalten."
    : "Kein API-Key gespeichert. Ohne Key gelten die öffentlichen Rate Limits.";
  el("blockfrost-project-id-status").textContent = settings.blockfrostProjectIdConfigured
    ? "Eine Project-ID ist gespeichert. Leer lassen, um sie beizubehalten."
    : "Keine Project-ID gespeichert. Cardano-Wallets können noch nicht synchronisiert werden.";
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
        bitcoinExplorerBaseUrl: form.get("bitcoinExplorerBaseUrl"),
        tzktApiBaseUrl: form.get("tzktApiBaseUrl"),
        tronGridBaseUrl: form.get("tronGridBaseUrl"),
        blockfrostBaseUrl: form.get("blockfrostBaseUrl"),
        coinGeckoBaseUrl: form.get("coinGeckoBaseUrl"),
        xpubGapLimit: form.get("xpubGapLimit"),
        xpubMaxDerivationsPerBranch: form.get("xpubMaxDerivationsPerBranch"),
        xtzStakingPayoutAliases: form.get("xtzStakingPayoutAliases"),
        tronGridApiKey: form.get("tronGridApiKey"),
        clearTronGridApiKey: form.get("clearTronGridApiKey") === "on",
        blockfrostProjectId: form.get("blockfrostProjectId"),
        clearBlockfrostProjectId: form.get("clearBlockfrostProjectId") === "on",
      }),
    });
    el("trongrid-key").value = "";
    el("clear-trongrid-key").checked = false;
    el("blockfrost-project-id").value = "";
    el("clear-blockfrost-project-id").checked = false;
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
