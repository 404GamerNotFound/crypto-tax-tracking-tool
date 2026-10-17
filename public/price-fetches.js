const { api, el, node, priceProviderLabel: sourceLabel, toast } = window.CryptoBuchUI;
const date = new Intl.DateTimeFormat(window.CryptoBuchI18n.locale, { dateStyle: "medium" });
const dateTime = new Intl.DateTimeFormat(window.CryptoBuchI18n.locale, { dateStyle: "medium", timeStyle: "short" });
const state = { page: 1, data: null };

function readableDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : date.format(parsed);
}

function readableDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dateTime.format(parsed);
}

function triggerLabel(trigger) {
  return ({ automatisch: window.CryptoBuchI18n.t("Automatisch"), manuell: window.CryptoBuchI18n.t("Manuell"), wallet_sync: window.CryptoBuchI18n.t("Wallet-Sync"), import: window.CryptoBuchI18n.t("Import"), automatik: window.CryptoBuchI18n.t("Automatik aktiviert"), zuordnung: window.CryptoBuchI18n.t("Preiszuordnung") })[trigger] || trigger;
}

function runState(run) {
  if (run.status === "running") return { label: window.CryptoBuchI18n.t("Läuft"), className: "running" };
  if (run.status === "error" || run.status === "interrupted") return { label: run.status === "interrupted" ? window.CryptoBuchI18n.t("Unterbrochen") : window.CryptoBuchI18n.t("Fehler"), className: "error" };
  if (run.result?.blocked > 0) return { label: window.CryptoBuchI18n.t("Klärung nötig"), className: "partial" };
  if (run.unresolvedCount > 0) return { label: window.CryptoBuchI18n.t("Teilweise offen"), className: "partial" };
  return { label: window.CryptoBuchI18n.t("Erfolgreich"), className: "success" };
}

function renderPipeline(pipeline) {
  const status = ({ running: window.CryptoBuchI18n.t("Abruf läuft"), queued: window.CryptoBuchI18n.t("Abruf wartet"), waiting: window.CryptoBuchI18n.t("Bereit"), blocked: window.CryptoBuchI18n.t("Zuordnung fehlt") })[pipeline.status] || window.CryptoBuchI18n.t("Bereit");
  el("price-pipeline-status").textContent = status;
  el("price-pipeline-status").className = "price-pipeline-status " + pipeline.status;
  el("pipeline-blocked").textContent = pipeline.blocked ? window.CryptoBuchI18n.t("{p0} Buchungen pausieren wegen fehlender Zuordnung oder ungültigem Datum. Diese belegen keinen Abrufplatz.", { p0: pipeline.blocked.toLocaleString(window.CryptoBuchI18n.locale) }) : window.CryptoBuchI18n.t("Alle offenen Buchungen sind grundsätzlich zugeordnet.");
  el("pipeline-pending").textContent = pipeline.pending.toLocaleString(window.CryptoBuchI18n.locale);
  el("pipeline-due").textContent = pipeline.due.toLocaleString(window.CryptoBuchI18n.locale);
  el("pipeline-scheduled").textContent = pipeline.scheduled.toLocaleString(window.CryptoBuchI18n.locale);
  el("pipeline-batch-size").textContent = pipeline.batchSize.toLocaleString(window.CryptoBuchI18n.locale);
  const copy = pipeline.status === "blocked" ? window.CryptoBuchI18n.t("Die offenen Buchungen benötigen zuerst eine Preiszuordnung oder ein gültiges Datum.") : pipeline.status === "running"
    ? window.CryptoBuchI18n.t("Ein lokaler Preisabruf verarbeitet die aktuelle Warteschlange seriell.")
    : pipeline.status === "queued"
      ? window.CryptoBuchI18n.t("Wartende Kursabrufe: {count}.", { count: pipeline.jobs.length })
      : pipeline.pending
        ? window.CryptoBuchI18n.t("Die nächste automatische Prüfung startet {time}.", { time: readableDateTime(pipeline.nextAutomaticAt) })
        : window.CryptoBuchI18n.t("Aktuell sind keine fehlenden historischen Kurse vorgemerkt.");
  el("price-pipeline-copy").textContent = copy;
  const stages = pipeline.sources.map((source, index) => {
    const item = node("li", "price-pipeline-stage" + (source.active ? "" : " inactive"));
    item.append(node("span", "price-pipeline-index", String(index + 1)), node("strong", "", window.CryptoBuchI18n.message(source.label)));
    item.append(node("small", "", source.active ? window.CryptoBuchI18n.t("bei fehlendem Tageskurs") : window.CryptoBuchI18n.t("optional · API-Key fehlt")));
    return item;
  });
  el("price-pipeline-stages").replaceChildren(...stages);
}

function renderUpcoming(data) {
  const items = data.upcoming || [];
  el("price-fetch-upcoming-count").textContent = data.pipeline.pending.toLocaleString(window.CryptoBuchI18n.locale);
  el("price-fetch-upcoming-count").setAttribute("aria-label", window.CryptoBuchI18n.t("Offene Kurse: {count}", { count: data.pipeline.pending.toLocaleString(window.CryptoBuchI18n.locale) }));
  el("price-fetch-next-at").textContent = data.pipeline.status === "blocked" ? window.CryptoBuchI18n.t("Automatische Abrufe pausieren für diese Buchungen bis zur Klärung.") : data.pipeline.status === "running"
    ? window.CryptoBuchI18n.t("Die Pipeline läuft gerade. Neue Abrufe bleiben hinter der laufenden seriellen Anfrage eingeordnet.")
    : data.pipeline.pending
      ? window.CryptoBuchI18n.t("Nächste automatische Prüfung: {time} · Wiederholung frühestens nach {minutes} Minuten bei Fehlschlägen. Fällige Folge-Batches laufen seriell weiter.", { time: readableDateTime(data.pipeline.nextAutomaticAt), minutes: data.pipeline.retryIntervalMinutes })
      : window.CryptoBuchI18n.t("Die Pipeline prüft weiterhin lokal, sobald neue Buchungen ohne historischen Kurs eintreffen.");
  const rows = items.map((entry) => {
    const tr = node("tr");
    [
      readableDate(entry.timestamp),
      entry.assetSymbol || entry.asset,
      entry.sourceLabel,
      entry.blocked ? window.CryptoBuchI18n.t("Pausiert") : entry.due ? window.CryptoBuchI18n.t("Fällig") : readableDateTime(entry.nextAttemptAt),
      entry.attempts ? entry.attempts.toLocaleString(window.CryptoBuchI18n.locale) : window.CryptoBuchI18n.t("neu"),
      window.CryptoBuchI18n.message(entry.reasonLabel) || "—",
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
  const status = event.status === "success" ? (event.returnedPrices ? window.CryptoBuchI18n.t("Treffer") : window.CryptoBuchI18n.t("Kein Tageskurs")) : window.CryptoBuchI18n.t("Fehler");
  const range = event.dateFrom && event.dateTo && event.dateFrom !== event.dateTo
    ? readableDate(event.dateFrom) + " – " + readableDate(event.dateTo)
    : readableDate(event.dateFrom);
  [
    readableDateTime(event.finishedAt || event.startedAt),
    sourceLabel(event.source),
    event.asset,
    range,
    status,
    event.status === "success" ? event.returnedPrices.toLocaleString(window.CryptoBuchI18n.locale) : (window.CryptoBuchI18n.message(event.errorMessage) || "—"),
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
  compact.append(node("span", "", window.CryptoBuchI18n.t("{count} geprüft", { count: run.attemptedCount.toLocaleString(window.CryptoBuchI18n.locale) })), node("span", "", window.CryptoBuchI18n.t("{count} ergänzt", { count: run.updatedCount.toLocaleString(window.CryptoBuchI18n.locale) })));
  if (run.unresolvedCount) compact.append(node("span", "", window.CryptoBuchI18n.t("{count} offen", { count: run.unresolvedCount.toLocaleString(window.CryptoBuchI18n.locale) })));
  summary.append(headline, compact);
  card.append(summary);
  const body = node("div", "price-fetch-run-body");
  const metrics = node("div", "price-fetch-run-metrics");
  metrics.append(
    detailMetric(window.CryptoBuchI18n.t("Offen beim Start"), run.pendingCount === null ? "—" : run.pendingCount.toLocaleString(window.CryptoBuchI18n.locale)),
    detailMetric(window.CryptoBuchI18n.t("Geprüft"), run.attemptedCount.toLocaleString(window.CryptoBuchI18n.locale)),
    detailMetric(window.CryptoBuchI18n.t("Ergänzt"), run.updatedCount.toLocaleString(window.CryptoBuchI18n.locale)),
    detailMetric(window.CryptoBuchI18n.t("Noch offen"), run.unresolvedCount.toLocaleString(window.CryptoBuchI18n.locale)),
    detailMetric(window.CryptoBuchI18n.t("Klärung nötig"), Number(run.result?.blocked || 0).toLocaleString(window.CryptoBuchI18n.locale)),
  );
  body.append(metrics);
  if (run.errorMessage) body.append(node("p", "price-fetch-run-error", window.CryptoBuchI18n.message(run.errorMessage)));
  if (run.result?.hint) body.append(node("p", "data-note", window.CryptoBuchI18n.message(run.result.hint)));
  if (!run.events.length) {
    body.append(node("p", "data-note", window.CryptoBuchI18n.t("Kein externer HTTP-Abruf in diesem Durchlauf. Gründe können Cache-Treffer, Tarifgrenzen, ein noch offener UTC-Tag oder fehlende Preiszuordnungen sein. Beachte das Ergebnis oben.")));
  } else {
    const wrap = node("div", "table-wrap price-fetch-event-table");
    const table = node("table");
    const head = node("thead");
    const row = node("tr");
    [window.CryptoBuchI18n.t("Zeitpunkt"), window.CryptoBuchI18n.t("Quelle"), window.CryptoBuchI18n.t("Asset"), window.CryptoBuchI18n.t("Zeitraum"), window.CryptoBuchI18n.t("Ergebnis"), window.CryptoBuchI18n.t("Wert / Hinweis")].forEach((label) => row.append(node("th", "", label)));
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
    ? window.CryptoBuchI18n.t("{count} lokale Durchläufe", { count: pagination.total.toLocaleString(window.CryptoBuchI18n.locale) })
    : window.CryptoBuchI18n.t("Noch kein Abruf");
  el("price-fetch-page-label").textContent = window.CryptoBuchI18n.t("Seite {page} von {total}", { page: pagination.page, total: pagination.totalPages });
  el("price-fetch-previous").disabled = pagination.page <= 1;
  el("price-fetch-next").disabled = pagination.page >= pagination.totalPages;
}

let mappingSignature = "";
function renderMappings(mappings) {
  // Polling must not erase a user's partially entered ID or focus.
  const signature = JSON.stringify(mappings);
  if (signature === mappingSignature) return;
  if (el("price-mapping-list").contains(document.activeElement)) return;
  mappingSignature = signature;
  el("price-mapping-empty").hidden = mappings.length > 0;
  el("price-mapping-list").replaceChildren(...mappings.map((mapping) => {
    const form = node("form", "price-mapping-form");
    form.append(node("strong", "", window.CryptoBuchI18n.t("{p0} · {p1} · {p2} {p3} offen", { p0: mapping.asset, p1: mapping.sourceLabel, p2: mapping.missing, p3: mapping.missing === 1 ? window.CryptoBuchI18n.t("Kurs") : window.CryptoBuchI18n.t("Kurse") })));
    const label = node("label");
    label.append(node("span", "", window.CryptoBuchI18n.t("CoinGecko-ID")));
    const input = node("input");
    input.required = true;
    input.maxLength = 100;
    input.pattern = "[a-z0-9][a-z0-9_-]{0,99}";
    input.placeholder = window.CryptoBuchI18n.t("API-ID des Coins");
    input.value = mapping.coinGeckoId || "";
    label.append(input);
    form.append(label);
    const confirmLabel = node("label", "price-mapping-confirm");
    const confirmation = node("input");
    confirmation.type = "checkbox";
    confirmation.required = true;
    confirmLabel.append(confirmation, document.createTextNode(window.CryptoBuchI18n.t("Coin-Identität geprüft; Zuordnung für diese Quelle bestätigen.")));
    form.append(confirmLabel);
    const button = node("button", "button button-secondary", window.CryptoBuchI18n.t("Zuordnung speichern & Kurse abrufen"));
    button.type = "submit";
    form.append(button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      try {
        const result = await api("/api/price-asset-mappings", { method: "PUT", body: JSON.stringify({
          walletId: mapping.walletId, asset: mapping.asset, coinGeckoId: input.value.trim(), confirmed: confirmation.checked,
        }) });
        toast(window.CryptoBuchI18n.t("Zuordnung gespeichert. Kursabruf #{p0} eingeplant.", { p0: result.job.id }));
        confirmation.checked = false;
        mappingSignature = "";
        await load();
      } catch (error) { toast(error.message, "error"); }
      finally { button.disabled = false; }
    });
    return form;
  }));
}

function render() {
  renderMappings(state.data.mappings || []);
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
    button.textContent = window.CryptoBuchI18n.t("Wird eingeplant …");
    const result = await api("/api/jobs/price-backfill", { method: "POST", body: JSON.stringify({ force: true }) });
    toast("Kursabruf #" + result.job.id + " wurde lokal eingeplant.");
    state.page = 1;
    await load();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = window.CryptoBuchI18n.t("Jetzt prüfen");
  }
});
el("reload-price-fetches").addEventListener("click", load);
el("price-fetch-previous").addEventListener("click", () => { if (state.page > 1) { state.page -= 1; load(); } });
el("price-fetch-next").addEventListener("click", () => {
  if (state.page < (state.data?.pagination?.totalPages || 1)) { state.page += 1; load(); }
});
window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
load();
