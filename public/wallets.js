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
  if (wallet.source_type === "xpub") return "Bitcoin xPub";
  if (wallet.source_type === "stake") return "Cardano Stake-Adresse";
  return `${chainInfo(wallet.chain).name}-Wallet`;
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
  meta.textContent = wallet.source_type === "xpub"
    ? `Bitcoin-xPub · ${shorten(wallet.address)}`
    : wallet.source_type === "stake"
      ? `Cardano Stake-Adresse · ${shorten(wallet.address)}`
      : `${chain.name} · ${shorten(wallet.address)}`;
  copy.append(title, meta);
  if (wallet.group_name || (wallet.tags || []).length) {
    const badges = document.createElement("div"); badges.className = "wallet-tags";
    if (wallet.group_name) { const badge = document.createElement("span"); badge.textContent = wallet.group_name; badges.append(badge); }
    for (const tag of wallet.tags || []) { const badge = document.createElement("span"); badge.textContent = `#${tag}`; badges.append(badge); }
    copy.append(badges);
  }
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
  const qr = document.createElement("button");
  qr.className = "button button-secondary button-small";
  qr.textContent = "QR";
  qr.title = "Wallet-Adresse als QR-Code anzeigen";
  qr.addEventListener("click", () => openWalletQr(wallet));
  const remove = document.createElement("button");
  remove.className = "text-button wallet-remove";
  remove.textContent = "Entfernen";
  remove.addEventListener("click", () => deleteWallet(wallet));
  actions.append(details, refresh, qr, remove);
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
  const requested = String(new URLSearchParams(window.location.search).get("chain") || "").toUpperCase();
  const current = select.value || requested;
  select.replaceChildren();
  for (const [key, chain] of Object.entries(state.portfolio?.chains || {})) select.add(new Option(`${chain.name} (${chain.asset})`, key));
  select.value = [...select.options].some((option) => option.value === current) ? current : select.options[0]?.value || "";
  updateWalletFields();
}

function updateWalletFields() {
  const chain = el("wallet-chain").value;
  const config = chainInfo(chain);
  const bitcoin = chain === "BTC" && Boolean(config.supportsXpub);
  const cardano = chain === "ADA";
  const source = el("wallet-source-type");
  const cardanoSource = el("cardano-source-type");
  if (!bitcoin) source.value = "address";
  if (!cardano) cardanoSource.value = "address";
  const xpub = bitcoin && source.value === "xpub";
  const stake = cardano && cardanoSource.value === "stake";
  const inferred = xpubAddressTypeFor(el("wallet-address").value);
  if (xpub && inferred) el("xpub-address-type").value = inferred;
  el("bitcoin-source-fields").hidden = !bitcoin;
  el("cardano-source-fields").hidden = !cardano;
  el("xpub-format-wrap").hidden = !xpub;
  el("xpub-notice").hidden = !xpub;
  el("wallet-identifier-label").textContent = xpub ? "Bitcoin-xPub" : stake ? "Cardano Stake-Adresse" : "Öffentliche Wallet-Adresse";
  el("wallet-address").placeholder = xpub ? "xpub6…" : stake ? "stake1…" : config.addressPlaceholder || "Öffentliche Adresse";
  el("address-hint").textContent = xpub
    ? "xPub, yPub und zPub werden erkannt. Leerzeichen und Zeilenumbrüche aus dem Einfügen werden automatisch entfernt."
    : stake
      ? "Die Stake-Adresse fasst die zugehörigen Cardano-Zahlungsadressen zusammen. Deren gesamte über Blockfrost sichtbare Transaktionshistorie wird importiert."
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
    const queued = await api("/api/jobs/sync", { method: "POST", body: JSON.stringify({ walletId: wallet.id }) });
    const result = await waitForJob(queued.jobs[0].id);
    await loadPortfolio({ quiet: true });
    const notice = result.xpubCapped ? " Die xPub-Suche erreichte die eingestellte Sicherheitsgrenze." : "";
    toast(`${result.imported.toLocaleString("de-DE")} Transaktionen synchronisiert${result.limited ? " (Importlimit aktiv)" : ""}.${notice}`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function waitForJob(id) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const job = await api(`/api/jobs/${id}`);
    if (job.status === "success") return job.result || {};
    if (job.status === "error") throw new Error(job.error_message || "Synchronisierung fehlgeschlagen.");
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error("Synchronisierung benötigt länger als erwartet.");
}

async function syncAll() {
  const wallets = state.portfolio?.wallets || [];
  if (!wallets.length) return openWalletModal();
  const button = el("refresh-all");
  setBusy(button, true, "Synchronisiert …");
  try {
    const queued = await api("/api/jobs/sync", { method: "POST", body: JSON.stringify({ walletIds: wallets.map((wallet) => wallet.id) }) });
    const results = await Promise.all(queued.jobs.map((job) => waitForJob(job.id)));
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

async function openWalletQr(wallet) {
  try {
    const result = await api(`/api/wallets/${wallet.id}/qr`);
    el("wallet-qr-image").src = result.dataUrl;
    el("wallet-qr-address").textContent = result.address;
    el("qr-modal-title").textContent = `${walletName(wallet)} · QR-Code`;
    el("qr-modal").showModal();
  } catch (error) { toast(error.message, "error"); }
}

function openPsbtModal() {
  el("psbt-error").hidden = true;
  el("psbt-result").hidden = true;
  el("psbt-modal").showModal();
  setTimeout(() => el("psbt-input").focus(), 0);
}

function closePsbtModal() { el("psbt-modal").close(); }

function updateLedgerFields() {
  const bitcoin = el("ledger-chain").value === "BTC";
  el("ledger-bitcoin-options").hidden = !bitcoin;
  if (bitcoin) {
    const wholeAccount = el("ledger-btc-source").value === "xpub";
    el("ledger-btc-source-help").textContent = wholeAccount
      ? "Erfasst Empfangs- und Wechselgeldadressen bis zum konfigurierten Gap-Limit. Der xPub ist öffentlich, aber datenschutzsensibel."
      : "Nur die auf dem Ledger angezeigte Empfangsadresse wird importiert.";
  }
}

async function loadLedgerBridge() {
  if (window.CryptoBuchLedger) return window.CryptoBuchLedger;
  if (window.__cryptoBuchLedgerLoading) return window.__cryptoBuchLedgerLoading;
  window.__cryptoBuchLedgerLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/ledger-connect.js?v=20260922-2";
    script.onload = () => window.CryptoBuchLedger ? resolve(window.CryptoBuchLedger) : reject(new Error("Ledger-Modul konnte nicht geladen werden."));
    script.onerror = () => reject(new Error("Ledger-Modul konnte nicht geladen werden."));
    document.head.append(script);
  });
  return window.__cryptoBuchLedgerLoading;
}

function openLedgerModal() {
  const error = el("ledger-error");
  error.hidden = true;
  el("ledger-result").hidden = true;
  updateLedgerFields();
  el("ledger-modal").showModal();
}

function closeLedgerModal() {
  el("ledger-modal").close();
  el("ledger-form").reset();
  updateLedgerFields();
}

function ledgerSupportError() {
  if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return "Die direkte Ledger-Verbindung benötigt HTTPS. Öffne CryptoBuch über eine TLS-gesicherte Portainer-URL.";
  }
  if ((!navigator.hid && !navigator.usb)) {
    return "Dieser Browser stellt weder WebHID noch WebUSB bereit. Bitte nutze eine aktuelle Chrome- oder Chromium-Version.";
  }
  return null;
}

function psbtRow(label, value) {
  const row = document.createElement("p");
  row.textContent = `${label}: ${value}`;
  return row;
}

el("open-wallet-modal").addEventListener("click", openWalletModal);
el("open-ledger-modal").addEventListener("click", openLedgerModal);
el("open-psbt-modal").addEventListener("click", openPsbtModal);
el("close-psbt-modal").addEventListener("click", closePsbtModal);
el("close-ledger-modal").addEventListener("click", closeLedgerModal);
el("cancel-ledger").addEventListener("click", closeLedgerModal);
el("open-wallet-empty").addEventListener("click", openWalletModal);
el("refresh-all").addEventListener("click", syncAll);
el("close-wallet-modal").addEventListener("click", closeWalletModal);
el("cancel-wallet").addEventListener("click", closeWalletModal);
el("wallet-chain").addEventListener("change", updateWalletFields);
el("wallet-source-type").addEventListener("change", updateWalletFields);
el("cardano-source-type").addEventListener("change", updateWalletFields);
el("wallet-address").addEventListener("input", () => {
  const field = el("wallet-address");
  const normalized = normalizeExtendedPublicKey(field.value);
  if (el("wallet-chain").value !== "BTC" || !isExtendedPublicKey(normalized)) return;
  field.value = normalized;
  el("wallet-source-type").value = "xpub";
  updateWalletFields();
});
el("ledger-chain").addEventListener("change", updateLedgerFields);
el("ledger-btc-source").addEventListener("change", updateLedgerFields);
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
      const chain = String(form.get("chain") || "");
      const sourceType = detectedXpub
        ? "xpub"
        : chain === "BTC" ? form.get("btcSourceType")
          : chain === "ADA" ? form.get("cardanoSourceType")
            : "address";
      const wallet = await api("/api/wallets", {
      method: "POST",
      body: JSON.stringify({
        chain: form.get("chain"), label: form.get("label"), address: identifier,
        sourceType,
        xpubAddressType: xpubAddressTypeFor(identifier) || form.get("xpubAddressType"),
        groupName: form.get("groupName"), tags: form.get("tags"),
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

el("psbt-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = el("psbt-error");
  const result = el("psbt-result");
  error.hidden = true;
  try {
    const preview = await api("/api/bitcoin/psbt-preview", { method: "POST", body: JSON.stringify({ psbt: el("psbt-input").value }) });
    result.replaceChildren(
      psbtRow("Eingänge", preview.inputs.length),
      psbtRow("Ausgänge", preview.outputs.length),
      psbtRow("Ausgangssumme", `${preview.outputTotalBtc.toLocaleString("de-DE", { maximumFractionDigits: 8 })} BTC`),
      psbtRow("Gebühr", preview.feeBtc === null ? "nicht bestimmbar (UTXO-Daten fehlen)" : `${preview.feeBtc.toLocaleString("de-DE", { maximumFractionDigits: 8 })} BTC`),
    );
    result.hidden = false;
  } catch (requestError) { error.textContent = requestError.message; error.hidden = false; }
});

el("ledger-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = el("ledger-error");
  const result = el("ledger-result");
  const button = el("connect-ledger");
  error.hidden = true;
  result.hidden = true;
  const supportError = ledgerSupportError();
  if (supportError) {
    error.textContent = supportError;
    error.hidden = false;
    return;
  }
  try {
    const form = new FormData(event.currentTarget);
    setBusy(button, true, "Auf Ledger bestätigen …");
    const bridge = await loadLedgerBridge();
    const requestedChain = String(form.get("chain"));
    const account = await bridge.readPublicAccount({
      chain: requestedChain,
      accountIndex: form.get("accountIndex"),
      bitcoinFormat: String(form.get("bitcoinFormat")),
      bitcoinSource: String(form.get("bitcoinSource")),
      transport: String(form.get("transport")),
    });
    result.textContent = `Auf dem Ledger bestätigt: ${account.address} (${account.derivationPath})`;
    result.hidden = false;
    setBusy(button, true, "Wallet wird importiert …");
    const wallet = await api("/api/wallets", {
      method: "POST",
      body: JSON.stringify({
        chain: requestedChain,
        label: `Ledger ${requestedChain} · Konto ${form.get("accountIndex")}`,
        address: account.address,
        sourceType: account.sourceType || "address",
        xpubAddressType: account.xpubAddressType,
        groupName: "Ledger",
        tags: ["Hardware-Wallet"],
      }),
    });
    const syncResult = await api(`/api/wallets/${wallet.id}/sync`, { method: "POST" });
    closeLedgerModal();
    await loadPortfolio({ quiet: true });
    toast(`Ledger-Adresse importiert · ${syncResult.imported.toLocaleString("de-DE")} Transaktionen synchronisiert.`);
  } catch (requestError) {
    error.textContent = requestError.message || "Ledger-Verbindung konnte nicht hergestellt werden.";
    error.hidden = false;
  } finally {
    setBusy(button, false);
  }
});

loadPortfolio();
