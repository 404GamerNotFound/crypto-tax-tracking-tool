const { api, cell, el, parseDbDate, toast: showToast } = window.CryptoBuchUI;
const date = new Intl.DateTimeFormat(window.CryptoBuchI18n.locale, { dateStyle: "medium", timeStyle: "short" });
const state = {};
const RESET_CONFIRMATION = window.CryptoBuchI18n.t("ALLE DATEN LÖSCHEN");

function toast(message, error = false) {
  showToast(message, error ? "error" : "success", { duration: 5000 });
}

function readableDate(value, fallback = "—") {
  if (!value) return fallback;
  const parsed = parseDbDate(value);
  return parsed ? date.format(parsed) : fallback;
}

function automationStateLabel(status) {
  return ({
    waiting: window.CryptoBuchI18n.t("Bereit"), queued: window.CryptoBuchI18n.t("Eingeplant"), running: window.CryptoBuchI18n.t("Läuft"), attention: window.CryptoBuchI18n.t("Prüfen"),
    inactive: window.CryptoBuchI18n.t("Nicht aktiv"), connecting: window.CryptoBuchI18n.t("Verbindet"), connected: window.CryptoBuchI18n.t("Verbunden"),
    reconnecting: window.CryptoBuchI18n.t("Verbindet erneut"), success: window.CryptoBuchI18n.t("Erfolgreich"), error: window.CryptoBuchI18n.t("Fehler"),
  })[status] || window.CryptoBuchI18n.t("Unbekannt");
}

function automationState(status) {
  const badge = document.createElement("span");
  badge.className = `automation-state ${status || "waiting"}`;
  badge.textContent = automationStateLabel(status);
  return badge;
}

function automationDetail(label, value) {
  const item = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  item.append(term, description);
  return item;
}

function renderAutomations(automations) {
  state.automations = automations;
  const schedules = automations.schedules || [];
  const active = schedules.filter((schedule) => schedule.status !== "inactive").length;
  el("automation-active-count").textContent = String(active);
  el("automation-queue-status").textContent = window.CryptoBuchI18n.t("{p0} läuft · {p1} eingeplant", { p0: automations.queue?.running || 0, p1: automations.queue?.queued || 0 });

  const scheduleList = el("automation-schedule-list");
  scheduleList.replaceChildren(...schedules.map((schedule) => {
    const card = document.createElement("article");
    card.className = "automation-schedule";
    const head = document.createElement("div");
    head.className = "automation-schedule-head";
    const title = document.createElement("h3");
    title.textContent = window.CryptoBuchI18n.message(schedule.label);
    head.append(title, automationState(schedule.status));
    const copy = document.createElement("p");
    copy.textContent = window.CryptoBuchI18n.message(schedule.description);
    const details = document.createElement("dl");
    details.className = "automation-details";
    details.append(
      automationDetail(window.CryptoBuchI18n.t("Abstand"), schedule.intervalMinutes ? window.CryptoBuchI18n.t("alle {p0} Min.", { p0: schedule.intervalMinutes }) : "—"),
      automationDetail(window.CryptoBuchI18n.t("Nächster Lauf"), readableDate(schedule.nextRunAt, schedule.status === "inactive" ? window.CryptoBuchI18n.t("nicht aktiv") : "—")),
    );
    if (schedule.lastRun) {
      details.append(
        automationDetail(window.CryptoBuchI18n.t("Letzter Lauf"), readableDate(schedule.lastRun.finishedAt || schedule.lastRun.startedAt)),
        automationDetail(window.CryptoBuchI18n.t("Ergebnis"), schedule.lastRun.errorMessage ? window.CryptoBuchI18n.t("Fehler") : window.CryptoBuchI18n.t("{p0} · {p1} ergänzt", { p0: automationStateLabel(schedule.lastRun.status), p1: schedule.lastRun.updatedCount || 0 })),
      );
    }
    card.append(head, copy, details);
    if (schedule.connections?.length) {
      const connections = document.createElement("ul");
      connections.className = "automation-connection-list";
      for (const connection of schedule.connections) {
        const row = document.createElement("li");
        const label = document.createElement("strong");
        label.textContent = connection.label;
        const meta = document.createElement("small");
        meta.textContent = `${automationStateLabel(connection.status)} · ${readableDate(connection.nextRunAt)}`;
        row.append(label, meta);
        connections.append(row);
      }
      card.append(connections);
    }
    const firstError = schedule.connections?.find((connection) => connection.lastError)?.lastError || schedule.lastRun?.errorMessage;
    if (firstError) {
      const error = document.createElement("p");
      error.className = "automation-error";
      error.textContent = firstError;
      card.append(error);
    }
    return card;
  }));
  if (!schedules.length) scheduleList.append(document.createTextNode(window.CryptoBuchI18n.t("Keine automatischen Läufe eingerichtet.")));

  const jobs = automations.queue?.recent || [];
  el("automation-queue-meta").textContent = window.CryptoBuchI18n.t("{p0} läuft · {p1} eingeplant", { p0: automations.queue?.running || 0, p1: automations.queue?.queued || 0 });
  const jobList = el("automation-job-list");
  jobList.replaceChildren(...jobs.map((job) => {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = `#${job.id} · ${window.CryptoBuchI18n.message(job.label)}`;
    if (job.sourceLabel) {
      const source = document.createElement(job.sourceType === "exchange" ? "a" : "span");
      source.textContent = job.sourceLabel;
      if (job.sourceType === "exchange") source.href = `/exchange.html?id=${encodeURIComponent(job.sourceId)}`;
      name.append(document.createElement("br"), source);
    }
    const status = document.createElement("td");
    status.append(automationState(job.status));
    const finished = job.errorMessage
      ? window.CryptoBuchI18n.t("Fehler: {p0}", { p0: job.errorMessage })
      : job.finishedAt ? readableDate(job.finishedAt)
        : job.progressTotal > 1 ? `${job.progressCurrent}/${job.progressTotal}` : "—";
    row.append(name, status, cell(readableDate(job.createdAt)), cell(readableDate(job.startedAt)), cell(finished));
    return row;
  }));
  el("automation-job-empty").hidden = jobs.length > 0;
}

async function load() {
  try {
    const [status, backup, automations] = await Promise.all([api("/api/system-status"), api("/api/backups"), api("/api/system-status/automations")]);
    state.status = status;
    state.backups = backup.backups;
    el("pending-prices").textContent = status.priceRetry.pending.toLocaleString(window.CryptoBuchI18n.locale);
    el("retry-status").textContent = status.priceRetry.nextAttemptAt ? window.CryptoBuchI18n.t("Nächster Retry: {p0}", { p0: date.format(parseDbDate(status.priceRetry.nextAttemptAt)) }) : window.CryptoBuchI18n.t("Keine verzögerten Retries");
    el("sync-errors").textContent = status.wallets.filter((wallet) => wallet.last_status === "error").length;
    el("backup-count").textContent = backup.backups.length;
    renderAutomations(automations);

    const wallets = el("wallet-status-list");
    wallets.replaceChildren(...status.wallets.map((wallet) => {
      const row = document.createElement("tr");
      row.append(cell(wallet.label || wallet.address), cell(wallet.chain), cell(wallet.last_synced_at ? date.format(parseDbDate(wallet.last_synced_at)) : window.CryptoBuchI18n.t("noch nie")), cell(wallet.last_status === "error" ? window.CryptoBuchI18n.t("Fehler") : wallet.last_status === "success" ? "erfolgreich" : window.CryptoBuchI18n.t("offen")), cell(wallet.last_status === "success" ? String(wallet.last_imported_count || 0) : "—"), cell(wallet.last_message || "—"));
      return row;
    }));

    const backups = el("backup-list");
    backups.replaceChildren(...backup.backups.map((entry) => {
      const row = document.createElement("tr");
      const action = document.createElement("td");
      const download = document.createElement("a");
      download.className = "text-button";
      download.href = `/api/backups/${encodeURIComponent(entry.name)}/download`;
      download.textContent = window.CryptoBuchI18n.t("Download");
      const restore = document.createElement("button");
      restore.className = "text-button quality-action";
      restore.textContent = window.CryptoBuchI18n.t("Wiederherstellen");
      restore.addEventListener("click", () => restoreBackup(entry.name));
      action.append(download, restore);
      row.append(cell(entry.name), cell(date.format(parseDbDate(entry.createdAt))), cell(window.CryptoBuchI18n.t("{p0} KB", { p0: Math.ceil(entry.size / 1024) })), action);
      return row;
    }));
  } catch (error) {
    toast(error.message, true);
  }
}

async function restoreBackup(name) {
  if (!confirm(window.CryptoBuchI18n.t("Backup {p0} wiederherstellen? Die aktuelle Datenbank wird ersetzt und der Container neu gestartet.", { p0: name }))) return;
  try {
    await api(`/api/backups/${encodeURIComponent(name)}/restore`, { method: "POST" });
    toast(window.CryptoBuchI18n.t("Backup wiederhergestellt. Container startet neu …"));
  } catch (error) {
    toast(error.message, true);
  }
}

function closeResetDialog() {
  el("data-reset-dialog").close();
}

function resetConfirmationState() {
  el("submit-data-reset").disabled = el("data-reset-confirmation").value.trim() !== RESET_CONFIRMATION;
}

function openResetDialog() {
  const error = el("data-reset-error");
  error.hidden = true;
  el("data-reset-confirmation").value = "";
  resetConfirmationState();
  el("data-reset-dialog").showModal();
  el("data-reset-confirmation").focus();
}

el("create-backup").addEventListener("click", async () => {
  try {
    const backup = await api("/api/backups", { method: "POST" });
    toast(window.CryptoBuchI18n.t("Backup {p0} erstellt.", { p0: backup.name }));
    load();
  } catch (error) {
    toast(error.message, true);
  }
});

el("reload-status").addEventListener("click", load);
el("reload-automations").addEventListener("click", load);
el("open-data-reset").addEventListener("click", openResetDialog);
el("close-data-reset").addEventListener("click", closeResetDialog);
el("cancel-data-reset").addEventListener("click", closeResetDialog);
el("data-reset-confirmation").addEventListener("input", resetConfirmationState);
el("data-reset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = el("data-reset-error");
  const submit = el("submit-data-reset");
  error.hidden = true;
  try {
    submit.disabled = true;
    submit.textContent = window.CryptoBuchI18n.t("Setzt zurück …");
    await api("/api/data/reset", {
      method: "POST",
      body: JSON.stringify({ confirmation: "ALLE DATEN LÖSCHEN" }),
    });
    closeResetDialog();
    toast(window.CryptoBuchI18n.t("Lokale Daten gelöscht. Container startet neu …"));
    setTimeout(() => { window.location.href = "/"; }, 1200);
  } catch (requestError) {
    error.textContent = window.CryptoBuchI18n.message(requestError.message);
    error.hidden = false;
    submit.textContent = window.CryptoBuchI18n.t("Endgültig zurücksetzen");
    resetConfirmationState();
  }
});

load();
