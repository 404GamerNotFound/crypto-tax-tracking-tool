"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const COOKIE = "cryptobuch_session";
const SESSION_MS = 12 * 60 * 60 * 1000;
const HASH_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > 1024) {
    throw fail("Das Passwort muss mindestens 12 Zeichen haben und darf höchstens 1024 UTF-8-Bytes lang sein.");
  }
}
async function passwordRecord(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(32).toString("hex");
  const hash = await scrypt(password, salt, 64, HASH_OPTIONS);
  return { version: 1, salt, hash: hash.toString("hex") };
}
async function matches(password, record) {
  if (!record || typeof password !== "string" || Buffer.byteLength(password, "utf8") > 1024) return false;
  const value = await scrypt(password, record.salt, 64, HASH_OPTIONS);
  return crypto.timingSafeEqual(value, Buffer.from(record.hash, "hex"));
}
function writeRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function readRecord(file) {
  if (!fs.existsSync(file)) return null;
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value?.disabled === true && value.version === 1) return null;
  if (value?.version !== 1 || !/^[a-f0-9]{64}$/.test(value.salt) || !/^[a-f0-9]{128}$/.test(value.hash)) {
    throw new Error("Ungültige CryptoBuch-Zugangskonfiguration. Serverstart abgebrochen.");
  }
  return value;
}

function createAuth({ dataDir, passwordFile = process.env.CRYPTOBUCH_PASSWORD_FILE, now = Date.now, sessionMs = SESSION_MS }) {
  const file = path.join(dataDir, "auth.json");
  let record = readRecord(file);
  // Bootstrap happens once. Subsequent password changes remain authoritative.
  if (!fs.existsSync(file) && passwordFile) {
    const password = fs.readFileSync(passwordFile, "utf8").replace(/\r?\n$/, "");
    validatePassword(password);
    const salt = crypto.randomBytes(32).toString("hex");
    record = { version: 1, salt, hash: crypto.scryptSync(password, salt, 64, HASH_OPTIONS).toString("hex") };
    writeRecord(file, record);
  }
  const sessions = new Map();
  const attempts = new Map();
  let activeChecks = 0;
  let changing = false;
  const digest = value => crypto.createHash("sha256").update(value).digest("hex");
  function tokenFrom(request) {
    const authorization = request.get("authorization");
    if (authorization) return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    return String(request.get("cookie") || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
  }
  function validSession(request) {
    const token = tokenFrom(request);
    if (!/^[a-f0-9]{64}$/.test(token)) return false;
    const key = digest(token), expiry = sessions.get(key);
    if (!expiry || expiry <= now()) { sessions.delete(key); return false; }
    return true;
  }
  function sameOrigin(request) {
    const origin = request.get("origin");
    if (!origin) return;
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || url.host !== request.get("host") || url.username || url.password) throw new Error();
    } catch { throw fail("Anfrage von einer fremden Website abgelehnt.", 403); }
  }
  function safeWrite(request) {
    sameOrigin(request);
    if (!request.get("origin") && !request.get("authorization") && request.get("x-cryptobuch-request") !== "1") {
      throw fail("Für diese Anfrage fehlt der CryptoBuch-Anfrageschutz.", 403);
    }
  }
  function cookieOptions(request) {
    // TLS termination at a reverse proxy: the browser's Origin is checked above.
    const secure = request.secure || request.get("origin")?.startsWith("https://") || process.env.CRYPTOBUCH_SECURE_COOKIE === "true";
    return { httpOnly: true, sameSite: "strict", secure: Boolean(secure), path: "/" };
  }
  function issue(request, response) {
    for (const [key, expiry] of sessions) if (expiry <= now()) sessions.delete(key);
    if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(digest(token), now() + sessionMs);
    response.cookie(COOKIE, token, { ...cookieOptions(request), maxAge: sessionMs });
    return { token, expiresAt: new Date(now() + sessionMs).toISOString() };
  }
  async function verifyLimited(request, password) {
    const time = now();
    for (const [key, entry] of attempts) if (entry.until <= time) attempts.delete(key);
    const key = request.ip || "unknown";
    const entry = attempts.get(key) || { count: 0, until: time + 15 * 60 * 1000 };
    if (entry.count >= 10 || activeChecks >= 2 || attempts.size >= 2000 && !attempts.has(key)) {
      throw fail("Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.", 429);
    }
    entry.count += 1; attempts.set(key, entry); activeChecks += 1;
    const expected = record;
    try {
      const ok = await matches(password, expected);
      if (!ok || record !== expected) throw fail("Das Passwort ist nicht korrekt.", 401);
      attempts.delete(key);
    } finally { activeChecks -= 1; }
  }
  function register(app) {
    app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
    app.get("/api/auth/status", (request, response) => response.json({ enabled: Boolean(record), authenticated: !record || validSession(request) }));
    app.post("/api/auth/login", async (request, response, next) => {
      try {
        safeWrite(request);
        if (!record) throw fail("Passwortschutz ist nicht aktiviert.", 409);
        await verifyLimited(request, request.body?.password);
        response.json({ authenticated: true, ...issue(request, response) });
      } catch (error) { next(error); }
    });
    app.post("/api/auth/logout", (request, response, next) => {
      try {
        safeWrite(request);
        sessions.delete(digest(tokenFrom(request)));
        response.clearCookie(COOKIE, cookieOptions(request));
        response.json({ authenticated: false });
      } catch (error) { next(error); }
    });
    app.put("/api/auth/password", async (request, response, next) => {
      let ownsLock = false;
      try {
        safeWrite(request);
        if (record && !validSession(request)) throw fail("Bitte zuerst anmelden.", 401);
        if (changing) throw fail("Eine Passwortänderung läuft bereits.", 409);
        changing = true; ownsLock = true;
        if (record) await verifyLimited(request, request.body?.currentPassword);
        const { password, disable } = request.body || {};
        if (disable !== undefined && typeof disable !== "boolean") throw fail("Ungültige Auswahl für den Passwortschutz.");
        if (disable === true && !record) throw fail("Passwortschutz ist bereits ausgeschaltet.");
        const nextRecord = disable === true ? null : await passwordRecord(password);
        writeRecord(file, nextRecord || { version: 1, disabled: true });
        record = nextRecord;
        sessions.clear();
        response.clearCookie(COOKIE, cookieOptions(request));
        response.json({ enabled: Boolean(record), authenticated: !record });
      } catch (error) { next(error); }
      finally { if (ownsLock) changing = false; }
    });
    app.use((request, response, next) => {
      try {
        if (!record) return next();
        const isApi = /^\/api(?:\/|$)/i.test(request.path);
        const isPage = request.path === "/" || request.path.toLowerCase().endsWith(".html") || !path.extname(request.path);
        if (isApi || isPage && request.path !== "/login.html") {
          response.set("Cache-Control", "no-store");
          if (!validSession(request)) {
            if (isApi || !["GET", "HEAD"].includes(request.method)) return response.status(401).json({ error: "Anmeldung erforderlich. Bitte mit deinem CryptoBuch-Passwort anmelden." });
            return response.redirect(303, "/login.html");
          }
          if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) safeWrite(request);
        }
        next();
      } catch (error) { next(error); }
    });
  }
  return { register };
}
module.exports = { createAuth, passwordRecord, matches, validatePassword, writeRecord, readRecord };
