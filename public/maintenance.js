const el = (id) => document.getElementById(id);
const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const state = {};
const RESET_CONFIRMATION = "ALLE DATEN LÖSCHEN";

const parseDbDate = (value) => new Date(String(value).includes("T") ? value : `${value}Z`);

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Vorgang fehlgeschlagen.");
  return payload;
}

function toast(message, error = false) {
  const node = el("toast");
  node.textContent = message;
  node.className = `toast${error ? " error" : ""}`;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 5000);
}

function cell(value) {
  const node = document.createElement("td");
  node.textContent = value;
  return node;
}

async function load() {
  try {
    const [status, backup] = await Promise.all([api("/api/system-status"), api("/api/backups")]);
    state.status = status;
    state.backups = backup.backups;
    el("pending-prices").textContent = status.priceRetry.pending.toLocaleString("de-DE");
    el("retry-status").textContent = status.priceRetry.nextAttemptAt ? `Nächster Retry: ${date.format(parseDbDate(status.priceRetry.nextAttemptAt))}` : "Keine verzögerten Retries";
    el("sync-errors").textContent = status.wallets.filter((wallet) => wallet.last_status === "error").length;
    el("backup-count").textContent = backup.backups.length;

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
