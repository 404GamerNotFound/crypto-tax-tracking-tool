const test = require("node:test");
const assert = require("node:assert/strict");
const { LOVELACE_PER_ADA, lovelaceFromAmounts, normalizeCardanoTransaction } = require("../lib/cardano");

const wallet = `addr1${"q".repeat(98)}`;
const sender = `addr1${"p".repeat(98)}`;
const recipient = `addr1${"r".repeat(98)}`;

test("liest Lovelace aus dem Blockfrost-Amount-Array", () => {
  assert.equal(lovelaceFromAmounts([{ unit: "asset", quantity: "5" }, { unit: "lovelace", quantity: "1250000" }]), 1_250_000);
  assert.equal(LOVELACE_PER_ADA, 1_000_000);
});

test("normalisiert einen Cardano-Eingang", () => {
  const transaction = normalizeCardanoTransaction({
    hash: "a".repeat(64),
    block_time: 1_700_000_000,
    fee: "170000",
    inputs: [{ address: sender, amount: [{ unit: "lovelace", quantity: "2500000" }] }],
    outputs: [{ address: wallet, amount: [{ unit: "lovelace", quantity: "2500000" }] }],
  }, wallet);
  assert.equal(transaction.direction, "in");
  assert.equal(transaction.asset, "ADA");
  assert.equal(transaction.amount, 2.5);
  assert.equal(transaction.counterparty, sender);
  assert.equal(transaction.timestamp, "2023-11-14T22:13:20.000Z");
});

test("normalisiert einen Cardano-Ausgang mit Wechselgeld", () => {
  const transaction = normalizeCardanoTransaction({
    hash: "b".repeat(64),
    block_time: 1_700_000_001,
    fee: "170000",
    inputs: [{ address: wallet, amount: [{ unit: "lovelace", quantity: "5000000" }] }],
    outputs: [
      { address: recipient, amount: [{ unit: "lovelace", quantity: "3000000" }] },
      { address: wallet, amount: [{ unit: "lovelace", quantity: "1830000" }] },
    ],
  }, wallet);
  assert.equal(transaction.direction, "out");
  assert.equal(transaction.amount, 3.17);
  assert.equal(transaction.fee, 0.17);
  assert.equal(transaction.counterparty, recipient);
});

test("fasst Transaktionen mehrerer einer Stake-Adresse zugeordneter Zahlungsadressen zusammen", () => {
  const secondAddress = `addr1${"s".repeat(98)}`;
  const transaction = normalizeCardanoTransaction({
    hash: "c".repeat(64),
    block_time: 1_700_000_002,
    inputs: [{ address: wallet, amount: [{ unit: "lovelace", quantity: "4000000" }] }],
    outputs: [
      { address: secondAddress, amount: [{ unit: "lovelace", quantity: "1000000" }] },
      { address: recipient, amount: [{ unit: "lovelace", quantity: "3000000" }] },
    ],
  }, new Set([wallet, secondAddress]));
  assert.equal(transaction.direction, "out");
  assert.equal(transaction.amount, 3);
  assert.equal(transaction.counterparty, recipient);
});

const { normalizeCardanoReward, fetchCardanoRewardHistory } = require('../lib/cardano');
const utxo = (address, ada, flags = {}) => ({ address, amount: [{ unit: 'lovelace', quantity: String(Math.round(ada * 1e6)) }], ...flags });
const delta = row => row.direction === 'out' ? -row.amount : row.direction === 'in' ? row.amount : 0;

test('Prämienauszahlung zählt im Stake-Wallet nicht doppelt; Einzeladresse behält UTXO-Zugang', () => {
  const context = { addresses: new Set([wallet]), stakeAddress: 'stake1own' };
  const claim = { hash: 'claim', fee: '170000', valid_contract: true,
    inputs: [utxo(wallet, 890)], outputs: [utxo(wallet, 909.83)],
    withdrawals: [{ address: 'stake1own', amount: '20000000' }, { address: 'stake1other', amount: '90000000' }] };
  const normalized = normalizeCardanoTransaction(claim, context);
  assert.equal(delta(normalized), -0.17);
  assert.equal(delta(normalizeCardanoTransaction(claim, wallet)), 19.83);
  const reward = normalizeCardanoReward({ epoch: 500, amount: '52000000' });
  assert.equal(890 + delta(reward) + delta(normalized), 941.83);
  assert.equal(reward.timestamp, null);
});

test('Referenzinputs und nicht verbrauchtes Collateral verändern den Bestand nicht', () => {
  const transaction = { hash: 'script', valid_contract: true,
    inputs: [utxo(wallet, 5), utxo(wallet, 100, { reference: true }), utxo(wallet, 20, { collateral: true })],
    outputs: [utxo(wallet, 4.8), utxo(wallet, 19, { collateral: true })] };
  assert.equal(delta(normalizeCardanoTransaction(transaction, wallet)), -0.2);
  transaction.valid_contract = false;
  assert.equal(delta(normalizeCardanoTransaction(transaction, wallet)), -1);
});

test('Prämienhistorie paginiert und datiert Verfügbarkeit statt Verdienst am Jahreswechsel', async () => {
  const calls = [];
  const rewards = await fetchCardanoRewardHistory('stake1own', async route => {
    calls.push(route);
    if (route === '/epochs/latest') return { epoch: 602 };
    if (route.includes('page=1&')) return Array.from({ length: 100 }, (_, i) => ({ epoch: 600, amount: String(i + 1), type: 'member' }));
    if (route.includes('page=2&')) return [{ epoch: 601, amount: '10', type: 'leader' }, { epoch: 602, amount: '20', type: 'pool_deposit_refund' }];
    assert.equal(route, '/epochs/602');
    return { start_time: Date.parse('2026-01-02T00:00:00Z') / 1000 };
  });
  assert.equal(rewards.length, 101); // future leader reward is not spendable yet
  assert.equal(calls.filter(route => route === '/epochs/602').length, 1);
  assert.equal(normalizeCardanoReward(rewards[0]).timestamp, '2026-01-02T00:00:00.000Z');
  assert.equal(normalizeCardanoReward(rewards.at(-1)).autoPurpose, 'Transfer');
  assert.equal(normalizeCardanoReward(rewards[0]).externalId, 'ada-reward:600:unknown:1');
});

test('fehlerhafte Prämien- und Epochendaten werden nicht als leere Historie verschluckt', async () => {
  await assert.rejects(fetchCardanoRewardHistory('stake', async route => route === '/epochs/latest' ? { epoch: 602 } : {}), /Prämienliste/);
  await assert.rejects(fetchCardanoRewardHistory('stake', async route => route === '/epochs/latest' ? { epoch: 602 } : route.includes('/rewards') ? [{ epoch: 600, amount: '1' }] : {}), /Zeit/);
});
