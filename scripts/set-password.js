"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { passwordRecord, writeRecord } = require("../lib/auth");
(async () => {
  const password = fs.readFileSync(0, "utf8").replace(/\r?\n$/, "");
  const record = await passwordRecord(password);
  writeRecord(path.join(process.env.DATA_DIR || path.join(__dirname, "..", "data"), "auth.json"), record);
  console.log("Passwort-Hash gespeichert. Container/Server neu starten, um alle Sitzungen zu widerrufen und das neue Passwort zu aktivieren.");
})().catch(() => { console.error("Passwort nicht gespeichert. Mindestens 12 Zeichen und maximal 1024 UTF-8-Bytes über stdin übergeben; Datenverzeichnis muss schreibbar sein."); process.exitCode = 1; });
