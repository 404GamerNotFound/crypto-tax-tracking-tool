const { api, cell, el, parseDbDate, toast: showToast } = window.CryptoBuchUI;
const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const state = {};
const RESET_CONFIRMATION = "ALLE DATEN LÖSCHEN";

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
    waiting: "Bereit", queued: "Eingeplant", running: "Läuft", attention: "Prüfen",
    inactive: "Nicht aktiv", connecting: "Verbindet", connected: "Verbunden",
    reconnecting: "Verbindet erneut", success: "Erfolgreich", error: "Fehler",
  })[status] || "Unbekannt";
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
  el("automation-queue-status").textContent = `${automations.queue?.running || 0} läuft · ${automations.queue?.queued || 0} eingeplant`;

  const scheduleList = el("automation-schedule-list");
  scheduleList.replaceChildren(...schedules.map((schedule) => {
    const card = document.createElement("article");
    card.className = "automation-schedule";
    const head = document.createElement("div");
    head.className = "automation-schedule-head";
    const title = document.createElement("h3");
    title.textContent = schedule.label;
    head.append(title, automationState(schedule.status));
    const copy = document.createElement("p");
    copy.textContent = schedule.description;
    const details = document.createElement("dl");
    details.className = "automation-details";
    details.append(
      automationDetail("Abstand", schedule.intervalMinutes ? `alle ${schedule.intervalMinutes} Min.` : "—"),
      automationDetail("Nächster Lauf", readableDate(schedule.nextRunAt, schedule.status === "inactive" ? "nicht aktiv" : "—")),
    );
    if (schedule.lastRun) {
      details.append(
        automationDetail("Letzter Lauf", readableDate(schedule.lastRun.finishedAt || schedule.lastRun.startedAt)),
        automationDetail("Ergebnis", schedule.lastRun.errorMessage ? "Fehler" : `${automationStateLabel(schedule.lastRun.status)} · ${schedule.lastRun.updatedCount || 0} ergänzt`),
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
  if (!schedules.length) scheduleList.append(document.createTextNode("Keine automatischen Läufe eingerichtet."));

  const jobs = automations.queue?.recent || [];
  el("automation-queue-meta").textContent = `${automations.queue?.running || 0} läuft · ${automations.queue?.queued || 0} eingeplant`;
  const jobList = el("automation-job-list");
  jobList.replaceChildren(...jobs.map((job) => {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = `#${job.id} · ${job.label}`;
    const status = document.createElement("td");
    status.append(automationState(job.status));
    const finished = job.errorMessage
      ? `Fehler: ${job.errorMessage}`
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
    el("pending-prices").textContent = status.priceRetry.pending.toLocaleString("de-DE");
    el("retry-status").textContent = status.priceRetry.nextAttemptAt ? `Nächster Retry: ${date.format(parseDbDate(status.priceRetry.nextAttemptAt))}` : "Keine verzögerten Retries";
    el("sync-errors").textContent = status.wallets.filter((wallet) => wallet.last_status === "error").length;
    el("backup-count").textContent = backup.backups.length;
    renderAutomations(automations);

    const wallets = el("wallet-status-list");
    wallets.replaceChildren(...status.wallets.map((wallet) => {
      const row = document.createElement("tr");
      row.append(cell(wallet.label || wallet.address), cell(wallet.chain), cell(wallet.last_synced_at ? date.format(parseDbDate(wallet.last_synced_at)) : "noch nie"), cell(wallet.last_status === "error" ? "Fehler" : wallet.last_status === "success" ? "erfolgreich" : "offen"), cell(wallet.last_status === "success" ? String(wallet.last_imported_count || 0) : "—"), cell(wallet.last_message || "—"));
      return row;
    }));

    const backups = el("backup-list");
    backups.replaceChildren(...backup.backups.map((entry) => {
      const row = document.createElement("tr");
      const action = document.createElement("td");
      const download = document.createElement("a");
      download.className = "text-button";
      download.href = `/api/backups/${encodeURIComponent(entry.name)}/download`;
      download.textContent = "Download";
      const restore = document.createElement("button");
      restore.className = "text-button quality-action";
      restore.textContent = "Wiederherstellen";
      restore.addEventListener("click", () => restoreBackup(entry.name));
      action.append(download, restore);
      row.append(cell(entry.name), cell(date.format(parseDbDate(entry.createdAt))), cell(`${Math.ceil(entry.size / 1024)} KB`), action);
      return row;
    }));
  } catch (error) {
    toast(error.message, true);
  }
}

async function restoreBackup(name) {
  if (!confirm(`Backup ${name} wiederherstellen? Die aktuelle Datenbank wird ersetzt und der Container neu gestartet.`)) return;
  try {
    await api(`/api/backups/${encodeURIComponent(name)}/restore`, { method: "POST" });
    toast("Backup wiederhergestellt. Container startet neu …");
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
    toast(`Backup ${backup.name} erstellt.`);
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
    submit.textContent = "Setzt zurück …";
    await api("/api/data/reset", {
      method: "POST",
      body: JSON.stringify({ confirmation: el("data-reset-confirmation").value }),
    });
    closeResetDialog();
    toast("Lokale Daten gelöscht. Container startet neu …");
    setTimeout(() => { window.location.href = "/"; }, 1200);
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
    submit.textContent = "Endgültig zurücksetzen";
    resetConfirmationState();
  }
});

load();
