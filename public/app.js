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

function formatPrice(value) {
  return Number.isFinite(Number(value)) ? price.format(Number(value)) : "k. A.";
}

function formatAmount(value, asset) {
  const decimals = asset === "BTC" ? 8 : 6;
  return `${compactNumber(decimals).format(Number(value))} ${asset}`;
}

function shorten(value, start = 7, end = 6) {
  if (!value || value.length <= start + end + 2) return value || "—";
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

function directionLabel(direction) {
  return { in: "Eingang", out: "Ausgang", self: "Eigener Transfer" }[direction] || "Unbekannt";
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
  const base = transaction.chain === "BTC" ? "https://blockstream.info/tx/" : "https://tzkt.io/";
  return `${base}${encodeURIComponent(transaction.hash)}`;
}

function renderSummary() {
  const portfolio = state.portfolio;
  const prices = portfolio.currentPrices || {};
  el("total-value").textContent = Number.isFinite(Number(portfolio.totalValueEur)) ? currency.format(portfolio.totalValueEur) : "k. A.";
  el("btc-holding").textContent = formatAmount(portfolio.holdings.BTC || 0, "BTC");
  el("xtz-holding").textContent = formatAmount(portfolio.holdings.XTZ || 0, "XTZ");
  el("btc-price").textContent = `1 BTC · ${formatPrice(prices.BTC)}`;
  el("xtz-price").textContent = `1 XTZ · ${formatPrice(prices.XTZ)}`;
  el("transaction-count").textContent = portfolio.transactions.length.toLocaleString("de-DE");
  const updated = prices.updatedAt ? `Preisstand ${dateTime.format(new Date(prices.updatedAt * 1000))}` : "Aktuelle Preise nicht verfügbar";
  el("price-status").textContent = prices.warning ? "Preisabfrage momentan nicht verfügbar" : updated;
}

function walletName(wallet) {
  return wallet.label || `${wallet.chain === "BTC" ? "Bitcoin" : "Tezos"}-Wallet`;
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
    icon.textContent = wallet.chain === "BTC" ? "₿" : "ꜩ";
    const details = document.createElement("div");
    details.className = "wallet-details";
    const title = document.createElement("strong");
    title.textContent = walletName(wallet);
    const address = document.createElement("a");
    address.href = wallet.chain === "BTC" ? `https://blockstream.info/address/${encodeURIComponent(wallet.address)}` : `https://tzkt.io/${encodeURIComponent(wallet.address)}`;
    address.target = "_blank";
    address.rel = "noreferrer";
    address.textContent = shorten(wallet.address, 9, 7);
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
    walletTitle.textContent = transaction.wallet_label || `${transaction.chain === "BTC" ? "Bitcoin" : "Tezos"}-Wallet`;
    const walletMeta = document.createElement("small");
    walletMeta.textContent = `${transaction.chain} · ${shorten(transaction.address, 6, 5)}`;
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
    const currentValue = Number(transaction.price_now_eur) * Number(transaction.amount);
    const nowSub = document.createElement("small");
    nowSub.textContent = Number.isFinite(currentValue) ? `Wert: ${currency.format(currentValue)}` : "";
    now.append(nowSub);

    const historic = document.createElement("td");
    historic.className = "price-cell";
    historic.textContent = formatPrice(transaction.price_transaction_eur);
    const historicValue = Number(transaction.price_transaction_eur) * Number(transaction.amount);
    const historicSub = document.createElement("small");
    historicSub.textContent = Number.isFinite(historicValue) ? `Wert: ${currency.format(historicValue)}` : "Nicht verfügbar";
    historic.append(historicSub);

    const purposeCell = document.createElement("td");
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
    purposeCell.append(select);
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
    toast(`${result.imported.toLocaleString("de-DE")} Transaktionen synchronisiert${result.limited ? " (Importlimit aktiv)" : ""}.`);
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
    await api(`/api/transactions/${id}`, { method: "PATCH", body: JSON.stringify({ purpose }) });
    const transaction = state.portfolio.transactions.find((item) => item.id === id);
    if (transaction) transaction.purpose = purpose || null;
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
      if (state.selected.has(transaction.id)) transaction.purpose = result.purpose;
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
  el("wallet-form-error").hidden = true;
  el("wallet-modal").showModal();
  setTimeout(() => el("wallet-address").focus(), 0);
}

function closeWalletModal() {
  el("wallet-modal").close();
  el("wallet-form").reset();
}

function updateAddressHint() {
  const bitcoin = el("wallet-chain").value === "BTC";
  el("wallet-address").placeholder = bitcoin ? "bc1… oder 1…" : "tz1… oder KT1…";
  el("address-hint").textContent = bitcoin
    ? "Bitcoin: Legacy-, SegWit- und Taproot-Adressen werden unterstützt."
    : "Tezos: tz1-, tz2-, tz3- und KT1-Adressen werden unterstützt.";
}

function bindEvents() {
  el("open-wallet-modal").addEventListener("click", openWalletModal);
  el("open-wallet-empty").addEventListener("click", openWalletModal);
  el("close-wallet-modal").addEventListener("click", closeWalletModal);
  el("cancel-wallet").addEventListener("click", closeWalletModal);
  el("wallet-chain").addEventListener("change", updateAddressHint);
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
      const wallet = await api("/api/wallets", {
        method: "POST",
        body: JSON.stringify({ chain: form.get("chain"), label: form.get("label"), address: form.get("address") }),
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
