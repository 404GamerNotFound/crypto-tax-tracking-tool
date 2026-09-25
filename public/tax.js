const el = (id) => document.getElementById(id);
const currency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const state = { report: null };
const money = (value) => value === null || value === undefined ? "k. A." : currency.format(Number(value));
const amount = (value, asset) => `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 8 }).format(Number(value || 0))} ${asset}`;

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Der Steuerreport konnte nicht geladen werden.");
  return payload;
}
function toast(message, kind = "success") { const node = el("toast"); node.textContent = message; node.className = `toast ${kind}`; node.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 5000); }
function cell(value) { const node = document.createElement("td"); node.textContent = value; return node; }
function renderRows(id, rows, create) { const body = el(id); body.replaceChildren(...rows.map(create)); el(id === "sales-list" ? "sales-empty" : "staking-empty").hidden = rows.length > 0; }
function salesTaxStatus(sale, profile) {
  if (!sale.complete) return "Prüfung offen";
  if (!profile.disposalTaxEnabled) return "Nicht aktiviert";
  if (sale.holdingPeriodMet) return "Haltefrist erfüllt";
  return "steuerlich relevant";
}
function renderSnapshots(snapshots) {
  const list = el("snapshot-list");
  if (!snapshots.length) { list.replaceChildren(Object.assign(document.createElement("li"), { className: "muted", textContent: "Für dieses Jahr ist noch kein unveränderbarer Snapshot gespeichert." })); return; }
  list.replaceChildren(...snapshots.map((snapshot) => {
    const item = document.createElement("li");
    const created = new Date(`${snapshot.createdAt.replace(" ", "T")}Z`);
    item.append(`${date.format(created)} · ${snapshot.profileLabel} · SHA-256 ${snapshot.checksum.slice(0, 16)}… · `);
    const link = document.createElement("a");
    link.href = `/api/tax-report/snapshots/${encodeURIComponent(snapshot.id)}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Snapshot prüfen";
    item.append(link);
    return item;
  }));
}
async function loadSnapshots(year) { renderSnapshots((await api(`/api/tax-report/snapshots?year=${encodeURIComponent(year)}`)).snapshots); }

function render(report) {
  state.report = report;
  const { summary, profile } = report;
  const select = el("report-year");
  if (!select.options.length) for (const year of report.availableYears.length ? report.availableYears : [report.year]) select.add(new Option(String(year), String(year)));
  select.value = String(report.year);
  el("profit-total").textContent = money(summary.realizedProfitEur);
  el("profit-help").textContent = `${summary.saleSegments - summary.incompleteSaleSegments} vollständige FIFO-Segmente`;
  el("taxable-sale-total").textContent = money(summary.taxableSaleProfitEur);
  el("taxable-sale-help").textContent = summary.exemptionApplied ? `Freigrenze angewendet (${money(profile.exemptionThresholdEur)})` : `${summary.taxableSaleSegments} Segment${summary.taxableSaleSegments === 1 ? "" : "e"} vor Steuer`;
  el("staking-total").textContent = money(summary.incomeEur);
  el("staking-help").textContent = `${summary.incomeEntries - summary.incompleteIncomeEntries} vollständig bewertete Erträge`;
  el("estimated-tax-total").textContent = profile.disposalTaxRatePercent || profile.incomeTaxRatePercent ? money(summary.estimatedTaxEur) : "—";
  el("estimated-tax-help").textContent = profile.disposalTaxRatePercent || profile.incomeTaxRatePercent ? `Verkauf: ${money(summary.estimatedDisposalTaxEur)} · Ertrag: ${money(summary.estimatedIncomeTaxEur)}` : "Steuersätze im Regelwerk hinterlegen";
  el("profile-name").textContent = profile.label;
  el("profile-note").textContent = profile.ruleNote;
  el("profile-holding").textContent = profile.holdingPeriodEnabled ? `${profile.holdingPeriodDays} Tage` : "nicht angewendet";
  el("profile-threshold").textContent = profile.exemptionThresholdEnabled ? money(profile.exemptionThresholdEur) : "nicht angewendet";
  el("profile-income-types").textContent = profile.incomePurposes.join(", ");
  const incomplete = summary.incompleteSaleSegments + summary.incompleteIncomeEntries;
  el("report-completeness").textContent = incomplete ? `${incomplete} Position${incomplete === 1 ? "" : "en"} sind unvollständig und nicht in EUR-Summen oder Steuerreserve enthalten. Prüfe historische Kurse, Gebühren und fehlende Anschaffungs-Chargen.` : "Alle im Report berücksichtigten Verkaufssegmente und Erträge besitzen die erforderlichen historischen Werte.";
  el("sales-status").textContent = `${summary.holdingPeriodExemptSaleSegments} Segmente mit erfüllter Haltefrist`;
  el("csv-export").href = `/api/tax-report.csv?year=${encodeURIComponent(report.year)}`;
  el("pdf-export").href = `/tax-print.html?year=${encodeURIComponent(report.year)}`;
  renderRows("sales-list", report.sales, (sale) => { const row = document.createElement("tr"); row.append(cell(sale.asset), cell(date.format(new Date(sale.soldAt))), cell(sale.acquiredAt ? date.format(new Date(sale.acquiredAt)) : "k. A."), cell(sale.holdingDays === null || sale.holdingDays === undefined ? "k. A." : `${sale.holdingDays} Tage`), cell(amount(sale.amount, sale.asset)), cell(money(sale.proceedsEur)), cell(money(sale.costEur)), cell(money(sale.profitEur)), cell(salesTaxStatus(sale, profile)), cell(sale.complete ? "vollständig" : "unvollständig")); return row; });
  renderRows("staking-list", report.income, (entry) => { const row = document.createElement("tr"); row.append(cell(entry.type), cell(entry.asset), cell(date.format(new Date(entry.receivedAt))), cell(amount(entry.amount, entry.asset)), cell(money(entry.valueEur)), cell(entry.complete ? "vollständig" : "unvollständig")); return row; });
}
async function load(year) { try { const report = await api(`/api/tax-report?year=${encodeURIComponent(year || new Date().getFullYear())}`); render(report); await loadSnapshots(report.year); } catch (error) { toast(error.message, "error"); } }
el("report-year").addEventListener("change", (event) => load(event.target.value));
el("archive-report").addEventListener("click", async () => { if (!state.report) return; const button = el("archive-report"); button.disabled = true; try { const snapshot = await api("/api/tax-report/snapshots", { method: "POST", body: JSON.stringify({ year: state.report.year }) }); toast(`Snapshot gesichert (SHA-256 ${snapshot.checksum.slice(0, 16)}…).`); await loadSnapshots(state.report.year); } catch (error) { toast(error.message, "error"); } finally { button.disabled = false; } });
load();
