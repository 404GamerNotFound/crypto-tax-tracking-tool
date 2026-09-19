const state = {
  portfolio: null,
  selected: new Set(),
  filters: { search: "", chain: "", direction: "" },
};

const el = (id) => document.getElementById(id);
const currency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const price = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 4 });
const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const compactNumber = (maximumFractionDigits) => new Intl.NumberFormat("de-DE", { maximumFractionDigits });

function hasPrice(value) {
  return value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) > 0;
}

function formatPrice(value) {
  return hasPrice(value) ? price.format(Number(value)) : "k. A.";
}

function formatAmount(value, asset) {
  const decimals = Object.values(state.portfolio?.chains || {}).find((chain) => chain.asset === asset)?.decimals || 6;
  return `${compactNumber(decimals).format(Number(value))} ${asset}`;
}

function shorten(value, start = 7, end = 6) {
  if (!value || value.length <= start + end + 2) return value || "—";
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

function directionLabel(direction) {
  return { in: "Eingang", out: "Ausgang", self: "Eigener Transfer" }[direction] || "Unbekannt";
}

function purposeInfo(transaction) {
  const purpose = transaction.purpose || "";
  const presets = {
    "Staking Rewards": { icon: "✦", tone: "staking", label: "Staking-Ertrag" },
    Kauf: { icon: "↗", tone: "purchase", label: "Kauf" },
    Verkauf: { icon: "↘", tone: "sale", label: "Verkauf" },
    "Mining Reward": { icon: "⛏", tone: "mining", label: "Mining-Ertrag" },
    Transfer: { icon: "↔", tone: "transfer", label: "Transfer" },
    Geschenk: { icon: "◇", tone: "gift", label: "Geschenk" },
    Gebühr: { icon: "−", tone: "fee", label: "Gebühr" },
    Sonstiges: { icon: "•", tone: "other", label: "Sonstiges" },
  };
  const info = presets[purpose] || (purpose ? { icon: "•", tone: "custom", label: purpose } : { icon: "?", tone: "unassigned", label: "Noch nicht zugeordnet" });
  const source = transaction.purpose_origin === "auto"
    ? "automatisch erkannt"
    : transaction.purpose_origin === "manual"
      ? "manuell zugeordnet"
      : "Herkunft prüfen";
  return { ...info, source };
}

function chainInfo(chain) {
  return state.portfolio?.chains?.[chain] || { name: chain, asset: chain, decimals: 6, icon: chain.slice(0, 1) };
}

function explorerUrl(chain, type, value) {
  const template = chainInfo(chain).explorer?.[type];
  return template ? template.replace("{value}", encodeURIComponent(value)) : "#";
}

function xpubAddressTypeFor(value) {
  const prefix = normalizeExtendedPublicKey(value).slice(0, 4).toLowerCase();
  return prefix === "ypub" ? "p2sh-p2wpkh" : prefix === "zpub" ? "p2wpkh" : null;
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

function renderChainControls() {
  const chains = Object.entries(state.portfolio?.chains || {});
  const filter = el("chain-filter");
  const selectedFilter = state.filters.chain;
  filter.replaceChildren(new Option("Alle Netzwerke", ""));
  for (const [key, chain] of chains) filter.add(new Option(`${chain.name} (${chain.asset})`, key));
  filter.value = chains.some(([key]) => key === selectedFilter) ? selectedFilter : "";
  state.filters.chain = filter.value;

  const walletChain = el("wallet-chain");
  const selectedWalletChain = walletChain.value || chains[0]?.[0] || "";
  walletChain.replaceChildren();
  for (const [key, chain] of chains) walletChain.add(new Option(`${chain.name} (${chain.asset})`, key));
  walletChain.value = chains.some(([key]) => key === selectedWalletChain) ? selectedWalletChain : chains[0]?.[0] || "";
}

function getFilteredTransactions() {
  const transactions = state.portfolio?.transactions || [];
  const search = state.filters.search.toLocaleLowerCase("de-DE").trim();
  return transactions.filter((transaction) => {
    if (state.filters.chain && transaction.chain !== state.filters.chain) return false;
    if (state.filters.direction && transaction.direction !== state.filters.direction) return false;
    if (!search) return true;
    return [transaction.hash, transaction.wallet_label, transaction.address, transaction.purpose, transaction.counterparty, transaction.asset]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("de-DE")
      .includes(search);
  });
}

function safeExplorerUrl(transaction) {
  return explorerUrl(transaction.chain, "transaction", transaction.hash);
}

function renderSummary() {
  const portfolio = state.portfolio;
  const prices = portfolio.currentPrices || {};
  el("total-value").textContent = Number.isFinite(Number(portfolio.totalValueEur)) ? currency.format(portfolio.totalValueEur) : "k. A.";
  const assetCards = el("asset-summary-cards");
  assetCards.replaceChildren();
  for (const [key, chain] of Object.entries(portfolio.chains || {})) {
    const card = document.createElement("article");
    card.className = "summary-card";
    const label = document.createElement("span");
    label.className = "card-label";
    label.textContent = chain.name;
    const holding = document.createElement("strong");
    holding.textContent = formatAmount(portfolio.holdings[chain.asset] || 0, chain.asset);
    const marketPrice = document.createElement("span");
    marketPrice.className = "muted";
    marketPrice.textContent = `1 ${chain.asset} · ${formatPrice(prices[key])}`;
    card.append(label, holding, marketPrice);
    assetCards.append(card);
  }
  el("transaction-count").textContent = portfolio.transactions.length.toLocaleString("de-DE");
  const updated = prices.updatedAt ? `Preisstand ${dateTime.format(new Date(prices.updatedAt * 1000))}` : "Aktuelle Preise nicht verfügbar";
  el("price-status").textContent = prices.warning ? "Preisabfrage momentan nicht verfügbar" : updated;
}

function walletName(wallet) {
  if (wallet.label) return wallet.label;
  if (wallet.source_type === "xpub") return "Bitcoin xPub";
  return `${chainInfo(wallet.chain).name}-Wallet`;
}

function renderWallets() {
  const wallets = state.portfolio.wallets || [];
  const list = el("wallet-list");
  list.replaceChildren();
  el("wallet-count").textContent = wallets.length;
  el("wallet-empty").hidden = wallets.length > 0;

  for (const wallet of wallets) {
    const item = document.createElement("article");
    item.className = "wallet-item";
    const icon = document.createElement("span");
    icon.className = `chain-icon ${wallet.chain.toLowerCase()}`;
    icon.textContent = chainInfo(wallet.chain).icon;
    const details = document.createElement("div");
    details.className = "wallet-details";
    const title = document.createElement("strong");
    title.textContent = walletName(wallet);
    const address = document.createElement(wallet.source_type === "xpub" ? "span" : "a");
    if (wallet.source_type === "xpub") {
      address.className = "wallet-identifier";
      address.textContent = `xPub · ${shorten(wallet.address, 9, 7)}`;
    } else {
      address.href = explorerUrl(wallet.chain, "address", wallet.address);
      address.target = "_blank";
      address.rel = "noreferrer";
      address.textContent = shorten(wallet.address, 9, 7);
    }
    const sync = document.createElement("small");
    sync.textContent = wallet.last_synced_at ? `Zuletzt: ${dateTime.format(new Date(`${wallet.last_synced_at}Z`))}` : "Noch nicht synchronisiert";
    details.append(title, address, sync);
    const actions = document.createElement("div");
    actions.className = "wallet-actions";
    const refresh = document.createElement("button");
    refresh.className = "wallet-action";
    refresh.title = "Wallet synchronisieren";
    refresh.ariaLabel = "Wallet synchronisieren";
    refresh.textContent = "↻";
    refresh.addEventListener("click", () => syncWallet(wallet.id, refresh));
    const remove = document.createElement("button");
    remove.className = "wallet-action danger";
    remove.title = "Wallet entfernen";
    remove.ariaLabel = "Wallet entfernen";
    remove.textContent = "×";
    remove.addEventListener("click", () => deleteWallet(wallet));
    actions.append(refresh, remove);
    item.append(icon, details, actions);
    list.append(item);
  }
}

function purposeOptions(select, selected = "") {
  select.replaceChildren();
  const unassigned = new Option("Kein Zweck", "");
  select.add(unassigned);
  for (const purpose of state.portfolio.purposePresets || []) {
    select.add(new Option(purpose, purpose));
  }
  select.add(new Option("Eigener Zweck …", "__custom__"));
  if (selected && ![...select.options].some((option) => option.value === selected)) {
    select.add(new Option(selected, selected));
  }
  select.value = selected || "";
}

function renderTransactions() {
  const visible = getFilteredTransactions();
  const body = el("transaction-list");
  body.replaceChildren();
  const validIds = new Set((state.portfolio.transactions || []).map((transaction) => transaction.id));
  state.selected = new Set([...state.selected].filter((id) => validIds.has(id)));
  el("transactions-empty").hidden = visible.length > 0;

  for (const transaction of visible) {
    const row = document.createElement("tr");
    const checkCell = document.createElement("td");
    checkCell.className = "checkbox-cell";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selected.has(transaction.id);
    checkbox.ariaLabel = `${shorten(transaction.hash)} auswählen`;
    checkbox.addEventListener("change", () => {
      checkbox.checked ? state.selected.add(transaction.id) : state.selected.delete(transaction.id);
      updateSelectionUi();
    });
    checkCell.append(checkbox);

    const operation = document.createElement("td");
    const direction = document.createElement("span");
    direction.className = `direction ${transaction.direction}`;
    direction.textContent = transaction.direction === "in" ? "↓" : transaction.direction === "out" ? "↑" : "↔";
    direction.title = directionLabel(transaction.direction);
    const operationText = document.createElement("div");
    operationText.className = "operation-text";
    const hash = document.createElement("a");
    hash.href = safeExplorerUrl(transaction);
    hash.target = "_blank";
    hash.rel = "noreferrer";
    hash.textContent = shorten(transaction.hash, 10, 7);
    const when = document.createElement("small");
    when.textContent = transaction.timestamp ? dateTime.format(new Date(transaction.timestamp)) : "Unbestätigt";
    operationText.append(hash, when);
    operation.append(direction, operationText);

    const wallet = document.createElement("td");
    const walletTitle = document.createElement("strong");
    walletTitle.textContent = transaction.wallet_label || `${chainInfo(transaction.chain).name}-Wallet`;
    const walletMeta = document.createElement("small");
    walletMeta.textContent = transaction.source_type === "xpub"
      ? `${transaction.chain} · xPub-Wallet`
      : `${transaction.chain} · ${shorten(transaction.address, 6, 5)}`;
    wallet.append(walletTitle, walletMeta);

    const amount = document.createElement("td");
    amount.className = `amount ${transaction.direction}`;
    amount.textContent = `${transaction.direction === "in" ? "+" : transaction.direction === "out" ? "−" : ""}${formatAmount(transaction.amount, transaction.asset)}`;
    const fee = document.createElement("small");
    fee.textContent = Number(transaction.fee) > 0 ? `Gebühr ${formatAmount(transaction.fee, transaction.asset)}` : "";
    amount.append(fee);

    const now = document.createElement("td");
    now.className = "price-cell";
    now.textContent = formatPrice(transaction.price_now_eur);
    const currentValue = hasPrice(transaction.price_now_eur) ? Number(transaction.price_now_eur) * Number(transaction.amount) : null;
    const nowSub = document.createElement("small");
    nowSub.textContent = Number.isFinite(currentValue) ? `Wert: ${currency.format(currentValue)}` : "";
    now.append(nowSub);

    const historic = document.createElement("td");
    historic.className = "price-cell";
    historic.textContent = formatPrice(transaction.price_transaction_eur);
    const historicValue = hasPrice(transaction.price_transaction_eur)
      ? Number(transaction.price_transaction_eur) * Number(transaction.amount)
      : null;
    const historicSub = document.createElement("small");
    historicSub.textContent = Number.isFinite(historicValue)
      ? `${transaction.chain === "XTZ" ? "TzKT-Kurs" : "CoinGecko-Tageskurs"} · ${currency.format(historicValue)}`
      : "Nicht verfügbar";
    historic.append(historicSub);

    const purposeCell = document.createElement("td");
    purposeCell.className = "purpose-cell";
    const info = purposeInfo(transaction);
    const purposeCard = document.createElement("div");
    purposeCard.className = `purpose-card ${info.tone}`;
    const purposeIcon = document.createElement("span");
    purposeIcon.className = "purpose-icon";
    purposeIcon.textContent = info.icon;
    purposeIcon.setAttribute("aria-hidden", "true");
    const purposeCopy = document.createElement("div");
    const purposeName = document.createElement("strong");
    purposeName.textContent = info.label;
    const purposeSource = document.createElement("small");
    purposeSource.textContent = `${transaction.direction === "in" ? "Zugang" : directionLabel(transaction.direction)} · ${info.source}`;
    purposeCopy.append(purposeName, purposeSource);
    purposeCard.append(purposeIcon, purposeCopy);
    const select = document.createElement("select");
    select.className = "purpose-select";
    select.ariaLabel = `Zweck für Transaktion ${shorten(transaction.hash)}`;
    purposeOptions(select, transaction.purpose || "");
    select.addEventListener("change", () => {
      if (select.value !== "__custom__") {
        setTransactionPurpose(transaction.id, select.value);
        return;
      }
      const customPurpose = prompt("Eigenen Zweck für diese Transaktion eingeben:", transaction.purpose || "");
      if (customPurpose === null) {
        select.value = transaction.purpose || "";
        return;
      }
      setTransactionPurpose(transaction.id, customPurpose.trim());
    });
    purposeCell.append(purposeCard, select);
    row.append(checkCell, operation, wallet, amount, now, historic, purposeCell);
    body.append(row);
  }
  updateSelectionUi();
}

function updateSelectionUi() {
  const visible = getFilteredTransactions();
  const visibleSelected = visible.filter((transaction) => state.selected.has(transaction.id));
  const bulkBar = el("bulk-bar");
  bulkBar.hidden = state.selected.size === 0;
  el("selected-count").textContent = state.selected.size;
  const selectAll = el("select-all");
  selectAll.checked = visible.length > 0 && visibleSelected.length === visible.length;
  selectAll.indeterminate = visibleSelected.length > 0 && visibleSelected.length < visible.length;
  if (state.portfolio) purposeOptions(el("bulk-purpose"));
}

function render() {
  if (!state.portfolio) return;
  renderChainControls();
  updateWalletFields();
  renderSummary();
  renderWallets();
  renderTransactions();
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

async function loadPortfolio({ quiet = false } = {}) {
  try {
    if (!quiet) el("price-status").textContent = "Ansicht wird geladen …";
    state.portfolio = await api("/api/portfolio");
    render();
  } catch (error) {
    toast(error.message, "error");
    el("price-status").textContent = "Daten momentan nicht verfügbar";
  }
}

function toast(message, kind = "success") {
  const container = el("toast");
  container.textContent = message;
  container.className = `toast ${kind}`;
  container.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { container.hidden = true; }, 4200);
}

function setButtonBusy(button, busy, busyText = "Bitte warten …") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

async function syncWallet(id, button) {
  try {
    setButtonBusy(button, true, "…");
    const result = await api(`/api/wallets/${id}/sync`, { method: "POST" });
    await loadPortfolio({ quiet: true });
    const xpubScanNotice = result.xpubCapped ? " Die xPub-Suche erreichte ihr Sicherheitslimit; erhöhe es bei Bedarf in der Server-Konfiguration." : "";
    toast(`${result.imported.toLocaleString("de-DE")} Transaktionen synchronisiert${result.limited ? " (Importlimit aktiv)" : ""}.${xpubScanNotice}`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
}

async function syncAll() {
  const wallets = state.portfolio?.wallets || [];
  if (wallets.length === 0) {
    openWalletModal();
    return;
  }
  const button = el("refresh-all");
  try {
    setButtonBusy(button, true, "Synchronisiert …");
    const results = [];
    for (const wallet of wallets) results.push(await api(`/api/wallets/${wallet.id}/sync`, { method: "POST" }));
    await loadPortfolio({ quiet: true });
    toast(`${results.reduce((sum, result) => sum + result.imported, 0).toLocaleString("de-DE")} Transaktionen aktualisiert.`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
}

async function deleteWallet(wallet) {
  if (!confirm(`„${walletName(wallet)}“ und alle zugehörigen Transaktionen wirklich entfernen?`)) return;
  try {
    await api(`/api/wallets/${wallet.id}`, { method: "DELETE" });
    state.selected.clear();
    await loadPortfolio({ quiet: true });
    toast("Wallet und zugehörige Transaktionen wurden entfernt.");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function setTransactionPurpose(id, purpose) {
  try {
    const result = await api(`/api/transactions/${id}`, { method: "PATCH", body: JSON.stringify({ purpose }) });
    const transaction = state.portfolio.transactions.find((item) => item.id === id);
    if (transaction) {
      transaction.purpose = result.purpose;
      transaction.purpose_origin = result.purpose_origin;
    }
    renderTransactions();
    toast(purpose ? `Zweck „${purpose}“ gespeichert.` : "Zweck entfernt.");
  } catch (error) {
    toast(error.message, "error");
    await loadPortfolio({ quiet: true });
  }
}

async function applyBulkPurpose() {
  const ids = [...state.selected];
  if (!ids.length) return;
  const button = el("apply-bulk-purpose");
  let purpose = el("bulk-purpose").value;
  if (purpose === "__custom__") {
    const customPurpose = prompt("Eigenen Zweck für die ausgewählten Transaktionen eingeben:", "");
    if (customPurpose === null) return;
    purpose = customPurpose.trim();
  }
  try {
    setButtonBusy(button, true, "Speichert …");
    const result = await api("/api/transactions/bulk", { method: "PATCH", body: JSON.stringify({ ids, purpose }) });
    for (const transaction of state.portfolio.transactions) {
      if (state.selected.has(transaction.id)) {
        transaction.purpose = result.purpose;
        transaction.purpose_origin = result.purpose_origin;
      }
    }
    state.selected.clear();
    renderTransactions();
    toast(`${result.updated.toLocaleString("de-DE")} Zwecke gespeichert.`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
}

function openWalletModal() {
  if (!state.portfolio) {
    toast("Netzwerke werden noch geladen …");
    loadPortfolio();
    return;
  }
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

function updateWalletFields() {
  const chain = el("wallet-chain").value;
  const info = chainInfo(chain);
  const bitcoin = Boolean(info.supportsXpub);
  const sourceType = el("wallet-source-type");
  if (!bitcoin) sourceType.value = "address";
  const xpub = bitcoin && sourceType.value === "xpub";
  const inferredAddressType = xpubAddressTypeFor(el("wallet-address").value);
  if (xpub && inferredAddressType) el("xpub-address-type").value = inferredAddressType;
  el("bitcoin-source-fields").hidden = !bitcoin;
  el("xpub-format-wrap").hidden = !xpub;
  el("xpub-notice").hidden = !xpub;
  el("wallet-identifier-label").textContent = xpub ? "Bitcoin-xPub" : "Öffentliche Wallet-Adresse";
  el("wallet-address").placeholder = xpub ? "xpub6…" : info.addressPlaceholder || "Öffentliche Adresse";
  el("address-hint").textContent = xpub
    ? "xPub, yPub und zPub werden erkannt. Leerzeichen und Zeilenumbrüche aus dem Einfügen werden automatisch entfernt."
    : info.addressHint || `Öffentliche ${info.name}-Adresse eingeben.`;
}

function bindEvents() {
  el("open-wallet-modal").addEventListener("click", openWalletModal);
  el("open-wallet-empty").addEventListener("click", openWalletModal);
  el("close-wallet-modal").addEventListener("click", closeWalletModal);
  el("cancel-wallet").addEventListener("click", closeWalletModal);
  el("wallet-chain").addEventListener("change", updateWalletFields);
  el("wallet-source-type").addEventListener("change", updateWalletFields);
  el("wallet-address").addEventListener("input", () => {
    const identifier = el("wallet-address");
    const normalized = normalizeExtendedPublicKey(identifier.value);
    if (el("wallet-chain").value !== "BTC" || !isExtendedPublicKey(normalized)) return;
    if (identifier.value !== normalized) identifier.value = normalized;
    el("wallet-source-type").value = "xpub";
    updateWalletFields();
  });
  el("refresh-all").addEventListener("click", syncAll);
  el("reload-portfolio").addEventListener("click", () => loadPortfolio());
  el("transaction-search").addEventListener("input", (event) => {
    state.filters.search = event.target.value;
    renderTransactions();
  });
  el("chain-filter").addEventListener("change", (event) => {
    state.filters.chain = event.target.value;
    renderTransactions();
  });
  el("direction-filter").addEventListener("change", (event) => {
    state.filters.direction = event.target.value;
    renderTransactions();
  });
  el("select-all").addEventListener("change", (event) => {
    for (const transaction of getFilteredTransactions()) {
      event.target.checked ? state.selected.add(transaction.id) : state.selected.delete(transaction.id);
    }
    renderTransactions();
  });
  el("clear-selection").addEventListener("click", () => {
    state.selected.clear();
    renderTransactions();
  });
  el("apply-bulk-purpose").addEventListener("click", applyBulkPurpose);
  el("wallet-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const save = el("save-wallet");
    const formError = el("wallet-form-error");
    formError.hidden = true;
    try {
      setButtonBusy(save, true, "Speichert …");
      const rawIdentifier = String(form.get("address") || "");
      const identifier = isExtendedPublicKey(rawIdentifier) ? normalizeExtendedPublicKey(rawIdentifier) : rawIdentifier.trim();
      const detectedXpub = isExtendedPublicKey(identifier);
      const wallet = await api("/api/wallets", {
        method: "POST",
        body: JSON.stringify({
          chain: form.get("chain"),
          label: form.get("label"),
          address: identifier,
          sourceType: detectedXpub ? "xpub" : form.get("sourceType"),
          xpubAddressType: xpubAddressTypeFor(identifier) || form.get("xpubAddressType"),
        }),
      });
      const syncResult = await api(`/api/wallets/${wallet.id}/sync`, { method: "POST" });
      closeWalletModal();
      await loadPortfolio({ quiet: true });
      toast(`Wallet gespeichert · ${syncResult.imported.toLocaleString("de-DE")} Transaktionen importiert.`);
    } catch (error) {
      formError.textContent = error.message;
      formError.hidden = false;
    } finally {
      setButtonBusy(save, false);
    }
  });
}

bindEvents();
loadPortfolio();
