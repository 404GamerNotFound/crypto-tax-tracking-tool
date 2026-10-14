const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAssetValueHistory } = require('../lib/asset-history');
const row = (day, direction, amount, price = 1) => ({ timestamp: `2025-01-${String(day).padStart(2, '0')}T00:00:00Z`, direction, amount, price_transaction_eur: price });

test('stellt negative Journalsalden als Lücke statt als Nullbestand dar', () => {
  const result = buildAssetValueHistory([row(1,'in',10),row(2,'out',20),row(3,'in',2)], { holdingAmount: 100, currentPriceEur: 2, now: Date.parse('2026-01-01') });
  assert.deepEqual(result.points.map(p=>p.value),[10,null,null,null,200]);
  assert.equal(result.missingBalanceCount,2);
  assert.equal(result.holdingMismatch,true);
  assert.equal(result.journalAmount,-8);
});
test('behält echten Nullbestand und Kurslücken auseinander und verbindet keine fehlenden Kurse', () => {
  const result=buildAssetValueHistory([row(1,'in',10),row(2,'out',10),row(3,'in',5,null)], { holdingAmount:5 });
  assert.deepEqual(result.points.map(p=>p.value),[10,0,null]);
  assert.equal(result.missingPriceCount,1);
});
test('zeigt unvollständige Teilbestände nicht als aktuellen Vergleichspunkt und bündelt gleiche Zeitpunkte', () => {
  const result=buildAssetValueHistory([row(1,'in',10),row(1,'out',2)], { holdingAmount:8,currentPriceEur:2,holdingIsPartial:true });
  assert.deepEqual(result.points.map(p=>p.value),[8]);
  assert.equal(result.points.some(p=>p.current),false);
});
