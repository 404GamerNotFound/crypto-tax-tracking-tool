"use strict";

window.BsdexWeb = (() => {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<form id="bsdex-login-form">
    <div class="modal-head"><div><p class="eyebrow">BSDEX · WEB-IMPORT</p><h2>Bei BSDEX anmelden</h2></div><button class="modal-close" type="button" aria-label="Anmeldung schließen">×</button></div>
    <p class="modal-copy" id="bsdex-login-copy"></p>
    <div id="bsdex-credentials" class="bsdex-login-fields"><label><span>BSDEX-E-Mail-Adresse</span><input id="bsdex-email" type="email" maxlength="254" autocomplete="username" /></label><label><span>Passwort · wird nicht gespeichert</span><input id="bsdex-password" type="password" maxlength="1024" autocomplete="current-password" /></label></div>
    <label id="bsdex-tan-field" hidden><span>SMS-TAN · wird nicht gespeichert</span><input id="bsdex-tan" type="text" inputmode="numeric" pattern="[0-9]{4,10}" maxlength="10" autocomplete="one-time-code" /></label>
    <label id="bsdex-link-field" hidden><span>BSDEX-Bestätigungslink aus der E-Mail</span><input id="bsdex-link" type="password" maxlength="4096" autocomplete="off" /><small>Den Link hier einfügen, damit er im selben Import-Browser geöffnet wird. Er wird nicht gespeichert.</small></label>
    <div id="bsdex-consent-field" hidden><p id="bsdex-consent-text"></p><label class="exchange-trade-republic-consent"><input id="bsdex-consent-accepted" type="checkbox" /><span>Ich habe die angezeigte BSDEX-Erklärung gelesen und stimme der darin beschriebenen Geräteprüfung und Datenübermittlung zu.</span></label></div>
    <p class="form-error" id="bsdex-login-error" hidden></p>
    <div class="modal-actions"><button class="button button-primary" id="bsdex-login-submit" type="submit">Anmelden</button></div>
  </form>`;
  document.body.append(dialog);
  const field = id => dialog.querySelector("#" + id);
  let connectionId = null, stage = "login_required", consentDigest = "", onComplete, busy = false, opening = false, generation = 0;
  const labels = {
    login_required: ["E-Mail und Passwort werden einmalig für die Anmeldung bei BSDEX verwendet. Dafür ist HTTPS oder localhost erforderlich.", "Anmelden"],
    two_factor_required: ["Gib die SMS-TAN für diese Anmeldung ein.", "TAN bestätigen"],
    device_confirmation_required: ["BSDEX hat eine E-Mail zur Gerätebestätigung versendet. Kopiere den darin enthaltenen BSDEX-Link in das Feld. Der lokale Import-Browser öffnet ihn für diese Anmeldung.", "Gerät bestätigen"],
    device_consent_required: ["BSDEX fordert eine zusätzliche Zustimmung. Prüfe die vollständige Erklärung unten. Ohne deine ausdrückliche Zustimmung wird sie nicht bestätigt.", "BSDEX-Zustimmung bestätigen"],
  };
  function render(result) {
    stage = result.bsdexWeb?.status || "login_required";
    if (!labels[stage]) stage = "login_required";
    field("bsdex-login-copy").textContent = labels[stage][0];
    field("bsdex-login-submit").textContent = labels[stage][1];
    for (const [id, active] of [["bsdex-credentials", stage === "login_required"], ["bsdex-tan-field", stage === "two_factor_required"], ["bsdex-link-field", stage === "device_confirmation_required"], ["bsdex-consent-field", stage === "device_consent_required"]]) {
      field(id).hidden = !active;
      for (const input of field(id).querySelectorAll("input")) { input.disabled = !active; input.required = active; }
    }
    consentDigest = result.consentDigest || "";
    field("bsdex-consent-text").textContent = result.consentText || "";
    field("bsdex-consent-accepted").checked = false;
  }
  async function call(action, body = {}, id = connectionId) {
    const response = await fetch(`/api/exchange-connections/${id}/bsdex/web-login/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-CryptoBuch-Request": "1" }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Die BSDEX-Anmeldung ist fehlgeschlagen.");
    return result;
  }
  function clearInputs() {
    for (const input of dialog.querySelectorAll("input")) { input.value = ""; input.checked = false; }
  }
  function closeLogin() {
    const id = connectionId;
    connectionId = null; generation++; busy = false;
    clearInputs(); dialog.close();
    if (id !== null) void call("cancel", {}, id).catch(() => {});
  }
  dialog.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return;
    if (!window.isSecureContext || !["https:", "http:"].includes(location.protocol)) {
      field("bsdex-login-error").textContent = "Bitte CryptoBuch über HTTPS oder localhost öffnen. Zugangsdaten werden über diese ungeschützte Verbindung nicht gesendet.";
      field("bsdex-login-error").hidden = false; return;
    }
    busy = true; field("bsdex-login-submit").disabled = true; field("bsdex-login-error").hidden = true;
    const current = generation;
    try {
      let result;
      if (stage === "two_factor_required") result = await call("confirm", { tan: field("bsdex-tan").value });
      else if (stage === "device_confirmation_required") result = await call("device", { link: field("bsdex-link").value });
      else if (stage === "device_consent_required") result = await call("consent", { accepted: field("bsdex-consent-accepted").checked, digest: consentDigest });
      else result = await call("start", { email: field("bsdex-email").value, password: field("bsdex-password").value });
      if (current !== generation) return;
      if (result.bsdexWeb?.status === "connected") { const completed = onComplete; connectionId = null; closeLogin(); await completed?.(); }
      else render(result);
    } catch (error) {
      if (current !== generation) return;
      field("bsdex-login-error").textContent = error.message; field("bsdex-login-error").hidden = false;
      render({ bsdexWeb: { status: "login_required" } });
    } finally {
      if (current === generation) {
        for (const id of ["bsdex-password", "bsdex-tan", "bsdex-link"]) field(id).value = "";
        busy = false; field("bsdex-login-submit").disabled = false;
      }
    }
  });
  dialog.querySelector(".modal-close").addEventListener("click", closeLogin);
  dialog.addEventListener("cancel", event => { event.preventDefault(); closeLogin(); });
  dialog.addEventListener("close", () => { if (!dialog.open && connectionId !== null) closeLogin(); });
  return { open: async (connection, completed) => {
    if (opening || dialog.open) return;
    opening = true;
    try {
      connectionId = connection.id; onComplete = completed; generation++; busy = false;
      clearInputs();
      // Reopening starts a fresh explicit login; no TAN/link is ever restored.
      await call("cancel");
      render({ bsdexWeb: { status: "login_required" } });
      field("bsdex-login-error").hidden = true; field("bsdex-login-submit").disabled = false;
      dialog.showModal(); field("bsdex-email").focus();
    } finally { opening = false; }
  } };
})();
