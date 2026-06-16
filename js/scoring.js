/*
 * Scoring-Engine des Tippspiels – bildet exakt die Excel-Formeln des
 * Organisators ab:
 *
 * Spieltipps:   exakt richtig  -> Wert × 1,5
 *               richtige Tendenz (Vorzeichen der Tordifferenz, inkl. beide
 *               Remis)        -> Wert × 1
 *               sonst          -> 0
 * Weltmeister:  15 Punkte
 * Torjäger:     3 Punkte pro WM-Tor des getippten Spielers
 * Elfmeterschießen (Anzahl bis einschl. Halbfinale):
 *               exakt +10, sonst −2 × Abweichung
 */
(function () {
  'use strict';


function matchPoints(tip, result, wert) {
  if (!tip || !result || wert == null) return null;
  const [th, ta] = tip;
  const { home: rh, away: ra } = result;
  if (th === rh && ta === ra) return round2(wert * 1.5);
  const tDiff = Math.sign(th - ta);
  const rDiff = Math.sign(rh - ra);
  return tDiff === rDiff ? wert : 0;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function normName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Vergleicht Spielernamen tolerant: "Mbappe" trifft "Kylian Mbappé". */
function samePerson(a, b) {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = na.split(' '), pb = nb.split(' ');
  return pa[pa.length - 1] === pb[pb.length - 1] ||
    nb.includes(na) || na.includes(nb);
}

/* Bekannte Torjäger: getippte Kurzformen -> voller Name + Team.
 * Deckt alle in der Excel getippten Spieler ab; unbekannte Namen
 * bleiben unverändert. */
const KNOWN_SCORERS = [
  ['Harry Kane', 'England'],
  ['Kylian Mbappé', 'Frankreich'],
  ['Erling Haaland', 'Norwegen'],
  ['Mikel Oyarzabal', 'Spanien'],
  ['Julián Álvarez', 'Argentinien'],
  ['Raúl Jiménez', 'Mexiko'],
  ['Ousmane Dembélé', 'Frankreich'],
  ['Crysencio Summerville', 'Niederlande'],
  ['Raphinha', 'Brasilien'],
  ['Michael Olise', 'Frankreich'],
  ['Aymen Hussein', 'Irak'],
  ['Ferran Torres', 'Spanien'],
  ['Lamine Yamal', 'Spanien']
];

/* Liefert zum getippten/gelisteten Namen den vollen Namen + Team. */
function canonicalScorer(name) {
  const n = String(name || '').trim();
  if (!n) return { name: '', team: null };
  for (const [full, team] of KNOWN_SCORERS) {
    if (samePerson(full, n)) return { name: full, team };
  }
  return { name: n, team: null };
}

/*
 * Berechnet die komplette Wertung.
 *  data:    Inhalt von data/tippspiel.json
 *  results: { [matchId]: {home, away, finished, live} } – zusammengeführte
 *           Ergebnisse (Excel + API + manuell)
 *  extras:  { championTeam, scorers: [{name, goals}], shootoutCount }
 *           – Live-Infos für die Zusatzfragen (alles optional)
 */
function computeStandings(data, results, extras = {}) {
  const rows = data.players.map((p) => {
    let matchPts = 0;
    let livePts = 0;
    let exact = 0, tendency = 0, wrong = 0;
    const perMatch = {};

    for (const m of data.matches) {
      const res = results[m.id];
      if (!res || res.home == null || res.away == null) continue;
      const pts = matchPoints(p.tips[m.id], { home: res.home, away: res.away }, m.wert);
      if (pts === null) continue;
      perMatch[m.id] = pts;
      if (res.live) {
        livePts += pts;
      } else {
        matchPts += pts;
        if (pts === 0) wrong++;
        else if (pts === m.wert) tendency++;
        else exact++;
      }
    }

    let bonusPts = 0;
    const bonusDetail = {};
    const championAnswer = extras.championTeam || data.bonus.champion.answer;
    if (championAnswer) {
      bonusDetail.champion = sameTeam(p.bonus.champion, championAnswer)
        ? data.bonus.champion.points : 0;
      bonusPts += bonusDetail.champion;
    }
    const scorers = (extras.scorers && extras.scorers.length)
      ? extras.scorers : data.manualScorers;
    // realScorers = Stand ohne Simulation; Differenz zählt als (vorläufige) Live-Punkte,
    // damit simulierte Tore wie ein laufendes Spiel als Live-Zuwachs erscheinen.
    const realScorers = (extras.realScorers && extras.realScorers.length)
      ? extras.realScorers : scorers;
    if (p.bonus.topscorer && scorers && scorers.length) {
      const ppg = data.bonus.topscorer.pointsPerGoal;
      const goalsOf = (list) => {
        const h = list.find((s) => samePerson(s.name, p.bonus.topscorer));
        return h ? h.goals : 0;
      };
      const simGoals = goalsOf(scorers);
      bonusDetail.topscorerGoals = simGoals;
      const realBonus = round2(goalsOf(realScorers) * ppg);
      bonusDetail.topscorer = realBonus;
      bonusPts += realBonus;
      const liveBonus = round2(simGoals * ppg - realBonus);
      if (liveBonus) {
        livePts += liveBonus;
        bonusDetail.topscorerLive = liveBonus;
      }
    }
    const shootouts = extras.shootoutCount != null
      ? extras.shootoutCount : data.bonus.shootouts.answer;
    if (shootouts != null && p.bonus.shootouts != null && extras.tournamentFinished) {
      bonusDetail.shootouts = p.bonus.shootouts === shootouts
        ? data.bonus.shootouts.exactPoints
        : -data.bonus.shootouts.malusPerDelta * Math.abs(p.bonus.shootouts - shootouts);
      bonusPts += bonusDetail.shootouts;
    }

    return {
      name: p.name,
      matchPoints: round2(matchPts),
      livePoints: round2(livePts),
      bonusPoints: round2(bonusPts),
      total: round2(matchPts + bonusPts),
      totalLive: round2(matchPts + bonusPts + livePts),
      exact, tendency, wrong,
      perMatch,
      bonusDetail
    };
  });

  rows.sort((a, b) => b.totalLive - a.totalLive || a.name.localeCompare(b.name, 'de'));
  let rank = 0, prev = null;
  rows.forEach((r, i) => {
    if (prev === null || r.totalLive < prev) { rank = i + 1; prev = r.totalLive; }
    r.rank = rank;
  });

  // Basis-Rang OHNE Live-/Simulationspunkte (Stand "als wäre kein Spiel live").
  // Differenz daraus = wie viele Plätze ein laufendes/simuliertes Spiel bewegt.
  const byBase = rows.slice()
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'de'));
  let brank = 0, bprev = null;
  byBase.forEach((r, i) => {
    if (bprev === null || r.total < bprev) { brank = i + 1; bprev = r.total; }
    r.baseRank = brank;
  });
  // Positiv = nach oben geklettert (kleinere Platzzahl), negativ = abgerutscht.
  rows.forEach((r) => { r.rankDelta = r.baseRank - r.rank; });

  return rows;
}

function sameTeam(a, b) {
  return normName(a) === normName(b);
}

/* Familienwertung: Durchschnitt der Gesamtpunkte der Mitglieder. */
function computeFamilyStandings(data, standings) {
  const byName = new Map(standings.map((r) => [r.name, r]));
  const rows = data.families.map((f) => {
    const members = f.members.map((m) => byName.get(m)).filter(Boolean);
    const sum = members.reduce((s, r) => s + r.totalLive, 0);
    return {
      name: f.name,
      members: f.members,
      memberCount: members.length,
      average: members.length ? Math.round((sum / members.length) * 1000) / 1000 : 0
    };
  });
  rows.sort((a, b) => b.average - a.average || a.name.localeCompare(b.name, 'de'));
  let rank = 0, prev = null;
  rows.forEach((r, i) => {
    if (prev === null || r.average < prev) { rank = i + 1; prev = r.average; }
    r.rank = rank;
  });
  return rows;
}

/* Ergebnisse aus Excel-Stand, manueller Pflege und Live-API zusammenführen.
 * Spätere Quellen überschreiben frühere. */
function mergeResults(...sources) {
  const out = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [id, res] of Object.entries(src)) {
      if (res && res.home != null && res.away != null) out[id] = res;
    }
  }
  return out;
}

const api = { matchPoints, computeStandings, computeFamilyStandings, mergeResults, samePerson, normName, round2, canonicalScorer };

if (typeof module === 'object' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.Scoring = api;

})();
