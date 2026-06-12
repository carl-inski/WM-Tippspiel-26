/*
 * Importiert den Tippspiel-Excel-Zettel des Organisators und schreibt
 * data/tippspiel.json für die Live-Web-App.
 *
 * Aufruf: node tools/import-excel.js [pfad/zur/excel.xlsx]
 * (Standard: data/source/WM_Tippspiel_2026.xlsx)
 *
 * Erwartetes Blatt-Layout (Blatt "WM 2026"):
 *   Zeile 2: Tippernamen, je Tipper ein 7-Spalten-Block ab Spalte J (10)
 *   Zeile 3: Zwischenstand-Formeln (=SUM(N6:N132)) je Tipper (Spalte start+5)
 *   Zeilen 6..123: Spiele  A=Datum B=Anstoß C=Heim D=Gast E/G=Ergebnis H=Wert
 *     Abschnittszeilen ("Gruppenphase", "Achtelfinale", ...) in Spalte A
 *   Zeile 128/130/132: Zusatzfragen (Weltmeister / Torjäger / Elfmeterschießen),
 *     echte Antwort in Spalte E, Tipps im jeweiligen Tipper-Block
 *   Familienwertung: Familienname in Spalte Y (25), Mitglieder-Formel in Z (26)
 */
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const SHEET = 'WM 2026';
const FIRST_PLAYER_COL = 10;
const PLAYER_BLOCK = 7;
const MATCH_ROWS = { from: 5, to: 123 };
const BONUS_ROWS = { champion: 128, topscorer: 130, shootouts: 132 };
const FAMILY_AREA = { fromRow: 130, toRow: 175, nameCol: 25, formulaCol: 26 };

function cellVal(cell) {
  const v = cell && cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if (v.richText) return v.richText.map((p) => p.text).join('');
    if (v.result !== undefined) return v.result;
    if (v.formula || v.sharedFormula) return null; // Formel ohne gecachten Wert
    return null;
  }
  return v;
}

function asText(cell) {
  const v = cellVal(cell);
  return v === null ? '' : String(v).trim();
}

function asNumber(cell) {
  const v = cellVal(cell);
  return typeof v === 'number' ? v : null;
}

function colLetter(num) {
  let s = '';
  while (num > 0) {
    const m = (num - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

function colNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function hhmm(d) {
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

async function importExcel(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new Error(`Blatt "${SHEET}" nicht gefunden`);

  // --- Tipper ----------------------------------------------------------------
  const players = [];
  const row2 = ws.getRow(2);
  for (let c = FIRST_PLAYER_COL; c <= ws.columnCount + PLAYER_BLOCK; c += PLAYER_BLOCK) {
    const name = asText(row2.getCell(c));
    if (!name) break;
    players.push({ id: players.length, name, startCol: c });
  }

  // --- Spiele ----------------------------------------------------------------
  const matches = [];
  let round = '';
  for (let r = MATCH_ROWS.from; r <= MATCH_ROWS.to; r++) {
    const row = ws.getRow(r);
    const a = cellVal(row.getCell(1));
    if (typeof a === 'string' && a.trim()) { round = a.trim(); continue; }
    if (!(a instanceof Date)) continue;

    const time = cellVal(row.getCell(2));
    const kickoffLocal = a.toISOString().slice(0, 10) + 'T' +
      (time instanceof Date ? hhmm(time) : '00:00');
    matches.push({
      id: 'm' + String(matches.length + 1).padStart(3, '0'),
      row: r,
      round,
      // Anstoß in deutscher Zeit (MESZ, UTC+2 während der gesamten WM)
      kickoff: kickoffLocal + '+02:00',
      home: asText(row.getCell(3)) || null,
      away: asText(row.getCell(4)) || null,
      wert: asNumber(row.getCell(8)),
      result: (asNumber(row.getCell(5)) !== null && asNumber(row.getCell(7)) !== null)
        ? { home: asNumber(row.getCell(5)), away: asNumber(row.getCell(7)) }
        : null
    });
  }

  // --- Tipps -----------------------------------------------------------------
  for (const p of players) {
    p.tips = {};
    for (const m of matches) {
      const row = ws.getRow(m.row);
      const h = asNumber(row.getCell(p.startCol));
      const a2 = asNumber(row.getCell(p.startCol + 2));
      if (h !== null && a2 !== null) p.tips[m.id] = [h, a2];
    }
    p.bonus = {
      champion: asText(ws.getRow(BONUS_ROWS.champion).getCell(p.startCol)) || null,
      topscorer: asText(ws.getRow(BONUS_ROWS.topscorer).getCell(p.startCol)) || null,
      shootouts: asNumber(ws.getRow(BONUS_ROWS.shootouts).getCell(p.startCol))
    };
    // Zwischenstand laut Excel (gecachter Formelwert) – nur zur Validierung
    p.excelScore = asNumber(ws.getRow(3).getCell(p.startCol + 5));
  }

  // --- Zusatzfragen: echte Antworten & Punktwerte ------------------------------
  const bonus = {
    champion: {
      answer: asText(ws.getRow(BONUS_ROWS.champion).getCell(5)) || null,
      points: asNumber(ws.getRow(BONUS_ROWS.champion).getCell(3)) || 15
    },
    topscorer: {
      answer: asText(ws.getRow(BONUS_ROWS.topscorer).getCell(5)) || null,
      pointsPerGoal: asNumber(ws.getRow(BONUS_ROWS.topscorer).getCell(3)) || 3
    },
    shootouts: {
      answer: asNumber(ws.getRow(BONUS_ROWS.shootouts).getCell(5)),
      exactPoints: 10,
      malusPerDelta: 2
    }
  };

  // --- Familien aus den Durchschnittsformeln ----------------------------------
  // Formel z. B. =(AJ3+BE3+CN3+ER3+IS3)/5 – jede Zellreferenz zeigt auf die
  // Zwischenstand-Spalte (startCol+5) eines Tippers.
  const colToPlayer = new Map(players.map((p) => [p.startCol + 5, p.name]));
  const families = [];
  for (let r = FAMILY_AREA.fromRow; r <= FAMILY_AREA.toRow; r++) {
    const name = asText(ws.getRow(r).getCell(FAMILY_AREA.nameCol));
    const cell = ws.getRow(r).getCell(FAMILY_AREA.formulaCol);
    const formula = (cell.value && (cell.value.formula || cell.value.sharedFormula)) || '';
    if (!name || !formula) continue;
    const members = [];
    for (const ref of formula.matchAll(/([A-Z]{1,3})3\b/g)) {
      const player = colToPlayer.get(colNumber(ref[1]));
      if (player) members.push(player);
    }
    if (members.length) families.push({ name, members });
  }

  // --- Manuell gepflegte Torschützen (Fallback, solange keine API-Daten) ------
  const manualScorers = [];
  for (let r = 138; r <= 165; r++) {
    const n = asText(ws.getRow(r).getCell(7));
    if (!n) continue;
    manualScorers.push({ name: n, goals: asNumber(ws.getRow(r).getCell(8)) || 0 });
  }

  return {
    meta: {
      title: 'WM 2026 – Offizielles Tippspiel',
      importedAt: new Date().toISOString(),
      sourceFile: path.basename(file),
      scoring: {
        exactFactor: 1.5,
        tendencyFactor: 1,
        note: 'Punkte = Spielwert × 1,5 bei exaktem Ergebnis, × 1 bei richtiger Tendenz'
      }
    },
    matches,
    players: players.map(({ startCol, ...p }) => p),
    families,
    bonus,
    manualScorers
  };
}

async function main() {
  const file = process.argv[2] ||
    path.join(__dirname, '..', 'data', 'source', 'WM_Tippspiel_2026.xlsx');
  const data = await importExcel(file);
  const out = path.join(__dirname, '..', 'data', 'tippspiel.json');
  fs.writeFileSync(out, JSON.stringify(data, null, 1));
  console.log(`OK: ${data.players.length} Tipper, ${data.matches.length} Spiele, ` +
    `${data.families.length} Familien, ${data.manualScorers.length} Torschützen -> ${out}`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { importExcel, colLetter, colNumber };
