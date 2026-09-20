# CryptoBuch

Ein lokal installierbares Crypto-Portfolio für öffentliche Wallet-Adressen der unterstützten Top-30-Netzwerke. Die Anwendung speichert keine Private Keys und keine Seed-Phrases.

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

- Eigenes Dashboard mit aktuellen Beständen, als Kauf zugeordneten Mengen, Gewinn gegenüber verbleibenden FIFO-Kaufkursen und aktuellem Staking-Ertrag je Coin
- Dynamischer Top-30-Marktüberblick nach Marktkapitalisierung mit EUR-Preis, 24-Stunden-Entwicklung und eindeutiger Kennzeichnung der bereits synchronisierbaren Wallet-Netze beziehungsweise ERC-20-Token
- Separate Wallet-Verwaltung sowie dynamische Coin-Detailseiten für Bitcoin, Tezos, TRON, Cardano, Ethereum und erkannte ERC-20-Token mit dem jeweiligen Buchungsjournal
- Öffentliche Wallet-Adressen für Bitcoin, Tezos, TRON, Cardano, Ethereum, BNB Chain, Solana, XRP Ledger, Dogecoin, Stellar, Bitcoin Cash, NEAR, Litecoin, Avalanche C-Chain, TON und transparente Zcash-Adressen mit frei wählbarem Namen speichern
- Bitcoin-xPubs importieren und daraus abgeleitete Empfangs- sowie Wechselgeldadressen mit BIP44-Gap-Limit erkennen
- Historien mit dedizierten Netzwerkadaptern synchronisieren: Blockstream Esplora (BTC), TzKT (XTZ), TronGrid (TRX), Blockfrost (ADA), Etherscan (ETH/ERC-20), BscScan (BNB), Solscan (SOL), XRPL JSON-RPC (XRP), Stellar Horizon (XLM), BlockCypher (DOGE/LTC), Blockchair (BCH/ZEC), NearBlocks (NEAR), Snowtrace (AVAX) und TonAPI (TON)
- Ein- und Ausgänge, eigene Transfers, Gebühren und Gegenadressen in einer Tabelle darstellen
- Aktuellen EUR-Marktpreis sowie EUR-Preis zum Transaktionsdatum anzeigen; Tezos verwendet dafür den von TzKT zum Blockzeitpunkt gelieferten EUR-Kurs, andere native Coins CoinGecko mit EUR-Tageskurs-Fallback und erkannte ERC-20-Token CoinGecko-Contract-Kurse
- Transaktionen einzeln oder gesammelt mit Zwecken wie `Kauf`, `Verkauf`, `Staking Rewards` oder `Transfer` versehen – eigene Zwecke sind ebenfalls möglich
- Bis zu 2.500 Transaktionen in einem Sammelvorgang bearbeiten
- Suchen sowie nach Blockchain und Bewegungsrichtung filtern
- Bestätigte XTZ-Eingänge von vertrauenswürdig benannten Payout-Konten automatisch als `Staking Rewards` markieren; manuelle Zwecke bleiben dabei unangetastet

## Datenquellen und Grenzen

- Bitcoin-Transaktionen werden über die öffentliche [Blockstream Esplora API](https://github.com/Blockstream/esplora/blob/master/API.md) abgerufen.
- Tezos-Transaktionen werden über die öffentliche [TzKT API](https://api.tzkt.io/) abgerufen. Die sichtbare Quellenangabe in der Anwendung erfüllt deren Vorgabe für die kostenfreie API.
- TRON-Transaktionen werden über die [TronGrid Account Transactions API](https://developers.tron.network/reference/get-transaction-info-by-account-address) abgerufen. Es werden nur bestätigte native TRX-Transfers berücksichtigt; TRC-10, TRC-20, interne Smart-Contract-Transfers und Staking sind bewusst nicht Teil dieses ersten TRON-Umfangs.
- Cardano-Transaktionen werden über die [Blockfrost Open API](https://docs.blockfrost.io/) abgerufen. Der Import benötigt eine kostenlose oder eigene Blockfrost Project-ID und berücksichtigt die ADA-Nettobewegung einer Cardano-Zahlungsadresse. Native Tokens, Stake-Adressen und Rewards sind noch nicht enthalten.
- Ethereum-Transaktionen werden über die [Etherscan API V2](https://docs.etherscan.io/) abgerufen. Der Adapter importiert bestätigte native ETH-Transfers und ERC-20-Transfer-Events einer Ethereum-Mainnet-Adresse. Interne Transaktionen sowie ERC-721/1155-NFTs sind nicht Teil dieses Umfangs.
- Weitere Top-30-Netzwerke nutzen absichtlich keinen universellen Multi-Chain-Importer. Ihre Quellen und optionalen Zugangsdaten werden getrennt unter **Einstellungen → Weitere Netzwerke** verwaltet. Die Adapter beziehen aktuell native Transfers; ERC-20-Token werden bereits beim Ethereum-Import erkannt.
- Monero kann ohne privaten View-Key nicht aus einer öffentlichen Adresse synchronisiert werden. Shielded-Zcash-Adressen, Canton und Figure HELOC haben ebenfalls keine für diesen read-only Ansatz passende, frei zugängliche Adresshistorie; sie werden deshalb nicht als voll synchronisierbare Wallet angeboten.
- Aktuelle EUR-Kurse kommen von [CoinGecko](https://www.coingecko.com/en/api). Historische Kurse werden pro Kalendertag in der lokalen Datenbank zwischengespeichert. Für native Coins ergänzt CryptoBuch fehlende CoinGecko-Historie automatisch mit EUR-Tageskerzen von Bitvavo. Die öffentliche CoinGecko-API beschränkt historische Abrufe auf die letzten 365 Tage; für nicht verfügbare Märkte oder historische ERC-20-Preise kann eine CoinGecko-Pro-Basisadresse samt Pro-Key erforderlich sein. Falls keine Quelle einen Kurs kennt, bleiben Transaktionen sichtbar und zeigen `k. A.`.
- Die Top-30-Marktansicht bezieht ebenfalls CoinGecko-Marktdaten und wird für fünf Minuten im Speicher zwischengespeichert. Die Rangfolge ist daher stets aktuell und nicht als feste Coin-Liste im Programm hinterlegt.
- TzKT liefert zu Tezos-Operationen neben dem Blockzeitstempel auch den zum Blockzeitpunkt errechneten EUR-Kurs. Deshalb kann die Anwendung für XTZ eine präzisere historische Zuordnung verwenden als den Tageskurs.
- Die Anwendung ist eine Organisationshilfe und keine steuerliche Beratung. Für eine Steuererklärung sollten Zuordnungen und Kursdaten fachlich geprüft werden.

## Konfiguration

Alle fachlichen Einstellungen lassen sich nach der Installation unter **Einstellungen** in der Weboberfläche ändern. Dazu gehören Importlimits, Bitcoin-/Tezos-/TRON-/Cardano-/Ethereum-Datenquellen, CoinGecko, die xPub-Suchgrenzen und die vertrauenswürdigen XTZ-Staking-Payout-Aliase. Änderungen werden lokal in SQLite gespeichert und gelten ab der nächsten Synchronisierung. TronGrid- und Etherscan-API-Keys sowie die Blockfrost Project-ID werden aus Sicherheitsgründen nur gespeichert; sie werden nicht wieder an den Browser zurückgegeben.

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

### Cardano / Blockfrost

Für die Cardano-Transaktionshistorie benötigst du eine Blockfrost Project-ID. Erstelle sie im Blockfrost-Dashboard für das Cardano-Mainnet und hinterlege sie danach unter **Einstellungen → Cardano**. Alternativ kann sie beim ersten Start über Portainer bzw. `.env` gesetzt werden:

```dotenv
BLOCKFROST_PROJECT_ID=deine_blockfrost_project_id
```

Beim Hinzufügen einer Cardano-Wallet kann statt einer einzelnen Zahlungsadresse (`addr1…`) eine öffentliche Stake-Adresse (`stake1…`) gewählt werden. Diese Account-Quelle ist die Cardano-Entsprechung zum Bitcoin-xPub: Die Anwendung fragt über Blockfrost alle der Stake-Adresse zugeordneten Zahlungsadressen ab und importiert ihre gemeinsame Transaktionshistorie. Einzelne `addr1…`-Adressen bleiben weiterhin möglich.

Die Anwendung fragt anschließend die paginierten Transaktions-Referenzen der Zahlungsadressen ab und lädt dann die UTXOs jeder Transaktion. Dadurch können Ein- und Ausgänge inklusive Wechselgeld als Netto-ADA-Bewegung der Wallet dargestellt werden. Das umfasst alle Zahlungsadressen, die Blockfrost der Stake-Adresse zuordnet; reine Enterprise-Adressen ohne Stake-Referenz sind technisch nicht ableitbar und müssen bei Bedarf einzeln ergänzt werden. Die Basisadresse ist bei Bedarf ebenfalls konfigurierbar (`BLOCKFROST_BASE_URL`).

### Ethereum / Etherscan und ERC-20

Für Ethereum wird ein Etherscan-API-Key benötigt. Er kann nach der Installation unter **Einstellungen → Ethereum** hinterlegt oder beim ersten Start über Portainer bzw. `.env` gesetzt werden:

```dotenv
ETHERSCAN_API_KEY=dein_etherscan_api_key
```

Der Import ruft für Chain-ID `1` sowohl die normalen ETH-Transaktionen als auch ERC-20-Transfer-Events ab. Token werden anhand ihrer Contract-Adresse getrennt geführt; dadurch bleiben beispielsweise gleich benannte Token unterscheidbar. Für ERC-20-Transfers wird die Gasgebühr als ETH ausgewiesen. Aktuelle und historische Tokenpreise werden, soweit CoinGecko den jeweiligen Ethereum-Contract kennt, über dessen Contract-Preisendpunkte ergänzt. Nicht gelistete oder Spam-Token bleiben sichtbar, zeigen beim Preis jedoch `k. A.`.

### Historische Kurse für alle Coins

Bei jedem Import nutzt CryptoBuch für alle nativen Coins den hinterlegten CoinGecko-Coin und für ERC-20-Transfers die jeweilige Contract-Adresse. Falls CoinGecko für einen nativen Coin keinen historischen EUR-Kurs liefert – insbesondere bei älteren Daten – ergänzt die Anwendung automatisch verfügbare Bitvavo-EUR-Tageskerzen. TzKT-Kurse für Tezos bleiben ein zusätzlicher, genauerer Quellenwert. Bereits importierte Transaktionen lassen sich ohne erneuten Blockchain-Import im Dashboard über **Historische Kurse ergänzen** nachziehen.

Die öffentliche CoinGecko-API liefert historische Preise nur für die letzten 365 Tage. Für native Coins mit verfügbarem Bitvavo-EUR-Markt braucht es deshalb normalerweise keine weitere Konfiguration. Für nicht verfügbare Märkte oder ältere ERC-20-Transaktionen stelle unter **Einstellungen → Preisdaten** diese Werte ein:

```dotenv
COINGECKO_API_BASE_URL=https://pro-api.coingecko.com/api/v3
COINGECKO_API_KEY=dein_coingecko_pro_key
```

Die Anwendung verwendet dann automatisch den Header `x-cg-pro-api-key`; beim öffentlichen Standard-Endpunkt wird ein optionaler Key als Demo-Key übermittelt. Der Key bleibt serverseitig gespeichert und wird nicht an den Browser zurückgegeben.

### Weitere Top-30-Netzwerke

Die Wallet-Auswahl enthält alle derzeit über öffentliche Quellen synchronisierbaren Top-30-Netzwerke. Im Marktüberblick öffnen die Badges **Wallet-Import verfügbar** direkt den passenden Wallet-Dialog. API-Keys gehören ausschließlich in die Einstellungsseite oder in die entsprechenden Portainer-Variablen; sie werden nie an den Browser ausgeliefert.

| Netzwerk | Eigener Adapter | Erforderliche Konfiguration |
| --- | --- | --- |
| BNB Chain | BscScan | API-Key |
| Solana | Solscan | API-Key |
| XRP Ledger | XRPL JSON-RPC | RPC-Adresse, standardmäßig öffentlich |
| Stellar | Horizon | Basisadresse, standardmäßig öffentlich |
| Dogecoin, Litecoin | BlockCypher | Token optional |
| Bitcoin Cash, transparente Zcash-Adressen | Blockchair | API-Key optional |
| NEAR | NearBlocks | API-Key |
| Avalanche C-Chain | Snowtrace | API-Key |
| TON | TonAPI | API-Key optional |

Beim ersten Start lassen sich die entsprechenden Variablen in Portainer setzen, zum Beispiel `SOLSCAN_API_KEY`, `BSCSCAN_API_KEY`, `SNOWTRACE_API_KEY`, `NEARBLOCKS_API_KEY` oder `TONAPI_KEY`. Bequemer ist die Konfiguration nach dem Start unter **Einstellungen**. Die öffentlichen Standardraten reichen meist für einzelne Wallets; für größere Historien sind eigene Zugangsdaten ratsam.

### Dashboard-Logik

Das Dashboard trennt Bestände nach Coin. Als gekauft zählt ein Eingang, der mit `Kauf` markiert wurde. Ausgänge mit `Verkauf` reduzieren diese Kauf-Chargen in zeitlicher Reihenfolge (FIFO). Der dargestellte Gewinn ist der aktuelle Wert der verbleibenden Kauf-Chargen abzüglich ihrer historischen Kaufwerte. Staking-Ertrag zeigt die Summe der mit `Staking Rewards` markierten Eingänge sowie deren aktuellen Wert. Für belastbare Werte müssen Käufe und Verkäufe deshalb zugeordnet sein; fehlende historische Kurse führen zu `k. A.` statt zu einer Schätzung.

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
