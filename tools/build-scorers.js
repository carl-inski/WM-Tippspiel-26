/*
 * Baut data/scorers.json (akkurate WM-Torschützenliste) aus Highlightly-
 * Match-Events – football-datas /scorers-Aggregat ist unzuverlässig/lückenhaft.
 *
 * Aufruf:  HIGHLIGHTLY_API_KEY=... node tools/build-scorers.js
 * Optional: BUILD_BUDGET=30  (max. Detail-Abrufe pro Lauf – schont 100/Tag-Limit)
 *
 * Inkrementell & resümierbar: bereits erfasste Spiele (in _matches) werden
 * übersprungen; nach jedem Spiel wird gespeichert. Mehrere Läufe (an Folgetagen,
 * frisches Kontingent) vervollständigen die Liste; neue beendete Spiele kommen
 * automatisch dazu.
 */
const fs = require('fs');
const path = require('path');
const Teams = require('../js/teams.js');

const KEY = process.env.HIGHLIGHTLY_API_KEY;
const LEAGUE = '1635'; // FIFA World Cup 2026
const BASE = 'https://soccer.highlightly.net';
const BUDGET = parseInt(process.env.BUILD_BUDGET || '30', 10);
const OUT = path.join(__dirname, '..', 'data', 'scorers.json');

async function hl(p) {
  const r = await fetch(BASE + p, { headers: { 'X-RapidAPI-Key': KEY } });
  if (!r.ok) throw new Error('Highlightly HTTP ' + r.status + ' für ' + p);
  return r.json();
}

/* Zählt nur erzielte Tore (inkl. verwandelter Elfmeter), keine Eigentore. */
function isGoal(ev) {
  const t = String(ev.type || '').toLowerCase();
  if (t.includes('own')) return false;
  if (t.includes('miss')) return false;
  return t === 'goal' || t === 'penalty';
}

function detailOf(j) {
  if (Array.isArray(j)) return j[0];
  if (j && j.data) return Array.isArray(j.data) ? j.data[0] : j.data;
  return j;
}

/* Aggregiert die gespeicherten Match-Tore zur sortierten Schützenliste. */
function rebuild(store) {
  const byKey = new Map();
  for (const id of Object.keys(store._matches)) {
    for (const g of store._matches[id].goals) {
      const key = (g.player || '?') + '|' + (g.teamDE || '');
      const cur = byKey.get(key) || { name: g.player, teamDE: g.teamDE || null, goals: 0 };
      cur.goals++;
      byKey.set(key, cur);
    }
  }
  const scorers = [...byKey.values()]
    .sort((a, b) => b.goals - a.goals || String(a.name).localeCompare(b.name));
  return {
    generatedAt: new Date().toISOString(),
    source: 'highlightly-events',
    count: scorers.length,
    scorers,
    _matches: store._matches
  };
}

(async () => {
  if (!KEY) { console.error('HIGHLIGHTLY_API_KEY fehlt'); process.exit(1); }

  let store = { _matches: {} };
  try { store = JSON.parse(fs.readFileSync(OUT, 'utf8')); store._matches = store._matches || {}; }
  catch (e) { /* erster Lauf */ }

  const list = (await hl('/matches?leagueId=' + LEAGUE + '&limit=100&season=2026')).data || [];
  const finished = list
    .filter((m) => String(m.state && m.state.description).toLowerCase() === 'finished')
    .sort((a, b) => String(a.date).localeCompare(String(b.date))); // älteste zuerst

  let calls = 0, added = 0;
  for (const m of finished) {
    const id = String(m.id);
    if (store._matches[id]) continue;        // schon erfasst
    if (calls >= BUDGET) break;
    let md;
    try { md = detailOf(await hl('/matches/' + id)); calls++; }
    catch (e) { console.error('  übersprungen', id, e.message); continue; }
    const goals = (md.events || []).filter(isGoal).map((ev) => ({
      player: ev.player || '?',
      teamDE: Teams.toGermanName((ev.team && ev.team.name) || '') || (ev.team && ev.team.name) || null
    }));
    store._matches[id] = {
      date: m.date,
      home: m.homeTeam && m.homeTeam.name,
      away: m.awayTeam && m.awayTeam.name,
      goals
    };
    added++;
    fs.writeFileSync(OUT, JSON.stringify(rebuild(store), null, 1)); // resümierbar
  }

  const out = rebuild(store);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('Detail-Abrufe: ' + calls + ' | neue Spiele: ' + added +
    ' | erfasst gesamt: ' + Object.keys(store._matches).length + '/' + finished.length +
    ' | Torschützen: ' + out.count);
})().catch((e) => { console.error(e); process.exit(1); });
