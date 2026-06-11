/*
 * Tippspiel-Parser: erkennt Spielpaarungen in einer Excel-Arbeitsmappe und
 * findet die Zellen, in die die Tipps geschrieben werden sollen.
 *
 * Läuft im Browser (window.TippParser) und in Node (module.exports),
 * arbeitet in beiden Fällen auf einem ExcelJS-Workbook.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TippParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Ländernamen (deutsch + gängige englische Schreibweisen und Kurzformen).
  // Wert: ISO-3166-alpha2-Code für die Flaggen-Anzeige ('' = keine Flagge).
  // ---------------------------------------------------------------------------
  var COUNTRIES = {
    'deutschland': 'de', 'germany': 'de',
    'frankreich': 'fr', 'france': 'fr',
    'spanien': 'es', 'spain': 'es',
    'england': 'gb-eng',
    'portugal': 'pt',
    'niederlande': 'nl', 'holland': 'nl', 'netherlands': 'nl',
    'belgien': 'be', 'belgium': 'be',
    'italien': 'it', 'italy': 'it',
    'kroatien': 'hr', 'croatia': 'hr',
    'schweiz': 'ch', 'switzerland': 'ch',
    'oesterreich': 'at', 'osterreich': 'at', 'austria': 'at',
    'daenemark': 'dk', 'danemark': 'dk', 'denmark': 'dk',
    'norwegen': 'no', 'norway': 'no',
    'schweden': 'se', 'sweden': 'se',
    'polen': 'pl', 'poland': 'pl',
    'tschechien': 'cz', 'czechia': 'cz', 'czech republic': 'cz',
    'slowakei': 'sk', 'slovakia': 'sk',
    'slowenien': 'si', 'slovenia': 'si',
    'serbien': 'rs', 'serbia': 'rs',
    'ukraine': 'ua',
    'tuerkei': 'tr', 'turkei': 'tr', 'turkey': 'tr', 'tuerkiye': 'tr', 'turkiye': 'tr',
    'schottland': 'gb-sct', 'scotland': 'gb-sct',
    'wales': 'gb-wls',
    'irland': 'ie', 'ireland': 'ie',
    'nordirland': 'gb-nir', 'northern ireland': 'gb-nir',
    'island': 'is', 'iceland': 'is',
    'ungarn': 'hu', 'hungary': 'hu',
    'rumaenien': 'ro', 'rumanien': 'ro', 'romania': 'ro',
    'bulgarien': 'bg', 'bulgaria': 'bg',
    'griechenland': 'gr', 'greece': 'gr',
    'russland': 'ru', 'russia': 'ru',
    'albanien': 'al', 'albania': 'al',
    'bosnien': 'ba', 'bosnien-herzegowina': 'ba', 'bosnien und herzegowina': 'ba', 'bosnia': 'ba',
    'nordmazedonien': 'mk', 'north macedonia': 'mk',
    'montenegro': 'me',
    'finnland': 'fi', 'finland': 'fi',
    'georgien': 'ge', 'georgia': 'ge',
    'kosovo': 'xk',
    'brasilien': 'br', 'brazil': 'br',
    'argentinien': 'ar', 'argentina': 'ar',
    'uruguay': 'uy',
    'kolumbien': 'co', 'colombia': 'co',
    'ecuador': 'ec',
    'paraguay': 'py',
    'peru': 'pe',
    'chile': 'cl',
    'bolivien': 'bo', 'bolivia': 'bo',
    'venezuela': 've',
    'mexiko': 'mx', 'mexico': 'mx',
    'usa': 'us', 'vereinigte staaten': 'us', 'vereinigte staaten von amerika': 'us',
    'united states': 'us',
    'kanada': 'ca', 'canada': 'ca',
    'costa rica': 'cr',
    'panama': 'pa',
    'honduras': 'hn',
    'jamaika': 'jm', 'jamaica': 'jm',
    'haiti': 'ht',
    'curacao': 'cw',
    'trinidad und tobago': 'tt', 'trinidad and tobago': 'tt',
    'el salvador': 'sv',
    'guatemala': 'gt',
    'suriname': 'sr',
    'marokko': 'ma', 'morocco': 'ma',
    'tunesien': 'tn', 'tunisia': 'tn',
    'algerien': 'dz', 'algeria': 'dz',
    'aegypten': 'eg', 'agypten': 'eg', 'egypt': 'eg',
    'senegal': 'sn',
    'ghana': 'gh',
    'nigeria': 'ng',
    'kamerun': 'cm', 'cameroon': 'cm',
    'elfenbeinkueste': 'ci', 'elfenbeinkuste': 'ci', 'cote divoire': 'ci', "cote d'ivoire": 'ci',
    'ivory coast': 'ci',
    'mali': 'ml',
    'burkina faso': 'bf',
    'suedafrika': 'za', 'sudafrika': 'za', 'south africa': 'za',
    'dr kongo': 'cd', 'dr congo': 'cd', 'kongo': 'cd',
    'kap verde': 'cv', 'cape verde': 'cv', 'cabo verde': 'cv',
    'gabun': 'ga', 'gabon': 'ga',
    'uganda': 'ug',
    'japan': 'jp',
    'suedkorea': 'kr', 'sudkorea': 'kr', 'south korea': 'kr', 'korea': 'kr',
    'republik korea': 'kr',
    'australien': 'au', 'australia': 'au',
    'iran': 'ir',
    'saudi-arabien': 'sa', 'saudi arabien': 'sa', 'saudi arabia': 'sa',
    'katar': 'qa', 'qatar': 'qa',
    'irak': 'iq', 'iraq': 'iq',
    'vae': 'ae', 'vereinigte arabische emirate': 'ae', 'united arab emirates': 'ae',
    'usbekistan': 'uz', 'uzbekistan': 'uz',
    'jordanien': 'jo', 'jordan': 'jo',
    'indonesien': 'id', 'indonesia': 'id',
    'china': 'cn',
    'neuseeland': 'nz', 'new zealand': 'nz',
    'neukaledonien': 'nc', 'new caledonia': 'nc'
  };

  // Platzhalter für K.o.-Spiele, z. B. "1. Gruppe A", "2B", "Sieger Spiel 74",
  // "3. Gruppe A/B/C", "W73" / "L61".
  var PLACEHOLDER_PATTERNS = [
    /^[12]\.?\s*(aus\s+)?(gruppe|gr\.?|group)\s*[a-l]$/i,
    /^[123][a-l]$/i,
    /^3\.?\s*(aus\s+)?(gruppe|gr\.?|group)?\s*[a-l](\s*\/\s*[a-l])+$/i,
    /^(sieger|gewinner|zweiter|verlierer|winner|loser)\s+(gruppe\s*[a-l]|gr\.?\s*[a-l]|group\s*[a-l]|spiel\s*\d+|match\s*\d+|af\s*\d*|vf\s*\d*|hf\s*\d*|achtelfinale\s*\d*|viertelfinale\s*\d*|halbfinale\s*\d*)$/i,
    /^[wl]\s?\d{1,3}$/i,
    /^bester?\s+(dritter|gruppendritter).*$/i
  ];

  // Überschriften, die einen Turnierabschnitt markieren.
  var SECTION_PATTERN = /^(gruppe\s+[a-l]\b.*|group\s+[a-l]\b.*|vorrunde.*|gruppenphase.*|sechzehntelfinale.*|zwischenrunde.*|achtelfinale.*|viertelfinale.*|halbfinale.*|spiel\s+um\s+platz\s+3.*|kleines\s+finale.*|finale\s*.*|runde\s+der\s+letzten\s+\d+.*|round\s+of\s+\d+.*)$/i;

  var SEPARATOR_PATTERN = /^(-|–|—|:|vs\.?|gegen)$/i;
  // Zellen, in die ein Tipp geschrieben werden darf (leer oder reine Platzhalter
  // wie "_", "__:__", "-").
  var WRITABLE_PATTERN = /^[\s_.\-–—]*$/;

  function stripDiacritics(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeName(s) {
    var t = String(s);
    // Flaggen-Emoji (Regional Indicator Symbols) und sonstige Symbole entfernen
    t = t.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '');
    t = t.replace(/[\u{2600}-\u{27BF}\u{1F300}-\u{1FAFF}\u{FE0F}]/gu, '');
    t = stripDiacritics(t).toLowerCase();
    t = t.replace(/\(.*?\)/g, ' ');       // Klammerzusätze wie "(Gastgeber)"
    t = t.replace(/[*]+/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '');
    return t;
  }

  function teamInfo(text) {
    var n = normalizeName(text);
    if (!n) return null;
    if (Object.prototype.hasOwnProperty.call(COUNTRIES, n)) {
      return { name: String(text).trim(), code: COUNTRIES[n], placeholder: false };
    }
    for (var i = 0; i < PLACEHOLDER_PATTERNS.length; i++) {
      if (PLACEHOLDER_PATTERNS[i].test(n)) {
        return { name: String(text).trim(), code: '', placeholder: true };
      }
    }
    return null;
  }

  function cellText(cell) {
    if (!cell) return '';
    var v = cell.value;
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return '';
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map(function (p) { return p.text; }).join('');
      if (v.result !== undefined && v.result !== null) return String(v.result);
      if (v.text !== undefined) return String(v.text);
      return '';
    }
    return String(v);
  }

  function isDateCell(cell) {
    if (!cell) return false;
    if (cell.value instanceof Date) return true;
    var t = cellText(cell).trim();
    return /^\d{1,2}\.\d{1,2}\.(\d{2,4})?$/.test(t) ||
      /^\d{1,2}\.\d{1,2}\.(\d{2,4})?\s+\d{1,2}:\d{2}/.test(t) ||
      /^\d{1,2}:\d{2}(\s*uhr)?$/i.test(t);
  }

  function formatDateCell(cell) {
    if (cell.value instanceof Date) {
      var d = cell.value;
      // ExcelJS liefert Datumswerte in UTC
      var day = String(d.getUTCDate()).padStart(2, '0');
      var mon = String(d.getUTCMonth() + 1).padStart(2, '0');
      var hh = d.getUTCHours();
      var mm = d.getUTCMinutes();
      var out = day + '.' + mon + '.' + d.getUTCFullYear();
      if (hh !== 0 || mm !== 0) {
        out += ' ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
      }
      return out;
    }
    return cellText(cell).trim();
  }

  function isWritable(text) {
    return WRITABLE_PATTERN.test(text);
  }

  // Liest ein Worksheet in ein einfaches Gitter aus Strings ein.
  function readGrid(ws) {
    var grid = [];
    var maxCol = 0;
    ws.eachRow({ includeEmpty: true }, function (row, rowNumber) {
      grid[rowNumber] = grid[rowNumber] || {};
      row.eachCell({ includeEmpty: true }, function (cell, colNumber) {
        grid[rowNumber][colNumber] = cell;
        if (colNumber > maxCol) maxCol = colNumber;
      });
    });
    return { rows: grid, maxCol: maxCol };
  }

  // Sucht ab Spalte startCol die Zellen, in die der Tipp geschrieben wird.
  // Liefert {type:'pair', homeCell, awayCell} oder {type:'single', cell} oder null.
  function findTipTarget(rowCells, startCol, maxCol, stopCol) {
    var writables = [];
    // bewusst über maxCol hinaus: Zellen rechts vom belegten Bereich sind leer
    // und damit beschreibbar
    var limit = startCol + 6;
    if (stopCol !== undefined) limit = Math.min(limit, stopCol - 1);
    for (var c = startCol; c <= limit; c++) {
      var cell = rowCells[c];
      var t = cellText(cell).trim();
      if (SEPARATOR_PATTERN.test(t)) continue;        // ":"-Trennzelle überspringen
      if (cell && isDateCell(cell)) break;            // Datumspalte beendet die Suche
      if (isWritable(t)) {
        writables.push(c);
        if (writables.length === 2) break;
      } else {
        break; // belegte Zelle (z. B. Punktespalte einer Auswertung) beendet die Suche
      }
    }
    if (writables.length >= 2) {
      return { type: 'pair', homeCol: writables[0], awayCol: writables[1] };
    }
    if (writables.length === 1) {
      return { type: 'single', col: writables[0] };
    }
    return null;
  }

  // Erkennt die Spiele eines Worksheets.
  function parseSheet(ws) {
    var g = readGrid(ws);
    var matches = [];
    var section = '';

    for (var r = 1; r < g.rows.length; r++) {
      var rowCells = g.rows[r] || {};

      // Abschnitts-Überschrift? (einzige Textzelle der Zeile, z. B. "Gruppe A")
      var texts = [];
      for (var c = 1; c <= g.maxCol; c++) {
        var t = cellText(rowCells[c]).trim();
        if (t) texts.push({ col: c, text: t });
      }
      if (texts.length >= 1 && texts.length <= 2 && SECTION_PATTERN.test(normalizeName(texts[0].text))) {
        section = texts[0].text.trim();
        continue;
      }

      var c2 = 1;
      while (c2 <= g.maxCol) {
        var found = matchAt(rowCells, c2, g.maxCol);
        if (found) {
          found.row = r;
          found.section = section;
          found.date = findDate(rowCells, g.maxCol, found);
          matches.push(found);
          c2 = found.scanEnd + 1;
        } else {
          c2++;
        }
      }
    }

    // Zweiter Durchlauf: Spalten-Vorlage. Wenn in einem Blatt viele Spiele mit
    // identischem Spaltenmuster erkannt wurden, werden Zeilen mit demselben
    // Muster ebenfalls als Spiel gewertet, auch wenn die Teamnamen unbekannt
    // sind (Tippfehler, exotische Teams, Vereinsnamen ...).
    templatePass(g, matches);

    matches.forEach(function (m) { m.sheetName = ws.name; });
    return matches;
  }

  // Prüft, ob an Spalte c ein Spiel beginnt.
  function matchAt(rowCells, c, maxCol) {
    var cell = rowCells[c];
    var text = cellText(cell).trim();
    if (!text) return null;

    // Variante 1: beide Teams in einer Zelle ("Deutschland - Spanien")
    var parts = text.split(/\s+(?:-|–|—|vs\.?|gegen)\s+/i);
    if (parts.length === 2) {
      var h1 = teamInfo(parts[0]);
      var a1 = teamInfo(parts[1]);
      if (h1 && a1) {
        var target1 = findTipTarget(rowCells, c + 1, maxCol);
        // Spiel in einer Zelle -> Tipp ebenfalls kompakt in eine Zelle ("2:1"),
        // außer das Blatt hat ein explizites ":"-Trennzellen-Layout
        if (target1 && target1.type === 'pair' && !hasSeparatorBetween(rowCells, target1.homeCol, target1.awayCol)) {
          target1 = { type: 'single', col: target1.homeCol };
        }
        return {
          home: h1, away: a1, teamCols: [c, c], combined: true,
          target: target1, scanEnd: target1 ? lastTargetCol(target1) : c
        };
      }
    }

    // Variante 2: Teams in zwei Zellen, ggf. mit Trennzelle dazwischen
    var home = teamInfo(text);
    if (!home) return null;
    for (var cc = c + 1; cc <= Math.min(maxCol, c + 4); cc++) {
      var t2 = cellText(rowCells[cc]).trim();
      if (!t2 || SEPARATOR_PATTERN.test(t2) || isWritable(t2)) continue;
      var away = teamInfo(t2);
      if (!away) return null;
      // Tippzellen: explizit freie Zellen ZWISCHEN den Teams haben Vorrang
      // (typisches Layout "Heim | _ : _ | Gast"), sonst rechts vom Auswärtsteam
      var between = null;
      if (cc - c >= 3) between = findTipTarget(rowCells, c + 1, maxCol, cc);
      var right = findTipTarget(rowCells, cc + 1, maxCol);
      var target = (between && between.type === 'pair') ? between : (right || between);
      return {
        home: home, away: away, teamCols: [c, cc], combined: false,
        target: target, scanEnd: Math.max(cc, target ? lastTargetCol(target) : cc)
      };
    }
    return null;
  }

  function hasSeparatorBetween(rowCells, fromCol, toCol) {
    for (var c = fromCol + 1; c < toCol; c++) {
      if (SEPARATOR_PATTERN.test(cellText(rowCells[c]).trim())) return true;
    }
    return false;
  }

  function lastTargetCol(target) {
    return target.type === 'pair' ? target.awayCol : target.col;
  }

  function findDate(rowCells, maxCol, match) {
    var used = {};
    used[match.teamCols[0]] = true;
    used[match.teamCols[1]] = true;
    if (match.target) {
      if (match.target.type === 'pair') {
        used[match.target.homeCol] = true;
        used[match.target.awayCol] = true;
      } else {
        used[match.target.col] = true;
      }
    }
    for (var c = 1; c <= maxCol; c++) {
      if (used[c]) continue;
      var cell = rowCells[c];
      if (cell && isDateCell(cell)) return formatDateCell(cell);
    }
    return '';
  }

  function templatePass(g, matches) {
    if (matches.length < 5) return;
    // Häufigstes Spaltenmuster ermitteln
    var counts = {};
    matches.forEach(function (m) {
      if (!m.target || m.combined) return;
      var key = m.teamCols[0] + '|' + m.teamCols[1] + '|' + JSON.stringify(m.target);
      counts[key] = (counts[key] || 0) + 1;
    });
    var bestKey = null, bestCount = 0;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > bestCount) { bestCount = counts[k]; bestKey = k; }
    });
    if (!bestKey || bestCount < 5) return;

    var p = bestKey.split('|');
    var homeCol = parseInt(p[0], 10);
    var awayCol = parseInt(p[1], 10);
    var target = JSON.parse(p.slice(2).join('|'));
    var knownRows = {};
    matches.forEach(function (m) { knownRows[m.row] = true; });

    // Kopfzeilen-Begriffe, die keine Teamnamen sind
    var stopWords = /^(heim(team|mannschaft)?|gast(team|mannschaft)?|team\s*[12]?|mannschaft\s*[12]?|datum|spiel(e)?|begegnung|paarung|ergebnis|tipp(s)?|tore|punkte|name)$/i;

    for (var r = 1; r < g.rows.length; r++) {
      if (knownRows[r]) continue;
      var rowCells = g.rows[r] || {};
      var ht = cellText(rowCells[homeCol]).trim();
      var at = cellText(rowCells[awayCol]).trim();
      if (!ht || !at || isWritable(ht) || isWritable(at)) continue;
      if (SECTION_PATTERN.test(normalizeName(ht))) continue;
      if (stopWords.test(normalizeName(ht)) || stopWords.test(normalizeName(at))) continue;
      // Tippzellen müssen frei sein, sonst ist es z. B. eine Kopfzeile
      var tCells = target.type === 'pair' ? [target.homeCol, target.awayCol] : [target.col];
      var ok = tCells.every(function (c) { return isWritable(cellText(rowCells[c]).trim()); });
      if (!ok) continue;
      if (/^\d+$/.test(ht) || /^\d+$/.test(at)) continue;
      matches.push({
        home: { name: ht, code: '', placeholder: false },
        away: { name: at, code: '', placeholder: false },
        teamCols: [homeCol, awayCol], combined: false,
        target: target, row: r, section: '',
        date: findDate(rowCells, g.maxCol, { teamCols: [homeCol, awayCol], target: target }),
        fromTemplate: true
      });
    }
    matches.sort(function (a, b) { return a.row - b.row; });
  }

  // Sucht eine Zelle, in die der Name des Tippers geschrieben werden kann.
  function findNameTarget(ws) {
    var g = readGrid(ws);
    var label = /^(name|dein name|tipper|spieler(in)?|teilnehmer(in)?|getippt von|tipp von)\s*:?$/i;
    for (var r = 1; r < g.rows.length; r++) {
      for (var c = 1; c <= g.maxCol; c++) {
        var t = cellText(g.rows[r][c]).trim();
        if (!label.test(normalizeName(t))) continue;
        // rechts daneben oder darunter, falls frei
        if (isWritable(cellText((g.rows[r] || {})[c + 1]).trim())) {
          return { row: r, col: c + 1 };
        }
        if (g.rows[r + 1] && isWritable(cellText(g.rows[r + 1][c]).trim())) {
          return { row: r + 1, col: c };
        }
      }
    }
    return null;
  }

  // Parst alle Blätter einer Arbeitsmappe. Liefert eine flache Liste von Spielen
  // mit eindeutigen IDs.
  function parseWorkbook(workbook) {
    var all = [];
    workbook.eachSheet(function (ws) {
      if (ws.state && ws.state !== 'visible') return;
      parseSheet(ws).forEach(function (m) { all.push(m); });
    });
    all.forEach(function (m, i) { m.id = i; });
    return all;
  }

  // Schreibt die Tipps zurück in die Arbeitsmappe.
  // tips: { [id]: {home: number, away: number} }
  function applyTips(workbook, matches, tips, tipperName) {
    var written = 0;
    matches.forEach(function (m) {
      var tip = tips[m.id];
      if (!tip || tip.home === null || tip.home === undefined ||
          tip.away === null || tip.away === undefined || !m.target) return;
      var ws = workbook.getWorksheet(m.sheetName);
      if (!ws) return;
      if (m.target.type === 'pair') {
        ws.getRow(m.row).getCell(m.target.homeCol).value = Number(tip.home);
        ws.getRow(m.row).getCell(m.target.awayCol).value = Number(tip.away);
      } else {
        ws.getRow(m.row).getCell(m.target.col).value = tip.home + ':' + tip.away;
      }
      written++;
    });

    if (tipperName) {
      workbook.eachSheet(function (ws) {
        if (ws.state && ws.state !== 'visible') return;
        var t = findNameTarget(ws);
        if (t) ws.getRow(t.row).getCell(t.col).value = tipperName;
      });
    }
    return written;
  }

  return {
    parseWorkbook: parseWorkbook,
    parseSheet: parseSheet,
    applyTips: applyTips,
    findNameTarget: findNameTarget,
    teamInfo: teamInfo,
    normalizeName: normalizeName,
    COUNTRIES: COUNTRIES
  };
});
