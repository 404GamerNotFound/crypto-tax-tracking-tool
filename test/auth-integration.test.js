const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createAuth } = require('../lib/auth');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-auth-integration-'));
const password = 'integration-test-password-only';
const secret = path.join(directory, 'initial-secret'); fs.writeFileSync(secret, password);
createAuth({ dataDir: directory, passwordFile: secret }); fs.unlinkSync(secret);
process.env.DATA_DIR = directory;
const { app, db, resetLocalData } = require('../server');
let server, origin;
test.before(async () => {
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
test('der echte Server schützt Lesen, Schreiben, Exporte und Backups vor der Routenausführung', async () => {
  for (const [route, method] of [['/api/portfolio','GET'], ['/api/settings','GET'], ['/api/v1/transactions','GET'], ['/api/backups/missing.sqlite/download','GET'], ['/api/tax-report.csv','GET'], ['/API/tax-report.csv','GET'], ['/api/wallets','POST'], ['/api/asset-visibility','PATCH'], ['/api/data/reset','POST'], ['/api/backups/missing.sqlite/restore','POST']]) {
    const response = await fetch(origin + route, { method });
    assert.equal(response.status, 401, route);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  const response = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type':'application/json', 'X-CryptoBuch-Request':'1' }, body: JSON.stringify({ password }) });
  assert.equal(response.status, 200);
  const { token } = await response.json();
  const api = await fetch(origin + '/api/v1', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(api.status, 200);
  const record = fs.readFileSync(path.join(directory, 'auth.json'), 'utf8');
  resetLocalData();
  assert.equal(fs.readFileSync(path.join(directory, 'auth.json'), 'utf8'), record);
  assert.equal((await fetch(origin + '/api/v1')).status, 401);
});
