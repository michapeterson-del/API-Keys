# API-Keys Manager

Eine einfache, rein clientseitige Web-App zum Speichern deiner API-Keys (z. B. für Claude, ChatGPT, Gemini oder beliebige andere Anbieter).

- Bezeichnung, Anbieter und der API-Key selbst
- Keys anlegen, bearbeiten, löschen, ein-/ausblenden und kopieren
- Keine Server-Komponente: alles wird nur lokal im Browser (`localStorage`) gespeichert
- Läuft direkt über GitHub Pages als statische `index.html`

## GitHub Pages aktivieren

1. Im Repo zu **Settings → Pages** gehen
2. Unter **Source** die Option **Deploy from a branch** wählen
3. Branch **main** und Ordner **/ (root)** auswählen und speichern
4. Nach kurzer Zeit ist die App unter `https://<dein-user>.github.io/api-keys/` erreichbar

## Hinweis

Die Keys werden **nicht verschlüsselt** und nur im Browser des jeweiligen Geräts gespeichert (nicht geräteübergreifend synchronisiert, nicht auf einem Server). Für rein persönliche, lokale Nutzung gedacht.
