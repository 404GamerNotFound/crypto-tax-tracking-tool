# CryptoBuch – gemeinsames Branding für Web und iOS

Die Webanwendung verwendet dieselbe mit dem integrierten Imagegen-Werkzeug erstellte Buch-/C-Bildmarke und Journal-Illustration wie die native iOS-App. Die Originale und Erzeugungsprompts befinden sich im App-Repository unter `Docs/Branding/`. Für die Webintegration wurden vorhandene Bilder ausschließlich skaliert bzw. als JPEG exportiert, keine neuen Motive generiert.

## Dateien und Verwendung

Alle Laufzeitbilder liegen lokal unter `public/images/brand/` und werden beim Docker-Build über `COPY public ./public` übernommen.

- `cryptobuch-logo-128.png`: Logo in der Navigation aller Seiten.
- `cryptobuch-logo-256.png`: Logo im leeren Dashboard.
- `favicon-32.png`: Browser-Tab-Icon.
- `apple-touch-icon.png`: iPhone-/iPad-Lesezeichen-Icon (180 × 180).
- `cryptobuch-journal-480.jpg` und `cryptobuch-journal-960.jpg`: responsive Illustration im Desktop-Dashboard und in der leeren Wallet-Ansicht.

Die JPEG-Varianten sind rund 23 bzw. 70 KB groß. Explizite Bildabmessungen verhindern Layoutsprünge; `srcset` lässt den Browser die passende Auflösung auswählen. Bilder leerer Ansichten laden verzögert. Auf schmalen Bildschirmen entfällt die zusätzliche Dashboard-Illustration zugunsten der Bedienelemente.

Dekorative Bilder verwenden leere Alternativtexte. Der Markenname und die Linkbeschriftungen bleiben als zugänglicher HTML-Text erhalten. Es gibt keine externen Bildabrufe, kein Tracking und keine Änderung an API oder Datenbank.
