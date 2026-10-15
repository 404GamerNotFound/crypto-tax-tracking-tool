const crypto = require('node:crypto');

function valueAt(entry, paths) {
  for (const path of paths) {
    let value = entry;
    for (const key of path.split('.')) value = value?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function numberValue(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positionKind(entry) {
  const type = numberValue(valueAt(entry, ['settlementTypeID', 'settlementTypeId']));
  const cfd = valueAt(entry, ['isCFD', 'isCfd', 'isCfdPosition']);
  if (type === 0 || cfd === true) return 'cfd';
  if (type !== null) return type === 1 ? 'spot' : 'derivative';
  if (cfd === false) return 'spot';
  if (entry.isBuy === false || numberValue(entry.leverage) > 1) return 'derivative';
  // The history endpoint does not always expose settlementTypeID. Leverage 1
  // alone cannot distinguish a real asset from a CFD. Keep the evidence apart.
  return 'unknown';
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeEtoroPosition(entry, instrument, { status = 'closed', accountCurrency = null } = {}) {
  const kind = positionKind(entry);
  if (kind === 'spot') return null;
  const positionId = valueAt(entry, ['positionId', 'positionID']);
  const orderId = valueAt(entry, ['orderId', 'orderID', 'tradeId', 'id']);
  const instrumentId = numberValue(valueAt(entry, ['instrumentId', 'instrumentID']));
  const openedAt = isoDate(valueAt(entry, ['openTimestamp', 'openDateTime', 'openedAt', 'openDate']));
  const closedAt = isoDate(valueAt(entry, ['closeTimestamp', 'closedAt', 'closeDate']));
  if ((!positionId && !orderId) || !instrumentId || !openedAt || (status === 'closed' && (!closedAt || closedAt < openedAt))) return null;
  const units = numberValue(valueAt(entry, ['units', 'quantity', 'closedUnits', 'positionUnits']));
  const identifier = status === 'open' ? String(positionId || orderId)
    : JSON.stringify([positionId, orderId, closedAt, units]);
  // Closing events, including partial closes, have their own identity; an
  // open remainder must not overwrite any of the closed position's evidence.
  const externalId = `etoro:${status}:${crypto.createHash('sha256').update(identifier).digest('hex')}`;
  const currency = String(valueAt(entry, ['accountCurrency', 'profitCurrency', 'currency']) || accountCurrency || '').toUpperCase();
  return {
    externalId, positionId: String(positionId || orderId).slice(0, 150), kind, status,
    instrumentId, symbol: String(valueAt(instrument, ['symbolFull', 'internalSymbolFull', 'symbol']) || valueAt(entry, ['symbol', 'instrumentName']) || `#${instrumentId}`).slice(0, 100),
    name: String(valueAt(instrument, ['instrumentDisplayName', 'displayName']) || '').slice(0, 150),
    side: entry.isBuy === true ? 'long' : entry.isBuy === false ? 'short' : null,
    leverage: numberValue(entry.leverage), units: units !== null && units >= 0 ? units : null,
    openedAt, closedAt: status === 'closed' ? closedAt : null,
    openRate: numberValue(entry.openRate), closeRate: numberValue(entry.closeRate),
    investment: numberValue(valueAt(entry, status === 'open' ? ['amount'] : ['investment', 'initialInvestment'])),
    investmentCurrency: status === 'open' ? 'USD' : (/^[A-Z]{3}$/.test(currency) ? currency : null),
    fees: numberValue(valueAt(entry, status === 'open' ? ['totalFees'] : ['fees'])),
    feesCurrency: status === 'open' ? 'USD' : (/^[A-Z]{3}$/.test(currency) ? currency : null),
    profit: numberValue(valueAt(entry, status === 'open' ? ['unrealizedPnL.pnL'] : ['netProfit'])),
    profitCurrency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    profitKind: status === 'open' ? 'unrealized' : 'realized',
  };
}

function initializeEtoroPositions(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS exchange_derivative_positions (
    connection_id INTEGER NOT NULL REFERENCES exchange_connections(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open','closed','unconfirmed')),
    position_json TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (connection_id, external_id)
  )`);
}

function saveEtoroPositions(db, connectionId, positions, { openSnapshotComplete = false, observedAt = new Date().toISOString() } = {}) {
  const upsert = db.prepare(`INSERT INTO exchange_derivative_positions (connection_id,external_id,status,position_json,observed_at)
    VALUES (?,?,?,?,?) ON CONFLICT(connection_id,external_id) DO UPDATE SET status=excluded.status,
    position_json=excluded.position_json,observed_at=excluded.observed_at`);
  db.exec('SAVEPOINT etoro_positions');
  try {
    // Missing from an authoritative snapshot is not proof of a closing price,
    // profit or timestamp. Retain the old evidence as explicitly unconfirmed.
    if (openSnapshotComplete) db.prepare("UPDATE exchange_derivative_positions SET status='unconfirmed' WHERE connection_id=? AND status='open'").run(connectionId);
    for (const position of positions) upsert.run(connectionId, position.externalId, position.status, JSON.stringify(position), observedAt);
    db.exec('RELEASE etoro_positions');
  } catch (error) { db.exec('ROLLBACK TO etoro_positions; RELEASE etoro_positions'); throw error; }
  return positions.length;
}

function etoroPositionsView(db, connectionId) {
  return db.prepare('SELECT status,position_json,observed_at FROM exchange_derivative_positions WHERE connection_id=? ORDER BY observed_at DESC,external_id').all(connectionId)
    .map(row => ({ ...JSON.parse(row.position_json), status: row.status, observedAt: row.observed_at }))
    .sort((a,b) => String(b.closedAt || b.openedAt).localeCompare(String(a.closedAt || a.openedAt)));
}

module.exports = { valueAt, numberValue, positionKind, normalizeEtoroPosition, initializeEtoroPositions, saveEtoroPositions, etoroPositionsView };
