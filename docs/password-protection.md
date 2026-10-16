# Passwortschutz und Face ID

## Einrichtung

1. Aktualisierten Container starten und im vertrauenswürdigen privaten Netz **Einstellungen → Passwortschutz** öffnen.
2. Ein eigenes Passwort mit mindestens 12 Zeichen festlegen (höchstens 1024 UTF-8-Bytes). Danach im Web neu anmelden.
3. In der aktualisierten iOS-App den Server auswählen und das gleiche Passwort eingeben. **Passwort mit Face ID / Touch ID speichern** ist freiwillig und standardmäßig ausgeschaltet.

Es gibt kein voreingestelltes Passwort. Bestehende Installationen bleiben bis zur bewussten Einrichtung unverändert erreichbar. Soll der Schutz bereits beim ersten Containerstart aktiv sein, eine Passwort-Datei als Docker-Secret/read-only-Datei einbinden und `CRYPTOBUCH_PASSWORD_FILE` auf ihren Containerpfad setzen. Sie wird nur ausgewertet, solange `/data/auth.json` noch nicht existiert. Keine Passwörter in Compose-Dateien oder Git ablegen.

## Wirkung und Speicherung

Alle Daten-APIs einschließlich Exporte, Belege, Backups und Schreibaktionen benötigen bei aktiviertem Schutz eine Sitzung. Nicht angemeldete Browser werden auf `/login.html` geführt. Öffentlich bleiben Login-Dateien/Design-Assets, `/api/auth/status`, die Anmelde-/Abmelderouten und `/healthz` (nur Status `ok`). Ersteinrichtung ist nur ohne bestehendes Passwort möglich; danach verlangen Änderungen eine gültige Sitzung und das bisherige Passwort.

Der Server speichert ausschließlich einen zufällig gesalzenen scrypt-Hash (`N=32768, r=8, p=1`) in `/data/auth.json` mit Dateirechten 0600. Die Datei liegt bewusst außerhalb der SQLite-Datenbank: Daten-Reset und Wiederherstellung einer älteren Datenbank deaktivieren den Zugangsschutz nicht. Beim Umzug das vollständige Datenvolume einschließlich dieser Datei sichern. Die fachlichen SQLite-Backups enthalten die Zugangskonfiguration nicht.

Sitzungen laufen nach 12 Stunden ab und werden nur im Serverspeicher gehalten. Browser verwenden ein HttpOnly-/SameSite-Strict-Cookie, Apps ein zufälliges Bearer-Token im Arbeitsspeicher. Passwortänderung, Deaktivierung und Serverneustart widerrufen Sitzungen. Abmelden widerruft die einzelne Sitzung. Der Server begrenzt fehlgeschlagene Passwortprüfungen und parallele Hash-Berechnungen. Fremde Browser-Origins werden bei Authentifizierung und geschützten Schreibaktionen abgewiesen.

In der App liegt ein freiwillig gespeichertes Passwort gerätegebunden im Schlüsselbund (`WhenPasscodeSetThisDeviceOnly`, `biometryCurrentSet`, keine Synchronisierung). Jede Abfrage verlangt biometrische Freigabe. Biometrische Änderungen können den Eintrag unzugänglich machen; das Server-Passwort bleibt die manuelle Alternative. Es werden keine Gesichts- oder Fingerabdruckdaten an CryptoBuch oder den Server übermittelt. Im Hintergrund wird eine passwortgeschützte App-Verbindung gesperrt. Das Schlüssel-Menü in der Serverliste entfernt gespeicherte Zugangsdaten; das Entfernen eines Servers löscht auch seinen Schlüsselbundeintrag.

## HTTPS und Betrieb

Passwortschutz verschlüsselt keine Netzwerkverbindung. Docker aktiviert zusätzlich standardmäßig lokales HTTPS auf Port 3000 (`CRYPTOBUCH_HTTPS=true`), mit einem dauerhaft im Daten-Volume gespeicherten, selbst signierten Zertifikat. LAN-IP/DNS-Namen über `CRYPTOBUCH_TLS_HOSTS` konfigurieren. Einrichtung, Zertifikatswarnung, Export und Erneuerung stehen unter [Lokales HTTPS und Portainer](../README.md#lokales-https-und-portainer). Native Clients können ein selbst signiertes Zertifikat ohne eingerichtetes Vertrauen ablehnen; deren Zertifikatsprüfung bleibt aktiv.

Die App erlaubt HTTP weiterhin nur für lokale Adressen. Bei einem bestehenden TLS-Reverse-Proxy kann `CRYPTOBUCH_HTTPS=false` den internen Listener auf HTTP belassen. Ein Reverse Proxy muss den ursprünglichen Host erhalten; keine pauschale Vertrauensfreigabe von Forwarded-Headern wird eingerichtet. Bei HTTPS wird das Cookie als Secure gesetzt. Optional kann `CRYPTOBUCH_SECURE_COOKIE=true` Secure dauerhaft erzwingen (dann ist Browser-Anmeldung über HTTP nicht möglich).

Der Docker-Healthcheck verwendet `/healthz` und benötigt keine Zugangsdaten. Er folgt der HTTPS-Einstellung und prüft bei HTTPS das lokale Zertifikat einschließlich Hostnamen. Authentifizierung führt keine Benutzerkonten oder getrennten Rollen ein: das Passwort schützt die gesamte lokale Installation. Ohne Verlust der Daten lässt sich der Schutz mit dem bisherigen Passwort ausdrücklich in den Einstellungen ausschalten.

## Passwort vergessen

Wer administrativen Zugriff auf den Container hat, kann einen neuen Hash über stdin setzen. Eine lokale Datei mit dem neuen Passwort vorbereiten und sicher behandeln; kein Passwort als Kommandozeilenargument verwenden:

```sh
docker compose exec -T cryptobuch node scripts/set-password.js < /sicherer/pfad/neues-passwort.txt
docker compose restart cryptobuch
```

Die Datei anschließend nach den eigenen Sicherheitsvorgaben entfernen. Der Neustart ist erforderlich, damit der laufende Server das neue Passwort lädt und alte Sitzungen verwirft. Die Hilfsfunktion gibt weder Passwort noch Hash aus.

## API

- `GET /api/auth/status`: `{ enabled, authenticated }`, ohne vertrauliche Daten.
- `POST /api/auth/login`: `{ password }` → `{ authenticated, token, expiresAt }`.
- `POST /api/auth/logout`: übermittelte Sitzung widerrufen.
- `PUT /api/auth/password`: `{ password, currentPassword? }` bzw. `{ disable: true, currentPassword }`; danach neu anmelden.

Native Clients senden `X-CryptoBuch-Request: 1` und bei geschützten API-Aufrufen `Authorization: Bearer <token>`. Passwörter und Token niemals protokollieren. 401 verlangt erneute Anmeldung, 403 bezeichnet eine abgelehnte Browser-Origin/fehlenden Anfrageschutz, 429 eine Begrenzung. Änderungen von Passwörtern werden nicht automatisch wiederholt.

Quellen: [Apple: Schlüsselbund-Zugriff mit Biometrie](https://developer.apple.com/documentation/localauthentication/accessing-keychain-items-with-face-id-or-touch-id), [Apple: biometryCurrentSet](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/biometrycurrentset), [Node.js: Crypto](https://nodejs.org/api/crypto.html).
