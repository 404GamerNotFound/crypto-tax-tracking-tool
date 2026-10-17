"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_REPOSITORY = "404GamerNotFound/crypto-tax-tracking-tool";
const ACTIVE = new Set(["preparing", "requested", "accepted", "unknown"]);
const fail = (message, status = 400) => Object.assign(new Error(message), { status, updateSafe: true });

// Only stable releases are deployable. No lexical ordering, prereleases or tags
// that could turn into image references, paths or shell arguments.
function versionParts(value) {
  if (typeof value !== "string" || !/^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value)) return null;
  return value.replace(/^v/, "").split(".").map(Number);
}
function newer(candidate, installed) {
  const left = versionParts(candidate), right = versionParts(installed);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}
function configuration(env) {
  const repository = env.CRYPTOBUCH_UPDATE_REPOSITORY || DEFAULT_REPOSITORY;
  if (!/^[a-zA-Z0-9_-]{1,100}\/[a-zA-Z0-9_.-]{1,100}$/.test(repository)) throw fail("Update-Repository muss als Eigentümer/Repository angegeben werden.");
  const configured = Boolean(env.CRYPTOBUCH_PORTAINER_URL || env.CRYPTOBUCH_PORTAINER_TOKEN_FILE || env.CRYPTOBUCH_PORTAINER_STACK_ID || env.CRYPTOBUCH_PORTAINER_ENDPOINT_ID);
  if (!configured) return { repository, configured: false };
  let url;
  try { url = new URL(env.CRYPTOBUCH_PORTAINER_URL); } catch { throw fail("Die Portainer-HTTPS-Adresse fehlt oder ist ungültig."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw fail("Portainer benötigt eine HTTPS-Adresse ohne Zugangsdaten oder URL-Parameter.");
  const stackId = env.CRYPTOBUCH_PORTAINER_STACK_ID, endpointId = env.CRYPTOBUCH_PORTAINER_ENDPOINT_ID;
  if (![stackId, endpointId].every(value => /^[1-9]\d{0,8}$/.test(value || ""))) throw fail("Portainer-Stack-ID und Environment-ID müssen konfiguriert sein.");
  if (!env.CRYPTOBUCH_PORTAINER_TOKEN_FILE) throw fail("Die Secret-Datei für den Portainer-API-Token fehlt.");
  return { repository, configured: true, base: url.href.replace(/\/$/, ""), stackId, endpointId, tokenFile: env.CRYPTOBUCH_PORTAINER_TOKEN_FILE };
}
function tokenFromFile(file) {
  try {
    if (fs.statSync(file).size > 4096) throw new Error();
    const token = fs.readFileSync(file, "utf8").trim();
    if (!token || /\s/.test(token)) throw new Error();
    return token;
  } catch { throw fail("Die Portainer-Token-Datei ist nicht lesbar oder ungültig.", 503); }
}
async function boundedJson(response, max = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > max) throw fail("Die Update-Schnittstelle lieferte eine zu große Antwort.", 502);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw fail("Die Update-Schnittstelle lieferte keine gültigen JSON-Daten.", 502); }
}

// Keep the existing Compose document byte-for-byte. The administrator opts in
// by using one dedicated image-tag variable in the CryptoBuch image line.
function deploymentPayload(stack, file, config, target) {
  if (stack.Id !== Number(config.stackId) || stack.EndpointId !== Number(config.endpointId) || stack.Type !== 2) {
    throw fail("Der konfigurierte Stack passt nicht zum Docker-Compose-Environment.", 409);
  }
  if (stack.GitConfig || stack.WorkflowID || stack.WorkflowId || stack.AutoUpdate) throw fail("Dieser Stack wird über Git oder eine Automatik verwaltet. Für UI-Updates zuerst in Portainer auf einen dateibasierten Image-Stack umstellen (siehe Einrichtung).", 409);
  const content = file.StackFileContent;
  const image = `ghcr.io/${config.repository.toLowerCase()}:\${CRYPTOBUCH_IMAGE_TAG}`;
  if (typeof content !== "string" || content.length > 512000
      || content.split("${CRYPTOBUCH_IMAGE_TAG}").length !== 2
      || !content.split(/\r?\n/).some(line => line.trim() === `image: ${image}`)
      || /^\s*build\s*:/m.test(content)) {
    throw fail("Der Stack benötigt das versionierte CryptoBuch-Image mit ${CRYPTOBUCH_IMAGE_TAG} und darf kein build: enthalten (siehe Einrichtung).", 409);
  }
  if (!Array.isArray(stack.Env) || stack.Env.some(entry => typeof entry.name !== "string" || typeof entry.value !== "string")) throw fail("Die Portainer-Umgebungsvariablen konnten nicht sicher übernommen werden.", 502);
  return { StackFileContent: content, Env: [...stack.Env.filter(entry => entry.name !== "CRYPTOBUCH_IMAGE_TAG"), { name: "CRYPTOBUCH_IMAGE_TAG", value: target }],
    Prune: false, PullImage: true, RepullImageAndRedeploy: true };
}

function createApplicationUpdates({ dataDir, version, env = process.env, fetchImpl = (...args) => fetch(...args), now = Date.now, backup, busy = () => false, protectedMode = () => false, resume = () => {} }) {
  const stateFile = path.join(dataDir, "application-update.json");
  let config, configError = null;
  try { config = configuration(env); } catch (error) { configError = error.message; config = { repository: DEFAULT_REPOSITORY, configured: false }; }
  let attempt = null, stateError = null, release = null, checkedAt = null, checkError = null, checkFlight = null, installing = false;
  let lastCheck = -Infinity;
  function save(value) {
    const temporary = `${stateFile}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, stateFile); attempt = value;
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  try {
    if (fs.existsSync(stateFile)) {
      if (fs.statSync(stateFile).size > 16384) throw new Error();
      const stored = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (!versionParts(stored.target) || ![...ACTIVE, "failed", "success", "reviewed"].includes(stored.status) || !Number.isFinite(Date.parse(stored.startedAt))) throw new Error();
      // Whitelist fields: persistence is never a route for arbitrary data to UI.
      attempt = { target: stored.target, status: stored.status, startedAt: stored.startedAt,
        backup: /^cryptobuch-\d{8}-\d{6}\.sqlite$/.test(stored.backup || "") ? stored.backup : null };
      if (ACTIVE.has(attempt.status)) save({ ...attempt, status: versionParts(version)?.join(".") === attempt.target ? "success" : "unknown" });
    }
  } catch { stateError = "Der gespeicherte Update-Status ist nicht lesbar. application-update.json im Datenverzeichnis prüfen; Updates sind gesperrt."; }

  const isDeploying = () => installing || Boolean(attempt && ACTIVE.has(attempt.status));
  function status() {
    return { currentVersion: version, repository: config.repository, configured: config.configured, configurationError: configError || stateError,
      passwordRequired: !protectedMode(), checkedAt, checkError, latest: release,
      updateAvailable: Boolean(release && newer(release.version, version)),
      canInstall: Boolean(config.configured && !configError && !stateError && protectedMode() && !isDeploying() && !checkError && release && newer(release.version, version)),
      deploying: isDeploying(), attempt,
      canAcknowledge: Boolean(!installing && attempt && ACTIVE.has(attempt.status) && now() - Date.parse(attempt.startedAt) >= 15 * 60 * 1000) };
  }
  async function check() {
    if (checkFlight) return checkFlight;
    if (now() - lastCheck < 60000) return status();
    lastCheck = now();
    checkFlight = (async () => {
      try {
        const response = await fetchImpl(`https://api.github.com/repos/${config.repository}/releases/latest`, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "CryptoBuch-updates" }, redirect: "error", signal: AbortSignal.timeout(15000),
        });
        if (response.status === 404) throw fail("Kein öffentliches stabiles Release gefunden. Ein privates Repository oder fehlende Releases können die Ursache sein.");
        if (!response.ok) throw fail(`Versionsprüfung nicht möglich (GitHub HTTP ${response.status}).`);
        const value = await boundedJson(response);
        if (value.draft || value.prerelease || !versionParts(value.tag_name)) throw fail("Das veröffentlichte Release hat keine unterstützte stabile Versionsnummer.");
        release = { version: versionParts(value.tag_name).join("."), tag: value.tag_name,
          url: `https://github.com/${config.repository}/releases/tag/${encodeURIComponent(value.tag_name)}`,
          notes: typeof value.body === "string" ? value.body.slice(0, 6000) : "" };
        checkError = null;
      } catch (error) {
        release = null;
        checkError = error.status ? error.message : "Die Versionsprüfung ist fehlgeschlagen. Netzwerkzugang und GitHub-Verfügbarkeit prüfen.";
      }
      checkedAt = new Date(now()).toISOString();
      return status();
    })();
    try { return await checkFlight; } finally { checkFlight = null; }
  }
  async function portainer(suffix, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${config.base}/api/stacks/${config.stackId}${suffix}`, {
        ...options, headers: { "X-API-Key": tokenFromFile(config.tokenFile), "Content-Type": "application/json" },
        redirect: "error", signal: AbortSignal.timeout(options.method ? 90000 : 15000),
      });
    } catch { throw fail("Portainer ist nicht erreichbar oder das TLS-Zertifikat wird nicht vertraut. Verbindung und CA-Einrichtung prüfen.", 502); }
    if (!response.ok) throw fail(`Portainer meldet HTTP ${response.status}. Berechtigungen, Stack und Deployment-Status in Portainer prüfen.`, 502);
    return response;
  }
  async function install(target) {
    if (isDeploying()) throw fail("Ein Update läuft bereits oder sein Ergebnis muss zuerst in Portainer geprüft werden.", 409);
    if (!config.configured || configError || stateError) throw fail(configError || stateError || "Die Portainer-Anbindung ist noch nicht eingerichtet.", 409);
    if (!protectedMode()) throw fail("Für Updates muss der Passwortschutz aktiviert sein.", 403);
    if (!versionParts(target) || target !== versionParts(target).join(".")) throw fail("Ungültige Zielversion.");
    installing = true;
    let sent = false;
    try {
      await check();
      if (checkError || !release || release.version !== target || !newer(target, version)) throw fail("Die gewählte Version ist nicht mehr als neueres stabiles Release bestätigt. Bitte erneut prüfen.", 409);
      const stack = await boundedJson(await portainer(""));
      const file = await boundedJson(await portainer("/file"));
      const payload = deploymentPayload(stack, file, config, target);
      if (busy()) throw fail("Ein Hintergrundjob läuft noch. Bitte nach dessen Abschluss erneut aktualisieren.", 409);
      save({ target, status: "preparing", startedAt: new Date(now()).toISOString(), backup: null });
      let snapshot;
      try { snapshot = await backup(); } catch { throw fail("Die Datenbanksicherung ist fehlgeschlagen. Es wurde kein Update ausgelöst.", 500); }
      save({ ...attempt, backup: snapshot.name, status: "requested" });
      sent = true;
      const response = await portainer(`?endpointId=${config.endpointId}`, { method: "PUT", body: JSON.stringify(payload) });
      // Portainer may reply before redeployment or terminate this process while
      // responding. Only the next process with the target version means success.
      if (response.body) await response.body.cancel();
      save({ ...attempt, status: "accepted" });
      return status();
    } catch (error) {
      if (attempt && ACTIVE.has(attempt.status)) save({ ...attempt, status: sent ? "unknown" : "failed" });
      if (sent) throw fail("Das Ergebnis des Update-Auftrags ist unklar. Bitte den Stack in Portainer prüfen; der Auftrag wird nicht automatisch wiederholt.", 502);
      throw error;
    } finally { installing = false; if (!isDeploying()) resume(); }
  }
  function acknowledge() {
    if (!status().canAcknowledge) throw fail("Der Update-Status kann erst nach 15 Minuten und nach Abschluss der Anfrage freigegeben werden.", 409);
    save({ ...attempt, status: "reviewed" }); resume(); return status();
  }
  return { status, check, install, acknowledge, isDeploying };
}

module.exports = { createApplicationUpdates, versionParts, newer, configuration, deploymentPayload };
