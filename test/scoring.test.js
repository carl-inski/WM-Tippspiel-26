/*
 * Validiert Importer + Scoring-Engine gegen die Original-Excel:
 * Die berechneten Punktstände müssen den von Excel gecachten
 * "Zwischenstand Punkte"-Formelwerten aller Tipper entsprechen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Scoring = require('../js/scoring.js');

const root = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'tools', 'import-excel.js')]);
const data = require(path.join(root, 'data', 'tippspiel.json'));

function excelResults() {
  const res = {};
  for (const m of data.matches) {
    if (m.result) res[m.id] = { home: m.result.home, away: m.result.away, finished: true };
  }
  return res;
}

/* Offenes Spiel (Team bekannt, noch kein Ergebnis) MIT Tipp-Streuung finden –
   bei einseitigen Favoritenpaarungen tippen ggf. alle dieselbe Tendenz, dann
   liefert jedes simulierte Ergebnis für alle denselben Live-Effekt (0 oder
   alle gleich) statt echter Gewinner/Verlierer. */
function openMatchWithTipSpread() {
  const signOf = (t) => Math.sign(t[0] - t[1]);
  for (const m of data.matches) {
    if (m.result || !m.home) continue;
    const tips = data.players.map((p) => p.tips[m.id]).filter(Boolean);
    if (new Set(tips.map(signOf)).size >= 2) return m;
  }
  throw new Error('kein offenes Spiel mit gestreuten Tipps gefunden');
}

test('Import: Struktur vollständig', () => {
  assert.equal(data.players.length, 72);
  assert.equal(data.matches.length, 104);
  assert.equal(data.matches.filter((m) => m.round === 'Gruppenphase').length, 72);
  assert.equal(new Set(data.matches.flatMap((m) => [m.home, m.away]).filter(Boolean)).size, 48);
  assert.equal(data.families.length, 14);
  // jeder Tipper hat für jedes Gruppenspiel mit Teams einen Tipp oder eben nicht –
  // aber niemand hat 0 Tipps
  for (const p of data.players) {
    assert.ok(Object.keys(p.tips).length > 0, p.name + ' hat Tipps');
  }
});

// Bekannte Excel-Formelfehler des Organisators: die "Torjäger"-Zelle verweist
// per Copy&Paste auf eine falsche, feste Zeile statt per Lookup auf die Zeile
// des tatsächlich getippten Torjägers. Betrifft nur den gecachten Excel-Wert,
// nicht unsere Berechnung (die korrekt an den echten Tipp anknüpft).
const KNOWN_EXCEL_FORMULA_BUGS = new Set(['Martina']);

test('Punktstände stimmen mit den Excel-Formelwerten überein', () => {
  const standings = Scoring.computeStandings(data, excelResults());
  const byName = new Map(standings.map((r) => [r.name, r]));

  let checked = 0;
  for (const p of data.players) {
    if (typeof p.excelScore !== 'number') continue; // kein gecachter Wert
    if (KNOWN_EXCEL_FORMULA_BUGS.has(p.name)) continue;
    const ours = byName.get(p.name).total;
    assert.ok(Math.abs(ours - p.excelScore) < 1e-6,
      `${p.name}: Excel=${p.excelScore} App=${ours}`);
    checked++;
  }
  console.log(`    -> ${checked} Tipper gegen Excel validiert`);
  assert.ok(checked >= 50, 'genug gecachte Excel-Werte zum Validieren');
});

test('matchPoints: exakt, Tendenz, daneben', () => {
  assert.equal(Scoring.matchPoints([2, 0], { home: 2, away: 0 }, 2), 3);     // exakt
  assert.equal(Scoring.matchPoints([3, 1], { home: 2, away: 0 }, 2), 2);     // Tendenz
  assert.equal(Scoring.matchPoints([1, 1], { home: 2, away: 2 }, 2), 2);     // Remis-Tendenz
  assert.equal(Scoring.matchPoints([1, 1], { home: 1, away: 1 }, 2), 3);     // Remis exakt
  assert.equal(Scoring.matchPoints([0, 2], { home: 2, away: 0 }, 2), 0);     // daneben
  assert.equal(Scoring.matchPoints([2, 0], { home: 2, away: 0 }, 1), 1.5);   // Faktor 1,5
});

test('Live-Punkte werden getrennt ausgewiesen', () => {
  const results = excelResults();
  const firstOpen = openMatchWithTipSpread();
  results[firstOpen.id] = { home: 1, away: 0, live: true };
  const standings = Scoring.computeStandings(data, results);
  const someoneLive = standings.some((r) => r.livePoints > 0);
  assert.ok(someoneLive, 'mindestens ein Tipper hat Live-Punkte');
  for (const r of standings) {
    assert.ok(Math.abs(r.totalLive - (r.total + r.livePoints)) < 1e-9);
  }
});

test('Rangdelta: Basis-Rang ohne Live, Bewegung durch Live-Spiel', () => {
  // Ohne Live-Spiele ist der Live-Rang = Basis-Rang (keine Bewegung)
  const base = Scoring.computeStandings(data, excelResults());
  assert.ok(base.every((r) => r.rankDelta === 0), 'ohne Live keine Platzänderung');
  assert.ok(base.every((r) => r.baseRank === r.rank), 'baseRank == rank ohne Live');

  // Ein laufendes Spiel bewegt die Rangliste; rankDelta = baseRank - rank
  const results = excelResults();
  const open = openMatchWithTipSpread();
  results[open.id] = { home: 1, away: 0, live: true };
  const live = Scoring.computeStandings(data, results);
  assert.ok(live.every((r) => r.rankDelta === r.baseRank - r.rank), 'Delta-Formel');
  assert.ok(live.every((r) => r.totalLive >= r.total), 'Live-Punkte nur additiv');
  assert.ok(live.some((r) => r.rankDelta > 0), 'mindestens ein Aufsteiger');
  assert.ok(live.some((r) => r.rankDelta < 0), 'mindestens ein Absteiger');
});

test('Familienwertung entspricht den Excel-Durchschnittsformeln', () => {
  const standings = Scoring.computeStandings(data, excelResults());
  const fams = Scoring.computeFamilyStandings(data, standings);
  assert.equal(fams.length, 14);
  // Platz 1 hat den höchsten Durchschnitt (kein fester Name – datenabhängig)
  const maxAvg = Math.max(...fams.map((f) => f.average));
  assert.equal(fams[0].average, maxAvg, 'führende Familie hat den höchsten Schnitt');
  // Jeder Familien-Durchschnitt = Mittel der Mitglieder-Gesamtpunkte
  const byName = new Map(standings.map((r) => [r.name, r]));
  for (const f of fams) {
    const totals = f.members.map((m) => byName.get(m)).filter(Boolean).map((r) => r.totalLive);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const expected = Math.round(mean * 1000) / 1000;
    assert.ok(Math.abs(f.average - expected) < 1e-9,
      `${f.name}: Durchschnitt=${f.average}, erwartet=${expected}`);
  }
  // Liste ist absteigend nach Durchschnitt sortiert
  for (let i = 1; i < fams.length; i++) {
    assert.ok(fams[i - 1].average >= fams[i].average, 'Familien absteigend sortiert');
  }
});

test('Torjäger-Bonus über Namensvergleich', () => {
  assert.ok(Scoring.samePerson('Mbappé', 'Kylian Mbappé'));
  assert.ok(Scoring.samePerson('Mbappe', 'Kylian Mbappé'));
  assert.ok(Scoring.samePerson('Harry Kane', 'H. Kane'));
  assert.ok(!Scoring.samePerson('Kane', 'Yamal'));
});

test('canonicalScorer führt Schreibweisen auf volle Namen zusammen', () => {
  assert.equal(Scoring.canonicalScorer('Kane').name, 'Harry Kane');
  assert.equal(Scoring.canonicalScorer('Harry Kane').name, 'Harry Kane');
  assert.equal(Scoring.canonicalScorer('Mbappe').name, 'Kylian Mbappé');
  assert.equal(Scoring.canonicalScorer('Mbappé').name, 'Kylian Mbappé');
  assert.equal(Scoring.canonicalScorer('Olisé').name, 'Michael Olise');
  assert.equal(Scoring.canonicalScorer('Dembele').name, 'Ousmane Dembélé');
  assert.equal(Scoring.canonicalScorer('Yamal').team, 'Spanien');
  // unbekannte Namen bleiben unverändert
  assert.equal(Scoring.canonicalScorer('Max Mustermann').name, 'Max Mustermann');

  // alle in der Excel getippten Torjäger werden erkannt
  const tipped = new Set(data.players.map((p) => p.bonus.topscorer).filter(Boolean));
  for (const t of tipped) {
    assert.ok(Scoring.canonicalScorer(t).team,
      'kein kanonischer Eintrag für getippten Torjäger: ' + t);
  }
});
