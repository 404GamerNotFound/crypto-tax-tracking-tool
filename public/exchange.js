const params = new URLSearchParams(window.location.search);
const exchangeId = Number(params.get("id"));
const state = { data: null, filters: { search: "", direction: "" } };
const { api, el, exchangeProviderLabel: providerLabel, formatCurrency, hasNumber, purposeInfo, toast } = window.CryptoBuchUI;
const price = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 6 });
const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
let historyRefreshTimer = null;

function formatPrice(value) {
  return hasNumber(value) && Number(value) > 0 ? price.format(Number(value)) : "k. A.";
}

function assetInfo(assetId) {
  const holding = state.data?.assets?.find((asset) => asset.id === assetId);
  if (holding) return holding;
  const transaction = state.data?.transactions?.find((entry) => entry.asset === assetId);
  return transaction
    ? { symbol: transaction.asset_symbol || assetId, name: transaction.asset_name || transaction.asset_symbol || assetId, decimals: transaction.asset_decimals || 8, icon: "◇" }
    : { symbol: assetId, name: assetId, decimals: 8, icon: "◇" };
}

function formatAmount(value, assetId) {
  const asset = assetInfo(assetId);
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: asset.decimals || 8 }).format(Number(value || 0))} ${asset.symbol || assetId}`;
}

function shorten(value, start = 12, end = 8) {
  const text = String(value || "");
  return text.length > start + end + 2 ? `${text.slice(0, start)}…${text.slice(-end)}` : text || "—";
}

function hasAuthenticatedSnapshot(source) {
  return /_snapshot$/.test(String(source || ""));
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
  if (help) { const detail = document.createElement("span"); detail.className = "muted"; detail.textContent = help; article.append(detail); }
  return article;
}

function historyStatus(history) {
  if (!history) return null;
  if (history.status === "complete") return { value: "Vollständig", help: "Automatisch abrufbare Binance-Historie verarbeitet", tone: "success" };
  if (history.status === "attention") {
    const markets = (history.unresolvedMarkets || []).join(", ");
    return { value: "Unvollständig", help: markets ? `CSV-Export für ${markets} ergänzen` : "Historische Märkte oder CSV-Export ergänzen", tone: "warning" };
  }
  if (history.lastError) return { value: "Prüfen", help: history.lastError, tone: "warning" };
  const percent = history.progressTotal ? Math.min(100, Math.round((history.progressCurrent / history.progressTotal) * 100)) : 0;
  return { value: `${percent} %`, help: `${history.phaseLabel} werden automatisch und gedrosselt nachgeladen`, tone: "highlight" };
}

function renderMetrics() {
  const data = state.data;
  const assets = data.assets || [];
  const priced = assets.filter((asset) => hasNumber(asset.currentValueEur)).length;
  const metrics = el("exchange-metrics");
  const entries = [
    metric("Börsenwert", formatCurrency(data.totalValueEur), `${priced} von ${assets.length} Beständen aktuell bewertet`, "highlight"),
    metric("Aktive Bestände", assets.length.toLocaleString("de-DE"), "Assets mit positivem Saldo"),
    metric("Buchungen gespeichert", data.transactionCount.toLocaleString("de-DE"), "Alle lokal importierten Ein- und Ausgänge"),
    metric("Letzter Import", data.connection.lastSyncedAt ? dateTime.format(new Date(`${data.connection.lastSyncedAt}Z`)) : "Noch keiner", data.connection.importMode === "csv" ? "Lokaler CSV-/Beleg-Import" : "Read-only-API · keine Handelsrechte"),
  ];
  if (hasAuthenticatedSnapshot(data.balance?.source)) {
    entries.splice(2, 0, metric("Kontostand", "Bestätigt", data.balance.observedAt ? `${providerLabel(data.connection.provider)} · ${dateTime.format(new Date(`${data.balance.observedAt}Z`))}` : `${providerLabel(data.connection.provider)} Read-only`, "success"));
  } else {
    entries.splice(2, 0, metric("Kontostand", "Journal", "Kein aktueller API-Snapshot verfügbar", "warning"));
  }
  const history = historyStatus(data.connection.history);
  if (history) entries.push(metric("Binance-Historie", history.value, history.help, history.tone));
  if (data.connection.live?.enabled) {
    const live = data.connection.live;
    const copy = live.status === "connected" ? `Verbunden · REST-Abgleich alle ${live.reconcileIntervalMinutes} Min.`
      : live.status === "reconnecting" ? "Verbindung wird wiederhergestellt"
        : live.status === "error" ? (live.lastError || "Verbindung prüfen") : "Wird verbunden";
    entries.push(metric("Live-Updates", live.status === "connected" ? "Aktiv" : "Prüfen", copy, live.status === "connected" ? "success" : "warning"));
  }
  metrics.replaceChildren(...entries);
}

function renderBalanceNotice() {
  const notice = el("exchange-balance-notice");
  const balance = state.data?.balance || {};
  const differences = balance.reconciliations || [];
  notice.replaceChildren();
  if (!hasAuthenticatedSnapshot(balance.source) && !differences.length) {
    el("exchange-holdings-copy").textContent = "Aus dem lokal gespeicherten Buchungsjournal berechnet.";
    notice.hidden = true;
    return;
  }
  el("exchange-holdings-copy").textContent = hasAuthenticatedSnapshot(balance.source)
    ? `Aus dem aktuellen, read-only abgefragten ${providerLabel(state.data.connection.provider)}-Kontostand.`
    : "Aus dem lokal gespeicherten Buchungsjournal berechnet.";
  const title = document.createElement("strong");
  const copy = document.createElement("p");
  if (!differences.length) {
    title.textContent = "Kontostand mit Journal abgeglichen";
    copy.textContent = `Der aktuelle ${providerLabel(state.data.connection.provider)}-Kontostand stimmt mit den importierten Buchungen überein. Der Kontostand wird nur lesend abgefragt.`;
  } else {
    const assets = differences.map((item) => item.asset).join(", ");
    title.textContent = "Historisches Journal weicht vom bestätigten Kontostand ab";
    copy.textContent = `Betroffen: ${assets}. Es werden ausschließlich die aktuellen ${providerLabel(state.data.connection.provider)}-Bestände angezeigt. Die Differenz wird nicht als Kauf, Verkauf oder FIFO-Charge erzeugt; ergänze fehlende Buchungen oder einen vollständigen Börsenexport.`;
  }
  notice.append(title, copy);
  notice.hidden = false;
}

function renderHoldings() {
  const assets = state.data.assets || [];
  const grid = el("exchange-holdings");
  grid.replaceChildren();
  for (const asset of assets) {
    const card = document.createElement("article");
    card.className = "exchange-holding-card";
    const header = document.createElement("div");
    header.className = "exchange-holding-head";
    const icon = document.createElement("span");
    icon.className = "exchange-asset-icon";
    icon.textContent = asset.icon || "◇";
    const title = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = asset.name || asset.symbol;
    const symbol = document.createElement("span");
    symbol.textContent = asset.symbol;
    title.append(name, symbol);
    header.append(icon, title);
    const amount = document.createElement("strong");
    amount.className = "exchange-holding-amount";
    amount.textContent = formatAmount(asset.amount, asset.id);
    const values = document.createElement("dl");
    for (const [label, value] of [["Preis jetzt", formatPrice(asset.currentPriceEur)], ["Marktwert", formatCurrency(asset.currentValueEur)]]) {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = label;
      const definition = document.createElement("dd");
      definition.textContent = value;
      row.append(term, definition);
      values.append(row);
    }
    card.append(header, amount, values);
    grid.append(card);
  }
  el("exchange-holdings-empty").hidden = assets.length > 0;
}

function filteredTransactions() {
  const term = state.filters.search.trim().toLocaleLowerCase("de-DE");
  return (state.data.transactions || []).filter((transaction) => {
    if (state.filters.direction && transaction.direction !== state.filters.direction) return false;
    if (!term) return true;
    return [transaction.asset, transaction.asset_symbol, transaction.asset_name, transaction.hash, transaction.purpose, transaction.counterparty]
      .some((value) => String(value || "").toLocaleLowerCase("de-DE").includes(term));
  });
}

function renderPurpose(transaction) {
  const info = purposeInfo(transaction);
  const cell = document.createElement("td");
  cell.className = "purpose-cell";
  const card = document.createElement("div");
  card.className = `purpose-card ${info.tone}`;
  const icon = document.createElement("span"); icon.className = "purpose-icon"; icon.textContent = info.icon;
  const copy = document.createElement("div");
  const label = document.createElement("strong"); label.textContent = info.label;
  const origin = document.createElement("small"); origin.textContent = info.origin;
  copy.append(label, origin); card.append(icon, copy); cell.append(card);
  return cell;
}

function renderTransactions() {
  const body = el("exchange-transaction-list");
  body.replaceChildren();
  const transactions = filteredTransactions();
  for (const transaction of transactions) {
    const row = document.createElement("tr");
    const operation = document.createElement("td");
    operation.className = "operation-cell";
    const operationLayout = document.createElement("div");
    operationLayout.className = "operation-layout";
    const direction = document.createElement("span");
    direction.className = `direction ${transaction.direction}`;
    direction.textContent = transaction.direction === "in" ? "↓" : transaction.direction === "out" ? "↑" : "↔";
    const copy = document.createElement("div");
    const hash = document.createElement("strong"); hash.textContent = shorten(transaction.hash);
    const timestamp = document.createElement("small"); timestamp.textContent = transaction.timestamp ? dateTime.format(new Date(transaction.timestamp)) : "Zeitpunkt unbekannt";
    copy.append(hash, timestamp); operationLayout.append(direction, copy); operation.append(operationLayout);
    const asset = document.createElement("td");
    const assetTitle = document.createElement("strong"); assetTitle.textContent = assetInfo(transaction.asset).name || transaction.asset;
    const assetSymbol = document.createElement("small"); assetSymbol.textContent = assetInfo(transaction.asset).symbol || transaction.asset;
    asset.append(assetTitle, assetSymbol);
    const amount = document.createElement("td");
    amount.className = `amount ${transaction.direction}`;
    amount.textContent = `${transaction.direction === "in" ? "+" : transaction.direction === "out" ? "−" : ""}${formatAmount(transaction.amount, transaction.asset)}`;
    if (Number(transaction.fee) > 0) { const fee = document.createElement("small"); fee.textContent = `Gebühr ${formatAmount(transaction.fee, transaction.fee_asset || transaction.asset)}`; amount.append(fee); }
    const now = document.createElement("td"); now.className = "price-cell"; now.textContent = formatPrice(transaction.price_now_eur);
    const historic = document.createElement("td"); historic.className = "price-cell"; historic.textContent = formatPrice(transaction.price_transaction_eur);
    const historicDetail = document.createElement("small"); historicDetail.textContent = transaction.price_source === "manual" ? "Manuell festgelegt" : hasNumber(transaction.price_transaction_eur) ? "Automatische Preisquelle" : "Nicht verfügbar"; historic.append(historicDetail);
    row.append(operation, asset, amount, now, historic, renderPurpose(transaction));
    body.append(row);
  }
  el("exchange-transactions-empty").hidden = transactions.length > 0;
}

function render() {
  const data = state.data;
  document.title = `CryptoBuch · ${data.connection.label || providerLabel(data.connection.provider)}`;
  el("exchange-title").textContent = data.connection.label || providerLabel(data.connection.provider);
  el("exchange-icon").textContent = data.connection.provider === "binance" ? "B" : data.connection.provider === "bitvavo" ? "V" : data.connection.provider === "etoro" ? "eT" : data.connection.provider === "bsdex" ? "BS" : "TR";
  el("exchange-icon").className = `asset-hero-icon exchange ${data.connection.provider}`;
  const csv = data.connection.importMode === "csv";
  const tradeRepublic = data.connection.tradeRepublic;
  const live = data.connection.live;
  el("exchange-subtitle").textContent = `${providerLabel(data.connection.provider)} · ${csv ? "lokaler Beleg-/CSV-Import" : "Read-only-Bestände"} und alle ${data.transactionCount.toLocaleString("de-DE")} lokal gespeicherten Börsenbuchungen.`;
  const history = historyStatus(data.connection.history);
  el("exchange-status").textContent = tradeRepublic?.status === "approval_pending"
    ? "Trade-Republic-App-Bestätigung erforderlich"
    : tradeRepublic?.status === "login_error"
      ? "Trade-Republic-Webanmeldung prüfen"
      : tradeRepublic?.status === "login_required"
        ? "Trade-Republic-Webanmeldung erforderlich"
    : history && data.connection.history.status !== "complete"
    ? `Historienimport: ${history.help}`
    : live?.enabled && live.status === "connected"
      ? `BSDEX-Live-Updates aktiv · REST-Abgleich alle ${live.reconcileIntervalMinutes} Min.`
      : live?.enabled && live.status === "reconnecting"
        ? "BSDEX-Live-Verbindung wird wiederhergestellt"
    : data.connection.lastSyncedAt ? `Letzter Import ${dateTime.format(new Date(`${data.connection.lastSyncedAt}Z`))}` : csv ? "Noch kein CSV-Import" : "Noch nicht synchronisiert";
  const refresh = el("refresh-exchange");
  refresh.hidden = csv || data.connection.syncAvailable === false;
  renderMetrics();
  renderBalanceNotice();
  renderHoldings();
  renderTransactions();
  clearTimeout(historyRefreshTimer);
  if ((data.connection.history && data.connection.history.status !== "complete" && !data.connection.history.lastError) || data.connection.live?.enabled) {
    historyRefreshTimer = setTimeout(() => load({ quiet: true }), data.connection.live?.enabled ? 10000 : 6000);
  }
}

async function load({ quiet = false } = {}) {
  try {
    if (!Number.isSafeInteger(exchangeId) || exchangeId <= 0) throw new Error("Ungültige Börsenverbindung.");
    if (!quiet) el("exchange-status").textContent = "Börse wird geladen …";
    state.data = await api(`/api/exchange-connections/${exchangeId}/portfolio`);
    render();
  } catch (error) {
    toast(error.message, "error");
    el("exchange-status").textContent = "Daten momentan nicht verfügbar";
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

async function syncExchange() {
  if (state.data?.connection?.syncAvailable === false) {
    toast("Diese Quelle wird über den lokalen CSV-Import aktualisiert.", "error");
    return;
  }
  const button = el("refresh-exchange");
  button.disabled = true;
  button.textContent = "Synchronisiert …";
  try {
    const queued = await api(`/api/exchange-connections/${exchangeId}/sync`, { method: "POST" });
    const result = await waitForJob(queued.job.id);
    await load({ quiet: true });
    toast(`${(result.imported || 0).toLocaleString("de-DE")} Börsenbuchungen synchronisiert${result.limited ? " (Importlimit aktiv)" : ""}${result.historyInProgress ? " Die Binance-Historie läuft automatisch weiter." : "."}`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Börse aktualisieren";
  }
}

el("refresh-exchange").addEventListener("click", syncExchange);
el("reload-exchange").addEventListener("click", () => load());
el("transaction-search").addEventListener("input", (event) => { state.filters.search = event.target.value; renderTransactions(); });
el("direction-filter").addEventListener("change", (event) => { state.filters.direction = event.target.value; renderTransactions(); });
load();
