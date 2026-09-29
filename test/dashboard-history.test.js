const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

test("zeigt im Dashboard entweder einen sichtbaren Verlauf oder einen erklärten Leerzustand", () => {
  assert.match(source, /Für einen Verlauf werden mindestens zwei bewertete Tage benötigt\./);
  assert.match(source, /polyline\.setAttribute\("stroke", "#0b704a"\)/);
  assert.match(source, /Array\.isArray\(insights\.valueHistory\)/);
});
