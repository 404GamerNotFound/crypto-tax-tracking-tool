"use strict";

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;

function httpsEnabled(env = process.env) {
  const value = env.CRYPTOBUCH_HTTPS ?? "false";
  if (!["true", "false"].includes(value)) throw new Error("CRYPTOBUCH_HTTPS muss true oder false sein.");
  return value === "true";
}

function certificateHosts(value = "") {
  if (typeof value !== "string" || value.length > 4096) throw new Error("CRYPTOBUCH_TLS_HOSTS ist zu lang.");
  const hosts = [...new Set([...LOOPBACK_HOSTS, ...value.split(",").map(host => host.trim().toLowerCase()).filter(Boolean)])];
  if (hosts.length > 35) throw new Error("CRYPTOBUCH_TLS_HOSTS: maximal 32 zusätzliche Namen oder IP-Adressen.");
  for (const host of hosts) {
    if (net.isIP(host)) continue;
    if (host.length > 253 || !host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      || /^[\d.]+$/.test(host)) {
      throw new Error("CRYPTOBUCH_TLS_HOSTS darf nur DNS-Namen und IP-Adressen enthalten, keine URLs, Ports oder Platzhalter.");
    }
  }
  return hosts;
}

function needsRenewal(certificate, hosts, now = Date.now()) {
  return Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now + RENEW_BEFORE_MS
    || hosts.some(host => !(net.isIP(host) ? certificate.checkIP(host) : certificate.checkHost(host, { subject: "never" })));
}

function tlsPaths(dataDir) {
  const directory = path.join(dataDir, "tls");
  return { directory, bundle: path.join(directory, "server.pem"), certificate: path.join(directory, "server.crt") };
}

function readBundle(filename) {
  try {
    const bundle = fs.readFileSync(filename);
    const certificate = new crypto.X509Certificate(bundle);
    if (!certificate.checkPrivateKey(crypto.createPrivateKey(bundle))) throw new Error("key mismatch");
    return { bundle, certificate };
  } catch {
    throw new Error("Das lokale HTTPS-Zertifikat ist nicht lesbar oder passt nicht zum TLS-Schlüssel. DATA_DIR/tls/server.pem prüfen; kein Rückfall auf HTTP.");
  }
}

function generateBundle(directory, hosts) {
  const temporary = fs.mkdtempSync(path.join(directory, ".generate-"));
  fs.chmodSync(temporary, 0o700);
  try {
    const config = path.join(temporary, "openssl.cnf");
    const key = path.join(temporary, "key.pem"), cert = path.join(temporary, "cert.pem");
    const alternativeNames = hosts.map((host, i) => `${net.isIP(host) ? "IP" : "DNS"}.${i + 1} = ${host}`).join("\n");
    fs.writeFileSync(config, `[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = extensions\n[dn]\nCN = CryptoBuch local\n[extensions]\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = @names\n[names]\n${alternativeNames}\n`, { mode: 0o600 });
    try {
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "365", "-config", config, "-keyout", key, "-out", cert],
        { stdio: "ignore", timeout: 30000 });
    } catch {
      throw new Error("Das lokale HTTPS-Zertifikat konnte nicht erzeugt werden. OpenSSL muss installiert und DATA_DIR/tls schreibbar sein; kein Rückfall auf HTTP.");
    }
    const staged = path.join(temporary, "server.pem");
    fs.writeFileSync(staged, Buffer.concat([fs.readFileSync(cert), fs.readFileSync(key)]), { mode: 0o600 });
    readBundle(staged); // Verify the pair before replacing the persistent file.
    fs.renameSync(staged, path.join(directory, "server.pem"));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function ensureLocalCertificate({ dataDir, hosts = certificateHosts(), logger = console }) {
  const paths = tlsPaths(dataDir);
  fs.mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(paths.directory, 0o700);
  let stored = fs.existsSync(paths.bundle) ? readBundle(paths.bundle) : null;
  if (!stored || needsRenewal(stored.certificate, hosts)) {
    generateBundle(paths.directory, hosts);
    stored = readBundle(paths.bundle);
    logger.info("Lokales HTTPS-Zertifikat erzeugt/erneuert. SHA-256: " + stored.certificate.fingerprint256);
  }
  fs.chmodSync(paths.bundle, 0o600);
  // Only this public file may be copied to a browser/OS trust store.
  fs.writeFileSync(paths.certificate, stored.certificate.toString(), { mode: 0o644 });
  return { key: stored.bundle, cert: stored.certificate.toString(), certificatePath: paths.certificate };
}

function createAppServer(app, { dataDir, env = process.env, logger = console }) {
  if (!httpsEnabled(env)) return { server: http.createServer(app), protocol: "http" };
  const { key, cert, certificatePath } = ensureLocalCertificate({ dataDir, hosts: certificateHosts(env.CRYPTOBUCH_TLS_HOSTS), logger });
  return { server: https.createServer({ key, cert, minVersion: "TLSv1.2" }, app), protocol: "https", certificatePath };
}

module.exports = { httpsEnabled, certificateHosts, needsRenewal, tlsPaths, ensureLocalCertificate, createAppServer };
