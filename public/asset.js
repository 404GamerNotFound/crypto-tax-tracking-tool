const params = new URLSearchParams(window.location.search);
const requestedChain = String(params.get("chain") || "BTC").toUpperCase();
const requestedAsset = String(params.get("asset") || "");
const state = { portfolio: null, selected: new Set(), filters: { search: "", direction: "" } };
const el = (id) => document.getElementById(id);
const currency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const price = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 4 });
const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

function hasPrice(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function formatPrice(value) {
  return hasPrice(value) ? price.format(Number(value)) : "k. A.";
}

function formatCurrency(value) {
  return value !== null && value !== "" && value !== undefined && Number.isFinite(Number(value)) ? currency.format(Number(value)) : "k. A.";
}

function chainInfo() {
  return state.portfolio?.chains?.[requestedChain] || { name: requestedChain, asset: requestedChain, decimals: 6, icon: requestedChain.slice(0, 1) };
}

function activeAssetId() {
  return requestedAsset || chainInfo().asset;
}

function assetInfo(assetId = activeAssetId()) {
  return state.portfolio?.assets?.[assetId] || { id: assetId, name: chainInfo().name, symbol: chainInfo().asset, decimals: chainInfo().decimals, chain: requestedChain, kind: "native" };
}

function formatAmount(value, assetId = activeAssetId()) {
  const asset = assetInfo(assetId);
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: asset.decimals || 6 }).format(Number(value || 0))} ${asset.symbol}`;
}

function shorten(value, start = 10, end = 7) {
  return value && value.length > start + end + 2 ? `${value.slice(0, start)}…${value.slice(-end)}` : value || "—";
}

function purposeInfo(transaction) {
  const defaults = {
    "Staking Rewards": ["✦", "staking", "Staking-Ertrag"], Kauf: ["↗", "purchase", "Kauf"], Verkauf: ["↘", "sale", "Verkauf"],
    "Mining Reward": ["⛏", "mining", "Mining-Ertrag"], Transfer: ["↔", "transfer", "Transfer"], Geschenk: ["◇", "gift", "Geschenk"],
    Gebühr: ["−", "fee", "Gebühr"], Sonstiges: ["•", "other", "Sonstiges"],
  };
  const [icon, tone, label] = defaults[transaction.purpose] || (transaction.purpose ? ["•", "custom", transaction.purpose] : ["?", "unassigned", "Noch nicht zugeordnet"]);
  const origin = transaction.purpose_origin === "auto" ? "automatisch erkannt" : transaction.purpose_origin === "manual" ? "manuell zugeordnet" : "Herkunft prüfen";
  return { icon, tone, label, origin };
}

function directionLabel(direction) {
  return { in: "Zugang", out: "Abgang", self: "Eigener Transfer" }[direction] || "Unbekannt";
}

function explorerUrl(type, value) {
  return chainInfo().explorer?.[type]?.replace("{value}", encodeURIComponent(value)) || "#";
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

function metric(label, value, help = "", tone = "") {
  const article = document.createElement("article");
  article.className = `asset-metric ${tone}`;
  const caption = document.createElement("span");
  caption.className = "card-label";
  caption.textContent = label;
  const main = document.createElement("strong");
  main.textContent = value;
  article.append(caption, main);
  if (help) {
    const detail = document.createElement("span");
    detail.className = "muted";
    detail.textContent = help;
    article.append(detail);
  }
  return article;
}

function renderMetrics() {
  const report = state.portfolio.assetAnalytics?.[activeAssetId()];
  const metrics = el("asset-metrics");
  metrics.replaceChildren();
  metrics.append(
    metric("Aktueller Bestand", formatAmount(report?.holdingAmount || 0), `Marktwert ${formatCurrency(report?.holdingValueEur)}`, "highlight"),
    metric("Als Kauf erfasst", formatAmount(report?.purchases?.acquiredAmount || 0), `${report?.purchases?.count || 0} Kauf-Transaktionen`),
    metric("Noch aus Käufen gehalten", formatAmount(report?.purchases?.remainingAmount || 0), report?.purchases?.hasUnknownCost ? "Kaufkurs teilweise nicht verfügbar" : `Kosten ${formatCurrency(report?.purchases?.remainingCostEur)}`),
    metric("Gewinn ggü. Kauf", formatCurrency(report?.purchases?.profitEur), report?.purchases?.profitEur === null ? "Historischer Kaufkurs fehlt" : "Aktueller Wert minus FIFO-Kaufkosten", Number(report?.purchases?.profitEur) >= 0 ? "positive" : "negative"),
    metric("Staking-Ertrag", formatAmount(report?.staking?.amount || 0), `${report?.staking?.count || 0} Ertrags-Transaktionen · aktuell ${formatCurrency(report?.staking?.currentValueEur)}`, "staking"),
  );
}

function getTransactions() {
  const search = state.filters.search.toLocaleLowerCase("de-DE").trim();
  return (state.portfolio?.transactions || []).filter((transaction) => {
    if (transaction.asset !== activeAssetId()) return false;
    if (state.filters.direction && transaction.direction !== state.filters.direction) return false;
    if (!search) return true;
    return [transaction.hash, transaction.wallet_label, transaction.address, transaction.purpose, transaction.counterparty]
      .filter(Boolean).join(" ").toLocaleLowerCase("de-DE").includes(search);
  });
}

function purposeOptions(select, selected = "") {
  select.replaceChildren(new Option("Kein Zweck", ""));
  for (const preset of state.portfolio?.purposePresets || []) select.add(new Option(preset, preset));
  select.add(new Option("Eigener Zweck …", "__custom__"));
  if (selected && ![...select.options].some((option) => option.value === selected)) select.add(new Option(selected, selected));
  select.value = selected || "";
}

function renderPurpose(transaction) {
  const info = purposeInfo(transaction);
  const cell = document.createElement("td");
  cell.className = "purpose-cell";
  const card = document.createElement("div");
  card.className = `purpose-card ${info.tone}`;
  const icon = document.createElement("span");
  icon.className = "purpose-icon";
  icon.textContent = info.icon;
  const copy = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = info.label;
  const origin = document.createElement("small");
  origin.textContent = `${directionLabel(transaction.direction)} · ${info.origin}`;
  copy.append(name, origin);
  card.append(icon, copy);
  const select = document.createElement("select");
  select.className = "purpose-select";
  select.ariaLabel = `Zweck für Transaktion ${shorten(transaction.hash)}`;
  purposeOptions(select, transaction.purpose || "");
  select.addEventListener("change", () => {
    if (select.value !== "__custom__") return setTransactionPurpose(transaction.id, select.value);
    const value = prompt("Eigenen Zweck für diese Transaktion eingeben:", transaction.purpose || "");
    if (value === null) return (select.value = transaction.purpose || "");
    return setTransactionPurpose(transaction.id, value.trim());
  });
  cell.append(card, select);
  return cell;
}

function renderTransactions() {
  const transactions = getTransactions();
  const valid = new Set((state.portfolio?.transactions || []).map((transaction) => transaction.id));
  state.selected = new Set([...state.selected].filter((id) => valid.has(id)));
  const body = el("transaction-list");
  body.replaceChildren();
  for (const transaction of transactions) {
    const row = document.createElement("tr");
    const selectCell = document.createElement("td");
    selectCell.className = "checkbox-cell";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selected.has(transaction.id);
    checkbox.addEventListener("change", () => {
      checkbox.checked ? state.selected.add(transaction.id) : state.selected.delete(transaction.id);
      updateSelectionUi();
    });
    selectCell.append(checkbox);

    const operation = document.createElement("td");
    const direction = document.createElement("span");
    direction.className = `direction ${transaction.direction}`;
    direction.textContent = transaction.direction === "in" ? "↓" : transaction.direction === "out" ? "↑" : "↔";
    const operationCopy = document.createElement("div");
    operationCopy.className = "operation-text";
    const hash = document.createElement("a");
    hash.href = explorerUrl("transaction", transaction.hash);
    hash.target = "_blank";
    hash.rel = "noreferrer";
    hash.textContent = shorten(transaction.hash);
    const when = document.createElement("small");
    when.textContent = transaction.timestamp ? dateTime.format(new Date(transaction.timestamp)) : "Unbestätigt";
    operationCopy.append(hash, when);
    operation.append(direction, operationCopy);

    const wallet = document.createElement("td");
    const walletTitle = document.createElement("strong");
    walletTitle.textContent = transaction.wallet_label || `${chainInfo().name}-Wallet`;
    const address = document.createElement("small");
    address.textContent = transaction.source_type === "xpub" ? "Bitcoin-xPub" : shorten(transaction.address, 7, 6);
    wallet.append(walletTitle, address);

    const amount = document.createElement("td");
    amount.className = `amount ${transaction.direction}`;
    amount.textContent = `${transaction.direction === "in" ? "+" : transaction.direction === "out" ? "−" : ""}${formatAmount(transaction.amount, transaction.asset)}`;
    const fee = document.createElement("small");
    fee.textContent = Number(transaction.fee) > 0 ? `Gebühr ${formatAmount(transaction.fee, transaction.fee_asset || transaction.asset)}` : "";
    amount.append(fee);

    const now = document.createElement("td");
    now.className = "price-cell";
    now.textContent = formatPrice(transaction.price_now_eur);
    const nowValue = hasPrice(transaction.price_now_eur) ? Number(transaction.price_now_eur) * Number(transaction.amount) : null;
    const nowDetail = document.createElement("small");
    nowDetail.textContent = nowValue === null ? "" : `Wert: ${formatCurrency(nowValue)}`;
    now.append(nowDetail);

    const historic = document.createElement("td");
    historic.className = "price-cell";
    historic.textContent = formatPrice(transaction.price_transaction_eur);
    const historicValue = hasPrice(transaction.price_transaction_eur) ? Number(transaction.price_transaction_eur) * Number(transaction.amount) : null;
    const historicDetail = document.createElement("small");
    historicDetail.textContent = historicValue === null ? "Nicht verfügbar" : `Wert: ${formatCurrency(historicValue)}`;
    historic.append(historicDetail);
    row.append(selectCell, operation, wallet, amount, now, historic, renderPurpose(transaction));
    body.append(row);
  }
  el("transactions-empty").hidden = transactions.length > 0;
  updateSelectionUi();
}

function updateSelectionUi() {
  const visible = getTransactions();
  const selectedVisible = visible.filter((transaction) => state.selected.has(transaction.id));
  el("bulk-bar").hidden = state.selected.size === 0;
  el("selected-count").textContent = state.selected.size;
  const selectAll = el("select-all");
  selectAll.checked = visible.length > 0 && visible.length === selectedVisible.length;
  selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visible.length;
  if (state.portfolio) purposeOptions(el("bulk-purpose"));
}

async function setTransactionPurpose(id, purpose) {
  try {
    const result = await api(`/api/transactions/${id}`, { method: "PATCH", body: JSON.stringify({ purpose }) });
    const transaction = state.portfolio.transactions.find((item) => item.id === id);
    transaction.purpose = result.purpose;
    transaction.purpose_origin = result.purpose_origin;
    renderMetrics();
    renderTransactions();
    toast(purpose ? `Zweck „${purpose}“ gespeichert.` : "Zweck entfernt.");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function applyBulkPurpose() {
  const ids = [...state.selected];
  if (!ids.length) return;
  let purpose = el("bulk-purpose").value;
  if (purpose === "__custom__") {
    const value = prompt("Eigenen Zweck für die ausgewählten Transaktionen eingeben:", "");
    if (value === null) return;
    purpose = value.trim();
  }
  const button = el("apply-bulk-purpose");
  button.disabled = true;
  button.textContent = "Speichert …";
  try {
    const result = await api("/api/transactions/bulk", { method: "PATCH", body: JSON.stringify({ ids, purpose }) });
    for (const transaction of state.portfolio.transactions) {
      if (state.selected.has(transaction.id)) {
        transaction.purpose = result.purpose;
        transaction.purpose_origin = result.purpose_origin;
      }
    }
    state.selected.clear();
    renderMetrics();
    renderTransactions();
    toast(`${result.updated.toLocaleString("de-DE")} Zwecke gespeichert.`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Zweck übernehmen";
  }
}

function renderPage() {
  const chain = chainInfo();
  const asset = assetInfo();
  document.title = `CryptoBuch · ${asset.name}`;
  el("asset-icon").textContent = asset.icon;
  el("asset-icon").className = `asset-hero-icon ${requestedChain.toLowerCase()}`;
  el("asset-title").textContent = asset.name;
  el("asset-subtitle").textContent = asset.kind === "erc20"
    ? `Ethereum ERC-20 · ${asset.symbol} · Transaktionen und Auswertung dieses Tokens.`
    : `Käufe, Erträge und alle ${asset.symbol}-Bewegungen in deinem Portfolio.`;
  const report = state.portfolio.assetAnalytics?.[activeAssetId()];
  const prices = state.portfolio.currentPrices || {};
  el("price-status").textContent = prices.warning ? "Preisabfrage momentan nicht verfügbar" : hasPrice(report?.currentPriceEur) ? `1 ${asset.symbol} · ${formatPrice(report.currentPriceEur)}` : "Aktueller Preis nicht verfügbar";
  renderMetrics();
  renderTransactions();
}

async function loadPortfolio({ quiet = false } = {}) {
  try {
    if (!quiet) el("price-status").textContent = "Ansicht wird geladen …";
    state.portfolio = await api("/api/portfolio");
    if (!state.portfolio.chains?.[requestedChain] || !state.portfolio.assets?.[activeAssetId()] || state.portfolio.assets[activeAssetId()].chain !== requestedChain) return window.location.replace("/");
    renderPage();
  } catch (error) {
    toast(error.message, "error");
    el("price-status").textContent = "Daten momentan nicht verfügbar";
  }
}

async function syncChain() {
  const wallets = (state.portfolio?.wallets || []).filter((wallet) => wallet.chain === requestedChain);
  if (!wallets.length) return window.location.assign("/wallets.html");
  const button = el("refresh-chain");
  button.disabled = true;
  button.textContent = "Synchronisiert …";
  try {
    const results = [];
    for (const wallet of wallets) results.push(await api(`/api/wallets/${wallet.id}/sync`, { method: "POST" }));
    await loadPortfolio({ quiet: true });
    toast(`${results.reduce((sum, result) => sum + result.imported, 0).toLocaleString("de-DE")} ${assetInfo().symbol}-Transaktionen aktualisiert.`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Coin aktualisieren";
  }
}

el("transaction-search").addEventListener("input", (event) => { state.filters.search = event.target.value; renderTransactions(); });
el("direction-filter").addEventListener("change", (event) => { state.filters.direction = event.target.value; renderTransactions(); });
el("select-all").addEventListener("change", (event) => {
  for (const transaction of getTransactions()) event.target.checked ? state.selected.add(transaction.id) : state.selected.delete(transaction.id);
  renderTransactions();
});
el("clear-selection").addEventListener("click", () => { state.selected.clear(); renderTransactions(); });
el("apply-bulk-purpose").addEventListener("click", applyBulkPurpose);
el("reload-portfolio").addEventListener("click", () => loadPortfolio());
el("refresh-chain").addEventListener("click", syncChain);
loadPortfolio();
