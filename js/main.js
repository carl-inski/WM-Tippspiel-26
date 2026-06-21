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
    simGoals: {}         // { kanonischerName: +n } – simulierte WM-Tore (Torjäger)
  };

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
    const [data, manual, scorerOv, resultOv] = await Promise.all([
      fetch('data/tippspiel.json' + cb).then((r) => {
        if (!r.ok) throw new Error('data/tippspiel.json nicht erreichbar (HTTP ' + r.status + ')');
        return r.json();
      }),
      fetch('data/manual-results.json' + cb).then((r) => r.json()).catch(() => ({ results: {} })),
      fetch('data/scorer-overrides.json' + cb).then((r) => r.json()).catch(() => ({ overrides: {} })),
      fetch('data/result-overrides.json' + cb).then((r) => r.json()).catch(() => ({ results: {} }))
    ]);
    state.data = data;
    state.manual = manual.results || {};
    // Korrekturen für Torschützen, falls die Quelle (football-data) hängt.
    // Wirken als Untergrenze (Floor) – echte höhere Stände bleiben unangetastet.
    state.scorerOverrides = (scorerOv && scorerOv.overrides) || {};
    state.data.manualScorers = applyScorerOverrides(state.data.manualScorers);
    // Ergebnis-Korrekturen: gewinnen über BEIDE APIs (football-data + Highlightly),
    // falls eine Quelle ein falsches Endergebnis liefert.
    state.resultOverrides = {};
    for (const [id, sc] of Object.entries((resultOv && resultOv.results) || {})) {
      if (sc && sc.home != null && sc.away != null) {
        state.resultOverrides[id] = { home: sc.home, away: sc.away, finished: true };
      }
    }
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

  function recompute() {
    const apiResults = state.apiState ? state.apiState.results : null;
    // Reihenfolge = Priorität (später gewinnt): Excel < manuell < API <
    // Ergebnis-Korrektur < Simulation. Die Korrektur überschreibt falsche
    // API-Endergebnisse; die Simulation bleibt als Vorschau ganz oben.
    state.results = window.Scoring.mergeResults(
      excelResults(), state.manual, apiResults, state.resultOverrides, simResults());
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
    if (!Object.keys(sim).length) return base;
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
    return Object.assign({}, base, { scorers: [...map.values()], realScorers });
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
        state.apiState.extras.scorers = applyScorerOverrides(state.apiState.extras.scorers);
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
      // Quell-Korrekturen anwenden (z. B. hängender Torschützenstand)
      if (state.apiState.extras) {
        state.apiState.extras.scorers = applyScorerOverrides(state.apiState.extras.scorers);
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
    return {
      home: m.home || (info && info.homeDE) || null,
      away: m.away || (info && info.awayDE) || null
    };
  }

  function anyLive() {
    return Object.values(state.results).some((r) => r.live && !r.sim);
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
      sc.textContent = res.home + ' : ' + res.away;
      const info = matchInfo(m.id);
      if (info && info.penalties && info.penalties.home != null) {
        sc.textContent += ' (' + info.penalties.home + ':' + info.penalties.away + ' i. E.)';
      }
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
      nameWrap.appendChild(el('span', '', name + ' '));
      if (picks && picks.length) {
        nameWrap.appendChild(el('span', 'picks',
          '· getippt von ' + picks.slice(0, 6).join(', ') +
          (picks.length > 6 ? ' +' + (picks.length - 6) : '')));
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
    let aRank = 0, aPrev = NaN;
    merged.slice(0, 40).forEach((s) => {
      if (s.goals !== aPrev) { aRank += 1; aPrev = s.goals; }
      allCard.appendChild(
        scorerRow(String(aRank), s.name, teamFor(s.name), picksByCanon.get(s.name), false, false));
    });
    view.appendChild(allCard);
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
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSheet();
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
