const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cryptobuch-settings-runtime-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dataDir;
const { runtimeSettings, settingsResponse } = require("../server");

test.after(() => {
  process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("stellt alle Read-only-Endpunkte in der Laufzeitkonfiguration bereit", () => {
  const settings = runtimeSettings();
  assert.match(settings.ethereumRpcUrl, /^https:\/\//);
  assert.match(settings.bsdexApiBaseUrl, /^https:\/\//);
  assert.equal(settingsResponse().ethereumRpcUrl, settings.ethereumRpcUrl);
});
