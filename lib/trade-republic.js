const crypto = require("node:crypto");

const TRADE_REPUBLIC_API_URL = "https://api.traderepublic.com";
const TRADE_REPUBLIC_SOCKET_URL = "wss://api.traderepublic.com";
const TRADE_REPUBLIC_HISTORY_LIMIT = 2500;
const TRADE_REPUBLIC_REQUEST_GAP_MS = 900;

const CRYPTO_NAMES = Object.freeze({
  bitcoin: "BTC", btc: "BTC", xbt: "BTC",
  ethereum: "ETH", ether: "ETH", eth: "ETH",
  cardano: "ADA", ada: "ADA", solana: "SOL", sol: "SOL",
  ripple: "XRP", xrp: "XRP", dogecoin: "DOGE", doge: "DOGE",
  litecoin: "LTC", ltc: "LTC", polkadot: "DOT", dot: "DOT",
  chainlink: "LINK", link: "LINK", avalanche: "AVAX", avax: "AVAX",
  polygon: "POL", matic: "POL", pol: "POL", uniswap: "UNI", uni: "UNI",
  cosmos: "ATOM", atom: "ATOM", tezos: "XTZ", xtz: "XTZ",
  tron: "TRX", trx: "TRX", near: "NEAR", binancecoin: "BNB", bnb: "BNB",
  toncoin: "TON", ton: "TON", stellar: "XLM", xlm: "XLM",
  sui: "SUI", aptos: "APT", apt: "APT", arbitrum: "ARB", arb: "ARB",
  celo: "CELO", algorand: "ALGO", algo: "ALGO", filecoin: "FIL", fil: "FIL",
  aave: "AAVE", maker: "MKR", shibainu: "SHIB", shib: "SHIB",
});
const CRYPTO_TICKERS = Object.freeze([...new Set(Object.values(CRYPTO_NAMES))]);

function trimUrl(value, fallback) {
  return String(value || fallback).replace(/\/$/, "");
}

function userSafeError(prefix, response, payload) {
  // Provider error bodies can echo authentication or device information. Do
  // not surface them to the UI, logs, notifications or persisted job errors.
  void payload;
  return new Error(`${prefix} (HTTP ${response.status})`);
}

function publicDeviceKey(privateKey) {
  const key = crypto.createPublicKey(privateKey).export({ format: "jwk" });
  if (!key.x || !key.y) throw new Error("Trade-Republic-Geräteschlüssel konnte nicht erzeugt werden.");
  return Buffer.concat([Buffer.from([4]), Buffer.from(key.x, "base64url"), Buffer.from(key.y, "base64url")]).toString("base64");
}

function createTradeRepublicDeviceKey() {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return privateKey.export({ type: "pkcs8", format: "pem" });
}

function signedHeaders(privateKey, payload, timestamp = Date.now()) {
  const payloadString = JSON.stringify(payload);
  const signature = crypto.sign("sha512", Buffer.from(`${timestamp}.${payloadString}`, "utf8"), {
    key: privateKey,
    dsaEncoding: "der",
  }).toString("base64");
  return {
    "X-Zeta-Timestamp": String(timestamp),
    "X-Zeta-Signature": signature,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function startTradeRepublicDeviceRegistration({ phoneNumber, pin, apiBaseUrl = TRADE_REPUBLIC_API_URL, fetchImpl = fetch, privateKey = createTradeRepublicDeviceKey() }) {
  const response = await fetchImpl(`${trimUrl(apiBaseUrl, TRADE_REPUBLIC_API_URL)}/api/v1/auth/account/reset/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ phoneNumber, pin }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.processId) throw userSafeError("Trade Republic konnte die Geräteaktivierung nicht starten", response, payload);
  return { privateKey, processId: String(payload.processId) };
}

async function completeTradeRepublicDeviceRegistration({ phoneNumber, pin, privateKey, processId, code, apiBaseUrl = TRADE_REPUBLIC_API_URL, fetchImpl = fetch }) {
  const safeProcessId = encodeURIComponent(String(processId || ""));
  const response = await fetchImpl(`${trimUrl(apiBaseUrl, TRADE_REPUBLIC_API_URL)}/api/v1/auth/account/reset/device/${safeProcessId}/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ code: String(code || ""), deviceKey: publicDeviceKey(privateKey) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw userSafeError("Trade Republic hat den Bestätigungscode nicht akzeptiert", response, payload);
  // Verify the activation immediately. The short-lived session token stays in
  // memory and is deliberately never stored in the SQLite database.
  await authenticateTradeRepublic({ phoneNumber, pin, privateKey, apiBaseUrl, fetchImpl });
}

async function authenticateTradeRepublic({ phoneNumber, pin, privateKey, apiBaseUrl = TRADE_REPUBLIC_API_URL, fetchImpl = fetch }) {
  const payload = { phoneNumber, pin };
  const response = await fetchImpl(`${trimUrl(apiBaseUrl, TRADE_REPUBLIC_API_URL)}/api/v1/auth/login`, {
    method: "POST",
    headers: signedHeaders(privateKey, payload),
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.sessionToken || result?.accountState !== "ACTIVE") {
    throw userSafeError("Trade-Republic-Anmeldung fehlgeschlagen", response, result);
  }
  return String(result.sessionToken);
}

function websocketMessageData(event) {
  if (typeof event === "string") return event;
  return String(event?.data ?? "");
}

function parseTradeRepublicSocketMessage(value) {
  const message = String(value || "");
  if (message === "connected") return { state: "connected" };
  const match = message.match(/^(\S+)\s+([A-Z])(?:\s+([\s\S]*))?$/);
  if (!match) return { state: "unknown", raw: message };
  const [, id, state, body = ""] = match;
  let data = null;
  if (body) {
    try { data = JSON.parse(body); } catch (_) { data = body; }
  }
  return { id, state, data, raw: message };
}

function waitForEvent(socket, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Trade Republic antwortet nicht rechtzeitig.")), timeoutMs);
    const success = (event) => { clearTimeout(timer); resolve(event); };
    const failure = () => { clearTimeout(timer); reject(new Error("Die Trade-Republic-Verbindung wurde unterbrochen.")); };
    socket.addEventListener(type, success, { once: true });
    socket.addEventListener("error", failure, { once: true });
  });
}

async function createTradeRepublicSocketClient({ sessionToken, socketUrl = TRADE_REPUBLIC_SOCKET_URL, WebSocketImpl = globalThis.WebSocket, timeoutMs = 20000 }) {
  if (typeof WebSocketImpl !== "function") throw new Error("Dieser Node.js-Laufzeit fehlt ein WebSocket-Client für Trade Republic.");
  const socket = new WebSocketImpl(socketUrl);
  await waitForEvent(socket, "open", timeoutMs);
  socket.send('connect 21 {"locale":"de"}');
  const connected = parseTradeRepublicSocketMessage(websocketMessageData(await waitForEvent(socket, "message", timeoutMs)));
  if (connected.state !== "connected") {
    try { socket.close(); } catch (_) { /* ignore a finished socket */ }
    throw new Error("Trade Republic hat die WebSocket-Verbindung nicht bestätigt.");
  }
  let requestNumber = 0;
  return {
    async subscribe(type, payload = {}) {
      const requestId = String(++requestNumber);
      socket.send(`sub ${requestId} ${JSON.stringify({ type, ...payload, token: sessionToken })}`);
      while (true) {
        const message = parseTradeRepublicSocketMessage(websocketMessageData(await waitForEvent(socket, "message", timeoutMs)));
        if (message.id !== requestId || ["A", "C"].includes(message.state)) continue;
        if (message.state === "E") throw new Error("Trade Republic hat die lesende Historienabfrage abgelehnt.");
        if (message.state === "D") return message.data;
      }
    },
    close() { try { socket.close(); } catch (_) { /* ignore a finished socket */ } },
  };
}

async function tradeRepublicSubscription(options) {
  const client = await createTradeRepublicSocketClient(options);
  try {
    return await client.subscribe(options.type, options.payload);
  } finally {
    client.close();
  }
}

function numberFromText(value) {
  const text = String(value ?? "").trim().replace(/\s/g, "");
  if (!text) return null;
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function assetFromText(value) {
  const compact = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return CRYPTO_NAMES[compact] || null;
}

function collectText(value, output = []) {
  if (value === null || value === undefined || output.length >= 200) return output;
  if (typeof value === "string" || typeof value === "number") { output.push(String(value)); return output; }
  if (Array.isArray(value)) { value.forEach((item) => collectText(item, output)); return output; }
  if (typeof value === "object") Object.values(value).forEach((item) => collectText(item, output));
  return output;
}

function explicitCryptoAmount(value) {
  const text = collectText(value).join(" | ");
  const ticker = CRYPTO_TICKERS.join("|");
  const tickerMatch = text.match(new RegExp(`(?:^|\\s)([0-9][0-9.,\\s]{0,30})\\s*(${ticker})(?=$|[^A-Z])`, "i"));
  if (tickerMatch) {
    const amount = numberFromText(tickerMatch[1]);
    if (amount && amount > 0) return { asset: tickerMatch[2].toUpperCase(), amount };
  }
  const namePattern = Object.keys(CRYPTO_NAMES).filter((name) => name.length > 3).join("|");
  const nameMatch = text.match(new RegExp(`(?:^|\\s)([0-9][0-9.,\\s]{0,30})\\s*(${namePattern})(?=$|[^A-Z])`, "i"));
  if (nameMatch) {
    const amount = numberFromText(nameMatch[1]);
    const asset = assetFromText(nameMatch[2]);
    if (amount && amount > 0 && asset) return { asset, amount };
  }
  return null;
}

function labelledCryptoAmount(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) { const found = labelledCryptoAmount(item); if (found) return found; }
    return null;
  }
  const label = value.title || value.label || value.name || value.key || "";
  const asset = assetFromText(label);
  const amount = numberFromText(value.detail ?? value.value ?? value.amount ?? "");
  if (asset && amount && amount > 0) return { asset, amount };
  for (const item of Object.values(value)) { const found = labelledCryptoAmount(item); if (found) return found; }
  return null;
}

function timestampFromEvent(event) {
  const value = event?.data?.timestamp ?? event?.timestamp ?? event?.data?.createdAt ?? event?.createdAt;
  const date = typeof value === "number" || /^\d+$/.test(String(value || "")) ? new Date(Number(value)) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timelineData(payload) {
  if (Array.isArray(payload)) return { entries: payload, after: null };
  if (Array.isArray(payload?.data)) return { entries: payload.data, after: payload.cursors?.after || payload.after || null };
  const data = payload?.data || payload || {};
  return { entries: Array.isArray(data.data) ? data.data : Array.isArray(data.items) ? data.items : [], after: data.cursors?.after || data.after || null };
}

function normalizeTradeRepublicTimelineEvent(event, detail) {
  const directionFrom = (value) => {
    const text = collectText(value).join(" ").toLowerCase();
    return /\b(verkauf|sell)\b/.test(text) ? "out" : /\b(kauf|buy|sparplan)\b/.test(text) ? "in" : null;
  };
  // Timeline title/body is the primary record. Details can mention a prior
  // purchase while explaining a sale, so they are only a fallback.
  const direction = directionFrom(event?.data || event) || directionFrom(detail);
  const { asset, amount } = explicitCryptoAmount(detail) || explicitCryptoAmount(event) || labelledCryptoAmount(detail) || labelledCryptoAmount(event) || {};
  const timestamp = timestampFromEvent(event);
  const id = String(event?.data?.id || event?.id || "").trim();
  // No USD cash amount, title or inferred instrument is ever converted into
  // a coin quantity. A row is accepted only with an explicit unit count.
  if (!id || !timestamp || !direction || !asset || !amount) return null;
  return {
    externalId: `trade-republic:${id}:${asset}:${direction}`,
    hash: `trade-republic:${id}`,
    timestamp,
    direction,
    asset,
    amount,
    fee: 0,
    feeAsset: asset,
    priceEur: null,
    purpose: direction === "in" ? "Kauf" : "Verkauf",
    counterparty: "Trade Republic",
    raw: { event, detail },
  };
}

function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function fetchTradeRepublicCryptoHistory({ phoneNumber, pin, privateKey, apiBaseUrl = TRADE_REPUBLIC_API_URL, socketUrl = TRADE_REPUBLIC_SOCKET_URL, fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket, maxItems = TRADE_REPUBLIC_HISTORY_LIMIT, requestGapMs = TRADE_REPUBLIC_REQUEST_GAP_MS }) {
  const sessionToken = await authenticateTradeRepublic({ phoneNumber, pin, privateKey, apiBaseUrl, fetchImpl });
  const rows = [];
  const warnings = [];
  let after = null;
  let pages = 0;
  const client = await createTradeRepublicSocketClient({ sessionToken, socketUrl, WebSocketImpl });
  try {
    while (pages < maxItems && rows.length < maxItems) {
      const response = await client.subscribe("timeline", { after });
      const page = timelineData(response);
      if (!page.entries.length) break;
      for (const event of page.entries) {
        const eventId = String(event?.data?.id || event?.id || "").trim();
        if (!eventId) continue;
        const detail = await client.subscribe("timelineDetail", { id: eventId });
        const row = normalizeTradeRepublicTimelineEvent(event, detail);
        if (row) rows.push(row);
        if (rows.length >= maxItems) break;
        if (requestGapMs) await sleep(requestGapMs);
      }
      pages += 1;
      if (!page.after || page.after === after) break;
      after = page.after;
      if (requestGapMs) await sleep(requestGapMs);
    }
  } finally {
    client.close();
  }
  if (pages >= maxItems || rows.length >= maxItems) warnings.push("Trade-Republic-Importlimit erreicht; starte den Sync erneut, um weitere Buchungen abzurufen.");
  return { rows, limited: rows.length >= maxItems, warnings };
}

module.exports = {
  TRADE_REPUBLIC_API_URL,
  TRADE_REPUBLIC_SOCKET_URL,
  TRADE_REPUBLIC_HISTORY_LIMIT,
  createTradeRepublicDeviceKey,
  publicDeviceKey,
  signedHeaders,
  startTradeRepublicDeviceRegistration,
  completeTradeRepublicDeviceRegistration,
  authenticateTradeRepublic,
  parseTradeRepublicSocketMessage,
  createTradeRepublicSocketClient,
  timelineData,
  explicitCryptoAmount,
  labelledCryptoAmount,
  normalizeTradeRepublicTimelineEvent,
  fetchTradeRepublicCryptoHistory,
};
