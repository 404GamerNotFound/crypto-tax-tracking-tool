const crypto = require('node:crypto');
const { setTimeout: pause } = require('node:timers/promises');
const { normalizeFill, normalizeAccountBalances } = require('./coinbase');
const API_BASE_URL = 'https://api.coinbase.com';
const ACCOUNTS_PATH = '/api/v3/brokerage/accounts';
const FILLS_PATH = '/api/v3/brokerage/orders/historical/fills';
const APP_ACCOUNTS_PATH = '/v2/accounts';
const FIAT_ASSETS = new Set(['EUR', 'USD', 'GBP', 'CHF', 'TRY', 'BRL', 'AUD', 'PLN', 'UAH', 'RUB', 'CAD', 'JPY', 'SGD']);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
const isReadPath = pathname => [ACCOUNTS_PATH, FILLS_PATH, APP_ACCOUNTS_PATH].includes(pathname)
  || /^\/v2\/accounts\/[a-zA-Z0-9-]{1,100}\/transactions$/.test(pathname);
const HISTORY_WARNING = 'Coinbase-Kontohistorie wird zusätzlich zu Advanced-Trade-Ausführungen eingelesen. Nicht eindeutig zuordenbare Bewegungen bleiben als offene Datenpunkte sichtbar.';

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
  if (!isReadPath(pathname)) throw new Error('Coinbase Advanced Trade: Nicht erlaubter Lese-Endpunkt.');
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
  if (!isReadPath(pathname)) throw new Error('Coinbase Advanced Trade: Nicht erlaubter Lese-Endpunkt.');
  if (typeof cursor !== 'string' || cursor.length > 2000) throw new Error('Coinbase Advanced Trade: Ungültiger Seiten-Cursor.');
  const url = new URL(API_BASE_URL + pathname);
  url.searchParams.set('limit', '100');
  if (pathname === FILLS_PATH) url.searchParams.set('product_types', 'SPOT');
  const app = pathname.startsWith('/v2/');
  if (app) url.searchParams.set('order', 'desc');
  if (cursor) url.searchParams.set(app ? 'starting_after' : 'cursor', cursor);
  const label = pathname.endsWith('/accounts') ? 'Konten' : app ? 'Kontotransaktionen' : 'Trades';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await pause(retryGapMs * attempt);
    let response;
    try {
      response = await fetchImpl(url.toString(), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', 'CB-VERSION': '2024-01-01', Authorization: `Bearer ${createReadJwt({ apiKey, apiSecret, pathname })}` } });
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
    const list = app ? payload?.data : pathname === ACCOUNTS_PATH ? payload?.accounts : payload?.fills;
    if (!Array.isArray(list) || payload?.proof_token_required === true) throw new Error(`Coinbase Advanced Trade · ${label}: Unerwartete oder zusätzliche Freigabe erfordernde Antwort. Historie bleibt offen.`);
    if (pathname === ACCOUNTS_PATH && typeof payload.has_next !== 'boolean') throw new Error('Coinbase Advanced Trade · Konten: Seitenstatus fehlt.');
    if (app) {
      if (!payload.pagination || !Object.hasOwn(payload.pagination, 'next_uri')) throw new Error(`Coinbase · ${label}: Seitenstatus fehlt.`);
      let next = '';
      if (payload.pagination.next_uri) {
        let target;
        try { target = new URL(payload.pagination.next_uri, API_BASE_URL); } catch { throw new Error('Coinbase: Ungültige Pagination.'); }
        next = target.searchParams.get('starting_after');
        // Never follow a URL supplied by the API or sign a different resource.
        if (target.origin !== API_BASE_URL || target.username || target.password || target.hash || target.pathname !== pathname || !validId(next) || next === cursor || !list.length) throw new Error('Coinbase: Ungültige Pagination. Historie bleibt offen.');
      }
      return { list, cursor: next };
    }
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

function normalizeAppTransactions(transactions, account, filledOrderIds = []) {
  const rows = [], warnings = new Set(), filledOrders = new Set(filledOrderIds);
  for (const tx of transactions) {
    if (!tx || !validId(tx.id) || typeof tx.type !== 'string' || typeof tx.status !== 'string') throw new Error('Coinbase · Kontotransaktionen: Unvollständiger Beleg.');
    if (['pending', 'canceled', 'cancelled', 'expired', 'failed', 'waiting_for_clearing', 'waiting_for_signature'].includes(tx.status)) continue;
    if (tx.status !== 'completed') { warnings.add('Coinbase: Unbekannter Transaktionsstatus wurde nicht als abgeschlossene Buchung übernommen.'); continue; }
    const value = Number(tx.amount?.amount), asset = tx.amount?.currency, timestamp = Date.parse(tx.created_at);
    if (typeof tx.amount?.amount !== 'string' || !Number.isFinite(value) || !/^[A-Z0-9._-]{1,48}$/.test(asset || '') || asset !== account.currency || !Number.isFinite(timestamp)) throw new Error('Coinbase · Kontotransaktionen: Ungültige Menge, Währung oder Zeitangabe.');
    if (!value || FIAT_ASSETS.has(asset) || tx.type === 'request') continue;
    const fill = tx.advanced_trade_fill;
    if (tx.type === 'advanced_trade_fill') {
      if (!validId(fill?.order_id)) throw new Error('Coinbase · Kontotransaktionen: Advanced-Trade-Beleg ohne Order-ID; Dublettenabgleich nicht möglich.');
      // Fills are authoritative for orders they contain. The account journal
      // supplies older/missing orders, one signed account movement per leg.
      if (filledOrders.has(fill.order_id)) continue;
      const product = /^([A-Z0-9._]+)-([A-Z0-9._]+)$/.exec(fill.product_id || '');
      const side = String(fill.order_side || '').toUpperCase();
      if (!product || ![product[1], product[2]].includes(asset) || !['BUY', 'SELL'].includes(side)
        || !Number.isFinite(Number(fill.fill_price)) || Number(fill.fill_price) <= 0
        || (asset === product[1] ? value > 0 : value < 0) !== (side === 'BUY')) throw new Error('Coinbase · Kontotransaktionen: Ungültige Spot-Order; Derivate werden nicht als Coin-Bestand übernommen.');
    }
    let purpose;
    if (tx.type === 'buy') purpose = 'Kauf';
    else if (tx.type === 'sell') purpose = 'Verkauf';
    else if (['trade', 'advanced_trade_fill'].includes(tx.type)) purpose = value > 0 ? 'Kauf' : 'Verkauf';
    else if (['staking_reward', 'staking_rewards'].includes(tx.type)) purpose = 'Staking Rewards';
    else if (tx.type === 'interest') purpose = 'Lending-Ertrag';
    else if (['earn_payout', 'incentives_rewards_payout'].includes(tx.type)) purpose = 'Airdrop';
    else if (['send', 'receive', 'transfer', 'staking_transfer', 'unstaking_transfer', 'pro_deposit', 'pro_withdrawal', 'intx_deposit', 'intx_withdrawal', 'vault_withdrawal'].includes(tx.type)) purpose = 'Transfer';
    else {
      purpose = 'Sonstiges';
      warnings.add('Coinbase: Nicht eindeutig zugeordnete Buchungsarten wurden als „Sonstiges“ übernommen; bitte Zwecke und Belege prüfen.');
    }
    const gross = Math.abs(value);
    const trade = tx.type === 'buy' ? tx.buy : tx.type === 'sell' ? tx.sell : null;
    const native = tx.native_amount?.currency === 'EUR' ? Math.abs(Number(tx.native_amount.amount)) : null;
    const subtotal = trade?.subtotal?.currency === 'EUR' ? Math.abs(Number(trade.subtotal.amount)) : null;
    let priceEur = subtotal > 0 && Number.isFinite(subtotal) ? subtotal / gross : native > 0 && Number.isFinite(native) ? native / gross : null;
    if (fill?.product_id === `${asset}-EUR` && Number(fill.fill_price) > 0 && Number.isFinite(Number(fill.fill_price))) priceEur = Number(fill.fill_price);
    let amount = gross, fee = 0, feeAsset = asset;
    const feeRecord = tx.type === 'send' ? tx.network?.transaction_fee : trade?.fee;
    if (feeRecord) {
      fee = Number(feeRecord.amount); feeAsset = feeRecord.currency;
      if (!Number.isFinite(fee) || fee < 0 || !/^[A-Z0-9._-]{1,48}$/.test(feeAsset || '')) throw new Error('Coinbase · Kontotransaktionen: Ungültige Gebühr.');
      // A send's account debit already includes its network fee. Split it
      // without deducting the fee twice from the journal balance.
      if (tx.type === 'send' && feeAsset === asset) {
        amount = gross - fee;
        if (amount <= 0) throw new Error('Coinbase · Kontotransaktionen: Gebühr übersteigt die gesendete Menge.');
      } else if (!FIAT_ASSETS.has(feeAsset)) {
        warnings.add('Coinbase: Gebühr in abweichender Kryptowährung ist nicht eindeutig getrennt; Kontobeleg prüfen.');
        fee = 0; feeAsset = asset;
      }
    } else if (fill?.product_id?.startsWith(`${asset}-`) && FIAT_ASSETS.has(fill.product_id.slice(asset.length + 1)) && fill.commission !== undefined) {
      fee = Number(fill.commission); feeAsset = fill.product_id.slice(asset.length + 1);
      if (!Number.isFinite(fee) || fee < 0) throw new Error('Coinbase · Kontotransaktionen: Ungültige Fill-Gebühr.');
    }
    const reference = tx.network?.hash || tx.trade?.id || tx.id;
    const identity = crypto.createHash('sha256').update(`${account.id}:${tx.id}`).digest('hex');
    rows.push({ externalId: `coinbase-advanced:transaction:${identity}`, hash: reference,
      timestamp: new Date(timestamp).toISOString(), direction: value > 0 ? 'in' : 'out', asset, amount, fee, feeAsset,
      priceEur, purpose, counterparty: tx.to?.address || tx.from?.address || `Coinbase · ${tx.type}`, raw: tx });
  }
  return { rows, warnings: [...warnings] };
}

function normalizeAdvancedState(value) {
  let input = value;
  if (typeof value === 'string') { try { input = JSON.parse(value); } catch { input = {}; } }
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 2) input = {};
  const accounts = Array.isArray(input.accounts) ? input.accounts : [];
  const orderIds = Array.isArray(input.orderIds) ? input.orderIds : [];
  if (accounts.length > 5000 || orderIds.length > 100000) throw new Error('Coinbase: Historienlimit erreicht; bitte CSV ergänzen.');
  if (accounts.some(a => !validId(a?.id) || !/^[A-Z0-9._-]{1,48}$/.test(a?.currency || '')) || orderIds.some(id => !validId(id))) throw new Error('Coinbase: Ungültiger gespeicherter Historienstand.');
  return { version: 2, phase: ['fills', 'accounts', 'transactions', 'complete'].includes(input.phase) ? input.phase : 'fills',
    cursor: String(input.cursor || '').slice(0, 2000), pages: Math.max(0, Math.floor(Number(input.pages) || 0)),
    accounts, orderIds: [...new Set(orderIds)], accountIndex: Math.min(accounts.length, Math.max(0, Math.floor(Number(input.accountIndex) || 0))),
    seenCursors: Array.isArray(input.seenCursors) ? input.seenCursors.map(String).slice(-10000) : [],
    warnings: [...new Set(Array.isArray(input.warnings) ? input.warnings.map(String) : [])].slice(0, 20) };
}
async function fetchAdvancedHistoryBatch(options) {
  const state = normalizeAdvancedState(options.state);
  const nextState = { ...state, accounts: [...state.accounts], orderIds: [...state.orderIds], warnings: [...state.warnings] };
  let rows = [];
  if (state.phase !== 'complete') {
    if (state.pages >= 10000) throw new Error('Coinbase Advanced Trade: Historienlimit erreicht; bitte CSV ergänzen.');
    const account = state.accounts[state.accountIndex];
    const pathname = state.phase === 'fills' ? FILLS_PATH : state.phase === 'accounts' ? APP_ACCOUNTS_PATH : `/v2/accounts/${account?.id}/transactions`;
    if (state.phase === 'transactions' && !account) nextState.phase = 'complete';
    else {
      const page = await readPage({ ...options, pathname, cursor: state.cursor });
      if (page.cursor && state.seenCursors.includes(page.cursor)) throw new Error('Coinbase: Wiederholter Seiten-Cursor; Historie bleibt offen.');
      nextState.pages++;
      nextState.cursor = page.cursor;
      nextState.seenCursors = page.cursor ? [...state.seenCursors, page.cursor] : [];
      if (state.phase === 'fills') {
        const journalOrders = new Set(options.accountOrderIds || []);
        const authoritativeFills = page.list.filter(fill => !journalOrders.has(fill.order_id));
        rows = advancedFillRows(authoritativeFills);
        for (const fill of authoritativeFills) {
          if (!validId(fill.order_id)) throw new Error('Coinbase · Trades: Order-ID fehlt; Dublettenabgleich mit Kontotransaktionen nicht möglich.');
          nextState.orderIds.push(fill.order_id);
        }
        if (!page.cursor) nextState.phase = 'accounts';
      } else if (state.phase === 'accounts') {
        const known = new Set(state.accounts.map(a => a.id));
        for (const a of page.list) {
          const currency = typeof a.currency === 'object' ? a.currency?.code : a.currency;
          if (!validId(a?.id) || !/^[A-Z0-9._-]{1,48}$/.test(currency || '') || known.has(a.id)) throw new Error('Coinbase · Konten: Ungültiges oder doppelt geliefertes Konto.');
          known.add(a.id);
          // Zero balances can have years of history; never filter by balance.
          if (a.type !== 'fiat' && a.currency?.type !== 'fiat' && !FIAT_ASSETS.has(currency)) nextState.accounts.push({ id: a.id, currency });
        }
        if (!page.cursor) nextState.phase = nextState.accounts.length ? 'transactions' : 'complete';
      } else {
        const normalized = normalizeAppTransactions(page.list, account, state.orderIds);
        rows = normalized.rows;
        nextState.warnings.push(...normalized.warnings);
        if (!page.cursor) {
          nextState.accountIndex++;
          if (nextState.accountIndex >= state.accounts.length) nextState.phase = 'complete';
        }
      }
    }
  }
  const normalizedState = normalizeAdvancedState(nextState);
  const settled = normalizedState.phase === 'complete';
  return { rows, nextState: normalizedState, settled, complete: settled && !normalizedState.warnings.length, warnings: normalizedState.warnings,
    progress: { current: normalizedState.pages, total: normalizedState.pages + (settled ? 0 : 1), phase: normalizedState.phase } };
}
async function fetchAdvancedHistory(options) {
  let cursor = '', accounts = [];
  do {
    const page = await readPage({ ...options, pathname: ACCOUNTS_PATH, cursor });
    accounts.push(...page.list); cursor = page.cursor;
    if (accounts.length > 5000) throw new Error('Coinbase Advanced Trade: Kontenlimit erreicht.');
  } while (cursor);
  const accountBalances = advancedBalances(accounts);
  // All historical movements are handled by the resumable serial job.
  return { rows: [], accountBalances, warnings: [] };
}
module.exports = { signingKey, createReadJwt, readPage, advancedBalances, advancedFillRows, normalizeAppTransactions, normalizeAdvancedState, fetchAdvancedHistory, fetchAdvancedHistoryBatch, HISTORY_WARNING, ACCOUNTS_PATH, FILLS_PATH, APP_ACCOUNTS_PATH };
