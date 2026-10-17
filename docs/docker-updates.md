# Docker-Updates aus CryptoBuch

Unter **Betrieb → Docker-Updates** zeigt die Anwendung die installierte Version aus `package.json`, das neueste stabile öffentliche GitHub-Release und den letzten Update-Auftrag. Beim Öffnen wird geprüft, sofern der letzte Abruf länger als eine Stunde zurückliegt. Manuelle Abrufe sind serverseitig auf einmal pro Minute begrenzt und werden zusammengefasst. Fehler/fehlende Releases werden ausdrücklich angezeigt.

## Einmalige Portainer-Einrichtung

Die bebilderungsfreie Schrittfolge ist auch lokal unter `/update-setup.html` verfügbar. Unterstützt: Docker Standalone, dateibasierter Compose-Stack in Portainer CE/BE. Die Integration nutzt die API, keine Business-Webhooks und keinen Docker-Socket. Getesteter API-Vertrag: Stack lesen, `/api/stacks/{id}/file`, `PUT /api/stacks/{id}?endpointId=…`.

1. Zuerst ein vollständiges Backup des bisherigen Daten-Volumes vorhalten. `compose.portainer.yaml` ist eine Vorlage, kein automatisch auszuführender Migrationsschritt. Bestehenden Stack bearbeiten und dessen Ports, Mounts und Umgebungsvariablen übernehmen. `DATA_VOLUME` muss auf das tatsächlich bisher verwendete Volume zeigen, z. B. `mein-stack_cryptobuch_data`. Keine neuen leeren Volumes anlegen. Bind-Mounts gegebenenfalls unverändert weiterverwenden.
2. Vorher ein veröffentlichtes Image bereitstellen (siehe unten). `build: .` durch die exakt in der Vorlage enthaltene `image:`-Zeile ersetzen. Stack-Variable `CRYPTOBUCH_IMAGE_TAG` auf eine existierende Version ohne `v` setzen. Der Updater verändert ausschließlich diese Variable und sendet die vorhandene Compose-Datei unverändert zurück. Git-/AutoUpdate-Stacks werden abgelehnt, damit ihre Verwaltung nicht unbeabsichtigt entfernt wird. Für diese zunächst in Portainer die Git-Verbindung lösen und auf einen dateibasierten Stack umstellen. Einzelcontainer benötigen einmalig eine Migration zum Stack; Swarm/Kubernetes sind ausgeschlossen.
3. API-Token eines Portainer-Benutzers mit den nötigen Stack-/Environment-Rechten auf dem Docker-Host als Datei ablegen. UID 1000 im Container muss sie lesen können. Über einen Read-only-Mount `/run/secrets/portainer-token` verfügbar machen. Die Host-Datei und zusätzliche CA sind außerhalb des Daten-Volumes separat zu sichern. Token nicht ins Repository, Browser-Formular oder in die Compose-Datei schreiben.
4. Container-Variablen `CRYPTOBUCH_PORTAINER_URL` (HTTPS, ggf. Proxy-Basispfad), `CRYPTOBUCH_PORTAINER_STACK_ID`, `CRYPTOBUCH_PORTAINER_ENDPOINT_ID`, `CRYPTOBUCH_PORTAINER_TOKEN_FILE` setzen. Kein `/api` an die Basisadresse anhängen. Bei selbstsigniertem Portainer-TLS eine passende öffentliche CA-Datei mounten und `NODE_EXTRA_CA_CERTS` setzen; TLS-Verifikation wird nie deaktiviert.
5. CryptoBuch-Passwortschutz aktivieren. Container einmalig mit dieser Konfiguration über Portainer neu erstellen. Die mitgelieferte lokale `compose.yaml` bleibt eine Build-Konfiguration; für Image-Updates die Portainer-Vorlage verwenden. Eigene Forks können `CRYPTOBUCH_UPDATE_REPOSITORY=owner/repo` setzen und die Image-Zeile entsprechend auf `ghcr.io/owner/repo:${CRYPTOBUCH_IMAGE_TAG}` ändern.

Ein separater CryptoBuch-Stack ist empfohlen: Portainer aktualisiert den gesamten Stack. Infrastrukturzugang bleibt serverseitig in der Secret-Datei; öffentliche Antworten enthalten weder Token, Portainer-Adresse noch Stack-Umgebung. Die Installation ist ohne Token-Konfiguration zunächst nur zur Versionsprüfung fähig.

## Versionen veröffentlichen

Der Workflow `.github/workflows/release.yml` wird **nur manuell** gestartet. Er erwartet einen vorhandenen stabilen Git-Tag `vX.Y.Z`, dessen `package.json` und Lockfile dieselbe Version enthalten. Zuvor Code samt Workflow auf den Standardbranch übernehmen, Version z. B. mit `npm version …` erhöhen und den überprüften Tag pushen. Das ist kein Bestandteil des lokalen Update-Buttons.

Der Workflow führt Tests aus, baut Images für amd64/arm64 und publiziert `ghcr.io/<owner>/<repo>:X.Y.Z`. Erst danach wird das GitHub-Release angelegt. Bei der ersten Veröffentlichung das GHCR-Paket öffentlich lesbar machen oder eine passende Registry-Anmeldung in Portainer hinterlegen. Ein privates GitHub-Repository wird von der Versionsprüfung dieser ersten Implementierung nicht unterstützt. Veröffentlichte Versions-Tags und Images nicht nachträglich ersetzen. Es wird weder ein Image noch ein Release allein durch diese Quellcodeänderung veröffentlicht.

## Ablauf und Fehlerfälle

- Nur eine neuere stabile Version kann bestätigt werden; keine beliebigen Image-Namen, Shell-Kommandos, API-Ziele oder Downgrades aus dem Browser.
- Nur angemeldete Benutzer bei aktiviertem Passwortschutz können installieren oder eine ungeklärte Sperre aufheben. Bestehender CSRF-Schutz gilt zusätzlich.
- Vor dem Deployment wird über die bestehende SQLite-Backup-Funktion gesichert. Laufende Queue-Jobs führen zum Abbruch vor dem Deployment. Neue Queue-Jobs und schreibende API-Aufrufe pausieren während des Updates. Bereits vor dem Update begonnene Direktabrufe/Live-Feeds werden nicht als transaktionaler Vollsystem-Snapshot angehalten.
- Der Update-Status wird atomar unter `DATA_DIR/application-update.json` gespeichert. Eine Portainer-Antwort bedeutet nur „angenommen“. Erst der nächste Prozess mit exakt der Zielversion meldet Erfolg. Ein anderer Neustart, Timeout oder Verbindungsabbruch lässt den Status offen; kein automatisches erneutes PUT.
- Nach 15 Minuten kann nach ausdrücklicher Prüfung in Portainer die Sperre aufgehoben werden. Das ist keine Bestätigung einer erfolgreichen Installation und kein Rollback. Die lokale Datenbanksicherung bleibt erhalten. Ein fehlerhaftes Statusfile sperrt Installationen bis zur manuellen Prüfung.
- Datenbankmigrationen können die Rückkehr zu alten Images verhindern. Automatische Wiederherstellung ist deshalb bewusst nicht Teil der Funktion. SQLite-Backups enthalten keine Belegdateien, TLS-/Sitzungsschlüssel oder externen Secret-Dateien.

Referenzen: [Portainer API](https://docs.portainer.io/api/docs), [GitHub Releases](https://docs.github.com/en/rest/releases/releases#get-the-latest-release), [Docker GitHub Actions](https://docs.docker.com/build/ci/github-actions/).
