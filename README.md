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

- App-API unter `/api/v1` mit paginierten Datenressourcen, Einzelabrufen, Referenzdaten und navigierbaren Beziehungen; vollständige API-Referenz unter `/api-docs.html` und OpenAPI-Vertrag unter `/api/openapi.json`

- Eigenes Dashboard mit aktuellen Beständen, als Kauf zugeordneten Mengen, Gewinn gegenüber verbleibenden FIFO-Kaufkursen und aktuellem Staking-Ertrag je Coin
- Dynamischer Top-30-Marktüberblick nach Marktkapitalisierung mit EUR-Preis, 24-Stunden-Entwicklung und eindeutiger Kennzeichnung der bereits synchronisierbaren Wallet-Netze beziehungsweise ERC-20-Token
- Separate Wallet-Verwaltung sowie dynamische Coin-Detailseiten für Bitcoin, Tezos, TRON, Cardano, Ethereum und erkannte ERC-20-Token mit dem jeweiligen Buchungsjournal
- Öffentliche Wallet-Adressen für Bitcoin, Tezos, TRON, Cardano, Ethereum, BNB Chain, Solana, XRP Ledger, Dogecoin, Stellar, Bitcoin Cash, NEAR, Litecoin, Avalanche C-Chain, TON und transparente Zcash-Adressen mit frei wählbarem Namen speichern
- Bitcoin-xPubs importieren und daraus abgeleitete Empfangs- sowie Wechselgeldadressen mit BIP44-Gap-Limit erkennen
- Historien mit dedizierten Netzwerkadaptern synchronisieren: Blockstream Esplora (BTC), TzKT (XTZ), TronGrid (TRX), Blockfrost (ADA), Etherscan (ETH/ERC-20), BscScan (BNB), Solscan (SOL), XRPL JSON-RPC (XRP), Stellar Horizon (XLM), BlockCypher (DOGE/LTC), Fulcrum (BCH), Blockchair (ZEC), NearBlocks (NEAR), Snowtrace (AVAX) und TonAPI (TON)
- Ein- und Ausgänge, eigene Transfers, Gebühren und Gegenadressen in einer Tabelle darstellen
- Datenqualität getrennt prüfen: fehlende historische Kurse, Transaktionen ohne Zweck und manuell fixierte Kurse
- Historische EUR-Kurse je Transaktion mit Kursquelle, Kursdatum, Abruf-/Erfassungszeitpunkt und Datenqualitätsstatus ausweisen; manuelle Werte sind begründet, vollständig historisiert und werden bei späteren Synchronisierungen nicht überschrieben
- Jahresreport mit FIFO-Verkaufssegmenten, historischen Erlösen/Kosten, Haltedauer, bewertbaren Gebühren sowie Staking-, Mining-, Airdrop-, Lending- und DeFi-Erträgen erstellen; CSV- und druckoptimierter PDF-Export inklusive
- Lokale Datenbank-Backups im Docker-Volume erstellen, herunterladen und nach ausdrücklicher Bestätigung wiederherstellen
- Betriebsseite mit dem letzten Import je Wallet, Fehlermeldungen, Importanzahl und Preis-Retry-Status
- Aktuellen EUR-Marktpreis sowie EUR-Preis zum Transaktionsdatum anzeigen; Tezos verwendet dafür den von TzKT zum Blockzeitpunkt gelieferten EUR-Kurs, andere native Coins CoinGecko mit EUR-Tageskurs-Fallback und erkannte ERC-20-Token CoinGecko-Contract-Kurse
- Transaktionen einzeln oder gesammelt mit Zwecken wie `Kauf`, `Verkauf`, `Staking Rewards` oder `Transfer` versehen – eigene Zwecke sind ebenfalls möglich
- Bis zu 2.500 Transaktionen in einem Sammelvorgang bearbeiten
- Suchen sowie nach Blockchain und Bewegungsrichtung filtern
- Bestätigte XTZ-Eingänge von vertrauenswürdig benannten Payout-Konten automatisch als `Staking Rewards` markieren; manuelle Zwecke bleiben dabei unangetastet
- Interaktive Coin-Charts mit Zoom und Cursor, QR-Codes für gespeicherte öffentliche Wallet-Adressen
- Direkter, read-only Ledger-Import für Bitcoin und Ethereum: Die öffentliche Empfangsadresse wird im Browser vom Gerät gelesen und auf dem Ledger bestätigt; Private Keys, Seed-Phrases und Signaturfunktionen bleiben ausgeschlossen
- Cardano-Stake-Wallets zusätzlich um die von Blockfrost gelieferte Reward-Historie erweitern und ERC-20-Metadaten mit read-only Ethereum-RPC-Multicalls prüfen
- Read-only-Börsenanbindung für Bitvavo, Binance Spot, Coinbase Exchange, eToro und BSDEX: Coinbase Exchange importiert Salden, Fills, Ledgerbewegungen, Gebühren sowie Krypto-Ein- und Auszahlungen; Binance importiert Spot-Trades, Ein- und Auszahlungen, Earn-/Dividendenausschüttungen und Gebühren mit nachvollziehbarem Zweck-Mapping; BSDEX importiert Salden, eigene Trades sowie abgeschlossene Krypto-Ein- und Auszahlungen und ergänzt einen optionalen privaten Live-Abgleich für Salden und Trades mit periodischem REST-Fallback

## Datenquellen und Grenzen

- Bitcoin-Transaktionen werden über die öffentliche [Blockstream Esplora API](https://github.com/Blockstream/esplora/blob/master/API.md) abgerufen.
- Tezos-Transaktionen werden über die öffentliche [TzKT API](https://api.tzkt.io/) abgerufen. Die sichtbare Quellenangabe in der Anwendung erfüllt deren Vorgabe für die kostenfreie API.
- TRON-Transaktionen werden über die [TronGrid Account Transactions API](https://developers.tron.network/reference/get-transaction-info-by-account-address) abgerufen. Es werden nur bestätigte native TRX-Transfers berücksichtigt; TRC-10, TRC-20, interne Smart-Contract-Transfers und Staking sind bewusst nicht Teil dieses ersten TRON-Umfangs.
- Cardano-Transaktionen werden über die [Blockfrost Open API](https://docs.blockfrost.io/) abgerufen. Der Import benötigt eine kostenlose oder eigene Blockfrost Project-ID und berücksichtigt die ADA-Nettobewegung einer Cardano-Zahlungsadresse. Native Tokens, Stake-Adressen und Rewards sind noch nicht enthalten.
- Ethereum-Transaktionen werden über die [Etherscan API V2](https://docs.etherscan.io/) abgerufen. Der Adapter importiert bestätigte native ETH-Transfers und ERC-20-Transfer-Events einer Ethereum-Mainnet-Adresse. Interne Transaktionen sowie ERC-721/1155-NFTs sind nicht Teil dieses Umfangs.
- Weitere Top-30-Netzwerke nutzen absichtlich keinen universellen Multi-Chain-Importer. Ihre Quellen und optionalen Zugangsdaten werden getrennt unter **Einstellungen → Netzwerke** verwaltet. Die Adapter beziehen aktuell native Transfers; ERC-20-Token werden bereits beim Ethereum-Import erkannt.
- Monero kann ohne privaten View-Key nicht aus einer öffentlichen Adresse synchronisiert werden. Shielded-Zcash-Adressen, Canton und Figure HELOC haben ebenfalls keine für diesen read-only Ansatz passende, frei zugängliche Adresshistorie; sie werden deshalb nicht als voll synchronisierbare Wallet angeboten.
- Aktuelle EUR-Kurse kommen von [CoinGecko](https://www.coingecko.com/en/api). Historische Kurse werden pro Kalendertag samt Herkunft in der lokalen Datenbank zwischengespeichert und die verwendete Quelle samt Abrufzeitpunkt direkt an der jeweiligen Buchung festgehalten. Für native Coins und Börsenassets ergänzt CryptoBuch fehlende CoinGecko-Historie seriell mit EUR-Tageskerzen von Bitvavo, [Coinbase Exchange](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles) und [Kraken](https://docs.kraken.com/api-reference/market-data/get-ohlc-data); mit einem eigenen CryptoCompare-Key kommt eine fünfte Quelle hinzu. Fehlende Werte werden auch ohne geöffnete Browserseite in kleinen, seriellen Batches wiederholt; fehlgeschlagene Werte erhalten ein exponentiell wachsendes Retry-Intervall. Die öffentliche CoinGecko-API beschränkt historische Abrufe auf die letzten 365 Tage; Kraken liefert nur die jüngsten etwa 720 Tageskerzen, und ERC-20-Preise bleiben contract-spezifisch auf CoinGecko beschränkt. Falls keine Quelle einen Kurs kennt, bleiben Transaktionen sichtbar und zeigen `k. A.`.
- Die Top-30-Marktansicht bezieht ebenfalls CoinGecko-Marktdaten und wird für fünf Minuten im Speicher zwischengespeichert. Die Rangfolge ist daher stets aktuell und nicht als feste Coin-Liste im Programm hinterlegt.
- TzKT liefert zu Tezos-Operationen neben dem Blockzeitstempel auch den zum Blockzeitpunkt errechneten EUR-Kurs. Deshalb kann die Anwendung für XTZ eine präzisere historische Zuordnung verwenden als den Tageskurs.
- Die Anwendung ist eine Organisationshilfe und keine steuerliche Beratung. Für eine Steuererklärung sollten Zuordnungen und Kursdaten fachlich geprüft werden.

## Datenqualität und Steuerreport

Unter **Datenqualität** werden fehlende historische Kurse sowie Transaktionen ohne Zweck als Arbeitsliste angezeigt. Ein manueller historischer Kurs lässt sich dort oder direkt in der Coin-Detailansicht hinterlegen. Diese Werte tragen die Quelle `manual` und sind damit gegen künftige automatische Preisimporte geschützt; „Automatik verwenden“ hebt den Schutz wieder auf.

In der Coin-Detailansicht **Transaktion öffnen → Jetzt Kursdaten abrufen** wählen, um den historischen EUR-Kurs genau dieser Buchung erneut zu prüfen. Die native iOS-App bietet dieselbe Aktion in den Buchungsdetails. Der Auftrag läuft seriell auf dem Server, überspringt für diese Buchung den Kurscache und die Retry-Wartezeit und zeigt Status sowie Ergebnis an. Ein bereits aktiver Auftrag wird wiederverwendet. Fehlende Kurse bleiben sichtbar, vorhandene Werte werden bei erfolglosem Abruf erhalten und manuelle/importierte Kurse nicht überschrieben. Erfolgreiche Änderungen erscheinen mit Herkunft im Kurs-Audit. Tageskurse bleiben unverbindliche Schätzungen.

Das **Steuerzentrum** ist eine lokale Buchungsübersicht, keine steuerliche Beratung. Es verwendet die als `Kauf` und `Verkauf` markierten Transaktionen in zeitlicher FIFO-Reihenfolge, weist Haltedauer und bewertbare Gebühren aus und zeigt nur vollständig bewertete Verkaufssegmente in den EUR-Summen. Fehlende Kauf-, Verkaufs- oder Gebührenkurse werden ausdrücklich als unvollständig gekennzeichnet. Staking-, Mining-, Airdrop-, Lending- und DeFi-Erträge werden zum historischen Empfangswert separat aufgelistet. Der CSV-Export enthält auch die lokalen Transaktions- und Anschaffungs-IDs; die Druckansicht lässt sich im Browser als PDF speichern.

Unter **Einstellungen → Steuerprofil** ist eine Deutschland-Startvorlage hinterlegt. Haltefrist, Freigrenze, Verlustverrechnung, einbezogene Ertragsarten sowie getrennte Schätzsätze für Veräußerungen und Erträge sind vollständig anpassbar und lassen sich damit als Organisationsprofil für andere Länder konfigurieren. Der Jahresreport berücksichtigt nur bekannte, vollständig bewertete Werte und zeigt die Steuerreserve ausdrücklich als unverbindliche Schätzung. Er ersetzt keine individuelle rechtliche oder steuerliche Prüfung.

Ein **Jahres-Snapshot** speichert den aktuellen Report inklusive Regelwerk lokal unveränderbar mit SHA-256-Prüfsumme. Er ist ein Nachweisstand für die Zusammenarbeit mit Steuerberatung oder zur eigenen Dokumentation, aber keine Steuererklärung und keine rechtsverbindliche Feststellung.

Unter **Betrieb & Backups** lassen sich Datenbank-Snapshots erstellen und herunterladen. Die Wiederherstellung ersetzt bewusst die aktuelle SQLite-Datenbank und startet den Container neu; sie verlangt deshalb eine separate Bestätigung. Dieselbe Seite zeigt außerdem den letzten Erfolg oder Fehler jeder Wallet-Synchronisierung sowie ausstehende, gedrosselte Preis-Retries.

## Konfiguration

Alle fachlichen Einstellungen lassen sich nach der Installation unter **Einstellungen** in der Weboberfläche ändern. Die Bereiche Passwortschutz (`/settings.html`), Synchronisierung (`/settings-sync.html`), Steuerprofil (`/settings-tax.html`), Preis- & API-Daten (`/settings-prices.html`) und Netzwerke (`/settings-networks.html`) sind eigenständige Unterseiten. Jede Seite speichert ausschließlich ihre eigenen Felder; `PUT /api/settings` unterstützt dafür Teiländerungen ohne Zurücksetzen anderer Einstellungen. Dazu gehören Importlimits, Bitcoin-/Tezos-/TRON-/Cardano-/Ethereum-Datenquellen, die Preisquellen CoinGecko, Bitvavo, Coinbase Exchange, Kraken und optional CryptoCompare, die xPub-Suchgrenzen und die vertrauenswürdigen XTZ-Staking-Payout-Aliase. Änderungen werden lokal in SQLite gespeichert und gelten ab der nächsten Synchronisierung. Zugangsdaten werden aus Sicherheitsgründen nur gespeichert; sie werden nicht wieder an den Browser zurückgegeben.

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

### Direkte Ledger-Verbindung

Auf der Seite **Wallets** öffnet **Ledger verbinden** einen rein lokalen Geräte-Dialog. Er unterstützt zunächst die Ledger-Apps **Bitcoin** und **Ethereum** und liest nach Bestätigung auf dem Hardware-Wallet die erste Empfangsadresse des gewählten Kontos. Die BIP32-Pfade sind für Bitcoin je nach Format `m/84'/0'/Konto'/0/0` (Native SegWit), `m/49'/0'/Konto'/0/0` (Nested SegWit) oder `m/44'/0'/Konto'/0/0` (Legacy); Ethereum verwendet `m/44'/60'/Konto'/0/0`.

Die Gerätekommunikation geschieht ausschließlich zwischen Browser und Ledger über WebHID mit WebUSB-Fallback. Docker, der CryptoBuch-Server und die SQLite-Datenbank erhalten nur die danach bestätigte öffentliche Adresse. Es werden keine Signaturen ausgelöst und weder Private Keys noch Seed-Phrases oder xPrvs verarbeitet. Voraussetzung ist eine aktuelle Chrome-/Chromium-Version, die geöffnete passende Ledger-App und bei Portainer eine HTTPS-URL (für lokale Zugriffe gilt auch `localhost`).

Der Bitcoin-Import per Ledger fügt bewusst eine einzelne Empfangsadresse hinzu. Für die vollständige Historie eines Bitcoin-Kontos inklusive Wechselgeldadressen verwende weiterhin den vorhandenen xPub-/yPub-/zPub-Import.

Der Ledger-Dialog kann nun auch das komplette Bitcoin-Konto als xPub übernehmen. Dabei wird der öffentliche Konto-Schlüssel nach BIP44/49/84 aus der Bitcoin-App gelesen und anschließend mit dem bestehenden Gap-Limit synchronisiert. Für EVM-Netze kann dieselbe öffentliche Adresse über die Ethereum-App getrennt als Ethereum-, BNB-Smart-Chain- oder Avalanche-C-Chain-Wallet angelegt werden.

### Jobs, Datenqualität und CSV-Nachträge

Wallet-Synchronisierungen und die Nachbearbeitung historischer Kurse laufen als lokale Hintergrundjobs. Die Oberfläche wartet mit Statusmeldung auf den Abschluss, während der Server die Jobs seriell verarbeitet – Explorer und Preis-APIs werden so nicht parallel überlastet.

Unter **Datenqualität** schlägt CryptoBuch gegenläufige, zeitlich und mengenmäßig ähnliche Bewegungen zwischen eigenen Wallets als mögliche Transfers vor. Nach jeder erfolgreichen Börsen-Synchronisierung werden zudem Börsen-Ein- und Auszahlungen gegen alle lokalen Wallets geprüft; bei Auszahlungen berücksichtigt der Abgleich auch eine mögliche Netzgebühr. Das Ergebnis bleibt immer ein manueller Vorschlag – erst „Transfer verknüpfen“ setzt beide Zwecke und beeinflusst damit die Auswertung. CSV-Nachträge können dort einer bestehenden Wallet zugeordnet werden. Das CSV-Format benötigt die Spalten `timestamp`, `direction`, `asset` und `amount`; optional sind `fee`, `purpose`, `price_eur`, `hash` und `counterparty`. Manuell importierte Preise und Zwecke werden nicht von einer Blockchain-Synchronisierung überschrieben. Eine CSV-Übernahme ist auf 2.500 Zeilen begrenzt.

Wallets lassen sich beim Anlegen mit einer Gruppe und bis zu zwölf Tags strukturieren. Das Dashboard ergänzt die Bestandskarten um eine Allokationsansicht und eine filterbare historische Buchwertentwicklung auf Basis bewerteter Käufe, Verkäufe und Erträge. Interne Transfers bleiben darin neutral; die Darstellung ist keine rückwirkende Marktwertkurve.

### API für eigene Apps

Die Seite **API** erklärt alle Lese-, Schreib-, Import- und Verwaltungsendpunkte mit Parametern, Eingabeformaten, Antworten und Abhängigkeiten. Der maschinenlesbare Vertrag unter `GET /api/openapi.json` verwendet OpenAPI 3.1. Die Dokumentation wird aus demselben Katalog erzeugt; ein Test gleicht ihn mit den tatsächlich registrierten Express-Routen ab.

Mit `GET /api/v1` erhält eine App den Einstieg einschließlich Ressourcen und Datenbeziehungen. `GET /api/v1/metadata` liefert Chains, öffentliche Adressarten, Explorer-Vorlagen, Zwecke, Börsenanbieter, CSV-Profile und Limits. `GET /api/v1/settings` liefert die öffentliche Konfiguration inklusive Steuerprofil; Provider-Schlüssel erscheinen ausschließlich als Konfigurationsstatus.

Die v1-Ressourcen umfassen `wallets` (auch interne Börsenkonten), `transactions`, `wallet-addresses`, `exchange-connections`, `exchange-balances`, `transfers`, `documents`, `price-history`, `price-audit`, `price-retries`, `price-runs`, `price-fetch-events`, `sync-events`, `jobs`, `notifications` und `tax-snapshots`. Diese Lesezugriffe verwenden ausschließlich lokale Daten. Bestehende Auswertungen wie `/api/portfolio`, Steuerberichte, Marktübersicht und Datenqualitätsvorschläge sind im Einstieg verlinkt; Portfolio und Marktübersicht können externe Preisabfragen benötigen.

```bash
curl http://localhost:3000/api/v1
curl 'http://localhost:3000/api/v1/transactions?wallet_id=1&limit=100&offset=0'
curl http://localhost:3000/api/v1/transactions/1
```

Listen liefern `{ data: [...], pagination: { limit, offset, total, hasMore }, links: { self, next } }`, Einzelabrufe `{ data: {...} }`. `links.next` bis `null` verfolgen. Standard sind 100, maximal 500 Datensätze je Seite, aufsteigend nach Primärschlüssel. Unbekannte oder mehrfach angegebene Filter werden mit HTTP 400 abgelehnt. Während paralleler Änderungen sind mehrere Seiten kein unveränderlicher Snapshot. Ressourcenfelder verwenden `snake_case`; bestehende Aktionen teilweise `camelCase`. Zeitstempel ohne explizite Zeitzone sind UTC. Fehlende Kurse bleiben `null`, manuelle Kurse und Zwecke unverändert.

Jedes Objekt enthält `links` zu seiner Einzelansicht und abhängigen Daten: z. B. Buchung → Wallet, Belege, Kurs-Audit und bestätigte Transfers. Belegdateien und archivierte Reports werden über separate Links abgerufen. Für zusammengesetzte Schlüssel gelten `/api/v1/price-history/{coin_id}/{price_date}` und `/api/v1/exchange-balances/{connection_id}/{asset}`. Segmente URL-kodieren. Private Provider-Rohdaten, Job-Payloads, Sitzungen und Zugangsschlüssel gehören nicht zum v1-Datenvertrag. Synchronisierung und Preisnachbearbeitung über `/api/jobs/sync` bzw. `/api/jobs/price-backfill` einreihen; HTTP 202 bedeutet angenommen, der Abschluss wird am Jobstatus geprüft.

Die lokale Anwendung besitzt keine eingebaute API-Authentifizierung und keine CORS-Freigabe. Browser-Apps benötigen dieselbe Origin oder einen Reverse Proxy; für Zugriff außerhalb des vertrauenswürdigen Netzes ist ein authentifizierter HTTPS-Zugang erforderlich. Native Apps verwenden die Adresse der CryptoBuch-Installation. Öffentliche Wallet-Adressen und xPubs sind datenschutzsensibel. Backup-Downloads können lokale Provider-Zugangsdaten enthalten und sind kein normaler App-Datenexport. Die API öffnet keine Geräteverbindung und bietet keine neuen Signier- oder Sendefunktionen. Historische Werte und Steuerwerte bleiben unverbindliche Schätzungen.

Einzelabruf eines historischen Kurses: **`POST /api/transactions/{id}/historical-price/fetch`** (kein Body erforderlich). Die Antwort `202` enthält `transactionId`, `job`, `reused` und Links für Status, Buchung und Audit. `GET /api/jobs/{job.id}` liefert nach Abschluss `result.outcome` (`updated`, `unavailable` oder `skipped`) und einen verständlichen `result.hint`. Anschließend die Buchung und ihren Kurs-Audit erneut laden. Geschützte Kurse ergeben `409`, ein fehlendes/ungültiges Datum oder nicht unterstütztes Asset `422`, eine unbekannte Buchung `404`. Es wird ausschließlich die gewählte Buchung aktualisiert; Serverdaten und Schema müssen nicht migriert werden.

### Binance Spot · Read-only

Unter **Datenqualität → Börse verbinden** kann eine Binance-Spot-Verbindung angelegt werden. Für jede Verbindung legt CryptoBuch automatisch ein eigenes, internes **Börsenkonto** als Buchungsquelle an – eine Börse wird niemals einer Blockchain-Wallet wie BTC oder BCH zugeordnet. Der anschließende Transfer-Abgleich prüft dennoch alle lokalen Wallets. Erstelle hierfür bei Binance einen **separaten API-Key mit ausschließlich Leserecht**. Trading, Auszahlungen und Transfers müssen deaktiviert bleiben. Nach dem Speichern importiert CryptoBuch zunächst die jüngsten Daten und lädt danach die abrufbare Spot-Historie automatisch in kleinen, seriellen Schritten nach. Der Fortschritt bleibt in SQLite erhalten und wird nach einem Container-Neustart fortgesetzt. CryptoBuch sendet nur signierte `GET`-Abfragen; API-Key und Secret bleiben im lokalen Datenverzeichnis und werden nach dem Speichern nicht mehr an den Browser ausgegeben.

Unter **Crypto-Bestände** stehen On-Chain-Wallets oben und verbundene Börsen darunter. Die Detailansicht einer Börse zeigt ausschließlich deren aktuelle Salden sowie jede lokal gespeicherte Börsenbuchung; sie fasst keine Wallet-Transaktionen der gleichen Assets hinzu.

Der Adapter liest Kontobestände, Spot-Trades, Einzahlungen, Auszahlungen sowie Asset-Dividenden. Das Mapping ist transparent: Spot-Kauf/-Verkauf wird als `Kauf`/`Verkauf` importiert; nicht-fiat Gegenbuchungen bleiben als eigene Asset-Bewegung sichtbar, Ein-/Auszahlungen als `Transfer`, eindeutig erkennbare Earn-/Staking-Ausschüttungen als `Staking Rewards` und Gebühren als `Gebühr`. USDT, USDC, DAI, FDUSD und BUSD werden als Börsenassets mit eigener Kursquelle geführt – nie mit dem Kurs der zufällig gewählten Ziel-Wallet. Einzahlungen, Auszahlungen und Erträge werden vom Binance-Start an in 90-Tage-Fenstern abgeholt; Spot-Trades werden pro Markt über die Trade-ID fortgesetzt. Bestände und bereits gefundene Assets erweitern die Marktmenge automatisch. Für einen Markt, dessen Coin schon vollständig gegen Fiat verkauft wurde und daher nirgends mehr erscheint, können im Dialog optional Paare wie `BTCEUR`, `BTCUSDT` oder `ETHEUR` ergänzt werden.

Die direkte API deckt bewusst die Spot-Wallet ab; Futures, Margin, Kredit, NFT und sonstige Binance-Produkte besitzen getrennte APIs und werden nicht stillschweigend als Spot-Bewegung interpretiert. Für diese oder für sehr alte, umfangreiche Historien exportiere die Binance-Transaktionshistorie und importiere sie über das Profil **Binance Transaktionshistorie**. Ein Durchlauf importiert höchstens 2.500 Buchungszeilen; fehlende historische Kurse werden anschließend über den vorhandenen seriellen, gedrosselten Kurs-Job nachbearbeitet.

### Coinbase Exchange · Read-only

Unter **Datenqualität → Börse verbinden** kann eine **Coinbase Exchange**-Verbindung eingerichtet werden. Erstelle den Schlüssel direkt bei Coinbase Exchange mit **ausschließlich der Berechtigung „View“**: Handels-, Transfer- und Verwaltungsrechte dürfen nicht aktiviert werden. Coinbase Exchange stellt dabei drei Werte bereit bzw. verlangt sie beim Erstellen: API-Key, base64-kodiertes API-Secret und die selbst gewählte Passphrase. Alle drei verbleiben lokal und werden nach dem Speichern nicht erneut an den Browser ausgegeben.

CryptoBuch signiert ausschließlich `GET`-Anfragen nach der [offiziellen Coinbase-Exchange-Authentifizierung](https://docs.cdp.coinbase.com/exchange/rest-api/authentication) und liest Konten, deren Ledger und eigene Fills. Die aktuelle Abfrage importiert einen aktuellen Ausschnitt; die vollständige abrufbare Historie läuft anschließend seriell und fortsetzbar über Konten, Ledger-Seiten und Fills. Fills werden als Kauf/Verkauf einschließlich Gegenbuchung und Gebühr abgebildet. Ledger-Ein- und Auszahlungen erhalten den Zweck `Transfer` und werden nach Abschluss als manuelle Transfer-Vorschläge gegen alle lokalen Wallets geprüft. Interne Bewegungen oder Konvertierungen werden nie als erfundener Kauf bzw. Verkauf klassifiziert.

Die Anbindung gilt für **Coinbase Exchange**, nicht für die separate Coinbase-App-/Advanced-Trade-API. Produkte, für die Coinbase Exchange keine Ledger- oder Fill-Historie bereitstellt, etwa Derivate oder andere getrennte Kontobereiche, werden nicht als Spot-Coin-Bestand geschätzt; hierfür bleibt ein CSV-Import der belegte Weg.

### Coinbase / Advanced Trade · Read-only

Für das normale Coinbase-/Advanced-Trade-Konto unter **Datenqualität → Börse verbinden** den separaten Anbieter **Coinbase / Advanced Trade** auswählen. Nur **View** aktivieren, keine Handels- oder Transferrechte. Als API-Key den vollständigen **Name des API-Schlüssels** (`organizations/…/apiKeys/…`) und als API-Secret den Wert **Privater Schlüssel** eingeben. Keine Passphrase nötig. Unterstützt werden Ed25519 (Base64 oder PEM) und ECDSA P-256 (PEM), entsprechend dem [offiziellen Coinbase-SDK](https://github.com/coinbase/coinbase-advanced-py/blob/master/coinbase/jwt_generator.py).

Die API-Signaturschlüssel authentifizieren ausschließlich kurze, an lesende Konten-, Transaktions- und Fill-Endpunkte gebundene JWTs; sie dienen niemals zur Signierung von Blockchain-Transaktionen. Sie werden lokal mit AES-256-GCM verschlüsselt gespeichert, mit dem vorhandenen lokalen Sitzungsschlüssel im Datenverzeichnis. Schlüsseldatei und Datenbank müssen gemeinsam gesichert werden. Zugangsdaten und JWTs werden nicht über die API zurückgegeben oder protokolliert. Wallet-Private-Keys, xPrvs und Seed-Phrases bleiben verboten. Keine neue Abhängigkeit erforderlich.

Der API-Aufruf `POST /api/exchange-connections` verwendet `provider: "coinbase_advanced"`, `apiKey`, `apiSecret` und optional `label`. Anschließende Abrufe und Syncs nutzen dieselben Portfolio-, v1- und Job-Routen wie andere Börsen; iOS kann die Verbindung und importierte Buchungen über die vorhandene API lesen und synchronisieren. Konten werden paginiert, freie und gebundene Guthaben als Salden-Snapshot übernommen und Spot-Ausführungen seriell mit stabiler Entry-ID importiert. Quote-Mengen werden in Basis-Mengen umgerechnet; EUR-Preise, Krypto-Gegenbuchungen und Gebühren bleiben erhalten. Manuelle Kurse und Zwecke werden nicht überschrieben.

Zusätzlich zu Advanced-Trade-Fills lädt die Job-Warteschlange die [Coinbase-Kontohistorie](https://docs.cdp.coinbase.com/coinbase-app/track-apis/transactions) über `GET /v2/accounts` und `GET /v2/accounts/{account_id}/transactions`, einschließlich Konten ohne aktuellen Saldo. Abgeschlossene Käufe, Verkäufe, Krypto-Konvertierungen, Transfers, Staking und Rewards werden importiert. Advanced-Orders aus dem Fill-Endpunkt haben Vorrang; fehlende ältere Orders kommen aus dem Kontojournal. Bereits aus dem Kontojournal übernommene Orders bleiben auch dann eindeutig, wenn spätere Syncs ihre Fills liefern. EUR-Subtotal beziehungsweise native EUR-Belegwerte liefern historische Einheitswerte, Gebühren werden nicht doppelt vom Kontostand abgezogen. Unbekannte Buchungsarten bleiben als **Sonstiges** mit Status **attention** zur Prüfung sichtbar. Ein vollständig verarbeiteter API-Verlauf erhält **complete**, ohne eine steuerliche oder API-übergreifende Vollständigkeit zu garantieren. Der Historienstand hat Version 2; frühere abgeschlossene Fill-only-Imports werden beim nächsten Serverstart automatisch nachgeladen, ohne Buchungen zu löschen. Es ist keine neue Tabellenmigration nötig. Derivate und unvollständige Ausführungen werden nicht als Coin-Bestand geschätzt. Die Schema-Migration erweitert den Provider-Constraint und erhält vorhandene Verbindungen sowie abhängige Salden; Fremdschlüssel werden vor dem Commit geprüft.

### eToro · Read-only

Unter **Datenqualität → Börse verbinden** steht zusätzlich **eToro · Read-only API** zur Verfügung. eToro verwendet dafür zwei getrennte Integrations-Zugangsdaten: den **Public API-Key** (`x-api-key`) und den **User-Key** (`x-user-key`). Beim Anlegen wird explizit **Realkonto** oder **Demokonto** gewählt, weil ein eToro User-Key nur für eine dieser Kontoarten gilt. CryptoBuch legt daraus ein eigenes Börsenkonto an und fragt ausschließlich die Trade-Historie, Instrumentdaten und offene Positionen per `GET` ab – ohne Handels-, Auszahlungs- oder Transferrechte. Jede Anfrage erhält eine neue Request-ID; die Seiten werden seriell und gedrosselt abgefragt und auf 2.500 historische Buchungszeilen/Positionsnachweise sowie 2.500 offene Positionsnachweise pro Lauf begrenzt.

Die Börsenansicht zeigt unter **CFDs & weitere Positionen** auch offene und geschlossene CFD-Longs/Shorts, einschließlich nicht-kryptobasierter Instrumente. Angezeigt werden Instrument, Produktart, Richtung, Hebel, Einheiten, Zeitpunkte, Einsatz, Gebühren und das von eToro gemeldete realisierte bzw. unrealisierte Ergebnis. Teilschließungen bleiben eigenständige Nachweise; erneute Imports aktualisieren dieselben Datensätze. Offene Copy-Positionen werden ebenfalls eingelesen. Fehlt eine Position später im vollständigen Snapshot, bleibt ihr letzter Stand als **Status prüfen** erhalten; ein Schließungskurs oder Ergebnis wird nicht erfunden.

`settlementTypeID=0` kennzeichnet CFDs, `1` echte Assets; weitere Derivate bleiben getrennt. Die historische API liefert die Produktart nicht in jeder Antwort: Hebel 1 allein belegt keinen echten Coin-Kauf. Solche Fälle erscheinen als **Produktart prüfen**. Nur ausdrücklich bestätigte, ungehebelte Krypto-Longs mit Einheiten werden als Kauf und Verkauf ins Coin-Journal aufgenommen. Die additive Tabelle `exchange_derivative_positions` speichert Positionsnachweise pro Börsenverbindung; sie wird beim Start automatisch angelegt und zusammen mit der Verbindung entfernt. Bestehende manuelle Kurse/Zwecke bleiben erhalten. Frühere Coin-Imports werden nicht automatisch umklassifiziert.

CFDs und ungeklärte Positionen erhöhen weder das Coin-Guthaben noch die bisherigen Coin-FIFO-/Steuer-Schätzungen. Ergebnisse und Gebühren behalten ihre Quellwährung; unbekannte Währungen oder fehlende Zahlen bleiben sichtbar. Der Import schätzt keinen EUR-Kurs und zieht Gebühren nicht erneut vom gemeldeten Netto-Ergebnis ab. Die offenen PnL-Werte sind Abrufstände, kein Live-Kurs. Die Read-only-API wird über die bestehende serielle Job-Queue abgefragt, mit gemeinsamem Mindestabstand für Historie, Instrumente und Portfolio. Bei fehlerhaftem Snapshot bleiben vorhandene Positionsdaten erhalten. Siehe [eToro Authentication](https://api-portal.etoro.com/core/getting-started/authentication.md), [Trading History](https://api-portal.etoro.com/api-reference/trading--real/list-trading-history.md) und [Portfolio/PnL](https://api-portal.etoro.com/api-reference/trading--real/get-account-pnl-and-portfolio-details.md).

Die Basisadresse ist unter **Einstellungen → Preisdaten** konfigurierbar oder kann beim ersten Start gesetzt werden:

```dotenv
ETORO_API_BASE_URL=https://public-api.etoro.com/api/v1
```

### BSDEX · Web-Import für Privatkonten (experimentell)

BSDEX bietet laut [offizieller Hilfe zur Verbindung mit Portfolio-Trackern](https://support.bsdex.de/hc/de/articles/31375909190941-Verbindung-mit-Portfolio-Trackern) keine direkte Tracker-Anbindung für Privatkonten an. CryptoBuch ergänzt deshalb einen lokalen Browser-Import der offiziellen Jahres-CSV unter **Datenqualität → Börse verbinden → BSDEX · Web-Import (experimentell)**. Die separate API-Option ist weiterhin für bereits vorhandene institutionelle API-Zugänge bestimmt.

Die Web-Quelle benötigt keine API-Schlüssel. Nach dem Anlegen startet eine ausdrückliche Anmeldung mit E-Mail und Passwort, gegebenenfalls SMS-TAN, E-Mail-Gerätebestätigung und einer zusätzlichen BSDEX-Geräteerklärung. Zugangsdaten werden nur über **HTTPS oder localhost** angenommen; eine unverschlüsselte LAN-URL reicht dafür nicht. Passwort, TAN und Bestätigungslink werden nicht gespeichert. Eine zusätzliche BSDEX-Erklärung wird vollständig angezeigt und erst nach separater Zustimmung bestätigt. Falls neue Sicherheitsabfragen oder blockierte Anfragen auftreten, bricht der Adapter ab; er umgeht sie nicht.

Der Server verwendet einen eigenen kurzlebigen Chromium-Kontext, ohne auf das persönliche Browserprofil zuzugreifen. Ausgehende Anfragen sind auf HTTPS bei BSDEX, lesende Methoden und die beobachteten Login-POST-Pfade beschränkt; WebSockets und übrige Schreibzugriffe bleiben gesperrt. Eine BSDEX-Websitzung besitzt trotzdem die Kontorechte der normalen Webanmeldung und ist kein eingeschränkter API-Schlüssel. Die neue additive Tabelle `bsdex_web_sessions` speichert die Sitzung mit AES-256-GCM verschlüsselt, Anmeldestatus und einen HMAC der Konto-E-Mail zur Vermeidung versehentlicher Kontowechsel. Verwendet wird der bestehende lokale Sitzungsschlüssel `data/trade-republic-session.key`; Datenverzeichnis und Schlüssel sind gemeinsam zu schützen. Öffentliche API-Antworten und Job-Payloads enthalten keine Sitzung oder Anmeldegeheimnisse. **Web-Sitzung löschen** entfernt die lokale Sitzung, vorhandene Buchungen bleiben erhalten; das ist keine Abmeldung aller Geräte bei BSDEX.

Nach der Anmeldung lädt ein serieller `exchange_sync`-Job die Jahresdateien aus der Transaktionshistorie. Er validiert alle Dateien vor dem Buchen. Das deutsche Originalformat mit Komma als Trennzeichen, Dezimalpunkt, expliziter Zeitzone und elf Spalten wird verarbeitet. `buy`/`sell` liefern EUR-Belegkurse und getrennte Gebühren; Krypto-`deposit`/`withdrawal` bleiben Transfers. EUR-Kontobewegungen werden nicht als Coin-Bestand importiert. Unbekannte Typen, widersprüchliche IDs oder ungültige Beträge brechen den Import sichtbar ab. Grenzen: 5 MiB pro Datei und insgesamt 2.500 Exportzeilen pro Import einschließlich EUR-Zeilen. Größere Historien können jahrweise über **BSDEX-CSV importieren** eingelesen werden. Sender-/Empfängerfelder mit möglichen Bankdaten werden nicht gespeichert.

Web- und CSV-Import verwenden dieselben stabilen Buchungs-IDs innerhalb derselben Quelle. Wiederholungen erzeugen keine zusätzlichen Buchungen; manuelle Preise und Zwecke bleiben geschützt. Fehlende Transferkurse folgen dem bestehenden gedrosselten Preis-Backfill. Es gibt keinen aktuellen Saldenabruf oder Live-Modus für die Web-Quelle: Bestände werden ausdrücklich aus den importierten Buchungen berechnet und können bei fehlender Historie unvollständig sein. CSV-Dateien müssen zum gewählten BSDEX-Konto gehören. Institutionelle API- und Web-/CSV-Quellen werden wegen unterschiedlicher IDs getrennt gehalten und dürfen für dasselbe Konto nicht parallel zur Summenbildung verwendet werden.

Das Format wurde gegen einen echten Jahresexport geprüft; Parser, Sitzungsablauf, Job-Queue und Dublettenschutz sind automatisiert getestet. Der vollständige automatische Login und Download im serverseitigen Chromium ist noch nicht live bestätigt. Insbesondere zusätzliche Gerätefreigaben und Änderungen der BSDEX-Seite können eine Anpassung erfordern. Die manuelle CSV-Funktion bleibt unabhängig von einer erfolgreichen Web-Anmeldung nutzbar. Docker enthält Chromium bereits; ohne Docker ist einmalig `npx playwright install chromium` erforderlich.

### BSDEX · institutioneller API-Zugang mit optionalen Live-Updates

Für diese separate Option ist ein vorhandener API-Zugang mit ausschließlichem Leserecht erforderlich; siehe das [BSDEX-Angebot für institutionelle Kunden](https://www.bsdex.de/en/institutions/). CryptoBuch verwendet nur `GET /api/v1/balance`, die eigenen Trades je EUR-Markt, die dokumentierten reinen Lese-Endpunkte `GET /api/v2/crypto/deposits` und `GET /api/v2/crypto/withdrawals` sowie – nach ausdrücklichem Opt-in im Verbindungsdialog – die privaten WebSocket-Kanäle `trade` und `balance`. Es werden niemals Order-, Storno- oder schreibende Auszahlungs-Endpunkte aufgerufen.

Der erste und jeder manuelle Abgleich liest Salden, verfügbare Trade-Historie und abgeschlossene Krypto-Ein- bzw. Auszahlungen seriell ein. Letztere erhalten immer den Zweck `Transfer` und werden nur als nachvollziehbarer Vorschlag mit einer passenden lokalen Wallet verknüpft – nie als Kauf oder Verkauf. Ein bestätigter BSDEX-Saldo ist für die Bestandsanzeige maßgeblich; Abweichungen zum Journal bleiben sichtbar und erzeugen weder Käufe/Verkäufe noch FIFO-Lose. Ist der Live-Modus aktiv, verarbeitet die lokale Instanz neue eigene Trades und Salden direkt. Alle 15 Minuten (konfigurierbar über `BSDEX_RECONCILE_INTERVAL_MINUTES`, mindestens 5 Minuten) erfolgt zusätzlich ein serieller REST-Abgleich; dieser holt auch die Transfer-Historie nach einer Unterbrechung nach.

Die API-Dokumentation weist historische Trades marktweise und Krypto-Transfer-Historien für die dort verfügbaren Assets aus. Ein nicht mehr abrufbarer alter oder delisteter Markt beziehungsweise eine von BSDEX nicht bereitgestellte Transferhistorie kann deshalb weiterhin einen BSDEX-Export erfordern; fehlende Buchungen werden nicht geraten. Siehe [offizielle BSDEX API-Dokumentation](https://docs.bsdex.de/).

### Trade Republic · expliziter inoffizieller Read-only-Import

**Trade Republic** kann als separates Börsenkonto mit einem ausdrücklich opt-in-basierten, **inoffiziellen** Timeline-Import verbunden werden. Die Integration ist eigenständig in CryptoBuch implementiert und verwendet ausschließlich die lesenden Vorgänge `timeline` und `timelineDetail`. Sie enthält keinerlei Order-, Auszahlungs-, Transfer- oder Portfolio-Schreiboperationen.

Vor der Verbindung zeigt CryptoBuch die Folgen klar an und verlangt eine Checkbox: Die inoffizielle Anmeldung folgt dem Trade-Republic-Web-Login und wird in der bereits angemeldeten App bestätigt. Es findet keine Geräteaktivierung statt. Mobilnummer und die PIN dienen nur zum Start dieser Anmeldung; die PIN wird nicht in SQLite gespeichert. Nach der Bestätigung speichert CryptoBuch ausschließlich die notwendige Web-Sitzung verschlüsselt mit einem lokalen, separaten Schlüssel im Datenverzeichnis. Schütze Datenordner und Schlüsseldatei deshalb durch Betriebssystemrechte und Festplattenverschlüsselung.

Nach der Bestätigung in der App importiert die serielle Job-Queue nur Timeline-Buchungen mit einer **expliziten Krypto-Einheitenmenge**. Aktien, ETF, Cash-Bewegungen und Einträge ohne klar ausgewiesene Coin-Menge werden übersprungen. Preise werden bei fehlenden Ausführungskursen über den normalen, gedrosselten historischen Preis-Job ergänzt; sie bleiben Schätzwerte. Web-Sitzungen können ablaufen oder durch Trade Republic ungültig werden; dann ist eine erneute explizite Anmeldung nötig. Der Adapter ist nicht von Trade Republic unterstützt und kann durch Änderungen an der nicht dokumentierten Schnittstelle jederzeit ausfallen. Die vorhandene **Trade Republic Crypto-Beleg (CSV)**-Option bleibt als sichere Rückfallmethode verfügbar.

Der Docker-Build installiert den dafür nötigen lokalen Chromium automatisch. Wer CryptoBuch ohne Docker startet, installiert ihn einmalig im Projektordner:

```bash
npx playwright install chromium
```

### TRON / TronGrid

Für wenige Abrufe kann der öffentliche TronGrid-Zugang reichen. Bei größeren Wallet-Historien oder mehreren Wallets hinterlege einen eigenen TronGrid-API-Key in Portainer bzw. in `.env`; der Key bleibt ausschließlich im Container und wird niemals an den Browser ausgeliefert:

```dotenv
TRONGRID_API_KEY=dein_trongrid_key
```

Der Adapter ruft maximal 200 Einträge pro TronGrid-Seite ab und verwendet den von TronGrid zurückgegebenen `fingerprint` für die vollständige Seitennavigation. Einen eigenen kompatiblen Endpunkt kannst du auf der Einstellungsseite wählen; `TRONGRID_BASE_URL` bleibt für die Erstkonfiguration verfügbar.

### Cardano / Blockfrost

Für die Cardano-Transaktionshistorie benötigst du eine Blockfrost Project-ID. Erstelle sie im Blockfrost-Dashboard für das Cardano-Mainnet und hinterlege sie danach unter **Einstellungen → Netzwerke → Cardano**. Alternativ kann sie beim ersten Start über Portainer bzw. `.env` gesetzt werden:

```dotenv
BLOCKFROST_PROJECT_ID=deine_blockfrost_project_id
```

Beim Hinzufügen einer Cardano-Wallet kann statt einer einzelnen Zahlungsadresse (`addr1…`) eine öffentliche Stake-Adresse (`stake1…`) gewählt werden. Diese Account-Quelle ist die Cardano-Entsprechung zum Bitcoin-xPub: Die Anwendung fragt über Blockfrost alle der Stake-Adresse zugeordneten Zahlungsadressen ab und importiert ihre gemeinsame Transaktionshistorie. Einzelne `addr1…`-Adressen bleiben weiterhin möglich.

Die Anwendung fragt anschließend die paginierten Transaktions-Referenzen der Zahlungsadressen ab und lädt dann die UTXOs jeder Transaktion. Dadurch können Ein- und Ausgänge inklusive Wechselgeld als Netto-ADA-Bewegung der Wallet dargestellt werden. Das umfasst alle Zahlungsadressen, die Blockfrost der Stake-Adresse zuordnet; reine Enterprise-Adressen ohne Stake-Referenz sind technisch nicht ableitbar und müssen bei Bedarf einzeln ergänzt werden. Die Basisadresse ist bei Bedarf ebenfalls konfigurierbar (`BLOCKFROST_BASE_URL`).

### Ethereum / Etherscan und ERC-20

Für Ethereum wird ein Etherscan-API-Key benötigt. Er kann nach der Installation unter **Einstellungen → Netzwerke → Ethereum** hinterlegt oder beim ersten Start über Portainer bzw. `.env` gesetzt werden:

```dotenv
ETHERSCAN_API_KEY=dein_etherscan_api_key
```

Der Import ruft für Chain-ID `1` sowohl die normalen ETH-Transaktionen als auch ERC-20-Transfer-Events ab. Token werden anhand ihrer Contract-Adresse getrennt geführt; dadurch bleiben beispielsweise gleich benannte Token unterscheidbar. Für ERC-20-Transfers wird die Gasgebühr als ETH ausgewiesen. Aktuelle und historische Tokenpreise werden, soweit CoinGecko den jeweiligen Ethereum-Contract kennt, über dessen Contract-Preisendpunkte ergänzt. Nicht gelistete oder Spam-Token bleiben sichtbar, zeigen beim Preis jedoch `k. A.`.

### Historische Kurse für alle Coins

Bei jedem Import nutzt CryptoBuch für alle nativen Coins und Börsenassets den hinterlegten CoinGecko-Coin bzw. das Asset-Symbol und für ERC-20-Transfers die jeweilige Contract-Adresse. Falls CoinGecko für einen nativen Coin oder ein Börsenasset keinen historischen EUR-Kurs liefert – insbesondere bei älteren Daten – versucht die Anwendung nacheinander Bitvavo, Coinbase Exchange und Kraken. Mit einem hinterlegten CryptoCompare-Key folgt CryptoCompare als fünfte Quelle. Sobald ein Tageswert vorliegt, endet die Suche für dieses Datum; die Quelle wird lokal gespeichert. TzKT-Kurse für Tezos bleiben ein zusätzlicher, genauerer Quellenwert. Bereits importierte Transaktionen lassen sich ohne erneuten Blockchain-Import im Dashboard über **Historische Kurse ergänzen** nachziehen.

Die öffentliche CoinGecko-API liefert historische Preise nur für die letzten 365 Tage. Die vier öffentlichen Quellen benötigen keinen Zugangscode; jede Anfrage läuft durch dieselbe globale Warteschlange mit mindestens 1,75 Sekunden Abstand. Coinbase-Anfragen umfassen höchstens 300 Tage, Kraken kann nur die letzten etwa 720 Tage liefern. Für eine zusätzliche, weiter zurückreichende Quelle oder für nicht verfügbare Märkte hinterlege unter **Einstellungen → Preisdaten** einen CryptoCompare-Key. Für contract-spezifische ERC-20-Preise bleibt eine CoinGecko-Pro-Konfiguration die mögliche Erweiterung:

```dotenv
COINGECKO_API_BASE_URL=https://pro-api.coingecko.com/api/v3
COINGECKO_API_KEY=dein_coingecko_pro_key
CRYPTOCOMPARE_API_KEY=dein_cryptocompare_api_key
```

Die Anwendung verwendet für CoinGecko automatisch den Header `x-cg-pro-api-key`; beim öffentlichen Standard-Endpunkt wird ein optionaler Key als Demo-Key übermittelt. Beide API-Keys bleiben serverseitig gespeichert und werden nicht an den Browser zurückgegeben.

Die automatische Nachbearbeitung läuft standardmäßig alle 15 Minuten, verarbeitet höchstens 60 fehlende Transaktionen je Durchlauf und startet historische HTTP-Anfragen mindestens 1,75 Sekunden versetzt. Beide Werte können unter **Einstellungen → Synchronisierung** oder beim ersten Start über `HISTORICAL_PRICE_RETRY_INTERVAL_MINUTES` und `HISTORICAL_PRICE_BACKFILL_BATCH_SIZE` angepasst werden. Der Button **Historische Kurse ergänzen** stößt denselben gedrosselten Durchlauf sofort an. Unter **Datenqualität → Datenabrufe** zeigt eine lokale Pipeline die nächsten Kandidaten, die aktive Quellenreihenfolge sowie ein paginiertes Abrufprotokoll mit Zeitpunkt, Quelle, Ergebnis und sicherer Fehlerklasse. API-Keys und vollständige Anfrage-URLs werden dort nicht protokolliert.

### Weitere Top-30-Netzwerke

Die Wallet-Auswahl enthält alle derzeit über öffentliche Quellen synchronisierbaren Top-30-Netzwerke. Im Marktüberblick öffnen die Badges **Wallet-Import verfügbar** direkt den passenden Wallet-Dialog. API-Keys gehören ausschließlich in die Einstellungsseite oder in die entsprechenden Portainer-Variablen; sie werden nie an den Browser ausgeliefert.

| Netzwerk | Eigener Adapter | Erforderliche Konfiguration |
| --- | --- | --- |
| BNB Chain | BscScan | API-Key |
| Solana | Solscan | API-Key |
| XRP Ledger | XRPL JSON-RPC | RPC-Adresse, standardmäßig öffentlich |
| Stellar | Horizon | Basisadresse, standardmäßig öffentlich |
| Dogecoin, Litecoin | BlockCypher | Token optional |
| Bitcoin Cash | Fulcrum-Indexer | kein Key; nur Historie und Transaktionsdetails |
| Transparente Zcash-Adressen | Blockchair | API-Key optional |
| NEAR | NearBlocks | API-Key |
| Avalanche C-Chain | Snowtrace | API-Key |
| TON | TonAPI | API-Key optional |

Beim ersten Start lassen sich die entsprechenden Variablen in Portainer setzen, zum Beispiel `SOLSCAN_API_KEY`, `BSCSCAN_API_KEY`, `SNOWTRACE_API_KEY`, `NEARBLOCKS_API_KEY` oder `TONAPI_KEY`. Bequemer ist die Konfiguration nach dem Start unter **Einstellungen**. Die öffentlichen Standardraten reichen meist für einzelne Wallets; für größere Historien sind eigene Zugangsdaten ratsam.

### Dashboard-Logik

Das Dashboard trennt Bestände nach Coin. Als gekauft zählt ein Eingang, der mit `Kauf` markiert wurde. Ausgänge mit `Verkauf` reduzieren diese Kauf-Chargen in zeitlicher Reihenfolge (FIFO). Der dargestellte Gewinn ist der aktuelle Wert der verbleibenden Kauf-Chargen abzüglich ihrer historischen Kaufwerte. Fehlen nur einzelne noch gehaltene Kaufchargen, zeigt CryptoBuch den Gewinn der bepreisten Chargen mit dem Hinweis **teilweise**; fehlen alle Kaufkurse, bleibt der Wert `k. A.`. Staking-Ertrag zeigt die Summe der mit `Staking Rewards` markierten Eingänge sowie deren aktuellen Wert.

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

### Wallet-Verwaltung über App und API

Die native iOS-App kann unter **Quellen** öffentliche Wallets anlegen, Name/Gruppe/Tags bearbeiten und eine Wallet nach ausdrücklicher Bestätigung löschen. Die vorhandenen Endpunkte sind `POST /api/wallets` (201), `PATCH /api/wallets/{id}` (200) und `DELETE /api/wallets/{id}` (204 ohne Body). Netzwerk- und Quellentyp-Auswahl kommen aus `GET /api/v1/metadata`; normalisierte Wallet-Daten aus `GET /api/v1/wallets`.

PATCH erhält nicht übermittelte Metadaten. Leere Strings beziehungsweise `tags: []` löschen die jeweilige Zuordnung. Netzwerk, Adresse, Quellentyp und xPub-Adressformat werden nicht verändert; dafür eine neue Wallet anlegen. DELETE entfernt dauerhaft auch abhängige Buchungen, Verknüpfungen und lokale Belege, aber keine Coins auf der Blockchain und keine separat gespeicherten Backups. Das Anlegen startet keinen Import; dafür anschließend `POST /api/jobs/sync` verwenden.

### Gemeinsames Logo für Web und App

Die Weboberfläche verwendet das neue CryptoBuch-Logo auf allen Seiten, als Favicon und als Apple-Touch-Icon. Dashboard und leere Wallet-Ansicht nutzen die passende Journal-Illustration. Alle Bilddateien werden lokal ausgeliefert und vom vorhandenen Docker-Build übernommen. Details und Dateizuordnung: [docs/branding.md](docs/branding.md).

### Coins aus dem Portfolio ausblenden

Im Dashboard unter **Coins ein- / ausblenden** oder in einer Coin-Detailansicht können einzelne Assets ausgeblendet und wieder eingeblendet werden. In der iOS-App stehen die Aktionen unter **Überblick → Deine Bestände** und **Ausgeblendete Coins** bereit. Die Auswahl wird serverweit in der additiven Tabelle `hidden_assets` gespeichert und bleibt über Neustarts und Synchronisierungen erhalten. Sie wird mit der SQLite-Datenbank gesichert und beim ausdrücklichen Zurücksetzen der lokalen Daten mit entfernt.

Die exakte Asset-ID (bei Token einschließlich Contract) verhindert, dass gleichnamige Assets gemeinsam ausgeblendet werden. Ausgeblendete Coins zählen nicht zum Portfolio-/Börsenwert, zur Allokation, zum Buchwertverlauf und zu den Portfolio-Performancekennzahlen. **Buchungen, gespeicherte Kurse, Zwecke, Datenqualität und Steuerberichte bleiben vollständig und unverändert.** Ausblenden korrigiert keine falschen Kursdaten und ist keine steuerliche Klassifizierung. Wiederherstellen ist jederzeit möglich.

API: `GET /api/asset-visibility` liefert `hiddenAssets` und `scope: "portfolio"`. `PATCH /api/asset-visibility` akzeptiert `{ "asset": "BTC", "hidden": true }` (bzw. `false`). `/api/portfolio` enthält die Liste ebenfalls; seine Rohbestände und Buchungen bleiben vollständig, während Gesamtwerte und `insights` die Auswahl berücksichtigen. Aktuelle Einzelkurse ausgeblendeter Assets sind `null`. Details und Abhängigkeiten stehen auf der API-Dokumentationsseite.

### Passwortschutz und Face ID

Unter **Einstellungen → Passwortschutz** kann die gesamte Installation einschließlich Daten-APIs geschützt werden. Die iOS-App unterstützt die Anmeldung mit demselben Passwort und optional dessen biometrisch geschützte Ablage im Schlüsselbund. Einrichtung, Docker-Secrets, HTTPS, Sitzungen und administrative Passwort-Wiederherstellung: [Passwortschutz-Dokumentation](docs/password-protection.md).

### Cardano-Bestand und fehlende ADA-Erträge

Nach einem Update die Stake-Wallet erneut synchronisieren: Prämien erhalten den Beginn ihrer verfügbaren Epoche als Datum; ihre spätere Auszahlung wird nicht nochmals zum Bestand addiert. Der Steuerbericht weist nicht datierte Erträge gesondert aus. Details, API-Erweiterungen und Grenzen beim Bestandsabgleich: [Cardano-Bestand und Erträge](docs/cardano-balance-and-rewards.md).

### Coinbase-Importfehler

Trades werden nach Order-IDs aus dem Kontojournal abgefragt und historische Seiten seriell nachgeladen. Netzwerk-/HTTP-Fehler werden konkret angezeigt; Jobs nennen ihre Börsenquelle. Hinweise zum Update und zur Diagnose: [Coinbase-Synchronisierung](docs/coinbase-sync-troubleshooting.md).


### Historische Kurse nach Importen

CSV- und Börsenimporte sowie die Rückkehr zur Preisautomatik planen sofort einen lokalen Preisjob ein. Wallet-Synchronisierungen übernehmen vorhandene Cache-/Adapterkurse und reihen fehlende Preise anschließend ein. Alle automatischen Preisjobs laufen über `background_jobs`; fällige Folge-Batches werden seriell weiterverarbeitet. Die Batchgröße begrenzt eindeutige Asset-/UTC-Tag-Kombinationen, nicht einzelne Buchungen. Ein Treffer ergänzt alle passenden offenen Buchungen, auch bei vorhandenem Retry. Einzelabrufe aktualisieren weiterhin ausschließlich die ausgewählte Buchung. Manuelle Preise und Zwecke bleiben geschützt.

Unter **Datenqualität → Datenabrufe → Preiszuordnung bestätigen** können importierte Coins einer geprüften CoinGecko-API-ID zugeordnet werden. Die Zuordnung gilt je Wallet/Börsenkonto; Kürzel werden nicht automatisch geraten. Unbekannte Assets bleiben sichtbar, belegen aber keinen Abrufplatz. Für eigene Zuordnungen werden keine gleichnamigen Börsenmärkte unterstellt. Die Zuordnung allein erweitert daher nicht die verfügbare Historie des CoinGecko-Tarifs.

ERC-20-Preise verwenden den Contract-Chart-Endpunkt. Neue Tagesreferenzen stammen ausschließlich vom angefragten UTC-Tag. Tageskurse sind Schätzungen, keine Ausführungspreise. Noch offene Tage werden frühestens am Folgetag um 00:40 UTC ergänzt. `price_observed_at` und `price_method` dokumentieren den Messzeitpunkt und die Bewertungsmethode; Altdaten behalten unbekannte Metadaten (`legacy`) und werden nicht stillschweigend umbewertet.

Die Demo-API von CoinGecko wird nur innerhalb ihrer 365-Tage-Historie angefragt. Native Assets behalten ihre EUR-Fallbacks. Provider-Pausen bei Rate-Limits (einschließlich `Retry-After`), Zugangsstörungen und Ausfällen werden lokal gespeichert. Die Anzeige unterscheidet fehlende Zuordnung, Tarifgrenzen, offene Tage und fehlende Tagesdaten. Änderungen der Preisquellen-Einstellungen geben betroffene Retries erneut frei.

Die Migration ergänzt `price_asset_mappings`, `price_provider_cooldowns`, Beobachtungsfelder in `transactions`/`price_history` und einen Retry-Grund. Bestehende Buchungen und Audit-Einträge bleiben erhalten. Die PSBT-Vorschau wurde entfernt; der alte Endpunkt antwortet vor dem Parsen eines Request-Bodys mit HTTP 410. CryptoBuch verarbeitet keine Transaktionsentwürfe.

### Transfers zwischen eigenen Börsenkonten

Unter **Datenqualität → Eigene Transfers prüfen** werden auch Börse-zu-Börse-Paare vorgeschlagen, selbst wenn beide Buchungen bereits den Zweck „Transfer“ tragen. Der Abgleich prüft verschiedene Konten, dasselbe Asset, entgegengesetzte Richtungen, Beträge einschließlich möglichem Gebührenabzug und maximal 72 Stunden Abstand. Vollständige unterstützte Blockchain-Hashes werden verglichen; widersprüchliche Hashes verhindern einen Vorschlag. Interne Anbieter-IDs und gekürzte Hashes gelten nicht als Hash-Nachweis. Ohne vergleichbare Hashes bleibt der Treffer ein Vorschlag anhand von Betrag und Zeit.

Erst die ausdrückliche Bestätigung verknüpft die Buchungen. Bestehende Kurse, Mengen und Gebühren bleiben erhalten; die beiden Zwecke werden auf „Transfer“ gesetzt. Bereits verknüpfte Buchungen werden nicht erneut vorgeschlagen. Die Coin-Ansicht zeigt die Gegenbuchung mit einem Sprung zur passenden Zeile. Die Verknüpfung verwendet die vorhandene Tabelle `transfer_links`; eine neue Datenmigration ist nicht nötig.

### Guthaben je Quelle auf der Coin-Seite

Die Kachel „Aktueller Bestand“ zeigt zusätzlich das Guthaben je Börsenkonto und Wallet. Konten bleiben anhand ihrer Wallet-ID getrennt, auch bei gleichen Namen. Die Aufteilung verwendet dieselben Positionen wie die Portfolio-Summe: verfügbare Börsen-Snapshots inklusive gesperrter Beträge haben Vorrang vor dem Buchungsjournal. Ohne Snapshot sowie bei On-Chain-Wallets wird der Bestand aus importierten Bewegungen berechnet; unvollständige Importe können diese Werte verfälschen. Herkunft und vorhandener Datenstand stehen direkt an der Quelle. Negative Wallet-Journalsalden erscheinen ausdrücklich als Journaldefizit. Ausgeblendete Coins behalten die Mengenanzeige. Es werden keine zusätzlichen Provider-Anfragen oder Datenmigrationen benötigt.

### Cardano-Import und unvollständige Coin-Auswertungen

Cardano verwendet `/addresses/{address}/transactions` mit strukturierten Transaktionsreferenzen. Der frühere `/txs`-Listenendpunkt liefert ausschließlich Hash-Zeichenketten und konnte dadurch dazu führen, dass nur Staking-Rewards gespeichert wurden. Nach dem Update eine betroffene ADA-Wallet erneut synchronisieren: fehlende UTXO-Bewegungen werden anhand ihrer Hashes ergänzt, bestehende manuelle Kurse/Zwecke bleiben geschützt. Unerwartete Referenzformate brechen den Import vor Datenänderungen ab.

Stake-Wallets mit ausschließlich Reward-Buchungen werden bis zur Reparatur als Teilbestand gekennzeichnet. Übersteigen rechnerisch offene Kaufchargen den aktuellen Bestand oder ist dieser als unvollständig erkannt, bleiben die ursprünglichen Kaufdaten erhalten, aber Restbestand und Kaufgewinn werden nicht als verlässlich ausgewiesen. Staking-Gutschriften sind kumulierte Erträge, kein heutiger Bestand. Der historische Wertverlauf zeigt negative Journalsalden und fehlende Kurse als Lücken; abweichende aktuelle Bestände werden nicht mit einer erfundenen Historie verbunden. Historische Werte bleiben Schätzungen. Kleine positive Restbestände werden nicht mehr zu „0“ gerundet. Keine Datenmigration und keine Änderung der Steuerberechnung.

Bei abweichenden Börsenjournalen bleiben Quellen auch dann in der Coin-Detailansicht sichtbar, wenn ihr negativer Journalbetrag bisher auf null begrenzt wurde. Ohne bestätigten API-Saldo lautet die Anzeige **Unbekannt**, inklusive Journaldefizit. Ein bestätigter Saldo mit abweichender Historie bleibt als Bestand nutzbar, bestätigt jedoch keine Kaufchargen: Kauf-Restbestand und Kaufgewinn werden bis zur Klärung nicht als zuverlässig ausgewiesen. Es werden keine Ausgleichsbuchungen erfunden.
