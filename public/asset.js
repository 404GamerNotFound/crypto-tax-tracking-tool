const params = new URLSearchParams(window.location.search);
const requestedChain = String(params.get("chain") || "BTC").toUpperCase();
const requestedAsset = String(params.get("asset") || "");
const state = { portfolio: null, selected: new Set(), editingHistoricPriceTransaction: null, priceFetchJobs: new Map(), documentTransaction: null, chart: null, filters: { search: "", direction: "" } };
const { api, el, formatCurrency, priceProviderLabel, purposeInfo, toast } = window.CryptoBuchUI;
const price = new Intl.NumberFormat(window.CryptoBuchI18n.locale, { style: "currency", currency: "EUR", maximumFractionDigits: 4 });
const dateTime = new Intl.DateTimeFormat(window.CryptoBuchI18n.locale, { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat(window.CryptoBuchI18n.locale, { dateStyle: "medium" });

function hasPrice(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function formatPrice(value) {
  return hasPrice(value) ? price.format(Number(value)) : window.CryptoBuchI18n.t("k. A.");
}

function formatRecordedAt(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? dateTime.format(new Date(timestamp)) : window.CryptoBuchI18n.t("nicht dokumentiert");
}

function historicPriceProvenance(transaction) {
  const hasHistoricPrice = hasPrice(transaction.price_transaction_eur);
  const provider = String(transaction.price_provider || "");
  const isImportedPrice = transaction.price_source === "manual" && provider && provider !== "manual" && provider !== "legacy";
  const priceDate = transaction.timestamp && Number.isFinite(Date.parse(transaction.timestamp))
    ? dateOnly.format(new Date(transaction.timestamp)) : window.CryptoBuchI18n.t("nicht dokumentiert");
  const recordedAt = formatRecordedAt(transaction.price_recorded_at);
  if (!hasHistoricPrice) {
    return {
      tone: "missing",
      quality: window.CryptoBuchI18n.t("offen · kein historischer Kurs"),
      provider: window.CryptoBuchI18n.t("noch nicht ermittelt"),
      priceDate,
      recordedAt: null,
      recordedLabel: "",
    };
  }
  if (isImportedPrice) {
    return {
      tone: "imported",
      quality: window.CryptoBuchI18n.t("Direktimport · geschützt"),
      provider: priceProviderLabel(provider),
      priceDate,
      recordedAt,
      recordedLabel: window.CryptoBuchI18n.t("Importiert"),
    };
  }
  if (transaction.price_source === "manual") {
    return {
      tone: "manual",
      quality: window.CryptoBuchI18n.t("manuell festgelegt"),
      provider: priceProviderLabel(provider || "manual"),
      priceDate,
      recordedAt,
      recordedLabel: window.CryptoBuchI18n.t("Erfasst"),
    };
  }
  if (!provider || provider === "legacy") {
    return {
      tone: "limited",
      quality: window.CryptoBuchI18n.t("eingeschränkt · alte Herkunft fehlt"),
      provider: priceProviderLabel("legacy"),
      priceDate,
      recordedAt,
      recordedLabel: window.CryptoBuchI18n.t("Zuletzt gespeichert"),
    };
  }
  return {
    tone: "automatic",
    quality: ({ daily_reference: window.CryptoBuchI18n.t("UTC-Tagesreferenz · Schätzung"), daily_close: window.CryptoBuchI18n.t("UTC-Tagesschluss · Schätzung"), block_quote: window.CryptoBuchI18n.t("Blockzeitpunkt · Schätzung") })[transaction.price_method] || window.CryptoBuchI18n.t("automatisch · Bewertungsmethode nicht dokumentiert"),
    provider: priceProviderLabel(provider),
    priceDate,
    recordedAt,
    recordedLabel: window.CryptoBuchI18n.t("Abgerufen"),
  };
}

function chainInfo() {
  return state.portfolio?.chains?.[requestedChain]
    || (requestedChain === "EXCHANGE" ? { name: window.CryptoBuchI18n.t("Börse"), asset: "", decimals: 8, icon: "⇄", explorer: {} } : null)
    || { name: requestedChain, asset: requestedChain, decimals: 6, icon: requestedChain.slice(0, 1) };
}

function activeAssetId() {
  return requestedAsset || chainInfo().asset;
}

function assetInfo(assetId = activeAssetId()) {
  return state.portfolio?.assets?.[assetId] || { id: assetId, name: chainInfo().name, symbol: chainInfo().asset, decimals: chainInfo().decimals, chain: requestedChain, kind: "native" };
}

function formatAmount(value, assetId = activeAssetId()) {
  const asset = assetInfo(assetId);
  const amount = Number(value || 0);
  const decimals = asset.decimals ?? 6;
  const options = amount !== 0 && Math.abs(amount) < 10 ** -decimals
    ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: decimals };
  return `${new Intl.NumberFormat(window.CryptoBuchI18n.locale, options).format(amount)} ${asset.symbol}`;
}

function shorten(value, start = 10, end = 7) {
  return value && value.length > start + end + 2 ? `${value.slice(0, start)}…${value.slice(-end)}` : value || "—";
}

function directionLabel(direction) {
  return { in: window.CryptoBuchI18n.t("Zugang"), out: window.CryptoBuchI18n.t("Abgang"), self: window.CryptoBuchI18n.t("Eigener Transfer") }[direction] || window.CryptoBuchI18n.t("Unbekannt");
}

function explorerUrl(type, value) {
  return chainInfo().explorer?.[type]?.replace("{value}", encodeURIComponent(value)) || "#";
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

function appendSourceBalances(card) {
  const sources = state.portfolio.sourceBalances?.[activeAssetId()] || [];
  const section = document.createElement("div");
  section.className = "asset-source-balances";
  const heading = document.createElement("span");
  heading.className = "card-label";
  heading.textContent = window.CryptoBuchI18n.t("Guthaben pro Quelle");
  section.append(heading);
  const list = document.createElement("ul");
  list.setAttribute("aria-label", "Guthaben pro Quelle");
  for (const source of sources) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.className = "asset-source-name";
    name.textContent = source.label;
    name.title = `${source.sourceType === "exchange" ? window.CryptoBuchI18n.t("Börsenkonto") : window.CryptoBuchI18n.t("Wallet")} #${source.walletId}`;
    const balance = document.createElement("span");
    balance.className = "asset-source-amount";
    const unknownBalance = source.sourceType === "exchange" && source.incompleteReason === "negative_journal";
    balance.textContent = unknownBalance ? window.CryptoBuchI18n.t("Unbekannt") : formatAmount(source.amount);
    const detail = document.createElement("small");
    detail.textContent = source.incompleteReason === "rewards_only" ? window.CryptoBuchI18n.t("Unvollständig: nur Rewards importiert. Wallet erneut synchronisieren.")
      : unknownBalance ? window.CryptoBuchI18n.t("Journaldefizit {p0} · kein bestätigter Börsensaldo. Fehlende Buchungen ergänzen.", { p0: formatAmount(source.journalAmount) })
      : source.incomplete ? window.CryptoBuchI18n.t("Journaldefizit · Buchungen fehlen möglicherweise")
      : source.historyIncomplete ? window.CryptoBuchI18n.t("Börsensaldo bestätigt · Journal weicht ab ({p0}). Kaufdaten prüfen.", { p0: formatAmount(source.journalAmount) })
      : source.basis === "exchange_snapshot" ? window.CryptoBuchI18n.t("Börsensaldo · inkl. gesperrter Beträge") : window.CryptoBuchI18n.t("Aus Buchungen berechnet");
    if (source.observedAt) detail.textContent += ` · ${source.basis === "exchange_snapshot" ? window.CryptoBuchI18n.t("Stand") : window.CryptoBuchI18n.t("Letzter Sync")} ${formatRecordedAt(source.observedAt)}`;
    item.append(name, balance, detail);
    list.append(item);
  }
  if (sources.length) section.append(list);
  else {
    const empty = document.createElement("small");
    empty.textContent = window.CryptoBuchI18n.t("Keine Bestände je Quelle vorhanden.");
    section.append(empty);
  }
  card.append(section);
}

function renderMetrics() {
  const report = state.portfolio.assetAnalytics?.[activeAssetId()];
  const purchases = report?.purchases || {};
  const partialProfit = Boolean(purchases.profitIsPartial);
  const hidden = (state.portfolio.hiddenAssets || []).includes(activeAssetId());
  const missingLotHint = purchases.unknownCostLotCount
    ? window.CryptoBuchI18n.t("Unvollständig · {p0} verbleibende Kaufcharge{p1} ohne Kurs", { p0: purchases.unknownCostLotCount, p1: purchases.unknownCostLotCount === 1 ? "" : "n" })
    : window.CryptoBuchI18n.t("Historischer Kaufkurs fehlt");
  const metrics = el("asset-metrics");
  metrics.replaceChildren();
  const holdingCard = metric(report?.holdingIsPartial ? window.CryptoBuchI18n.t("Erfasster Teilbestand") : window.CryptoBuchI18n.t("Aktueller Bestand"), formatAmount(report?.holdingAmount || 0), `${report?.holdingIsPartial ? window.CryptoBuchI18n.t("Teilwert") : window.CryptoBuchI18n.t("Marktwert")} ${formatCurrency(report?.holdingValueEur)}`, "highlight");
  const balanceHint = purchases.balanceUncertain ? window.CryptoBuchI18n.t("Bestand und Buchungshistorie unvollständig oder widersprüchlich. Quellen synchronisieren und Transfers prüfen.") : null;
  appendSourceBalances(holdingCard);
  metrics.append(
    holdingCard,
    metric(window.CryptoBuchI18n.t("Als Kauf erfasst"), formatAmount(purchases.acquiredAmount || 0), window.CryptoBuchI18n.t("{p0} Kauf-Transaktionen", { p0: purchases.count || 0 })),
    metric(window.CryptoBuchI18n.t("Noch aus Käufen gehalten"), purchases.balanceUncertain ? window.CryptoBuchI18n.t("Nicht bestimmbar") : formatAmount(purchases.remainingAmount || 0), balanceHint || (purchases.hasUnknownCost ? missingLotHint : window.CryptoBuchI18n.t("Kosten {p0}", { p0: formatCurrency(purchases.remainingCostEur) }))),
    metric(partialProfit ? window.CryptoBuchI18n.t("Gewinn ggü. Kauf · teilweise") : window.CryptoBuchI18n.t("Gewinn ggü. Kauf"), formatCurrency(purchases.profitEur), balanceHint || (hidden ? window.CryptoBuchI18n.t("Coin ausgeblendet · keine aktuelle Bewertung") : purchases.profitEur === null ? missingLotHint : partialProfit ? window.CryptoBuchI18n.t("Berechnet aus {p0} mit Kaufkurs", { p0: formatAmount(purchases.knownRemainingAmount || 0) }) : window.CryptoBuchI18n.t("Aktueller Wert minus FIFO-Kaufkosten")), Number(purchases.profitEur) >= 0 ? "positive" : "negative"),
    metric(window.CryptoBuchI18n.t("Staking-Ertrag · kumuliert"), formatAmount(report?.staking?.amount || 0), window.CryptoBuchI18n.t("{p0} Ertrags-Transaktionen · kein aktueller Bestand", { p0: report?.staking?.count || 0 }), "staking"),
  );
}

function renderChart() {
  const container = el("asset-chart");
  const copy = el("asset-chart-copy");
  const report = state.portfolio.assetAnalytics?.[activeAssetId()];
  const history = report?.valueHistory;
  const points = history?.points || [];
  const validPoints = points.filter(point => Number.isFinite(point.value));
  const limitations = [history?.missingBalanceCount ? window.CryptoBuchI18n.t("Lücken wegen fehlender Buchungen") : "", history?.missingPriceCount ? window.CryptoBuchI18n.t("fehlende Kurse") : "", history?.holdingMismatch ? window.CryptoBuchI18n.t("Journal und aktueller Bestand weichen ab") : ""].filter(Boolean);
  const chartCopy = window.CryptoBuchI18n.t("{p0} bewertete Zeitpunkte · historische Schätzung{p1}.", { p0: validPoints.length, p1: limitations.length ? " · " + limitations.join(" · ") : "" });
  container.setAttribute("aria-label", chartCopy);
  state.chart?.destroy();
  state.chart = null;
  container.replaceChildren();
  if (validPoints.length < 2) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = window.CryptoBuchI18n.t("Für einen verlässlichen Verlauf fehlen bewertbare Bestände. Bitte Quellen synchronisieren und Kurslücken prüfen.");
    container.append(empty);
    copy.textContent = chartCopy;
    return;
  }

  if (window.uPlot) {
    const values = points.map((point) => point.value);
    state.chart = new window.uPlot({
      width: Math.max(360, container.clientWidth), height: 250,
      cursor: { drag: { x: true, y: false } },
      legend: { show: false },
      scales: { x: { time: true }, y: { time: false, auto: true } },
      axes: [
        { stroke: "#768178", grid: { stroke: "#dce4dc", width: 1, dash: [3, 5] }, values: (_u, ticks) => ticks.map((tick) => new Intl.DateTimeFormat(window.CryptoBuchI18n.locale, { month: "short", year: "2-digit" }).format(new Date(tick * 1000))) },
        { scale: "y", size: 90, stroke: "#768178", grid: { stroke: "#dce4dc", width: 1, dash: [3, 5] }, values: (_u, ticks) => ticks.map((tick) => tick === null ? "" : formatCurrency(tick)) },
      ],
      series: [{}, { label: window.CryptoBuchI18n.t("Bestandswert"), scale: "y", spanGaps: false, stroke: "#0b704a", width: 2.5, fill: "rgba(11,112,74,.16)", points: { show: true, size: 3 } }],
    }, [points.map((point) => point.timestamp / 1000), values], container);
    copy.textContent = chartCopy;
    return;
  }

  const width = 820;
  const height = 270;
  const padding = { top: 22, right: 24, bottom: 38, left: 66 };
  const values = validPoints.map((point) => point.value);
  const times = points.map((point) => point.timestamp);
  const valueMin = Math.min(...values);
  const valueMax = Math.max(...values);
  const spread = Math.max(valueMax - valueMin, Math.max(valueMax * 0.12, 1));
  const minY = Math.max(0, valueMin - spread * 0.18);
  const maxY = valueMax + spread * 0.18;
  const minX = Math.min(...times);
  const maxX = Math.max(...times);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (point) => padding.left + ((point.timestamp - minX) / Math.max(maxX - minX, 1)) * plotWidth;
  const y = (point) => padding.top + (1 - (point.value - minY) / Math.max(maxY - minY, 1)) * plotHeight;
  const svgNode = (name, attributes = {}) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  };
  const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  const defs = svgNode("defs");
  const gradient = svgNode("linearGradient", { id: "chart-fill", x1: "0", y1: "0", x2: "0", y2: "1" });
  gradient.append(svgNode("stop", { offset: "0%", "stop-color": "#0b704a", "stop-opacity": ".26" }), svgNode("stop", { offset: "100%", "stop-color": "#0b704a", "stop-opacity": "0" }));
  defs.append(gradient);
  svg.append(defs);
  for (let index = 0; index < 4; index += 1) {
    const value = maxY - ((maxY - minY) * index) / 3;
    const yPosition = padding.top + (plotHeight * index) / 3;
    svg.append(svgNode("line", { x1: padding.left, x2: width - padding.right, y1: yPosition, y2: yPosition, class: "chart-grid-line" }));
    const label = svgNode("text", { x: padding.left - 10, y: yPosition + 4, class: "chart-axis-label", "text-anchor": "end" });
    label.textContent = formatCurrency(value);
    svg.append(label);
  }
  let connected = false;
  const line = points.map((point) => {
    if (!Number.isFinite(point.value)) { connected = false; return ""; }
    const command = `${connected ? "L" : "M"}${x(point).toFixed(2)},${y(point).toFixed(2)}`;
    connected = true;
    return command;
  }).join(" ");
  svg.append(svgNode("path", { d: line, class: "chart-line" }));
  for (const point of [validPoints[0], validPoints.at(-1)]) {
    const marker = svgNode("circle", { cx: x(point), cy: y(point), r: 4, class: "chart-point" });
    const title = svgNode("title");
    title.textContent = `${dateTime.format(new Date(point.timestamp))}: ${formatCurrency(point.value)}`;
    marker.append(title);
    svg.append(marker);
  }
  for (const [alignment, point] of [["start", points[0]], ["end", points.at(-1)]]) {
    const label = svgNode("text", { x: x(point), y: height - 12, class: "chart-axis-label", "text-anchor": alignment });
    label.textContent = new Intl.DateTimeFormat(window.CryptoBuchI18n.locale, { month: "short", year: "numeric" }).format(new Date(point.timestamp));
    svg.append(label);
  }
  container.append(svg);
  copy.textContent = chartCopy;
}

function getTransactions() {
  const search = state.filters.search.toLocaleLowerCase(window.CryptoBuchI18n.locale).trim();
  return (state.portfolio?.transactions || []).filter((transaction) => {
    if (transaction.asset !== activeAssetId()) return false;
    if (state.filters.direction && transaction.direction !== state.filters.direction) return false;
    if (!search) return true;
    return [transaction.hash, transaction.wallet_label, transaction.address, transaction.purpose, transaction.counterparty]
      .filter(Boolean).join(" ").toLocaleLowerCase(window.CryptoBuchI18n.locale).includes(search);
  });
}

function purposeOptions(select, selected = "") {
  select.replaceChildren(new Option(window.CryptoBuchI18n.t("Kein Zweck"), ""));
  for (const preset of state.portfolio?.purposePresets || []) select.add(new Option(window.CryptoBuchI18n.t(preset), preset));
  select.add(new Option(window.CryptoBuchI18n.t("Eigener Zweck …"), "__custom__"));
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
  select.ariaLabel = window.CryptoBuchI18n.t("Zweck für Transaktion {p0}", { p0: shorten(transaction.hash) });
  purposeOptions(select, transaction.purpose || "");
  select.addEventListener("change", () => {
    if (select.value !== "__custom__") return setTransactionPurpose(transaction.id, select.value);
    const value = prompt(window.CryptoBuchI18n.t("Eigenen Zweck für diese Transaktion eingeben:"), transaction.purpose || "");
    if (value === null) return (select.value = transaction.purpose || "");
    return setTransactionPurpose(transaction.id, value.trim());
  });
  const documents = document.createElement("button");
  documents.type = "button";
  documents.className = "text-button historic-price-edit";
  documents.textContent = window.CryptoBuchI18n.t("Nachweise");
  documents.addEventListener("click", () => openDocumentModal(transaction));
  cell.append(card, select);
  if (transaction.transferLink) {
    const counterpart = transaction.transferLink;
    const link = document.createElement("button");
    link.type = "button";
    link.className = "text-button historic-price-edit";
    link.textContent = window.CryptoBuchI18n.t("Verknüpft: {p0} · Gegenbuchung #{p1}", { p0: counterpart.walletLabel, p1: counterpart.transactionId });
    link.addEventListener("click", () => {
      state.filters = { search: "", direction: "" };
      el("transaction-search").value = "";
      el("direction-filter").value = "";
      renderTransactions();
      const target = document.getElementById(`transaction-${counterpart.transactionId}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    });
    cell.append(link);
  } else if (transaction.purpose === "Transfer") {
    const review = document.createElement("a");
    review.className = "text-button historic-price-edit";
    review.href = "/quality.html#transfers";
    review.textContent = window.CryptoBuchI18n.t("Noch nicht verknüpft · Transfer prüfen");
    cell.append(review);
  }
  cell.append(documents);
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
    row.id = `transaction-${transaction.id}`;
    row.tabIndex = -1;
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
    operation.className = "operation-cell";
    const operationLayout = document.createElement("div");
    operationLayout.className = "operation-layout";
    const direction = document.createElement("span");
    direction.className = `direction ${transaction.direction}`;
    direction.textContent = transaction.direction === "in" ? "↓" : transaction.direction === "out" ? "↑" : "↔";
    const operationCopy = document.createElement("div");
    operationCopy.className = "operation-text";
    const isCardanoReward = String(transaction.hash || "").startsWith("cardano-reward:");
    const hash = document.createElement(isCardanoReward ? "strong" : "a");
    if (!isCardanoReward) {
      hash.href = explorerUrl("transaction", transaction.hash);
      hash.target = "_blank";
      hash.rel = "noreferrer";
    }
    hash.textContent = isCardanoReward ? window.CryptoBuchI18n.t("Cardano Staking Reward") : shorten(transaction.hash);
    const when = document.createElement("small");
    when.textContent = transaction.timestamp ? dateTime.format(new Date(transaction.timestamp)) : isCardanoReward ? window.CryptoBuchI18n.t("Cardano-Epoche {p0}", { p0: String(transaction.hash).split(":")[1] }) : window.CryptoBuchI18n.t("Unbestätigt");
    operationCopy.append(hash, when);
    operationLayout.append(direction, operationCopy);
    operation.append(operationLayout);

    const wallet = document.createElement("td");
    const walletTitle = document.createElement("strong");
    walletTitle.textContent = transaction.wallet_label || `${chainInfo().name}-Wallet`;
    const address = document.createElement("small");
    address.textContent = transaction.source_type === "xpub"
      ? window.CryptoBuchI18n.t("Bitcoin-xPub")
      : transaction.source_type === "stake" ? window.CryptoBuchI18n.t("Cardano Stake-Adresse") : shorten(transaction.address, 7, 6);
    wallet.append(walletTitle, address);

    const amount = document.createElement("td");
    amount.className = `amount ${transaction.direction}`;
    amount.textContent = `${transaction.direction === "in" ? "+" : transaction.direction === "out" ? "−" : ""}${formatAmount(transaction.amount, transaction.asset)}`;
    const fee = document.createElement("small");
    fee.textContent = Number(transaction.fee) > 0 ? window.CryptoBuchI18n.t("Gebühr {p0}", { p0: formatAmount(transaction.fee, transaction.fee_asset || transaction.asset) }) : "";
    amount.append(fee);

    const now = document.createElement("td");
    now.className = "price-cell";
    now.textContent = formatPrice(transaction.price_now_eur);
    const nowValue = hasPrice(transaction.price_now_eur) ? Number(transaction.price_now_eur) * Number(transaction.amount) : null;
    const nowDetail = document.createElement("small");
    nowDetail.textContent = nowValue === null ? "" : window.CryptoBuchI18n.t("Wert: {p0}", { p0: formatCurrency(nowValue) });
    now.append(nowDetail);

    const historic = document.createElement("td");
    historic.className = "price-cell";
    historic.textContent = formatPrice(transaction.price_transaction_eur);
    const historicValue = hasPrice(transaction.price_transaction_eur) ? Number(transaction.price_transaction_eur) * Number(transaction.amount) : null;
    const historicDetail = document.createElement("small");
    historicDetail.textContent = historicValue === null ? window.CryptoBuchI18n.t("Nicht verfügbar") : window.CryptoBuchI18n.t("Wert: {p0}", { p0: formatCurrency(historicValue) });
    const provenance = historicPriceProvenance(transaction);
    const historicProvenance = document.createElement("div");
    historicProvenance.className = "price-provenance";
    const quality = document.createElement("small");
    quality.className = `price-provenance-status ${provenance.tone}`;
    quality.textContent = window.CryptoBuchI18n.t("Datenqualität: {p0}", { p0: provenance.quality });
    const historicSource = document.createElement("small");
    historicSource.textContent = window.CryptoBuchI18n.t("Quelle: {p0}", { p0: provenance.provider });
    const historicDate = document.createElement("small");
    historicDate.textContent = window.CryptoBuchI18n.t("Kursdatum: {p0}", { p0: provenance.priceDate });
    historicProvenance.append(quality, historicSource, historicDate);
    if (provenance.recordedAt) {
      const historicRecordedAt = document.createElement("small");
      historicRecordedAt.textContent = `${provenance.recordedLabel}: ${provenance.recordedAt}`;
      historicProvenance.append(historicRecordedAt);
    }
    const editHistoricPrice = document.createElement("button");
    editHistoricPrice.type = "button";
    editHistoricPrice.className = "text-button historic-price-edit";
    editHistoricPrice.textContent = window.CryptoBuchI18n.t("Transaktion öffnen");
    editHistoricPrice.addEventListener("click", () => openHistoricPriceModal(transaction));
    historic.append(historicDetail, historicProvenance, editHistoricPrice);
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
    toast(purpose ? window.CryptoBuchI18n.t("Zweck „{p0}“ gespeichert.", { p0: purpose }) : window.CryptoBuchI18n.t("Zweck entfernt."));
  } catch (error) {
    toast(error.message, "error");
  }
}

async function applyBulkPurpose() {
  const ids = [...state.selected];
  if (!ids.length) return;
  let purpose = el("bulk-purpose").value;
  if (purpose === "__custom__") {
    const value = prompt(window.CryptoBuchI18n.t("Eigenen Zweck für die ausgewählten Transaktionen eingeben:"), "");
    if (value === null) return;
    purpose = value.trim();
  }
  const button = el("apply-bulk-purpose");
  button.disabled = true;
  button.textContent = window.CryptoBuchI18n.t("Speichert …");
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
    toast(window.CryptoBuchI18n.t("{p0} Zwecke gespeichert.", { p0: result.updated.toLocaleString(window.CryptoBuchI18n.locale) }));
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = window.CryptoBuchI18n.t("Zweck übernehmen");
  }
}

function renderPage() {
  const chain = chainInfo();
  const asset = assetInfo();
  document.title = window.CryptoBuchI18n.t("CryptoBuch · {p0}", { p0: asset.name });
  el("asset-icon").textContent = asset.icon;
  el("asset-icon").className = `asset-hero-icon ${requestedChain.toLowerCase()}`;
  el("asset-title").textContent = asset.name;
  el("asset-subtitle").textContent = asset.kind === "erc20"
    ? window.CryptoBuchI18n.t("Ethereum ERC-20 · {p0} · Transaktionen und Auswertung dieses Tokens.", { p0: asset.symbol })
    : asset.kind === "exchange" ? window.CryptoBuchI18n.t("Börsenbestand · {p0} · Synchronisierung und Mapping erfolgen unter Datenqualität.", { p0: asset.symbol })
    : window.CryptoBuchI18n.t("Käufe, Erträge und alle {p0}-Bewegungen in deinem Portfolio.", { p0: asset.symbol });
  const hidden = (state.portfolio.hiddenAssets || []).includes(activeAssetId());
  el("toggle-asset-visibility").disabled = false;
  el("toggle-asset-visibility").textContent = hidden ? window.CryptoBuchI18n.t("Coin wieder einblenden") : window.CryptoBuchI18n.t("Coin ausblenden");
  el("asset-visibility-note").textContent = hidden
    ? window.CryptoBuchI18n.t("Dieser Coin ist ausgeblendet: Er zählt nicht zu Portfolio-Summen und Wertentwicklung. Buchungen und Steuerberichte bleiben vollständig; aktuelle Kurse werden hier nicht bewertet.")
    : window.CryptoBuchI18n.t("Ausblenden entfernt diesen Coin aus Portfolio-Summen und Wertentwicklung. Buchungen und Steuerberichte bleiben erhalten.");
  el("refresh-chain").hidden = asset.kind === "exchange";
  const report = state.portfolio.assetAnalytics?.[activeAssetId()];
  const prices = state.portfolio.currentPrices || {};
  el("price-status").textContent = hidden ? window.CryptoBuchI18n.t("Coin ausgeblendet · keine aktuelle Bewertung") : prices.warning ? window.CryptoBuchI18n.t("Preisabfrage momentan nicht verfügbar") : hasPrice(report?.currentPriceEur) ? `1 ${asset.symbol} · ${formatPrice(report.currentPriceEur)}` : window.CryptoBuchI18n.t("Aktueller Preis nicht verfügbar");
  renderMetrics();
  renderChart();
  renderTransactions();
}

async function loadPortfolio({ quiet = false } = {}) {
  try {
    if (!quiet) el("price-status").textContent = window.CryptoBuchI18n.t("Ansicht wird geladen …");
    state.portfolio = await api("/api/portfolio");
    if (state.editingHistoricPriceTransaction) {
      state.editingHistoricPriceTransaction = state.portfolio.transactions.find((entry) => entry.id === state.editingHistoricPriceTransaction.id) || state.editingHistoricPriceTransaction;
    }
    if (!state.portfolio.assets?.[activeAssetId()] || state.portfolio.assets[activeAssetId()].chain !== requestedChain) return window.location.replace("/");
    renderPage();
  } catch (error) {
    toast(error.message, "error");
    el("price-status").textContent = window.CryptoBuchI18n.t("Daten momentan nicht verfügbar");
  }
}

async function syncChain() {
  const wallets = (state.portfolio?.wallets || []).filter((wallet) => wallet.chain === requestedChain);
  if (!wallets.length) return window.location.assign("/wallets.html");
  const button = el("refresh-chain");
  button.disabled = true;
  button.textContent = window.CryptoBuchI18n.t("Synchronisiert …");
  try {
    const results = [];
    for (const wallet of wallets) results.push(await api(`/api/wallets/${wallet.id}/sync`, { method: "POST" }));
    await loadPortfolio({ quiet: true });
    toast(window.CryptoBuchI18n.t("{p0} {p1}-Transaktionen aktualisiert.", { p0: results.reduce((sum, result) => sum + result.imported, 0).toLocaleString(window.CryptoBuchI18n.locale), p1: assetInfo().symbol }));
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = window.CryptoBuchI18n.t("Coin aktualisieren");
  }
}

async function openHistoricPriceModal(transaction) {
  state.editingHistoricPriceTransaction = transaction;
  el("historic-price-error").hidden = true;
  el("historic-price-input").value = hasPrice(transaction.price_transaction_eur) ? String(transaction.price_transaction_eur) : "";
  el("historic-price-note").value = "";
  el("historic-price-history").hidden = true;
  el("historic-price-modal-title").textContent = window.CryptoBuchI18n.t("Transaktion #{p0}", { p0: transaction.id });
  el("historic-price-modal-copy").textContent = window.CryptoBuchI18n.t("{p0} · {p1} · {p2}. Ein manueller EUR-Kurs wird nicht automatisch überschrieben.", { p0: formatAmount(transaction.amount, transaction.asset), p1: transaction.direction === "in" ? window.CryptoBuchI18n.t("Eingang") : transaction.direction === "out" ? window.CryptoBuchI18n.t("Ausgang") : window.CryptoBuchI18n.t("Intern"), p2: transaction.timestamp ? dateTime.format(new Date(transaction.timestamp)) : window.CryptoBuchI18n.t("ohne Zeitstempel") });
  el("historic-price-fetch-status").textContent = "";
  updatePriceFetchControls();
  el("historic-price-modal").showModal();
  setTimeout(() => el("historic-price-input").focus(), 0);
  if (state.priceFetchJobs.has(transaction.id)) pollTransactionPrice(transaction);
  await loadHistoricPriceHistory(transaction);
}

async function loadHistoricPriceHistory(transaction) {
  const initialInput = el("historic-price-input").value;
  try {
    const history = await api(`/api/transactions/${transaction.id}/price-history`);
    if (state.editingHistoricPriceTransaction?.id !== transaction.id) return;
    Object.assign(transaction, history.transaction);
    if (el("historic-price-input").value === initialInput) {
      el("historic-price-input").value = hasPrice(transaction.price_transaction_eur) ? String(transaction.price_transaction_eur) : "";
    }
    const provenance = historicPriceProvenance({ ...transaction, ...history.transaction });
    const observation = history.transaction.price_observed_at ? window.CryptoBuchI18n.t(" Kurszeitpunkt: {p0}.", { p0: formatRecordedAt(history.transaction.price_observed_at) }) : window.CryptoBuchI18n.t(" Kurszeitpunkt nicht dokumentiert.");
    const latest = history.changes[0];
    const audit = latest
      ? window.CryptoBuchI18n.t(" Letzte Änderung: {p0} · {p1}{p2}", { p0: latest.source === "manual" ? "manuell" : "automatisch", p1: formatRecordedAt(latest.changed_at), p2: latest.note ? ` · ${latest.note}` : "" })
      : "";
    el("historic-price-history").textContent = window.CryptoBuchI18n.t("Kursherkunft: {p0} · Datenqualität: {p1}.{p2}{p3}", { p0: provenance.provider, p1: provenance.quality, p2: observation, p3: audit });
    el("historic-price-history").hidden = false;
    updatePriceFetchControls();
  } catch (_) {
    // The editor remains usable even if older audit data is unavailable.
  }
}

function updatePriceFetchControls() {
  const transaction = state.editingHistoricPriceTransaction;
  if (!transaction) return;
  const job = state.priceFetchJobs.get(transaction.id);
  const unavailable = transaction.price_source === "manual" ? window.CryptoBuchI18n.t("Dieser Kurs ist geschützt. Für einen neuen Abruf zuerst ausdrücklich Automatik verwenden wählen.")
    : !transaction.timestamp || !Number.isFinite(Date.parse(transaction.timestamp)) ? window.CryptoBuchI18n.t("Für den Kursabruf fehlt ein gültiges Buchungsdatum.")
      : transaction.asset_type === "nft" ? window.CryptoBuchI18n.t("Für NFTs ist kein automatischer historischer Kurs verfügbar.") : null;
  const button = el("fetch-historic-price");
  button.disabled = Boolean(unavailable || job?.polling || job?.submitting);
  button.textContent = job ? window.CryptoBuchI18n.t("Kursabruf läuft …") : window.CryptoBuchI18n.t("Jetzt Kursdaten abrufen");
  if (job && !job.polling && !job.submitting) button.textContent = window.CryptoBuchI18n.t("Status aktualisieren");
  for (const id of ["save-historic-price", "restore-historic-price", "historic-price-input", "historic-price-note"]) el(id).disabled = Boolean(job);
  if (unavailable) el("historic-price-fetch-status").textContent = unavailable;
}

async function fetchTransactionPrice() {
  const transaction = state.editingHistoricPriceTransaction;
  if (!transaction) return;
  if (state.priceFetchJobs.has(transaction.id)) return pollTransactionPrice(transaction);
  state.priceFetchJobs.set(transaction.id, { submitting: true });
  updatePriceFetchControls();
  el("historic-price-error").hidden = true;
  try {
    const result = await api(`/api/transactions/${transaction.id}/historical-price/fetch`, { method: "POST" });
    state.priceFetchJobs.set(transaction.id, { id: result.job.id, polling: false });
    await pollTransactionPrice(transaction);
  } catch (error) {
    state.priceFetchJobs.delete(transaction.id);
    if (state.editingHistoricPriceTransaction?.id === transaction.id) {
      el("historic-price-error").textContent = window.CryptoBuchI18n.message(error.message);
      el("historic-price-error").hidden = false;
    }
  } finally { updatePriceFetchControls(); }
}

async function pollTransactionPrice(transaction) {
  const entry = state.priceFetchJobs.get(transaction.id);
  if (!entry?.id || entry.polling) return;
  const visible = () => el("historic-price-modal").open && state.editingHistoricPriceTransaction?.id === transaction.id && !document.hidden;
  if (!visible()) return;
  entry.polling = true;
  updatePriceFetchControls();
  try {
    for (let attempt = 0; attempt < 90 && visible(); attempt += 1) {
      const job = await api(`/api/jobs/${entry.id}`);
      if (!visible()) return;
      el("historic-price-fetch-status").textContent = window.CryptoBuchI18n.t("Kursabruf #{p0}: {p1}.", { p0: entry.id, p1: job.status === "queued" ? window.CryptoBuchI18n.t("wartet auf einen freien Platz") : window.CryptoBuchI18n.t("wird ausgeführt") });
      if (job.status === "error") {
        state.priceFetchJobs.delete(transaction.id);
        throw new Error(job.error_message || window.CryptoBuchI18n.t("Kursabruf fehlgeschlagen."));
      }
      if (job.status === "success") {
        const fresh = await api(`/api/v1/transactions/${transaction.id}`);
        if (!visible()) return;
        Object.assign(transaction, fresh.data);
        el("historic-price-input").value = hasPrice(transaction.price_transaction_eur) ? String(transaction.price_transaction_eur) : "";
        el("historic-price-fetch-status").textContent = job.result?.hint || window.CryptoBuchI18n.t("Kursabruf abgeschlossen.");
        state.priceFetchJobs.delete(transaction.id);
        await loadHistoricPriceHistory(transaction);
        await loadPortfolio({ quiet: true });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (visible()) el("historic-price-fetch-status").textContent = window.CryptoBuchI18n.t("Der Auftrag läuft auf dem Server weiter. Du kannst den Status erneut aktualisieren.");
  } catch (error) {
    if (visible()) {
      el("historic-price-error").textContent = window.CryptoBuchI18n.message(error.message);
      el("historic-price-error").hidden = false;
    }
  } finally {
    entry.polling = false;
    updatePriceFetchControls();
  }
}

function closeHistoricPriceModal() {
  el("historic-price-modal").close();
  state.editingHistoricPriceTransaction = null;
}

async function saveHistoricPrice(useAutomatic = false) {
  const transaction = state.editingHistoricPriceTransaction;
  if (!transaction) return;
  const error = el("historic-price-error");
  error.hidden = true;
  try {
    const result = await api(`/api/transactions/${transaction.id}/historical-price`, {
      method: "PATCH",
      body: JSON.stringify({ priceTransactionEur: useAutomatic ? null : el("historic-price-input").value, note: el("historic-price-note").value }),
    });
    transaction.price_transaction_eur = result.price_transaction_eur;
    transaction.price_source = result.price_source;
    transaction.price_provider = result.price_provider;
    transaction.price_recorded_at = result.price_recorded_at;
    if (useAutomatic && result.priceJob) {
      state.priceFetchJobs.set(transaction.id, { id: result.priceJob.id, polling: false });
      await pollTransactionPrice(transaction);
      return;
    }
    closeHistoricPriceModal();
    await loadPortfolio({ quiet: true });
    toast(result.price_source === "manual" ? window.CryptoBuchI18n.t("Historischer Kurs manuell gespeichert.") : result.priceHint || window.CryptoBuchI18n.t("Automatische Preisergänzung wieder aktiviert."));
  } catch (requestError) {
    error.textContent = window.CryptoBuchI18n.message(requestError.message);
    error.hidden = false;
  }
}

function formatDocumentSize(value) {
  return value < 1024 * 1024 ? window.CryptoBuchI18n.t("{p0} KB", { p0: Math.ceil(value / 1024) }) : window.CryptoBuchI18n.t("{p0} MB", { p0: (value / (1024 * 1024)).toFixed(1) });
}

function renderDocuments(documents) {
  const list = el("transaction-document-list");
  if (!documents.length) {
    list.replaceChildren(Object.assign(document.createElement("li"), { className: "muted", textContent: window.CryptoBuchI18n.t("Noch kein lokaler Nachweis angehängt.") }));
    return;
  }
  list.replaceChildren(...documents.map((entry) => {
    const item = document.createElement("li");
    const download = document.createElement("a");
    download.href = `/api/transaction-documents/${encodeURIComponent(entry.id)}/download`;
    download.textContent = entry.originalName;
    download.target = "_blank";
    download.rel = "noopener";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = window.CryptoBuchI18n.t("Entfernen");
    remove.addEventListener("click", async () => {
      if (!confirm(window.CryptoBuchI18n.t("Nachweis „{p0}“ wirklich lokal löschen?", { p0: entry.originalName }))) return;
      try {
        await api(`/api/transaction-documents/${entry.id}`, { method: "DELETE" });
        await loadDocuments();
      } catch (error) { toast(error.message, "error"); }
    });
    item.append(download, window.CryptoBuchI18n.t(" · {p0} · SHA-256 {p1}… · ", { p0: formatDocumentSize(entry.byteSize), p1: entry.sha256.slice(0, 12) }), remove);
    return item;
  }));
}

async function loadDocuments() {
  if (!state.documentTransaction) return;
  const payload = await api(`/api/transactions/${state.documentTransaction.id}/documents`);
  renderDocuments(payload.documents || []);
}

async function openDocumentModal(transaction) {
  state.documentTransaction = transaction;
  el("transaction-document-form").reset();
  el("transaction-document-error").hidden = true;
  el("transaction-document-modal-copy").textContent = `${assetInfo(transaction.asset).symbol} · ${transaction.timestamp ? dateTime.format(new Date(transaction.timestamp)) : window.CryptoBuchI18n.t("ohne Zeitstempel")}`;
  el("transaction-document-modal").showModal();
  try { await loadDocuments(); } catch (error) { toast(error.message, "error"); }
}

async function uploadDocument(event) {
  event.preventDefault();
  const file = el("transaction-document-file").files[0];
  const error = el("transaction-document-error");
  error.hidden = true;
  try {
    if (!state.documentTransaction || !file) throw new Error(window.CryptoBuchI18n.t("Bitte zuerst einen Nachweis auswählen."));
    if (file.size > 5 * 1024 * 1024) throw new Error(window.CryptoBuchI18n.t("Ein Nachweis darf maximal 5 MB groß sein."));
    const response = await fetch(`/api/transactions/${state.documentTransaction.id}/documents`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream", "X-Document-Name": encodeURIComponent(file.name) },
      body: file,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || window.CryptoBuchI18n.t("Nachweis konnte nicht gespeichert werden."));
    event.currentTarget.reset();
    await loadDocuments();
    toast(window.CryptoBuchI18n.t("Nachweis lokal gespeichert."));
  } catch (requestError) {
    error.textContent = window.CryptoBuchI18n.message(requestError.message);
    error.hidden = false;
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
el("close-historic-price-modal").addEventListener("click", closeHistoricPriceModal);
el("historic-price-form").addEventListener("submit", (event) => { event.preventDefault(); saveHistoricPrice(); });
el("restore-historic-price").addEventListener("click", () => saveHistoricPrice(true));
el("fetch-historic-price").addEventListener("click", fetchTransactionPrice);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.editingHistoricPriceTransaction) pollTransactionPrice(state.editingHistoricPriceTransaction);
});
el("close-transaction-document-modal").addEventListener("click", () => el("transaction-document-modal").close());
el("transaction-document-form").addEventListener("submit", uploadDocument);
loadPortfolio();

el("toggle-asset-visibility").addEventListener("click", async () => {
  const button = el("toggle-asset-visibility");
  button.disabled = true;
  try {
    const hidden = !(state.portfolio.hiddenAssets || []).includes(activeAssetId());
    await api("/api/asset-visibility", { method: "PATCH", body: JSON.stringify({ asset: activeAssetId(), hidden }) });
    await loadPortfolio({ quiet: true });
    toast(hidden ? window.CryptoBuchI18n.t("Coin ausgeblendet. Buchungen bleiben erhalten.") : window.CryptoBuchI18n.t("Coin wieder eingeblendet."));
  } catch (error) { toast(error.message, "error"); }
  finally { button.disabled = false; }
});
