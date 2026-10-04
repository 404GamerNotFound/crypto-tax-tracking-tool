"use strict";
const form = document.getElementById("login-form");
const error = document.getElementById("login-error");
document.getElementById("auth-transport-note").hidden = location.protocol === "https:";
fetch("/api/auth/status", { cache: "no-store" }).then(response => response.json()).then(status => {
  if (status.authenticated) location.replace("/");
}).catch(() => { error.hidden = false; error.textContent = "Server ist momentan nicht erreichbar."; });
form.addEventListener("submit", async event => {
  event.preventDefault();
  const button = form.querySelector("button"); button.disabled = true; error.hidden = true;
  try {
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "X-CryptoBuch-Request": "1" }, body: JSON.stringify({ password: document.getElementById("login-password").value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Anmeldung fehlgeschlagen.");
    form.reset(); location.replace("/");
  } catch (failure) { error.textContent = failure.message; error.hidden = false; }
  finally { button.disabled = false; }
});
