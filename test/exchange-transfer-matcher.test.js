const test = require('node:test');
const assert = require('node:assert/strict');
const { matchExchangeTransfer } = require('../lib/exchange-transfer-matcher');

const at = '2026-09-27T10:00:00.000Z';

test('matches a Binance withdrawal with an incoming local wallet transaction', () => {
  const exchange = { id: 1, direction: 'out', asset: 'BTC', amount: 0.01, fee: 0, feeAsset: 'BTC', timestamp: at };
  const wallet = { id: 2, direction: 'in', asset: 'BTC', amount: 0.01, timestamp: '2026-09-27T10:30:00.000Z' };
  const match = matchExchangeTransfer(exchange, wallet);
  assert.equal(match.outgoing.id, 1);
  assert.equal(match.incoming.id, 2);
  assert.equal(match.feeAdjusted, false);
});

test('accounts for an exchange withdrawal fee in the reported amount', () => {
  const exchange = { id: 1, direction: 'out', asset: 'ADA', amount: 100, fee: 0.2, feeAsset: 'ADA', timestamp: at };
  const wallet = { id: 2, direction: 'in', asset: 'ADA', amount: 99.8, timestamp: '2026-09-27T10:10:00.000Z' };
  const match = matchExchangeTransfer(exchange, wallet);
  assert.equal(match.amount, 99.8);
  assert.equal(match.feeAdjusted, true);
});

test('matches a local deposit into an exchange and rejects unrelated movements', () => {
  const exchange = { id: 1, direction: 'in', asset: 'ETH', amount: 1.5, fee: 0, feeAsset: 'ETH', timestamp: at };
  const wallet = { id: 2, direction: 'out', asset: 'ETH', amount: 1.5, timestamp: '2026-09-27T11:00:00.000Z' };
  assert.equal(matchExchangeTransfer(exchange, wallet).outgoing.id, 2);
  assert.equal(matchExchangeTransfer(exchange, { ...wallet, timestamp: '2026-10-01T11:00:00.000Z' }), null);
  assert.equal(matchExchangeTransfer(exchange, { ...wallet, asset: 'BTC' }), null);
});
