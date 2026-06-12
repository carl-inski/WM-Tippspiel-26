# 🏆 WM 2026 – Familien-Tippspiel (Live-App)

Interaktive Web-App zum Excel-Tippspiel: **Live-Spielstände, Live-Torschützenliste,
Einzelwertung und Familienwertung** – automatisch aktualisiert, im
Liquid-Glass-Design. Die Tipps aller 72 Mittipper stammen aus der
Original-Excel des Organisators und werden mit Live-Daten von
football-data.org verrechnet.

## Wie es funktioniert

```
Excel des Onkels ──> tools/import-excel.js ──> data/tippspiel.json ─┐
                                                                    ├─> Web-App (statisch)
football-data.org ──> Cloudflare-Worker-Proxy ──> Live-Ergebnisse ──┘
```

- **Keine Datenbank, kein eigener Server:** Die App ist eine statische Seite
  (GitHub Pages). Die Wertung – exakt = Wert × 1,5, Tendenz = Wert × 1,
  Zusatzfragen – wird live im Browser berechnet und ist
  **gegen die Original-Excel-Formeln validiert** (siehe `test/scoring.test.js`).
- **Live-Daten:** alle 60 s werden Spielstände und Torschützen geholt.
  Läuft ein Spiel, fließen die Punkte als „Live-Punkte" (rot pulsierend)
  in Tabelle und Familienwertung ein.
- **Ohne Live-Anbindung** zeigt die App den Stand aus der Excel
  plus optional manuell gepflegte Ergebnisse (`data/manual-results.json`).

## Einmalige Einrichtung der Live-Daten (~10 Minuten, kostenlos)

1. **API-Key holen:** Auf https://www.football-data.org/client/register
   kostenlos registrieren → Key kommt per E-Mail.
2. **Cloudflare-Worker anlegen** (Proxy, damit der Key geheim bleibt und
   CORS funktioniert):
   - https://dash.cloudflare.com → *Workers & Pages* → *Create Worker*
   - Inhalt von [`proxy/cloudflare-worker.js`](proxy/cloudflare-worker.js)
     einfügen → *Deploy*
   - *Settings → Variables and Secrets* → Secret `FOOTBALL_DATA_API_KEY`
     mit dem API-Key anlegen
3. **Worker-URL eintragen:** In [`js/config.js`](js/config.js) die URL
   (`https://<name>.<account>.workers.dev`) als `proxyUrl` setzen, committen,
   fertig.

## Veröffentlichen (GitHub Pages)

Repository → **Settings → Pages** → Source „Deploy from a branch" →
Branch wählen, Ordner `/ (root)`. Die App ist dann unter
`https://<benutzer>.github.io/<repo>/` erreichbar.

## Neue Excel vom Organisator einspielen

Wenn eine aktualisierte Excel kommt (z. B. mit den K.o.-Tipps):

```bash
# Datei ablegen und importieren
cp ~/Downloads/WM_Tippspiel_2026.xlsx data/source/
npm run import
npm test          # prüft u. a., dass die Wertung zur Excel passt
git add data/ && git commit -m "Tippdaten aktualisiert" && git push
```

## Manuelle Ergebnisse (Fallback)

Sollte die Live-API einmal ausfallen, können Ergebnisse in
[`data/manual-results.json`](data/manual-results.json) gepflegt werden
(Spiel-IDs `m001`–`m104` stehen in `data/tippspiel.json`):

```json
{ "results": { "m003": { "home": 1, "away": 0, "finished": true } } }
```

Priorität: Live-API > manuelle Ergebnisse > Excel-Stand.

## Entwicklung

```bash
npm install        # einmalig (nur für Tests/Import)
npm test           # alle Tests
npm run import     # Excel -> data/tippspiel.json
npm start          # lokaler Server auf http://localhost:8000
```

| Pfad | Inhalt |
| --- | --- |
| `index.html`, `css/liquid.css` | Live-App, Liquid-Glass-UI |
| `js/main.js` | Ansichten (Spiele, Einzelwertung, Familien, Torschützen) |
| `js/scoring.js` | Wertungslogik (gegen Excel validiert) |
| `js/api.js` | football-data.org-Anbindung + Spiel-Zuordnung |
| `js/teams.js` | Teamnamen-Mapping (deutsch ↔ API) + Flaggen |
| `js/config.js` | Proxy-URL & Poll-Intervall |
| `tools/import-excel.js` | Excel-Import |
| `data/source/` | Original-Excel des Organisators |
| `proxy/cloudflare-worker.js` | API-Proxy zum Selbst-Deployen |
| `tippzettel-tool/` | ursprüngliche App zum Ausfüllen des Tippzettels |

## Wertungsregeln (aus der Excel übernommen)

- **Spieltipp:** exaktes Ergebnis = Spielwert × 1,5 · richtige Tendenz = Spielwert × 1 · sonst 0.
  Der Spielwert steigt im Turnierverlauf (1,0 bis 11,6 – die USA-Spiele zählen traditionell 0,2 😉)
- **Weltmeister:** 15 Punkte
- **Torjäger:** 3 Punkte pro WM-Tor des getippten Spielers
- **Anzahl Elfmeterschießen** (bis einschl. Halbfinale): exakt +10, sonst −2 × Abweichung
  (wird erst am Turnierende gewertet)
- **Familienwertung:** Durchschnitt der Gesamtpunkte aller Familienmitglieder
