const crypto = require('node:crypto');
const { setTimeout: pause } = require('node:timers/promises');
const { normalizeFill, normalizeAccountBalances } = require('./coinbase');
const API_BASE_URL = 'https://api.coinbase.com';
const ACCOUNTS_PATH = '/api/v3/brokerage/accounts';
const FILLS_PATH = '/api/v3/brokerage/orders/historical/fills';
const HISTORY_WARNING = 'Advanced Trade liefert hier Kontostände und Spot-Trades. Ein-/Auszahlungen, Staking, Konvertierungen und einfache Coinbase-Käufe sind damit nicht vollständig belegt; ergänze fehlende Bewegungen per CSV.';

function signingKey(apiKey, apiSecret) {
  if (!/^organizations\/[a-zA-Z0-9-]{1,100}\/apiKeys\/[a-zA-Z0-9-]{1,100}$/.test(String(apiKey || ''))) {
    throw new Error('Coinbase Advanced Trade: Den vollständigen API-Schlüsselnamen organizations/…/apiKeys/… eingeben.');
  }
  const secret = String(apiSecret || '').trim().replace(/\\n/g, '\n');
  if (!secret || secret.length > 2048) throw new Error('Coinbase Advanced Trade: Ungültiger API-Signaturschlüssel.');
  try {
    let key;
    if (secret.startsWith('-----BEGIN')) key = crypto.createPrivateKey(secret);
    else {
      if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(secret)) throw new Error();
      const raw = Buffer.from(secret, 'base64');
      if (![32, 64].includes(raw.length) || raw.toString('base64').replace(/=+$/, '') !== secret.replace(/=+$/, '')) throw new Error();
      key = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw.subarray(0, 32)]), format: 'der', type: 'pkcs8' });
      // Coinbase's SDK consumes the first 32 bytes of both raw key formats.
      raw.fill(0);
    }
    if (key.asymmetricKeyType === 'ed25519') return { key, algorithm: 'EdDSA' };
    if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') return { key, algorithm: 'ES256' };
    throw new Error();
  } catch {
    throw new Error('Coinbase Advanced Trade: API-Signaturschlüssel muss Ed25519 (Base64/PEM) oder ECDSA P-256 (PEM) sein. Keine Wallet-Private-Keys oder Seed-Phrases eingeben.');
  }
}

function createReadJwt({ apiKey, apiSecret, pathname, now = Date.now() }) {
  // Deliberately fixed origin and GET allowlist: never sign orders or transfers.
  if (![ACCOUNTS_PATH, FILLS_PATH].includes(pathname)) throw new Error('Coinbase Advanced Trade: Nicht erlaubter Lese-Endpunkt.');
  const { key, algorithm } = signingKey(apiKey, apiSecret);
  const timestamp = Math.floor(now / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = `${encode({ alg: algorithm, typ: 'JWT', kid: apiKey, nonce: crypto.randomBytes(16).toString('hex') })}.${encode({ sub: apiKey, iss: 'cdp', nbf: timestamp, exp: timestamp + 120, uri: `GET api.coinbase.com${pathname}` })}`;
  const signature = crypto.sign(algorithm === 'EdDSA' ? null : 'sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${message}.${signature}`;
}

async function readPage({ apiKey, apiSecret, pathname, cursor = '', fetchImpl = fetch, requestGapMs = 180, retryGapMs = 1000 }) {
  // Validate before retrying; key parsing errors are never mistaken for outages.
  signingKey(apiKey, apiSecret);
  if (typeof cursor !== 'string' || cursor.length > 2000) throw new Error('Coinbase Advanced Trade: Ungültiger Seiten-Cursor.');
  const url = new URL(API_BASE_URL + pathname);
  url.searchParams.set('limit', '100');
  if (pathname === FILLS_PATH) url.searchParams.set('product_types', 'SPOT');
  if (cursor) url.searchParams.set('cursor', cursor);
  const label = pathname === ACCOUNTS_PATH ? 'Konten' : 'Trades';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await pause(retryGapMs * attempt);
    let response;
    try {
      response = await fetchImpl(url.toString(), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', Authorization: `Bearer ${createReadJwt({ apiKey, apiSecret, pathname })}` } });
    } catch {
      if (attempt < 2) continue;
      throw new Error(`Coinbase Advanced Trade · ${label}: Netzwerk-/TLS-Verbindung fehlgeschlagen. Verbindung, DNS und Uhrzeit im Container prüfen.`);
    } finally { if (requestGapMs) await pause(requestGapMs); }
    if (!response.ok) {
      await response.body?.cancel();
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) continue;
      throw new Error(`Coinbase Advanced Trade · ${label}: HTTP ${response.status}. ${[401, 403].includes(response.status) ? 'Zugang abgelehnt; CDP-Schlüssel, View-Recht, Portfolio, IP-Freigabe und Container-Uhrzeit prüfen.' : 'Coinbase-Abfrage fehlgeschlagen; später erneut versuchen.'}`);
    }
    let payload;
    try { payload = await response.json(); } catch { throw new Error(`Coinbase Advanced Trade · ${label}: Ungültige JSON-Antwort. Keine Daten übernommen.`); }
    const list = pathname === ACCOUNTS_PATH ? payload?.accounts : payload?.fills;
    if (!Array.isArray(list) || payload?.proof_token_required === true) throw new Error(`Coinbase Advanced Trade · ${label}: Unerwartete oder zusätzliche Freigabe erfordernde Antwort. Historie bleibt offen.`);
    if (pathname === ACCOUNTS_PATH && typeof payload.has_next !== 'boolean') throw new Error('Coinbase Advanced Trade · Konten: Seitenstatus fehlt.');
    const hasNext = pathname === ACCOUNTS_PATH ? payload.has_next : Boolean(payload.cursor);
    const next = hasNext ? payload.cursor : '';
    if (hasNext && (typeof next !== 'string' || !next || next === cursor || next.length > 2000 || !list.length)) throw new Error(`Coinbase Advanced Trade · ${label}: Ungültige Pagination. Historie bleibt offen.`);
    return { list, cursor: next || '' };
  }
}

function advancedBalances(accounts) {
  const normalized = accounts.map(account => {
    const free = Number(account?.available_balance?.value), locked = Number(account?.hold?.value);
    if (!account?.uuid || !account.currency || !Number.isFinite(free) || !Number.isFinite(locked) || free < 0 || locked < 0
      || account.available_balance.currency !== account.currency || account.hold.currency !== account.currency) throw new Error('Coinbase Advanced Trade · Konten: Unvollständiger Kontostand.');
    return { currency: account.currency, balance: free + locked, available: free, hold: locked };
  });
  return normalizeAccountBalances(normalized);
}

function advancedFillRows(fills) {
  const rows = [];
  for (const fill of fills) {
    const price = Number(fill?.price), size = Number(fill?.size), commission = Number(fill?.commission || 0);
    if (fill?.trade_type && fill.trade_type !== 'FILL') throw new Error('Coinbase Advanced Trade · Trades: Nicht unterstützte Ausführungsart; bitte CSV ergänzen.');
    if (!fill?.entry_id || !fill?.product_id || !['BUY', 'SELL'].includes(String(fill?.side).toUpperCase()) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0 || !Number.isFinite(commission) || commission < 0 || typeof fill.size_in_quote !== 'boolean' || !Number.isFinite(Date.parse(fill.trade_time))) throw new Error('Coinbase Advanced Trade · Trades: Unvollständige Spot-Ausführung; Historie bleibt offen.');
    if (fill.product_type && fill.product_type !== 'SPOT' || fill.future_legs?.length) throw new Error('Coinbase Advanced Trade · Trades: Derivate werden nicht als Coin-Bestand importiert.');
    const mapped = normalizeFill({ ...fill, trade_id: fill.entry_id, created_at: fill.trade_time, size: fill.size_in_quote ? size / price : size, side: fill.side.toLowerCase(), fee: commission });
    if (!mapped.length) throw new Error('Coinbase Advanced Trade · Trades: Ausführung nicht normalisierbar.');
    for (const row of mapped) rows.push({ ...row, externalId: row.externalId.replace('coinbase:fill:', 'coinbase-advanced:fill:'), hash: `coinbase-advanced:${fill.trade_id || fill.entry_id}`, counterparty: `Coinbase Advanced Trade · ${fill.product_id}`, raw: fill });
  }
  return rows;
}

function normalizeAdvancedState(value) {
  let input = value;
  if (typeof value === 'string') { try { input = JSON.parse(value); } catch { input = {}; } }
  input ||= {};
  return { version: 1, phase: ['fills', 'complete'].includes(input.phase) ? input.phase : 'fills', cursor: String(input.cursor || '').slice(0, 2000), pages: Math.max(0, Number(input.pages) || 0), warnings: [HISTORY_WARNING] };
}
async function fetchAdvancedHistoryBatch(options) {
  const state = normalizeAdvancedState(options.state);
  if (state.phase === 'complete') return { rows: [], nextState: state, settled: true, complete: false, warnings: state.warnings };
  if (state.pages >= 10000) throw new Error('Coinbase Advanced Trade: Historienlimit erreicht; bitte CSV ergänzen.');
  const page = await readPage({ ...options, pathname: FILLS_PATH, cursor: state.cursor });
  const rows = advancedFillRows(page.list);
  const nextState = { ...state, phase: page.cursor ? 'fills' : 'complete', cursor: page.cursor, pages: state.pages + 1 };
  return { rows, nextState, settled: !page.cursor, complete: false, warnings: state.warnings, progress: { current: nextState.pages, total: nextState.pages + (page.cursor ? 1 : 0), phase: nextState.phase } };
}
async function fetchAdvancedHistory(options) {
  let cursor = '', accounts = [];
  do {
    const page = await readPage({ ...options, pathname: ACCOUNTS_PATH, cursor });
    accounts.push(...page.list); cursor = page.cursor;
    if (accounts.length > 5000) throw new Error('Coinbase Advanced Trade: Kontenlimit erreicht.');
  } while (cursor);
  const accountBalances = advancedBalances(accounts);
  const page = await readPage({ ...options, pathname: FILLS_PATH });
  return { rows: advancedFillRows(page.list), accountBalances, warnings: [HISTORY_WARNING] };
}
module.exports = { signingKey, createReadJwt, readPage, advancedBalances, advancedFillRows, normalizeAdvancedState, fetchAdvancedHistory, fetchAdvancedHistoryBatch, HISTORY_WARNING, ACCOUNTS_PATH, FILLS_PATH };
