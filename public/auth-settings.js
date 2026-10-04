"use strict";
(() => {
  const { api, el, toast } = window.CryptoBuchUI;
  let enabled = false;
  async function load() {
    try {
      const status = await api("/api/auth/status"); enabled = status.enabled;
      el("auth-password-status").textContent = enabled ? "Passwortschutz aktiv. Oberfläche und Daten-APIs erfordern eine Anmeldung." : "Passwortschutz ist ausgeschaltet. Lege ein Passwort fest, um Oberfläche und Daten-APIs zu schützen.";
      el("auth-current-label").hidden = !enabled;
      el("auth-current-password").required = enabled;
      el("auth-disable").hidden = !enabled;
    } catch (error) { toast(error.message, "error"); }
  }
  async function change(disable) {
    const error = el("auth-password-error"); error.hidden = true;
    const password = el("auth-new-password").value;
    if (!disable && password !== el("auth-confirm-password").value) {
      error.textContent = "Die neuen Passwörter stimmen nicht überein."; error.hidden = false; return;
    }
    el("auth-save").disabled = true; el("auth-disable").disabled = true;
    try {
      await api("/api/auth/password", { method: "PUT", body: JSON.stringify({ currentPassword: el("auth-current-password").value, ...(disable ? { disable: true } : { password }) }) });
      el("auth-password-form").reset();
      if (!disable) location.replace("/login.html");
      else { toast("Passwortschutz ausgeschaltet. Der Server ist wieder ohne Anmeldung erreichbar."); await load(); }
    } catch (failure) { error.textContent = failure.message; error.hidden = false; }
    finally { el("auth-save").disabled = false; el("auth-disable").disabled = false; }
  }
  el("auth-password-form").addEventListener("submit", event => { event.preventDefault(); change(false); });
  el("auth-disable").addEventListener("click", () => {
    if (confirm("Passwortschutz ausschalten? Oberfläche und Daten-APIs sind danach ohne Anmeldung erreichbar.")) change(true);
  });
  el("auth-settings-transport").hidden = location.protocol === "https:";
  load();
})();
