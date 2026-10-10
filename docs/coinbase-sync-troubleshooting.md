# Coinbase-Import und Fehler in der Betriebsübersicht

Die Coinbase-Exchange-API verlangt beim Abruf von `/fills` mindestens `order_id` oder `product_id`. Der frühere Adapter rief diesen Endpunkt ohne Filter ab; beide Importwege (Synchronisierung und historische Job-Queue) waren betroffen.

Der Adapter ermittelt nun Order-IDs aus den Match-/Gebühreneinträgen des Kontojournals. IDs werden über Konten und Seiten dedupliziert. Fills werden pro Order geladen; die Historien-Queue speichert zusätzlich Order-Liste, Index und Cursor. Bestehende Version-1-Zwischenstände beginnen mit einer erneuten Konten-/Ledger-Erfassung, damit Orders von bereits gelesenen Seiten erhalten bleiben. Die Buchungs-IDs bleiben unverändert, und die bestehende Importlogik erhält manuelle Kurse und Zwecke. Es ist keine Datenbank-Schemamigration erforderlich.

Fehlen bei Trade-Journaleinträgen Order-IDs oder liefert die API keine Liste, bricht der Import mit einem konkreten Hinweis ab. Die Historie wird nicht als vollständig markiert. Der normale Sync erfasst aktuelle Konten und jüngere Journalseiten; die nachfolgende historische Queue paginiert ältere Ledger- und Fill-Seiten vollständig.

Lesende Coinbase-Anfragen haben ein Zeitlimit und laufen seriell mit Abstand. Netzwerkfehler sowie HTTP 429/500/502/503/504 werden höchstens dreimal versucht. Bei jeder Wiederholung wird die Signatur mit frischem Zeitstempel erzeugt. Zugriffsfehler 401/403 werden sofort gemeldet. Fehlertexte nennen Coinbase, den betroffenen Bereich und HTTP-/Netzwerkfehler; sie enthalten keine Rohantworten, Zugangsdaten, Signaturen oder Konto-IDs. Anfragemetadaten werden nicht protokolliert.

Die Betriebs-API `GET /api/system-status/automations` liefert bei Jobs additiv `sourceType`, `sourceId` und `sourceLabel`. Die Weboberfläche zeigt dadurch die konkrete Börse bzw. Wallet direkt beim Job an. Börsenquellen sind zur Detailseite verlinkt; Job-Payloads und Keys bleiben verborgen. Bestehende Fehlerjobs bleiben als Historie sichtbar.

## Nach Aktualisierung des Containers

Coinbase Exchange einmal erneut synchronisieren. Bei einem weiter auftretenden Fehler zeigt die neue Meldung, ob Konten, Kontojournal oder Trades betroffen sind und ob Coinbase einen HTTP-Fehler meldet oder der Container den Dienst nicht erreicht. Container-DNS, ausgehendes HTTPS und Uhrzeit müssen funktionieren. Dieser Adapter benötigt einen **Coinbase Exchange**-Key mit View-Recht, Base64-Secret und Passphrase. Coinbase Advanced Trade/CDP verwendet andere Zugangsdaten und ist nicht mit diesem Adapter kompatibel.

Das Update korrigiert den nachgewiesenen Abruffehler. Es kann einen externen Coinbase-Ausfall oder ungültige Zugangsdaten nicht beheben. Der erfolgreiche Abruf mit den produktiven Zugangsdaten muss nach dem Deployment geprüft werden.

Quellen: [Coinbase Fills](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/orders/get-all-fills), [Exchange-Authentifizierung](https://docs.cdp.coinbase.com/exchange/rest-api/authentication).
