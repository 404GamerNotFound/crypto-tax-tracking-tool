const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const publicDir = path.join(__dirname, "..", "public");

test("zentralisiert Zweck-, Quellen- und API-Helfer im Browser", async () => {
  const source = fs.readFileSync(path.join(publicDir, "ui.js"), "utf8");
  const context = {
    Intl,
    Object,
    String,
    Number,
    clearTimeout() {},
    document: {
      createElement: (tag) => ({ tag, className: "", textContent: "" }),
      getElementById: () => null,
    },
    fetch: async () => ({ status: 200, ok: true, json: async () => ({ ok: true }) }),
    window: { setTimeout: () => 1 },
  };
  vm.runInNewContext(source, context, { filename: "ui.js" });
  const ui = context.window.CryptoBuchUI;

  assert.equal(ui.exchangeProviderLabel("bsdex"), "BSDEX");
  assert.equal(ui.priceProviderLabel("bsdex-api"), "BSDEX-API");
  assert.deepEqual(JSON.parse(JSON.stringify(ui.purposeInfo({ purpose: "Transfer", purpose_origin: "manual" }))), {
    icon: "↔", tone: "transfer", label: "Transfer", origin: "manuell zugeordnet",
  });
  assert.deepEqual(await ui.api("/api/example"), { ok: true });
});

test("lädt die gemeinsame Browserhilfe vor allen Seiten-Skripten", () => {
  const pages = {
    "index.html": "app.js",
    "asset.html": "asset.js",
    "exchange.html": "exchange.js",
    "maintenance.html": "maintenance.js",
    "price-fetches.html": "price-fetches.js",
    "quality.html": "quality.js",
    "settings.html": "settings.js",
    "tax.html": "tax.js",
    "tax-print.html": "tax-print.js",
    "wallets.html": "wallets.js",
  };
  for (const [page, script] of Object.entries(pages)) {
    const html = fs.readFileSync(path.join(publicDir, page), "utf8");
    assert.ok(html.indexOf("/ui.js?") >= 0, page);
    assert.ok(html.indexOf("/ui.js?") < html.indexOf(`/${script}?`), page);
  }
});
