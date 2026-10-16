const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");
const { once } = require("node:events");
const express = require("express");
const { createAuth } = require("../lib/auth");
const { requirePrivateLoginTransport } = require("../lib/bsdex-web-session");
const { httpsEnabled, certificateHosts, needsRenewal, tlsPaths, ensureLocalCertificate, createAppServer } = require("../lib/local-https");
const { checkHealth } = require("../scripts/healthcheck");

const quiet = { info() {} };
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cryptobuch-https-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("HTTPS-Konfiguration lehnt ungültige Schalter und Zertifikatsnamen ab", () => {
  assert.equal(httpsEnabled({}), false);
  assert.equal(httpsEnabled({ CRYPTOBUCH_HTTPS: "true" }), true);
  assert.throws(() => httpsEnabled({ CRYPTOBUCH_HTTPS: "yes" }));
  assert.deepEqual(certificateHosts("192.168.1.154,CryptoBuch.local,localhost"), ["localhost", "127.0.0.1", "::1", "192.168.1.154", "cryptobuch.local"]);
  for (const host of ["https://example.test", "localhost:3000", "*.example.test", "bad_host", "999.999.1.1", "example.test\n[req]", "a".repeat(64) + ".test"]) {
    assert.throws(() => certificateHosts(host));
  }
  assert.throws(() => certificateHosts(Array.from({ length: 33 }, (_, i) => `host${i}.local`).join(",")));
});

test("TLS-Zertifikat enthält LAN-SANs, bleibt über Neustarts erhalten und trennt öffentlichen Export vom Schlüssel", t => {
  const dataDir = temporary(t), hosts = certificateHosts("192.168.1.154,cryptobuch.local");
  const logs = [];
  const first = ensureLocalCertificate({ dataDir, hosts, logger: { info: message => logs.push(message) } });
  const cert = new crypto.X509Certificate(first.cert);
  assert.equal(cert.checkIP("192.168.1.154"), "192.168.1.154");
  assert.equal(cert.checkHost("cryptobuch.local"), "cryptobuch.local");
  assert.equal(cert.checkHost("localhost"), "localhost");
  assert.ok(cert.checkIP("::1"));
  assert.equal(cert.ca, false);
  assert.equal(cert.checkPrivateKey(crypto.createPrivateKey(first.key)), true);
  const paths = tlsPaths(dataDir);
  assert.equal(fs.statSync(paths.bundle).mode & 0o777, 0o600);
  assert.equal(fs.statSync(paths.directory).mode & 0o777, 0o700);
  assert.ok(!fs.readFileSync(paths.certificate, "utf8").includes("PRIVATE KEY"));
  assert.equal(ensureLocalCertificate({ dataDir, hosts, logger: quiet }).key.toString(), first.key.toString());
  assert.equal(logs.length, 1); assert.ok(!logs[0].includes("PRIVATE KEY"));
  assert.equal(needsRenewal(cert, hosts), false);
  assert.equal(needsRenewal(cert, hosts, Date.parse(cert.validTo) - 29 * 86400000), true);
  assert.equal(needsRenewal(cert, hosts, Date.parse(cert.validFrom) - 1000), true);
  const updated = ensureLocalCertificate({ dataDir, hosts: certificateHosts("192.168.1.155"), logger: quiet });
  assert.notEqual(updated.cert, first.cert);
  assert.equal(new crypto.X509Certificate(updated.cert).checkIP("192.168.1.155"), "192.168.1.155");
  assert.deepEqual(fs.readdirSync(paths.directory).sort(), ["server.crt", "server.pem"]);
});

test("Defekte TLS-Dateien führen zu einem Fehler statt HTTP oder stiller Schlüssel-Ersetzung", t => {
  const dataDir = temporary(t), paths = tlsPaths(dataDir);
  fs.mkdirSync(paths.directory);
  fs.writeFileSync(paths.bundle, "not-a-certificate");
  assert.throws(() => createAppServer((_req, res) => res.end(), { dataDir, env: { CRYPTOBUCH_HTTPS: "true" }, logger: quiet }), /kein Rückfall auf HTTP/);
  assert.equal(fs.readFileSync(paths.bundle, "utf8"), "not-a-certificate");
});

function request(port, { ca, pathname = "/healthz", body, token } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = https.request({ hostname: "127.0.0.1", port, path: pathname,
      ...(ca ? { ca } : {}), method: body ? "POST" : "GET", timeout: 3000,
      headers: { "Content-Type": "application/json", "X-CryptoBuch-Request": "1", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, response => {
      let content = "";
      response.on("data", chunk => { content += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(content) }));
      response.on("error", reject);
    });
    outgoing.on("error", reject); outgoing.on("timeout", () => outgoing.destroy(new Error("timeout")));
    outgoing.end(body ? JSON.stringify(body) : undefined);
  });
}

test("Echtes HTTPS: Zertifikatsprüfung, Secure-Cookies, BSDEX-Transport und Docker-Healthcheck", async t => {
  const dataDir = temporary(t), secretFile = path.join(dataDir, "password.txt");
  fs.writeFileSync(secretFile, "local-https-test-password");
  const app = express(); app.use(express.json());
  createAuth({ dataDir, passwordFile: secretFile }).register(app);
  app.get("/transport", (req, res) => { requirePrivateLoginTransport(req); res.json({ secure: req.secure }); });
  const { server, protocol, certificatePath } = createAppServer(app, { dataDir, env: { CRYPTOBUCH_HTTPS: "true" }, logger: quiet });
  assert.equal(protocol, "https");
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port, ca = fs.readFileSync(certificatePath);
  await assert.rejects(request(port), error => error.code === "DEPTH_ZERO_SELF_SIGNED_CERT");
  assert.equal((await request(port, { ca })).status, 200);
  const login = await request(port, { ca, pathname: "/api/auth/login", body: { password: "local-https-test-password" } });
  assert.equal(login.status, 200);
  assert.match(login.headers["set-cookie"][0], /; Secure/);
  // Healthcheck validates the locally generated certificate rather than
  // globally disabling TLS validation for price/exchange API connections.
  await checkHealth({ env: { CRYPTOBUCH_HTTPS: "true", PORT: String(port), DATA_DIR: dataDir } });
  const otherDir = temporary(t);
  ensureLocalCertificate({ dataDir: otherDir, logger: quiet });
  await assert.rejects(checkHealth({ env: { CRYPTOBUCH_HTTPS: "true", PORT: String(port), DATA_DIR: otherDir } }));
  assert.equal((await request(port, { ca, pathname: "/transport", token: login.body.token })).body.secure, true);
});

test("HTTP bleibt für native Entwicklung und bestehende TLS-Proxys explizit nutzbar", async t => {
  const dataDir = temporary(t);
  const { server, protocol } = createAppServer((_req, res) => { res.setHeader("Content-Type", "application/json"); res.end('{"status":"ok"}'); }, { dataDir, env: { CRYPTOBUCH_HTTPS: "false" } });
  assert.equal(protocol, "http"); assert.equal(fs.existsSync(tlsPaths(dataDir).directory), false);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await checkHealth({ env: { CRYPTOBUCH_HTTPS: "false", PORT: String(server.address().port) } });
});
