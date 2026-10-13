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

test('vergleicht vollständige Hashes, ignoriert interne IDs und lehnt widersprüchliche Hashes ab', () => {
  const outgoing = { direction: 'out', asset: 'ADA', amount: 47.119979, fee: 0.180021, feeAsset: 'ADA', timestamp: at, hash: 'a'.repeat(64) };
  const incoming = { direction: 'in', asset: 'ADA', amount: 47.119979, timestamp: at, hash: 'A'.repeat(64) };
  assert.equal(matchExchangeTransfer(outgoing, incoming).hashMatched, true);
  assert.equal(matchExchangeTransfer(outgoing, incoming).feeAdjusted, false);
  assert.equal(matchExchangeTransfer(outgoing, { ...incoming, hash: 'b'.repeat(64) }), null);
  assert.equal(matchExchangeTransfer(outgoing, { ...incoming, hash: '88a865d502…f2c04f1' }).hashMatched, false);
  assert.equal(matchExchangeTransfer({ ...outgoing, hash: 'provider:1' }, { ...incoming, hash: 'provider:1' }).hashMatched, false);
  assert.equal(matchExchangeTransfer(outgoing, { ...incoming, amount: 1000 }), null);
});

test('berücksichtigt die Gebühr des Ausgangs auch wenn die Börse Empfänger ist', () => {
  const outgoing = { direction: 'out', asset: 'ADA', amount: 50, fee: 1, feeAsset: 'ADA', timestamp: at };
  const incoming = { direction: 'in', asset: 'ADA', amount: 49, timestamp: at };
  assert.equal(matchExchangeTransfer(incoming, outgoing).feeAdjusted, true);
  assert.equal(matchExchangeTransfer({ ...incoming, wallet_id: 1 }, { ...outgoing, wallet_id: 1 }), null);
});
