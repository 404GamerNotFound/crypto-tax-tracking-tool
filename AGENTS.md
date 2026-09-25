# CryptoBuch – Hinweise für KI-Agenten

## Ziel und Produktgrenzen

CryptoBuch ist ein lokal betriebenes, Docker-fähiges Portfolio- und Buchungsjournal für öffentliche Blockchain-Daten. Es ist eine Organisationshilfe, keine Börse, kein Custody-System und keine Steuerberatung.

Die Anwendung darf **niemals** Seed-Phrases, Private Keys, xPrvs, Signaturen oder Transaktions-Entwürfe annehmen, speichern, verarbeiten oder übertragen. Unterstützt werden ausschließlich öffentliche Adressen, Bitcoin Extended Public Keys und Cardano-Stake-Adressen.

Änderungen müssen diese Grenzen erhalten:

- Ledger ist ausschließlich read-only und kommuniziert im Browser direkt mit dem Gerät.
- Der Server und die SQLite-Datenbank erhalten nur bestätigte öffentliche Adressen bzw. xPubs.
- Blockchain-Importer bleiben netzwerkspezifisch. Keine universelle Multi-Chain-API als Ersatz für vorhandene Einzeladapter einführen.
- Historische Werte, Steuerwerte und Hinweise eindeutig als Schätzung bzw. Organisationshilfe kennzeichnen.

## Architektur

- `server.js`: Express-API, SQLite-Schema/Migrationen, Einstellungen, Adapter-Orchestrierung, Preis-Nachbearbeitung, lokale Hintergrundjobs und Backups.
- `lib/`: isolierte Fachlogik. Neue Parser, Normalisierer und Berechnungen gehören hierher und brauchen Unit-Tests.
- `public/`: bewusst frameworkfreies HTML/CSS/JavaScript. Seiten laden Daten über `/api/*`.
- `client/ledger-connect.js`: Browser-Bundle für die direkte Ledger-Verbindung; Quelle bleibt getrennt vom generierten Bundle.
- `public/ledger-connect.js`: generiertes Artefakt. Nicht von Hand ändern; mit `npm run build:ledger` erzeugen.
- `data/`: lokale SQLite-Laufzeitdaten, nicht als Quellcode behandeln.
- `Dockerfile` erzeugt beim Image-Build das Ledger-Bundle.

Die Anwendung benötigt Node.js 22+ mit `--experimental-sqlite`. Es gibt keine ORM- oder Frontend-Build-Pipeline außer dem Ledger-Bundle.

## Datenmodell und Migrationen

Wichtige Tabellen:

- `wallets`: öffentliche Wallet-Quellen; Eindeutigkeit gilt für `(chain, address)`.
- `wallet_metadata`: Gruppen und Tags; nie die bestehende Wallet-Tabelle unnötig umbauen.
- `transactions`: normalisierte On-Chain- und CSV-Bewegungen. Manuelle Kurse/Zwecke sind gegen Synchronisierung geschützt.
- `price_history`, `historical_price_retries`, `transaction_price_audit`: historische Kursdaten, Retries und Audit-Trail.
- `background_jobs`, `sync_events`, `notifications`: serielle lokale Jobs, Sync-Historie und persistente Hinweise.
- `app_settings`: Weboberflächen-Einstellungen haben Vorrang vor Umgebungsvariablen nach dem ersten Speichern.

Bei Schemaänderungen müssen bestehende Datenbanken migrationssicher bleiben. Verwende additive Tabellen/Spalten, wenn möglich. Wenn eine Tabellenmigration unvermeidbar ist, zuerst Fremdschlüssel- und Unique-Constraints älterer Installationen prüfen und vorhandene Daten verlustfrei übernehmen.

## Wallets, Chains und Importer

`lib/validation.js` enthält `CHAIN_CONFIG`; `server.js` enthält die passenden `CHAIN_ADAPTERS`. Für eine neue Blockchain immer gemeinsam ergänzen:

1. Chain-Metadaten, Explorer-Links, CoinGecko-ID und Adressvalidierung.
2. Einen eigenen Adapter zum Abruf und zur Normalisierung.
3. Konfiguration/Keys ausschließlich serverseitig über Einstellungen oder Umgebungsvariablen.
4. Tests mit repräsentativen nativen Transaktionen und ggf. Token-/Gebührenfällen.
5. UI-Texte, Wallet-Dialog und README.

Aktive Schwerpunkte:

- Bitcoin: einzelne Adresse sowie `xpub`/`ypub`/`zpub`, Empfangs- und Wechselgeldzweig mit Gap-Limit.
- Cardano: Zahlungsadresse oder Stake-Adresse; Stake-Import fasst verbundene Zahlungsadressen zusammen.
- Ethereum: ETH und ERC-20; Contract-Adresse ist Teil der Asset-Identität.
- Weitere native Adapter: BNB, SOL, XRP, XLM, DOGE, BCH, NEAR, LTC, AVAX, TON und transparente ZEC-Adressen.

Bitcoin-xPubs sind öffentlich, aber datenschutzsensibel. Niemals private Extended Keys akzeptieren. Für CSV-Nachträge gilt ein Hard-Limit von 2.500 Zeilen pro Import.

## Preise, Zwecke und Steuerlogik

- Preise pro Transaktion werden in EUR gespeichert. Manuelle Werte haben `price_source = 'manual'` und dürfen nie überschrieben werden.
- Fehlende Kurse werden seriell und gedrosselt nachbearbeitet; die Preis-APIs nicht mit parallelen Schleifen belasten.
- Tezos kann einen TzKT-Kurs am Blockzeitpunkt liefern. Andere native Assets nutzen CoinGecko mit Bitvavo-Tageskurs-Fallback; ERC-20 nutzt Contract-Kurse, soweit verfügbar.
- Zwecke sind fachlich relevant: mindestens `Kauf`, `Verkauf`, `Staking Rewards`, `Transfer` und die vorhandenen Ertragsarten erhalten.
- Manuelle Zweckzuordnungen (`purpose_origin = 'manual'`) nie beim Sync überschreiben.
- Die Steuerlogik nutzt FIFO. Unvollständige Kurs-/Lotdaten bleiben sichtbar und werden nicht stillschweigend geschätzt.
- Das Steuerzentrum verwendet ein konfigurierbares Steuerprofil. Die Deutschland-Vorlage und frei anpassbare Länderprofile dürfen Haltefrist, Freigrenze, Verlustverrechnung, Ertragsarten sowie getrennte Schätzsätze abbilden; Ergebnisse bleiben stets **unverbindliche Schätzungen** und keine Steuerberatung.
- Jahres-Snapshots enthalten Report, Profil und SHA-256-Prüfsumme. Sie sind lokal, nach dem Erzeugen unveränderbar und dienen nur als Dokumentationsstand.

## Hintergrundjobs und Benachrichtigungen

- Wallet-Synchronisierung und Preis-Backfill verwenden `background_jobs` und laufen seriell.
- Neue rechen- oder netzwerkintensive Aufgaben in die Job-Queue einordnen, nicht im Browser parallel abarbeiten.
- Job-Erfolge, Fehler und relevante offene Datenpunkte können als lokale `notifications` erscheinen.
- Benachrichtigungen bleiben in-app und lokal, solange keine explizite Nutzerfreigabe für E-Mail, Webhook oder Drittanbieter vorliegt.

## Ledger

- `client/ledger-connect.js` darf nur öffentliche Konto-/Adressdaten lesen.
- Bitcoin unterstützt einzelne Adresse und Konto-xPub für BIP44/49/84.
- Die Ethereum-App kann für ETH, BNB Smart Chain und Avalanche C-Chain verwendet werden; die Ziel-Chain muss beim Speichern korrekt gewählt sein.
- Bundle lazy laden: Wallet-Seite darf das große Ledger-Bundle nicht beim ersten Seitenaufruf laden.
- WebHID bevorzugen, WebUSB als Fallback. HTTPS ist außerhalb von `localhost` erforderlich.
- Hardware-Fehler benutzerverständlich übersetzen; keine Rohdaten, Seeds oder APDU-Nutzdaten loggen.

## UI und Bedienung

- Die Oberflächensprache ist Deutsch.
- Die Seiten sind frameworkfrei und müssen auf Desktop sowie Mobilgeräten funktionieren.
- Neue Kennzahlen benötigen Herkunft und Einschränkung im UI, besonders bei historischen Werten, Renditen und Steuer-Schätzungen.
- Dashboard: Bestände, Allokation, Buchwertverlauf sowie bekannte realisierte/unrealisierte Werte klar trennen.
- Datenqualität: fehlende Kurse, unzugeordnete Zwecke, Transfer-Vorschläge und mögliche Dubletten zeigen, aber keine automatische steuerliche Umklassifizierung ohne nachvollziehbare Regel durchführen.

## Sicherheit und Betrieb

- API-Keys bleiben serverseitig; `GET /api/settings` darf nur Statusinformationen, niemals Klartext-Schlüssel liefern.
- Eingaben validieren und Längen begrenzen. Externe URLs ausschließlich als HTTP(S) ohne eingebettete Credentials akzeptieren.
- Backups und Wiederherstellungen sind destruktive Vorgänge. Wiederherstellung braucht eine ausdrückliche Bestätigung.
- Docker-Volume und Port/Container-Konfiguration sind Infrastruktur und bleiben Portainer-/Docker-Aufgabe.
- Neue Abhängigkeiten nur einführen, wenn sie notwendig sind; anschließend `npm audit --omit=dev` prüfen und relevante Warnungen dokumentieren.

## Arbeitsablauf

Vor dem Abschluss mindestens ausführen:

```bash
npm test
git diff --check
```

Bei Änderungen an Ledger-Code zusätzlich:

```bash
npm run build:ledger
node --check public/ledger-connect.js
```

Bei Docker-relevanten Änderungen, wenn die lokale Docker-Engine läuft:

```bash
docker compose build
```

Bestehende, nicht zur Aufgabe gehörende Änderungen im Worktree gehören dem Nutzer und dürfen nicht zurückgesetzt, überschrieben oder bereinigt werden.

## Abschlusskommunikation

Antworte auf Deutsch und beginne mit dem Ergebnis. Beschreibe die Anpassungen technisch, aber knapp:

- betroffene Funktionen und Datenmigrationen,
- Sicherheits- oder Datenqualitätsauswirkungen,
- ausgeführte Prüfungen und deren Ergebnis,
- verbleibende Grenzen, insbesondere bei Steuerlogik, Hardware-Geräten und externen APIs.
