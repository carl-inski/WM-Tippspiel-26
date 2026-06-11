# ⚽ WM-Tippspiel

Eine kleine Web-App für das WM-Tippspiel: Die Excel-Vorlage vom Tippspiel-Organisator
hochladen, alle Spiele bequem in einer schönen Oberfläche tippen und die fertig
ausgefüllte Excel-Datei herunterladen — benannt nach dem eigenen Namen
(z. B. `Tippspiel_Carl.xlsx`). Die Datei muss dann nur noch per E-Mail verschickt werden.

## So funktioniert's

1. **Name eingeben** und die **Excel-Vorlage** (.xlsx) hochladen bzw. per Drag & Drop ablegen.
2. Die App erkennt automatisch alle Spiele in der Tabelle und zeigt sie als Liste an —
   inklusive Gruppen-/Rundenüberschriften, Flaggen und Spieldatum.
3. **Alle Spiele tippen** — der Fortschrittsbalken zeigt, wie viele Spiele noch fehlen.
4. **„Excel mit meinen Tipps herunterladen"** klicken: Die Tipps werden in die
   Original-Datei geschrieben (Formatierung bleibt erhalten) und als
   `Tippspiel_<Name>.xlsx` heruntergeladen.

🔒 **Datenschutz:** Alles läuft komplett im Browser. Die Excel-Datei wird nirgendwohin
hochgeladen, es gibt keinen Server und es werden keine Daten gespeichert.

## App starten

Es handelt sich um eine rein statische Web-App — es reicht, `index.html` im Browser zu öffnen.

Alternativ mit einem lokalen Webserver:

```bash
npm start          # startet http://localhost:8000
```

### Auf GitHub Pages veröffentlichen

Im Repository unter **Settings → Pages** als Quelle „Deploy from a branch" und den
gewünschten Branch mit Ordner `/ (root)` auswählen. Danach ist die App unter
`https://<benutzer>.github.io/<repo>/` für alle Mittipper erreichbar.

## Welche Excel-Layouts werden erkannt?

Die App sucht in allen Tabellenblättern nach Zeilen mit Spielpaarungen und freien
Zellen für den Tipp. Unterstützt werden u. a.:

- Teams in zwei Zellen mit Tippzellen dazwischen: `Deutschland | _ | _ | Spanien`
- Teams nebeneinander mit Tippzellen rechts: `Deutschland | Spanien | _ | _`
- Layouts mit `:`-Trennzelle: `Deutschland | Spanien | _ | : | _`
- Beide Teams in einer Zelle: `Deutschland - Spanien` (Tipp wird als `2:1` eingetragen)
- K.-o.-Platzhalter wie `1. Gruppe A`, `2B`, `Sieger Spiel 74`, `W73`
- Deutsche und englische Ländernamen, auch mit Flaggen-Emoji
- Unbekannte Teamnamen, sofern das Blatt einem erkennbaren Spaltenmuster folgt

Steht neben einem Feld wie `Name:` eine freie Zelle, trägt die App dort automatisch
den Namen des Tippers ein.

Eine Beispiel-Vorlage zum Ausprobieren liegt unter
[`sample/Tippspiel_Vorlage.xlsx`](sample/Tippspiel_Vorlage.xlsx)
(neu erzeugen mit `npm run make-sample`).

## Entwicklung

```bash
npm install        # einmalig (nur für Tests/Tools, die App selbst braucht kein Build)
npm test           # Parser-Tests (node:test)
```

Projektstruktur:

| Pfad | Inhalt |
| --- | --- |
| `index.html`, `css/style.css` | Oberfläche |
| `js/app.js` | UI-Logik (Upload, Tippliste, Download) |
| `js/parser.js` | Erkennung der Spiele & Tippzellen, Zurückschreiben der Tipps |
| `js/vendor/exceljs.min.js` | gebündeltes [ExcelJS](https://github.com/exceljs/exceljs) — die App läuft damit auch offline |
| `test/parser.test.js` | Tests für den Parser |
| `tools/make-sample.js` | erzeugt die Beispiel-Vorlage |
