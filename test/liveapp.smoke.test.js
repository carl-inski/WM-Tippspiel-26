/*
 * Smoke-Test der Live-App in jsdom: Rendering aller Ansichten im
 * Offline-Modus sowie Live-Modus mit gemocktem Proxy.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');

function makeApp({ proxyUrl = '', apiPayloads = null } = {}) {
  // <script src>-Tags entfernen – die Dateien werden unten als echte
  // Inline-Skripte eingefügt (geteilter globaler Scope wie im Browser,
  // deckt z. B. doppelte Top-Level-const-Deklarationen auf)
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8')
    .replace(/<script src=[^>]+><\/script>\s*/g, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/' });
  const { window } = dom;

  window.fetch = async (url) => {
    const u = String(url);
    const file = (p) => ({
      ok: true,
      json: async () => JSON.parse(fs.readFileSync(path.join(root, p), 'utf-8'))
    });
    if (u.includes('tippspiel.json')) return file('data/tippspiel.json');
    if (u.includes('manual-results.json')) return file('data/manual-results.json');
    if (apiPayloads && u.endsWith('/matches')) {
      return { ok: true, json: async () => apiPayloads.matches };
    }
    if (apiPayloads && u.endsWith('/scorers')) {
      return { ok: true, json: async () => apiPayloads.scorers };
    }
    throw new Error('Unerwarteter fetch: ' + u);
  };

  const addScript = (src) => {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(root, src), 'utf-8');
    window.document.body.appendChild(s);
  };
  ['js/icons.js', 'js/config.js', 'js/teams.js', 'js/scoring.js', 'js/api.js'].forEach(addScript);
  if (!window.Scoring || !window.Teams || !window.LiveApi || !window.Icons) {
    throw new Error('Skripte haben sich nicht global registriert (Scope-Kollision?)');
  }
  window.APP_CONFIG.proxyUrl = proxyUrl;
  window.APP_CONFIG.pollSeconds = 3600;
  addScript('js/main.js');
  return dom;
}

function waitFor(cond, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (cond()) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error('Timeout'));
      setTimeout(poll, 20);
    })();
  });
}

test('CSS: [hidden] schlägt display-Regeln (Sheet-Overlay darf Seite nicht verdecken)', () => {
  const css = fs.readFileSync(path.join(root, 'css', 'liquid.css'), 'utf-8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/,
    'globale [hidden]-Regel mit !important fehlt');
});

test('Offline-Modus: alle Ansichten rendern', async () => {
  const dom = makeApp();
  const doc = dom.window.document;
  await waitFor(() => doc.querySelectorAll('#view-spiele .match-card').length > 0);

  assert.equal(doc.querySelectorAll('#view-spiele .match-card').length, 104);
  assert.ok(doc.querySelector('.banner'), 'Offline-Banner sichtbar');
  assert.equal(doc.querySelectorAll('#view-tabelle tbody tr').length, 72);
  assert.equal(doc.querySelectorAll('#view-familien .family-card').length, 14);
  // Torjäger: Schreibweisen werden unter vollem Namen zusammengeführt
  const tj = doc.getElementById('view-torjaeger').textContent;
  assert.ok(tj.includes('Harry Kane'), 'voller Name statt "Kane"');
  assert.ok(tj.includes('Kylian Mbappé'), 'voller Name statt "Mbappé"');
  assert.ok(!tj.includes('Getippte Torjäger ohne WM-Tor'),
    'keine verwaisten Schreibweisen mehr: ' + tj.slice(0, 300));
  assert.ok(doc.querySelectorAll('#view-torjaeger .scorer-row').length >= 13);
  assert.equal(doc.getElementById('status-text').textContent, 'Offline-Modus');

  // Spiel aufklappen -> Tipps erscheinen
  doc.querySelector('#view-spiele .match-row').click();
  await waitFor(() => doc.querySelectorAll('.tip-chip').length > 0);
  // 67 von 72 haben das Eröffnungsspiel getippt
  assert.ok(doc.querySelectorAll('.tip-chip').length >= 60, 'Tipps der Tipper sichtbar');

  // Tipper-Sheet öffnen
  doc.querySelector('#view-tabelle tbody tr').click();
  assert.equal(doc.getElementById('sheet-backdrop').hidden, false);
  assert.ok(doc.querySelectorAll('.sheet-match').length > 0);

  dom.window.close(); // Timer freigeben, sonst hängt der Testprozess
});

test('Live-Modus: API-Daten fließen in Anzeige und Wertung', async () => {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'tippspiel.json'), 'utf-8'));
  // drittes Gruppenspiel (Kanada - Bosnien) läuft gerade
  const live = data.matches.find((m) => m.home === 'Kanada');
  const apiPayloads = {
    matches: {
      matches: [{
        status: 'IN_PLAY',
        stage: 'GROUP_STAGE',
        utcDate: new Date(Date.parse(live.kickoff)).toISOString(),
        homeTeam: { name: 'Canada' },
        awayTeam: { name: 'Bosnia and Herzegovina' },
        score: { duration: 'REGULAR', fullTime: { home: 2, away: 0 } }
      }]
    },
    scorers: { scorers: [
      { player: { name: 'Harry Kane' }, team: { name: 'England' }, goals: 2 }
    ] }
  };
  const dom = makeApp({ proxyUrl: 'https://proxy.example', apiPayloads });
  const doc = dom.window.document;

  await waitFor(() => doc.getElementById('status-text').textContent === 'LIVE');
  assert.ok(doc.querySelector('.live-badge'), 'LIVE-Badge sichtbar');
  assert.ok(doc.querySelector('.mscore.live'), 'Live-Spielstand sichtbar');
  assert.ok(doc.querySelectorAll('.live-delta').length > 0, 'Live-Punkte in der Tabelle');

  // Kane (2 Tore) bringt seinen Tippern 6 Punkte in der Torschützen-Ansicht
  const scorerText = doc.getElementById('view-torjaeger').textContent;
  assert.ok(scorerText.includes('Harry Kane'));
  assert.ok(scorerText.includes('+6'), 'Torjäger-Punkte angezeigt: ' + scorerText.slice(0, 200));

  dom.window.close(); // Timer freigeben, sonst hängt der Testprozess
});
