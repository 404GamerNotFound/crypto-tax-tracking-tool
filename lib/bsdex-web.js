"use strict";

const { APP_ORIGIN, openBsdexBrowser } = require("./bsdex-web-session");
const { parseBsdexCsv, MAX_ROWS, MAX_BYTES } = require("./bsdex-csv");
const HISTORY_URL = APP_ORIGIN + "/settings/transactionhistory";
const fail = (message, code) => Object.assign(new Error(message), { status: 400, code });

function mergeBsdexExports(exports) {
  const entries = new Map(); let sourceRows = 0, fiatRows = 0;
  for (const file of exports) {
    const parsed = parseBsdexCsv(file.text);
    sourceRows += parsed.sourceRows; fiatRows += parsed.fiatRows;
    if (sourceRows > MAX_ROWS) throw fail("BSDEX-Web-Import: mehr als 2.500 Exportzeilen. Bitte die Jahresdateien einzeln über das BSDEX-CSV-Profil importieren.");
    for (const row of parsed.rows) {
      const prior = entries.get(row.externalId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw fail("BSDEX-Web-Import: dieselbe Buchungs-ID hat in mehreren Jahresdateien unterschiedliche Werte. Es wurden keine Buchungen übernommen.");
      entries.set(row.externalId, row);
    }
  }
  return { rows: [...entries.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.externalId.localeCompare(b.externalId)),
    sourceRows, fiatRows, years: exports.map(file => file.year) };
}

async function readBsdexDownload(download) {
  const stream = await download.createReadStream();
  if (!stream) throw fail("BSDEX hat keine lesbare CSV-Datei bereitgestellt.");
  let bytes = 0; const chunks = [];
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw fail("BSDEX-Export überschreitet die zulässigen 5 MB.");
      chunks.push(chunk);
    }
    // A replacement character would corrupt identifiers and amounts silently.
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally { stream.destroy(); await download.delete().catch(() => {}); }
}

async function fetchBsdexWebHistory({ storageState, openBrowser = openBsdexBrowser, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!Array.isArray(storageState?.cookies) || !Array.isArray(storageState?.origins)) throw fail("Die BSDEX-Websitzung fehlt. Bitte erneut anmelden.", "BSDEX_LOGIN_REQUIRED");
  let instance;
  try {
    instance = await openBrowser({ storageState });
    const { page, context } = instance;
    await page.goto(HISTORY_URL);
    try { await page.locator("h2").filter({ hasText: /^20\d{2}$/ }).first().waitFor({ state: "visible" }); }
    catch {
      if (new URL(page.url()).origin !== APP_ORIGIN || /\/signin(?:\/|$)/.test(new URL(page.url()).pathname)) {
        throw fail("Die BSDEX-Websitzung ist abgelaufen. Bitte erneut anmelden.", "BSDEX_LOGIN_REQUIRED");
      }
      throw fail("BSDEX zeigt keine unterstützte Jahresübersicht. Bitte die Web-Anmeldung oder eine neue Sicherheitsabfrage direkt bei BSDEX prüfen.");
    }
    if (page.url().split(/[?#]/)[0] !== HISTORY_URL) throw fail("Die BSDEX-Historienseite hat sich geändert.");
    const years = (await page.locator("h2").allTextContents()).map(value => value.trim());
    if (!years.length || years.length > 30 || new Set(years).size !== years.length || years.some(year => !/^20\d{2}$/.test(year))) throw fail("Die BSDEX-Jahresübersicht ist unvollständig oder unbekannt.");
    const exports = [];
    for (const year of years.sort()) {
      const row = page.locator("h2").filter({ hasText: new RegExp(`^${year}$`) }).locator("xpath=../..");
      const button = row.locator("button").filter({ hasText: /^Download CSV$/ });
      if (await button.count() !== 1) throw fail("Der BSDEX-CSV-Download kann keinem eindeutigen Jahr zugeordnet werden.");
      const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
      // Attach rejection handling before the click; a failed click must not
      // leave an unhandled download timeout behind.
      downloadPromise.catch(() => {});
      await button.click();
      const download = await downloadPromise;
      const text = await readBsdexDownload(download);
      parseBsdexCsv(text); // Validate every file before returning any bookings.
      exports.push({ year: Number(year), text });
      await sleep(700);
    }
    const result = mergeBsdexExports(exports);
    return { ...result, storageState: await context.storageState(), limited: false,
      warnings: ["BSDEX-Web-Import: Bestand aus der exportierten Historie berechnet; kein bestätigter aktueller Börsensaldo."] };
  } catch (error) {
    if (error.status === 400) throw error;
    // No raw browser error, URL, cookie or downloaded CSV in logs/job output.
    throw fail("BSDEX-Web-Import fehlgeschlagen. Sitzung, CSV-Download oder geänderte BSDEX-Seite prüfen. Vorhandene Buchungen wurden nicht verändert.");
  } finally { await instance?.browser.close().catch(() => {}); }
}

module.exports = { fetchBsdexWebHistory, mergeBsdexExports, readBsdexDownload, HISTORY_URL };
