"use strict";

// Public projections are deliberately explicit: new database columns must never
// silently become part of the app contract (especially credentials and raw JSON).
const resource = (table, fields, filters = [], options = {}) => ({
  table, fields: fields.split(" "), filters, keys: ["id"], ...options,
});
const RESOURCES = {
  wallets: resource("wallets", "id chain address label source_type xpub_address_type created_at last_synced_at", ["chain", "source_type"], {
    description: "Alle Buchungsquellen inklusive interner Börsenkonten, Gruppen und Tags.",
    extra: { group_name: "string", tags: "array" },
  }),
  transactions: resource("transactions", "id wallet_id external_id hash timestamp direction asset asset_symbol asset_name asset_decimals asset_contract asset_type amount fee fee_asset counterparty price_transaction_eur price_source price_provider price_recorded_at purpose purpose_origin created_at updated_at", ["wallet_id", "asset", "direction", "purpose", "price_source"], {
    description: "Normalisierte Buchungen. Fehlende Kurse bleiben null; asset enthält die Asset-Identität, einschließlich Token-Contract. Keine ungeprüften Provider-Rohdaten.",
  }),
  "wallet-addresses": resource("wallet_addresses", "id wallet_id address branch derivation_index is_used last_checked_at", ["wallet_id"], {
    description: "Bereits lokal entdeckte öffentliche xPub-Adressen mit Empfangs-/Wechselgeldzweig (0/1). Kein neuer Scan durch diesen Abruf.",
  }),
  "exchange-connections": resource("exchange_connections", "id wallet_id provider label symbols import_mode etoro_environment history_started_at history_completed_at last_synced_at created_at live_updates_enabled live_status live_connected_at live_last_event_at live_last_reconciled_at", ["wallet_id", "provider"], {
    description: "Börsenquellen und zugehörige Konten. Zugangsdaten, Telefonnummern, Sitzungen und interne Import-Cursor werden nicht ausgegeben. Detaillierten Import-/Anmeldestatus liefert GET /api/exchange-connections.",
  }),
  "exchange-balances": resource("exchange_balance_snapshots", "connection_id asset free_amount locked_amount", ["connection_id", "asset"], {
    keys: ["connection_id", "asset"], extra: { observed_at: "string" },
    description: "Letzter lokal gespeicherter Börsensaldo, getrennt nach frei/verfügbar und gesperrt; observed_at bezeichnet den Abrufzeitpunkt.",
  }),
  transfers: resource("transfer_links", "id outgoing_transaction_id incoming_transaction_id match_origin note created_at", ["outgoing_transaction_id", "incoming_transaction_id"], {
    description: "Bestätigte Beziehungen zwischen Ausgangs- und Eingangsbuchung. Unbestätigte Vorschläge: GET /api/data-quality.",
  }),
  documents: resource("transaction_documents", "id transaction_id original_name mime_type byte_size sha256 created_at", ["transaction_id"], {
    description: "Belegmetadaten und Prüfsummen; Dateiinhalt über links.download. Interne Dateipfade bleiben verborgen.",
  }),
  "price-history": resource("price_history", "coin_id price_date price_eur source updated_at", ["coin_id", "price_date"], {
    keys: ["coin_id", "price_date"], description: "Lokal gespeicherte historische EUR-Kurse nach Preis-ID und UTC-Kalendertag; keine zusätzliche externe Abfrage.",
  }),
  "price-audit": resource("transaction_price_audit", "id transaction_id price_eur source note changed_at", ["transaction_id"], {
    description: "Vollständige Historie der Kurskorrekturen, einschließlich manueller Änderungen und Rückkehr zur Automatik.",
  }),
  "price-retries": resource("historical_price_retries", "transaction_id attempt_count last_attempt_at next_attempt_at", ["transaction_id"], {
    keys: ["transaction_id"], description: "Geplante Wiederholungen für fehlende historische Preise mit Bezug zur Buchung.",
  }),
  "price-runs": resource("historical_price_runs", "id trigger force_run status pending_count attempted_count updated_count unresolved_count error_message started_at finished_at", ["status"], {
    description: "Protokoll der lokalen Preis-Nachbearbeitung. Verknüpfte Provider-Abrufe stehen unter price-fetch-events.",
  }),
  "price-fetch-events": resource("historical_price_fetch_events", "id run_id source asset date_from date_to status returned_prices error_message started_at finished_at", ["run_id", "asset", "status"], {
    description: "Historische Provider-Abrufe mit Zeitraum, Ergebnis und Bezug zum Preis-Durchlauf.",
  }),
  "sync-events": resource("sync_events", "id wallet_id status imported_count message created_at", ["wallet_id", "status"], {
    description: "Gespeicherte Wallet-Synchronisierungen und Importanzahlen.",
  }),
  jobs: resource("background_jobs", "id type status progress_current progress_total error_message created_at started_at finished_at", ["type", "status"], {
    extra: { wallet_id: "integer", connection_id: "integer" },
    description: "Serielle Hintergrundjobs und Fortschritt. Öffentliche Ziel-IDs werden aus dem Auftrag übernommen; interne Payloads und Ergebnis-Rohdaten bleiben verborgen. Ergebnisdetails: GET /api/jobs/{id}.",
  }),
  notifications: resource("notifications", "id level title message is_read created_at", ["level", "is_read"], {
    description: "Alle lokalen Benachrichtigungen, einschließlich bereits gelesener Hinweise. is_read ist 0 oder 1.",
  }),
  "tax-snapshots": resource("tax_report_snapshots", "id year profile_id profile_label report_checksum created_at", ["year"], {
    description: "Unveränderliche Jahres-Snapshots mit SHA-256-Prüfsumme. Archivierter Report und Profil einschließlich Prüfsummenprüfung: links.report.",
  }),
};

// Source field -> public target; also generates reverse collection links.
const RELATIONSHIPS = [
  ["transactions", "wallet_id", "wallets", "id"],
  ["wallet-addresses", "wallet_id", "wallets", "id"],
  ["exchange-connections", "wallet_id", "wallets", "id"],
  ["exchange-balances", "connection_id", "exchange-connections", "id"],
  ["transfers", "outgoing_transaction_id", "transactions", "id"],
  ["transfers", "incoming_transaction_id", "transactions", "id"],
  ["documents", "transaction_id", "transactions", "id"],
  ["price-audit", "transaction_id", "transactions", "id"],
  ["price-retries", "transaction_id", "transactions", "id"],
  ["price-fetch-events", "run_id", "price-runs", "id"],
  ["sync-events", "wallet_id", "wallets", "id"],
  ["jobs", "wallet_id", "wallets", "id"],
  ["jobs", "connection_id", "exchange-connections", "id"],
].map(([from, field, to, targetField]) => ({ from, field, to, targetField }));

const INTEGER_FIELDS = new Set("id wallet_id transaction_id outgoing_transaction_id incoming_transaction_id connection_id run_id branch derivation_index is_used asset_decimals byte_size attempt_count force_run pending_count attempted_count updated_count unresolved_count returned_prices imported_count progress_current progress_total is_read year live_updates_enabled".split(" "));
const NUMBER_FIELDS = new Set("amount fee price_transaction_eur price_eur free_amount locked_amount".split(" "));
function fieldType(field) {
  return INTEGER_FIELDS.has(field) ? "integer" : NUMBER_FIELDS.has(field) ? "number" : "string";
}
function apiError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
function integer(value, label, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum || Number(value) > maximum) {
    throw apiError(`${label} muss eine ganze Zahl zwischen ${minimum} und ${maximum} sein.`);
  }
  return Number(value);
}
function scalar(value, field) {
  if (fieldType(field) === "integer") return integer(value, field, field === "is_read" ? 0 : 1, field === "is_read" ? 1 : Number.MAX_SAFE_INTEGER);
  if (typeof value !== "string" || !value.length || value.length > 240) throw apiError(`${field} muss zwischen 1 und 240 Zeichen enthalten.`);
  if (field === "price_date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw apiError("price_date muss ein gültiges Datum im Format YYYY-MM-DD sein.");
  return value;
}
function parseQuery(definition, query) {
  const allowed = new Set(["limit", "offset", ...definition.filters]);
  for (const key of Object.keys(query)) if (!allowed.has(key)) throw apiError(`Unbekannter Parameter: ${key}.`);
  const limit = query.limit === undefined ? 100 : integer(query.limit, "limit", 1, 500);
  const offset = query.offset === undefined ? 0 : integer(query.offset, "offset", 0);
  const filters = Object.entries(query).filter(([key]) => definition.filters.includes(key)).map(([key, value]) => [key, scalar(value, key)]);
  return { limit, offset, filters };
}
function itemPath(name, record) {
  return `/api/v1/${name}/${RESOURCES[name].keys.map((key) => encodeURIComponent(record[key])).join("/")}`;
}
function linksFor(name, record) {
  const links = { self: itemPath(name, record) };
  for (const relation of RELATIONSHIPS) {
    if (relation.from === name && record[relation.field] != null) links[relation.field] = `/api/v1/${relation.to}/${encodeURIComponent(record[relation.field])}`;
    if (relation.to === name && RESOURCES[relation.from].filters.includes(relation.field)) {
      links[`${relation.from}.${relation.field}`] = `/api/v1/${relation.from}?${new URLSearchParams({ [relation.field]: record[relation.targetField] })}`;
    }
  }
  if (name === "documents") links.download = `/api/transaction-documents/${record.id}/download`;
  if (name === "tax-snapshots") links.report = `/api/tax-report/snapshots/${record.id}`;
  if (name === "jobs") links.result = `/api/jobs/${record.id}`;
  if (name === "exchange-connections") links.portfolio = `/api/exchange-connections/${record.id}/portfolio`;
  return links;
}
function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function registerAppApi(app, { db, settingsResponse, chains, purposePresets, exchangeProviders, csvProfiles, safeMessage }) {
  function project(name, row) {
    const result = { ...row };
    if (name === "wallets") {
      const metadata = db.prepare("SELECT group_name, tags FROM wallet_metadata WHERE wallet_id = ?").get(row.id);
      result.group_name = metadata?.group_name || "";
      const tags = parseJson(metadata?.tags, []);
      result.tags = Array.isArray(tags) ? tags : [];
    }
    if (name === "exchange-balances") result.observed_at = db.prepare("SELECT observed_at FROM exchange_balance_snapshot_meta WHERE connection_id = ?").get(row.connection_id)?.observed_at || null;
    if (name === "jobs") {
      const payload = parseJson(db.prepare("SELECT payload_json FROM background_jobs WHERE id = ?").get(row.id)?.payload_json, {}) || {};
      result.wallet_id = Number.isSafeInteger(payload.walletId) && payload.walletId > 0 ? payload.walletId : null;
      result.connection_id = Number.isSafeInteger(payload.connectionId) && payload.connectionId > 0 ? payload.connectionId : null;
    }
    // Provider failures may embed request URLs or authorization values.
    for (const field of ["error_message", "message"]) if (field in result) result[field] = safeMessage(result[field]);
    result.links = linksFor(name, result);
    return result;
  }

  app.get("/api/v1", (_request, response) => response.json({
    apiVersion: "1.0.0", documentation: "/api-docs.html", openapi: "/api/openapi.json",
    metadata: "/api/v1/metadata", settings: "/api/v1/settings",
    resources: Object.fromEntries(Object.entries(RESOURCES).map(([name, definition]) => [name, {
      url: `/api/v1/${name}`, detail: `/api/v1/${name}/${definition.keys.map((key) => `{${key}}`).join("/")}`,
      description: definition.description, keys: definition.keys, filters: definition.filters,
    }])),
    relationships: RELATIONSHIPS,
    features: {
      portfolio: "/api/portfolio", market: "/api/market/top-30", dataQuality: "/api/data-quality",
      taxReport: "/api/tax-report", taxOptimizer: "/api/tax-optimizer", systemStatus: "/api/system-status",
      automations: "/api/system-status/automations", backups: "/api/backups", exchangeStatus: "/api/exchange-connections",
    },
    conventions: {
      pagination: "limit (1–500, Standard 100), offset (ab 0); aufsteigende Reihenfolge nach Primärschlüssel. links.next bis null folgen. Kein Snapshot über mehrere Abrufe; bei parallelen Änderungen erneut laden.",
      fields: "Ressourcenfelder in snake_case; bestehende Aktionsrouten verwenden teilweise camelCase. Zeitstempel ohne Zeitzone sind UTC. Fehlende Werte bleiben null.",
      access: "Lokale API ohne eingebaute Authentifizierung oder CORS-Freigabe. Web-Apps über dieselbe Origin/einen Reverse Proxy; Zugriff außerhalb des vertrauenswürdigen Netzes nur über einen authentifizierten HTTPS-Zugang.",
      privacy: "Öffentliche Adressen und xPubs sind datenschutzsensibel. Keine Wallet-Schlüssel, Provider-Zugangsdaten, Sessions oder ungeprüften Provider-Rohdaten in der v1-Lese-API. Backups separat behandeln: sie enthalten lokale Zugangsdaten.",
      estimates: "Historische Werte und Steuerberechnungen sind unverbindliche Schätzungen und Organisationshilfe, keine Steuerberatung.",
    },
  }));
  app.get("/api/v1/metadata", (_request, response) => response.json({
    apiVersion: "1.0.0", currency: "EUR", chains: Object.fromEntries(Object.entries(chains).map(([key, value]) => [key, {
      name: value.name, asset: value.asset, decimals: value.decimals, icon: value.icon,
      addressPlaceholder: value.addressPlaceholder, addressHint: value.addressHint,
      coinGeckoId: value.coinGeckoId, explorer: value.explorer,
      sourceTypes: key === "BTC" ? ["address", "xpub"] : key === "ADA" ? ["address", "stake"] : ["address"],
    }])),
    purposePresets, exchangeProviders: Object.values(exchangeProviders), csvProfiles: Object.values(csvProfiles),
    limits: { pageSize: 500, jsonBodyBytes: 65536, csvRows: 2500, documentBytes: 5242880 },
    relationships: RELATIONSHIPS,
  }));
  app.get("/api/v1/settings", (_request, response) => response.json(settingsResponse()));

  for (const [name, definition] of Object.entries(RESOURCES)) {
    const columns = definition.fields.join(", ");
    const base = `/api/v1/${name}`;
    app.get(base, (request, response, next) => {
      try {
        const { limit, offset, filters } = parseQuery(definition, request.query);
        const where = filters.length ? ` WHERE ${filters.map(([key]) => `${key} = ?`).join(" AND ")}` : "";
        const values = filters.map(([, value]) => value);
        const total = db.prepare(`SELECT COUNT(*) AS total FROM ${definition.table}${where}`).get(...values).total;
        const rows = db.prepare(`SELECT ${columns} FROM ${definition.table}${where} ORDER BY ${definition.keys.join(", ")} LIMIT ? OFFSET ?`).all(...values, limit, offset);
        const pageUrl = (pageOffset) => `${base}?${new URLSearchParams({ ...Object.fromEntries(filters), limit, offset: pageOffset })}`;
        response.json({
          data: rows.map((row) => project(name, row)),
          pagination: { limit, offset, total, hasMore: offset + rows.length < total },
          links: { self: pageUrl(offset), next: offset + rows.length < total ? pageUrl(offset + limit) : null },
        });
      } catch (error) { next(error); }
    });
    app.get(`${base}/${definition.keys.map((key) => `:${key}`).join("/")}`, (request, response, next) => {
      try {
        if (Object.keys(request.query).length) throw apiError("Einzelabrufe akzeptieren keine Query-Parameter.");
        const values = definition.keys.map((key) => scalar(request.params[key], key));
        const row = db.prepare(`SELECT ${columns} FROM ${definition.table} WHERE ${definition.keys.map((key) => `${key} = ?`).join(" AND ")}`).get(...values);
        if (!row) throw apiError("Datensatz nicht gefunden.", 404);
        response.json({ data: project(name, row) });
      } catch (error) { next(error); }
    });
  }
}

module.exports = { RESOURCES, RELATIONSHIPS, fieldType, parseQuery, linksFor, registerAppApi };
