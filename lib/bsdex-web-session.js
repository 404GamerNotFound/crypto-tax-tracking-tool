"use strict";

// This adapter owns a separate, ephemeral browser. It never attaches to a
// user's browser profile or reads credentials from another application.
const APP_ORIGIN = "https://app.bsdex.de";
const AUTH_ORIGIN = "https://auth.bsdex.de";
const crypto = require("node:crypto");
const LOGIN_TTL_MS = 10 * 60 * 1000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status, bsdexSafe: true });
const CODE_ATTEMPTS = 5;
const CODE_SELECTOR = '#challenge_tan, input[name="challenge[tan]"], input[name="challenge[code]"], input[autocomplete="one-time-code"]';
const SECURITY_CHECK = /Sicherheitsüberprüfung wird durchgeführt|bestätigen Sie, dass Sie ein Mensch sind|Verify you are human|Checking your browser/i;
const CODE_ERROR = /(?:Code|TAN).*(?:ungültig|abgelaufen|falsch|invalid|expired|incorrect)|(?:ungültig|abgelaufen|falsch|invalid|expired|incorrect).*(?:Code|TAN)/i;
const securityError = () => fail("BSDEX verlangt eine Browser-Sicherheitsprüfung vor der Anmeldung. Der automatische Import-Browser kann sie nicht bestätigen. Bitte später erneut versuchen oder die BSDEX-CSV importieren; eine Anmeldung im persönlichen Browser wird nicht automatisch übernommen.");
const codeField = page => page.locator(CODE_SELECTOR).filter({ visible: true }).first();

async function authForm(page, field, paths) {
  if (new URL(page.url()).origin !== AUTH_ORIGIN) throw fail("Die BSDEX-Anmeldeseite hat sich geändert. Es wurden keine Anmeldedaten übertragen.");
  const form = page.locator("form").filter({ has: field }).first();
  const action = await form.getAttribute("action");
  let target;
  try { target = new URL(action || "", page.url()); } catch { /* rejected below */ }
  if (!target || target.origin !== AUTH_ORIGIN || target.username || target.password || !paths.includes(target.pathname)
    || String(await form.getAttribute("method")).toLowerCase() !== "post") {
    throw fail("Das BSDEX-Anmeldeformular hat sich geändert. Bitte den Anschluss prüfen.");
  }
  return target;
}

async function submitAuthForm(page, field, paths) {
  const target = await authForm(page, field, paths);
  // Observe the new response, not a still-visible error from the previous TAN.
  // No response bodies, request payloads or credentials are recorded.
  const [response] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === target.origin && url.pathname === target.pathname && response.request().method() === "POST";
    }, { timeout: 15000 }),
    field.press("Enter"),
  ]);
  await response.finished();
  await page.waitForLoadState("domcontentloaded");
}

function allowedBsdexRequest(url, method, { authentication = false } = {}) {
  let target;
  try { target = new URL(url); } catch { return false; }
  if (target.protocol !== "https:" || target.username || target.password || target.port) return false;
  if (target.hostname !== "bsdex.de" && !target.hostname.endsWith(".bsdex.de")) return false;
  if (/\/(?:logout|signout|sign_out)(?:\/|$)/i.test(target.pathname)) return false;
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  return authentication && method === "POST" && target.origin === AUTH_ORIGIN
    && ["/oauth/session", "/oauth/multi_factor_auth", "/api/v2/oauth/session", "/api/v2/oauth/multi_factor_auth"].includes(target.pathname);
}

function validateBsdexCredentials(email, password) {
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw fail("Bitte eine gültige BSDEX-E-Mail-Adresse eingeben.");
  }
  if (typeof password !== "string" || !password.length || Buffer.byteLength(password, "utf8") > 1024) {
    throw fail("Bitte das BSDEX-Passwort eingeben (maximal 1024 Bytes).");
  }
}

function requirePrivateLoginTransport(request) {
  // HTTPS may terminate at a local reverse proxy. The global auth middleware
  // checks Origin against Host before this route is reached. Never trust an
  // arbitrary X-Forwarded-Proto header supplied directly by a LAN client.
  const origin = request.get("origin");
  if (request.secure || origin && new URL(origin).protocol === "https:" && new URL(origin).host === request.get("host")) return;
  const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket?.remoteAddress);
  let hostname;
  try { hostname = new URL(`http://${request.get("host")}`).hostname; } catch { /* invalid Host */ }
  if (loopback && ["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return;
  throw fail("BSDEX-Zugangsdaten bitte nur über HTTPS oder direkt über localhost eingeben. Die HTTP-Verbindung im LAN ist dafür nicht geschützt.", 403);
}

async function openBsdexBrowser({ storageState, authentication = false, launch } = {}) {
  let browser;
  try { browser = await (launch || (() => require("playwright").chromium.launch({ headless: true })))(); }
  catch (error) {
    const message = String(error.message).includes("Executable doesn't exist")
      ? "Die lokale Chromium-Komponente fehlt. Auf dem CryptoBuch-Server einmal npx playwright install chromium ausführen oder das Docker-Image neu bauen."
      : "Der lokale Import-Browser konnte nicht gestartet werden. Die Chromium-Installation und Serverberechtigungen prüfen.";
    throw Object.assign(fail(message, 503), { code: "BSDEX_BROWSER_UNAVAILABLE" });
  }
  try {
    const context = await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block", acceptDownloads: true,
      ...(storageState ? { storageState } : {}) });
    context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(30000);
    await context.route("**/*", route => allowedBsdexRequest(route.request().url(), route.request().method(), { authentication }) ? route.continue() : route.abort());
    // No private trading socket is ever connected or forwarded.
    await context.routeWebSocket(/.*/, socket => socket.close());
    const page = await context.newPage();
    return { browser, context, page };
  } catch (error) { await browser.close().catch(() => {}); throw error; }
}

async function bsdexPageState(page) {
  const url = new URL(page.url());
  if (![AUTH_ORIGIN, APP_ORIGIN].includes(url.origin)) return "login_required";
  if (await page.getByText(SECURITY_CHECK).first().isVisible()) return "security_check_required";
  if (url.origin === AUTH_ORIGIN && await codeField(page).isVisible()) return "two_factor_required";
  if (url.origin === AUTH_ORIGIN && await page.getByText("Bitte überprüfen Sie Ihre E-Mails", { exact: true }).isVisible()) return "device_confirmation_required";
  if (url.origin === APP_ORIGIN && await page.getByRole("dialog").filter({ hasText: "Zur Sicherung Ihres BSDEX-Accounts" }).isVisible()) return "device_consent_required";
  if (url.origin === APP_ORIGIN && !/^\/(?:signin|signup)(?:\/|$)/.test(url.pathname)
    && await page.getByText("Historie", { exact: true }).first().isVisible()
    && await page.getByText("Wallet", { exact: true }).first().isVisible()) return "connected";
  return "login_required";
}

async function waitForBsdexLoginResult(page, { confirming = false, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), resultTimeoutMs = 15000 } = {}) {
  for (let i = 0; i < Math.max(1, Math.ceil(resultTimeoutMs / 200)); i++) {
    const state = await bsdexPageState(page);
    if (state === "security_check_required") throw securityError();
    if (["connected", "device_confirmation_required", "device_consent_required"].includes(state)) return state;
    if (state === "two_factor_required" && (!confirming || await page.getByText(CODE_ERROR).first().isVisible())) return state;
    if (await page.getByText(/(?:E-Mail|Passwort|Anmeldedaten).*(?:ungültig|falsch|nicht korrekt)/i).first().isVisible()) {
      throw fail("BSDEX hat die Zugangsdaten nicht bestätigt. Bitte E-Mail-Adresse und Passwort prüfen.");
    }
    await pause(200);
  }
  return bsdexPageState(page);
}

function bsdexConfirmationUrl(value) {
  let url;
  if (typeof value !== "string") throw fail("Bitte den vollständigen BSDEX-Bestätigungslink verwenden.");
  try { url = new URL(value); } catch { throw fail("Bitte den vollständigen BSDEX-Bestätigungslink verwenden."); }
  if (value.length > 4096 || url.origin !== AUTH_ORIGIN || url.username || url.password
    || url.search || url.hash || !/^\/oauth\/device_confirmation\/[A-Za-z0-9_-]+\/confirm$/.test(url.pathname)) {
    throw fail("Dieser Link ist kein unterstützter Gerätebestätigungslink von auth.bsdex.de.");
  }
  return url.href;
}

async function deviceConsentText(page) {
  const text = await page.getByRole("dialog").filter({ hasText: "Zur Sicherung Ihres BSDEX-Accounts" }).innerText();
  if (!text || text.length > 12000) throw fail("Die BSDEX-Geräteerklärung kann nicht vollständig angezeigt werden. Bitte direkt bei BSDEX prüfen.");
  return text;
}

function createBsdexWebLogin({ launch, now = Date.now, ttlMs = LOGIN_TTL_MS, pause, resultTimeoutMs } = {}) {
  const pending = new Map();
  const attempts = new Map();
  let starting = false;
  async function cancel(id) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id); clearTimeout(entry.timer);
    await entry.browser?.close().catch(() => {});
  }
  function status(id) {
    const entry = pending.get(id);
    return entry && entry.expiresAt > now() ? entry.state : "login_required";
  }
  function details(id) {
    const entry = pending.get(id);
    return entry && entry.expiresAt > now() ? { expiresAt: new Date(entry.expiresAt).toISOString(), attemptsRemaining: Math.max(0, CODE_ATTEMPTS - entry.codeAttempts) } : {};
  }
  async function complete(id, entry) {
    if (pending.get(id) !== entry || entry.expiresAt <= now()) throw fail("Die BSDEX-Anmeldung wurde abgebrochen oder ist abgelaufen.");
    // Export only after the authenticated page was positively identified.
    const storageState = await entry.context.storageState();
    if (pending.get(id) !== entry) throw fail("Die BSDEX-Anmeldung wurde abgebrochen.");
    await cancel(id);
    return { status: "connected", storageState, identity: entry.identity };
  }
  async function result(id, entry) {
    if (pending.get(id) !== entry || entry.expiresAt <= now()) throw fail("Die BSDEX-Anmeldung wurde abgebrochen oder ist abgelaufen.");
    entry.state = await bsdexPageState(entry.page);
    if (entry.state === "security_check_required") throw securityError();
    if (entry.state === "connected") return complete(id, entry);
    if (entry.state === "device_consent_required") {
      const consentText = await deviceConsentText(entry.page);
      const consentDigest = crypto.createHash("sha256").update(consentText).digest("hex");
      entry.consentDigest = consentDigest;
      return { status: entry.state, consentText, consentDigest };
    }
    if (!["two_factor_required", "device_confirmation_required"].includes(entry.state)) throw fail("BSDEX-Anmeldung nicht bestätigt.");
    return { status: entry.state };
  }
  async function start(id, { email, password, identity }) {
    validateBsdexCredentials(email, password);
    if (starting || pending.get(id)?.busy || pending.size && !pending.has(id)) throw fail("Eine BSDEX-Anmeldung ist bereits offen. Bitte zuerst abschließen oder abbrechen.", 409);
    for (const [key, attempt] of attempts) if (attempt.until <= now()) attempts.delete(key);
    const prior = attempts.get(id) || { count: 0, until: now() + 15 * 60 * 1000 };
    if (prior.count >= 5 || attempts.size >= 1000 && !attempts.has(id)) throw fail("Zu viele BSDEX-Anmeldeversuche. Bitte nach 15 Minuten erneut versuchen.", 429);
    prior.count++; attempts.set(id, prior);
    starting = true;
    let entry;
    try {
      await cancel(id);
      entry = { identity, state: "starting", expiresAt: now() + ttlMs, codeAttempts: 0 };
      entry.timer = setTimeout(() => { void cancel(id); }, ttlMs); entry.timer.unref?.();
      pending.set(id, entry);
      const instance = await openBsdexBrowser({ authentication: true, launch });
      if (pending.get(id) !== entry) { await instance.browser.close(); throw fail("Anmeldung abgebrochen."); }
      Object.assign(entry, instance);
      const { page } = entry;
      await page.goto(APP_ORIGIN + "/");
      if (await bsdexPageState(page) === "security_check_required") throw securityError();
      if (await page.getByRole("button", { name: "Deny", exact: true }).isVisible()) await page.getByRole("button", { name: "Deny", exact: true }).click();
      if (!await page.locator("#user_email").isVisible()) await page.getByRole("button", { name: "Anmelden", exact: true }).last().click();
      if (await bsdexPageState(page) === "security_check_required") throw securityError();
      await page.locator('#user_email').waitFor({ state: "visible" });
      // Never fill credentials on a redirected or unexpected site.
      await authForm(page, page.locator("#user_password"), ["/oauth/session", "/api/v2/oauth/session"]);
      await page.locator("#user_email").fill(email);
      await page.locator("#user_password").fill(password);
      await submitAuthForm(page, page.locator("#user_password"), ["/oauth/session", "/api/v2/oauth/session"]);
      await waitForBsdexLoginResult(page, { pause, resultTimeoutMs });
      return await result(id, entry);
    } catch (error) {
      const blocked = entry?.page && await bsdexPageState(entry.page).catch(() => "login_required") === "security_check_required";
      await cancel(id);
      if (blocked) throw securityError();
      if (error.bsdexSafe) throw error;
      throw fail("Die BSDEX-Anmeldung konnte nicht abgeschlossen werden. Zugangsdaten, Erreichbarkeit und mögliche Sicherheitsabfragen direkt bei BSDEX prüfen. Es wurde keine Sitzung gespeichert.");
    } finally { starting = false; }
  }
  async function confirm(id, tan) {
    if (typeof tan !== "string" || !/^\d{4,10}$/.test(tan)) throw fail("Bitte den von BSDEX angeforderten 2FA-Code eingeben (4 bis 10 Ziffern).");
    const entry = pending.get(id);
    if (!entry || entry.expiresAt <= now()) { await cancel(id); throw fail("Die BSDEX-Anmeldung ist abgelaufen. Bitte erneut starten."); }
    if (entry.busy) throw fail("Die Bestätigung wird bereits geprüft.", 409);
    entry.busy = true;
    try {
      if (await bsdexPageState(entry.page) !== "two_factor_required") throw fail("Keine offene TAN-Abfrage.");
      if (entry.codeAttempts >= CODE_ATTEMPTS) throw fail("Zu viele Code-Versuche. Bitte erneut anmelden.", 429);
      await authForm(entry.page, codeField(entry.page), ["/oauth/multi_factor_auth", "/api/v2/oauth/multi_factor_auth"]);
      entry.codeAttempts++;
      await codeField(entry.page).fill(tan);
      await submitAuthForm(entry.page, codeField(entry.page), ["/oauth/multi_factor_auth", "/api/v2/oauth/multi_factor_auth"]);
      const next = await waitForBsdexLoginResult(entry.page, { confirming: true, pause, resultTimeoutMs });
      if (next === "two_factor_required") throw fail("BSDEX hat den 2FA-Code nicht bestätigt. Der Code kann ungültig oder abgelaufen sein. Bitte den aktuellen Code erneut eingeben.");
      return await result(id, entry);
    } catch (error) {
      const state = await bsdexPageState(entry.page).catch(() => "login_required");
      if (pending.get(id) === entry && entry.expiresAt > now() && ["connected", "device_confirmation_required", "device_consent_required"].includes(state)) return await result(id, entry);
      if (pending.get(id) === entry && entry.expiresAt > now() && state === "two_factor_required" && entry.codeAttempts < CODE_ATTEMPTS) {
        entry.state = state;
        throw fail(error.bsdexSafe ? error.message : "Der 2FA-Code konnte noch nicht geprüft werden. Die Anmeldung bleibt offen; bitte erneut versuchen.", error.status || 400);
      }
      if (pending.get(id) === entry) await cancel(id);
      if (state === "security_check_required") throw securityError();
      throw fail(entry.codeAttempts >= CODE_ATTEMPTS ? "Zu viele Code-Versuche. Bitte erneut anmelden." : "Die BSDEX-Anmeldung ist abgelaufen oder konnte nicht bestätigt werden. Bitte erneut anmelden.", entry.codeAttempts >= CODE_ATTEMPTS ? 429 : 400);
    } finally {
      try {
        if (pending.get(id) === entry && await codeField(entry.page).isVisible().catch(() => false)) await codeField(entry.page).fill("").catch(() => {});
      } finally { entry.busy = false; }
    }
  }
  async function confirmDevice(id, link) {
    const url = bsdexConfirmationUrl(link);
    const entry = pending.get(id);
    if (!entry || entry.expiresAt <= now() || entry.state !== "device_confirmation_required") throw fail("Keine offene Gerätebestätigung. Bitte erneut anmelden.");
    if (entry.busy) throw fail("Die Bestätigung wird bereits geprüft.", 409);
    entry.busy = true;
    try {
      await entry.page.goto(url);
      await entry.page.getByText("Historie", { exact: true }).first().waitFor({ state: "visible" });
      entry.busy = false;
      return await result(id, entry);
    } catch {
      await cancel(id);
      throw fail("Die Gerätebestätigung konnte nicht abgeschlossen werden. Bitte erneut anmelden; der Bestätigungslink muss zur aktuellen Anmeldung gehören.");
    }
  }
  async function consent(id, { accepted, digest }) {
    const entry = pending.get(id);
    if (!entry || entry.expiresAt <= now() || entry.state !== "device_consent_required") throw fail("Keine offene Geräteprüfung. Bitte erneut anmelden.");
    if (entry.busy) throw fail("Die Bestätigung wird bereits geprüft.", 409);
    entry.busy = true;
    try {
      if (await bsdexPageState(entry.page) !== "device_consent_required") throw fail("Die BSDEX-Geräteprüfung hat sich geändert. Bitte erneut anmelden.");
      const currentText = await deviceConsentText(entry.page);
      if (accepted !== true || !digest || crypto.createHash("sha256").update(currentText).digest("hex") !== digest) throw fail("Die aktuell angezeigten BSDEX-Hinweise müssen ausdrücklich bestätigt werden.");
      const dialog = entry.page.getByRole("dialog").filter({ hasText: "Zur Sicherung Ihres BSDEX-Accounts" });
      await dialog.getByRole("button", { name: "Ich stimme zu", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      entry.busy = false;
      return await result(id, entry);
    } catch (error) {
      entry.busy = false;
      if (error.status === 400) throw error;
      await cancel(id);
      throw fail("Die BSDEX-Geräteprüfung konnte nicht abgeschlossen werden. Bitte direkt bei BSDEX prüfen.");
    }
  }
  return { start, confirm, confirmDevice, consent, cancel, status, details, close: async () => { for (const id of pending.keys()) await cancel(id); } };
}

module.exports = { APP_ORIGIN, allowedBsdexRequest, validateBsdexCredentials, requirePrivateLoginTransport, openBsdexBrowser, bsdexPageState, createBsdexWebLogin, bsdexConfirmationUrl };
