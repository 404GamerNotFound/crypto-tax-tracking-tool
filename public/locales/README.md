# Übersetzungen

CryptoBuch verwendet Deutsch (`de.json`), Englisch (`en.json`) und Spanisch (`es.json`). Alle drei Dateien enthalten dieselben Schlüssel. Die deutschen Ausgangstexte dienen als Nachrichten-IDs, wie bei gettext; sie sind keine gespeicherten Fachwerte. Deutsch ist Standard und Fallback. Es sind keine externen Übersetzungsdienste oder zusätzlichen Abhängigkeiten nötig.

## Neue Texte

1. Einen vollständigen Satz in allen drei JSON-Dateien ergänzen. Variablen als benannte Platzhalter einsetzen, z. B. `{count}` oder `{name}`. Vorhandene migrierte Texte verwenden auch `{p0}`, `{p1}` usw. Platzhalter dürfen umgestellt werden. Deutsche Plural-Endungen nicht in neue Übersetzungen übernehmen; `plural()` oder eine neutrale Formulierung verwenden.
2. In JavaScript `window.CryptoBuchI18n.t('Text mit {name}', { name })` verwenden. In statischem HTML Text mit `data-i18n="Nachrichten-ID"` markieren. Für Attribute stehen `data-i18n-title`, `data-i18n-aria-label`, `data-i18n-placeholder`, `data-i18n-alt`, `data-i18n-content` und `data-i18n-data-label` bereit.
3. `textContent` und normale DOM-Elemente bevorzugen. Bestehende HTML-Templates verwenden `html()`: Der Katalogtext wird automatisch HTML-escaped. Dessen Parameter müssen bereits mit der bestehenden HTML-Escape-Funktion behandelt oder bewusst erzeugte HTML-Fragmente sein. Niemals unbereinigte Nutzereingaben übergeben. Kataloge enthalten nur Text, keine auszuführenden HTML-/JS-Fragmente.
4. Zahlen und Daten mit `Intl` und `window.CryptoBuchI18n.locale` darstellen. Die Sprache ändert weder EUR als Bewertungswährung noch das Steuerprofil.
5. `npm test` und `git diff --check` ausführen. `test/i18n.test.js` prüft Katalogparität, Platzhalter, referenzierte Texte, Fallback, Escape-Verhalten, Sprachwahl und unveränderte Fachwerte.

`public/i18n-core.js` wird im Browser und serverseitig verwendet. `public/i18n.js` übersetzt nur ausdrücklich markierte Elemente und stellt den Sprachumschalter bereit. Die Auswahl wird pro Browser im Cookie `cryptobuch_language` gespeichert; ein Seitenwechsel behält sie bei. Ein Wechsel mit bearbeitetem Formular erfordert die Bestätigung, ungespeicherte Eingaben zu verlassen.

`lib/i18n.js` liefert den gewählten Katalog vor der Anmeldung und lokalisiert API-Fehlermeldungen anhand des Sprach-Cookies bzw. `Accept-Language`. Bekannte serverseitige Systemmeldungen können am Anzeigeort über `message()` übersetzt werden. Dabei werden eingefügte Werte nicht rekursiv übersetzt. Unbekannte externe Meldungen bleiben im Original sichtbar.

## Unveränderte Daten

API-Feldnamen, Zwecke wie `Kauf`/`Verkauf`, DOM-IDs, CSS-Klassen, CSV-Importspalten, Sicherheitsbestätigungen, Hashes, Adressen, eigene Bezeichnungen und archivierte Reports werden nicht übersetzt. Bei Auswahlfeldern nur das Label übersetzen, niemals `option.value`. Originale BSDEX-Geräteerklärungen bleiben unverändert, damit angezeigter Text und bestätigter Digest übereinstimmen.

Der CSV-Steuerexport kann seine Beschriftungen mit `language=de|en|es` übersetzen; die Oberfläche setzt diesen Parameter. Ohne Parameter bleibt das bisherige deutsche Exportformat erhalten. ISO-Zeitstempel und maschinenlesbare Zahlen bleiben sprachunabhängig. JSON-Exporte und Snapshots behalten ihre gespeicherten Originaldaten.
