const { api, el, node, priceProviderLabel: sourceLabel, toast } = window.CryptoBuchUI;
const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const state = { page: 1, data: null };

function readableDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : date.format(parsed);
}

function readableDateTime(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dateTime.format(parsed);
}

function triggerLabel(trigger) {
  return ({ automatisch: "Automatisch", manuell: "Manuell", wallet_sync: "Wallet-Sync" })[trigger] || trigger;
}

function runState(run) {
  if (run.status === "running") return { label: "Läuft", className: "running" };
  if (run.status === "error" || run.status === "interrupted") return { label: run.status === "interrupted" ? "Unterbrochen" : "Fehler", className: "error" };
  if (run.unresolvedCount > 0) return { label: "Teilweise offen", className: "partial" };
  return { label: "Erfolgreich", className: "success" };
}

function renderPipeline(pipeline) {
  const status = ({ running: "Abruf läuft", queued: "Abruf wartet", waiting: "Bereit" })[pipeline.status] || "Bereit";
  el("price-pipeline-status").textContent = status;
  el("price-pipeline-status").className = "price-pipeline-status " + pipeline.status;
  el("pipeline-pending").textContent = pipeline.pending.toLocaleString("de-DE");
  el("pipeline-due").textContent = pipeline.due.toLocaleString("de-DE");
  el("pipeline-scheduled").textContent = pipeline.scheduled.toLocaleString("de-DE");
  el("pipeline-batch-size").textContent = pipeline.batchSize.toLocaleString("de-DE");
  const copy = pipeline.status === "running"
    ? "Ein lokaler Preisabruf verarbeitet die aktuelle Warteschlange seriell."
    : pipeline.status === "queued"
      ? pipeline.jobs.length + " manueller Kursabruf(e) warten in der lokalen Job-Warteschlange."
      : pipeline.pending
        ? "Die nächste automatische Prüfung startet " + readableDateTime(pipeline.nextAutomaticAt) + "."
        : "Aktuell sind keine fehlenden historischen Kurse vorgemerkt.";
  el("price-pipeline-copy").textContent = copy;
  const stages = pipeline.sources.map((source, index) => {
    const item = node("li", "price-pipeline-stage" + (source.active ? "" : " inactive"));
    item.append(node("span", "price-pipeline-index", String(index + 1)), node("strong", "", source.label));
    item.append(node("small", "", source.active ? "bei fehlendem Tageskurs" : "optional · API-Key fehlt"));
    return item;
  });
  el("price-pipeline-stages").replaceChildren(...stages);
}

function renderUpcoming(data) {
  const items = data.upcoming || [];
  el("price-fetch-upcoming-count").textContent = data.pipeline.pending.toLocaleString("de-DE");
  el("price-fetch-upcoming-count").setAttribute("aria-label", data.pipeline.pending.toLocaleString("de-DE") + " offene Kurse");
  el("price-fetch-next-at").textContent = data.pipeline.status === "running"
    ? "Die Pipeline läuft gerade. Neue Abrufe bleiben hinter der laufenden seriellen Anfrage eingeordnet."
    : data.pipeline.pending
      ? "Nächste automatische Prüfung: " + readableDateTime(data.pipeline.nextAutomaticAt) + " · Wiederholung im Abstand von mindestens " + data.pipeline.retryIntervalMinutes + " Minuten."
      : "Die Pipeline prüft weiterhin lokal, sobald neue Buchungen ohne historischen Kurs eintreffen.";
  const rows = items.map((entry) => {
    const tr = node("tr");
    [
      readableDate(entry.timestamp),
      entry.assetSymbol || entry.asset,
      entry.sourceLabel,
      entry.due ? "Im nächsten freien Batch" : readableDateTime(entry.nextAttemptAt),
      entry.attempts ? entry.attempts.toLocaleString("de-DE") : "neu",
    ].forEach((value) => tr.append(node("td", "", value)));
    return tr;
  });
  el("price-fetch-upcoming-list").replaceChildren(...rows);
  el("price-fetch-upcoming-empty").hidden = items.length > 0;
}

function detailMetric(label, value) {
  const item = node("div", "price-fetch-run-metric");
  item.append(node("span", "", label), node("strong", "", value));
  return item;
}

function eventRow(event) {
  const tr = node("tr");
  const status = event.status === "success" ? (event.returnedPrices ? "Treffer" : "Kein Tageskurs") : "Fehler";
  const range = event.dateFrom && event.dateTo && event.dateFrom !== event.dateTo
    ? readableDate(event.dateFrom) + " – " + readableDate(event.dateTo)
    : readableDate(event.dateFrom);
  [
    readableDateTime(event.finishedAt || event.startedAt),
    sourceLabel(event.source),
    event.asset,
    range,
    status,
    event.status === "success" ? event.returnedPrices.toLocaleString("de-DE") : (event.errorMessage || "—"),
  ].forEach((value) => tr.append(node("td", "", value)));
  return tr;
}

function runCard(run) {
  const card = node("details", "price-fetch-run");
  const summary = node("summary", "price-fetch-run-summary");
  const stateLabel = runState(run);
  const headline = node("div", "price-fetch-run-headline");
  headline.append(
    node("span", "price-fetch-run-status " + stateLabel.className, stateLabel.label),
    node("strong", "", triggerLabel(run.trigger)),
    node("span", "muted", "#" + run.id + " · " + readableDateTime(run.startedAt)),
  );
  const compact = node("div", "price-fetch-run-compact");
  compact.append(node("span", "", run.attemptedCount.toLocaleString("de-DE") + " geprüft"), node("span", "", run.updatedCount.toLocaleString("de-DE") + " ergänzt"));
  if (run.unresolvedCount) compact.append(node("span", "", run.unresolvedCount.toLocaleString("de-DE") + " offen"));
  summary.append(headline, compact);
  card.append(summary);
  const body = node("div", "price-fetch-run-body");
  const metrics = node("div", "price-fetch-run-metrics");
  metrics.append(
    detailMetric("Offen beim Start", run.pendingCount === null ? "—" : run.pendingCount.toLocaleString("de-DE")),
    detailMetric("Geprüft", run.attemptedCount.toLocaleString("de-DE")),
    detailMetric("Ergänzt", run.updatedCount.toLocaleString("de-DE")),
    detailMetric("Noch offen", run.unresolvedCount.toLocaleString("de-DE")),
  );
  body.append(metrics);
  if (run.errorMessage) body.append(node("p", "price-fetch-run-error", run.errorMessage));
  if (run.result?.hint) body.append(node("p", "data-note", run.result.hint));
  if (!run.events.length) {
    body.append(node("p", "data-note", "Kein externer Abruf nötig: Werte waren bereits lokal zwischengespeichert oder es gab keine passenden Kandidaten."));
  } else {
    const wrap = node("div", "table-wrap price-fetch-event-table");
    const table = node("table");
    const head = node("thead");
    const row = node("tr");
    ["Zeitpunkt", "Quelle", "Asset", "Zeitraum", "Ergebnis", "Wert / Hinweis"].forEach((label) => row.append(node("th", "", label)));
    head.append(row);
    const bodyRows = node("tbody");
    bodyRows.append(...run.events.map(eventRow));
    table.append(head, bodyRows);
    wrap.append(table);
    body.append(wrap);
  }
  card.append(body);
  return card;
}

function renderRuns(data) {
  const runs = data.runs || [];
  el("price-fetch-run-list").replaceChildren(...runs.map(runCard));
  el("price-fetch-run-empty").hidden = runs.length > 0;
  const pagination = data.pagination;
  const visible = pagination.total > 0;
  el("price-fetch-pagination").hidden = !visible;
  el("price-fetch-log-meta").textContent = visible
    ? pagination.total.toLocaleString("de-DE") + " lokale Durchläufe"
    : "Noch kein Abruf";
  el("price-fetch-page-label").textContent = "Seite " + pagination.page + " von " + pagination.totalPages;
  el("price-fetch-previous").disabled = pagination.page <= 1;
  el("price-fetch-next").disabled = pagination.page >= pagination.totalPages;
}

function render() {
  renderPipeline(state.data.pipeline);
  renderUpcoming(state.data);
  renderRuns(state.data);
}

async function load() {
  try {
    state.data = await api("/api/data-quality/price-fetches?page=" + encodeURIComponent(state.page));
    state.page = state.data.pagination.page;
    render();
  } catch (error) {
    toast(error.message, "error");
  }
}

el("start-price-fetch").addEventListener("click", async () => {
  const button = el("start-price-fetch");
  try {
    button.disabled = true;
    button.textContent = "Wird eingeplant …";
    const result = await api("/api/jobs/price-backfill", { method: "POST", body: JSON.stringify({ force: true }) });
    toast("Kursabruf #" + result.job.id + " wurde lokal eingeplant.");
    state.page = 1;
    await load();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Jetzt prüfen";
  }
});
el("reload-price-fetches").addEventListener("click", load);
el("price-fetch-previous").addEventListener("click", () => { if (state.page > 1) { state.page -= 1; load(); } });
el("price-fetch-next").addEventListener("click", () => {
  if (state.page < (state.data?.pagination?.totalPages || 1)) { state.page += 1; load(); }
});
window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
load();
