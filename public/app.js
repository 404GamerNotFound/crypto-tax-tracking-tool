const state = { portfolio: null, market: null, historyRange: "max" };
const { api, el, formatCurrency, hasNumber, toast } = window.CryptoBuchUI;
const dateTime = new Intl.DateTimeFormat(window.CryptoBuchI18n.locale, { dateStyle: "medium", timeStyle: "short" });
const chartDate = new Intl.DateTimeFormat(window.CryptoBuchI18n.locale, { day: "2-digit", month: "short", year: "numeric" });
const chartValue = new Intl.NumberFormat(window.CryptoBuchI18n.locale, { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 });
const HISTORY_RANGES = Object.freeze({
  day: { label: window.CryptoBuchI18n.t("1 Tag"), days: 1 },
  month: { label: window.CryptoBuchI18n.t("1 Monat"), days: 31 },
  year: { label: window.CryptoBuchI18n.t("1 Jahr"), days: 365 },
  fiveYears: { label: window.CryptoBuchI18n.t("5 Jahre"), days: 365 * 5 },
  max: { label: window.CryptoBuchI18n.t("Max"), days: null },
});

function assetInfo(assetId) {
  return state.portfolio?.assets?.[assetId] || state.portfolio?.chains?.[assetId] || { symbol: assetId, decimals: 6, chain: assetId };
}

function formatAmount(value, assetId) {
  const asset = assetInfo(assetId);
  return `${new Intl.NumberFormat(window.CryptoBuchI18n.locale, { maximumFractionDigits: asset.decimals || 6 }).format(Number(value || 0))} ${asset.symbol || asset.asset || assetId}`;
}

function formatMarketPrice(value) {
  if (!hasNumber(value)) return window.CryptoBuchI18n.t("k. A.");
  const price = Number(value);
  const digits = price >= 100 ? 2 : price >= 1 ? 3 : price >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat(window.CryptoBuchI18n.locale, { style: "currency", currency: "EUR", maximumFractionDigits: digits }).format(price);
}

function formatMarketCap(value) {
  return hasNumber(value)
    ? new Intl.NumberFormat(window.CryptoBuchI18n.locale, { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 }).format(Number(value))
    : window.CryptoBuchI18n.t("k. A.");
}

function renderAssetCard(assetId, asset) {
  const report = state.portfolio.assetAnalytics?.[assetId];
  const card = document.createElement("a");
  card.className = "asset-dashboard-card";
  card.href = `/asset.html?chain=${encodeURIComponent(asset.chain)}&asset=${encodeURIComponent(assetId)}`;
  const head = document.createElement("div");
  head.className = "asset-card-head";
  const coin = document.createElement("span");
  coin.className = `chain-icon ${asset.chain.toLowerCase()}`;
  coin.textContent = asset.icon;
  const title = document.createElement("div");
  const label = document.createElement("span");
  label.className = "card-label";
  label.textContent = asset.kind === "erc20" ? window.CryptoBuchI18n.t("{p0} · ERC-20", { p0: asset.name }) : asset.name;
  const amount = document.createElement("strong");
  amount.textContent = formatAmount(report?.holdingAmount || 0, assetId);
  title.append(label, amount);
  const arrow = document.createElement("span");
  arrow.className = "asset-card-arrow";
  arrow.textContent = "→";
  head.append(coin, title, arrow);

  const metrics = document.createElement("dl");
  metrics.className = "asset-card-metrics";
  const purchaseProfit = report?.purchases?.profitEur;
  const purchaseProfitLabel = report?.purchases?.profitIsPartial ? window.CryptoBuchI18n.t("Gewinn ggü. Kauf · teilweise") : window.CryptoBuchI18n.t("Gewinn ggü. Kauf");
  const rows = [
    [window.CryptoBuchI18n.t("Gekauft"), formatAmount(report?.purchases?.acquiredAmount || 0, assetId)],
    [purchaseProfitLabel, purchaseProfit === null || purchaseProfit === undefined ? window.CryptoBuchI18n.t("k. A.") : formatCurrency(purchaseProfit), purchaseProfit >= 0 ? "positive" : "negative"],
    [window.CryptoBuchI18n.t("Staking-Ertrag"), formatCurrency(report?.staking?.currentValueEur)],
  ];
  for (const [labelText, value, tone] of rows) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = labelText;
    const definition = document.createElement("dd");
    definition.textContent = value;
    if (tone) definition.className = tone;
    row.append(term, definition);
    metrics.append(row);
  }
  const footer = document.createElement("span");
  footer.className = "asset-card-footer";
  footer.textContent = window.CryptoBuchI18n.t("Marktwert {p0}", { p0: formatCurrency(report?.holdingValueEur) });
  card.append(head, metrics, footer);
  return card;
}

function render() {
  const portfolio = state.portfolio;
  el("total-value").textContent = formatCurrency(portfolio.totalValueEur);
  el("wallet-count").textContent = (portfolio.wallets || []).length.toLocaleString(window.CryptoBuchI18n.locale);
  el("transaction-count").textContent = (portfolio.transactions || []).length.toLocaleString(window.CryptoBuchI18n.locale);
  const hidden = new Set(portfolio.hiddenAssets || []);
  const reports = Object.entries(portfolio.assetAnalytics || {}).filter(([id]) => !hidden.has(id)).map(([, report]) => report);
  const knownProfits = reports.map((report) => report?.purchases?.profitEur).filter((value) => hasNumber(value));
  const partialProfits = reports.filter((report) => (report?.purchases?.profitIsPartial || report?.purchases?.balanceUncertain)).length;
  const earningsValue = reports.reduce((sum, report) => sum + Number(report?.staking?.currentValueEur || 0), 0);
  const dataIssues = (portfolio.transactions || []).filter((transaction) => !transaction.purpose || !hasNumber(transaction.price_transaction_eur)).length
    + (portfolio.balanceReconciliations || []).length;
  el("purchase-profit").textContent = knownProfits.length ? formatCurrency(knownProfits.reduce((sum, value) => sum + Number(value), 0)) : window.CryptoBuchI18n.t("k. A.");
  el("purchase-profit-help").textContent = partialProfits ? window.CryptoBuchI18n.t("{p0} Coin{p1} unvollständig oder nicht bewertbar", { p0: partialProfits, p1: partialProfits === 1 ? "" : "s" }) : window.CryptoBuchI18n.t("Vollständig bewertete FIFO-Chargen");
  el("earnings-value").textContent = formatCurrency(earningsValue);
  el("data-issues").textContent = dataIssues.toLocaleString(window.CryptoBuchI18n.locale);
  const performance = portfolio.insights?.performance || {};
  el("unrealized-profit").textContent = formatCurrency(performance.unrealizedProfitEur);
  el("purchase-return").textContent = hasNumber(performance.purchaseReturnPercent) ? window.CryptoBuchI18n.t("{p0}{p1} % auf bekannte Kaufchargen", { p0: performance.purchaseReturnPercent >= 0 ? "+" : "", p1: Number(performance.purchaseReturnPercent).toLocaleString(window.CryptoBuchI18n.locale, { maximumFractionDigits: 1 }) }) : window.CryptoBuchI18n.t("Kaufkurse teilweise nicht verfügbar");
  el("realized-year").textContent = formatCurrency(performance.realizedYearEur);
  el("net-investment").textContent = formatCurrency(performance.netInvestmentEur);
  const prices = portfolio.currentPrices || {};
  el("price-status").textContent = prices.warning
    ? window.CryptoBuchI18n.t("Preisabfrage momentan nicht verfügbar")
    : prices.updatedAt ? window.CryptoBuchI18n.t("Preisstand {p0}", { p0: dateTime.format(new Date(prices.updatedAt * 1000)) }) : window.CryptoBuchI18n.t("Aktuelle Preise nicht verfügbar");
  const dashboard = el("asset-dashboard");
  dashboard.replaceChildren();
  const walletChains = new Set((portfolio.wallets || []).map((wallet) => wallet.chain));
  for (const chain of Object.values(portfolio.chains || {})) {
    const asset = assetInfo(chain.asset);
    if (!hidden.has(chain.asset) && (walletChains.has(chain.asset) || Number(portfolio.holdings?.[chain.asset] || 0) > 0)) dashboard.append(renderAssetCard(chain.asset, asset));
  }
  for (const [assetId, asset] of Object.entries(portfolio.assets || {})) {
    if (!hidden.has(assetId) && ["erc20", "exchange"].includes(asset.kind) && Number(portfolio.holdings?.[assetId] || 0) > 0) dashboard.append(renderAssetCard(assetId, asset));
  }
  const hasDataSources = (portfolio.wallets || []).length > 0 || (portfolio.transactions || []).some((transaction) => transaction.source_type === "exchange");
  dashboard.hidden = !hasDataSources;
  el("dashboard-empty").hidden = hasDataSources;
  el("hidden-assets-note").hidden = hidden.size === 0;
  el("hidden-assets-note").textContent = window.CryptoBuchI18n.t("{p0} {p1} ausgeblendet und aus den Portfolio-Summen ausgeschlossen. Buchungen und Steuerberichte bleiben vollständig.", { p0: hidden.size, p1: hidden.size === 1 ? window.CryptoBuchI18n.t("Coin") : window.CryptoBuchI18n.t("Coins") });
  renderAssetVisibility();
  renderInsights(portfolio.insights || {});
}

function renderAssetVisibility() {
  const portfolio = state.portfolio;
  if (!portfolio) return;
  const hidden = new Set(portfolio.hiddenAssets || []);
  const used = new Set([...Object.keys(portfolio.holdings || {}).filter((id) => Number(portfolio.holdings[id]) !== 0),
    ...(portfolio.transactions || []).map((transaction) => transaction.asset),
    ...(portfolio.wallets || []).map((wallet) => wallet.chain), ...hidden]);
  const query = el("asset-visibility-search").value.trim().toLocaleLowerCase(window.CryptoBuchI18n.locale);
  const list = el("asset-visibility-list");
  list.replaceChildren();
  for (const id of [...used].sort((a, b) => Number(hidden.has(b)) - Number(hidden.has(a)) || a.localeCompare(b))) {
    const asset = assetInfo(id);
    if (!`${asset.name} ${asset.symbol} ${id}`.toLocaleLowerCase(window.CryptoBuchI18n.locale).includes(query)) continue;
    const row = document.createElement("div"); row.className = "asset-visibility-row";
    const label = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = `${asset.name || id} · ${asset.symbol || id}`;
    const identity = document.createElement("small"); identity.textContent = `${id}${hidden.has(id) ? window.CryptoBuchI18n.t(" · Ausgeblendet") : ""}`;
    label.append(name, identity);
    const button = document.createElement("button"); button.className = "button button-secondary";
    button.textContent = hidden.has(id) ? window.CryptoBuchI18n.t("Einblenden") : window.CryptoBuchI18n.t("Ausblenden");
    button.setAttribute("aria-label", `${asset.name || id} ${hidden.has(id) ? "einblenden" : "ausblenden"}`);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const result = await api("/api/asset-visibility", { method: "PATCH", body: JSON.stringify({ asset: id, hidden: !hidden.has(id) }) });
        state.portfolio.hiddenAssets = result.hiddenAssets;
        await loadPortfolio({ quiet: true });
        toast(hidden.has(id) ? window.CryptoBuchI18n.t("Coin wieder eingeblendet.") : window.CryptoBuchI18n.t("Coin aus dem Portfolio ausgeblendet. Buchungen bleiben erhalten."));
      } catch (error) { toast(error.message, "error"); }
      finally { button.disabled = false; }
    });
    row.append(label, button); list.append(row);
  }
  if (!list.children.length) list.textContent = window.CryptoBuchI18n.t("Keine passenden Coins vorhanden.");
}

function historyPoints(valueHistory) {
  const byDay = new Map();
  for (const raw of Array.isArray(valueHistory) ? valueHistory : []) {
    const day = String(raw?.day || "");
    const valueEur = Number(raw?.valueEur);
    const timestamp = Date.parse(`${day}T00:00:00.000Z`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(valueEur) && Number.isFinite(timestamp)) {
      byDay.set(day, { day, valueEur, timestamp });
    }
  }
  return [...byDay.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function selectedHistoryPoints(points) {
  const range = HISTORY_RANGES[state.historyRange] || HISTORY_RANGES.max;
  if (!range.days || points.length < 2) return points;
  const cutoff = points.at(-1).timestamp - range.days * 24 * 60 * 60 * 1000;
  const firstInRange = points.findIndex((point) => point.timestamp >= cutoff);
  if (firstInRange <= 0) return points;
  // Keep the last known book value just before the selected window so the
  // line starts at a meaningful balance instead of fabricating a zero value.
  return [points[firstInRange - 1], ...points.slice(firstInRange)];
}

function updateHistoryRangeButtons() {
  for (const button of document.querySelectorAll("[data-history-range]")) {
    const active = button.dataset.historyRange === state.historyRange;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function historyDate(day) {
  return chartDate.format(new Date(`${day}T00:00:00.000Z`));
}

function renderHistoryChart(valueHistory) {
  const chart = el("portfolio-history-chart");
  const summary = el("portfolio-history-summary");
  chart.replaceChildren();
  const points = selectedHistoryPoints(historyPoints(valueHistory));
  const range = HISTORY_RANGES[state.historyRange] || HISTORY_RANGES.max;
  updateHistoryRangeButtons();
  if (points.length < 2) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = range.days ? window.CryptoBuchI18n.t("Für {p0} liegen nicht mindestens zwei bewertete Tage vor.", { p0: range.label }) : window.CryptoBuchI18n.t("Für einen Verlauf werden mindestens zwei bewertete Tage benötigt.");
    summary.textContent = "";
    chart.append(empty);
    return;
  }
  const values = points.map((point) => point.valueEur);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const hasValueRange = max > min;
  const span = max - min || Math.max(Math.abs(max) * 0.1, 1);
  const width = 720;
  const height = 220;
  const inset = { top: 20, right: 18, bottom: 30, left: 62 };
  const plotWidth = width - inset.left - inset.right;
  const plotHeight = height - inset.top - inset.bottom;
  const firstTimestamp = points[0].timestamp;
  const lastTimestamp = points.at(-1).timestamp;
  const timeSpan = Math.max(lastTimestamp - firstTimestamp, 1);
  const x = (point) => inset.left + ((point.timestamp - firstTimestamp) / timeSpan) * plotWidth;
  const y = (value) => hasValueRange ? inset.top + (1 - ((value - min) / span)) * plotHeight : inset.top + plotHeight / 2;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", window.CryptoBuchI18n.t("{p0}: historische Buchwertentwicklung von {p1} bis {p2}", { p0: range.label, p1: historyDate(points[0].day), p2: historyDate(points.at(-1).day) }));
  const axisValues = hasValueRange ? [[max, chartValue.format(max)], [min, chartValue.format(min)]] : [[max, chartValue.format(max)]];
  for (const [value, label] of axisValues) {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("class", "chart-grid-line");
    line.setAttribute("x1", String(inset.left));
    line.setAttribute("x2", String(width - inset.right));
    line.setAttribute("y1", y(value).toFixed(2));
    line.setAttribute("y2", y(value).toFixed(2));
    const text = document.createElementNS(ns, "text");
    text.setAttribute("class", "chart-axis-label");
    text.setAttribute("x", "0");
    text.setAttribute("y", (y(value) + 3).toFixed(2));
    text.textContent = label;
    svg.append(line, text);
  }
  const polyline = document.createElementNS(ns, "polyline");
  // Keep paint attributes on the SVG itself so the line remains visible when
  // a local reverse proxy still serves an older stylesheet from its cache.
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "#0b704a");
  polyline.setAttribute("stroke-width", "4");
  polyline.setAttribute("stroke-linecap", "round");
  polyline.setAttribute("stroke-linejoin", "round");
  polyline.setAttribute("points", points.map((point) => `${x(point).toFixed(2)},${y(point.valueEur).toFixed(2)}`).join(" "));
  const marker = document.createElementNS(ns, "circle");
  marker.setAttribute("class", "history-chart-marker");
  marker.setAttribute("cx", x(points.at(-1)).toFixed(2));
  marker.setAttribute("cy", y(points.at(-1).valueEur).toFixed(2));
  marker.setAttribute("r", "4");
  const startLabel = document.createElementNS(ns, "text");
  startLabel.setAttribute("class", "chart-axis-label");
  startLabel.setAttribute("x", String(inset.left));
  startLabel.setAttribute("y", String(height - 6));
  startLabel.textContent = historyDate(points[0].day);
  const endLabel = document.createElementNS(ns, "text");
  endLabel.setAttribute("class", "chart-axis-label");
  endLabel.setAttribute("text-anchor", "end");
  endLabel.setAttribute("x", String(width - inset.right));
  endLabel.setAttribute("y", String(height - 6));
  endLabel.textContent = historyDate(points.at(-1).day);
  const title = document.createElementNS(ns, "title");
  title.textContent = window.CryptoBuchI18n.t("{p0}: {p1}. Letzter Wert {p2}: {p3}.", { p0: historyDate(points[0].day), p1: formatCurrency(points[0].valueEur), p2: historyDate(points.at(-1).day), p3: formatCurrency(points.at(-1).valueEur) });
  svg.append(title, polyline, marker, startLabel, endLabel);
  summary.textContent = window.CryptoBuchI18n.t("{p0} · {p1} bis {p2} · {p3} → {p4}", { p0: range.label, p1: historyDate(points[0].day), p2: historyDate(points.at(-1).day), p3: formatCurrency(points[0].valueEur), p4: formatCurrency(points.at(-1).valueEur) });
  chart.append(svg);
}

function renderInsights(insights) {
  const allocation = el("allocation-chart");
  allocation.replaceChildren();
  const entries = (insights.allocation || []).slice(0, 7);
  if (!entries.length) allocation.textContent = window.CryptoBuchI18n.t("Noch keine bewertbaren Bestände.");
  else {
    for (const entry of entries) {
      const row = document.createElement("div"); row.className = "allocation-row";
      const name = document.createElement("span"); name.textContent = assetInfo(entry.asset).symbol || entry.asset;
      const bar = document.createElement("span"); bar.className = "allocation-bar";
      const fill = document.createElement("i"); fill.style.width = `${Math.max(2, entry.share * 100)}%`; bar.append(fill);
      const value = document.createElement("strong"); value.textContent = `${(entry.share * 100).toLocaleString(window.CryptoBuchI18n.locale, { maximumFractionDigits: 1 })} %`;
      row.append(name, bar, value); allocation.append(row);
    }
  }
  renderHistoryChart(insights.valueHistory);
}

function renderMarketCatalog() {
  const market = state.market;
  const catalog = el("market-catalog");
  catalog.replaceChildren();
  const assets = market?.assets || [];
  const timestamp = market?.updatedAt ? new Date(market.updatedAt) : null;
  el("market-status").textContent = market?.warning
    ? window.CryptoBuchI18n.t("Preisabfrage momentan nicht verfügbar")
    : timestamp ? window.CryptoBuchI18n.t("Marktstand {p0}", { p0: dateTime.format(timestamp) }) : window.CryptoBuchI18n.t("Aktuelle Marktdaten nicht verfügbar");
  el("market-empty").hidden = assets.length > 0;

  for (const asset of assets) {
    const item = document.createElement("article");
    item.className = "market-item";
    const rank = document.createElement("span");
    rank.className = "market-rank";
    rank.textContent = `#${asset.rank}`;
    const icon = document.createElement("span");
    icon.className = `chain-icon market-icon ${asset.import.chain?.toLowerCase() || "market"}`;
    icon.textContent = asset.icon;
    const identity = document.createElement("div");
    identity.className = "market-identity";
    const name = document.createElement("strong");
    name.textContent = asset.name;
    const symbol = document.createElement("span");
    symbol.textContent = asset.symbol;
    identity.append(name, symbol);
    const price = document.createElement("div");
    price.className = "market-price";
    const value = document.createElement("strong");
    value.textContent = formatMarketPrice(asset.priceEur);
    const change = document.createElement("span");
    const dailyChange = Number(asset.change24h);
    change.textContent = Number.isFinite(dailyChange) ? window.CryptoBuchI18n.t("24 h {p0}{p1} %", { p0: dailyChange >= 0 ? "+" : "", p1: dailyChange.toLocaleString(window.CryptoBuchI18n.locale, { maximumFractionDigits: 2 }) }) : window.CryptoBuchI18n.t("24 h k. A.");
    change.className = Number.isFinite(dailyChange) ? (dailyChange >= 0 ? "positive" : "negative") : "";
    price.append(value, change);
    const meta = document.createElement("div");
    meta.className = "market-meta";
    const cap = document.createElement("span");
    cap.textContent = window.CryptoBuchI18n.t("Marktkapitalisierung {p0}", { p0: formatMarketCap(asset.marketCapEur) });
    const availability = asset.import.chain ? document.createElement("a") : document.createElement("span");
    availability.className = `market-availability ${asset.import.type}`;
    availability.textContent = window.CryptoBuchI18n.message(asset.import.label);
    if (asset.import.chain) {
      availability.href = `/wallets.html?chain=${encodeURIComponent(asset.import.chain)}`;
      availability.title = asset.import.detail;
    } else {
      availability.title = asset.import.detail;
    }
    meta.append(cap, availability);
    item.append(rank, icon, identity, price, meta);
    catalog.append(item);
  }
}

async function loadPortfolio({ quiet = false } = {}) {
  try {
    if (!quiet) el("price-status").textContent = window.CryptoBuchI18n.t("Ansicht wird geladen …");
    state.portfolio = await api("/api/portfolio");
    render();
  } catch (error) {
    toast(error.message, "error");
    el("price-status").textContent = window.CryptoBuchI18n.t("Daten momentan nicht verfügbar");
  }
}

async function loadMarketCatalog() {
  try {
    state.market = await api("/api/market/top-30");
  } catch (error) {
    state.market = { assets: [], warning: error.message };
  }
  renderMarketCatalog();
}

async function syncAll() {
  const wallets = state.portfolio?.wallets || [];
  if (!wallets.length) {
    window.location.assign("/wallets.html");
    return;
  }
  const button = el("refresh-all");
  button.disabled = true;
  button.textContent = window.CryptoBuchI18n.t("Synchronisiert …");
  try {
    const queued = await api("/api/jobs/sync", { method: "POST", body: JSON.stringify({ walletIds: wallets.map((wallet) => wallet.id) }) });
    const results = await Promise.all(queued.jobs.map((job) => waitForJob(job.id)));
    await loadPortfolio({ quiet: true });
    toast(window.CryptoBuchI18n.t("{p0} Transaktionen aktualisiert.", { p0: results.reduce((sum, result) => sum + result.imported, 0).toLocaleString(window.CryptoBuchI18n.locale) }));
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = window.CryptoBuchI18n.t("Alles aktualisieren");
  }
}

async function waitForJob(id) {
  for (let tries = 0; tries < 240; tries += 1) {
    const job = await api(`/api/jobs/${id}`);
    if (job.status === "success") return job.result || {};
    if (job.status === "error") throw new Error(job.error_message || window.CryptoBuchI18n.t("Hintergrundjob fehlgeschlagen."));
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(window.CryptoBuchI18n.t("Hintergrundjob benötigt länger als erwartet."));
}

async function backfillHistoricalPrices() {
  const button = el("backfill-historical-prices");
  button.disabled = true;
  button.textContent = window.CryptoBuchI18n.t("Kurse werden ergänzt …");
  try {
    const { job } = await api("/api/jobs/price-backfill", { method: "POST", body: JSON.stringify({ force: true }) });
    const result = await waitForJob(job.id);
    await loadPortfolio({ quiet: true });
    let summary = result.updated > 0
      ? window.CryptoBuchI18n.t("{p0} historische Kurse ergänzt.", { p0: result.updated.toLocaleString(window.CryptoBuchI18n.locale) })
      : window.CryptoBuchI18n.t("Keine fehlenden historischen Kurse ergänzt.");
    if (result.remaining > 0) {
      summary += window.CryptoBuchI18n.t(" {p0} sind noch offen. Abrufbare Kurse werden weiter geprüft; fehlende Zuordnungen stehen unter Datenabrufe.", { p0: result.remaining.toLocaleString(window.CryptoBuchI18n.locale) });
    }
    toast(result.hint ? `${summary} ${result.hint}` : summary, result.unresolved || result.blocked ? "error" : "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = window.CryptoBuchI18n.t("Historische Kurse ergänzen");
  }
}

el("asset-visibility-search").addEventListener("input", renderAssetVisibility);
el("refresh-all").addEventListener("click", syncAll);
el("backfill-historical-prices").addEventListener("click", backfillHistoricalPrices);
for (const button of document.querySelectorAll("[data-history-range]")) {
  button.addEventListener("click", () => {
    const range = button.dataset.historyRange;
    if (!HISTORY_RANGES[range] || range === state.historyRange) return;
    state.historyRange = range;
    renderHistoryChart(state.portfolio?.insights?.valueHistory);
  });
}
loadPortfolio();
loadMarketCatalog();
