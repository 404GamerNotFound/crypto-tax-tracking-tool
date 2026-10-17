const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApplicationUpdates, versionParts, newer, configuration, deploymentPayload } = require("../lib/application-updates");

const repository = "404GamerNotFound/crypto-tax-tracking-tool";
const content = "services:\n  cryptobuch:\n    image: ghcr.io/404gamernotfound/crypto-tax-tracking-tool:${CRYPTOBUCH_IMAGE_TAG}\n    volumes:\n      - existing_data:/data\n";
const stack = { Id: 12, EndpointId: 1, Type: 2, Env: [{ name: "CRYPTOBUCH_IMAGE_TAG", value: "1.0.0" }, { name: "KEEP_SECRET", value: "secret-canary" }] };
function fixture(t, changes = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cryptobuch-updates-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const tokenFile = path.join(dataDir, "token"); fs.writeFileSync(tokenFile, "ptr-secret-canary\n");
  const events = []; let time = Date.parse("2026-10-16T12:00:00Z");
  const env = { CRYPTOBUCH_PORTAINER_URL: "https://portainer.test:9443", CRYPTOBUCH_PORTAINER_STACK_ID: "12", CRYPTOBUCH_PORTAINER_ENDPOINT_ID: "1", CRYPTOBUCH_PORTAINER_TOKEN_FILE: tokenFile };
  const options = { dataDir, version: "1.0.0", env, protectedMode: () => true, now: () => time,
    backup: async () => { events.push("backup"); return { name: "cryptobuch-20261016-120000.sqlite" }; },
    fetchImpl: async (url, options) => {
      events.push({ url, options });
      assert.equal(options.redirect, "error"); assert.ok(options.signal);
      if (url.startsWith("https://api.github.com/")) {
        assert.equal(options.headers["X-API-Key"], undefined);
        return Response.json({ tag_name: "v1.2.0", body: "Änderungen <script>untrusted</script>", draft: false, prerelease: false });
      }
      assert.equal(options.headers["X-API-Key"], "ptr-secret-canary");
      if (options.method === "PUT") {
        assert.ok(events.includes("backup"));
        assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "application-update.json"))).status, "requested");
        return Response.json({ Env: stack.Env });
      }
      return Response.json(url.endsWith("/file") ? { StackFileContent: content } : stack);
    }, ...changes };
  return { manager: createApplicationUpdates(options), options, events, dataDir, tick: ms => { time += ms; } };
}

test("ordnet stabile Versionen numerisch und lehnt unsichere/mehrdeutige Tags ab", () => {
  assert.equal(newer("1.10.0", "1.9.9"), true);
  assert.equal(newer("v2.0.0", "1.99.99"), true);
  assert.equal(newer("1.0.0", "1.0.0"), false);
  assert.equal(newer("0.9.0", "1.0.0"), false);
  for (const tag of ["1.0.0-beta", "01.0.0", "latest", "1.0.0;id", "../../image", "1.0", null, 12]) assert.equal(versionParts(tag), null);
});

test("Update-Konfiguration bleibt optional und akzeptiert nur feste HTTPS-Ziele", () => {
  assert.equal(configuration({}).configured, false);
  for (const url of ["http://portainer:9000", "https://user:secret@portainer", "https://portainer?token=secret", "https://portainer/#fragment"]) {
    assert.throws(() => configuration({ CRYPTOBUCH_PORTAINER_URL: url }), /HTTPS-Adresse/);
  }
  assert.throws(() => configuration({ CRYPTOBUCH_UPDATE_REPOSITORY: "../../target" }), /Repository/);
});

test("prüft Releases gemeinsam, begrenzt Abrufe und zeigt echte Update-Verfügbarkeit", async t => {
  const f = fixture(t);
  const [a, b] = await Promise.all([f.manager.check(), f.manager.check()]);
  assert.equal(a.latest.version, "1.2.0"); assert.equal(b.updateAvailable, true);
  assert.equal(a.canInstall, true); assert.equal(a.latest.url, `https://github.com/${repository}/releases/tag/v1.2.0`);
  await f.manager.check(); assert.equal(f.events.length, 1);
  f.tick(60001); await f.manager.check(); assert.equal(f.events.length, 2);
  assert.doesNotMatch(JSON.stringify(a), /ptr-secret|secret-canary|portainer\.test/);
});

test("fehlende, ungültige und nicht erreichbare Releases bedeuten nicht aktuell", async t => {
  for (const reply of [() => new Response("", { status: 404 }), () => new Response("", { status: 429 }), () => Response.json({ tag_name: "v2.0.0", prerelease: true }), () => new Response("x".repeat(1024 * 1024 + 1)), () => { throw new Error("secret transport detail"); }]) {
    const f = fixture(t, { fetchImpl: async () => reply() });
    const status = await f.manager.check();
    assert.ok(status.checkError); assert.equal(status.updateAvailable, false); assert.equal(status.canInstall, false);
    assert.doesNotMatch(JSON.stringify(status), /secret transport detail/);
  }
});

test("ändert nur den Image-Tag und übernimmt Compose, Volume und sonstige Variablen", () => {
  const payload = deploymentPayload(stack, { StackFileContent: content }, { stackId: "12", endpointId: "1", repository }, "1.2.0");
  assert.equal(payload.StackFileContent, content);
  assert.deepEqual(payload.Env, [{ name: "KEEP_SECRET", value: "secret-canary" }, { name: "CRYPTOBUCH_IMAGE_TAG", value: "1.2.0" }]);
  assert.equal(payload.Prune, false); assert.equal(payload.PullImage, true); assert.equal(payload.RepullImageAndRedeploy, true);
  assert.equal(stack.Env[0].value, "1.0.0");
});

test("lehnt fremde, Git-, Build-, Swarm- und mehrdeutige Stacks ab", () => {
  const config = { stackId: "12", endpointId: "1", repository };
  for (const invalid of [{ ...stack, Id: 99 }, { ...stack, EndpointId: 9 }, { ...stack, Type: 1 }, { ...stack, GitConfig: {} }, { ...stack, AutoUpdate: {} }, { ...stack, WorkflowID: 1 }, { ...stack, WorkflowId: 1 }, { ...stack, Env: null }]) {
    assert.throws(() => deploymentPayload(invalid, { StackFileContent: content }, config, "1.2.0"));
  }
  for (const invalid of [content + "    build: .\n", content + "# ${CRYPTOBUCH_IMAGE_TAG}", content.replace("404gamernotfound", "someone-else"), content.replace("${CRYPTOBUCH_IMAGE_TAG}", "latest")]) {
    assert.throws(() => deploymentPayload(stack, { StackFileContent: invalid }, config, "1.2.0"));
  }
});

test("sichert vor dem PUT, persistiert ohne Secrets und bestätigt erst die gestartete Zielversion", async t => {
  const f = fixture(t);
  const result = await f.manager.install("1.2.0");
  assert.equal(result.attempt.status, "accepted"); assert.equal(result.deploying, true); assert.equal(result.canInstall, false);
  assert.equal(f.events.filter(event => event.options?.method === "PUT").length, 1);
  const disk = fs.readFileSync(path.join(f.dataDir, "application-update.json"), "utf8");
  assert.doesNotMatch(disk, /secret|portainer\.test/);
  assert.equal(fs.statSync(path.join(f.dataDir, "application-update.json")).mode & 0o777, 0o600);
  await assert.rejects(f.manager.install("1.2.0"), /bereits/);
  const oldRestart = createApplicationUpdates(f.options);
  assert.equal(oldRestart.status().attempt.status, "unknown");
  const newRestart = createApplicationUpdates({ ...f.options, version: "1.2.0" });
  assert.equal(newRestart.status().attempt.status, "success"); assert.equal(newRestart.status().deploying, false);
});

test("ohne Anmeldung, bei laufenden Jobs, falscher Version und Backup-Fehler kein Deployment", async t => {
  const cases = [
    { options: { protectedMode: () => false }, target: "1.2.0", message: /Passwortschutz/ },
    { options: { busy: () => true }, target: "1.2.0", message: /Hintergrundjob/ },
    { options: {}, target: "1.1.0", message: /bestätigt/ },
    { options: {}, target: "0.9.0", message: /bestätigt/ },
    { options: { backup: async () => { throw new Error("private path"); } }, target: "1.2.0", message: /Datenbanksicherung/ },
  ];
  for (const c of cases) {
    const f = fixture(t, c.options);
    await assert.rejects(f.manager.install(c.target), c.message);
    assert.equal(f.events.filter(event => event.options?.method === "PUT").length, 0);
    assert.equal(f.manager.isDeploying(), false);
  }
});

test("parallele Installationsklicks erzeugen genau einen Auftrag", async t => {
  const f = fixture(t);
  const first = f.manager.install("1.2.0");
  await assert.rejects(f.manager.install("1.2.0"), /bereits/);
  await first;
  assert.equal(f.events.filter(event => event.options?.method === "PUT").length, 1);
});

test("unklarer PUT wird nicht wiederholt und benötigt eine spätere ausdrückliche Freigabe", async t => {
  let resumeCount = 0;
  const f = fixture(t, { resume: () => { resumeCount++; } });
  const fetchImpl = f.options.fetchImpl;
  const manager = createApplicationUpdates({ ...f.options, fetchImpl: async (url, options) => {
    if (options.method === "PUT") throw new Error("timeout with private token");
    return fetchImpl(url, options);
  } });
  await assert.rejects(manager.install("1.2.0"), /unklar/);
  assert.equal(manager.status().attempt.status, "unknown"); assert.equal(manager.status().deploying, true);
  assert.doesNotMatch(JSON.stringify(manager.status()), /private token/);
  assert.throws(() => manager.acknowledge(), /15 Minuten/);
  await assert.rejects(manager.install("1.2.0"), /bereits/);
  f.tick(15 * 60 * 1000);
  assert.equal(manager.acknowledge().attempt.status, "reviewed"); assert.equal(manager.isDeploying(), false); assert.equal(resumeCount, 1);
});

test("defekter persistierter Status sperrt Updates ohne die Datei zu überschreiben", async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dataDir, "application-update.json"), "broken");
  const manager = createApplicationUpdates(f.options);
  assert.match(manager.status().configurationError, /nicht lesbar/);
  await assert.rejects(manager.install("1.2.0"), /nicht lesbar/);
  assert.equal(fs.readFileSync(path.join(f.dataDir, "application-update.json"), "utf8"), "broken");
});
