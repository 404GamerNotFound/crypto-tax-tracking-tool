const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const publicDir = path.join(__dirname, "..", "public");
const pages = [
  "index.html", "wallets.html", "asset.html", "exchange.html", "quality.html",
  "price-fetches.html", "tax.html", "tax-print.html", "maintenance.html", "settings.html",
];

test("bindet die zentrale Hauptnavigation auf jeder Oberfläche ein", () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(publicDir, page), "utf8");
    assert.match(html, /<nav class="topbar-nav" aria-label="Hauptnavigation" data-primary-navigation><\/nav>/, page);
    assert.match(html, /<script src="\/navigation\.js\?v=20260929-2" defer><\/script>/, page);
    assert.doesNotMatch(html, /<a class="topbar-link/, `${page} enthält keine kopierte Navigation mehr`);
  }
});

test("definiert die Navigation und Detailseiten-Zuordnung zentral", () => {
  const source = fs.readFileSync(path.join(publicDir, "navigation.js"), "utf8");
  for (const label of ["Dashboard", "Crypto-Bestände", "Datenqualität", "Steuerzentrum", "Betrieb", "Einstellungen"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
  assert.match(source, /"\/asset\.html": "\/wallets\.html"/);
  assert.match(source, /"\/exchange\.html": "\/wallets\.html"/);
  assert.match(source, /"\/price-fetches\.html": "\/quality\.html"/);
  assert.match(source, /"\/tax-print\.html": "\/tax\.html"/);
});

test("definiert lokale Untermenüs zentral und bindet sie in die passenden Bereiche ein", () => {
  const source = fs.readFileSync(path.join(publicDir, "navigation.js"), "utf8");
  for (const label of ["Wallets", "Börsenkonten", "Kursdaten", "Transfers", "Planung", "Archiv & Exporte", "Daten zurücksetzen", "Preis- & API-Daten"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
  const pagesWithSectionNavigation = {
    "wallets.html": "wallets",
    "quality.html": "quality",
    "price-fetches.html": "quality",
    "tax.html": "tax",
    "maintenance.html": "maintenance",
    "settings.html": "settings",
  };
  for (const [page, key] of Object.entries(pagesWithSectionNavigation)) {
    const html = fs.readFileSync(path.join(publicDir, page), "utf8");
    assert.match(html, new RegExp(`<nav class="section-subnav"[^>]*data-section-navigation="${key}"><\\/nav>`), page);
  }
});
