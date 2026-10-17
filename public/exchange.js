const params = new URLSearchParams(window.location.search);
const exchangeId = Number(params.get("id"));
const state = { data: null, filters: { search: "", direction: "" } };
const { api, el, exchangeProviderLabel: providerLabel, formatCurrency, hasNumber, purposeInfo, toast } = window.CryptoBuchUI;
const price = new Intl.NumberFormat(window.CryptoBuchI18n.locale, { style: "currency", currency: "EUR", maximumFractionDigits: 6 });
const dateTime = new Intl.DateTimeFormat(window.CryptoBuchI18n.locale, { dateStyle: "medium", timeStyle: "short" });
let historyRefreshTimer = null;

function formatPrice(value) {
  return hasNumber(value) && Number(value) > 0 ? price.format(Number(value)) : window.CryptoBuchI18n.t("k. A.");
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
  return `${new Intl.NumberFormat(window.CryptoBuchI18n.locale, { maximumFractionDigits: asset.decimals || 8 }).format(Number(value || 0))} ${asset.symbol || assetId}`;
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
  if (history.status === "complete") return { value: window.CryptoBuchI18n.t("Vollständig"), help: window.CryptoBuchI18n.t("Automatisch abrufbare Börsenhistorie verarbeitet"), tone: "success" };
  if (history.status === "attention") {
    const markets = (history.unresolvedMarkets || []).join(", ");
    return { value: window.CryptoBuchI18n.t("Prüfen"), help: markets ? window.CryptoBuchI18n.t("CSV-Export für {p0} ergänzen", { p0: markets }) : window.CryptoBuchI18n.message(history.warnings?.[0]) || window.CryptoBuchI18n.t("Historische Märkte oder CSV-Export ergänzen"), tone: "warning" };
  }
  if (history.lastError) return { value: window.CryptoBuchI18n.t("Prüfen"), help: history.lastError, tone: "warning" };
  const percent = history.progressTotal ? Math.min(100, Math.round((history.progressCurrent / history.progressTotal) * 100)) : 0;
  return { value: `${percent} %`, help: window.CryptoBuchI18n.t("{p0} werden automatisch und gedrosselt nachgeladen", { p0: history.phaseLabel }), tone: "highlight" };
}

function renderMetrics() {
  const data = state.data;
  const assets = data.assets || [];
  const priced = assets.filter((asset) => hasNumber(asset.currentValueEur)).length;
  const metrics = el("exchange-metrics");
  const entries = [
    metric(data.connection.provider === "etoro" ? window.CryptoBuchI18n.t("Coin-Bestandswert") : window.CryptoBuchI18n.t("Börsenwert"), formatCurrency(data.totalValueEur), window.CryptoBuchI18n.t("{p0} von {p1} Coin-Beständen aktuell bewertet{p2}", { p0: priced, p1: assets.length, p2: data.hiddenAssets?.length ? window.CryptoBuchI18n.t(" · Ausgeblendete Coins ausgeschlossen (Auswahl im Dashboard).") : "" }), "highlight"),
    metric(window.CryptoBuchI18n.t("Aktive Bestände"), assets.length.toLocaleString(window.CryptoBuchI18n.locale), window.CryptoBuchI18n.t("Assets mit positivem Saldo")),
    metric(window.CryptoBuchI18n.t("Buchungen gespeichert"), data.transactionCount.toLocaleString(window.CryptoBuchI18n.locale), window.CryptoBuchI18n.t("Alle lokal importierten Ein- und Ausgänge")),
    metric(window.CryptoBuchI18n.t("Letzter Import"), data.connection.lastSyncedAt ? dateTime.format(new Date(`${data.connection.lastSyncedAt}Z`)) : window.CryptoBuchI18n.t("Noch keiner"), data.connection.bsdexWeb ? window.CryptoBuchI18n.t("BSDEX-Web-Export · Bestand aus Buchungen") : data.connection.importMode === "csv" ? window.CryptoBuchI18n.t("Lokaler CSV-/Beleg-Import") : window.CryptoBuchI18n.t("Read-only-API · keine Handelsrechte")),
  ];
  if (hasAuthenticatedSnapshot(data.balance?.source)) {
    entries.splice(2, 0, metric(window.CryptoBuchI18n.t("Kontostand"), window.CryptoBuchI18n.t("Bestätigt"), data.balance.observedAt ? `${providerLabel(data.connection.provider)} · ${dateTime.format(new Date(`${data.balance.observedAt}Z`))}` : window.CryptoBuchI18n.t("{p0} Read-only", { p0: providerLabel(data.connection.provider) }), "success"));
  } else {
    entries.splice(2, 0, metric(window.CryptoBuchI18n.t("Kontostand"), window.CryptoBuchI18n.t("Journal"), window.CryptoBuchI18n.t("Kein aktueller API-Snapshot verfügbar"), "warning"));
  }
  const history = historyStatus(data.connection.history);
  if (history) entries.push(metric(window.CryptoBuchI18n.t("Börsenhistorie"), history.value, history.help, history.tone));
  if (data.connection.provider === "etoro") entries.push(metric(window.CryptoBuchI18n.t("Positionsnachweise"), (data.derivativePositions?.length || 0).toLocaleString(window.CryptoBuchI18n.locale), window.CryptoBuchI18n.t("CFDs, Derivate und ungeklärte Produktarten · separate Liste unten")));
  if (data.connection.live?.enabled) {
    const live = data.connection.live;
    const copy = live.status === "connected" ? window.CryptoBuchI18n.t("Verbunden · REST-Abgleich alle {p0} Min.", { p0: live.reconcileIntervalMinutes })
      : live.status === "reconnecting" ? window.CryptoBuchI18n.t("Verbindung wird wiederhergestellt")
        : live.status === "error" ? (live.lastError || window.CryptoBuchI18n.t("Verbindung prüfen")) : window.CryptoBuchI18n.t("Wird verbunden");
    entries.push(metric(window.CryptoBuchI18n.t("Live-Updates"), live.status === "connected" ? window.CryptoBuchI18n.t("Aktiv") : window.CryptoBuchI18n.t("Prüfen"), copy, live.status === "connected" ? "success" : "warning"));
  }
  metrics.replaceChildren(...entries);
}

function renderPositions() {
  const positions = state.data.derivativePositions || [];
  el("exchange-positions-panel").hidden = state.data.connection.provider !== "etoro";
  const openCount = positions.filter(row => row.status === "open").length;
  const closedCount = positions.filter(row => row.status === "closed").length;
  const uncertain = positions.filter(row => row.status === "unconfirmed" || row.kind === "unknown").length;
  el("exchange-positions-summary").textContent = window.CryptoBuchI18n.t("{p0} offen · {p1} Schließungsnachweise{p2}", { p0: openCount, p1: closedCount, p2: uncertain ? window.CryptoBuchI18n.t(" · {p0} prüfen", { p0: uncertain }) : "" });
  const term = el("position-search").value.trim().toLocaleLowerCase(window.CryptoBuchI18n.locale);
  const status = el("position-status-filter").value;
  const filtered = positions.filter(row => (!status || row.status === status) && (!term || [row.symbol,row.name,row.positionId].some(value => String(value || "").toLocaleLowerCase(window.CryptoBuchI18n.locale).includes(term))));
  const body = el("exchange-position-list");
  body.replaceChildren();
  const amount = (value, currency) => {
    if (!hasNumber(value)) return window.CryptoBuchI18n.t("k. A.");
    return currency ? new Intl.NumberFormat(window.CryptoBuchI18n.locale, { style: "currency", currency, currencyDisplay: "code" }).format(Number(value))
      : window.CryptoBuchI18n.t("{p0} · Währung unbestätigt", { p0: new Intl.NumberFormat(window.CryptoBuchI18n.locale, { maximumFractionDigits: 4 }).format(Number(value)) });
  };
  const cell = (title, detail) => {
    const td = document.createElement("td");
    const strong = document.createElement("strong"); strong.textContent = title; td.append(strong);
    if (detail) { const small = document.createElement("small"); small.textContent = detail; td.append(small); }
    return td;
  };
  for (const position of filtered) {
    const row = document.createElement("tr");
    const kind = position.kind === "cfd" ? window.CryptoBuchI18n.t("CFD") : position.kind === "derivative" ? window.CryptoBuchI18n.t("Derivat") : window.CryptoBuchI18n.t("Produktart prüfen");
    const statusLabel = position.status === "open" ? window.CryptoBuchI18n.t("Offen") : position.status === "closed" ? window.CryptoBuchI18n.t("Geschlossen / Teilschließung") : window.CryptoBuchI18n.t("Nicht mehr als offen gemeldet");
    const period = `${dateTime.format(new Date(position.openedAt))}${position.closedAt ? window.CryptoBuchI18n.t(" bis {p0}", { p0: dateTime.format(new Date(position.closedAt)) }) : ""}`;
    const profit = cell(amount(position.profit, position.profitCurrency), `${position.profitKind === "realized" ? window.CryptoBuchI18n.t("Realisiert · Netto laut API") : window.CryptoBuchI18n.t("Unrealisiert · letzter Abruf")} · ${dateTime.format(new Date(position.observedAt))}`);
    if (hasNumber(position.profit)) profit.className = Number(position.profit) < 0 ? "negative" : "positive";
    row.append(
      cell(`${position.symbol} · ${kind}`, window.CryptoBuchI18n.t("{p0} · Position {p1}", { p0: position.name || "eToro", p1: position.positionId })),
      cell(statusLabel, period),
      cell(position.side === "long" ? window.CryptoBuchI18n.t("Long") : position.side === "short" ? window.CryptoBuchI18n.t("Short") : window.CryptoBuchI18n.t("Richtung unbekannt"), hasNumber(position.leverage) ? window.CryptoBuchI18n.t("Hebel ×{p0}", { p0: position.leverage }) : window.CryptoBuchI18n.t("Hebel unbekannt")),
      cell(hasNumber(position.units) ? new Intl.NumberFormat(window.CryptoBuchI18n.locale, { maximumFractionDigits: 8 }).format(position.units) : window.CryptoBuchI18n.t("k. A.")),
      cell(amount(position.investment, position.investmentCurrency)),
      cell(amount(position.fees, position.feesCurrency), position.status === "open" ? window.CryptoBuchI18n.t("Übernachtgebühren / Dividenden") : window.CryptoBuchI18n.t("Laut Historie")),
      profit,
    );
    body.append(row);
  }
  el("exchange-positions-empty").hidden = filtered.length > 0;
}

function renderBalanceNotice() {
  const notice = el("exchange-balance-notice");
  const balance = state.data?.balance || {};
  const differences = balance.reconciliations || [];
  notice.replaceChildren();
  if (!hasAuthenticatedSnapshot(balance.source) && !differences.length) {
    el("exchange-holdings-copy").textContent = window.CryptoBuchI18n.t("Aus dem lokal gespeicherten Buchungsjournal berechnet.");
    notice.hidden = true;
    return;
  }
  el("exchange-holdings-copy").textContent = hasAuthenticatedSnapshot(balance.source)
    ? window.CryptoBuchI18n.t("Aus dem aktuellen, read-only abgefragten {p0}-Kontostand.", { p0: providerLabel(state.data.connection.provider) })
    : window.CryptoBuchI18n.t("Aus dem lokal gespeicherten Buchungsjournal berechnet.");
  const title = document.createElement("strong");
  const copy = document.createElement("p");
  if (!differences.length) {
    title.textContent = window.CryptoBuchI18n.t("Kontostand mit Journal abgeglichen");
    copy.textContent = window.CryptoBuchI18n.t("Der aktuelle {p0}-Kontostand stimmt mit den importierten Buchungen überein. Der Kontostand wird nur lesend abgefragt.", { p0: providerLabel(state.data.connection.provider) });
  } else {
    const assets = differences.map((item) => item.asset).join(", ");
    title.textContent = window.CryptoBuchI18n.t("Historisches Journal weicht vom bestätigten Kontostand ab");
    copy.textContent = window.CryptoBuchI18n.t("Betroffen: {p0}. Es werden ausschließlich die aktuellen {p1}-Bestände angezeigt. Die Differenz wird nicht als Kauf, Verkauf oder FIFO-Charge erzeugt; ergänze fehlende Buchungen oder einen vollständigen Börsenexport.", { p0: assets, p1: providerLabel(state.data.connection.provider) });
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
    for (const [label, value] of [[window.CryptoBuchI18n.t("Preis jetzt"), formatPrice(asset.currentPriceEur)], [window.CryptoBuchI18n.t("Marktwert"), formatCurrency(asset.currentValueEur)]]) {
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
  el("exchange-holdings-empty").querySelector("p").textContent = hasAuthenticatedSnapshot(state.data.balance?.source)
    ? window.CryptoBuchI18n.t("Der bestätigte Kontostand enthält derzeit keine positiven Assets.")
    : window.CryptoBuchI18n.t("Aus dem gespeicherten Coin-Journal lassen sich keine positiven Bestände ermitteln.");
}

function filteredTransactions() {
  const term = state.filters.search.trim().toLocaleLowerCase(window.CryptoBuchI18n.locale);
  return (state.data.transactions || []).filter((transaction) => {
    if (state.filters.direction && transaction.direction !== state.filters.direction) return false;
    if (!term) return true;
    return [transaction.asset, transaction.asset_symbol, transaction.asset_name, transaction.hash, transaction.purpose, transaction.counterparty]
      .some((value) => String(value || "").toLocaleLowerCase(window.CryptoBuchI18n.locale).includes(term));
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
    const timestamp = document.createElement("small"); timestamp.textContent = transaction.timestamp ? dateTime.format(new Date(transaction.timestamp)) : window.CryptoBuchI18n.t("Zeitpunkt unbekannt");
    copy.append(hash, timestamp); operationLayout.append(direction, copy); operation.append(operationLayout);
    const asset = document.createElement("td");
    const assetTitle = document.createElement("strong"); assetTitle.textContent = assetInfo(transaction.asset).name || transaction.asset;
    const assetSymbol = document.createElement("small"); assetSymbol.textContent = assetInfo(transaction.asset).symbol || transaction.asset;
    asset.append(assetTitle, assetSymbol);
    const amount = document.createElement("td");
    amount.className = `amount ${transaction.direction}`;
    amount.textContent = `${transaction.direction === "in" ? "+" : transaction.direction === "out" ? "−" : ""}${formatAmount(transaction.amount, transaction.asset)}`;
    if (Number(transaction.fee) > 0) { const fee = document.createElement("small"); fee.textContent = window.CryptoBuchI18n.t("Gebühr {p0}", { p0: formatAmount(transaction.fee, transaction.fee_asset || transaction.asset) }); amount.append(fee); }
    const now = document.createElement("td"); now.className = "price-cell"; now.textContent = formatPrice(transaction.price_now_eur);
    const historic = document.createElement("td"); historic.className = "price-cell"; historic.textContent = formatPrice(transaction.price_transaction_eur);
    const historicDetail = document.createElement("small"); historicDetail.textContent = transaction.price_provider === "coinbase_advanced-api" ? window.CryptoBuchI18n.t("Coinbase-Belegwert (EUR)") : ["bsdex-web", "bsdex-csv"].includes(transaction.price_provider) ? window.CryptoBuchI18n.t("BSDEX-Belegwert (EUR)") : transaction.price_source === "manual" ? window.CryptoBuchI18n.t("Manuell festgelegt") : hasNumber(transaction.price_transaction_eur) ? window.CryptoBuchI18n.t("Automatische Preisquelle") : window.CryptoBuchI18n.t("Nicht verfügbar"); historic.append(historicDetail);
    row.append(operation, asset, amount, now, historic, renderPurpose(transaction));
    body.append(row);
  }
  el("exchange-transactions-empty").hidden = transactions.length > 0;
  const history = state.data.connection.history;
  const emptyCopy = el("exchange-transactions-empty").querySelector("p");
  emptyCopy.textContent = !state.data.transactionCount && history && ["pending", "running"].includes(history.status)
    ? history.lastError || window.CryptoBuchI18n.t("Die Kontohistorie wird im Hintergrund nachgeladen. Buchungen erscheinen hier automatisch.")
    : history?.lastError || window.CryptoBuchI18n.t("Synchronisiere die Börse oder passe die Filter an.");
}

function render() {
  const data = state.data;
  document.title = window.CryptoBuchI18n.t("CryptoBuch · {p0}", { p0: data.connection.label || providerLabel(data.connection.provider) });
  el("exchange-title").textContent = data.connection.label || providerLabel(data.connection.provider);
  el("exchange-icon").textContent = data.connection.provider === "binance" ? "B" : ["coinbase", "coinbase_advanced"].includes(data.connection.provider) ? window.CryptoBuchI18n.t("CB") : data.connection.provider === "bitvavo" ? "V" : data.connection.provider === "etoro" ? "eT" : data.connection.provider === "bsdex" ? window.CryptoBuchI18n.t("BS") : window.CryptoBuchI18n.t("TR");
  el("exchange-icon").className = `asset-hero-icon exchange ${data.connection.provider}`;
  const csv = data.connection.importMode === "csv";
  const tradeRepublic = data.connection.tradeRepublic;
  const live = data.connection.live;
  el("exchange-subtitle").textContent = window.CryptoBuchI18n.t("{p0} · {p1} und alle {p2} lokal gespeicherten Börsenbuchungen.{p3}", { p0: providerLabel(data.connection.provider), p1: data.connection.bsdexWeb ? window.CryptoBuchI18n.t("Web-Import · Bestand aus exportierter Historie") : csv ? window.CryptoBuchI18n.t("lokaler Beleg-/CSV-Import") : window.CryptoBuchI18n.t("Read-only-Bestände"), p2: data.transactionCount.toLocaleString(window.CryptoBuchI18n.locale), p3: data.connection.bsdexWeb && !data.connection.syncAvailable ? window.CryptoBuchI18n.t(" Erneute Web-Anmeldung unter Datenqualität → Börse verbinden erforderlich.") : "" });
  const history = historyStatus(data.connection.history);
  el("exchange-status").textContent = tradeRepublic?.status === "approval_pending"
    ? window.CryptoBuchI18n.t("Trade-Republic-App-Bestätigung erforderlich")
    : tradeRepublic?.status === "login_error"
      ? window.CryptoBuchI18n.t("Trade-Republic-Webanmeldung prüfen")
      : tradeRepublic?.status === "login_required"
        ? window.CryptoBuchI18n.t("Trade-Republic-Webanmeldung erforderlich")
    : history && data.connection.history.status !== "complete"
    ? window.CryptoBuchI18n.t("Historienimport: {p0}", { p0: history.help })
    : live?.enabled && live.status === "connected"
      ? window.CryptoBuchI18n.t("BSDEX-Live-Updates aktiv · REST-Abgleich alle {p0} Min.", { p0: live.reconcileIntervalMinutes })
      : live?.enabled && live.status === "reconnecting"
        ? window.CryptoBuchI18n.t("BSDEX-Live-Verbindung wird wiederhergestellt")
    : data.connection.lastSyncedAt ? window.CryptoBuchI18n.t("Letzter Import {p0}", { p0: dateTime.format(new Date(`${data.connection.lastSyncedAt}Z`)) }) : csv ? window.CryptoBuchI18n.t("Noch kein CSV-Import") : window.CryptoBuchI18n.t("Noch nicht synchronisiert");
  const refresh = el("refresh-exchange");
  refresh.hidden = csv || data.connection.syncAvailable === false;
  renderMetrics();
  renderBalanceNotice();
  renderHoldings();
  renderPositions();
  renderTransactions();
  clearTimeout(historyRefreshTimer);
  if ((data.connection.history && ["pending", "running"].includes(data.connection.history.status) && !data.connection.history.lastError) || data.connection.live?.enabled) {
    historyRefreshTimer = setTimeout(() => load({ quiet: true }), data.connection.live?.enabled ? 10000 : 6000);
  }
}

async function load({ quiet = false } = {}) {
  try {
    if (!Number.isSafeInteger(exchangeId) || exchangeId <= 0) throw new Error(window.CryptoBuchI18n.t("Ungültige Börsenverbindung."));
    if (!quiet) el("exchange-status").textContent = window.CryptoBuchI18n.t("Börse wird geladen …");
    state.data = await api(`/api/exchange-connections/${exchangeId}/portfolio`);
    render();
  } catch (error) {
    toast(error.message, "error");
    el("exchange-status").textContent = window.CryptoBuchI18n.t("Daten momentan nicht verfügbar");
  }
}

async function waitForJob(id) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const job = await api(`/api/jobs/${id}`);
    if (job.status === "success") return job.result || {};
    if (job.status === "error") throw new Error(job.error_message || window.CryptoBuchI18n.t("Synchronisierung fehlgeschlagen."));
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(window.CryptoBuchI18n.t("Synchronisierung benötigt länger als erwartet."));
}

async function syncExchange() {
  if (state.data?.connection?.syncAvailable === false) {
    toast(window.CryptoBuchI18n.t("Diese Quelle wird über den lokalen CSV-Import aktualisiert."), "error");
    return;
  }
  const button = el("refresh-exchange");
  button.disabled = true;
  button.textContent = window.CryptoBuchI18n.t("Synchronisiert …");
  try {
    const queued = await api(`/api/exchange-connections/${exchangeId}/sync`, { method: "POST" });
    const result = await waitForJob(queued.job.id);
    await load({ quiet: true });
    toast(window.CryptoBuchI18n.t("{p0} Coin-Buchungen{p1} synchronisiert{p2}{p3}", { p0: (result.imported || 0).toLocaleString(window.CryptoBuchI18n.locale), p1: result.positionsImported ? window.CryptoBuchI18n.t(" und {p0} Positionsnachweise", { p0: result.positionsImported.toLocaleString(window.CryptoBuchI18n.locale) }) : "", p2: result.limited ? window.CryptoBuchI18n.t(" (Importlimit aktiv)") : "", p3: result.historyInProgress ? window.CryptoBuchI18n.t(" Die Börsenhistorie läuft automatisch weiter.") : "." }));
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = window.CryptoBuchI18n.t("Börse aktualisieren");
  }
}

el("refresh-exchange").addEventListener("click", syncExchange);
el("reload-exchange").addEventListener("click", () => load());
el("transaction-search").addEventListener("input", (event) => { state.filters.search = event.target.value; renderTransactions(); });
el("direction-filter").addEventListener("change", (event) => { state.filters.direction = event.target.value; renderTransactions(); });
el("position-search").addEventListener("input", renderPositions);
el("position-status-filter").addEventListener("change", renderPositions);
load();
