const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-wallet-crud-'));
process.env.DATA_DIR = directory;
const { app, db } = require('../server');
let server, origin;
const address = '0x' + 'a'.repeat(40);

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => db.exec('DELETE FROM wallets'));
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
async function api(route, method = 'GET', body, status = 200) {
  const response = await fetch(origin + route, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, status, text);
  return text ? JSON.parse(text) : null;
}
const create = (values = {}) => api('/api/wallets', 'POST', { chain: 'ETH', address, label: 'Cold Wallet', groupName: 'Privat', tags: ['langfristig'], ...values }, 201);

test('Wallet-CRUD liefert öffentliche Daten und erhält nicht übermittelte Metadaten', async () => {
  const wallet = await create();
  assert.equal(typeof wallet.tags, 'string');
  const read = async () => (await api(`/api/v1/wallets/${wallet.id}`)).data;
  assert.deepEqual((await read()).tags, ['langfristig']);
  await api(`/api/wallets/${wallet.id}`, 'PATCH', { label: 'Umbenannt' });
  let changed = await read();
  assert.equal(changed.label, 'Umbenannt');
  assert.equal(changed.group_name, 'Privat');
  assert.deepEqual(changed.tags, ['langfristig']);
  await api(`/api/wallets/${wallet.id}`, 'PATCH', { groupName: '', tags: [] });
  changed = await read();
  assert.equal(changed.label, 'Umbenannt');
  assert.equal(changed.group_name, '');
  assert.deepEqual(changed.tags, []);
  await api(`/api/wallets/${wallet.id}`, 'PATCH', {});
  assert.equal((await read()).label, 'Umbenannt');
});

test('Wallet-Erstellung prüft öffentliche Quellen und Dubletten je Netzwerk', async () => {
  await create();
  await api('/api/wallets', 'POST', { chain: 'ETH', address }, 409);
  await create({ chain: 'BNB' });
  for (const invalid of [
    { chain: 'ETH', address: '0x' + 'f'.repeat(64) },
    { chain: 'BTC', sourceType: 'xpub', address: 'xprv-public-test-placeholder' },
    { chain: 'ETH', sourceType: 'stake', address: 'stake1' + 'a'.repeat(50) },
    { chain: 'BTC', address: 'word '.repeat(12) },
  ]) await api('/api/wallets', 'POST', invalid, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wallets').get().n, 2);
});

test('Wallet-Bearbeitung weist Änderungen der Quellenidentität ohne Teiländerung ab', async () => {
  const wallet = await create();
  for (const [key, value] of Object.entries({ address: 'other', chain: 'BTC', sourceType: 'xpub', xpubAddressType: 'p2pkh' })) {
    await api(`/api/wallets/${wallet.id}`, 'PATCH', { label: 'Nicht speichern', [key]: value }, 400);
  }
  const current = (await api(`/api/v1/wallets/${wallet.id}`)).data;
  assert.equal(current.label, 'Cold Wallet');
  assert.equal(current.address, address);
  await api('/api/wallets/99999', 'PATCH', { label: 'Unbekannt' }, 404);
});

test('Wallet-Löschen liefert 204 ohne Body und entfernt nur zugehörige Buchungsdaten', async () => {
  const wallet = await create();
  const other = await create({ address: '0x' + 'b'.repeat(40) });
  const insert = db.prepare("INSERT INTO transactions (wallet_id, external_id, hash, timestamp, direction, asset, amount, raw_json) VALUES (?, ?, ?, '2025-01-01', 'in', 'ETH', 1, '{}')");
  const transaction = Number(insert.run(wallet.id, 'one', 'one').lastInsertRowid);
  const otherTransaction = Number(insert.run(other.id, 'two', 'two').lastInsertRowid);
  const document = db.prepare("INSERT INTO transaction_documents (transaction_id, original_name, stored_name, mime_type, byte_size, sha256) VALUES (?, 'beleg.csv', ?, 'text/csv', 4, 'checksum')");
  document.run(transaction, 'selected-document');
  document.run(otherTransaction, 'other-document');
  fs.writeFileSync(path.join(directory, 'documents', 'selected-document'), 'test');
  fs.writeFileSync(path.join(directory, 'documents', 'other-document'), 'test');
  db.prepare("INSERT INTO transaction_price_audit (transaction_id, price_eur, source, note) VALUES (?, 123, 'manual', 'Test')").run(transaction);
  assert.equal(await api(`/api/wallets/${wallet.id}`, 'DELETE', undefined, 204), null);
  await api(`/api/v1/wallets/${wallet.id}`, 'GET', undefined, 404);
  await api(`/api/wallets/${wallet.id}`, 'DELETE', undefined, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wallet_metadata WHERE wallet_id = ?').get(wallet.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transaction_price_audit WHERE transaction_id = ?').get(transaction).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE wallet_id = ?').get(wallet.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE wallet_id = ?').get(other.id).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transaction_documents WHERE transaction_id = ?').get(transaction).n, 0);
  assert.equal(fs.existsSync(path.join(directory, 'documents', 'selected-document')), false);
  assert.equal(fs.readFileSync(path.join(directory, 'documents', 'other-document'), 'utf8'), 'test');
  assert.equal((await api(`/api/v1/wallets/${other.id}`)).data.address, other.address);
});
