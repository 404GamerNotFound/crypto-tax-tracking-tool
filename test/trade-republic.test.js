const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createTradeRepublicDeviceKey,
  publicDeviceKey,
  signedHeaders,
  startTradeRepublicDeviceRegistration,
  completeTradeRepublicDeviceRegistration,
  parseTradeRepublicSocketMessage,
  timelineData,
  normalizeTradeRepublicTimelineEvent,
} = require("../lib/trade-republic");

test("erzeugt einen P-256-Geräteschlüssel und signiert Login-Anfragen ohne Klartext im Header", () => {
  const privateKey = createTradeRepublicDeviceKey();
  const deviceKey = publicDeviceKey(privateKey);
  const headers = signedHeaders(privateKey, { phoneNumber: "+491701234567", pin: "1234" }, 1700000000000);
  assert.match(privateKey, /BEGIN PRIVATE KEY/);
  assert.equal(Buffer.from(deviceKey, "base64").length, 65);
  assert.equal(headers["X-Zeta-Timestamp"], "1700000000000");
  assert.match(headers["X-Zeta-Signature"], /^[A-Za-z0-9+/=]+$/);
  assert.equal(headers["X-Zeta-Signature"].includes("1234"), false);
});

test("führt die Geräteaktivierung mit Bestätigungscode aus und speichert keinen Session-Token", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/reset/device")) return { ok: true, status: 200, json: async () => ({ processId: "process-1" }) };
    if (url.endsWith("/reset/device/process-1/key")) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ sessionToken: "ephemeral-token", accountState: "ACTIVE" }) };
  };
  const registration = await startTradeRepublicDeviceRegistration({ phoneNumber: "+491701234567", pin: "1234", fetchImpl });
  await completeTradeRepublicDeviceRegistration({ phoneNumber: "+491701234567", pin: "1234", code: "482913", fetchImpl, ...registration });
  assert.equal(registration.processId, "process-1");
  assert.equal(requests.length, 3);
  assert.deepEqual(JSON.parse(requests[0].options.body), { phoneNumber: "+491701234567", pin: "1234" });
  assert.equal(JSON.parse(requests[1].options.body).code, "482913");
  assert.equal(JSON.parse(requests[1].options.body).deviceKey.length > 80, true);
  assert.equal(requests[2].options.headers["X-Zeta-Signature"].includes("1234"), false);
});

test("wertet nur explizite Krypto-Einheiten aus Timeline und Detail aus", () => {
  const event = { type: "timelineEvent", data: { id: "trade-1", timestamp: 1735732800000, title: "Bitcoin", body: "Kauf ausgeführt" } };
  const detail = { type: "timelineDetail", data: { sections: [{ title: "Ausführung", data: [{ title: "Anteile", detail: "0,025 BTC" }] }] } };
  const row = normalizeTradeRepublicTimelineEvent(event, detail);
  assert.deepEqual({ asset: row.asset, amount: row.amount, direction: row.direction, purpose: row.purpose }, {
    asset: "BTC", amount: 0.025, direction: "in", purpose: "Kauf",
  });
  assert.equal(normalizeTradeRepublicTimelineEvent({ type: "timelineEvent", data: { id: "stock-1", timestamp: 1735732800000, title: "Aktie", body: "Kauf zu 20 EUR" } }, {}), null);
});

test("versteht die verwendeten WebSocket- und Timeline-Paginierungsdaten", () => {
  assert.deepEqual(parseTradeRepublicSocketMessage("connected"), { state: "connected" });
  assert.deepEqual(parseTradeRepublicSocketMessage('1 D {"data":[{"id":"x"}]}'), { id: "1", state: "D", data: { data: [{ id: "x" }] }, raw: '1 D {"data":[{"id":"x"}]}' });
  assert.deepEqual(timelineData({ data: [{ id: "x" }], cursors: { after: "next" } }), { entries: [{ id: "x" }], after: "next" });
});
