const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('additive Preismigration erhält Altwerte, manuelle Angaben und Audit-Historie bei wiederholtem Start', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptobuch-price-migration-'));
  const run = (script) => {
    const child = spawnSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: directory }, encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    return child.stdout.trim();
  };
  try {
    run(`const {db}=require('./server');
      db.exec("INSERT INTO wallets (id,chain,address) VALUES (1,'BTC','public-migration');");
      db.exec("INSERT INTO transactions (id,wallet_id,external_id,hash,timestamp,direction,asset,amount,raw_json,price_transaction_eur,price_source,purpose,purpose_origin) VALUES (1,1,'fixture','fixture','2025-01-01','in','BTC',1,'{}',123,'manual','Kauf','manual');");
      db.exec("INSERT INTO transaction_price_audit (transaction_id,price_eur,source,note) VALUES (1,123,'manual','behalten');");
      db.exec("INSERT INTO price_history (coin_id,price_date,price_eur) VALUES ('bitcoin','2025-01-01',42);");
      db.exec("DROP TABLE price_asset_mappings; DROP TABLE price_provider_cooldowns; ALTER TABLE historical_price_retries DROP COLUMN reason;");
      for (const table of ['transactions','price_history']) db.exec('ALTER TABLE '+table+' DROP COLUMN price_method; ALTER TABLE '+table+' DROP COLUMN price_observed_at;');
      db.close();`);
    for (let pass = 0; pass < 2; pass++) {
      const result = JSON.parse(run(`const {db}=require('./server');
        console.log(JSON.stringify({tx:db.prepare('SELECT price_transaction_eur,price_source,purpose,purpose_origin,price_method,price_observed_at FROM transactions WHERE id=1').get(),
        cache:db.prepare('SELECT price_eur,price_method FROM price_history').get(), audit:db.prepare('SELECT COUNT(*) AS n FROM transaction_price_audit').get().n}));db.close();`));
      assert.deepEqual(result.tx, { price_transaction_eur: 123, price_source: 'manual', purpose: 'Kauf', purpose_origin: 'manual', price_method: 'legacy', price_observed_at: null });
      assert.equal(result.cache.price_eur, 42);
      assert.equal(result.cache.price_method, 'legacy');
      assert.equal(result.audit, 1);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
