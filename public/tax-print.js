const params = new URLSearchParams(window.location.search);
const year = params.get("year") || new Date().getFullYear();
const { api, cell } = window.CryptoBuchUI;
const money = new Intl.NumberFormat(window.CryptoBuchI18n.locale, { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat(window.CryptoBuchI18n.locale, { dateStyle: "medium" });
const amount = (value, asset) => `${new Intl.NumberFormat(window.CryptoBuchI18n.locale, { maximumFractionDigits: 8 }).format(Number(value || 0))} ${asset}`;
api(`/api/tax-report?year=${encodeURIComponent(year)}`).then((report) => {
  const { summary, profile } = report;
  document.title = window.CryptoBuchI18n.t("CryptoBuch Steuerreport {p0}", { p0: report.year });
  document.getElementById("subtitle").textContent = window.CryptoBuchI18n.t("Lokale FIFO-Organisationshilfe für {p0}. Keine steuerliche Beratung.", { p0: report.year });
  document.getElementById("profit").textContent = money.format(summary.realizedProfitEur);
  document.getElementById("taxable-sales").textContent = money.format(summary.taxableSaleProfitEur);
  document.getElementById("income").textContent = money.format(summary.incomeEur);
  document.getElementById("tax-estimate").textContent = money.format(summary.estimatedTaxEur);
  document.getElementById("profile-name").textContent = window.CryptoBuchI18n.t("Regelwerk: {p0}", { p0: profile.label });
  const incomplete = summary.incompleteSaleSegments + summary.incompleteIncomeEntries;
  document.getElementById("notice").textContent = `${profile.ruleNote} ${incomplete ? window.CryptoBuchI18n.t("{p0} unvollständige Positionen sind nicht in den EUR-Summen enthalten.", { p0: incomplete }) : window.CryptoBuchI18n.t("Alle enthaltenen Positionen besitzen die erforderlichen historischen Werte.")}`;
  const sales = document.getElementById("sales");
  for (const sale of report.sales) { const row = document.createElement("tr"); row.append(cell(sale.asset), cell(date.format(new Date(sale.soldAt))), cell(sale.acquiredAt ? date.format(new Date(sale.acquiredAt)) : window.CryptoBuchI18n.t("k. A.")), cell(amount(sale.amount, sale.asset)), cell(sale.profitEur === null ? window.CryptoBuchI18n.t("k. A.") : money.format(sale.profitEur)), cell(sale.holdingPeriodMet === null ? window.CryptoBuchI18n.t("k. A.") : sale.holdingPeriodMet ? window.CryptoBuchI18n.t("erfüllt") : window.CryptoBuchI18n.t("offen")), cell(sale.complete ? window.CryptoBuchI18n.t("vollständig") : window.CryptoBuchI18n.t("unvollständig"))); sales.append(row); }
  const income = document.getElementById("income-list");
  for (const entry of report.income) { const row = document.createElement("tr"); row.append(cell(window.CryptoBuchI18n.t(entry.type)), cell(entry.asset), cell(date.format(new Date(entry.receivedAt))), cell(amount(entry.amount, entry.asset)), cell(entry.valueEur === null ? window.CryptoBuchI18n.t("k. A.") : money.format(entry.valueEur)), cell(entry.complete ? window.CryptoBuchI18n.t("vollständig") : window.CryptoBuchI18n.t("unvollständig"))); income.append(row); }
  setTimeout(() => window.print(), 250);
}).catch(() => { document.getElementById("subtitle").textContent = window.CryptoBuchI18n.t("Report konnte nicht geladen werden."); });
