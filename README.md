# CryptoBuch

Ein lokal installierbares Crypto-Portfolio für öffentliche Bitcoin- und Tezos-Wallet-Adressen. Die Anwendung speichert keine Private Keys und keine Seed-Phrases.

## Start mit Docker

```bash
docker compose up -d --build
```

Danach ist die Anwendung unter [http://localhost:3000](http://localhost:3000) erreichbar. Die SQLite-Datenbank liegt im Docker-Volume `cryptobuch_data` und bleibt bei Container-Neustarts erhalten.

Zum Anhalten:

```bash
docker compose down
```

`docker compose down -v` entfernt zusätzlich das Daten-Volume und damit Wallets, importierte Transaktionen und Zuordnungen.

## Funktionen

- Öffentliche Bitcoin- und Tezos-Wallet-Adressen mit frei wählbarem Namen speichern
- Vollständige Historie aus Blockstream Esplora (Bitcoin) und TzKT (Tezos) synchronisieren
- Ein- und Ausgänge, eigene Transfers, Gebühren und Gegenadressen in einer Tabelle darstellen
- Aktuellen EUR-Marktpreis sowie EUR-Preis zum Transaktionsdatum anzeigen
- Transaktionen einzeln oder gesammelt mit Zwecken wie `Kauf`, `Verkauf`, `Staking Rewards` oder `Transfer` versehen – eigene Zwecke sind ebenfalls möglich
- Suchen sowie nach Blockchain und Bewegungsrichtung filtern

## Datenquellen und Grenzen

- Bitcoin-Transaktionen werden über die öffentliche [Blockstream Esplora API](https://github.com/Blockstream/esplora/blob/master/API.md) abgerufen.
- Tezos-Transaktionen werden über die öffentliche [TzKT API](https://api.tzkt.io/) abgerufen. Die sichtbare Quellenangabe in der Anwendung erfüllt deren Vorgabe für die kostenfreie API.
- Aktuelle und historische EUR-Kurse kommen von [CoinGecko](https://www.coingecko.com/en/api). Historische Kurse werden pro Kalendertag in der lokalen Datenbank zwischengespeichert. Falls der Kursdienst zeitweise nicht erreichbar ist, bleiben Transaktionen sichtbar; für den Preis steht dann `k. A.`.
- Die Anwendung ist eine Organisationshilfe und keine steuerliche Beratung. Für eine Steuererklärung sollten Zuordnungen und Kursdaten fachlich geprüft werden.

## Konfiguration

Optional kann die Anzahl importierter Transaktionen je Synchronisation begrenzt werden. Dazu `.env.example` nach `.env` kopieren und beispielsweise setzen:

```dotenv
MAX_TRANSACTIONS_PER_SYNC=1000
```

Der Standardwert `0` lädt alle vom jeweiligen Explorer verfügbaren Transaktionen.

Falls die öffentliche Blockstream-API Anfragen begrenzt, kann ein eigener Esplora-kompatibler Endpunkt konfiguriert werden:

```dotenv
BITCOIN_EXPLORER_BASE_URL=https://dein-esplora.example/api
```

## Lokale Entwicklung

```bash
npm install
npm run dev
```

Für die Tests:

```bash
npm test
```
