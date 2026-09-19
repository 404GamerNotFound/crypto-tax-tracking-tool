const state = { portfolio: null };
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
  const rows = [
    ["Gekauft", formatAmount(report?.purchases?.acquiredAmount || 0, assetId)],
    ["Gewinn ggü. Kauf", purchaseProfit === null || purchaseProfit === undefined ? "k. A." : formatCurrency(purchaseProfit), purchaseProfit >= 0 ? "positive" : "negative"],
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
  const prices = portfolio.currentPrices || {};
  el("price-status").textContent = prices.warning
    ? "Preisabfrage momentan nicht verfügbar"
    : prices.updatedAt ? `Preisstand ${dateTime.format(new Date(prices.updatedAt * 1000))}` : "Aktuelle Preise nicht verfügbar";
  const dashboard = el("asset-dashboard");
  dashboard.replaceChildren();
  for (const chain of Object.values(portfolio.chains || {})) {
    const asset = assetInfo(chain.asset);
    dashboard.append(renderAssetCard(chain.asset, asset));
  }
  for (const [assetId, asset] of Object.entries(portfolio.assets || {})) {
    if (asset.kind === "erc20" && Math.abs(Number(portfolio.holdings?.[assetId] || 0)) > 0) dashboard.append(renderAssetCard(assetId, asset));
  }
  const hasWallets = (portfolio.wallets || []).length > 0;
  dashboard.hidden = !hasWallets;
  el("dashboard-empty").hidden = hasWallets;
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
    const results = [];
    for (const wallet of wallets) results.push(await api(`/api/wallets/${wallet.id}/sync`, { method: "POST" }));
    await loadPortfolio({ quiet: true });
    toast(`${results.reduce((sum, result) => sum + result.imported, 0).toLocaleString("de-DE")} Transaktionen aktualisiert.`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Alles aktualisieren";
  }
}

el("refresh-all").addEventListener("click", syncAll);
loadPortfolio();
