(() => {
  "use strict";
  const { api, el, toast } = window.CryptoBuchUI;
  let status, working = false, polling = null;
  const labels = { preparing: "Sicherung wird erstellt", requested: "Update angefordert", accepted: "Von Portainer angenommen; neue Version noch nicht bestätigt", unknown: "Ergebnis unklar – Stack in Portainer prüfen", failed: "Update vor der Ausführung abgebrochen", success: "Neue Version erfolgreich gestartet", reviewed: "Deployment-Prüfung bestätigt" };
  function render(value) {
    status = value;
    el("update-status").textContent = `Installiert: ${value.currentVersion}. ${value.checkError || (value.updateAvailable ? `Update verfügbar: ${value.latest.version}.` : value.latest ? "Keine neuere stabile Version verfügbar." : "Noch nicht auf Updates geprüft.")}${value.checkedAt ? ` Zuletzt geprüft: ${new Date(value.checkedAt).toLocaleString("de-DE")}.` : ""}`;
    el("update-configuration").textContent = value.configurationError || (!value.configured ? "Die Portainer-Anbindung ist noch nicht eingerichtet. Versionsprüfung ist bereits möglich." : value.passwordRequired ? "Zum Aktualisieren zuerst den Passwortschutz unter Einstellungen aktivieren." : "Portainer-Anbindung konfiguriert. Vor dem Update wird eine Datenbanksicherung erstellt; das Daten-Volume bleibt bestehen.");
    el("update-attempt").textContent = value.attempt ? `${labels[value.attempt.status] || "Status prüfen"} · Ziel ${value.attempt.target}${value.attempt.backup ? ` · Datenbanksicherung: ${value.attempt.backup}` : ""}.` : "";
    el("check-update").disabled = working || value.deploying;
    el("install-update").disabled = working || !value.canInstall;
    el("install-update").textContent = value.deploying ? "Aktualisierung läuft …" : "Jetzt aktualisieren";
    el("update-release").hidden = !value.latest;
    if (value.latest) el("update-release").href = value.latest.url;
    el("update-notes-section").hidden = !value.latest?.notes;
    el("update-notes").textContent = value.latest?.notes || "";
    el("acknowledge-update").hidden = !value.canAcknowledge;
    if (value.deploying && !polling) polling = setInterval(load, 5000);
    if (!value.deploying && polling) { clearInterval(polling); polling = null; }
  }
  async function load() {
    try {
      // A restart invalidates sessions. Avoid redirecting away from the update
      // status silently; let the user explicitly log back in.
      const response = await fetch("/api/updates", { cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (response.status === 401) {
        clearInterval(polling); polling = null;
        el("update-attempt").textContent = "Die Anwendung ist erreichbar. Bitte erneut anmelden, um die gestartete Version zu prüfen.";
        const link = document.createElement("a"); link.href = "/login.html"; link.textContent = " Jetzt anmelden"; el("update-attempt").append(link);
        return;
      }
      if (!response.ok) throw new Error();
      render(await response.json());
    } catch { el("update-attempt").textContent = "Anwendung vorübergehend nicht erreichbar. Bei einem Update wird der Status erneut geprüft; bei längerer Unterbrechung den Stack in Portainer prüfen."; }
  }
  el("check-update").addEventListener("click", async () => {
    working = true; if (status) render(status);
    try { render(await api("/api/updates/check", { method: "POST" })); }
    catch (error) { toast(error.message, "error"); }
    finally { working = false; if (status) render(status); }
  });
  el("install-update").addEventListener("click", async () => {
    if (!status?.canInstall || !confirm(`CryptoBuch auf Version ${status.latest.version} aktualisieren? Zuerst wird die Datenbank gesichert. Portainer aktualisiert den Stack; die Anwendung ist kurz nicht erreichbar. Die Datenbanksicherung enthält keine Belegdateien, Sitzungs- oder TLS-Schlüssel. Ein vollständiges Volume-Backup bitte separat vorhalten.`)) return;
    working = true; render(status);
    // Start polling before the request: the old container can stop without
    // returning its HTTP response, and that is not proof of success or failure.
    if (!polling) polling = setInterval(load, 5000);
    try { render(await api("/api/updates/install", { method: "POST", body: JSON.stringify({ version: status.latest.version, confirmed: true }) })); }
    catch (error) { toast(error.message || "Verbindung unterbrochen. Update-Status wird geprüft.", "error"); }
    finally { working = false; await load(); }
  });
  el("acknowledge-update").addEventListener("click", async () => {
    if (!confirm("Ist in Portainer bestätigt, dass kein Deployment mehr läuft? Diese Aktion hebt nur die lokale Sperre auf und startet kein neues Update.")) return;
    try { render(await api("/api/updates/acknowledge", { method: "POST", body: JSON.stringify({ confirmation: "PORTAINER GEPRÜFT" }) })); }
    catch (error) { toast(error.message, "error"); }
  });
  load().then(async () => {
    if (status && !status.deploying && (!status.checkedAt || Date.now() - Date.parse(status.checkedAt) > 3600000)) {
      try { render(await api("/api/updates/check", { method: "POST" })); }
      catch (error) { toast(error.message, "error"); }
    }
  });
})();
