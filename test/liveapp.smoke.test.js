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

function makeApp({ proxyUrl = '', apiPayloads = null, seedSnapshot = null, tippspiel = null } = {}) {
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
    if (u.includes('tippspiel.json')) {
      return tippspiel ? { ok: true, json: async () => tippspiel } : file('data/tippspiel.json');
    }
    if (u.includes('manual-results.json')) return file('data/manual-results.json');
    if (u.includes('scorer-overrides.json')) return { ok: true, json: async () => ({ overrides: {} }) };
    if (u.includes('result-overrides.json')) return { ok: true, json: async () => ({ results: {} }) };
    if (u.includes('scorers.json')) return { ok: true, json: async () => ({ scorers: [] }) };
    if (u.includes('fixture-overrides.json')) return { ok: true, json: async () => ({ fixtures: {} }) };
    if (u.includes('penalty-results.json')) return { ok: true, json: async () => ({ results: {} }) };
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
  // ggf. einen (alten) lokalen Schnappschuss vorab ablegen
  if (seedSnapshot) {
    try { window.localStorage.setItem('wm26-live-snapshot-v1', JSON.stringify(seedSnapshot)); }
    catch (e) { /* egal */ }
  }
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

test('Siegerehrung: Podest + persönliche Statistiken', async () => {
  const dom = makeApp();
  const doc = dom.window.document;
  await waitFor(() => doc.querySelectorAll('#view-spiele .match-card').length > 0);

  // Turnier ist durch -> Siegerehrung öffnet automatisch beim ersten Besuch
  await waitFor(() => doc.getElementById('celebrate-backdrop').hidden === false);
  assert.equal(doc.querySelector('.celebrate-winner').textContent, 'Emma H',
    'Gesamtsiegerin im Kopf der Siegerehrung');
  // Zwei Treppchen (Einzel- + Familienwertung) mit je 3 Plätzen
  assert.equal(doc.querySelectorAll('.podium-block').length, 2);
  assert.equal(doc.querySelectorAll('.podium-step').length, 6);
  const podiumTxt = doc.querySelector('.celebrate').textContent;
  assert.ok(podiumTxt.includes('Tanja') && podiumTxt.includes('Jochen'), 'Plätze 2 und 3 einzeln');
  assert.ok(podiumTxt.includes('Caspary'), 'Familien-Sieger im Treppchen');
  assert.ok(podiumTxt.includes('Basti'), 'Dank an den Organisator');

  // Zu den Statistiken wechseln und einen Namen wählen
  doc.querySelector('.celebrate-btn.primary').click();
  await waitFor(() => doc.querySelector('.stats-input'));
  const chips = [...doc.querySelectorAll('.stats-namechip')];
  const emma = chips.find((c) => c.textContent === 'Emma H');
  assert.ok(emma, 'Namensliste enthält Emma H');
  emma.click();
  await waitFor(() => doc.querySelector('.stats-name'));
  assert.equal(doc.querySelector('.stats-name').textContent, 'Emma H');
  assert.ok(doc.querySelector('.stats-rank').textContent.includes('#1'), 'Platz 1 in den Stats');
  assert.ok(doc.querySelectorAll('.stat-tile').length >= 6, 'Kennzahlen-Kacheln vorhanden');
  assert.ok(doc.querySelector('.stats-outro').textContent.includes('Basti'),
    'Abschluss dankt Basti');

  // Overlay lässt sich schließen
  doc.querySelector('.celebrate-close').click();
  assert.equal(doc.getElementById('celebrate-backdrop').hidden, true);

  dom.window.close();
});

test('Simulation: manueller Live-Stand bewegt Wertung und Rangliste', async () => {
  const dom = makeApp();
  const doc = dom.window.document;
  await waitFor(() => doc.querySelectorAll('#view-spiele .match-card').length > 0);

  // Erstes Spiel aufklappen -> Simulator erscheint
  doc.querySelector('#view-spiele .match-row').click();
  await waitFor(() => doc.querySelector('.sim-box'));
  const steps = doc.querySelectorAll('.sim-box .sim-step');
  assert.ok(steps.length >= 4, 'Stepper für beide Teams vorhanden');

  // Heim-Tor simulieren (Reihenfolge: heim −, heim +, gast −, gast +)
  steps[1].click();
  await waitFor(() => doc.querySelector('.sim-banner'));
  assert.ok(doc.querySelector('.mscore.sim'), 'Spielstand als simuliert markiert');
  assert.ok(doc.querySelector('.sim-badge'), 'SIMULIERT-Badge sichtbar');
  // Rangliste zeigt jetzt Live-Punkte und Platzveränderungen
  assert.ok(doc.querySelectorAll('#view-tabelle .live-delta').length > 0, 'Live-Punkte in Tabelle');
  assert.ok(doc.querySelectorAll('#view-tabelle .rank-delta').length > 0, 'Platz-Indikator sichtbar');

  // Zurücksetzen räumt die Simulation wieder ab
  doc.querySelector('.sim-banner .sim-reset').click();
  await waitFor(() => !doc.querySelector('.sim-banner'));
  assert.equal(doc.querySelectorAll('.mscore.sim').length, 0, 'keine Simulation mehr aktiv');

  dom.window.close();
});

test('Simulation: auch ein zukünftiges Spiel lässt sich simulieren', async () => {
  // Das reale Turnier ist abgeschlossen (kein offenes Spiel mehr). Für diesen
  // Test das Ergebnis des letzten Spiels entfernen, damit es wieder ein
  // kommendes Spiel gibt, das sich simulieren lässt.
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'tippspiel.json'), 'utf-8'));
  for (let i = data.matches.length - 1; i >= 0; i--) {
    if (data.matches[i].result) { data.matches[i].result = null; break; }
  }
  const dom = makeApp({ tippspiel: data });
  const doc = dom.window.document;
  await waitFor(() => doc.querySelectorAll('#view-spiele .match-card').length > 0);

  // ein noch nicht gespieltes Spiel (Anzeige "– : –") aufklappen
  const upcoming = [...doc.querySelectorAll('#view-spiele .match-card')]
    .find((c) => c.querySelector('.mscore.upcoming'));
  assert.ok(upcoming, 'es gibt ein kommendes Spiel');
  upcoming.querySelector('.match-row').click();
  await waitFor(() => doc.querySelector('.sim-box'));
  assert.ok(doc.querySelector('.sim-box .sim-title').textContent.includes('Spielstand simulieren'),
    'Titel für kommendes Spiel');

  // Tor simulieren -> Spiel wird als SIMULIERT geführt
  doc.querySelectorAll('.sim-box .sim-step')[1].click();
  await waitFor(() => doc.querySelector('.mscore.sim'));
  assert.ok(doc.querySelector('.sim-badge'), 'SIMULIERT-Badge am kommenden Spiel');

  dom.window.close();
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

test('Live-first: frische API-Daten gewinnen über einen alten Cache', async () => {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'tippspiel.json'), 'utf-8'));
  const live = data.matches.find((m) => m.home === 'Kanada');
  const utc = new Date(Date.parse(live.kickoff)).toISOString();
  // alter Snapshot: gleiches Spiel mit veraltetem Stand 5:5
  const seedSnapshot = {
    ts: Date.now() - 3600 * 1000,
    apiMatches: [{
      status: 'IN_PLAY', stage: 'GROUP_STAGE', utcDate: utc,
      homeTeam: { name: 'Canada' }, awayTeam: { name: 'Bosnia and Herzegovina' },
      score: { duration: 'REGULAR', fullTime: { home: 5, away: 5 } }
    }],
    apiScorers: []
  };
  // frische API liefert 2:0
  const apiPayloads = {
    matches: { matches: [{
      status: 'IN_PLAY', stage: 'GROUP_STAGE', utcDate: utc,
      homeTeam: { name: 'Canada' }, awayTeam: { name: 'Bosnia and Herzegovina' },
      score: { duration: 'REGULAR', fullTime: { home: 2, away: 0 } }
    }] },
    scorers: { scorers: [] }
  };
  const dom = makeApp({ proxyUrl: 'https://proxy.example', apiPayloads, seedSnapshot });
  const doc = dom.window.document;

  await waitFor(() => doc.getElementById('status-text').textContent === 'LIVE');
  const liveScore = doc.querySelector('.mscore.live').textContent;
  assert.ok(liveScore.includes('2 : 0'), 'frischer Live-Stand 2:0 statt Cache 5:5: ' + liveScore);
  assert.ok(!liveScore.includes('5 : 5'), 'alter Cache-Stand darf nicht erscheinen');

  dom.window.close();
});

test('Cache-Fallback: gespeicherter Stand bleibt bei API-Störung erhalten', async () => {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'tippspiel.json'), 'utf-8'));
  const live = data.matches.find((m) => m.home === 'Kanada');
  const apiPayloads = {
    matches: { matches: [{
      status: 'IN_PLAY', stage: 'GROUP_STAGE',
      utcDate: new Date(Date.parse(live.kickoff)).toISOString(),
      homeTeam: { name: 'Canada' }, awayTeam: { name: 'Bosnia and Herzegovina' },
      score: { duration: 'REGULAR', fullTime: { home: 2, away: 0 } }
    }] },
    scorers: { scorers: [{ player: { name: 'Harry Kane' }, team: { name: 'England' }, goals: 2 }] }
  };
  const dom = makeApp({ proxyUrl: 'https://proxy.example', apiPayloads });
  const doc = dom.window.document;

  await waitFor(() => doc.getElementById('status-text').textContent === 'LIVE');
  assert.ok(doc.querySelectorAll('.live-delta').length > 0, 'Live-Punkte zunächst da');
  assert.ok(dom.window.localStorage.getItem('wm26-live-snapshot-v1'), 'Snapshot gespeichert');

  // API fällt aus -> erneuter Abruf (Klick auf Status) schlägt fehl
  dom.window.fetch = async () => { throw new Error('API down'); };
  doc.querySelector('.topbar-status').click();

  await waitFor(() => doc.getElementById('status-text').textContent.includes('gespeichert'));
  assert.ok(doc.querySelector('.status-dot.stale'), 'Status-Punkt zeigt gespeicherten Stand');
  // Daten bleiben erhalten statt auf die Excel zurückzufallen
  assert.ok(doc.querySelectorAll('.live-delta').length > 0, 'Live-Punkte bleiben nach Störung');
  assert.ok(doc.querySelector('.mscore.live'), 'Live-Spielstand bleibt sichtbar');

  dom.window.close();
});
