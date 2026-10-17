(() => {
  "use strict";
  const { api, el, toast } = window.CryptoBuchUI;
  let status, working = false, polling = null;
  const labels = { preparing: window.CryptoBuchI18n.t("Sicherung wird erstellt"), requested: window.CryptoBuchI18n.t("Update angefordert"), accepted: window.CryptoBuchI18n.t("Von Portainer angenommen; neue Version noch nicht bestätigt"), unknown: window.CryptoBuchI18n.t("Ergebnis unklar – Stack in Portainer prüfen"), failed: window.CryptoBuchI18n.t("Update vor der Ausführung abgebrochen"), success: window.CryptoBuchI18n.t("Neue Version erfolgreich gestartet"), reviewed: window.CryptoBuchI18n.t("Deployment-Prüfung bestätigt") };
  function render(value) {
    status = value;
    el("update-status").textContent = window.CryptoBuchI18n.t("Installiert: {p0}. {p1}{p2}", { p0: value.currentVersion, p1: window.CryptoBuchI18n.message(value.checkError) || (value.updateAvailable ? window.CryptoBuchI18n.t("Update verfügbar: {version}.", { version: value.latest.version }) : value.latest ? window.CryptoBuchI18n.t("Keine neuere stabile Version verfügbar.") : window.CryptoBuchI18n.t("Noch nicht auf Updates geprüft.")), p2: value.checkedAt ? window.CryptoBuchI18n.t(" Zuletzt geprüft: {p0}.", { p0: new Date(value.checkedAt).toLocaleString(window.CryptoBuchI18n.locale) }) : "" });
    el("update-configuration").textContent = window.CryptoBuchI18n.message(value.configurationError) || (!value.configured ? window.CryptoBuchI18n.t("Die Portainer-Anbindung ist noch nicht eingerichtet. Versionsprüfung ist bereits möglich.") : value.passwordRequired ? window.CryptoBuchI18n.t("Zum Aktualisieren zuerst den Passwortschutz unter Einstellungen aktivieren.") : window.CryptoBuchI18n.t("Portainer-Anbindung konfiguriert. Vor dem Update wird eine Datenbanksicherung erstellt; das Daten-Volume bleibt bestehen."));
    el("update-attempt").textContent = value.attempt ? window.CryptoBuchI18n.t("{p0} · Ziel {p1}{p2}.", { p0: labels[value.attempt.status] || window.CryptoBuchI18n.t("Status prüfen"), p1: value.attempt.target, p2: value.attempt.backup ? window.CryptoBuchI18n.t(" · Datenbanksicherung: {p0}", { p0: value.attempt.backup }) : "" }) : "";
    el("check-update").disabled = working || value.deploying;
    el("install-update").disabled = working || !value.canInstall;
    el("install-update").textContent = value.deploying ? window.CryptoBuchI18n.t("Aktualisierung läuft …") : window.CryptoBuchI18n.t("Jetzt aktualisieren");
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
        el("update-attempt").textContent = window.CryptoBuchI18n.t("Die Anwendung ist erreichbar. Bitte erneut anmelden, um die gestartete Version zu prüfen.");
        const link = document.createElement("a"); link.href = "/login.html"; link.textContent = window.CryptoBuchI18n.t(" Jetzt anmelden"); el("update-attempt").append(link);
        return;
      }
      if (!response.ok) throw new Error();
      render(await response.json());
    } catch { el("update-attempt").textContent = window.CryptoBuchI18n.t("Anwendung vorübergehend nicht erreichbar. Bei einem Update wird der Status erneut geprüft; bei längerer Unterbrechung den Stack in Portainer prüfen."); }
  }
  el("check-update").addEventListener("click", async () => {
    working = true; if (status) render(status);
    try { render(await api("/api/updates/check", { method: "POST" })); }
    catch (error) { toast(error.message, "error"); }
    finally { working = false; if (status) render(status); }
  });
  el("install-update").addEventListener("click", async () => {
    if (!status?.canInstall || !confirm(window.CryptoBuchI18n.t("CryptoBuch auf Version {p0} aktualisieren? Zuerst wird die Datenbank gesichert. Portainer aktualisiert den Stack; die Anwendung ist kurz nicht erreichbar. Die Datenbanksicherung enthält keine Belegdateien, Sitzungs- oder TLS-Schlüssel. Ein vollständiges Volume-Backup bitte separat vorhalten.", { p0: status.latest.version }))) return;
    working = true; render(status);
    // Start polling before the request: the old container can stop without
    // returning its HTTP response, and that is not proof of success or failure.
    if (!polling) polling = setInterval(load, 5000);
    try { render(await api("/api/updates/install", { method: "POST", body: JSON.stringify({ version: status.latest.version, confirmed: true }) })); }
    catch (error) { toast(error.message || window.CryptoBuchI18n.t("Verbindung unterbrochen. Update-Status wird geprüft."), "error"); }
    finally { working = false; await load(); }
  });
  el("acknowledge-update").addEventListener("click", async () => {
    if (!confirm(window.CryptoBuchI18n.t("Ist in Portainer bestätigt, dass kein Deployment mehr läuft? Diese Aktion hebt nur die lokale Sperre auf und startet kein neues Update."))) return;
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
