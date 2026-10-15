const test = require("node:test");
const assert = require("node:assert/strict");
const { parseBsdexCsv, bsdexTimestamp, bsdexDecimal, HEADERS } = require("../lib/bsdex-csv");
const { mergeBsdexExports } = require("../lib/bsdex-web");
const header = HEADERS.join(",");
const buy = 'buy-1,buy,2021-08-30 15:53:49 +0000,0.04,ETH,100.0,EUR,0.35,EUR,,';
const csv = (...rows) => header + "\n" + rows.join("\n");

test("BSDEX-Originalformat: EUR, Trades, Gebühren und Transfers bleiben getrennt", () => {
  const result = parseBsdexCsv(csv(
    'fiat-1,deposit,2021-08-29 13:00:00 +0000,100.35,EUR,,"",,,PRIVATE-SENDER,PRIVATE-RECIPIENT', buy,
    'out-1,withdrawal,2021-08-31 16:04:58 +0000,,"",0.04,ETH,,,ADDRESS,ADDRESS',
    'in-1,deposit,2022-01-01 16:04:58 +0000,0.1,BTC,,"",,,,',
    'sell-1,sell,2022-01-02 16:04:58 +0000,250.0,EUR,0.1,BTC,0.5,EUR,,',
  ));
  assert.equal(result.sourceRows, 5); assert.equal(result.fiatRows, 1); assert.equal(result.rows.length, 4);
  assert.equal(result.rows[0].priceEur, 2500); assert.equal(result.rows[0].fee, 0.35); assert.equal(result.rows[0].feeAsset, "EUR");
  assert.equal(result.rows[0].timestamp, "2021-08-30T15:53:49.000Z");
  assert.equal(result.rows[1].purpose, "Transfer"); assert.equal(result.rows[1].priceEur, null); assert.equal(result.rows[1].direction, "out");
  assert.equal(result.rows[3].purpose, "Verkauf"); assert.equal(result.rows[3].priceEur, 2500);
  assert.ok(!JSON.stringify(result).includes("PRIVATE")); assert.ok(!JSON.stringify(result).includes("ADDRESS"));
});

test("BSDEX: stabile IDs über Wiederholungen, Jahresdateien und CSV/Web", () => {
  assert.equal(parseBsdexCsv(csv(buy, buy)).rows.length, 1);
  const result = mergeBsdexExports([{ year: 2021, text: csv(buy) }, { year: 2022, text: csv(buy) }]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].externalId, "bsdex:csv:buy-1:in:ETH");
  assert.throws(() => mergeBsdexExports([{ year: 2021, text: csv(buy) }, { year: 2022, text: csv(buy.replace('100.0', '101.0')) }]), /unterschiedliche Werte/);
});

test("BSDEX: Dezimalpunkt und explizite Zeitzone werden nicht umgedeutet", () => {
  assert.equal(bsdexDecimal("0.001"), 0.001); assert.equal(bsdexDecimal("" ,{ optional: true }), null);
  for (const value of ["1,234", "1.234.567", "-1", "NaN", "", "1e5"]) assert.throws(() => bsdexDecimal(value));
  assert.equal(bsdexTimestamp("2021-08-30 15:53:49 +0200"), "2021-08-30T13:53:49.000Z");
  for (const value of ["2021-02-29 00:00:00 +0000", "2021-08-30 25:00:00 +0000", "2021-08-30 15:53:49", "2021-08-30 15:53:49 +1460"]) assert.throws(() => bsdexTimestamp(value));
});

test("BSDEX: unbekannte Typen, unvollständige Felder und widersprüchliche IDs brechen atomar ab", () => {
  assert.throws(() => parseBsdexCsv(csv(buy, buy.replace(',buy,', ',unknown,'))), /Unbekannter Buchungstyp/);
  assert.throws(() => parseBsdexCsv(csv(buy, buy.replace('100.0', '101.0'))), /widersprüchliche Werte/);
  assert.throws(() => parseBsdexCsv(csv(buy.replace(',EUR,0.35,EUR', ',USD,0.35,USD'))), /gegen EUR/);
  assert.throws(() => parseBsdexCsv(csv(buy.replace(',0.35,EUR,', ',0.35,,') )), /Gebührenwährung/);
  assert.throws(() => parseBsdexCsv(csv(buy + ',')), /Spalten/);
  assert.throws(() => parseBsdexCsv(csv(buy + 'abc"')), /Feldbegrenzung/);
  assert.throws(() => parseBsdexCsv(header + '\n"unfinished'), /geschlossenes Textfeld/);
});

test("BSDEX: leere Jahre, BOM/CRLF und Hard-Limit einschließlich Fiat-Zeilen", () => {
  assert.equal(parseBsdexCsv(header).rows.length, 0);
  assert.equal(parseBsdexCsv('\uFEFF' + csv(buy).replaceAll('\n', '\r\n')).rows.length, 1);
  assert.throws(() => parseBsdexCsv(csv(...Array.from({ length: 2501 }, (_, i) => buy.replace('buy-1', `buy-${i}`)))), /2.500/);
  assert.throws(() => mergeBsdexExports([{ year: 2021, text: csv(...Array(1500).fill(buy)) }, { year: 2022, text: csv(...Array(1500).fill(buy)) }]), /2.500/);
});
