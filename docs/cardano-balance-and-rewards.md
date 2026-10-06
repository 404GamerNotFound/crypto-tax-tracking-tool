# Cardano-Bestand und Erträge

Der Stake-Import fasst die zugehörigen Zahlungsadressen zusammen. Der Journalbestand besteht aus ihren UTXO-Bewegungen plus verfügbaren Prämien minus bereits ausgezahlten Prämien. Eine Auszahlung vom Reward-Konto auf eine eigene Zahlungsadresse erzeugt somit keinen zweiten Ertrag. Referenzinputs und nicht verbrauchtes Collateral verändern den Bestand nicht; bei fehlgeschlagenen Scripts werden nur die tatsächlichen Collateral-Bewegungen berücksichtigt.

Blockfrost liefert bei `/accounts/{stake_address}/rewards` die **Verdienstepoche**. Für Member-/Leader-Prämien verwendet CryptoBuch den von `/epochs/{earned_epoch + 2}` gelieferten Beginn der verfügbaren Epoche als Buchungszeitpunkt. Das ist eine nachvollziehbare technische Zuordnung, keine verbindliche steuerliche Festlegung. Pool-Deposit-Rückzahlungen sind Transfers und werden in ihrer eigenen Epoche verfügbar. Noch nicht verfügbare Prämien werden nicht neu eingebucht. Die Prämienhistorie wird vollständig paginiert und seriell abgerufen; Abruffehler werden als Sync-Fehler sichtbar.

## Bestehende Installation aktualisieren

Nach dem Aktualisieren des Containers die **Cardano-Stake-Wallet erneut synchronisieren**. Vorhandene Prämien behalten ihre Buchungs-ID und bekommen das fehlende Datum. Bereits importierte UTXO-Bewegungen werden unter derselben ID korrigiert. Manuelle Kurse und Zwecke bleiben erhalten. Es gibt keine Schemaänderung, keine automatische Änderung produktiver Daten beim Start und keinen Datenreset.

Anschließend Binance ebenfalls synchronisieren und die einzelnen Quellen vergleichen. Rund 890 ADA in Zahlungsadressen und weitere 52 ADA noch nicht ausgezahlte Prämien ergeben rund 942 ADA, sofern die Wallet-Anzeige die Prämien nicht bereits in den 890 ADA enthält. Derselbe Bestand darf nicht zusätzlich als einzelne Zahlungsadresse und als umfassende Stake-Wallet angelegt sein. Ein eingeschränktes Transaktionslimit kann den Journalbestand unvollständig machen. Dieses Update ersetzt keine Prüfung auf überlappende Quellen, alte Börsen-Snapshots oder sonstige fehlende Buchungen.

## Steuerdashboard und API

Die Ertragstabelle enthält ausschließlich Erträge im gewählten Jahr, keine Käufe oder eigenen Transfers. Der Coin-Filter listet nun alle Assets aus dem Journal und kennzeichnet Assets ohne Erträge im Jahr. Nicht datierte Erträge erscheinen als Datenqualitätshinweis und werden keinem Jahr und keiner Jahressumme zugeschlagen.

`GET /api/tax-report?year=2026` liefert additiv:

- `availableAssets`: auswählbare Assets aus den Buchungen, unabhängig von den Erträgen des Jahres.
- `undatedIncome`: Ertragsbuchungen ohne Jahreszuordnung mit `transactionId`, `asset`, `amount`, `type`, `sourceKind`, `sourceLabel`; Datum und Wert bleiben `null`.

Die bestehende `income`-Liste bleibt auf das angefragte Jahr begrenzt. Nach dem erneuten Sync erhalten Web und iOS die datierten ADA-Prämien über dieselbe API. Vorhandene unveränderbare Jahres-Snapshots werden nicht nachträglich überschrieben; bei Bedarf einen neuen Snapshot erstellen.

## Technische Quellen

- [Blockfrost: Reward-Abfrage verwendet earned_epoch](https://github.com/blockfrost/blockfrost-backend-ryo/blob/master/src/sql/accounts/accounts_stake_address_rewards.sql)
- [Cardano db-sync: earned_epoch und spendable_epoch](https://github.com/IntersectMBO/cardano-db-sync/blob/master/doc/schema.md#reward)
- [Blockfrost OpenAPI: UTXOs, Withdrawals und Pagination](https://github.com/blockfrost/openapi/blob/master/openapi.yaml)
