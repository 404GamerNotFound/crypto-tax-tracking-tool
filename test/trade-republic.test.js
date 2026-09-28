const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createTradeRepublicWebDeviceId,
  webLoginHeaders,
  mergeSessionCookies,
  hasTradeRepublicWebSession,
  startTradeRepublicWebLogin,
  pollTradeRepublicWebLogin,
  parseTradeRepublicSocketMessage,
  timelineData,
  normalizeTradeRepublicTimelineEvent,
} = require("../lib/trade-republic");

function response({ status = 200, body = {}, cookies = [] } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone: () => ({ text: async () => "" }),
    headers: { getSetCookie: () => cookies },
  };
}

test("erstellt eine stabile Web-Gerätekennung und sendet keine PIN im Header", () => {
  const deviceId = createTradeRepublicWebDeviceId();
  const headers = webLoginHeaders("waf-token-123456789", deviceId);
  assert.match(deviceId, /^[a-f0-9]{64}$/);
  assert.equal(headers["x-tr-platform"], "web");
  assert.equal(headers["x-aws-waf-token"], "waf-token-123456789");
  assert.equal(JSON.parse(Buffer.from(headers["x-tr-device-info"], "base64").toString("utf8")).stableDeviceId, deviceId);
  assert.equal(Object.values(headers).some((value) => String(value).includes("9876")), false);
});

test("startet den Web-Login und übernimmt nur erlaubte Sitzungscookies", async () => {
  const requests = [];
  const result = await startTradeRepublicWebLogin({
    phoneNumber: "+491701234567", pin: "1234", wafToken: "waf-token-123456789",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response({ body: { processId: "process-1", countdownInSeconds: 90 }, cookies: ["ignored=value; Path=/", "tr_device=device; Path=/"] });
    },
  });
  assert.equal(result.processId, "process-1");
  assert.deepEqual(result.session, { tr_device: "device" });
  assert.match(requests[0].url, /\/api\/v2\/auth\/web\/login$/);
  assert.deepEqual(JSON.parse(requests[0].options.body), { phoneNumber: "+491701234567", pin: "1234" });
  assert.equal(JSON.stringify(requests[0].options.headers).includes("9876"), false);
});

test("schließt die Web-Anmeldung erst nach App-Freigabe mit Web-Sitzung ab", async () => {
  const result = await pollTradeRepublicWebLogin({
    processId: "process-1", deviceId: "a".repeat(64), wafToken: "waf-token-123456789",
    session: { tr_device: "device" },
    fetchImpl: async () => response({ body: { state: "APPROVED" }, cookies: ["tr_session=session; HttpOnly", "tr_refresh=refresh; HttpOnly", "not-stored=value"] }),
  });
  assert.equal(result.status, "approved");
  assert.deepEqual(result.session, { tr_device: "device", tr_session: "session", tr_refresh: "refresh" });
  assert.equal(hasTradeRepublicWebSession(result.session), true);
  assert.deepEqual(mergeSessionCookies({}, response({ cookies: ["secret=value", "JSESSIONID=session"] })), { JSESSIONID: "session" });
});

test("wertet nur explizite Krypto-Einheiten aus Timeline und Detail aus", () => {
  const event = { type: "timelineEvent", data: { id: "trade-1", timestamp: 1735732800000, title: "Bitcoin", body: "Kauf ausgeführt" } };
  const detail = { type: "timelineDetail", data: { sections: [{ title: "Ausführung", data: [{ title: "Anteile", detail: "0,025 BTC" }] }] } };
  const row = normalizeTradeRepublicTimelineEvent(event, detail);
  assert.deepEqual({ asset: row.asset, amount: row.amount, direction: row.direction, purpose: row.purpose }, { asset: "BTC", amount: 0.025, direction: "in", purpose: "Kauf" });
  assert.equal(normalizeTradeRepublicTimelineEvent({ type: "timelineEvent", data: { id: "stock-1", timestamp: 1735732800000, title: "Aktie", body: "Kauf zu 20 EUR" } }, {}), null);
});

test("versteht WebSocket- und Timeline-Paginierungsdaten", () => {
  assert.deepEqual(parseTradeRepublicSocketMessage("connected"), { state: "connected" });
  assert.deepEqual(parseTradeRepublicSocketMessage('1 D {"data":[{"id":"x"}]}'), { id: "1", state: "D", data: { data: [{ id: "x" }] }, raw: '1 D {"data":[{"id":"x"}]}' });
  assert.deepEqual(timelineData({ data: [{ id: "x" }], cursors: { after: "next" } }), { entries: [{ id: "x" }], after: "next" });
});
