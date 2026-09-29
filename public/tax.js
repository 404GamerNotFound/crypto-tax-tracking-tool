const { api, cell, el, toast: showToast } = window.CryptoBuchUI;
const currency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const PAGE_SIZE = 25;
const state = {
  report: null,
  optimizer: null,
  salesPage: 1,
  incomePage: 1,
  incomeFilters: { type: "", kind: "", source: "", asset: "" },
};
const money = (value) => value === null || value === undefined ? "k. A." : currency.format(Number(value));
const amount = (value, asset) => `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 8 }).format(Number(value || 0))} ${asset}`;

function toast(message, kind = "success") { showToast(message, kind, { duration: 5000 }); }
function salesTaxStatus(sale, profile) { if (!sale.complete) return "Prüfung offen"; if (!profile.disposalTaxEnabled) return "Nicht aktiviert"; if (sale.holdingPeriodMet) return "Haltefrist erfüllt"; return "steuerlich relevant"; }
function pageRows(rows, page) { const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); const safePage = Math.min(Math.max(1, page), totalPages); return { rows: rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), page: safePage, totalPages }; }
function renderPagination(prefix, totalRows, page, onChange) {
  const pagination = el(`${prefix}-pagination`); const previous = el(`${prefix}-page-prev`); const next = el(`${prefix}-page-next`);
  const { page: safePage, totalPages } = pageRows(Array(totalRows), page);
  pagination.hidden = totalRows <= PAGE_SIZE;
  el(`${prefix}-page-status`).textContent = totalRows ? `Seite ${safePage} von ${totalPages} · ${totalRows} Position${totalRows === 1 ? "" : "en"}` : "";
  previous.disabled = safePage <= 1; next.disabled = safePage >= totalPages;
  previous.onclick = () => onChange(safePage - 1); next.onclick = () => onChange(safePage + 1);
}
function replaceOptions(id, values, label, selected) {
  const select = el(id); const previous = selected ?? select.value;
  select.replaceChildren(new Option(label, ""), ...values.map((value) => new Option(value.label || value, value.value || value)));
  select.value = [...select.options].some((option) => option.value === previous) ? previous : "";
}
function filteredIncome() {
  const filters = state.incomeFilters;
  return (state.report?.income || []).filter((entry) =>
    (!filters.type || entry.type === filters.type)
    && (!filters.kind || entry.sourceKind === filters.kind)
    && (!filters.source || `${entry.sourceKind}:${entry.sourceLabel}` === filters.source)
    && (!filters.asset || entry.asset === filters.asset));
}
function renderSales() {
  const rows = state.report?.sales || []; const paged = pageRows(rows, state.salesPage); state.salesPage = paged.page;
  const body = el("sales-list"); body.replaceChildren(...paged.rows.map((sale) => { const row = document.createElement("tr"); row.append(cell(sale.asset), cell(date.format(new Date(sale.soldAt))), cell(sale.acquiredAt ? date.format(new Date(sale.acquiredAt)) : "k. A."), cell(sale.holdingDays === null || sale.holdingDays === undefined ? "k. A." : `${sale.holdingDays} Tage`), cell(amount(sale.amount, sale.asset)), cell(money(sale.proceedsEur)), cell(money(sale.costEur)), cell(money(sale.profitEur)), cell(salesTaxStatus(sale, state.report.profile)), cell(sale.complete ? "vollständig" : "unvollständig")); return row; }));
  el("sales-empty").hidden = rows.length > 0;
  renderPagination("sales", rows.length, state.salesPage, (page) => { state.salesPage = page; renderSales(); });
}
function renderIncome() {
  const rows = filteredIncome(); const paged = pageRows(rows, state.incomePage); state.incomePage = paged.page;
  const body = el("staking-list"); body.replaceChildren(...paged.rows.map((entry) => { const row = document.createElement("tr"); row.append(cell(entry.type), cell(entry.sourceLabel || (entry.sourceKind === "exchange" ? "Börsenkonto" : "Wallet")), cell(entry.asset), cell(date.format(new Date(entry.receivedAt))), cell(amount(entry.amount, entry.asset)), cell(money(entry.valueEur)), cell(entry.complete ? "vollständig" : "unvollständig")); return row; }));
  el("staking-empty").hidden = rows.length > 0;
  renderPagination("income", rows.length, state.incomePage, (page) => { state.incomePage = page; renderIncome(); });
}
function populateIncomeFilters() {
  const entries = state.report?.income || [];
  const sources = [...new Map(entries.map((entry) => [`${entry.sourceKind}:${entry.sourceLabel}`, { value: `${entry.sourceKind}:${entry.sourceLabel}`, label: `${entry.sourceKind === "exchange" ? "Börse" : "Wallet"}: ${entry.sourceLabel}` }])).values()].sort((left, right) => left.label.localeCompare(right.label, "de"));
  const assets = [...new Set(entries.map((entry) => entry.asset).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  replaceOptions("income-source-filter", sources, "Alle Quellen", state.incomeFilters.source);
  replaceOptions("income-asset-filter", assets, "Alle Coins", state.incomeFilters.asset);
}
function renderSnapshots(snapshots) { const list = el("snapshot-list"); if (!snapshots.length) { list.replaceChildren(Object.assign(document.createElement("li"), { className: "muted", textContent: "Für dieses Jahr ist noch kein unveränderbarer Snapshot gespeichert." })); return; } list.replaceChildren(...snapshots.map((snapshot) => { const item = document.createElement("li"); const created = new Date(`${snapshot.createdAt.replace(" ", "T")}Z`); item.append(`${date.format(created)} · ${snapshot.profileLabel} · SHA-256 ${snapshot.checksum.slice(0, 16)}… · `); const link = document.createElement("a"); link.href = `/api/tax-report/snapshots/${encodeURIComponent(snapshot.id)}`; link.target = "_blank"; link.rel = "noopener"; link.textContent = "Snapshot prüfen"; item.append(link); return item; })); }
async function loadSnapshots(year) { renderSnapshots((await api(`/api/tax-report/snapshots?year=${encodeURIComponent(year)}`)).snapshots); }
function optimizerList(id, rows, formatter, emptyText) { const list = el(id); if (!rows.length) { list.replaceChildren(Object.assign(document.createElement("li"), { className: "muted", textContent: emptyText })); return; } list.replaceChildren(...rows.map((row) => { const item = document.createElement("li"); item.textContent = formatter(row); return item; })); }
function renderOptimizer(data) { state.optimizer = data; optimizerList("holding-calendar", data.holdingCalendar || [], (lot) => `${lot.asset} · ${amount(lot.amount, lot.asset)} ab ${date.format(new Date(lot.eligibleAt))}`, "Keine offenen Haltefristen."); optimizerList("loss-harvesting", data.lossHarvesting || [], (lot) => `${lot.asset} · mögliche Differenz ${money(lot.potentialLossEur)} · nur prüfen`, "Keine bewertbaren Verlustpositionen."); const select = el("simulation-asset"); const previous = select.value; const assets = data.availableAssets || []; if (!select.options.length || !assets.includes(previous)) select.replaceChildren(...assets.map((asset) => new Option(asset, asset))); if (previous && assets.includes(previous)) select.value = previous; }
async function loadOptimizer(year) { renderOptimizer(await api(`/api/tax-optimizer?year=${encodeURIComponent(year)}`)); }

function render(report) {
  state.report = report;
  const { summary, profile } = report; const select = el("report-year");
  if (!select.options.length) for (const year of report.availableYears.length ? report.availableYears : [report.year]) select.add(new Option(String(year), String(year)));
  select.value = String(report.year);
  el("profit-total").textContent = money(summary.realizedProfitEur); el("profit-help").textContent = `${summary.saleSegments - summary.incompleteSaleSegments} vollständige FIFO-Segmente`;
  el("taxable-sale-total").textContent = money(summary.taxableSaleProfitEur); el("taxable-sale-help").textContent = summary.exemptionApplied ? `Freigrenze angewendet (${money(profile.exemptionThresholdEur)})` : `${summary.taxableSaleSegments} Segment${summary.taxableSaleSegments === 1 ? "" : "e"} vor Steuer`;
  el("wallet-income-total").textContent = money(summary.walletIncomeEur); el("wallet-income-help").textContent = `${summary.walletIncomeEntries} Ertragsposition${summary.walletIncomeEntries === 1 ? "" : "en"} · bewertet`;
  el("exchange-income-total").textContent = money(summary.exchangeIncomeEur); el("exchange-income-help").textContent = `${summary.exchangeIncomeEntries} Ertragsposition${summary.exchangeIncomeEntries === 1 ? "" : "en"} · bewertet`;
  el("estimated-tax-total").textContent = profile.disposalTaxRatePercent || profile.incomeTaxRatePercent ? money(summary.estimatedTaxEur) : "—"; el("estimated-tax-help").textContent = profile.disposalTaxRatePercent || profile.incomeTaxRatePercent ? `Verkauf: ${money(summary.estimatedDisposalTaxEur)} · Ertrag: ${money(summary.estimatedIncomeTaxEur)}` : "Steuersätze im Regelwerk hinterlegen";
  el("profile-name").textContent = profile.label; el("profile-note").textContent = profile.ruleNote; el("profile-holding").textContent = profile.holdingPeriodEnabled ? `${profile.holdingPeriodDays} Tage` : "nicht angewendet"; el("profile-threshold").textContent = profile.exemptionThresholdEnabled ? money(profile.exemptionThresholdEur) : "nicht angewendet"; el("profile-cost-basis").textContent = profile.costBasisMethod || "FIFO"; el("profile-income-types").textContent = profile.incomePurposes.join(", ");
  const incomplete = summary.incompleteSaleSegments + summary.incompleteIncomeEntries; el("report-completeness").textContent = incomplete ? `${incomplete} Position${incomplete === 1 ? "" : "en"} sind unvollständig und nicht in EUR-Summen oder Steuerreserve enthalten. Prüfe historische Kurse, Gebühren und fehlende Anschaffungs-Chargen.` : "Alle im Report berücksichtigten Verkaufssegmente und Erträge besitzen die erforderlichen historischen Werte.";
  el("sales-status").textContent = `${summary.holdingPeriodExemptSaleSegments} Segmente mit erfüllter Haltefrist`; el("csv-export").href = `/api/tax-report.csv?year=${encodeURIComponent(report.year)}`; el("advisor-export").href = `/api/tax-report/advisor-package?year=${encodeURIComponent(report.year)}`; el("pdf-export").href = `/tax-print.html?year=${encodeURIComponent(report.year)}`; el("sales-title").textContent = `${profile.costBasisMethod || "FIFO"}-Verkaufssegmente`;
  populateIncomeFilters(); renderSales(); renderIncome();
}
async function load(year) { try { const report = await api(`/api/tax-report?year=${encodeURIComponent(year || new Date().getFullYear())}`); state.salesPage = 1; state.incomePage = 1; render(report); await Promise.all([loadSnapshots(report.year), loadOptimizer(report.year)]); } catch (error) { toast(error.message, "error"); } }
el("report-year").addEventListener("change", (event) => load(event.target.value));
["income-type-filter", "income-kind-filter", "income-source-filter", "income-asset-filter"].forEach((id) => el(id).addEventListener("change", () => { state.incomeFilters = { type: el("income-type-filter").value, kind: el("income-kind-filter").value, source: el("income-source-filter").value, asset: el("income-asset-filter").value }; state.incomePage = 1; renderIncome(); }));
el("archive-report").addEventListener("click", async () => { if (!state.report) return; const button = el("archive-report"); button.disabled = true; try { const snapshot = await api("/api/tax-report/snapshots", { method: "POST", body: JSON.stringify({ year: state.report.year }) }); toast(`Snapshot gesichert (SHA-256 ${snapshot.checksum.slice(0, 16)}…).`); await loadSnapshots(state.report.year); } catch (error) { toast(error.message, "error"); } finally { button.disabled = false; } });
el("sale-simulator").addEventListener("submit", async (event) => { event.preventDefault(); if (!state.report) return; try { const result = await api("/api/tax-optimizer/simulate", { method: "POST", body: JSON.stringify({ year: state.report.year, asset: el("simulation-asset").value, amount: el("simulation-amount").value, priceEur: el("simulation-price").value || null }) }); el("simulation-result").textContent = result.complete ? `Erlös ${money(result.proceedsEur)} · Gewinn ${money(result.profitEur)} · geschätzte Steuerreserve ${money(result.estimatedTaxEur)}.` : `Nicht genügend vollständig bewertete Lots vorhanden; offen: ${amount(result.missingAmount, result.asset)}.`; } catch (error) { toast(error.message, "error"); } });
load();
