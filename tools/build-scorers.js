/*
 * Baut data/scorers.json – die WM-Torschützenliste, die die Web-App anzeigt.
 *
 * Zwei Quellen, zusammengeführt:
 *  1) fussballdaten.de/wm/tore/ : aktuelle Führende (2+ Tore), server-seitig
 *     gerendert, vollständige deutsche Namen + Flaggen, ohne API-Key/Kontingent.
 *  2) data/scorers-events.json  : der 1-Tor-"Tail" aus Highlightly-Events
 *     (fussballdaten listet keine 1-Tor-Schützen). Optional – falls vorhanden.
 *
 * Merge per Personen-Abgleich (Scoring.samePerson): fussballdaten gewinnt
 * (aktueller, voller Name); aus dem Tail werden nur Spieler ergänzt, die dort
 * noch nicht stehen. So ist die Liste aktuell UND vollständig, ohne Dubletten.
 *
 * Aufruf:  node tools/build-scorers.js
 * Robust: bei Abruf-/Parse-Fehler bleibt data/scorers.json unverändert.
 */
const fs = require('fs');
const path = require('path');
const Scoring = require('../js/scoring.js');

const SRC = 'https://www.fussballdaten.de/wm/tore/';
const OUT = path.join(__dirname, '..', 'data', 'scorers.json');
const EVENTS = path.join(__dirname, '..', 'data', 'scorers-events.json');
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

(async () => {
  const resp = await fetch(SRC, { headers: { 'User-Agent': UA, 'accept-language': 'de' } });
  if (!resp.ok) throw new Error('fussballdaten HTTP ' + resp.status);
  const fd = parseFussballdaten(await resp.text());
  if (!fd.length) { console.error('fussballdaten: 0 Treffer – data/scorers.json bleibt unverändert.'); process.exit(1); }

  // 1-Tor-Tail aus Highlightly-Events ergänzen (Personen-Abgleich, fd gewinnt)
  let tail = [];
  try { tail = (JSON.parse(fs.readFileSync(EVENTS, 'utf8')).scorers) || []; } catch (e) {}
  const merged = fd.map((s) => Object.assign({}, s));
  for (const e of tail) {
    if (!e || !e.name) continue;
    if (merged.some((r) => Scoring.samePerson(r.name, e.name))) continue; // schon dabei
    merged.push({ name: e.name, teamDE: e.teamDE || null, goals: e.goals || 0 });
  }
  merged.sort((a, b) => b.goals - a.goals || String(a.name).localeCompare(b.name, 'de'));

  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'fussballdaten.de + highlightly-events',
    count: merged.length,
    scorers: merged
  }, null, 1));
  console.log('Torschützen: ' + merged.length + ' (fd ' + fd.length + ' + tail ' +
    (merged.length - fd.length) + ') | Top: ' +
    merged.slice(0, 5).map((s) => s.name + ' ' + s.goals).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
