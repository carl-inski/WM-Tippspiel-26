/*
 * Baut data/scorers.json – die WM-Torschützenliste, die die Web-App anzeigt.
 *
 * Zwei freie, schlüssellose Quellen, per Personen-Abgleich zusammengeführt:
 *  1) fussballdaten.de/wm/tore/ : aktuelle Führende (2+ Tore), server-seitig
 *     gerendert, volle deutsche Namen + Flaggen. Sehr aktuell.
 *  2) football-data.org (über unseren Worker /scorers) : die KOMPLETTE Liste
 *     inkl. aller 1-Tor-Schützen. Hängt gelegentlich etwas nach.
 *
 * Merge: fussballdaten gewinnt (aktueller); aus der football-data-Liste werden
 * nur Spieler ergänzt, die noch fehlen (i. d. R. die 1-Tor-Schützen). So ist die
 * Liste aktuell UND vollständig – ohne API-Key, ohne Kontingent, ohne Dubletten.
 *
 * Aufruf:  node tools/build-scorers.js
 * Robust: schlägt fussballdaten fehl, bleibt data/scorers.json unverändert.
 */
const fs = require('fs');
const path = require('path');
const Teams = require('../js/teams.js');
const Scoring = require('../js/scoring.js');

const FD_SRC = 'https://www.fussballdaten.de/wm/tore/';
const SCORERS_API = 'https://wm-tippspiel-proxy.f655fr7vs6.workers.dev/scorers';
const OUT = path.join(__dirname, '..', 'data', 'scorers.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const ENTITIES = {
  '&amp;': '&', '&quot;': '"', '&#039;': "'", '&apos;': "'", '&eacute;': 'é',
  '&egrave;': 'è', '&uuml;': 'ü', '&ouml;': 'ö', '&auml;': 'ä', '&szlig;': 'ß',
  '&ntilde;': 'ñ', '&ccedil;': 'ç'
};
const decode = (s) => String(s || '').replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] || m).trim();

/* Nur die 2026-Tabelle parsen – NICHT die "Ewige Torschützenliste" darunter. */
function parseFussballdaten(html) {
  const cut = html.indexOf('Ewige Torschützenliste');
  const tbl = cut > 0 ? html.slice(0, cut) : html;
  const out = [];
  for (const r of tbl.split('<tr class="tr-item"').slice(1)) {
    const block = r.slice(0, 1500);
    const name = block.match(/<a class="table-link"[^>]*>([^<]+)<\/a>/);
    const team = block.match(/flag-icon-[a-z]+"\s+title="([^"]+)"/i);
    const goals = block.match(/<td class="text-center"><span>(\d+)<\/span><\/td>/);
    if (name && goals) {
      out.push({ name: decode(name[1]), teamDE: team ? decode(team[1]) : null, goals: parseInt(goals[1], 10) });
    }
  }
  return out;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' für ' + url);
  return r.json();
}

(async () => {
  const html = await (await fetch(FD_SRC, { headers: { 'User-Agent': UA, 'accept-language': 'de' } })).text();
  const fd = parseFussballdaten(html);
  if (!fd.length) { console.error('fussballdaten: 0 Treffer – data/scorers.json bleibt unverändert.'); process.exit(1); }

  // Kompletten "Tail" (inkl. 1-Tor-Schützen) aus football-data ergänzen.
  let tail = [];
  try {
    const api = await fetchJson(SCORERS_API);
    tail = (api.scorers || []).map((s) => ({
      name: (s.player && s.player.name) || '?',
      teamDE: Teams.toGermanName((s.team && s.team.name) || '') || (s.team && s.team.name) || null,
      goals: s.goals || 0
    }));
  } catch (e) { console.error('football-data-Tail nicht erreichbar:', e.message); }

  const merged = fd.map((s) => Object.assign({}, s));
  for (const t of tail) {
    if (!t.name || t.name === '?') continue;
    if (merged.some((r) => Scoring.samePerson(r.name, t.name))) continue; // fussballdaten gewinnt
    merged.push(t);
  }
  merged.sort((a, b) => b.goals - a.goals || String(a.name).localeCompare(b.name, 'de'));

  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'fussballdaten.de + football-data.org',
    count: merged.length,
    scorers: merged
  }, null, 1));
  console.log('Torschützen: ' + merged.length + ' (fussballdaten ' + fd.length +
    ' + football-data-Tail ' + (merged.length - fd.length) + ') | Top: ' +
    merged.slice(0, 5).map((s) => s.name + ' ' + s.goals).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
