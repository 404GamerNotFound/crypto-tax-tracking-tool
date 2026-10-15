"use strict";

const HEADERS = ["ID", "Typ", "Ausführung", "eingehender Betrag", "eingehendes Asset", "ausgehender Betrag", "ausgehendes Asset", "Transaktionsentgelt", "Entgeltwährung", "Sender", "Empfänger"];
const MAX_ROWS = 2500;
const MAX_BYTES = 5 * 1024 * 1024;
const fail = message => Object.assign(new Error(message), { status: 400 });

function csvRecords(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_BYTES) throw fail("BSDEX-CSV: maximal 5 MB pro Datei.");
  const input = text.replace(/^\uFEFF/, "");
  const records = []; let row = [], cell = "", quoted = false, closed = false;
  for (let i = 0; i <= input.length; i++) {
    const ch = i === input.length ? "\n" : input[i];
    if (quoted) {
      if (i === input.length) throw fail("BSDEX-CSV: nicht geschlossenes Textfeld.");
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += ch;
    } else if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(cell); cell = ""; closed = false;
      if (ch !== ',') {
        if (row.some(value => value !== "")) records.push(row);
        row = [];
        if (ch === '\r' && input[i + 1] === '\n') i++;
        if (records.length > MAX_ROWS + 1) throw fail("BSDEX-CSV: maximal 2.500 Zeilen pro Import.");
      }
    } else if (ch === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || ch === '"') throw fail("BSDEX-CSV: ungültige Feldbegrenzung.");
      cell += ch;
    }
  }
  return records;
}

function bsdexDecimal(value, { optional = false } = {}) {
  if (optional && value === "") return null;
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw fail("BSDEX-CSV: ungültige Zahl; erwartet wird das unveränderte Exportformat mit Dezimalpunkt.");
  const number = Number(value);
  if (!Number.isFinite(number) || number > Number.MAX_SAFE_INTEGER) throw fail("BSDEX-CSV: Zahl außerhalb des unterstützten Bereichs.");
  return number;
}

function bsdexTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(value);
  if (!match) throw fail("BSDEX-CSV: Ausführungszeit mit Zeitzone fehlt oder hat ein unbekanntes Format.");
  const [, y, m, d, h, min, sec, sign, oh, om] = match;
  const local = new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +sec));
  if (local.getUTCFullYear() !== +y || local.getUTCMonth() !== +m - 1 || local.getUTCDate() !== +d || +h > 23 || +min > 59 || +sec > 59 || +oh > 14 || +om > 59 || +oh === 14 && +om !== 0) throw fail("BSDEX-CSV: ungültiges Datum.");
  return new Date(local.getTime() - (sign === '+' ? 1 : -1) * (+oh * 60 + +om) * 60000).toISOString();
}

function parseBsdexCsv(text) {
  const records = csvRecords(text);
  if (!records.length || records[0].length !== HEADERS.length || records[0].some((value, i) => value !== HEADERS[i])) {
    throw fail("BSDEX-CSV: unbekannte Spalten. Bitte die originale deutsche Transaktionshistorie als CSV verwenden.");
  }
  const rows = [], seen = new Map(); let fiatRows = 0;
  for (const [index, cells] of records.slice(1).entries()) {
    try {
      if (cells.length !== HEADERS.length) throw fail("Die Anzahl der Spalten stimmt nicht.");
      const [id, type, time, incoming, inAsset, outgoing, outAsset, feeText, feeAsset] = cells;
      if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw fail("Eine gültige Buchungs-ID fehlt oder sie ist zu lang.");
      if (!["buy", "sell", "deposit", "withdrawal"].includes(type)) throw fail(`Unbekannter Buchungstyp „${String(type).slice(0, 50)}“.`);
      const timestamp = bsdexTimestamp(time);
      const amountIn = bsdexDecimal(incoming, { optional: true });
      const amountOut = bsdexDecimal(outgoing, { optional: true });
      const fee = bsdexDecimal(feeText, { optional: true }) ?? 0;
      for (const symbol of [inAsset, outAsset, feeAsset].filter(Boolean)) if (!/^[A-Z][A-Z0-9]{1,19}$/.test(symbol)) throw fail("Unbekanntes Asset-Format.");
      if ((amountIn !== null) !== Boolean(inAsset) || (amountOut !== null) !== Boolean(outAsset) || fee > 0 && !feeAsset) throw fail("Menge und Asset beziehungsweise Gebührenwährung passen nicht zusammen.");
      if (amountIn !== null && amountIn <= 0 || amountOut !== null && amountOut <= 0) throw fail("Die Buchungsmenge muss positiv sein.");
      if (type === "deposit" && (amountIn === null || amountOut !== null) || type === "withdrawal" && (amountOut === null || amountIn !== null)) throw fail("Ein-/Auszahlung enthält widersprüchliche Beträge.");
      const trade = type === "buy" || type === "sell";
      if (trade && (amountIn === null || amountOut === null || (type === "buy" ? outAsset !== "EUR" || inAsset === "EUR" : inAsset !== "EUR" || outAsset === "EUR"))) throw fail("Unterstützt werden eindeutige Käufe/Verkäufe gegen EUR.");
      const direction = ["buy", "deposit"].includes(type) ? "in" : "out";
      const asset = direction === "in" ? inAsset : outAsset;
      const amount = direction === "in" ? amountIn : amountOut;
      const key = `${id}:${direction}:${asset}`;
      const signature = JSON.stringify(cells.slice(0, 9));
      if (seen.has(key)) {
        if (seen.get(key) !== signature) throw fail("Eine Buchungs-ID hat widersprüchliche Werte.");
        continue;
      }
      seen.set(key, signature);
      if (asset === "EUR") { fiatRows++; continue; }
      if (fee > 0 && ![asset, "EUR"].includes(feeAsset)) throw fail("Die Gebührenwährung wird für diese Buchung nicht unterstützt.");
      const priceEur = trade ? (direction === "in" ? amountOut : amountIn) / amount : null;
      if (trade && (!Number.isFinite(priceEur) || priceEur <= 0)) throw fail("Der EUR-Belegkurs liegt außerhalb des unterstützten Bereichs.");
      rows.push({
        externalId: `bsdex:csv:${key}`, hash: `bsdex:csv:${id}`, timestamp, direction, asset, amount,
        fee, feeAsset: feeAsset || asset,
        priceEur,
        purpose: type === "buy" ? "Kauf" : type === "sell" ? "Verkauf" : "Transfer", counterparty: "BSDEX",
        // No personal contact details or fiat account numbers are persisted.
        raw: Object.fromEntries(HEADERS.slice(0, 9).map((header, i) => [header, cells[i]])),
      });
    } catch (error) { throw fail(`BSDEX-CSV, Zeile ${index + 2}: ${error.message}`); }
  }
  return { rows, sourceRows: records.length - 1, fiatRows };
}

module.exports = { parseBsdexCsv, bsdexDecimal, bsdexTimestamp, MAX_ROWS, MAX_BYTES, HEADERS };
