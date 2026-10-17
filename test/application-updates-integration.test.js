const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cryptobuch-update-api-"));
process.env.DATA_DIR = dataDir;
const tokenFile = path.join(dataDir, "token"); fs.writeFileSync(tokenFile, "ptr-test-secret");
Object.assign(process.env, { CRYPTOBUCH_PORTAINER_URL: "https://portainer.test", CRYPTOBUCH_PORTAINER_STACK_ID: "12", CRYPTOBUCH_PORTAINER_ENDPOINT_ID: "1", CRYPTOBUCH_PORTAINER_TOKEN_FILE: tokenFile });
const nativeFetch = global.fetch;
const calls = [];
global.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  if (url.startsWith("https://api.github.com/")) return Response.json({ tag_name: "v1.0.1", body: "Test" });
  if (url.endsWith("/file")) return Response.json({ StackFileContent: "services:\n  cryptobuch:\n    image: ghcr.io/404gamernotfound/crypto-tax-tracking-tool:${CRYPTOBUCH_IMAGE_TAG}\n" });
  return Response.json({ Id: 12, EndpointId: 1, Type: 2, Env: [] });
};
const { app, db } = require("../server");
let server, origin, token;
test.before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); origin = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); global.fetch = nativeFetch; fs.rmSync(dataDir, { recursive: true, force: true }); });
const password = "update-test-password-long-enough";
function request(route, method = "GET", body, headers = {}) {
  return nativeFetch(origin + route, { method, headers: { "Content-Type": "application/json", "X-CryptoBuch-Request": "1", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}

test("Update-API verlangt Passwortschutz, Sitzung und CSRF-Schutz; niemals Credentials im Status", async () => {
  assert.equal((await request("/api/updates/install", "POST", { version: "1.0.1", confirmed: true })).status, 403);
  assert.equal((await request("/api/updates/check", "POST", {}, { "X-CryptoBuch-Request": "" })).status, 403);
  assert.equal((await request("/api/auth/password", "PUT", { password })).status, 200);
  assert.equal((await request("/api/updates/install", "POST", { version: "1.0.1", confirmed: true })).status, 401);
  const login = await (await request("/api/auth/login", "POST", { password })).json(); token = login.token;
  assert.equal((await request("/api/updates/install", "POST", { version: "1.0.1", confirmed: true }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await request("/api/updates/install", "POST", { version: "1.0.1" })).status, 400);
  const status = await (await request("/api/updates/check", "POST")).json();
  assert.equal(status.updateAvailable, true);
  assert.doesNotMatch(JSON.stringify(status), /ptr-test-secret|portainer\.test/);
  assert.equal(calls.filter(call => call.options.method === "PUT").length, 0);
});

test("API erstellt eine echte lesbare SQLite-Sicherung und sperrt Änderungen bis zur Versionsbestätigung", async () => {
  db.prepare("INSERT INTO wallets (chain, address, label) VALUES ('BTC', 'public-update-test', 'Erhalten')").run();
  const response = await request("/api/updates/install", "POST", { version: "1.0.1", confirmed: true });
  assert.equal(response.status, 202);
  const result = await response.json(); assert.equal(result.attempt.status, "accepted");
  const { DatabaseSync } = require("node:sqlite");
  const snapshot = new DatabaseSync(path.join(dataDir, "backups", result.attempt.backup), { readOnly: true });
  assert.equal(snapshot.prepare("SELECT label FROM wallets").get().label, "Erhalten"); snapshot.close();
  assert.equal((await request("/api/backups", "POST")).status, 503);
  assert.equal((await request("/api/updates/install", "POST", { version: "1.0.1", confirmed: true })).status, 409);
  assert.equal(calls.filter(call => call.options.method === "PUT").length, 1);
  assert.equal((await request("/api/updates")).status, 200);
  assert.equal((await request("/api/updates/acknowledge", "POST", { confirmation: "PORTAINER GEPRÜFT" })).status, 409);
});
