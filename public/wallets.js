const state = { portfolio: null };
const el = (id) => document.getElementById(id);
const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

function chainInfo(chain) {
  return state.portfolio?.chains?.[chain] || { name: chain, asset: chain, icon: chain.slice(0, 1) };
}

function shorten(value, start = 11, end = 9) {
  return value && value.length > start + end + 2 ? `${value.slice(0, start)}…${value.slice(-end)}` : value || "—";
}

function normalizeExtendedPublicKey(value) {
  return String(value || "")
    .trim()
    .replace(/[\s\u00a0\u200b-\u200d\ufeff]/g, "")
    .replace(/^["'`\u201c\u201d]+|["'`\u201c\u201d]+$/g, "");
}

function isExtendedPublicKey(value) {
  return /^(?:xpub|ypub|zpub)/i.test(normalizeExtendedPublicKey(value));
}

function xpubAddressTypeFor(value) {
  const prefix = normalizeExtendedPublicKey(value).slice(0, 4).toLowerCase();
  return prefix === "ypub" ? "p2sh-p2wpkh" : prefix === "zpub" ? "p2wpkh" : null;
}

function toast(message, kind = "success") {
  const container = el("toast");
  container.textContent = message;
  container.className = `toast ${kind}`;
  container.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { container.hidden = true; }, 4200);
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Der Vorgang ist fehlgeschlagen.");
  return payload;
}

function walletName(wallet) {
  if (wallet.label) return wallet.label;
  return wallet.source_type === "xpub" ? "Bitcoin xPub" : `${chainInfo(wallet.chain).name}-Wallet`;
}

function renderWallet(wallet) {
  const chain = chainInfo(wallet.chain);
  const item = document.createElement("article");
  item.className = "wallet-page-item";
  const identity = document.createElement("div");
  identity.className = "wallet-page-identity";
  const icon = document.createElement("span");
  icon.className = `chain-icon ${wallet.chain.toLowerCase()}`;
  icon.textContent = chain.icon;
  const copy = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = walletName(wallet);
  const meta = document.createElement("p");
  meta.textContent = wallet.source_type === "xpub" ? `Bitcoin-xPub · ${shorten(wallet.address)}` : `${chain.name} · ${shorten(wallet.address)}`;
  copy.append(title, meta);
  identity.append(icon, copy);

  const sync = document.createElement("div");
  sync.className = "wallet-page-sync";
  const syncLabel = document.createElement("span");
  syncLabel.className = "card-label";
  syncLabel.textContent = "LETZTE SYNCHRONISIERUNG";
  const syncDate = document.createElement("strong");
  syncDate.textContent = wallet.last_synced_at ? dateTime.format(new Date(`${wallet.last_synced_at}Z`)) : "Noch nicht synchronisiert";
  sync.append(syncLabel, syncDate);

  const actions = document.createElement("div");
  actions.className = "wallet-page-actions";
  const details = document.createElement("a");
  details.className = "button button-secondary button-small";
  details.href = `/asset.html?chain=${encodeURIComponent(wallet.chain)}`;
  details.textContent = `${chain.asset} ansehen`;
  const refresh = document.createElement("button");
  refresh.className = "button button-primary button-small";
  refresh.textContent = "Synchronisieren";
  refresh.addEventListener("click", () => syncWallet(wallet, refresh));
  const remove = document.createElement("button");
  remove.className = "text-button wallet-remove";
  remove.textContent = "Entfernen";
  remove.addEventListener("click", () => deleteWallet(wallet));
  actions.append(details, refresh, remove);
  item.append(identity, sync, actions);
  return item;
}

function render() {
  const wallets = state.portfolio?.wallets || [];
  el("wallet-count").textContent = wallets.length.toLocaleString("de-DE");
  el("wallet-status").textContent = `${wallets.length.toLocaleString("de-DE")} Wallet${wallets.length === 1 ? "" : "s"} eingerichtet`;
  const list = el("wallet-list");
  list.replaceChildren();
  for (const wallet of wallets) list.append(renderWallet(wallet));
  el("wallet-empty").hidden = wallets.length > 0;

  const select = el("wallet-chain");
  const current = select.value;
  select.replaceChildren();
  for (const [key, chain] of Object.entries(state.portfolio?.chains || {})) select.add(new Option(`${chain.name} (${chain.asset})`, key));
  select.value = [...select.options].some((option) => option.value === current) ? current : select.options[0]?.value || "";
  updateWalletFields();
}

function updateWalletFields() {
  const chain = el("wallet-chain").value;
  const config = chainInfo(chain);
  const bitcoin = Boolean(config.supportsXpub);
  const source = el("wallet-source-type");
  if (!bitcoin) source.value = "address";
  const xpub = bitcoin && source.value === "xpub";
  const inferred = xpubAddressTypeFor(el("wallet-address").value);
  if (xpub && inferred) el("xpub-address-type").value = inferred;
  el("bitcoin-source-fields").hidden = !bitcoin;
  el("xpub-format-wrap").hidden = !xpub;
  el("xpub-notice").hidden = !xpub;
  el("wallet-identifier-label").textContent = xpub ? "Bitcoin-xPub" : "Öffentliche Wallet-Adresse";
  el("wallet-address").placeholder = xpub ? "xpub6…" : config.addressPlaceholder || "Öffentliche Adresse";
  el("address-hint").textContent = xpub
    ? "xPub, yPub und zPub werden erkannt. Leerzeichen und Zeilenumbrüche aus dem Einfügen werden automatisch entfernt."
    : config.addressHint || `Öffentliche ${config.name}-Adresse eingeben.`;
}

async function loadPortfolio({ quiet = false } = {}) {
  try {
    if (!quiet) el("wallet-status").textContent = "Wallets werden geladen …";
    state.portfolio = await api("/api/portfolio");
    render();
  } catch (error) {
    toast(error.message, "error");
    el("wallet-status").textContent = "Daten momentan nicht verfügbar";
  }
}

function setBusy(button, busy, text = "Bitte warten …") {
  if (busy) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.textContent = text;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.label || button.textContent;
  }
}

async function syncWallet(wallet, button) {
  try {
    setBusy(button, true, "Synchronisiert …");
    const result = await api(`/api/wallets/${wallet.id}/sync`, { method: "POST" });
    await loadPortfolio({ quiet: true });
    const notice = result.xpubCapped ? " Die xPub-Suche erreichte die eingestellte Sicherheitsgrenze." : "";
    toast(`${result.imported.toLocaleString("de-DE")} Transaktionen synchronisiert${result.limited ? " (Importlimit aktiv)" : ""}.${notice}`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function syncAll() {
  const wallets = state.portfolio?.wallets || [];
  if (!wallets.length) return openWalletModal();
  const button = el("refresh-all");
  setBusy(button, true, "Synchronisiert …");
  try {
    const results = [];
    for (const wallet of wallets) results.push(await api(`/api/wallets/${wallet.id}/sync`, { method: "POST" }));
    await loadPortfolio({ quiet: true });
    toast(`${results.reduce((sum, item) => sum + item.imported, 0).toLocaleString("de-DE")} Transaktionen aktualisiert.`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function deleteWallet(wallet) {
  if (!confirm(`„${walletName(wallet)}“ und alle zugehörigen Transaktionen wirklich entfernen?`)) return;
  try {
    await api(`/api/wallets/${wallet.id}`, { method: "DELETE" });
    await loadPortfolio({ quiet: true });
    toast("Wallet und zugehörige Transaktionen wurden entfernt.");
  } catch (error) {
    toast(error.message, "error");
  }
}

function openWalletModal() {
  if (!state.portfolio) return loadPortfolio();
  el("wallet-form-error").hidden = true;
  updateWalletFields();
  el("wallet-modal").showModal();
  setTimeout(() => el("wallet-address").focus(), 0);
}

function closeWalletModal() {
  el("wallet-modal").close();
  el("wallet-form").reset();
  updateWalletFields();
}

el("open-wallet-modal").addEventListener("click", openWalletModal);
el("open-wallet-empty").addEventListener("click", openWalletModal);
el("refresh-all").addEventListener("click", syncAll);
el("close-wallet-modal").addEventListener("click", closeWalletModal);
el("cancel-wallet").addEventListener("click", closeWalletModal);
el("wallet-chain").addEventListener("change", updateWalletFields);
el("wallet-source-type").addEventListener("change", updateWalletFields);
el("wallet-address").addEventListener("input", () => {
  const field = el("wallet-address");
  const normalized = normalizeExtendedPublicKey(field.value);
  if (el("wallet-chain").value !== "BTC" || !isExtendedPublicKey(normalized)) return;
  field.value = normalized;
  el("wallet-source-type").value = "xpub";
  updateWalletFields();
});
el("wallet-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const save = el("save-wallet");
  const formError = el("wallet-form-error");
  formError.hidden = true;
  try {
    setBusy(save, true, "Speichert …");
    const rawIdentifier = String(form.get("address") || "");
    const identifier = isExtendedPublicKey(rawIdentifier) ? normalizeExtendedPublicKey(rawIdentifier) : rawIdentifier.trim();
    const detectedXpub = isExtendedPublicKey(identifier);
    const wallet = await api("/api/wallets", {
      method: "POST",
      body: JSON.stringify({
        chain: form.get("chain"), label: form.get("label"), address: identifier,
        sourceType: detectedXpub ? "xpub" : form.get("sourceType"),
        xpubAddressType: xpubAddressTypeFor(identifier) || form.get("xpubAddressType"),
      }),
    });
    const result = await api(`/api/wallets/${wallet.id}/sync`, { method: "POST" });
    closeWalletModal();
    await loadPortfolio({ quiet: true });
    toast(`Wallet gespeichert · ${result.imported.toLocaleString("de-DE")} Transaktionen importiert.`);
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
  } finally {
    setBusy(save, false);
  }
});

loadPortfolio();
