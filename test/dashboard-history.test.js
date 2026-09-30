const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const markup = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

test("zeigt im Dashboard filterbaren zeitproportionalen Verlauf oder einen erklärten Leerzustand", () => {
  assert.match(source, /Für einen Verlauf werden mindestens zwei bewertete Tage benötigt\./);
  assert.match(source, /polyline\.setAttribute\("stroke", "#0b704a"\)/);
  assert.match(source, /point\.timestamp - firstTimestamp/);
  assert.match(source, /const HISTORY_RANGES/);
  assert.match(source, /renderHistoryChart\(state\.portfolio\?\.insights\?\.valueHistory\)/);
  for (const range of ["day", "month", "year", "fiveYears", "max"]) {
    assert.match(markup, new RegExp(`data-history-range="${range}"`));
  }
});
