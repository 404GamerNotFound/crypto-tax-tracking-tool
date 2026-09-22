const state = { portfolio: null, market: null, notifications: [] };
const el = (id) => document.getElementById(id);
const currency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

function hasNumber(value) {
  return value !== null && value !== "" && value !== undefined && Number.isFinite(Number(value));
}

function assetInfo(assetId) {
  return state.portfolio?.assets?.[assetId] || state.portfolio?.chains?.[assetId] || { symbol: assetId, decimals: 6, chain: assetId };
}

function formatAmount(value, assetId) {
  const asset = assetInfo(assetId);
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: asset.decimals || 6 }).format(Number(value || 0))} ${asset.symbol || asset.asset || assetId}`;
}

function formatCurrency(value) {
  return hasNumber(value) ? currency.format(Number(value)) : "k. A.";
}

function formatMarketPrice(value) {
  if (!hasNumber(value)) return "k. A.";
  const price = Number(value);
  const digits = price >= 100 ? 2 : price >= 1 ? 3 : price >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: digits }).format(price);
}

function formatMarketCap(value) {
  return hasNumber(value)
    ? new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 }).format(Number(value))
    : "k. A.";
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
  label.textContent = asset.kind === "erc20" ? `${asset.name} · ERC-20` : asset.name;
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
  const purchaseProfitLabel = report?.purchases?.profitIsPartial ? "Gewinn ggü. Kauf · teilweise" : "Gewinn ggü. Kauf";
  const rows = [
    ["Gekauft", formatAmount(report?.purchases?.acquiredAmount || 0, assetId)],
    [purchaseProfitLabel, purchaseProfit === null || purchaseProfit === undefined ? "k. A." : formatCurrency(purchaseProfit), purchaseProfit >= 0 ? "positive" : "negative"],
    ["Staking-Ertrag", formatCurrency(report?.staking?.currentValueEur)],
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
  footer.textContent = `Marktwert ${formatCurrency(report?.holdingValueEur)}`;
  card.append(head, metrics, footer);
  return card;
}

function render() {
  const portfolio = state.portfolio;
  el("total-value").textContent = formatCurrency(portfolio.totalValueEur);
  el("wallet-count").textContent = (portfolio.wallets || []).length.toLocaleString("de-DE");
  el("transaction-count").textContent = (portfolio.transactions || []).length.toLocaleString("de-DE");
  const reports = Object.values(portfolio.assetAnalytics || {});
  const knownProfits = reports.map((report) => report?.purchases?.profitEur).filter((value) => hasNumber(value));
  const partialProfits = reports.filter((report) => report?.purchases?.profitIsPartial).length;
  const earningsValue = reports.reduce((sum, report) => sum + Number(report?.staking?.currentValueEur || 0), 0);
  const dataIssues = (portfolio.transactions || []).filter((transaction) => !transaction.purpose || !hasNumber(transaction.price_transaction_eur)).length;
  el("purchase-profit").textContent = knownProfits.length ? formatCurrency(knownProfits.reduce((sum, value) => sum + Number(value), 0)) : "k. A.";
  el("purchase-profit-help").textContent = partialProfits ? `${partialProfits} Coin${partialProfits === 1 ? "" : "s"} teilweise bewertet` : "Vollständig bewertete FIFO-Chargen";
  el("earnings-value").textContent = formatCurrency(earningsValue);
  el("data-issues").textContent = dataIssues.toLocaleString("de-DE");
  const performance = portfolio.insights?.performance || {};
  el("unrealized-profit").textContent = formatCurrency(performance.unrealizedProfitEur);
  el("purchase-return").textContent = hasNumber(performance.purchaseReturnPercent) ? `${performance.purchaseReturnPercent >= 0 ? "+" : ""}${Number(performance.purchaseReturnPercent).toLocaleString("de-DE", { maximumFractionDigits: 1 })} % auf bekannte Kaufchargen` : "Kaufkurse teilweise nicht verfügbar";
  el("realized-year").textContent = formatCurrency(performance.realizedYearEur);
  el("net-investment").textContent = formatCurrency(performance.netInvestmentEur);
  const prices = portfolio.currentPrices || {};
  el("price-status").textContent = prices.warning
    ? "Preisabfrage momentan nicht verfügbar"
    : prices.updatedAt ? `Preisstand ${dateTime.format(new Date(prices.updatedAt * 1000))}` : "Aktuelle Preise nicht verfügbar";
  const dashboard = el("asset-dashboard");
  dashboard.replaceChildren();
  const walletChains = new Set((portfolio.wallets || []).map((wallet) => wallet.chain));
  for (const chain of Object.values(portfolio.chains || {})) {
    const asset = assetInfo(chain.asset);
    if (walletChains.has(chain.asset) || Math.abs(Number(portfolio.holdings?.[chain.asset] || 0)) > 0) dashboard.append(renderAssetCard(chain.asset, asset));
  }
  for (const [assetId, asset] of Object.entries(portfolio.assets || {})) {
    if (asset.kind === "erc20" && Math.abs(Number(portfolio.holdings?.[assetId] || 0)) > 0) dashboard.append(renderAssetCard(assetId, asset));
  }
  const hasWallets = (portfolio.wallets || []).length > 0;
  dashboard.hidden = !hasWallets;
  el("dashboard-empty").hidden = hasWallets;
  renderInsights(portfolio.insights || {});
}

function renderNotifications() {
  const list = el("notification-list"); list.replaceChildren();
  const unread = state.notifications.filter((item) => !item.is_read);
  const count = el("notification-count"); count.textContent = unread.length; count.hidden = !unread.length;
  for (const item of state.notifications.slice(0, 8)) {
    const row = document.createElement("article"); row.className = `notification-item ${item.level}${item.is_read ? " is-read" : ""}`;
    const title = document.createElement("strong"); title.textContent = item.title;
    const message = document.createElement("p"); message.textContent = item.message;
    row.append(title, message); list.append(row);
  }
  el("notification-empty").hidden = state.notifications.length > 0;
}

async function loadNotifications() {
  try { const data = await api("/api/notifications"); state.notifications = data.notifications || []; renderNotifications(); } catch (_) { /* Portfolio bleibt ohne Hinweise nutzbar. */ }
}

function renderInsights(insights) {
  const allocation = el("allocation-chart");
  allocation.replaceChildren();
  const entries = (insights.allocation || []).slice(0, 7);
  if (!entries.length) { allocation.textContent = "Noch keine bewertbaren Bestände."; return; }
  for (const entry of entries) {
    const row = document.createElement("div"); row.className = "allocation-row";
    const name = document.createElement("span"); name.textContent = assetInfo(entry.asset).symbol || entry.asset;
    const bar = document.createElement("span"); bar.className = "allocation-bar";
    const fill = document.createElement("i"); fill.style.width = `${Math.max(2, entry.share * 100)}%`; bar.append(fill);
    const value = document.createElement("strong"); value.textContent = `${(entry.share * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
    row.append(name, bar, value); allocation.append(row);
  }
  const chart = el("portfolio-history-chart"); chart.replaceChildren();
  const points = insights.valueHistory || [];
  if (points.length < 2) { chart.textContent = "Noch zu wenige historische Werte für eine Entwicklung."; return; }
  const values = points.map((point) => Number(point.valueEur || 0)); const min = Math.min(...values); const max = Math.max(...values); const span = max - min || 1;
  const ns = "http://www.w3.org/2000/svg"; const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 720 220"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Historische Buchwertentwicklung");
  const polyline = document.createElementNS(ns, "polyline"); polyline.setAttribute("class", "history-line"); polyline.setAttribute("points", points.map((point, index) => `${(index / (points.length - 1)) * 700 + 10},${200 - ((Number(point.valueEur || 0) - min) / span) * 170}`).join(" ")); svg.append(polyline);
  chart.append(svg);
}

function renderMarketCatalog() {
  const market = state.market;
  const catalog = el("market-catalog");
  catalog.replaceChildren();
  const assets = market?.assets || [];
  const timestamp = market?.updatedAt ? new Date(market.updatedAt) : null;
  el("market-status").textContent = market?.warning
    ? "Preisabfrage momentan nicht verfügbar"
    : timestamp ? `Marktstand ${dateTime.format(timestamp)}` : "Aktuelle Marktdaten nicht verfügbar";
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
    change.textContent = Number.isFinite(dailyChange) ? `24 h ${dailyChange >= 0 ? "+" : ""}${dailyChange.toLocaleString("de-DE", { maximumFractionDigits: 2 })} %` : "24 h k. A.";
    change.className = Number.isFinite(dailyChange) ? (dailyChange >= 0 ? "positive" : "negative") : "";
    price.append(value, change);
    const meta = document.createElement("div");
    meta.className = "market-meta";
    const cap = document.createElement("span");
    cap.textContent = `Marktkapitalisierung ${formatMarketCap(asset.marketCapEur)}`;
    const availability = asset.import.chain ? document.createElement("a") : document.createElement("span");
    availability.className = `market-availability ${asset.import.type}`;
    availability.textContent = asset.import.label;
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
    if (!quiet) el("price-status").textContent = "Ansicht wird geladen …";
    state.portfolio = await api("/api/portfolio");
    render();
  } catch (error) {
    toast(error.message, "error");
    el("price-status").textContent = "Daten momentan nicht verfügbar";
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
  button.textContent = "Synchronisiert …";
  try {
    const queued = await api("/api/jobs/sync", { method: "POST", body: JSON.stringify({ walletIds: wallets.map((wallet) => wallet.id) }) });
    const results = await Promise.all(queued.jobs.map((job) => waitForJob(job.id)));
    await loadPortfolio({ quiet: true });
    toast(`${results.reduce((sum, result) => sum + result.imported, 0).toLocaleString("de-DE")} Transaktionen aktualisiert.`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Alles aktualisieren";
  }
}

async function waitForJob(id) {
  for (let tries = 0; tries < 240; tries += 1) {
    const job = await api(`/api/jobs/${id}`);
    if (job.status === "success") return job.result || {};
    if (job.status === "error") throw new Error(job.error_message || "Hintergrundjob fehlgeschlagen.");
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error("Hintergrundjob benötigt länger als erwartet.");
}

async function backfillHistoricalPrices() {
  const button = el("backfill-historical-prices");
  button.disabled = true;
  button.textContent = "Kurse werden ergänzt …";
  try {
    const { job } = await api("/api/jobs/price-backfill", { method: "POST", body: JSON.stringify({ force: true }) });
    const result = await waitForJob(job.id);
    await loadPortfolio({ quiet: true });
    let summary = result.updated > 0
      ? `${result.updated.toLocaleString("de-DE")} historische Kurse ergänzt.`
      : "Keine fehlenden historischen Kurse ergänzt.";
    if (result.remaining > 0) {
      summary += ` ${result.remaining.toLocaleString("de-DE")} fehlen noch und werden automatisch weiter geprüft.`;
    }
    toast(result.hint ? `${summary} ${result.hint}` : summary, result.hint ? "error" : "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Historische Kurse ergänzen";
  }
}

el("refresh-all").addEventListener("click", syncAll);
el("backfill-historical-prices").addEventListener("click", backfillHistoricalPrices);
el("mark-notifications-read").addEventListener("click", async () => { await api("/api/notifications/read", { method: "PATCH", body: JSON.stringify({}) }); await loadNotifications(); });
loadPortfolio();
loadMarketCatalog();
loadNotifications();
