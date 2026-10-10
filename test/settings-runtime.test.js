const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cryptobuch-settings-runtime-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dataDir;
const { runtimeSettings, settingsResponse, updateSettings } = require("../server");
const { buildOpenApi } = require("../lib/api-documentation");

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

test("speichert Teiländerungen, ohne andere Bereiche oder Zugangsdaten zu verändern", () => {
  updateSettings({ tronGridApiKey: "test-only-key", xtzStakingPayoutAliases: "Test Baker" });
  const before = settingsResponse();
  const changed = updateSettings({ bulkPurposeLimit: 321 });
  assert.deepEqual(changed, { ...before, bulkPurposeLimit: 321 });
  assert.equal(runtimeSettings().tronGridApiKey, "test-only-key");
  assert.doesNotMatch(JSON.stringify(changed), /test-only-key/);

  const taxChanged = updateSettings({ taxProfile: { label: "Eigenes Profil" } });
  assert.deepEqual(taxChanged, { ...changed, taxProfile: { ...changed.taxProfile, label: "Eigenes Profil" } });
  const keyRemoved = updateSettings({ clearTronGridApiKey: true });
  assert.deepEqual(keyRemoved, { ...taxChanged, tronGridApiKeyConfigured: false });
  assert.equal(runtimeSettings().tronGridApiKey, "");
});

test("validiert Teiländerungen weiterhin und dokumentiert optionale Felder", () => {
  const before = settingsResponse();
  for (const input of [
    { bulkPurposeLimit: 2501 },
    { bitcoinExplorerBaseUrl: "https://user:password@example.com" },
    { xpubGapLimit: 50, xpubMaxDerivationsPerBranch: 49 },
    { personalTaxRatePercent: 101 },
  ]) assert.throws(() => updateSettings(input));
  assert.deepEqual(settingsResponse(), before);
  const spec = buildOpenApi(before);
  assert.deepEqual(spec.components.schemas.SettingsInput.required || [], []);
  assert.match(spec.paths["/api/settings"].put.description, /Teiländerungen/);
});
