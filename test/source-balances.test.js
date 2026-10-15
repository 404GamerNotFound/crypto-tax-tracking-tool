const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSourceBalances } = require('../lib/source-balances');

test('trennt gleich benannte Quellen und genaue Asset-IDs, sortiert nach Guthaben', () => {
  const sources = buildSourceBalances([
    { walletId: 1, label: 'Konto', sourceType: 'exchange', basis: 'exchange_snapshot', observedAt: '2026-10-14T12:00:00Z', positions: new Map([['ADA', 30]]) },
    { walletId: 2, label: 'Konto', sourceType: 'address', basis: 'journal', positions: new Map([['ADA', 100], ['ETH:contract-a', 4], ['ETH:contract-b', 5]]) },
  ]);
  assert.deepEqual(sources.ADA.map(row => row.walletId), [2, 1]);
  assert.equal(sources.ADA[1].observedAt, '2026-10-14T12:00:00.000Z');
  assert.equal(sources['ETH:contract-a'][0].amount, 4);
  assert.equal(sources['ETH:contract-b'][0].amount, 5);
});

test('kennzeichnet negative Journalsalden statt sie als echtes Guthaben zu verschweigen', () => {
  const sources = buildSourceBalances([{ walletId: 3, sourceType: 'address', basis: 'journal', positions: new Map([['ADA', -10], ['BTC', 0], ['ETH', NaN]]) }]);
  assert.equal(sources.ADA[0].incomplete, true);
  assert.equal(sources.ADA[0].label, 'Wallet #3');
  assert.equal(sources.ADA[0].amount, -10);
  assert.deepEqual(Object.keys(sources), ['ADA']);
});

test('normalisiert SQLite-Zeitstempel als UTC und lässt unbekannte Stände leer', () => {
  const sources = buildSourceBalances([
    { walletId: 1, basis: 'exchange_snapshot', observedAt: '2026-10-14 12:00:00', positions: new Map([['ADA', 1]]) },
    { walletId: 2, basis: 'journal', positions: new Map([['ADA', 2]]) },
  ]);
  assert.equal(sources.ADA[1].observedAt, '2026-10-14T12:00:00.000Z');
  assert.equal(sources.ADA[0].observedAt, null);
});

test('übernimmt Hinweise auf reine Reward-Teilbestände in die Quellenanzeige', () => {
  const sources=buildSourceBalances([{walletId:9,sourceType:'stake',basis:'journal',incompleteReason:'rewards_only',positions:new Map([['ADA',102]])}]);
  assert.equal(sources.ADA[0].incomplete,true);
  assert.equal(sources.ADA[0].incompleteReason,'rewards_only');
});

test('erhält auf null begrenzte Börsendefizite und trennt bestätigten Saldo von lückenhafter Historie', () => {
  const result = buildSourceBalances([
    { walletId: 1, sourceType: 'exchange', basis: 'journal', positions: new Map(), reconciliations: [{ asset:'ADA', journalAmount:-271.58, balanceAmount:0 }] },
    { walletId: 2, sourceType: 'exchange', basis: 'exchange_snapshot', positions: new Map(), reconciliations: [{ asset:'ADA', journalAmount:1.5, balanceAmount:0 }] },
  ]);
  const unknown = result.ADA.find(row=>row.walletId===1);
  assert.equal(unknown.amount,0);
  assert.equal(unknown.journalAmount,-271.58);
  assert.equal(unknown.incomplete,true);
  const confirmed = result.ADA.find(row=>row.walletId===2);
  assert.equal(confirmed.incomplete,false);
  assert.equal(confirmed.historyIncomplete,true);
});
