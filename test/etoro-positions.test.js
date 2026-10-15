const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { positionKind, normalizeEtoroPosition, initializeEtoroPositions, saveEtoroPositions, etoroPositionsView } = require('../lib/etoro-positions');
const { normalizeEtoroHistoricalTrade, fetchEtoroHistory } = require('../lib/etoro');
const instrument = { instrumentID: 42, symbolFull: 'BTC', instrumentDisplayName: 'Bitcoin' };
const closed = { positionId: 12, orderId: 20, instrumentId: 42, isBuy: true, leverage: 1, units: 0.25, settlementTypeID: 0,
  openTimestamp: '2025-01-01T10:00:00Z', closeTimestamp: '2025-02-01T10:00:00Z', investment: 100, fees: 2, netProfit: -15 };
const opened = { positionID: 12, instrumentID: 42, settlementTypeID: 0, isBuy: false, leverage: 2, units: 0.1,
  openDateTime: '2025-01-01T10:00:00Z', amount: 80, totalFees: -0.5, unrealizedPnL: { pnL: 0 } };

test('CFDs mit Hebel 1, Shorts und unklare Produktarten erzeugen keine Coin-Lots', () => {
  for (const overrides of [{}, { settlementTypeID: undefined, isCFD: true }, { settlementTypeID: undefined, isBuy: false }, { settlementTypeID: undefined }]) {
    const result = normalizeEtoroHistoricalTrade({ ...closed, ...overrides }, instrument);
    assert.equal(result.rows.length, 0);
    assert.equal(result.positions.length, 1);
  }
  assert.equal(positionKind({ leverage: 1 }), 'unknown');
  assert.equal(positionKind({ settlementTypeID: 3, isBuy: false }), 'derivative');
  assert.equal(normalizeEtoroHistoricalTrade({ ...closed, settlementTypeID: 1 }, instrument).rows.length, 2);
  const equity = normalizeEtoroHistoricalTrade(closed, { symbolFull: 'AAPL' });
  assert.equal(equity.positions[0].symbol, 'AAPL');
});

test('bewahrt Netto-Ergebnis, Gebührenvorzeichen, Nullwerte und fehlende Währungen', () => {
  const result = normalizeEtoroPosition(closed, instrument);
  assert.equal(result.profit, -15);
  assert.equal(result.profitCurrency, null);
  assert.equal(result.fees, 2);
  const open = normalizeEtoroPosition(opened, instrument, { status: 'open', accountCurrency: 'USD' });
  assert.equal(open.profit, 0);
  assert.equal(open.fees, -0.5);
  assert.equal(open.profitCurrency, 'USD');
  assert.equal(open.side, 'short');
  const missing = normalizeEtoroPosition({ ...closed, fees: null, netProfit: null, units: null }, instrument);
  assert.equal(missing.profit, null); assert.equal(missing.fees, null); assert.equal(missing.units, null);
  assert.equal(normalizeEtoroPosition({ ...closed, closeTimestamp: '2024-01-01' }, instrument), null);
});

test('speichert Teilschließungen und offenen Rest idempotent pro Konto und markiert verschwundene Positionen', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE exchange_connections(id INTEGER PRIMARY KEY); INSERT INTO exchange_connections VALUES (1),(2)');
    initializeEtoroPositions(db); initializeEtoroPositions(db);
    const partial = normalizeEtoroPosition(closed, instrument);
    const second = normalizeEtoroPosition({ ...closed, orderId: 21, closeTimestamp: '2025-03-01', units: 0.1 }, instrument);
    const open = normalizeEtoroPosition(opened, instrument, { status: 'open' });
    saveEtoroPositions(db, 1, [partial, second, open], { openSnapshotComplete: true });
    saveEtoroPositions(db, 1, [partial, second, open], { openSnapshotComplete: true });
    saveEtoroPositions(db, 2, [partial]);
    assert.equal(etoroPositionsView(db, 1).length, 3);
    saveEtoroPositions(db, 1, []); // Failed/incomplete snapshot preserves previous status.
    assert.equal(etoroPositionsView(db, 1).find(p => p.externalId === open.externalId).status, 'open');
    saveEtoroPositions(db, 1, [], { openSnapshotComplete: true });
    assert.equal(etoroPositionsView(db, 1).find(p => p.externalId === open.externalId).status, 'unconfirmed');
    assert.equal(etoroPositionsView(db, 1).filter(p => p.status === 'closed').length, 2);
    db.exec('DELETE FROM exchange_connections WHERE id=1');
    assert.equal(etoroPositionsView(db, 1).length, 0);
    assert.equal(etoroPositionsView(db, 2).length, 1);
  } finally { db.close(); }
});

test('lädt historische CFDs und offene Copy-Positionen seriell mit gemeinsamen GET-Headern', async () => {
  let active = 0, maximum = 0;
  const paths = [];
  const result = await fetchEtoroHistory({ startDate: '2025-01-01', endDate: '2025-12-31', requestGapMs: 0,
    fetchImpl: async (url, options) => {
      active++; maximum = Math.max(maximum, active); paths.push(url.pathname);
      assert.equal(options.method, 'GET');
      assert.ok(options.headers['x-request-id']);
      await new Promise(resolve => setImmediate(resolve));
      active--;
      const payload = url.pathname.endsWith('/instruments') ? { instrumentDisplayDatas: [instrument] }
        : url.pathname.endsWith('/pnl') ? { clientPortfolio: { accountCurrencyId: 1, positions: [opened], mirrors: [{ positions: [opened] }] } }
          : [closed, closed];
      return Response.json(payload);
    },
  });
  assert.equal(maximum, 1);
  assert.equal(result.rows.length, 0);
  assert.equal(result.positions.length, 2);
  assert.equal(result.positions[0].profitCurrency, 'USD');
  assert.equal(result.openSnapshotComplete, true);
  assert.ok(paths.includes('/api/v1/trading/info/real/pnl'));
});

test('Importgrenze trennt kein Spot-Paar; fehlerhafter Snapshot bleibt erkennbar', async () => {
  const result = await fetchEtoroHistory({ startDate: '2025-01-01', endDate: '2025-12-31', requestGapMs: 0, maxItems: 1,
    fetchImpl: async url => Response.json(url.pathname.endsWith('/instruments') ? { instrumentDisplayDatas: [instrument] }
      : url.pathname.endsWith('/pnl') ? {} : [{ ...closed, settlementTypeID: 1 }]),
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.limited, true);
  assert.equal(result.openSnapshotComplete, false);
  assert.match(result.warnings.join(' '), /Positions-Snapshot/);
});
