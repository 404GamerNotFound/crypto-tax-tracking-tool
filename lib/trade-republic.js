const crypto = require("node:crypto");
const WebSocket = require("ws");

const TRADE_REPUBLIC_API_URL = "https://api.traderepublic.com";
const TRADE_REPUBLIC_WEB_URL = "https://app.traderepublic.com";
const TRADE_REPUBLIC_SOCKET_URL = "wss://api.traderepublic.com";
const TRADE_REPUBLIC_HISTORY_LIMIT = 2500;
const TRADE_REPUBLIC_REQUEST_GAP_MS = 900;
const TRADE_REPUBLIC_WAF_CACHE_MS = 4 * 60 * 60 * 1000;
const TRADE_REPUBLIC_WEB_APP_VERSION = process.env.TRADE_REPUBLIC_WEB_APP_VERSION || "15.7.0";
const TRADE_REPUBLIC_WEB_USER_AGENT = process.env.TRADE_REPUBLIC_WEB_USER_AGENT || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const TRADE_REPUBLIC_SESSION_COOKIE_NAMES = new Set(["JSESSIONID", "tr_session", "tr_refresh", "tr_device"]);

const CRYPTO_NAMES = Object.freeze({
  bitcoin: "BTC", btc: "BTC", xbt: "BTC", ethereum: "ETH", ether: "ETH", eth: "ETH", cardano: "ADA", ada: "ADA", solana: "SOL", sol: "SOL", ripple: "XRP", xrp: "XRP", dogecoin: "DOGE", doge: "DOGE", litecoin: "LTC", ltc: "LTC", polkadot: "DOT", dot: "DOT", chainlink: "LINK", link: "LINK", avalanche: "AVAX", avax: "AVAX", polygon: "POL", matic: "POL", pol: "POL", uniswap: "UNI", uni: "UNI", cosmos: "ATOM", atom: "ATOM", tezos: "XTZ", xtz: "XTZ", tron: "TRX", trx: "TRX", near: "NEAR", binancecoin: "BNB", bnb: "BNB", toncoin: "TON", ton: "TON", stellar: "XLM", xlm: "XLM", sui: "SUI", aptos: "APT", apt: "APT", arbitrum: "ARB", arb: "ARB", celo: "CELO", algorand: "ALGO", algo: "ALGO", filecoin: "FIL", fil: "FIL", aave: "AAVE", maker: "MKR", shibainu: "SHIB", shib: "SHIB",
});
const CRYPTO_TICKERS = Object.freeze([...new Set(Object.values(CRYPTO_NAMES))]);
let cachedWafToken = null;

function trimUrl(value, fallback) { return String(value || fallback).replace(/\/$/, ""); }
function userSafeError(prefix, response) {
  const status = Number(response?.status || 0);
  if (status === 429) return new Error("Trade Republic begrenzt derzeit Anmeldeversuche. Bitte später erneut versuchen.");
  if (status === 401 || status === 403) return new Error("Trade Republic hat die Web-Sitzung abgelehnt. Bitte die Anmeldung erneut starten.");
  if (status === 405) return new Error("Die Trade-Republic-Webprüfung wurde abgelehnt. Bitte später erneut versuchen.");
  return new Error(`${prefix}${status ? ` (HTTP ${status})` : ""}`);
}
function createTradeRepublicWebDeviceId() { return crypto.randomBytes(32).toString("hex"); }
function tradeRepublicDeviceInfo(deviceId) {
  return Buffer.from(JSON.stringify({ stableDeviceId: String(deviceId || ""), model: "CryptoBuch Local", browser: "Chromium", browserVersion: "153.0.0.0", os: process.platform === "darwin" ? "Mac OS" : process.platform === "win32" ? "Windows" : "Linux", osVersion: "local", timezone: "Europe/Berlin", timezoneOffset: -120, screen: "1280x800x24", preferredLanguages: ["de", "de-DE"] }), "utf8").toString("base64");
}
function webLoginHeaders(wafToken, deviceId) {
  return { "User-Agent": TRADE_REPUBLIC_WEB_USER_AGENT, Accept: "application/json, text/plain, */*", "Accept-Language": "de-DE,de;q=0.9,en;q=0.8", "Content-Type": "application/json", Origin: TRADE_REPUBLIC_WEB_URL, Referer: `${TRADE_REPUBLIC_WEB_URL}/`, "Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty", "x-tr-platform": "web", "x-tr-app-version": TRADE_REPUBLIC_WEB_APP_VERSION, "x-tr-device-info": tradeRepublicDeviceInfo(deviceId), "x-aws-waf-token": wafToken };
}
function sessionCookieMap(value) {
  if (!value || typeof value !== "object") return new Map();
  const entries = Array.isArray(value) ? value : Object.entries(value);
  const cookies = new Map();
  for (const [name, cookieValue] of entries) {
    const safeName = String(name || "").trim(); const safeValue = String(cookieValue || "").trim();
    if (TRADE_REPUBLIC_SESSION_COOKIE_NAMES.has(safeName) && safeValue && safeValue.length <= 8192) cookies.set(safeName, safeValue);
  }
  return cookies;
}
function sessionCookieObject(value) { return Object.fromEntries(sessionCookieMap(value)); }
function sessionCookieHeader(value, extraCookies = {}) { return [...new Map([...sessionCookieMap(value), ...Object.entries(extraCookies || {})]).entries()].filter(([, item]) => item).map(([name, item]) => `${name}=${item}`).join("; "); }
function mergeSessionCookies(current, response) {
  const next = sessionCookieMap(current); const headers = response?.headers;
  const setCookie = typeof headers?.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const header of setCookie) {
    const [pair] = String(header || "").split(";", 1); const equals = pair.indexOf("=");
    if (equals < 1) continue;
    const name = pair.slice(0, equals).trim(); const value = pair.slice(equals + 1).trim();
    if (TRADE_REPUBLIC_SESSION_COOKIE_NAMES.has(name) && value) next.set(name, value);
  }
  return Object.fromEntries(next);
}
function hasTradeRepublicWebSession(value) { const cookies = sessionCookieMap(value); return Boolean(cookies.get("tr_session") || cookies.get("JSESSIONID")); }
function getJsonSafely(response) { return response.json().catch(() => ({})); }

async function getTradeRepublicWafToken({ forceRefresh = false, chromiumImpl = null, now = Date.now, timeoutMs = 30000 } = {}) {
  if (!forceRefresh && cachedWafToken && now() - cachedWafToken.createdAt < TRADE_REPUBLIC_WAF_CACHE_MS) return cachedWafToken.value;
  let chromium = chromiumImpl;
  if (!chromium) { try { ({ chromium } = require("playwright")); } catch (_) { throw new Error("Der lokale Browserdienst für die Trade-Republic-Webanmeldung fehlt. Führe einmal `npx playwright install chromium` aus."); } }
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const context = await browser.newContext({ userAgent: TRADE_REPUBLIC_WEB_USER_AGENT, viewport: { width: 1280, height: 800 }, timezoneId: "Europe/Berlin", locale: "de-DE" });
    const page = await context.newPage();
    await page.goto(TRADE_REPUBLIC_WEB_URL, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForFunction(() => typeof window.AwsWafIntegration?.getToken === "function", undefined, { timeout: timeoutMs });
    const token = await page.evaluate(async () => window.AwsWafIntegration.getToken());
    if (typeof token !== "string" || token.length < 16) throw new Error("Die Trade-Republic-Webprüfung hat keinen gültigen Token geliefert.");
    cachedWafToken = { value: token, createdAt: now() }; return token;
  } catch (error) { throw new Error(`Die lokale Trade-Republic-Webprüfung konnte nicht gestartet werden: ${String(error.message || error).slice(0, 260)}`); }
  finally { if (browser) await browser.close().catch(() => {}); }
}
async function webRequest({ method, path, body = null, session = {}, deviceId, apiBaseUrl = TRADE_REPUBLIC_API_URL, fetchImpl = fetch, wafToken = null, forceWafRefresh = false }) {
  const token = wafToken || await getTradeRepublicWafToken({ forceRefresh: forceWafRefresh });
  const headers = webLoginHeaders(token, deviceId); const cookie = sessionCookieHeader(session, { "aws-waf-token": token }); if (cookie) headers.Cookie = cookie;
  const response = await fetchImpl(`${trimUrl(apiBaseUrl, TRADE_REPUBLIC_API_URL)}${path}`, { method, headers, ...(body === null ? {} : { body: JSON.stringify(body) }) });
  return { response, token };
}
async function tradeRepublicWebRequestWithRetry(options) {
  const first = await webRequest(options); const text = first.response.status === 405 ? await first.response.clone().text().catch(() => "") : null;
  return first.response.status === 405 && !text ? webRequest({ ...options, forceWafRefresh: true, wafToken: null }) : first;
}
async function startTradeRepublicWebLogin({ phoneNumber, pin, deviceId = createTradeRepublicWebDeviceId(), apiBaseUrl = TRADE_REPUBLIC_API_URL, fetchImpl = fetch, wafToken = null }) {
  const result = await tradeRepublicWebRequestWithRetry({ method: "POST", path: "/api/v2/auth/web/login", body: { phoneNumber: String(phoneNumber || ""), pin: String(pin || "") }, deviceId, apiBaseUrl, fetchImpl, wafToken });
  const payload = await getJsonSafely(result.response);
  if (!result.response.ok || !payload?.processId) throw userSafeError("Trade Republic konnte die Web-Anmeldung nicht starten", result.response);
  return { processId: String(payload.processId), deviceId, session: mergeSessionCookies({}, result.response), expiresInSeconds: Number(payload.countdownInSeconds || 120) || 120 };
}
async function pollTradeRepublicWebLogin({ processId, deviceId, session = {}, apiBaseUrl = TRADE_REPUBLIC_API_URL, fetchImpl = fetch, wafToken = null }) {
  const safeProcessId = encodeURIComponent(String(processId || "")); if (!safeProcessId) throw new Error("Die Trade-Republic-Webanmeldung ist nicht mehr verfügbar. Bitte erneut starten.");
  const result = await tradeRepublicWebRequestWithRetry({ method: "GET", path: `/api/v2/auth/web/login/processes/${safeProcessId}`, deviceId, session, apiBaseUrl, fetchImpl, wafToken });
  const payload = await getJsonSafely(result.response); if (!result.response.ok) throw userSafeError("Trade Republic konnte den Status der Web-Anmeldung nicht abrufen", result.response);
  const state = String(payload?.state || payload?.status || "PENDING").toUpperCase(); const nextSession = mergeSessionCookies(session, result.response);
  if (hasTradeRepublicWebSession(nextSession) || ["APPROVED", "COMPLETED", "SUCCESS", "OK", "DONE"].includes(state)) {
    if (!hasTradeRepublicWebSession(nextSession)) throw new Error("Trade Republic hat keine nutzbare Web-Sitzung bereitgestellt. Bitte erneut anmelden.");
    return { status: "approved", session: nextSession };
  }
  if (["REJECTED", "DECLINED", "FAILED", "EXPIRED", "CANCELLED"].includes(state)) return { status: "rejected", session: nextSession };
  return { status: "pending", session: nextSession };
}
async function refreshTradeRepublicWebSession({ session = {}, deviceId, apiBaseUrl = TRADE_REPUBLIC_API_URL, fetchImpl = fetch }) {
  if (!hasTradeRepublicWebSession(session)) throw new Error("Die lokale Trade-Republic-Websitzung fehlt. Bitte erneut anmelden.");
  const result = await tradeRepublicWebRequestWithRetry({ method: "GET", path: "/api/v1/auth/web/session", deviceId, session, apiBaseUrl, fetchImpl });
  if (!result.response.ok) throw userSafeError("Die Trade-Republic-Websitzung ist abgelaufen", result.response);
  const nextSession = mergeSessionCookies(session, result.response); if (!hasTradeRepublicWebSession(nextSession)) throw new Error("Die Trade-Republic-Websitzung ist abgelaufen. Bitte erneut anmelden."); return nextSession;
}

function websocketMessageData(event) { if (typeof event === "string") return event; if (Buffer.isBuffer(event)) return event.toString("utf8"); return String(event?.data ?? event ?? ""); }
function parseTradeRepublicSocketMessage(value) { const message = String(value || ""); if (message === "connected") return { state: "connected" }; const match = message.match(/^(\S+)\s+([A-Z])(?:\s+([\s\S]*))?$/); if (!match) return { state: "unknown", raw: message }; const [, id, state, body = ""] = match; let data = null; if (body) { try { data = JSON.parse(body); } catch (_) { data = body; } } return { id, state, data, raw: message }; }
function waitForSocketEvent(socket, type, timeoutMs) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Trade Republic antwortet nicht rechtzeitig.")), timeoutMs); const success = (...args) => { clearTimeout(timer); resolve(args.length > 1 ? args : args[0]); }; const failure = () => { clearTimeout(timer); reject(new Error("Die Trade-Republic-Verbindung wurde unterbrochen.")); }; socket.once(type, success); socket.once("error", failure); }); }
async function createTradeRepublicSocketClient({ session, socketUrl = TRADE_REPUBLIC_SOCKET_URL, WebSocketImpl = WebSocket, timeoutMs = 20000 }) {
  if (!hasTradeRepublicWebSession(session)) throw new Error("Die Trade-Republic-Websitzung fehlt. Bitte erneut anmelden.");
  const socket = new WebSocketImpl(socketUrl, { headers: { Cookie: sessionCookieHeader(session), Origin: TRADE_REPUBLIC_WEB_URL, "User-Agent": TRADE_REPUBLIC_WEB_USER_AGENT } });
  await waitForSocketEvent(socket, "open", timeoutMs); socket.send('connect 21 {"locale":"de"}');
  const connected = parseTradeRepublicSocketMessage(websocketMessageData(await waitForSocketEvent(socket, "message", timeoutMs)));
  if (connected.state !== "connected") { try { socket.close(); } catch (_) {} throw new Error("Trade Republic hat die WebSocket-Verbindung nicht bestätigt."); }
  let requestNumber = 0;
  return { async subscribe(type, payload = {}) { const requestId = String(++requestNumber); socket.send(`sub ${requestId} ${JSON.stringify({ type, ...payload })}`); while (true) { const message = parseTradeRepublicSocketMessage(websocketMessageData(await waitForSocketEvent(socket, "message", timeoutMs))); if (message.id !== requestId || ["A", "C"].includes(message.state)) continue; if (message.state === "E") throw new Error("Trade Republic hat die lesende Historienabfrage abgelehnt."); if (message.state === "D") return message.data; } }, close() { try { socket.close(); } catch (_) {} } };
}

function numberFromText(value) { const text = String(value ?? "").trim().replace(/\s/g, ""); if (!text) return null; const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, ""); const parsed = Number(normalized); return Number.isFinite(parsed) ? parsed : null; }
function assetFromText(value) { return CRYPTO_NAMES[String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "")] || null; }
function collectText(value, output = []) { if (value === null || value === undefined || output.length >= 200) return output; if (typeof value === "string" || typeof value === "number") { output.push(String(value)); return output; } if (Array.isArray(value)) { value.forEach((item) => collectText(item, output)); return output; } if (typeof value === "object") Object.values(value).forEach((item) => collectText(item, output)); return output; }
function explicitCryptoAmount(value) { const text = collectText(value).join(" | "); const tickerMatch = text.match(new RegExp(`(?:^|\\s)([0-9][0-9.,\\s]{0,30})\\s*(${CRYPTO_TICKERS.join("|")})(?=$|[^A-Z])`, "i")); if (tickerMatch) { const amount = numberFromText(tickerMatch[1]); if (amount && amount > 0) return { asset: tickerMatch[2].toUpperCase(), amount }; } const nameMatch = text.match(new RegExp(`(?:^|\\s)([0-9][0-9.,\\s]{0,30})\\s*(${Object.keys(CRYPTO_NAMES).filter((name) => name.length > 3).join("|")})(?=$|[^A-Z])`, "i")); if (nameMatch) { const amount = numberFromText(nameMatch[1]); const asset = assetFromText(nameMatch[2]); if (amount && amount > 0 && asset) return { asset, amount }; } return null; }
function labelledCryptoAmount(value) { if (!value || typeof value !== "object") return null; if (Array.isArray(value)) { for (const item of value) { const found = labelledCryptoAmount(item); if (found) return found; } return null; } const asset = assetFromText(value.title || value.label || value.name || value.key || ""); const amount = numberFromText(value.detail ?? value.value ?? value.amount ?? ""); if (asset && amount && amount > 0) return { asset, amount }; for (const item of Object.values(value)) { const found = labelledCryptoAmount(item); if (found) return found; } return null; }
function timestampFromEvent(event) { const value = event?.data?.timestamp ?? event?.timestamp ?? event?.data?.createdAt ?? event?.createdAt; const date = typeof value === "number" || /^\d+$/.test(String(value || "")) ? new Date(Number(value)) : new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function timelineData(payload) { if (Array.isArray(payload)) return { entries: payload, after: null }; if (Array.isArray(payload?.data)) return { entries: payload.data, after: payload.cursors?.after || payload.after || null }; const data = payload?.data || payload || {}; return { entries: Array.isArray(data.data) ? data.data : Array.isArray(data.items) ? data.items : [], after: data.cursors?.after || data.after || null }; }
function normalizeTradeRepublicTimelineEvent(event, detail) { const directionFrom = (value) => { const text = collectText(value).join(" ").toLowerCase(); return /\b(verkauf|sell)\b/.test(text) ? "out" : /\b(kauf|buy|sparplan)\b/.test(text) ? "in" : null; }; const direction = directionFrom(event?.data || event) || directionFrom(detail); const { asset, amount } = explicitCryptoAmount(detail) || explicitCryptoAmount(event) || labelledCryptoAmount(detail) || labelledCryptoAmount(event) || {}; const timestamp = timestampFromEvent(event); const id = String(event?.data?.id || event?.id || "").trim(); if (!id || !timestamp || !direction || !asset || !amount) return null; return { externalId: `trade-republic:${id}:${asset}:${direction}`, hash: `trade-republic:${id}`, timestamp, direction, asset, amount, fee: 0, feeAsset: asset, priceEur: null, purpose: direction === "in" ? "Kauf" : "Verkauf", counterparty: "Trade Republic", raw: { event, detail } }; }
function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
async function fetchTradeRepublicCryptoHistory({ session, socketUrl = TRADE_REPUBLIC_SOCKET_URL, WebSocketImpl = WebSocket, maxItems = TRADE_REPUBLIC_HISTORY_LIMIT, requestGapMs = TRADE_REPUBLIC_REQUEST_GAP_MS }) { const rows = []; const warnings = []; let after = null; let pages = 0; const client = await createTradeRepublicSocketClient({ session, socketUrl, WebSocketImpl }); try { while (pages < maxItems && rows.length < maxItems) { const response = await client.subscribe("timeline", { after }); const page = timelineData(response); if (!page.entries.length) break; for (const event of page.entries) { const eventId = String(event?.data?.id || event?.id || "").trim(); if (!eventId) continue; const detail = await client.subscribe("timelineDetail", { id: eventId }); const row = normalizeTradeRepublicTimelineEvent(event, detail); if (row) rows.push(row); if (rows.length >= maxItems) break; if (requestGapMs) await sleep(requestGapMs); } pages += 1; if (!page.after || page.after === after) break; after = page.after; if (requestGapMs) await sleep(requestGapMs); } } finally { client.close(); } if (pages >= maxItems || rows.length >= maxItems) warnings.push("Trade-Republic-Importlimit erreicht; starte den Sync erneut, um weitere Buchungen abzurufen."); return { rows, limited: rows.length >= maxItems, warnings }; }
function clearTradeRepublicWafTokenCache() { cachedWafToken = null; }

module.exports = { TRADE_REPUBLIC_API_URL, TRADE_REPUBLIC_WEB_URL, TRADE_REPUBLIC_SOCKET_URL, TRADE_REPUBLIC_HISTORY_LIMIT, TRADE_REPUBLIC_SESSION_COOKIE_NAMES, createTradeRepublicWebDeviceId, tradeRepublicDeviceInfo, webLoginHeaders, sessionCookieObject, sessionCookieHeader, mergeSessionCookies, hasTradeRepublicWebSession, getTradeRepublicWafToken, clearTradeRepublicWafTokenCache, startTradeRepublicWebLogin, pollTradeRepublicWebLogin, refreshTradeRepublicWebSession, parseTradeRepublicSocketMessage, createTradeRepublicSocketClient, timelineData, explicitCryptoAmount, labelledCryptoAmount, normalizeTradeRepublicTimelineEvent, fetchTradeRepublicCryptoHistory };
