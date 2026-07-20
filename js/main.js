/* WM 2026 Familien-Tippspiel – Live-App */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const state = {
    data: null,          // data/tippspiel.json
    manual: {},          // data/manual-results.json -> results
    apiState: null,      // { results, matchInfo, extras } von der Live-API
    results: {},         // zusammengeführt
    standings: [],
    families: [],
    openMatch: null,
    tab: 'spiele',
    lastUpdate: null,
    apiError: null,
    sim: {},             // { matchId: {home, away} } – manuell simulierte Live-Stände
    simGoals: {},        // { kanonischerName: +n } – simulierte WM-Tore (Torjäger)
    // Manuell gesetzte Zusatzfragen-Ergebnisse (Bonus-Tab): Weltmeister-Team
    // und Anzahl Elfmeterschießen. Fließen sofort in die Wertung ein.
    bonusSet: { champion: null, shootouts: null },
    bonusDraft: null,        // Stepper-Wert (Elfer), noch nicht angewendet
    scorersExpanded: false   // volle WM-Torschützenliste ausgeklappt?
  };
  const BONUS_KEY = 'wm26-bonus-set';

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const fmtPts = (x) => (Math.round(x * 100) / 100).toLocaleString('de-DE');
  const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  function ballPlaceholder() {
    const ph = el('span', 'flag placeholder-flag');
    ph.appendChild(window.Icons.node('ball'));
    return ph;
  }

  function flagImg(team) {
    const info = window.Teams.TEAMS[team];
    if (!info) return ballPlaceholder();
    const img = el('img', 'flag');
    img.src = 'https://flagcdn.com/w40/' + info.flag + '.png';
    img.srcset = 'https://flagcdn.com/w80/' + info.flag + '.png 2x';
    img.alt = team;
    img.loading = 'lazy';
    return img;
  }

  // ------------------------------------------------------------------ Daten --

  async function loadStatic() {
    // Cache-Buster an die Daten-Fetches, damit aktualisierte Excel-Importe
    // (neue Ergebnisse/Tipps) zuverlässig beim Nutzer ankommen.
    const cb = '?v=' + (CFG.version || Date.now());
    const [data, manual, scorerOv, resultOv, scorersFile, fixtureOv, penaltyRes] = await Promise.all([
      fetch('data/tippspiel.json' + cb).then((r) => {
        if (!r.ok) throw new Error('data/tippspiel.json nicht erreichbar (HTTP ' + r.status + ')');
        return r.json();
      }),
      fetch('data/manual-results.json' + cb).then((r) => r.json()).catch(() => ({ results: {} })),
      fetch('data/scorer-overrides.json' + cb).then((r) => r.json()).catch(() => ({ overrides: {} })),
      fetch('data/result-overrides.json?t=' + Math.floor(Date.now() / 300000)).then((r) => r.json()).catch(() => ({ results: {} })),
      // zeitbasierter Cache-Buster (5-Min-Granularität): wird per GitHub Action
      // laufend aktualisiert und soll ohne App-Versionssprung ankommen
      fetch('data/scorers.json?t=' + Math.floor(Date.now() / 300000)).then((r) => r.json()).catch(() => ({ scorers: [] })),
      // zeitbasierter Cache-Buster: Bracket-Updates (R16, VF …) sollen ohne
      // App-Versionssprung ankommen
      fetch('data/fixture-overrides.json?t=' + Math.floor(Date.now() / 300000)).then((r) => r.json()).catch(() => ({ fixtures: {} })),
      // automatisch gepinnte Elfer-Endstände (fussballdaten), zeitbasiert
      fetch('data/penalty-results.json?t=' + Math.floor(Date.now() / 300000)).then((r) => r.json()).catch(() => ({ results: {} }))
    ]);
    state.data = data;
    // Original-Spielwert sichern (für die USA-0,2-Regel, idempotent).
    state.data.matches.forEach((m) => { m._wert0 = m.wert; });
    state.manual = manual.results || {};
    // Paarungs-Override für K.o.-Spiele, deren Gegner im Feed noch fehlt.
    state.fixtureOverrides = (fixtureOv && fixtureOv.fixtures) || {};
    // Akkurate Torschützenliste aus Highlightly-Events (football-datas Aggregat
    // ist lückenhaft). Wird – wenn vorhanden – als Primärquelle genutzt.
    state.hlScorers = (scorersFile && scorersFile.scorers) || [];
    // Die vom Organisator in der Excel gepflegte Torschützenliste ist die
    // offizielle (End-)Quelle. Roh sichern, bevor sie unten mit den kuratierten
    // Live-Daten zusammengeführt wird – so bleibt der Excel-Stand als Untergrenze
    // erhalten (z. B. Mbappé 10 laut Excel schlägt ein nachhängendes Aggregat 8).
    state.excelScorers = (state.data.manualScorers || []).map((s) => Object.assign({}, s));
    // Korrekturen für Torschützen (Floor) – nie unter den echten Stand.
    state.scorerOverrides = (scorerOv && scorerOv.overrides) || {};
    state.data.manualScorers = bestScorers(null, state.data.manualScorers);
    // Ergebnis-Korrekturen: gewinnen über BEIDE APIs (football-data + Highlightly),
    // falls eine Quelle ein falsches Endergebnis liefert.
    state.resultOverrides = {};
    for (const [id, sc] of Object.entries((resultOv && resultOv.results) || {})) {
      if (sc && sc.home != null && sc.away != null) {
        state.resultOverrides[id] = { home: sc.home, away: sc.away, finished: true };
      }
    }
    // Automatisch gepinnte Elfer-Endstände (fussballdaten) – gewinnen über die
    // unzuverlässige API, weichen aber manuellen Ergebnis-Korrekturen.
    state.penaltyResults = {};
    for (const [id, sc] of Object.entries((penaltyRes && penaltyRes.results) || {})) {
      if (sc && sc.home != null && sc.away != null) {
        state.penaltyResults[id] = { home: sc.home, away: sc.away, finished: true };
      }
    }
    // Lokal gesetzte Bonus-Antworten (Weltmeister/Elfer) wiederherstellen
    loadBonusSet();
  }

  /* Effektive Torschützenliste: kuratierte Basis (fussballdaten + football-data
     aus data/scorers.json, volle Namen) PLUS die Live-Torschützen von
     football-data (über den Worker, alle 20–60 s) – so erscheinen neue Tore in
     Echtzeit, nicht erst beim nächsten Action-Lauf. Höchster Stand je Person
     gewinnt; Korrekturen (Floor) zuletzt. */
  function bestScorers(apiScorers, fallbackManual) {
    const curated = (state.hlScorers && state.hlScorers.length)
      ? state.hlScorers
      : (fallbackManual || state.data.manualScorers || []);
    let merged = mergeScorerLists(curated, apiScorers || []);
    // Offizielle Excel-Torschützen als Untergrenze einmischen (höchster Stand je
    // Spieler gewinnt) – damit der finale, vom Organisator gepflegte Stand nicht
    // von einem nachhängenden Live-Aggregat unterboten wird.
    if (state.excelScorers && state.excelScorers.length) {
      merged = mergeScorerLists(merged, state.excelScorers);
    }
    return applyScorerOverrides(merged);
  }

  /* Führt zwei Schützenlisten zusammen (Personen-Abgleich, Max je Person). */
  function mergeScorerLists(base, extra) {
    const out = (base || []).map((s) => Object.assign({}, s));
    for (const e of (extra || [])) {
      if (!e || !e.name) continue;
      const g = e.goals || 0;
      const i = out.findIndex((r) => window.Scoring.samePerson(r.name, e.name));
      if (i >= 0) { if (g > (out[i].goals || 0)) out[i].goals = g; }
      else out.push({ name: e.name, goals: g, teamDE: e.teamDE || null, crest: e.crest || null });
    }
    return out;
  }

  /* Hebt einzelne Torschützen auf einen Mindest-Torstand an (Quelle hängt
     gelegentlich nach). Floor-Logik: nie unter den echten Stand, nie über
     einen höheren echten Stand. */
  function applyScorerOverrides(scorers) {
    const ov = state.scorerOverrides;
    if (!ov || !Object.keys(ov).length) return scorers || [];
    const canon = window.Scoring.canonicalScorer;
    const out = (scorers || []).map((s) => Object.assign({}, s));
    const idx = new Map();
    out.forEach((s, i) => idx.set(canon(s.name).name, i));
    for (const [name, min] of Object.entries(ov)) {
      const c = canon(name);
      if (idx.has(c.name)) {
        const s = out[idx.get(c.name)];
        if ((s.goals || 0) < min) s.goals = min;
      } else {
        out.push({ name: c.name, goals: min, teamDE: c.team, crest: null });
      }
    }
    return out;
  }

  function excelResults() {
    const res = {};
    for (const m of state.data.matches) {
      if (m.result) res[m.id] = { home: m.result.home, away: m.result.away, finished: true };
    }
    return res;
  }

  /* Sonderregel des Organisators: Spiele mit USA-Beteiligung zählen nur 0,2 –
     gilt auch für K.o.-Runden (Slot-Wert wird je nach Gegner überschrieben).
     Greift dynamisch über die effektiven Teams (inkl. Paarungs-Override/API). */
  function isUSA(name) {
    const n = String(name || '').toLowerCase();
    return n === 'usa' || n.includes('vereinigte staaten') || n.includes('united states');
  }
  function applyWertRules() {
    for (const m of state.data.matches) {
      const base = (m._wert0 != null) ? m._wert0 : m.wert;
      const t = teamsOf(m);
      m.wert = (isUSA(t.home) || isUSA(t.away)) ? 0.2 : base;
    }
  }

  function recompute() {
    applyWertRules();
    const apiResults = state.apiState ? state.apiState.results : null;
    // Reihenfolge = Priorität (später gewinnt): Excel < manuell < API <
    // Elfer-Endstände (auto) < Ergebnis-Korrektur (manuell) < Simulation.
    state.results = window.Scoring.mergeResults(
      excelResults(), state.manual, apiResults,
      state.penaltyResults, state.resultOverrides, simResults());
    state.standings = window.Scoring.computeStandings(
      state.data, state.results, simulatedExtras());
    state.families = window.Scoring.computeFamilyStandings(state.data, state.standings);
  }

  // ---- Simulation ("Was-wäre-wenn"-Vorschau) -----------------------------

  /* Manuell gesetzte Live-Stände als Ergebnis-Quelle (immer als live markiert,
     zusätzlich sim:true zur Kennzeichnung in der UI). */
  function simResults() {
    const out = {};
    for (const [id, s] of Object.entries(state.sim)) {
      if (s && s.home != null && s.away != null) {
        out[id] = { home: s.home, away: s.away, live: true, sim: true };
      }
    }
    return out;
  }

  /* WM-Torschützen aus der API plus simulierte Zusatztore (kanonisch gemerged),
     damit Torschützenliste UND Torjäger-Bonus die Vorschau abbilden. */
  function simulatedExtras() {
    const base = state.apiState ? state.apiState.extras : {};
    const sim = state.simGoals || {};
    let out = base;
    if (Object.keys(sim).length) {
      const canon = window.Scoring.canonicalScorer;
      const map = new Map();
      // realer Stand: API-Torschützen, offline ersatzweise die manuelle Liste
      const seed = (base.scorers && base.scorers.length)
        ? base.scorers : (state.data.manualScorers || []);
      for (const s of seed) {
        const key = canon(s.name).name;
        const prev = map.get(key);
        if (prev) prev.goals += (s.goals || 0);
        else map.set(key, { name: key, goals: s.goals || 0, teamDE: s.teamDE || null, crest: s.crest || null });
      }
      const realScorers = [...map.values()].map((s) => Object.assign({}, s));
      for (const [name, extra] of Object.entries(sim)) {
        if (!extra) continue;
        const c = canon(name);
        const prev = map.get(c.name);
        if (prev) prev.goals = Math.max(0, prev.goals + extra);
        else if (extra > 0) map.set(c.name, { name: c.name, goals: extra, teamDE: c.team, crest: null });
      }
      out = Object.assign({}, base, { scorers: [...map.values()], realScorers });
    }
    // Ist das Turnier durch (Finale gespielt), stehen Weltmeister & Elfer-Anzahl
    // endgültig fest – auch offline (rein aus der Excel), ohne auf den Live-Feed
    // zu warten. Dann gilt die echte Excel-Antwort für alle.
    if (tournamentFinished()) {
      out = Object.assign({}, out, { tournamentFinished: true, shootoutsDecided: true });
    }
    // Manuell gesetzte Zusatzfragen (Bonus-Tab) überschreiben die
    // API-/Excel-Antworten und lassen den Bonus sofort einfließen. Sobald die
    // Elfer-Anzahl real feststeht (shootoutsLocked), gewinnt immer der echte
    // Stand – eine alte lokale Test-Einstellung darf das Ergebnis nicht
    // mehr verfälschen.
    const b = state.bonusSet || {};
    const locked = shootoutsLocked();
    if (b.champion || (b.shootouts != null && !locked)) {
      out = Object.assign({}, out);
      if (b.champion) out.championTeam = b.champion;
      if (b.shootouts != null && !locked) {
        out.shootoutCount = b.shootouts;
        out.tournamentFinished = true; // manuell gesetzt -> Elfer-Bonus anwenden
      }
    }
    return out;
  }

  function hasSim() {
    return Object.keys(state.sim).length > 0 || Object.keys(state.simGoals).length > 0;
  }

  function setSimScore(id, home, away) {
    state.sim[id] = { home: Math.max(0, home | 0), away: Math.max(0, away | 0) };
    recompute();
    render();
  }

  function clearSimMatch(id) {
    delete state.sim[id];
    recompute();
    render();
  }

  /* Basis-Tore eines (kanonischen) Schützen aus der echten API – als Untergrenze
     fürs Heruntersimulieren. */
  function baseGoalsFor(canonName) {
    const ex = state.apiState ? state.apiState.extras : {};
    const canon = window.Scoring.canonicalScorer;
    let g = 0;
    for (const s of (ex.scorers || [])) {
      if (canon(s.name).name === canonName) g += s.goals || 0;
    }
    return g;
  }

  function bumpSimGoal(name, delta) {
    const key = window.Scoring.canonicalScorer(name).name;
    const min = -baseGoalsFor(key); // nicht unter den echten WM-Stand drücken
    const next = Math.max(min, (state.simGoals[key] || 0) + delta);
    if (next === 0) delete state.simGoals[key];
    else state.simGoals[key] = next;
    recompute();
    render();
  }

  function resetSim() {
    state.sim = {};
    state.simGoals = {};
    recompute();
    render();
  }

  // ---- Bonus-Zusatzfragen (Weltmeister / Elfmeterschießen) ----------------

  function saveBonusSet() {
    try { localStorage.setItem(BONUS_KEY, JSON.stringify(state.bonusSet)); } catch (e) { /* egal */ }
  }
  function loadBonusSet() {
    try {
      const b = JSON.parse(localStorage.getItem(BONUS_KEY) || 'null');
      if (b && typeof b === 'object') {
        state.bonusSet = {
          champion: b.champion || null,
          shootouts: (typeof b.shootouts === 'number') ? b.shootouts : null
        };
      }
    } catch (e) { /* egal */ }
  }

  function setBonusChampion(team) {
    state.bonusSet.champion = (state.bonusSet.champion === team) ? null : (team || null);
    saveBonusSet(); recompute(); render();
  }
  function setBonusShootouts(n) {
    state.bonusSet.shootouts = (n == null) ? null : Math.max(0, n | 0);
    if (n == null) state.bonusDraft = null;      // Reset -> Stepper wieder Default
    else state.bonusDraft = state.bonusSet.shootouts;
    saveBonusSet(); recompute(); render();
  }
  // Stepper nur den Entwurf ändern (noch NICHT auf die Wertung anwenden)
  function setShootoutDraft(n) {
    state.bonusDraft = Math.max(0, n | 0);
    render();
  }
  /* Ist das Turnier komplett durch? Erkennt das Finale mit Ergebnis (steht auch
     offline in der Excel), fällt sonst auf den Live-Feed zurück. */
  function tournamentFinished() {
    const finale = state.data && state.data.matches
      && state.data.matches.find((m) => m.round === 'Finale');
    if (finale && state.results && state.results[finale.id]) return true;
    return !!(state.apiState && state.apiState.extras && state.apiState.extras.tournamentFinished);
  }
  /* Steht die Elfer-Anzahl schon real fest (Halbfinale durch bzw. Turnier
     beendet)? Dann ist die lokale, nur für die Bonus-Vorschau gedachte
     Einstellung hinfällig – der Bonus gilt ab da global für alle. */
  function shootoutsLocked() {
    return tournamentFinished() ||
      !!(state.apiState && state.apiState.extras && state.apiState.extras.shootoutsDecided);
  }
  function bonusIsSet() {
    return !!(state.bonusSet.champion || (state.bonusSet.shootouts != null && !shootoutsLocked()));
  }

  // ---- Lokaler Zwischenspeicher (Fallback bei API-Störung) -----------------
  // Jeder erfolgreiche API-Abruf wird im Browser gespeichert. Ist die API
  // gestört, greift die Seite auf diesen letzten Stand zurück (statt nur auf
  // die statische Excel, die sich nicht aktualisiert). Die API bleibt immer
  // Primärquelle; gespeichert werden die rohen Antworten, die beim Laden gegen
  // die aktuelle Excel neu zugeordnet werden.
  const SNAP_KEY = 'wm26-live-snapshot-v1';

  function saveSnapshot(apiMatches, apiScorers) {
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify({
        ts: Date.now(),
        apiMatches: apiMatches || [],
        apiScorers: apiScorers || []
      }));
    } catch (e) { /* localStorage nicht verfügbar oder voll – ignorieren */ }
  }

  function loadSnapshot() {
    try {
      const snap = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
      return (snap && Array.isArray(snap.apiMatches)) ? snap : null;
    } catch (e) { return null; }
  }

  /* Übernimmt den gespeicherten Stand, solange keine frischen API-Daten da
     sind – z. B. direkt beim Laden während einer API-Störung. */
  function hydrateSnapshot() {
    if (state.apiState) return false;
    const snap = loadSnapshot();
    if (!snap) return false;
    try {
      state.apiState = window.LiveApi.mapLiveData(state.data, snap.apiMatches, snap.apiScorers || []);
      if (state.apiState.extras) {
        state.apiState.extras.scorers = bestScorers(state.apiState.extras.scorers);
      }
      state.stale = true;
      state.lastUpdate = new Date(snap.ts);
      return true;
    } catch (e) { return false; }
  }

  async function refreshLive() {
    if (!CFG.proxyUrl) return;
    try {
      const { apiMatches, apiScorers } = await window.LiveApi.fetchLive(CFG.proxyUrl);
      state.apiState = window.LiveApi.mapLiveData(state.data, apiMatches, apiScorers);
      // Akkurate Torschützen (Highlightly-Events) bevorzugen + Korrekturen
      if (state.apiState.extras) {
        state.apiState.extras.scorers = bestScorers(state.apiState.extras.scorers);
      }
      state.apiError = null;
      state.stale = false;
      state.lastUpdate = new Date();
      saveSnapshot(apiMatches, apiScorers);
    } catch (err) {
      console.error('Live-Update fehlgeschlagen:', err);
      state.apiError = err.message;
      // Fallback: letzten erfolgreichen Stand aus dem lokalen Cache halten/laden,
      // statt auf die (veraltete) Excel zurückzufallen. API bleibt Primärquelle.
      if (!state.apiState) hydrateSnapshot();
      else state.stale = true;
    }
    recompute();
    render();
  }

  /* Adaptives Polling: während laufender Spiele schnell aktualisieren,
     sonst sparsam (schont das API-/Worker-Limit). Das Intervall wird nach
     jedem Abruf anhand des aktuellen Live-Status neu bestimmt. */
  function pollIntervalMs() {
    const sec = anyLive()
      ? Math.max(10, CFG.livePollSeconds || CFG.pollSeconds || 20)
      : Math.max(30, CFG.idlePollSeconds || CFG.pollSeconds || 60);
    return sec * 1000;
  }

  function scheduleNextPoll() {
    clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(async () => {
      await refreshLive();
      scheduleNextPoll();
    }, pollIntervalMs());
  }

  // --------------------------------------------------------------- Helpers --

  function matchInfo(id) {
    return (state.apiState && state.apiState.matchInfo[id]) || null;
  }

  function isLive(id) {
    const r = state.results[id];
    return !!(r && r.live);
  }

  function teamsOf(m) {
    const info = matchInfo(m.id);
    // Paarungs-Override füllt nur LÜCKEN (K.o.-Gegner, die der Feed noch nicht
    // hat). Excel/Live-API gewinnen, sobald sie die Teams liefern.
    const ov = (state.fixtureOverrides && state.fixtureOverrides[m.id]) || null;
    return {
      home: m.home || (info && info.homeDE) || (ov && ov.home) || null,
      away: m.away || (info && info.awayDE) || (ov && ov.away) || null
    };
  }

  function anyLive() {
    return Object.values(state.results).some((r) => r.live && !r.sim);
  }

  /* Noch im Turnier verbliebene Mannschaften: alle Teams aus K.o.-Spielen,
     minus die Verlierer bereits entschiedener K.o.-Partien. */
  function aliveTeams() {
    const ko = state.data.matches.filter((m) => !/grupp/i.test(m.round || ''));
    const all = new Set();
    const eliminated = new Set();
    for (const m of ko) {
      const { home, away } = teamsOf(m);
      if (home) all.add(home);
      if (away) all.add(away);
      const res = state.results[m.id];
      if (res && res.home != null && res.away != null && res.home !== res.away && home && away) {
        eliminated.add(res.home > res.away ? away : home);
      }
    }
    return [...all].filter((t) => !eliminated.has(t)).sort((a, b) => a.localeCompare(b, 'de'));
  }

  // ---------------------------------------------------------------- Render --

  function render() {
    renderStatus();
    renderSpiele();
    renderTabelle();
    renderFamilien();
    renderTorjaeger();
    const ver = $('#footer-version');
    if (ver) ver.textContent = 'v' + (CFG.version || '–');
    $('#footer-source').textContent = CFG.proxyUrl
      ? 'Live-Daten: football-data.org · Aktualisierung alle ' +
        (CFG.livePollSeconds || CFG.pollSeconds || 20) + ' s während laufender Spiele'
      : 'Offline-Modus: Stände aus der Excel-Datei' +
        (Object.keys(state.manual).length ? ' + manuelle Ergebnisse' : '');
  }

  function renderStatus() {
    const dot = $('#live-dot');
    const txt = $('#status-text');
    if (!CFG.proxyUrl) {
      dot.className = 'status-dot offline';
      txt.textContent = 'Offline-Modus';
      return;
    }
    const timeStr = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (state.apiError) {
      // Bei Störung den gespeicherten Zwischenstand ausweisen, sonst „gestört“.
      if (state.apiState && state.lastUpdate) {
        dot.className = 'status-dot stale';
        txt.textContent = 'Stand ' + timeStr(state.lastUpdate) + ' · gespeichert';
      } else {
        dot.className = 'status-dot offline';
        txt.textContent = 'Live-Daten gestört';
      }
      return;
    }
    if (anyLive()) {
      dot.className = 'status-dot live';
      txt.textContent = 'LIVE';
    } else {
      dot.className = 'status-dot online';
      txt.textContent = state.lastUpdate ? 'Stand ' + timeStr(state.lastUpdate) : 'verbunden';
    }
  }

  // ------- Spiele -------

  /* Leitet den Gruppenphasen-Spieltag (1–3) je Spiel ab: in chronologischer
     Reihenfolge ist der n-te Auftritt einer Mannschaft ihr n-ter Spieltag.
     Robust gegen die Tagesplanung (an zwei Tagen überlappen zwei Spieltage). */
  function matchdayMap() {
    if (state._matchdays) return state._matchdays;
    const map = {};
    const isGroup = (m) => /grupp/i.test(m.round || '');
    const group = state.data.matches.filter(isGroup).slice()
      .sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
    const appear = {};
    for (const m of group) {
      const md = Math.max(appear[m.home] || 0, appear[m.away] || 0) + 1;
      if (m.home) appear[m.home] = md;
      if (m.away) appear[m.away] = md;
      map[m.id] = md;
    }
    state._matchdays = map;
    return map;
  }

  /* Sortierte, eindeutige Spieltage der Spiele eines Tages (nur Gruppenphase). */
  function matchdaysForDay(ms) {
    const map = matchdayMap();
    const set = new Set();
    for (const m of ms) if (map[m.id]) set.add(map[m.id]);
    return [...set].sort((a, b) => a - b);
  }

  function renderSpiele() {
    const view = $('#view-spiele');
    view.innerHTML = '';

    if (tournamentFinished()) view.appendChild(celebrationBanner());
    if (hasSim()) view.appendChild(simBanner());

    if (!CFG.proxyUrl) {
      const b = el('div', 'banner');
      b.innerHTML = window.Icons.svg('info') + ' <strong>Live-Daten noch nicht verbunden.</strong> ' +
        'Sobald der Daten-Proxy in <code>js/config.js</code> eingetragen ist, ' +
        'aktualisieren sich Spielstände, Torschützen und Wertung automatisch. ' +
        'Anleitung: siehe README im Repository.';
      view.appendChild(b);
    }

    // chronologisch nach Tagen gruppieren (Schlüssel direkt aus dem
    // Kickoff-String, Safari-sicher)
    const groups = new Map();
    for (const m of state.data.matches) {
      const key = String(m.kickoff).slice(0, 10);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }

    const todayKey = localDateKey(new Date());
    state.scrollAnchor = null;
    let firstUpcomingLabel = null;

    for (const [key, ms] of groups) {
      const d = new Date(key + 'T12:00:00');
      const hasLive = ms.some((m) => isLive(m.id));
      // Spieltag-Indikator (nur Gruppenphase; an Übergangstagen z. B. "1./2.")
      const mds = matchdaysForDay(ms);
      const spieltag = mds.length ? ' — ' + mds.join('./') + '. Spieltag' : '';
      const label = el('div', 'day-label' + (hasLive ? ' live-label' : ''),
        WEEKDAYS[d.getDay()] + ', ' +
        d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
        (key === todayKey ? ' · heute' : '') +
        (ms[0].round ? ' — ' + ms[0].round : '') +
        spieltag);
      view.appendChild(label);
      if (key === todayKey && !state.scrollAnchor) state.scrollAnchor = label;
      if (key > todayKey && !firstUpcomingLabel) firstUpcomingLabel = label;
      ms.forEach((m) => view.appendChild(matchCard(m)));
    }

    // Auto-Scroll-Ziel: heutiger Tag, sonst der nächste anstehende
    if (!state.scrollAnchor) state.scrollAnchor = firstUpcomingLabel;
  }

  /* Springt zum aktuellen Spieltag (Ältere stehen darüber). */
  function scrollToCurrentMatchday() {
    const a = state.scrollAnchor;
    if (a && typeof a.scrollIntoView === 'function') {
      try { a.scrollIntoView({ block: 'start' }); } catch (e) { /* jsdom o. Ä. */ }
    }
  }

  function localDateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  function matchCard(m) {
    const { home, away } = teamsOf(m);
    const res = state.results[m.id];
    const sim = !!(res && res.sim);
    const live = isLive(m.id) && !sim;
    const card = el('div', 'glass match-card' + (sim ? ' sim' : ''));

    const row = el('button', 'match-row');
    row.setAttribute('aria-expanded', state.openMatch === m.id ? 'true' : 'false');

    const th = el('div', 'mteam' + (home ? '' : ' placeholder'));
    if (home) th.appendChild(flagImg(home));
    th.appendChild(el('span', 'name', home || offenLabel(m)));
    row.appendChild(th);

    const sc = el('div', 'mscore' + (sim ? ' sim' : live ? ' live' : res ? '' : ' upcoming'));
    if (res) {
      // Nur das Endergebnis. Bei Elfmeterschießen liefert die Quelle in
      // fullTime bereits den Gesamtstand inkl. Elfmeter (z. B. 3:4) – kein
      // separater "i. E."-Zusatz, damit nichts hin- und herspringt.
      sc.textContent = res.home + ' : ' + res.away;
    } else {
      sc.textContent = '– : –';
    }
    row.appendChild(sc);

    const ta = el('div', 'mteam right' + (away ? '' : ' placeholder'));
    ta.appendChild(el('span', 'name', away || offenLabel(m)));
    if (away) ta.appendChild(flagImg(away));
    row.appendChild(ta);

    // Unterzeile: LIVE/Uhrzeit + Spielwert, mittig unter dem Ergebnis
    const sub = el('div', 'match-sub');
    if (sim) {
      sub.appendChild(el('span', 'sim-badge', 'SIMULIERT'));
    } else if (live) {
      sub.appendChild(el('span', 'live-badge', 'LIVE'));
    } else {
      // Uhrzeit direkt aus dem Kickoff-String (deutsche Zeit), Safari-sicher
      sub.appendChild(el('span', 'sub-time', String(m.kickoff).slice(11, 16) + ' Uhr'));
    }
    sub.appendChild(el('span', 'wert-chip', 'Wert ' + fmtPts(m.wert)));
    row.appendChild(sub);

    row.addEventListener('click', () => {
      state.openMatch = state.openMatch === m.id ? null : m.id;
      renderSpiele();
    });
    card.appendChild(row);

    if (state.openMatch === m.id) {
      card.appendChild(simControls(m));
      card.appendChild(matchTips(m));
    }
    return card;
  }

  /* Manuelle Live-Stand-Simulation eines Spiels: Tor vorwegnehmen und sofort
     sehen, wie sich Rangliste, Live-Punkte und Bonus verschieben. */
  function simControls(m) {
    const { home, away } = teamsOf(m);
    const res = state.results[m.id];
    const cur = state.sim[m.id]
      || (res ? { home: res.home, away: res.away } : { home: 0, away: 0 });

    const box = el('div', 'sim-box');
    const future = !state.results[m.id];
    box.appendChild(el('div', 'sim-title',
      future ? 'Spielstand simulieren' : 'Live-Stand simulieren'));

    const row = el('div', 'sim-row');
    const stepper = (side) => {
      const wrap = el('div', 'sim-stepper');
      const minus = el('button', 'sim-step', '−');
      minus.setAttribute('aria-label', 'Tor abziehen');
      const val = el('span', 'sim-val', String(cur[side]));
      const plus = el('button', 'sim-step', '+');
      plus.setAttribute('aria-label', 'Tor hinzufügen');
      minus.addEventListener('click', () => setSimScore(m.id,
        side === 'home' ? cur.home - 1 : cur.home,
        side === 'away' ? cur.away - 1 : cur.away));
      plus.addEventListener('click', () => setSimScore(m.id,
        side === 'home' ? cur.home + 1 : cur.home,
        side === 'away' ? cur.away + 1 : cur.away));
      wrap.appendChild(minus);
      wrap.appendChild(val);
      wrap.appendChild(plus);
      return wrap;
    };

    if (home) row.appendChild(flagImg(home));
    row.appendChild(stepper('home'));
    row.appendChild(el('span', 'sim-colon', ':'));
    row.appendChild(stepper('away'));
    if (away) row.appendChild(flagImg(away));
    box.appendChild(row);

    const hint = el('div', 'sim-hint');
    if (state.sim[m.id]) {
      const reset = el('button', 'sim-reset', 'Simulation für dieses Spiel verwerfen');
      reset.addEventListener('click', () => clearSimMatch(m.id));
      hint.appendChild(reset);
    } else {
      hint.textContent = 'Tor vorwegnehmen → Rangliste, Live-Punkte und Bonus aktualisieren sich sofort.';
    }
    box.appendChild(hint);
    return box;
  }

  /* Hinweisbanner, wenn eine Simulation läuft – mit globalem Reset. */
  function simBanner() {
    const b = el('div', 'banner sim-banner');
    const txt = el('span', '');
    txt.innerHTML = window.Icons.svg('info') +
      ' <strong>Simulation aktiv</strong> – angezeigte Stände sind hypothetisch.';
    b.appendChild(txt);
    const reset = el('button', 'sim-reset', 'Alles zurücksetzen');
    reset.addEventListener('click', resetSim);
    b.appendChild(reset);
    return b;
  }

  function offenLabel(m) {
    return m.round ? 'offen (' + m.round + ')' : 'offen';
  }

  function matchTips(m) {
    const wrap = el('div', 'match-tips');
    const res = state.results[m.id];
    const tippers = state.data.players
      .map((p) => ({ name: p.name, tip: p.tips[m.id] }))
      .filter((x) => x.tip);

    if (!tippers.length) {
      wrap.appendChild(el('p', 'empty-hint', 'Für dieses Spiel liegen noch keine Tipps vor.'));
      return wrap;
    }

    const rows = tippers.map((x) => {
      const pts = res ? window.Scoring.matchPoints(x.tip, res, m.wert) : null;
      return { ...x, pts };
    });
    rows.sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1) || a.name.localeCompare(b.name, 'de'));

    for (const r of rows) {
      const cls = r.pts === null ? '' :
        r.pts === 0 ? ' miss' : (r.pts > m.wert ? ' hit-exact' : ' hit-tend');
      const chip = el('div', 'tip-chip' + cls);
      chip.appendChild(el('span', '', r.name));
      const right = el('span', '');
      right.appendChild(el('span', 'tipscore', r.tip[0] + ':' + r.tip[1] + ' '));
      if (r.pts !== null) right.appendChild(el('span', 'pts', fmtPts(r.pts)));
      chip.appendChild(right);
      wrap.appendChild(chip);
    }
    return wrap;
  }

  // ------- Einzelwertung -------

  function applyTableFilter(tbody, q) {
    const needle = q.trim().toLowerCase();
    for (const tr of tbody.children) {
      tr.style.display = !needle || tr.textContent.toLowerCase().includes(needle) ? '' : 'none';
    }
  }

  function renderTabelle() {
    const view = $('#view-tabelle');
    view.innerHTML = '';
    if (tournamentFinished()) view.appendChild(celebrationBanner());
    if (hasSim()) view.appendChild(simBanner());
    const card = el('div', 'glass card');

    const head = el('div', 'card-head');
    head.appendChild(el('h2', '', 'Einzelwertung · ' + state.standings.length + ' Tipper'));
    const search = el('input', 'search-input');
    search.type = 'search';
    search.placeholder = 'Namen suchen …';
    search.setAttribute('aria-label', 'Tipper suchen');
    search.value = state.tableFilter || '';
    head.appendChild(search);
    card.appendChild(head);

    const famOf = new Map();
    state.data.families.forEach((f) => f.members.forEach((m2) => famOf.set(m2, f.name)));

    const table = el('table', 'table');
    table.innerHTML = '<thead><tr>' +
      '<th class="rank">#</th><th>Name</th>' +
      '<th class="num" title="exakte Ergebnisse">' + window.Icons.svg('target') + '</th>' +
      '<th class="num" title="richtige Tendenzen">' + window.Icons.svg('updown') + '</th>' +
      '<th class="num">Bonus</th><th class="num">Punkte</th><th class="bar-cell"></th>' +
      '</tr></thead>';
    const tbody = el('tbody');
    const max = Math.max(1, ...state.standings.map((r) => r.totalLive));

    for (const r of state.standings) {
      const tr = el('tr', r.rank <= 3 ? 'top' + r.rank : '');

      // Platz + Veränderung durch laufende/simulierte Spiele (▲ rauf / ▼ runter)
      const rankTd = el('td', 'rank');
      const rankWrap = el('span', 'rank-wrap');
      rankWrap.appendChild(el('span', 'rank-num', String(r.rank)));
      if (r.rankDelta) {
        const up = r.rankDelta > 0;
        rankWrap.appendChild(el('span', 'rank-delta ' + (up ? 'up' : 'down'),
          (up ? '▲' : '▼') + Math.abs(r.rankDelta)));
      }
      rankTd.appendChild(rankWrap);
      tr.appendChild(rankTd);

      const nameTd = el('td');
      nameTd.appendChild(el('span', 'pname', r.name));
      const fam = famOf.get(r.name);
      if (fam) nameTd.appendChild(el('span', 'fam-tag', ' · ' + fam.replace('Fam. ', '')));
      tr.appendChild(nameTd);

      tr.appendChild(el('td', 'num', String(r.exact)));
      tr.appendChild(el('td', 'num', String(r.tendency)));
      tr.appendChild(el('td', 'num', fmtPts(r.bonusPoints)));

      // Gesamtstand INKL. Live-/Sim-Punkten als Hauptzahl, darunter der
      // Live-Anteil als vorläufiger Zuwachs.
      const totalTd = el('td', 'num total-cell');
      totalTd.appendChild(el('span', 'total-main', fmtPts(r.totalLive)));
      if (r.livePoints > 0) {
        totalTd.appendChild(el('span', 'live-delta', '+' + fmtPts(r.livePoints) + ' live'));
      }
      tr.appendChild(totalTd);

      const barTd = el('td', 'bar-cell');
      const bar = el('div', 'score-bar');
      const fill = el('i');
      fill.style.width = Math.max(2, (r.totalLive / max) * 100) + '%';
      bar.appendChild(fill);
      barTd.appendChild(bar);
      tr.appendChild(barTd);

      tr.addEventListener('click', () => openPlayerSheet(r.name));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    card.appendChild(table);
    view.appendChild(card);

    search.addEventListener('input', () => {
      state.tableFilter = search.value;
      applyTableFilter(tbody, search.value);
    });
    if (state.tableFilter) applyTableFilter(tbody, state.tableFilter);
  }

  // ------- Familien -------

  function renderFamilien() {
    const view = $('#view-familien');
    view.innerHTML = '';
    if (hasSim()) view.appendChild(simBanner());
    if (bonusIsSet()) view.appendChild(bonusBanner());
    const byName = new Map(state.standings.map((r) => [r.name, r]));

    const grid = el('div', 'family-grid');
    for (const f of state.families) {
      const card = el('div', 'glass family-card');
      const head = el('div', 'family-head');
      head.appendChild(el('span', 'fname', f.name));
      head.appendChild(el('span', 'frank', '#' + f.rank));
      card.appendChild(head);

      const avg = el('div', 'family-avg', fmtPts(f.average));
      avg.appendChild(el('small', '', 'Ø Punkte (' + f.memberCount + ' Tipper)'));
      card.appendChild(avg);

      const chips = el('div', 'member-chips');
      [...f.members]
        .sort((a, b) => (byName.get(b)?.totalLive ?? 0) - (byName.get(a)?.totalLive ?? 0))
        .forEach((m) => {
          const r = byName.get(m);
          const chip = el('span', 'member-chip', m + (r ? ' · ' + fmtPts(r.totalLive) : ''));
          chip.style.cursor = 'pointer';
          chip.addEventListener('click', () => openPlayerSheet(m));
          chips.appendChild(chip);
        });
      card.appendChild(chips);
      grid.appendChild(card);
    }
    view.appendChild(grid);
  }

  // ------- Torschützen -------

  function renderTorjaeger() {
    const view = $('#view-torjaeger');
    view.innerHTML = '';
    if (hasSim()) view.appendChild(simBanner());

    const canon = window.Scoring.canonicalScorer;
    const ppg = state.data.bonus.topscorer.pointsPerGoal;
    const realScorers = state.apiState && state.apiState.extras.scorers.length
      ? state.apiState.extras.scorers
      : state.data.manualScorers.map((s) => ({ name: s.name, goals: s.goals, teamDE: null }));

    // Reale WM-Tore je kanonischem Namen ("Kane" + "Harry Kane" = eine Zeile)
    const realGoalsByCanon = new Map();
    const teamByCanon = new Map();
    for (const s of realScorers) {
      const c = canon(s.name);
      realGoalsByCanon.set(c.name, (realGoalsByCanon.get(c.name) || 0) + (s.goals || 0));
      const team = s.teamDE || c.team;
      if (team && !teamByCanon.has(c.name)) teamByCanon.set(c.name, team);
    }

    // Simulierte Zusatztore aus der Tor-Simulation (kanonische Keys)
    const simByCanon = new Map();
    for (const [nm, extra] of Object.entries(state.simGoals || {})) {
      if (extra) simByCanon.set(canon(nm).name, extra);
    }

    // Anzeige-Gesamt = real + simuliert (>= 0); rein simulierte Schützen ergänzen
    const totalByCanon = new Map(realGoalsByCanon);
    for (const [nm, extra] of simByCanon) {
      totalByCanon.set(nm, Math.max(0, (totalByCanon.get(nm) || 0) + extra));
      if (!teamByCanon.has(nm)) { const t = canon(nm).team; if (t) teamByCanon.set(nm, t); }
    }

    // Tipps unter dem vollen Namen zusammenführen ("Kane" + "Harry Kane" usw.)
    const picksByCanon = new Map();
    for (const p of state.data.players) {
      if (!p.bonus.topscorer) continue;
      const key = canon(p.bonus.topscorer).name;
      if (!picksByCanon.has(key)) picksByCanon.set(key, []);
      picksByCanon.get(key).push(p.name);
    }

    const teamFor = (name) => teamByCanon.get(name) || canon(name).team;

    // Farblich markierter simulierter Zuwachs/Abzug (+n / −n)
    const simAddEl = (value, suffix) =>
      el('span', 'sim-add', (value > 0 ? '+' : '−') + fmtPts(Math.abs(value)) + (suffix || ''));

    function scorerRow(rank, name, team, picks, showPts, simulatable) {
      const realG = realGoalsByCanon.get(name) || 0;
      const extra = simByCanon.get(name) || 0;
      const totalG = Math.max(0, realG + extra);

      const row = el('div', 'scorer-row' + (extra ? ' sim-on' : ''));
      row.appendChild(el('span', 'rank', rank));
      if (team) row.appendChild(flagImg(team));
      else row.appendChild(ballPlaceholder());

      const nameWrap = el('span', 'scorer-name');
      nameWrap.appendChild(el('b', '', name));
      if (picks && picks.length) {
        const picksEl = el('span', 'picks',
          picks.slice(0, 6).join(', ') + (picks.length > 6 ? ' +' + (picks.length - 6) : ''));
        picksEl.style.cursor = 'pointer';
        picksEl.addEventListener('click', () => openNamesSheet(name, picks));
        nameWrap.appendChild(picksEl);
      }
      row.appendChild(nameWrap);

      const meta = el('span', 'scorer-meta');
      const figures = el('span', 'scorer-figures');

      if (showPts) {
        const pts = el('span', 'scorer-pts');
        if (totalG) {
          if (realG) pts.appendChild(el('span', '', '+' + fmtPts(realG * ppg)));
          if (extra) {
            if (realG) pts.appendChild(document.createTextNode(' '));
            pts.appendChild(simAddEl(extra * ppg));
          }
          pts.appendChild(document.createTextNode(' P.'));
        } else {
          pts.textContent = '0 P.';
        }
        figures.appendChild(pts);
      }

      // Tore: realer Stand als Basis, simulierter Zuwachs farblich abgesetzt
      const g = el('span', 'goals' + (extra ? ' has-sim' : ''));
      g.appendChild(document.createTextNode(String(realG) + ' '));
      if (extra) g.appendChild(simAddEl(extra));
      g.appendChild(window.Icons.node('ball'));
      figures.appendChild(g);
      meta.appendChild(figures);

      // Tor-Simulation: getipptem Torjäger ein Tor geben/nehmen → sofort neu rechnen.
      // Knöpfe sitzen kompakt rechts unter der Toranzeige.
      if (simulatable) {
        const sim = el('span', 'scorer-sim');
        const minus = el('button', 'sim-step', '−');
        minus.setAttribute('aria-label', 'Tor abziehen');
        minus.addEventListener('click', () => bumpSimGoal(name, -1));
        const plus = el('button', 'sim-step', '+');
        plus.setAttribute('aria-label', 'Tor hinzufügen');
        plus.addEventListener('click', () => bumpSimGoal(name, +1));
        sim.appendChild(minus);
        sim.appendChild(plus);
        meta.appendChild(sim);
      }

      row.appendChild(meta);
      return row;
    }

    // ---- 1) Alle getippten Torjäger, sortiert nach (simulierten) Toren ----
    const tippCard = el('div', 'glass card');
    tippCard.appendChild(el('h2', '', 'Getippte Torjäger'));

    const tipped = [...picksByCanon.entries()]
      .map(([name, names]) => ({ name, names, goals: totalByCanon.get(name) || 0 }))
      .sort((a, b) => b.goals - a.goals
        || b.names.length - a.names.length
        || a.name.localeCompare(b.name));

    if (!tipped.length) {
      tippCard.appendChild(el('p', 'empty-hint', 'Es wurde noch kein Torjäger getippt.'));
    }
    // Dichte Platzierung: gleiche Toranzahl = gleicher Platz (1,1,1,2,2,3 …)
    let tRank = 0, tPrev = NaN;
    tipped.forEach((t) => {
      if (t.goals !== tPrev) { tRank += 1; tPrev = t.goals; }
      tippCard.appendChild(
        scorerRow(String(tRank), t.name, teamFor(t.name), t.names, true, true));
    });
    view.appendChild(tippCard);

    // ---- 2) Komplette WM-Torschützenliste (inkl. simulierter Tore) ----
    const allCard = el('div', 'glass card');
    allCard.appendChild(el('h2', '', 'Torschützenliste der WM'));

    const merged = [...totalByCanon.entries()]
      .filter(([, goals]) => goals > 0)
      .map(([name, goals]) => ({ name, goals }))
      .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));

    if (!merged.length) {
      allCard.appendChild(el('p', 'empty-hint', 'Noch keine Tore bei der WM.'));
    }
    // Dichte Platzierung + Einklappen: standardmäßig nur bis Platz 5 zeigen.
    let aRank = 0, aPrev = NaN;
    const ranked = merged.map((s) => {
      if (s.goals !== aPrev) { aRank += 1; aPrev = s.goals; }
      return { name: s.name, rank: aRank };
    });
    const collapsedCount = ranked.filter((r) => r.rank <= 5).length;
    const hasMore = ranked.length > collapsedCount;
    const visible = state.scorersExpanded ? ranked : ranked.slice(0, collapsedCount);
    visible.forEach((s) => allCard.appendChild(
      scorerRow(String(s.rank), s.name, teamFor(s.name), picksByCanon.get(s.name), false, false)));
    if (hasMore) {
      const btn = el('button', 'expand-btn', state.scorersExpanded
        ? 'Weniger anzeigen'
        : 'Alle ' + ranked.length + ' Torschützen anzeigen');
      btn.addEventListener('click', () => { state.scorersExpanded = !state.scorersExpanded; render(); });
      allCard.appendChild(btn);
    }
    view.appendChild(allCard);

    // ---- 3) Weltmeister-Bonus  ---- 4) Elfmeterschießen-Bonus ----
    renderChampionCard(view);
    renderShootoutCard(view);
  }

  // ------- Bonus: Weltmeister -------

  function renderChampionCard(view) {
    const champPts = state.data.bonus.champion.points || 15;
    const card = el('div', 'glass card');
    card.appendChild(el('h2', '', 'Weltmeister'));
    card.appendChild(el('p', 'bonus-hint',
      'Wähle den Weltmeister – Tipper mit diesem Team bekommen +' + fmtPts(champPts) + ' Punkte.'));

    const alive = aliveTeams();
    const aliveSet = new Set(alive);
    const picked = state.bonusSet.champion;
    const pickerTeams = (picked && !aliveSet.has(picked)) ? [picked, ...alive] : alive;

    const picker = el('div', 'bonus-picker');
    for (const team of pickerTeams) {
      const chip = el('button', 'pick-chip' + (picked === team ? ' active' : ''));
      if (window.Teams.TEAMS[team]) chip.appendChild(flagImg(team));
      chip.appendChild(el('span', '', team));
      chip.addEventListener('click', () => setBonusChampion(team));
      picker.appendChild(chip);
    }
    card.appendChild(picker);
    if (picked) {
      const reset = el('button', 'sim-reset', 'Auswahl zurücksetzen');
      reset.addEventListener('click', () => setBonusChampion(picked));
      card.appendChild(reset);
    }

    const byTeam = new Map();
    for (const p of state.data.players) {
      if (!p.bonus.champion) continue;
      if (!byTeam.has(p.bonus.champion)) byTeam.set(p.bonus.champion, []);
      byTeam.get(p.bonus.champion).push(p.name);
    }
    const rows = [...byTeam.entries()]
      .map(([team, names]) => ({ team, names, alive: aliveSet.has(team) }))
      .sort((a, b) =>
        (b.team === picked) - (a.team === picked) ||
        (b.alive - a.alive) ||
        b.names.length - a.names.length ||
        a.team.localeCompare(b.team, 'de'));

    for (const r of rows) {
      const won = r.team === picked;
      const row = el('div', 'bonus-row' + (won ? ' win' : (r.alive ? '' : ' out')));
      if (window.Teams.TEAMS[r.team]) row.appendChild(flagImg(r.team));
      else row.appendChild(ballPlaceholder());
      const nameWrap = el('span', 'scorer-name');
      nameWrap.appendChild(el('b', 'bonus-team', r.team));
      const picksEl = el('span', 'picks',
        r.names.slice(0, 8).join(', ') + (r.names.length > 8 ? ' +' + (r.names.length - 8) : ''));
      picksEl.style.cursor = 'pointer';
      picksEl.addEventListener('click', () => openNamesSheet(r.team, r.names));
      nameWrap.appendChild(picksEl);
      row.appendChild(nameWrap);
      const right = el('span', 'bonus-right');
      right.appendChild(el('span', 'bonus-count', String(r.names.length)));
      if (won) right.appendChild(el('span', 'bonus-pts bonus-plus', '+' + fmtPts(champPts)));
      else if (!r.alive) right.appendChild(el('span', 'bonus-out', 'raus'));
      row.appendChild(right);
      card.appendChild(row);
    }
    view.appendChild(card);
  }

  // ------- Bonus: Elfmeterschießen -------

  function renderShootoutCard(view) {
    const so = state.data.bonus.shootouts;
    const exact = so.exactPoints || 10, malus = so.malusPerDelta || 2;
    const card = el('div', 'glass card');
    card.appendChild(el('h2', '', 'Elfmeterschießen'));
    card.appendChild(el('p', 'bonus-hint',
      'Exakt getippt = +' + fmtPts(exact) + ' P., sonst −' + fmtPts(malus) + ' P. je Abweichung.'));

    const detected = state.apiState && state.apiState.extras
      ? state.apiState.extras.shootoutCount : null;
    const locked = shootoutsLocked();
    let applied; // Zahl, gegen die unten die Punkte berechnet werden (oder null)

    if (locked) {
      // Halbfinale ist komplett gespielt -> die Anzahl steht real fest und gilt
      // global für alle. Nichts mehr einstellbar, nur noch die Info-Zeile.
      applied = detected;
      const badge = el('div', 'bonus-locked');
      badge.appendChild(el('span', 'bonus-locked-badge', '✓ Bonus bereits angewendet'));
      badge.appendChild(el('span', 'bonus-locked-info',
        'Es waren ' + applied + ' Elfmeterschießen bis einschließlich Halbfinale – daran ändert sich nichts mehr.'));
      card.appendChild(badge);
    } else {
      // Noch offen: Stepper + Vorschau, bewusst per Knopf anwenden.
      applied = state.bonusSet.shootouts;
      const draft = state.bonusDraft != null ? state.bonusDraft
        : (applied != null ? applied : (detected != null ? detected : 0));

      const ctl = el('div', 'shootout-control');
      ctl.appendChild(el('span', 'sc-label', 'Anzahl Elferschießen'));
      const stepper = el('div', 'sim-stepper');
      const minus = el('button', 'sim-step', '−');
      minus.setAttribute('aria-label', 'weniger');
      minus.addEventListener('click', () => setShootoutDraft(draft - 1));
      stepper.appendChild(minus);
      stepper.appendChild(el('span', 'sim-val', String(draft)));
      const plus = el('button', 'sim-step', '+');
      plus.setAttribute('aria-label', 'mehr');
      plus.addEventListener('click', () => setShootoutDraft(draft + 1));
      stepper.appendChild(plus);
      ctl.appendChild(stepper);
      card.appendChild(ctl);

      // Anwenden / Zurücksetzen
      const actions = el('div', 'bonus-actions');
      const isApplied = applied != null && applied === draft;
      const applyBtn = el('button', 'bonus-apply' + (isApplied ? ' done' : ''),
        isApplied ? '✓ angewendet' : 'Bonus jetzt anwenden');
      applyBtn.addEventListener('click', () => setBonusShootouts(draft));
      actions.appendChild(applyBtn);
      if (applied != null) {
        const reset = el('button', 'sim-reset', 'zurücksetzen');
        reset.addEventListener('click', () => setBonusShootouts(null));
        actions.appendChild(reset);
      }
      card.appendChild(actions);
    }

    const byNum = new Map();
    for (const p of state.data.players) {
      if (p.bonus.shootouts == null) continue;
      if (!byNum.has(p.bonus.shootouts)) byNum.set(p.bonus.shootouts, []);
      byNum.get(p.bonus.shootouts).push(p.name);
    }
    for (const [num, names] of [...byNum.entries()].sort((a, b) => a[0] - b[0])) {
      const row = el('div', 'bonus-row' + (applied != null && num === applied ? ' win' : ''));
      row.appendChild(el('span', 'so-num', String(num)));
      const nameWrap = el('span', 'scorer-name');
      const picksEl = el('span', 'picks',
        names.slice(0, 8).join(', ') + (names.length > 8 ? ' +' + (names.length - 8) : ''));
      picksEl.style.cursor = 'pointer';
      picksEl.addEventListener('click', () => openNamesSheet(num + ' Elfmeter getippt', names));
      nameWrap.appendChild(picksEl);
      row.appendChild(nameWrap);
      const right = el('span', 'bonus-right');
      right.appendChild(el('span', 'bonus-count', String(names.length)));
      if (applied != null) {
        const pts = num === applied ? exact : -malus * Math.abs(num - applied);
        right.appendChild(el('span', 'bonus-pts ' + (pts > 0 ? 'bonus-plus' : (pts < 0 ? 'bonus-minus' : '')),
          (pts > 0 ? '+' : '') + fmtPts(pts)));
      }
      row.appendChild(right);
      card.appendChild(row);
    }
    view.appendChild(card);
  }

  /* Banner auf Einzel-/Familienwertung, wenn Bonus-Antworten manuell gesetzt
     sind (nur lokal), damit die veränderten Punkte nachvollziehbar sind. */
  function bonusBanner() {
    const b = el('div', 'banner sim-banner');
    const parts = [];
    if (state.bonusSet.champion) parts.push('Weltmeister ' + state.bonusSet.champion);
    if (state.bonusSet.shootouts != null && !shootoutsLocked()) {
      parts.push(state.bonusSet.shootouts + ' Elferschießen');
    }
    const txt = el('span', '');
    txt.innerHTML = window.Icons.svg('trophy') +
      ' <strong>Bonus gesetzt</strong> · ' + parts.join(' · ') + ' (nur auf diesem Gerät)';
    b.appendChild(txt);
    const reset = el('button', 'sim-reset', 'Zurücksetzen');
    reset.addEventListener('click', resetBonus);
    b.appendChild(reset);
    return b;
  }
  function resetBonus() {
    state.bonusSet = { champion: null, shootouts: null };
    saveBonusSet(); recompute(); render();
  }

  // ------- Tipper-Detail-Sheet -------

  function openPlayerSheet(name) {
    const p = state.data.players.find((x) => x.name === name);
    const r = state.standings.find((x) => x.name === name);
    if (!p || !r) return;

    const sheet = $('#sheet');
    sheet.innerHTML = '';

    const head = el('div', 'sheet-head');
    head.appendChild(el('h2', '', name));
    const close = el('button', 'sheet-close');
    close.appendChild(window.Icons.node('x'));
    close.setAttribute('aria-label', 'Schließen');
    close.addEventListener('click', closeSheet);
    head.appendChild(close);
    sheet.appendChild(head);

    const move = r.rankDelta > 0 ? ' (▲' + r.rankDelta + ' durch Live)'
      : r.rankDelta < 0 ? ' (▼' + Math.abs(r.rankDelta) + ' durch Live)' : '';
    sheet.appendChild(el('p', 'sheet-sub',
      'Platz ' + r.rank + move + ' · ' + fmtPts(r.totalLive) + ' Punkte' +
      (r.livePoints > 0 ? ' (davon ' + fmtPts(r.livePoints) + ' live)' : '') +
      ' · ' + r.exact + '× exakt, ' + r.tendency + '× Tendenz'));

    const pills = el('div', 'bonus-pills');
    const champ = el('span', 'bonus-pill');
    champ.innerHTML = 'Weltmeister: <b></b>';
    champ.querySelector('b').textContent = p.bonus.champion || '–';
    pills.appendChild(champ);
    const ts = el('span', 'bonus-pill');
    ts.innerHTML = 'Torjäger: <b></b>';
    ts.querySelector('b').textContent = p.bonus.topscorer
      ? window.Scoring.canonicalScorer(p.bonus.topscorer).name : '–';
    const tsLive = r.bonusDetail.topscorerLive || 0;
    const tsTotal = (r.bonusDetail.topscorer || 0) + tsLive;
    if (tsTotal) {
      ts.appendChild(document.createTextNode(' (+' + fmtPts(tsTotal) + ' P.' +
        (tsLive ? ', davon ' + fmtPts(tsLive) + ' live' : '') + ')'));
    }
    pills.appendChild(ts);
    const em = el('span', 'bonus-pill');
    em.innerHTML = 'Elferschießen: <b></b>';
    em.querySelector('b').textContent = p.bonus.shootouts != null ? String(p.bonus.shootouts) : '–';
    pills.appendChild(em);
    sheet.appendChild(pills);

    // Spiele mit Ergebnis zuerst, dann kommende
    const played = [];
    const upcoming = [];
    for (const m of state.data.matches) {
      const tip = p.tips[m.id];
      if (!tip) continue;
      (state.results[m.id] ? played : upcoming).push(m);
    }

    const addRow = (m) => {
      const { home, away } = teamsOf(m);
      const res = state.results[m.id];
      const tip = p.tips[m.id];
      const row = el('div', 'sheet-match');
      row.appendChild(el('span', '', (home || 'offen') + ' – ' + (away || 'offen')));
      row.appendChild(el('span', 'res', res ? res.home + ':' + res.away : '–:–'));
      row.appendChild(el('span', 'tip', 'Tipp ' + tip[0] + ':' + tip[1]));
      if (res) {
        const pts = window.Scoring.matchPoints(tip, res, m.wert);
        const cls = pts === 0 ? 'zero' : pts > m.wert ? 'exact' : 'tend';
        row.appendChild(el('span', 'pts ' + cls, fmtPts(pts) + (res.live ? ' 🔴' : '')));
      } else {
        row.appendChild(el('span', 'pts zero', ''));
      }
      sheet.appendChild(row);
    };

    played.forEach(addRow);
    if (upcoming.length) {
      sheet.appendChild(el('p', 'sheet-sub', 'Noch offen:'));
      upcoming.slice(0, 30).forEach(addRow);
      if (upcoming.length > 30) {
        sheet.appendChild(el('p', 'empty-hint', '… und ' + (upcoming.length - 30) + ' weitere Tipps'));
      }
    }

    $('#sheet-backdrop').hidden = false;
    // Hintergrund-Scroll sperren, solange das Sheet offen ist
    document.documentElement.style.overflow = 'hidden';
  }

  function closeSheet() {
    $('#sheet-backdrop').hidden = true;
    document.documentElement.style.overflow = '';
  }

  /* Kompaktes Sheet mit der vollständigen Tipper-Liste (Torschützen/Weltmeister/
     Elfmeterschießen) – von der oft abgeschnittenen "+N"-Vorschau aus geöffnet. */
  function openNamesSheet(title, names) {
    const sheet = $('#sheet');
    sheet.innerHTML = '';
    const head = el('div', 'sheet-head');
    head.appendChild(el('h2', '', title));
    const close = el('button', 'sheet-close');
    close.appendChild(window.Icons.node('x'));
    close.setAttribute('aria-label', 'Schließen');
    close.addEventListener('click', closeSheet);
    head.appendChild(close);
    sheet.appendChild(head);
    sheet.appendChild(el('p', 'sheet-sub',
      names.length + (names.length === 1 ? ' Tipper' : ' Tipper:innen')));
    const chips = el('div', 'member-chips');
    names.forEach((n) => {
      const chip = el('span', 'member-chip', n);
      chip.style.cursor = 'pointer';
      chip.addEventListener('click', () => openPlayerSheet(n));
      chips.appendChild(chip);
    });
    sheet.appendChild(chips);
    $('#sheet-backdrop').hidden = false;
    document.documentElement.style.overflow = 'hidden';
  }

  // ---------------------------------------------- Siegerehrung & Statistik --
  // Abschluss-Feature: Sobald das Turnier durch ist, öffnet sich einmalig eine
  // festliche Siegerehrung (Treppchen Einzel- + Familienwertung) und man kann
  // seinen Namen suchen, um persönliche WM-Statistiken zu sehen.

  const CELEBRATE_KEY = 'wm26-celebrated-2026';

  /* Kleine Konfetti-Schicht (rein dekorativ, per CSS animiert). */
  function confettiLayer() {
    const layer = el('div', 'confetti');
    layer.setAttribute('aria-hidden', 'true');
    const cols = ['#6ee7a0', '#ffd166', '#ff5d73', '#7db6ff', '#f4f6fb'];
    for (let i = 0; i < 28; i++) {
      const c = el('i');
      c.style.left = (i / 28 * 100) + '%';
      c.style.background = cols[i % cols.length];
      c.style.animationDelay = (i % 9) * 0.22 + 's';
      c.style.animationDuration = (2.6 + (i % 5) * 0.5) + 's';
      layer.appendChild(c);
    }
    return layer;
  }

  /* Baut ein Sieger-Treppchen (2. – 1. – 3.) aus [{name, sub}, …]. */
  function buildPodium(title, rows) {
    const wrap = el('div', 'podium-block');
    wrap.appendChild(el('h3', 'podium-title', title));
    const pod = el('div', 'podium');
    [1, 0, 2].forEach((i) => {           // Anzeige-Reihenfolge: Silber, Gold, Bronze
      const r = rows[i];
      if (!r) return;
      const place = i + 1;
      const step = el('div', 'podium-step p' + place);
      step.appendChild(el('span', 'podium-medal', place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'));
      step.appendChild(el('span', 'podium-name', r.name));
      step.appendChild(el('span', 'podium-sub', r.sub));
      step.appendChild(el('span', 'podium-bar', String(place)));
      pod.appendChild(step);
    });
    wrap.appendChild(pod);
    return wrap;
  }

  function openCelebration() {
    if (!state.standings.length) return;
    renderCelebrationHome();
    $('#celebrate-backdrop').hidden = false;
    document.documentElement.style.overflow = 'hidden';
  }
  function closeCelebration() {
    $('#celebrate-backdrop').hidden = true;
    document.documentElement.style.overflow = '';
    try { localStorage.setItem(CELEBRATE_KEY, '1'); } catch (e) { /* egal */ }
  }

  /* Beim ersten Öffnen nach Turnierende automatisch die Siegerehrung zeigen
     (danach jederzeit über den Banner erreichbar). */
  function maybeAutoCelebrate() {
    if (!tournamentFinished()) return;
    let seen = false;
    try { seen = localStorage.getItem(CELEBRATE_KEY) === '1'; } catch (e) { /* egal */ }
    if (!seen) openCelebration();
  }

  function celebrateCloseBtn() {
    const close = el('button', 'sheet-close celebrate-close');
    close.appendChild(window.Icons.node('x'));
    close.setAttribute('aria-label', 'Schließen');
    close.addEventListener('click', closeCelebration);
    return close;
  }

  /* Start-Ansicht der Siegerehrung: Gewinner-Held + beide Treppchen. */
  function renderCelebrationHome() {
    const box = $('#celebrate');
    box.innerHTML = '';
    box.scrollTop = 0;
    box.appendChild(confettiLayer());
    box.appendChild(celebrateCloseBtn());

    const champ = state.standings[0];
    const head = el('div', 'celebrate-head');
    head.appendChild(el('div', 'celebrate-trophy', '🏆'));
    head.appendChild(el('p', 'celebrate-kicker', 'WM 2026 · Familien-Tippspiel'));
    head.appendChild(el('p', 'celebrate-congrats', 'Herzlichen Glückwunsch'));
    head.appendChild(el('div', 'celebrate-winner', champ ? champ.name : ''));
    if (champ) {
      head.appendChild(el('p', 'celebrate-sub',
        '1. Platz gesamt · ' + fmtPts(champ.totalLive) + ' Punkte · der Eisbecher ist verdient! 🍨'));
    }
    box.appendChild(head);

    const indiv = state.standings.slice(0, 3).map((r) =>
      ({ name: r.name, sub: fmtPts(r.totalLive) + ' Pkt.' }));
    const fam = state.families.slice(0, 3).map((f) =>
      ({ name: f.name.replace(/^Fam\.\s*/, ''), sub: 'Ø ' + fmtPts(f.average) }));
    box.appendChild(buildPodium('Einzelwertung', indiv));
    box.appendChild(buildPodium('Familienwertung', fam));

    const actions = el('div', 'celebrate-actions');
    const statsBtn = el('button', 'celebrate-btn primary');
    statsBtn.innerHTML = window.Icons.svg('chart') + ' Meine Statistiken ansehen';
    statsBtn.addEventListener('click', renderStatsSearch);
    actions.appendChild(statsBtn);
    const closeBtn = el('button', 'celebrate-btn', 'Schließen');
    closeBtn.addEventListener('click', closeCelebration);
    actions.appendChild(closeBtn);
    box.appendChild(actions);

    box.appendChild(el('p', 'celebrate-thanks', 'Vielen Dank an Basti für die Organisation ❤️'));
  }

  /* Namenssuche für die persönlichen Statistiken. */
  function renderStatsSearch() {
    const box = $('#celebrate');
    box.innerHTML = '';
    box.scrollTop = 0;
    box.appendChild(celebrateCloseBtn());

    const head = el('div', 'stats-head');
    const back = el('button', 'stats-back', '‹ zurück');
    back.addEventListener('click', renderCelebrationHome);
    head.appendChild(back);
    box.appendChild(head);

    box.appendChild(el('h2', 'stats-title', 'Deine WM-Statistiken'));
    box.appendChild(el('p', 'stats-lead', 'Gib deinen Namen ein und entdecke, wie deine WM gelaufen ist.'));

    const input = el('input', 'stats-input');
    input.setAttribute('type', 'text');
    input.setAttribute('placeholder', 'Name eingeben …');
    input.setAttribute('autocomplete', 'off');
    box.appendChild(input);

    const list = el('div', 'stats-namelist');
    box.appendChild(list);

    const names = state.data.players.map((p) => p.name)
      .sort((a, b) => a.localeCompare(b, 'de'));
    const renderList = (q) => {
      list.innerHTML = '';
      const needle = q.trim().toLowerCase();
      const hits = names.filter((n) => n.toLowerCase().includes(needle)).slice(0, 24);
      hits.forEach((n) => {
        const chip = el('button', 'stats-namechip', n);
        chip.addEventListener('click', () => renderStats(n));
        list.appendChild(chip);
      });
      if (!hits.length) list.appendChild(el('p', 'empty-hint', 'Kein Name gefunden.'));
    };
    renderList('');
    input.addEventListener('input', () => renderList(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const needle = input.value.trim().toLowerCase();
      const exact = names.find((n) => n.toLowerCase() === needle);
      const hits = names.filter((n) => n.toLowerCase().includes(needle));
      if (exact) renderStats(exact);
      else if (hits.length === 1) renderStats(hits[0]);
    });
  }

  /* Sammelt die persönlichen Kennzahlen eines Tippers aus dem Endstand. */
  function computePlayerStats(name) {
    const p = state.data.players.find((x) => x.name === name);
    const r = state.standings.find((x) => x.name === name);
    if (!p || !r) return null;

    const total = state.standings.length;
    const allPts = state.standings.map((x) => x.totalLive);
    const avg = allPts.reduce((a, b) => a + b, 0) / (total || 1);

    // Häufigstes getipptes Ergebnis
    const tipCount = new Map();
    for (const id in p.tips) {
      const t = p.tips[id];
      const key = t[0] + ':' + t[1];
      tipCount.set(key, (tipCount.get(key) || 0) + 1);
    }
    let favTip = '–', favN = 0;
    for (const [k, n] of tipCount) if (n > favN) { favN = n; favTip = k; }

    // Bester Einzeltipp (meiste Punkte in einem Spiel)
    let best = null;
    for (const m of state.data.matches) {
      const res = state.results[m.id];
      const tip = p.tips[m.id];
      if (!res || !tip) continue;
      const pts = window.Scoring.matchPoints(tip, res, m.wert);
      if (pts == null) continue;
      if (!best || pts > best.pts) {
        const teams = teamsOf(m);
        best = { pts, home: teams.home, away: teams.away, tip, res };
      }
    }

    const played = r.exact + r.tendency + r.wrong;
    const hitRate = played ? Math.round(((r.exact + r.tendency) / played) * 100) : 0;
    const fam = state.families.find((f) => f.members.includes(name));
    const famRank = fam ? state.families.findIndex((f) => f === fam) + 1 : null;
    // besser als wie viele Prozent der Mitspieler?
    const beaten = total - r.rank;
    const beatPct = total > 1 ? Math.round((beaten / (total - 1)) * 100) : 100;
    const ai = state.standings.find((x) => /charly|chatgpt/i.test(x.name));

    return { p, r, total, avg, favTip, favN, best, played, hitRate, fam, famRank, beaten, beatPct, ai };
  }

  function statTile(value, label, cls) {
    const t = el('div', 'stat-tile' + (cls ? ' ' + cls : ''));
    t.appendChild(el('span', 'stat-value', value));
    t.appendChild(el('span', 'stat-label', label));
    return t;
  }

  /* Persönliche Statistik-Ansicht für einen Namen. */
  function renderStats(name) {
    const s = computePlayerStats(name);
    const box = $('#celebrate');
    box.innerHTML = '';
    box.scrollTop = 0;
    box.appendChild(celebrateCloseBtn());

    const head = el('div', 'stats-head');
    const back = el('button', 'stats-back', '‹ andere Person');
    back.addEventListener('click', renderStatsSearch);
    head.appendChild(back);
    box.appendChild(head);

    if (!s) {
      box.appendChild(el('p', 'empty-hint', 'Keine Daten für „' + name + '“ gefunden.'));
      return;
    }
    const { p, r } = s;

    box.appendChild(el('p', 'stats-kicker', 'WM 2026 · Deine Bilanz'));
    box.appendChild(el('h2', 'stats-name', name));

    // Held: Platzierung
    const podiumEmoji = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : '';
    const hero = el('div', 'stats-hero');
    hero.appendChild(el('div', 'stats-rank', '#' + r.rank + (podiumEmoji ? ' ' + podiumEmoji : '')));
    hero.appendChild(el('div', 'stats-rank-sub',
      'von ' + s.total + ' Tipper:innen · ' + fmtPts(r.totalLive) + ' Punkte'));
    box.appendChild(hero);

    // Kennzahlen-Kacheln
    const grid = el('div', 'stats-grid');
    grid.appendChild(statTile(r.exact, 'exakte Tipps', 'good'));
    grid.appendChild(statTile(r.tendency, 'richtige Tendenz'));
    grid.appendChild(statTile(r.wrong, 'daneben', 'bad'));
    grid.appendChild(statTile(s.hitRate + '%', 'Trefferquote'));
    grid.appendChild(statTile('★ ' + s.favTip, 'Lieblingstipp (' + s.favN + '×)'));
    grid.appendChild(statTile(s.beatPct + '%', 'besser als … der Mitspieler'));
    box.appendChild(grid);

    // Vergleich zum Durchschnitt
    const diff = r.totalLive - s.avg;
    const cmp = el('div', 'stats-compare');
    const arrow = diff >= 0 ? '▲' : '▼';
    const cmpCls = diff >= 0 ? 'good' : 'bad';
    cmp.innerHTML = 'Schnitt aller Tipper: <b>' + fmtPts(s.avg) + '</b> Punkte · ' +
      'du liegst <span class="' + cmpCls + '">' + arrow + ' ' + fmtPts(Math.abs(diff)) + '</span> ' +
      (diff >= 0 ? 'darüber' : 'darunter');
    box.appendChild(cmp);

    // Highlight-Zeilen
    const lines = el('div', 'stats-lines');
    if (s.best) {
      lines.appendChild(statLine('🎯', 'Dein bester Tipp',
        (s.best.home || '?') + ' – ' + (s.best.away || '?') +
        ' (Tipp ' + s.best.tip[0] + ':' + s.best.tip[1] +
        ', Ergebnis ' + s.best.res.home + ':' + s.best.res.away + ') → +' + fmtPts(s.best.pts) + ' Pkt.'));
    }
    if (s.fam) {
      lines.appendChild(statLine('👪', 'Deine Familie',
        s.fam.name + ' · Platz ' + s.famRank + ' von ' + state.families.length +
        ' (Ø ' + fmtPts(s.fam.average) + ')'));
    }
    // Weltmeister-Tipp
    const champTipped = p.bonus.champion || '–';
    const champRight = r.bonusDetail.champion > 0;
    lines.appendChild(statLine(champRight ? '✅' : '❌', 'Weltmeister-Tipp',
      champTipped + (champRight ? ' – goldrichtig! (+' + fmtPts(r.bonusDetail.champion) + ')'
        : ' – Weltmeister wurde ' + state.data.bonus.champion.answer)));
    // Torjäger
    if (p.bonus.topscorer) {
      const g = r.bonusDetail.topscorerGoals || 0;
      lines.appendChild(statLine('⚽', 'Dein Torjäger-Tipp',
        window.Scoring.canonicalScorer(p.bonus.topscorer).name + ' · ' + g +
        ' Tore → +' + fmtPts(r.bonusDetail.topscorer || 0) + ' Pkt.'));
    }
    // Elfmeterschießen
    if (p.bonus.shootouts != null) {
      const shootPts = r.bonusDetail.shootouts;
      const shootAns = state.data.bonus.shootouts.answer;
      lines.appendChild(statLine('🥅', 'Elfmeterschießen',
        'getippt: ' + p.bonus.shootouts + ' · tatsächlich: ' + shootAns +
        (shootPts != null ? ' → ' + (shootPts >= 0 ? '+' : '') + fmtPts(shootPts) + ' Pkt.' : '')));
    }
    // KI-Duell
    if (s.ai && s.ai.name !== name) {
      const beatAI = r.rank < s.ai.rank;
      lines.appendChild(statLine('🤖', 'Duell gegen die KI',
        beatAI ? 'Du hast ChatGPT-Charly geschlagen (Platz ' + s.ai.rank + ')! 🎉'
          : 'ChatGPT-Charly (Platz ' + s.ai.rank + ') lag diesmal vorn – Revanche beim nächsten Mal!'));
    }
    box.appendChild(lines);

    // Abschluss
    const outro = el('div', 'stats-outro');
    outro.appendChild(el('p', 'stats-outro-big', 'Bis zum nächsten Mal! 👋'));
    outro.appendChild(el('p', 'stats-outro-small', 'Vielen Dank an Basti für die Organisation ❤️'));
    box.appendChild(outro);
  }

  function statLine(icon, label, text) {
    const row = el('div', 'stat-line');
    row.appendChild(el('span', 'stat-line-icon', icon));
    const body = el('span', 'stat-line-body');
    body.appendChild(el('span', 'stat-line-label', label));
    body.appendChild(el('span', 'stat-line-text', text));
    row.appendChild(body);
    return row;
  }

  /* Auffälliger Einstieg (in Spiele-/Wertungs-Ansicht), um die Siegerehrung
     jederzeit erneut zu öffnen. */
  function celebrationBanner() {
    const b = el('button', 'celebrate-banner');
    b.innerHTML = '<span class="cb-emoji">🏆</span>' +
      '<span class="cb-text"><strong>Die WM 2026 ist entschieden!</strong>' +
      '<span>Siegerehrung &amp; persönliche Statistiken ansehen</span></span>' +
      '<span class="cb-arrow">›</span>';
    b.addEventListener('click', openCelebration);
    return b;
  }

  // ------------------------------------------------------------------ Tabs --

  function initIcons() {
    const t = $('#title-icon');
    if (t) t.appendChild(window.Icons.node('trophy'));
    document.querySelectorAll('.seg-btn[data-icon]').forEach((b) => {
      b.insertBefore(window.Icons.node(b.dataset.icon), b.firstChild);
    });
  }

  /* Schiebt die Glas-Pille unter den aktiven Tab. */
  function moveIndicator() {
    const ind = $('#seg-indicator');
    const active = document.querySelector('.seg-btn.active');
    if (!ind || !active) return;
    ind.style.width = active.offsetWidth + 'px';
    ind.style.transform = 'translateX(' + active.offsetLeft + 'px)';
  }

  function initTabs() {
    $('#tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn || btn.dataset.tab === state.tab) return;
      const scroller = document.scrollingElement || document.documentElement;
      // Scroll-Position der verlassenen Ansicht merken
      state.scrollPos = state.scrollPos || {};
      state.scrollPos[state.tab] = scroller.scrollTop;

      state.tab = btn.dataset.tab;
      document.querySelectorAll('.seg-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      document.querySelectorAll('.view').forEach((v) =>
        v.hidden = v.id !== 'view-' + state.tab);
      moveIndicator();
      // Position wiederherstellen; Spiele starten beim aktuellen Spieltag
      if (state.scrollPos[state.tab] != null) {
        scroller.scrollTop = state.scrollPos[state.tab];
      } else if (state.tab === 'spiele') {
        scrollToCurrentMatchday();
      } else {
        scroller.scrollTop = 0;
      }
    });
    window.addEventListener('resize', moveIndicator);

    // Tipp auf den Status = sofort aktualisieren
    const statusArea = document.querySelector('.topbar-status');
    if (CFG.proxyUrl && statusArea) {
      statusArea.title = 'Jetzt aktualisieren';
      statusArea.addEventListener('click', refreshLive);
    }

    $('#sheet-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'sheet-backdrop') closeSheet();
    });
    $('#celebrate-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'celebrate-backdrop') closeCelebration();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#celebrate-backdrop').hidden) closeCelebration();
      else closeSheet();
    });
  }

  // ------------------------------------------------------------------ Start --

  function showFatal(err) {
    console.error(err);
    const app = $('#app');
    app.innerHTML = '';
    app.appendChild(el('div', 'banner',
      '⚠️ Fehler beim Start der App: ' + (err && err.message ? err.message : err)));
    const st = $('#status-text');
    if (st) st.textContent = 'Fehler';
  }

  async function start() {
    initIcons();
    initTabs();
    try {
      await loadStatic();
      // Bewusst KEIN vorzeitiges Laden des Caches: Live-Daten sind Primärquelle
      // und werden zuerst abgerufen (siehe refreshLive). Der lokale Schnappschuss
      // greift ausschließlich, wenn der Live-Abruf fehlschlägt.
      recompute();
      render();
      // Beim Laden direkt am aktuellen Spieltag landen
      const afterLayout = window.requestAnimationFrame
        ? window.requestAnimationFrame.bind(window)
        : (fn) => setTimeout(fn, 0);
      afterLayout(() => {
        moveIndicator();
        scrollToCurrentMatchday();
      });
      // Nach Turnierende einmalig automatisch die Siegerehrung zeigen.
      maybeAutoCelebrate();
    } catch (err) {
      showFatal(err);
      return;
    }
    if (CFG.proxyUrl) {
      refreshLive().finally(scheduleNextPoll);
      // Bei Rückkehr in den Tab sofort aktualisieren und Takt neu setzen
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshLive().finally(scheduleNextPoll);
      });
    }
  }

  // Unerwartete Fehler sichtbar machen statt still zu scheitern
  window.addEventListener('error', (e) => {
    const st = $('#status-text');
    if (st && st.textContent === 'lädt …') {
      st.textContent = 'Fehler: ' + e.message;
    }
  });

  start();
})();
