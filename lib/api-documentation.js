"use strict";

const { RESOURCES, RELATIONSHIPS, fieldType } = require("./app-api");
const string = (description, extra = {}) => ({ type: "string", description, ...extra });
const number = (description, extra = {}) => ({ type: "number", description, ...extra });
const id = { type: "integer", minimum: 1 };
const boolean = { type: "boolean" };
const object = (properties = {}, required = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });
const array = (items) => ({ type: "array", items });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const year = { type: "integer", minimum: 2009, maximum: 2100, description: "Kalenderjahr; ohne Angabe aktuelles Jahr." };
const purpose = { type: ["string", "null"], maxLength: 80, description: "Zweck; null oder leer entfernt die Zuordnung. Bleibt manuell geschützt." };
const query = (name, schema) => ({ name, in: "query", required: false, schema });
const fields = (names, description) => ({ ...object(Object.fromEntries(names.split(" ").map((name) => [name, {}]))), description });
const jsonBody = (schema, required = true) => ({ required, content: { "application/json": { schema } } });
const errorResponse = { description: "JSON-Fehler mit lesbarer deutscher Meldung.", content: { "application/json": { schema: ref("Error") } } };

// One catalog for machine-readable OpenAPI and the rendered documentation.
// Coverage tests compare this catalog with Express's registered API routes.
function legacyOperations(settingsSchema) {
  const list = [];
  function add(method, path, tag, summary, description, options = {}) {
    list.push({ method, path, tag, summary, description, ...options });
  }
  const body = (properties, required = []) => jsonBody(object(properties, required));
  const ids = array(id);
  const job = fields("job", "Hintergrundjob mit id; Status über GET /api/v1/jobs/{id} bzw. Ergebnis über GET /api/jobs/{id} verfolgen.");
  const walletFields = {
    chain: string("Chain-Kürzel aus /api/v1/metadata."), address: string("Ausschließlich öffentliche Adresse bzw. Bitcoin-xPub/yPub/zPub."),
    sourceType: string("Wallet-Art; bei BTC-xPub automatisch erkennbar.", { enum: ["address", "xpub", "stake"], default: "address" }),
    xpubAddressType: string("Nur Bitcoin-xPub.", { enum: ["p2pkh", "p2sh-p2wpkh", "p2wpkh"], default: "p2wpkh" }),
    label: string("Anzeigename", { maxLength: 80 }), groupName: string("Gruppe", { maxLength: 48 }),
    tags: { ...array({ type: "string", maxLength: 32 }), maxItems: 12 },
  };
  add("get", "/api/portfolio", "Auswertung", "Portfolio und Dashboard", "Bestände, Buchungen, Assets, aktuelle EUR-Preise, Allokation, Buchwertverlauf und FIFO-Kennzahlen. Kann externe Preis-APIs aufrufen; fehlende Preise bleiben null. wallets enthält nur On-Chain-Wallets, transactions zusätzlich Börsenbuchungen. Vollständige Quellenliste über /api/v1/wallets.", { response: fields("wallets transactions holdings balanceReconciliations assetAnalytics assets assetPrices totalValueEur currentPrices insights purposePresets chains", "Vollständige Dashboard-Antwort; aktuell ohne Pagination."), dependencies: ["/api/v1/wallets", "/api/v1/transactions"] });
  add("get", "/api/market/top-30", "Auswertung", "Top-30-Marktübersicht", "Dynamischer CoinGecko-Marktüberblick und Importierbarkeit je Netzwerk; externe Verfügbarkeit und Cache beachten.");
  add("get", "/api/settings", "Einstellungen", "Einstellungen lesen", "Öffentliche Konfiguration inklusive Steuerprofil. Schlüssel ausschließlich als *Configured-Status.", { response: settingsSchema });
  add("put", "/api/settings", "Einstellungen", "Einstellungen speichern", "Zuerst GET /api/settings laden, alle bisherigen Konfigurationsfelder übernehmen und gewünschte Werte ersetzen. Numerische Pflichtwerte und Service-URLs müssen vollständig gesendet werden. Leere Schlüssel behalten vorhandene Werte; clear*-Flags entfernen sie. URLs müssen HTTP(S) ohne eingebettete Credentials sein.", { requestBody: jsonBody(ref("SettingsInput")), response: settingsSchema, dependencies: ["/api/settings"] });
  add("post", "/api/prices/historical/backfill", "Jobs", "Kurse synchron nachbearbeiten (Bestand)", "Wartet auf einen gedrosselten Kursdurchlauf. Neue Apps sollten POST /api/jobs/price-backfill verwenden.", { deprecated: true, response: fields("updated attempted unresolved", "Ergebnis des Kursdurchlaufs.") });
  add("get", "/api/backups", "Betrieb", "Backups auflisten", "Lokale SQLite-Sicherungen mit Name, Größe und Erstellungszeit.", { response: fields("backups", "Liste verfügbarer Dateien.") });
  add("post", "/api/backups", "Betrieb", "Backup erstellen", "Erzeugt eine lokale Datenbankkopie; darin können Provider-Zugangsdaten enthalten sein. Nur bewusst über eine Verwaltungsoberfläche auslösen.", { status: 201 });
  add("get", "/api/backups/{name}/download", "Betrieb", "Backup herunterladen", "Binärer SQLite-Download. Enthält potenziell lokale Zugangsdaten; nicht als normalen App-Datenexport verwenden.", { mime: "application/octet-stream", binary: true });
  add("post", "/api/backups/{name}/restore", "Betrieb", "Backup wiederherstellen", "Destruktiv: ersetzt die aktive Datenbank und beendet den Serverprozess; Docker startet ihn neu. Die App muss vorher eine ausdrückliche Nutzerbestätigung einholen. Der bestehende Endpunkt selbst verlangt kein Bestätigungsfeld.", { response: fields("restored restarting", "Name der wiederhergestellten Datei und Neustartstatus.") });
  add("post", "/api/data/reset", "Betrieb", "Lokale Daten zurücksetzen", "Destruktiv: löscht aktive lokale Daten und beendet den Prozess. Backups bleiben erhalten. Nur nach ausdrücklicher Nutzerbestätigung aufrufen.", { requestBody: body({ confirmation: { type: "string", const: "ALLE DATEN LÖSCHEN" } }, ["confirmation"]), response: fields("reset deleted backupsPreserved restarting", "Lösch- und Neustartstatus.") });
  add("get", "/api/system-status", "Betrieb", "Wallet- und Preisstatus", "Letzte Synchronisierung je On-Chain-Wallet sowie ausstehende Kurs-Retries.", { response: fields("wallets priceRetry", "Aktueller lokaler Betriebsstatus.") });
  add("get", "/api/system-status/automations", "Betrieb", "Automatische Läufe", "Lokale Timer, serielle Queue und sichere Jobmetadaten. Kein Start eines Jobs.", { response: fields("schedules queue", "Zeitpläne und Queue.") });
  add("get", "/api/data-quality", "Datenqualität", "Datenqualität und Vorschläge", "Zähler plus begrenzte Prüfproben (150 fehlende Kurse/Zwecke, 80 Transfers/Dubletten). Vollständige Buchungen über /api/v1/transactions. Vorschläge verändern keine steuerliche Einordnung.", { response: fields("counts missingHistoricPrices unassignedPurposes possibleTransfers possibleDuplicates", "Datenqualitätsübersicht.") });
  add("get", "/api/data-quality/price-fetches", "Datenqualität", "Preisabrufe untersuchen", "Kurs-Pipeline mit Quellen, Erfolgen, Fehlern und paginierten offenen Buchungen.", { parameters: [query("page", { type: "integer", minimum: 1, default: 1 })] });
  add("post", "/api/transfers/link", "Datenqualität", "Transfer bestätigen", "Verknüpft Ausgang und Eingang desselben Assets; beide Zwecke werden manuell auf Transfer gesetzt. Erst nach Prüfung des Vorschlags aufrufen.", { status: 201, requestBody: body({ outgoingTransactionId: id, incomingTransactionId: id, note: string("Begründung", { maxLength: 240 }) }, ["outgoingTransactionId", "incomingTransactionId"]), response: fields("outgoingTransactionId incomingTransactionId purpose", "Bestätigte Beziehung."), dependencies: ["/api/data-quality", "/api/v1/transactions"] });
  add("get", "/api/jobs/{id}", "Jobs", "Job-Ergebnis lesen", "Bestehendes Jobformat mit Status, Fortschritt und geparstem result. Für einheitliche öffentliche Metadaten /api/v1/jobs verwenden.", { response: fields("id type status progress_current progress_total result error_message created_at started_at finished_at", "Job und Ergebnis; weitere Bestandsfelder können enthalten sein.") });
  add("post", "/api/jobs/sync", "Jobs", "Wallet-Synchronisierung einreihen", "walletIds oder eine einzelne walletId angeben. Jobs laufen seriell; 202 bedeutet angenommen, noch nicht abgeschlossen.", { status: 202, requestBody: body({ walletIds: ids, walletId: id }), response: fields("jobs", "Liste der eingereihten Jobs mit id."), dependencies: ["/api/v1/wallets"] });
  add("post", "/api/jobs/price-backfill", "Jobs", "Kurs-Job einreihen", "Fehlende historische Preise gedrosselt ergänzen. force überspringt die Retry-Wartezeit; manuelle Kurse bleiben geschützt.", { status: 202, requestBody: jsonBody(object({ force: boolean }), false), response: job });
  add("get", "/api/notifications", "Hinweise", "Aktuelle Hinweise", "Maximal 40 Hinweise, ungelesene zuerst. unread zählt nur diese Antwort. Vollständige Listen über /api/v1/notifications.", { response: fields("notifications unread", "Hinweise und Anzahl ungelesener Hinweise in dieser Teilmenge.") });
  add("patch", "/api/notifications/read", "Hinweise", "Hinweise als gelesen markieren", "Mit ids ausgewählte Hinweise markieren; bei fehlender/leerer Liste werden alle als gelesen markiert.", { requestBody: jsonBody(object({ ids }), false), response: object({ ok: boolean }) });
  add("get", "/api/tax-report", "Steuern", "FIFO-Jahresreport", "Unverbindliche Steuerschätzung anhand des gespeicherten Profils. Unvollständige Kurse und Lots bleiben erkennbar.", { parameters: [query("year", year)], response: fields("year profile summary sales income availableYears", "Report; zusätzliche FIFO-Lotdaten können enthalten sein."), dependencies: ["/api/v1/transactions", "/api/settings"] });
  add("get", "/api/tax-optimizer", "Steuern", "Verkaufsplanung", "Unverbindliche Planung anhand offener FIFO-Lots und aktueller Preise; kann Preis-APIs aufrufen.", { parameters: [query("year", year)] });
  add("post", "/api/tax-optimizer/simulate", "Steuern", "Verkauf simulieren", "Berechnet eine unverbindliche Schätzung, ohne Buchung oder Blockchain-Transaktion anzulegen. Ohne priceEur wird ein verfügbarer aktueller Preis verwendet.", { requestBody: body({ year, asset: string("Asset-ID, inklusive Contract bei Token.", { maxLength: 80 }), amount: number("Positive Menge", { exclusiveMinimum: 0 }), priceEur: number("EUR je Einheit", { exclusiveMinimum: 0 }) }, ["asset", "amount"]), dependencies: ["/api/tax-report", "/api/portfolio"] });
  add("get", "/api/tax-report/snapshots", "Steuern", "Jahresarchiv", "Snapshot-Metadaten für ein Jahr; alle Jahre über /api/v1/tax-snapshots.", { parameters: [query("year", year)], response: fields("year snapshots", "Jahr und Snapshots.") });
  add("get", "/api/tax-report/snapshots/{id}", "Steuern", "Archivierten Report lesen", "Liefert den gespeicherten Report, das damalige Profil, Original-JSON und Prüfsummenprüfung.", { response: fields("id year profileId profileLabel reportJson checksum createdAt report checksumValid", "Unveränderlicher Dokumentationsstand.") });
  add("post", "/api/tax-report/snapshots", "Steuern", "Jahres-Snapshot anlegen", "Archiviert aktuellen Report und Profil lokal mit SHA-256-Prüfsumme. Snapshot ist danach unveränderbar.", { status: 201, requestBody: jsonBody(object({ year }), false), response: fields("id year profileId profileLabel checksum", "Angelegter Snapshot.") });
  add("get", "/api/tax-report.csv", "Steuern", "Report als CSV", "Semikolongetrennter Download mit Verkaufssegmenten und Erträgen; Schätzung, keine Steuerberatung.", { parameters: [query("year", year)], mime: "text/csv", binary: true });
  add("get", "/api/tax-report/advisor-package", "Steuern", "Dokumentationspaket", "JSON-Download mit Report, Profil, Datenqualität, Belegmetadaten, Kurs-Audit und Transfers. Belegdateien separat herunterladen.", { parameters: [query("year", year)], response: fields("schemaVersion generatedAt year scope report dataQuality evidence priceAudit transfers limitations", "Lokales Organisationspaket.") });
  add("get", "/api/transactions/{id}/documents", "Belege", "Belege einer Buchung", "Listet Metadaten und SHA-256-Prüfsummen; Inhalte separat herunterladen.", { response: fields("transactionId documents", "Buchungs-ID und Belege."), dependencies: ["/api/v1/transactions"] });
  add("post", "/api/transactions/{id}/documents", "Belege", "Beleg hochladen", "Datei direkt als Request-Body senden, kein multipart/form-data. Maximal 5 MiB. X-Document-Name enthält den URL-kodierten Originaldateinamen.", { status: 201, parameters: [{ name: "X-Document-Name", in: "header", schema: string("URL-kodierter Dateiname") }], requestBody: { required: true, content: Object.fromEntries(["application/pdf", "image/jpeg", "image/png", "text/csv", "application/octet-stream"].map((mime) => [mime, { schema: { type: "string", format: "binary" } }])) }, response: fields("id transactionId originalName mimeType byteSize sha256", "Gespeicherte Metadaten.") });
  add("get", "/api/transaction-documents/{id}/download", "Belege", "Beleg herunterladen", "Download mit gespeichertem MIME-Typ und Originaldateinamen.", { binary: true, mime: "application/octet-stream" });
  add("delete", "/api/transaction-documents/{id}", "Belege", "Beleg löschen", "Entfernt Metadaten und lokale Datei dauerhaft.", { response: fields("id deleted", "Löschbestätigung.") });
  add("post", "/api/wallets", "Wallets", "Öffentliche Wallet anlegen", "Speichert bestätigte öffentliche Daten; startet keinen Sync. Private Keys, Seeds und xPrvs sind nicht zulässig. Dubletten je (chain, address) ergeben 409. Antwort im Bestandsformat mit tags als JSON-String; v1 liefert ein Array.", { status: 201, requestBody: body(walletFields, ["chain", "address"]), response: fields("id chain address label source_type xpub_address_type created_at last_synced_at group_name tags", "Gespeicherte Wallet im Bestandsformat."), dependencies: ["/api/v1/metadata"] });
  add("patch", "/api/wallets/{id}", "Wallets", "Wallet-Metadaten setzen", "label, groupName und tags gemeinsam senden; weggelassene Metadaten werden geleert. Adresse und Chain bleiben unverändert.", { requestBody: body({ label: walletFields.label, groupName: walletFields.groupName, tags: walletFields.tags }) });
  add("delete", "/api/wallets/{id}", "Wallets", "Wallet und Buchungen löschen", "Entfernt die Quelle sowie abhängige Buchungen, Metadaten, Verknüpfungen und lokale Belegdateien dauerhaft.", { status: 204 });
  add("post", "/api/wallets/{id}/sync", "Wallets", "Wallet synchron abrufen (Bestand)", "Wartet auf den netzwerkspezifischen Import. Neue Apps sollten POST /api/jobs/sync verwenden, damit Importe seriell in der Queue laufen.", { deprecated: true });
  add("get", "/api/wallets/{id}/qr", "Wallets", "Öffentliche Adresse als QR-Code", "JSON mit Data-URL des QR-Codes; xPub-Daten sind öffentlich, aber datenschutzsensibel.", { response: fields("label address dataUrl", "Beschriftung, Adresse und PNG-Data-URL.") });
  add("get", "/api/import/csv-profiles", "Import", "CSV-Profile", "Unterstützte Formate und Zielanbieter; dieselben Referenzdaten stehen in /api/v1/metadata.", { response: fields("profiles", "Liste der Profile.") });
  add("post", "/api/import/csv", "Import", "CSV-Buchungen importieren", "JSON mit CSV-Text, maximal 2.500 Zeilen und insgesamt 64 KiB JSON-Body. Entweder walletId oder exchangeConnectionId verwenden. Börsenprofil muss zum Zielanbieter passen. Preise und Zwecke werden manuell geschützt.", { status: 201, requestBody: body({ csv: string("CSV-Text; Standardspalten: timestamp,direction,asset,amount; optional fee,purpose,price_eur,hash,counterparty."), profile: string("Profil-ID", { default: "generic" }), walletId: id, exchangeConnectionId: id }, ["csv"]), response: fields("imported walletId exchangeConnectionId profile", "Importanzahl und jeweilige Ziel-ID."), dependencies: ["/api/import/csv-profiles", "/api/v1/wallets", "/api/v1/exchange-connections"] });
  add("get", "/api/exchange-connections", "Börsen", "Börsen und Verbindungsstatus", "Anbieterdefinitionen, sichere Verbindungsansichten, Historienfortschritt, Salden- und Anmeldestatus. Keine gespeicherten Schlüssel oder Sessions.", { response: fields("providers connections", "Anbieter und Verbindungen.") });
  add("get", "/api/exchange-connections/{id}/portfolio", "Börsen", "Börsenportfolio", "Bestände und Buchungen nur dieses Börsenkontos; aktuelle Preise können extern nachgeladen werden.", { response: fields("connection balance assets transactions", "Kontospezifische Auswertung; weitere Summenfelder möglich.") });
  add("post", "/api/exchange-connections", "Börsen", "Börse verbinden", "Erzeugt ein eigenes Börsenkonto und startet den seriellen Import. Ausschließlich Read-only-Zugangsdaten verwenden. Trade Republic: apiKey=Telefonnummer, apiSecret=PIN (wird nicht gespeichert), explizite Einwilligung erforderlich; anschließend App-Anmeldung bestätigen.", { status: 201, requestBody: body({ provider: string("Anbieter-ID aus metadata"), label: string("Name", { maxLength: 80 }), apiKey: { type: "string", writeOnly: true, description: "Read-only-API-Key, 8–512 Zeichen; bei Trade Republic Telefonnummer." }, apiSecret: { type: "string", writeOnly: true, description: "API-Secret, 8–512 Zeichen; bei Trade Republic PIN." }, coinbasePassphrase: { type: "string", writeOnly: true, minLength: 8, maxLength: 100 }, symbols: string("Optionale Binance-Märkte, kommagetrennt"), etoroEnvironment: { type: "string", enum: ["real", "demo"] }, liveUpdatesEnabled: boolean, tradeRepublicConsent: boolean }, ["provider", "apiKey", "apiSecret"]), response: fields("id job", "Sichere Verbindungsansicht plus ggf. Job."), dependencies: ["/api/v1/metadata"] });
  add("post", "/api/exchange-connections/{id}/trade-republic/web-login/start", "Börsen", "Trade-Republic-Anmeldung beginnen", "Inoffizielle Read-only-Webanmeldung starten; erfordert zuvor bestätigte Einwilligung. PIN wird nicht gespeichert. Anmeldung in der Trade-Republic-App bestätigen.", { status: 202, requestBody: body({ pin: { type: "string", writeOnly: true, minLength: 4, maxLength: 16 } }, ["pin"]) });
  add("post", "/api/exchange-connections/{id}/trade-republic/web-login/poll", "Börsen", "App-Bestätigung abfragen", "Sicheren Anmeldestatus abfragen. Nach erfolgreicher Bestätigung wird ein Sync-Job eingereiht. 202 allein bedeutet noch keine bestätigte Anmeldung.", { status: 202 });
  add("patch", "/api/exchange-connections/{id}/binance-markets", "Börsen", "Historische Binance-Märkte setzen", "Ergänzt frühere Spot-Märkte und startet deren Historien-Nachimport erneut.", { status: 202, requestBody: body({ symbols: string("Kommagetrennte Spot-Märkte, z. B. BTCEUR,ETHUSDT") }, ["symbols"]) });
  add("patch", "/api/exchange-connections/{id}/live-updates", "Börsen", "BSDEX-Live-Updates schalten", "enabled=true aktiviert einen seriellen REST-Abgleich und Live-Verbindung (202); false deaktiviert sie (200).", { requestBody: body({ enabled: boolean }, ["enabled"]), extraStatuses: [202] });
  add("post", "/api/exchange-connections/{id}/sync", "Börsen", "Börsen-Sync einreihen", "Startet einen seriellen Read-only-Import; CSV-Quellen bzw. nicht angemeldete Trade-Republic-Verbindungen werden abgelehnt.", { status: 202, response: job });
  add("delete", "/api/exchange-connections/{id}", "Börsen", "Börsenverbindung entfernen", "Entfernt Zugangsdaten und Verbindung; das interne Konto und vorhandene Buchungen bleiben erhalten. Diese können separat über die Wallet-Route gelöscht werden.", { status: 204 });
  add("patch", "/api/transactions/bulk", "Buchungen", "Zwecke gesammelt setzen", "Maximal settings.bulkPurposeLimit, höchstens 2.500 IDs. Manuelle Zuordnungen werden beim Sync geschützt.", { requestBody: body({ ids: { ...ids, minItems: 1, maxItems: 2500 }, purpose }, ["ids"]), response: fields("updated purpose purpose_origin", "Anzahl geänderter Buchungen.") });
  add("patch", "/api/transactions/{id}", "Buchungen", "Zweck setzen", "Setzt bzw. entfernt den Zweck; purpose_origin wird manual.", { requestBody: body({ purpose }), response: fields("id purpose purpose_origin", "Aktualisierte Zuordnung.") });
  add("patch", "/api/transactions/{id}/historical-price", "Buchungen", "Historischen EUR-Kurs korrigieren", "Positiver Preis pro Einheit bis 1 Billion EUR setzt einen geschützten manuellen Kurs. null/leer/fehlend aktiviert wieder die Automatik und entfernt den bisherigen Kurs. Änderung wird protokolliert.", { requestBody: body({ priceTransactionEur: { type: ["number", "null"], exclusiveMinimum: 0, maximum: 1e12 }, note: string("Begründung", { maxLength: 240 }) }), response: fields("id price_transaction_eur price_source price_provider price_recorded_at", "Aktualisierte Kursdaten.") });
  add("get", "/api/transactions/{id}/price-history", "Buchungen", "Letzte Kurskorrekturen", "Aktueller Kurs und maximal 20 letzte Änderungen. Vollständige Historie über /api/v1/price-audit?transaction_id={id}.", { response: fields("transaction changes", "Kurs und Änderungen.") });
  add("post", "/api/bitcoin/psbt-preview", "Bestand", "Bestehende PSBT-Vorschau", "Historischer Endpunkt für Base64-PSBT-Vorschauen. Widerspricht der aktuellen Produktgrenze, keine Transaktionsentwürfe zu verarbeiten; für neue App-Integrationen nicht verwenden. Die neue v1-API bietet keine Signier-, Sende- oder Entwurfsfunktion.", { deprecated: true, requestBody: body({ psbt: string("Legacy-Eingabe; nicht für neue Integrationen.") }, ["psbt"]) });
  add("get", "/api/explorer/{chain}/address/{address}", "Wallets", "Explorer-Link", "Validiert öffentliche Adresse und Chain und liefert den netzwerkspezifischen HTTP(S)-Explorer-Link.", { response: object({ url: { type: "string", format: "uri" } }) });
  return list;
}

function buildOpenApi(settings, { exchangeProviders = {} } = {}) {
  const settingsSchema = object(Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, { type: typeof value === "object" ? "object" : typeof value }])));
  const secretKeys = ["tronGridApiKey", "blockfrostProjectId", "etherscanApiKey", "bscScanApiKey", "snowtraceApiKey", "solscanApiKey", "nearBlocksApiKey", "tonApiKey", "blockchairApiKey", "blockCypherApiToken", "coinGeckoApiKey", "cryptoCompareApiKey"];
  const settingsInput = object({
    ...Object.fromEntries(Object.entries(settingsSchema.properties).filter(([key]) => !key.endsWith("Configured"))),
    ...Object.fromEntries(secretKeys.map((key) => [key, { type: "string", writeOnly: true, maxLength: 300 }])),
    ...Object.fromEntries(["clearTronGridApiKey", "clearBlockfrostProjectId", "clearEtherscanApiKey", "clearAdditionalNetworkApiKeys", "clearCoinGeckoApiKey", "clearCryptoCompareApiKey"].map((key) => [key, boolean])),
  });
  settingsInput.required = [
    "xpubGapLimit", "xpubMaxDerivationsPerBranch", "bulkPurposeLimit", "historicalPriceRetryIntervalMinutes",
    "historicalPriceBackfillBatchSize", "personalTaxRatePercent",
    ...Object.keys(settingsSchema.properties).filter((key) => /(?:BaseUrl|RpcUrl)$/.test(key)),
  ];
  const schemas = {
    Error: object({ error: string("Lesbare Fehlermeldung") }, ["error"]),
    Settings: settingsSchema, SettingsInput: settingsInput,
    Links: { type: "object", additionalProperties: { type: ["string", "null"] }, description: "Relative URLs auf derselben Origin. Fremdschlüssel und rückwärtige Beziehungen sind benannt." },
    Pagination: object({ limit: { type: "integer", minimum: 1, maximum: 500 }, offset: { type: "integer", minimum: 0 }, total: { type: "integer", minimum: 0 }, hasMore: boolean }, ["limit", "offset", "total", "hasMore"]),
  };
  const paths = {};
  function operation(entry) {
    const { method, path, tag, summary, description, status = 200, parameters = [], response = { type: "object", additionalProperties: true }, requestBody, dependencies = [], deprecated = false, binary = false, mime = "application/json", extraStatuses = [] } = entry;
    const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({ name: match[1], in: "path", required: true, schema: fieldType(match[1]) === "integer" ? id : { type: "string" } }));
    const success = (code) => code === 204 ? { description: "Erfolgreich, kein Antwortinhalt." } : { description: code === 202 ? "Angenommen; Status anschließend abfragen." : code === 201 ? "Erstellt." : "Erfolgreich.", content: { [mime]: { schema: binary ? { type: "string", format: "binary" } : response } } };
    (paths[path] ||= {})[method] = {
      operationId: `${method}_${path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      tags: [tag], summary, description, parameters: [...pathParams, ...parameters],
      ...(requestBody ? { requestBody } : {}), ...(deprecated ? { deprecated: true } : {}),
      "x-dependencies": dependencies,
      responses: { [status]: success(status), ...Object.fromEntries(extraStatuses.map((code) => [code, success(code)])), "400": errorResponse, "404": errorResponse, ...(method !== "get" ? { "409": errorResponse, "413": errorResponse } : {}), "500": errorResponse },
    };
  }
  for (const entry of legacyOperations(ref("Settings"))) {
    if (entry.method === "post" && entry.path === "/api/exchange-connections" && !exchangeProviders.coinbase) {
      delete entry.requestBody.content["application/json"].schema.properties.coinbasePassphrase;
    }
    operation(entry);
  }
  operation({ method: "get", path: "/api/v1", tag: "App-Einstieg", summary: "API entdecken", description: "Version, Ressourcen, Schlüssel, Filter, Beziehungen, Feature-URLs und Konventionen. Einstieg ohne externe Netzwerkabfragen." });
  operation({ method: "get", path: "/api/v1/metadata", tag: "App-Einstieg", summary: "Referenzdaten und Abhängigkeiten", description: "Chains mit CoinGecko-IDs und Explorer-Vorlagen, Wallet-Arten, Zwecke, Börsenanbieter, CSV-Profile, Limits und Beziehungen. Kein Zugriff auf externe Dienste." });
  operation({ method: "get", path: "/api/v1/settings", tag: "App-Einstieg", summary: "App-Konfiguration", description: "Öffentliche Einstellungen und Steuerprofil. Keine Klartext-Schlüssel.", response: ref("Settings") });
  operation({ method: "get", path: "/api/openapi.json", tag: "App-Einstieg", summary: "OpenAPI-Vertrag", description: "Diese maschinenlesbare OpenAPI-3.1-Dokumentation mit allen registrierten API-Endpunkten, Parametern und Datenbeziehungen." });
  for (const [name, definition] of Object.entries(RESOURCES)) {
    const properties = Object.fromEntries(definition.fields.map((field) => [field, { type: definition.keys.includes(field) ? fieldType(field) : [fieldType(field), "null"] }]));
    for (const [field, type] of Object.entries(definition.extra || {})) properties[field] = type === "array" ? array({ type: "string" }) : { type: [type, "null"] };
    properties.links = ref("Links");
    schemas[name] = object(properties, [...definition.fields, ...Object.keys(definition.extra || {}), "links"]);
    const base = `/api/v1/${name}`;
    const parameters = [query("limit", { type: "integer", minimum: 1, maximum: 500, default: 100 }), query("offset", { type: "integer", minimum: 0, default: 0 }), ...definition.filters.map((filter) => query(filter, { type: fieldType(filter), description: "Exakter Vergleich; mehrere Filter werden mit UND verknüpft." }))];
    const dependencies = RELATIONSHIPS.filter((relation) => relation.from === name).map((relation) => `/api/v1/${relation.to}`);
    operation({ method: "get", path: base, tag: "App-Daten", summary: `${name}: Liste`, description: `${definition.description} Aufsteigend nach ${definition.keys.join(", ")}. Strikte Filtervalidierung; unbekannte/mehrfach angegebene Parameter ergeben 400. Fehlermeldungen werden gekürzt und um Provider-URLs bereinigt.`, parameters, dependencies, response: object({ data: array(ref(name)), pagination: ref("Pagination"), links: ref("Links") }, ["data", "pagination", "links"]) });
    operation({ method: "get", path: `${base}/${definition.keys.map((key) => `{${key}}`).join("/")}`, tag: "App-Daten", summary: `${name}: Einzelabruf`, description: `${definition.description} Kein Query-Parameter; ungültiger Schlüssel ergibt 400, unbekannter Datensatz 404. Pfadsegmente URL-kodieren.`, dependencies, response: object({ data: ref(name) }, ["data"]) });
  }
  return {
    openapi: "3.1.0", info: { title: "CryptoBuch App-API", version: "1.0.0", description: "Lokale Organisationshilfe. Historische Werte und Steuerwerte sind unverbindliche Schätzungen. Die v1-Lese-API liefert öffentliche normalisierte Daten und Beziehungen; bestehende Aktionsrouten bleiben verfügbar. JSON-Body maximal 64 KiB, Belege 5 MiB. Keine eingebaute Authentifizierung oder CORS-Freigabe; externer Zugriff benötigt einen geschützten HTTPS-Zugang. Keine Seeds, privaten Wallet-Schlüssel, Signaturen oder Transaktionsentwürfe übermitteln." },
    servers: [{ url: "/", description: "Origin dieser CryptoBuch-Installation" }],
    paths, components: { schemas }, "x-relationships": RELATIONSHIPS,
  };
}

module.exports = { buildOpenApi };
