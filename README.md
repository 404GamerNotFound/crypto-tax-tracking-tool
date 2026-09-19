# CryptoBuch

Ein lokal installierbares Crypto-Portfolio für öffentliche Bitcoin-, Tezos- und TRON-Wallet-Adressen. Die Anwendung speichert keine Private Keys und keine Seed-Phrases.

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

- Öffentliche Bitcoin-, Tezos- und TRON-Wallet-Adressen mit frei wählbarem Namen speichern
- Bitcoin-xPubs importieren und daraus abgeleitete Empfangs- sowie Wechselgeldadressen mit BIP44-Gap-Limit erkennen
- Vollständige Historie aus Blockstream Esplora (Bitcoin), TzKT (Tezos) und TronGrid (bestätigte native TRX-Transfers) synchronisieren
- Ein- und Ausgänge, eigene Transfers, Gebühren und Gegenadressen in einer Tabelle darstellen
- Aktuellen EUR-Marktpreis sowie EUR-Preis zum Transaktionsdatum anzeigen; Tezos verwendet dafür den von TzKT zum Blockzeitpunkt gelieferten EUR-Kurs, Bitcoin und TRON einen CoinGecko-Tageskurs
- Transaktionen einzeln oder gesammelt mit Zwecken wie `Kauf`, `Verkauf`, `Staking Rewards` oder `Transfer` versehen – eigene Zwecke sind ebenfalls möglich
- Bis zu 2.500 Transaktionen in einem Sammelvorgang bearbeiten
- Suchen sowie nach Blockchain und Bewegungsrichtung filtern
- Bestätigte XTZ-Eingänge von vertrauenswürdig benannten Payout-Konten automatisch als `Staking Rewards` markieren; manuelle Zwecke bleiben dabei unangetastet

## Datenquellen und Grenzen

- Bitcoin-Transaktionen werden über die öffentliche [Blockstream Esplora API](https://github.com/Blockstream/esplora/blob/master/API.md) abgerufen.
- Tezos-Transaktionen werden über die öffentliche [TzKT API](https://api.tzkt.io/) abgerufen. Die sichtbare Quellenangabe in der Anwendung erfüllt deren Vorgabe für die kostenfreie API.
- TRON-Transaktionen werden über die [TronGrid Account Transactions API](https://developers.tron.network/reference/get-transaction-info-by-account-address) abgerufen. Es werden nur bestätigte native TRX-Transfers berücksichtigt; TRC-10, TRC-20, interne Smart-Contract-Transfers und Staking sind bewusst nicht Teil dieses ersten TRON-Umfangs.
- Aktuelle und historische EUR-Kurse kommen von [CoinGecko](https://www.coingecko.com/en/api). Historische Kurse werden pro Kalendertag in der lokalen Datenbank zwischengespeichert. Falls der Kursdienst zeitweise nicht erreichbar ist, bleiben Transaktionen sichtbar; für den Preis steht dann `k. A.`.
- TzKT liefert zu Tezos-Operationen neben dem Blockzeitstempel auch den zum Blockzeitpunkt errechneten EUR-Kurs. Deshalb kann die Anwendung für XTZ eine präzisere historische Zuordnung verwenden als den Tageskurs.
- Die Anwendung ist eine Organisationshilfe und keine steuerliche Beratung. Für eine Steuererklärung sollten Zuordnungen und Kursdaten fachlich geprüft werden.

## Konfiguration

Alle fachlichen Einstellungen lassen sich nach der Installation unter **Einstellungen** in der Weboberfläche ändern. Dazu gehören Importlimits, Bitcoin-/Tezos-/TRON-Datenquellen, CoinGecko, die xPub-Suchgrenzen und die vertrauenswürdigen XTZ-Staking-Payout-Aliase. Änderungen werden lokal in SQLite gespeichert und gelten ab der nächsten Synchronisierung. Ein TronGrid-Key wird aus Sicherheitsgründen nur gespeichert; er wird nicht wieder an den Browser zurückgegeben.

Die Umgebungsvariablen in `.env` bzw. Portainer dienen beim allerersten Start als Startwerte oder für automatisierte Deployments. Sobald ein Wert in der Weboberfläche gespeichert wurde, hat diese lokale Einstellung Vorrang. Port, Container-Name und Docker-Volume bleiben bewusst Portainer-/Docker-Einstellungen, da ihre Änderung einen Container-Neustart erfordert.

Für eine Erstkonfiguration per `.env` kann die Anzahl importierter Transaktionen beispielsweise begrenzt werden:

```dotenv
MAX_TRANSACTIONS_PER_SYNC=1000
```

Der Standardwert `0` lädt alle vom jeweiligen Explorer verfügbaren Transaktionen.

### Bitcoin-xPub

Beim Hinzufügen einer Bitcoin-Wallet kann statt einer einzelnen Adresse ein Mainnet-`xpub`, `ypub` oder `zpub` auf Kontoebene importiert werden. Die Anwendung erkennt den eingefügten Extended Public Key automatisch und scannt daraus beide Standardzweige – Empfang (`0`) und Wechselgeld (`1`) – bis sie je Zweig 20 aufeinanderfolgende unbenutzte Adressen findet. Dieses BIP44-Gap-Limit lässt sich in der Einstellungsseite anpassen; für die erste Container-Konfiguration stehen zusätzlich diese Variablen zur Verfügung:

```dotenv
XPUB_GAP_LIMIT=20
XPUB_MAX_DERIVATIONS_PER_BRANCH=200
```

Bei `ypub` wird Nested SegWit (`3…`) und bei `zpub` Native SegWit (`bc1…`) automatisch gewählt. Bei einem klassischen `xpub` wählst du das zum Export passende Adressformat: `bc1…` (Native SegWit), `3…` (Nested SegWit) oder `1…` (Legacy). Ein Extended Public Key ist kein privater Schlüssel, kann aber die gesamte Adress- und Transaktionshistorie einer Wallet sichtbar machen. Seed-Phrases sowie `xprv`-, `yprv`- und `zprv`-Schlüssel werden bewusst abgelehnt und dürfen niemals eingegeben werden. Ein Master-xPub ist nicht ausreichend, weil aus einem xPub keine gehärteten Kontenpfade abgeleitet werden können.

Falls die öffentliche Blockstream-API Anfragen begrenzt, kann ein eigener Esplora-kompatibler Endpunkt auf der Einstellungsseite hinterlegt werden. Für eine Erstkonfiguration ist auch diese Variable möglich:

```dotenv
BITCOIN_EXPLORER_BASE_URL=https://dein-esplora.example/api
```

### TRON / TronGrid

Für wenige Abrufe kann der öffentliche TronGrid-Zugang reichen. Bei größeren Wallet-Historien oder mehreren Wallets hinterlege einen eigenen TronGrid-API-Key in Portainer bzw. in `.env`; der Key bleibt ausschließlich im Container und wird niemals an den Browser ausgeliefert:

```dotenv
TRONGRID_API_KEY=dein_trongrid_key
```

Der Adapter ruft maximal 200 Einträge pro TronGrid-Seite ab und verwendet den von TronGrid zurückgegebenen `fingerprint` für die vollständige Seitennavigation. Einen eigenen kompatiblen Endpunkt kannst du auf der Einstellungsseite wählen; `TRONGRID_BASE_URL` bleibt für die Erstkonfiguration verfügbar.

### Weitere Netzwerke ergänzen

Netzwerkspezifische Angaben liegen zentral in `lib/validation.js` (`CHAIN_CONFIG`). Die Synchronisierung ist in `server.js` als `CHAIN_ADAPTERS` organisiert. Für einen weiteren Coin werden daher gezielt drei Teile ergänzt: Chain-Metadaten (Name, Asset, Explorer, Preis-ID), ein Adapter zum Abruf/Normalisieren und – falls nötig – die Adressvalidierung. Die Oberfläche erzeugt Auswahlfelder, Übersichtskarten und Explorer-Links automatisch aus der API-Konfiguration.

Für weitere bekannte Payout-Konten kann die automatische Staking-Erkennung auf der Einstellungsseite erweitert werden. Verwende dafür die exakte Kontobezeichnung, die TzKT beim Absender zeigt. Für eine Erstkonfiguration ist auch diese Variable möglich:

```dotenv
XTZ_STAKING_PAYOUT_ALIASES=Stake.fish Payouts,Mein Baker Payouts
```

Automatisch markiert werden ausschließlich bestätigte XTZ-Eingänge von diesen vertrauenswürdigen TzKT-Aliasen. Manuell gesetzte oder entfernte Zwecke überschreibt eine spätere Synchronisierung nicht.

## Lokale Entwicklung

```bash
npm install
npm run dev
```

Für die Tests:

```bash
npm test
```
