/*
 * Baut data/penalty-results.json – die korrekten Endstände von K.o.-Spielen,
 * die im Elfmeterschießen entschieden wurden (Reguläres + Elfmeter).
 *
 * Warum? football-data ist bei Elferspielen unzuverlässig (falscher fullTime,
 * kaputtes Elfer-Feld). fussballdaten.de zeigt sie server-seitig und korrekt
 * als "<Elfer> n.E. <Reguläres>" (z. B. "2:3 n.E. 1:1" -> Endstand 3:4) –
 * keylos, ohne Kontingent. Ein Abruf = alle Elferspiele.
 *
 * Aufruf:  node tools/build-penalties.js
 * Merge-only & robust: bereits gepinnte Ergebnisse bleiben erhalten; bei
 * Abruf-/Parse-Fehler bleibt data/penalty-results.json unverändert.
 */
const fs = require('fs');
const path = require('path');

const SRC = 'https://www.fussballdaten.de/wm/spielplan/';
const OUT = path.join(__dirname, '..', 'data', 'penalty-results.json');
const DATA = path.join(__dirname, '..', 'data', 'tippspiel.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const ENTITIES = { '&amp;': '&', '&uuml;': 'ü', '&ouml;': 'ö', '&auml;': 'ä', '&szlig;': 'ß' };
const decode = (s) => String(s || '').replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] || m).trim();
const norm = (s) => decode(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
function teamEq(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a));
}

/* Liest aus dem Spielplan alle Elferspiele: [{ home, away, result }]. */
function parsePenalties(html) {
  const out = [];
  for (const row of html.split('spiele-row').slice(1)) {
    const block = row.slice(0, 2000);
    // "<span id="sNN">SO_h:SO_a<span class="tiny">n.E.</span></span><span>REG_h:REG_a</span>"
    const m = block.match(/<span id="s\d+">(\d+):(\d+)<span class="tiny">n\.E\.<\/span><\/span><span>(\d+):(\d+)<\/span>/);
    if (!m) continue;
    const teams = [...block.matchAll(/title="Details zu ([^"]+)"/g)].map((x) => decode(x[1]));
    if (teams.length < 2) continue;
    out.push({
      home: teams[0], away: teams[1],
      result: { home: +m[3] + +m[1], away: +m[4] + +m[2] } // Reguläres + Elfmeter
    });
  }
  return out;
}

(async () => {
  const resp = await fetch(SRC, { headers: { 'User-Agent': UA, 'accept-language': 'de' } });
  if (!resp.ok) throw new Error('fussballdaten HTTP ' + resp.status);
  const pens = parsePenalties(await resp.text());

  const ko = (JSON.parse(fs.readFileSync(DATA, 'utf8')).matches || [])
    .filter((m) => !/grupp/i.test(m.round || '') && m.home && m.away);

  let store = { results: {} };
  try { store = JSON.parse(fs.readFileSync(OUT, 'utf8')); store.results = store.results || {}; } catch (e) {}

  let changed = 0;
  for (const p of pens) {
    let m = ko.find((x) => teamEq(x.home, p.home) && teamEq(x.away, p.away));
    let res = p.result;
    if (!m) { // andere Heim/Gast-Reihenfolge -> Ergebnis spiegeln
      m = ko.find((x) => teamEq(x.home, p.away) && teamEq(x.away, p.home));
      if (m) res = { home: p.result.away, away: p.result.home };
    }
    if (!m) continue;
    const cur = store.results[m.id];
    if (!cur || cur.home !== res.home || cur.away !== res.away) { store.results[m.id] = res; changed++; }
  }

  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'fussballdaten.de (n.E.)',
    count: Object.keys(store.results).length,
    results: store.results
  }, null, 1));
  console.log('Elfer-Endstände gepinnt: ' + Object.keys(store.results).length + ' (neu/aktualisiert: ' + changed + ')');
})().catch((e) => { console.error(e); process.exit(1); });
