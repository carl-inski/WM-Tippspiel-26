/*
 * Live-Daten-Anbindung (football-data.org über den eigenen Worker-Proxy).
 *
 * Liefert:
 *  - results:   { matchId: {home, away, live, finished} } für die Wertung
 *  - matchInfo: { matchId: {status, utcDate, homeDE, awayDE, penalties} } für die UI
 *  - extras:    { championTeam, scorers, shootoutCount, tournamentFinished }
 */
(function () {
  'use strict';

  const Teams = (typeof window !== 'undefined' && window.Teams) ||
    (typeof require === 'function' ? require('./teams.js') : null);

  const LIVE_STATUSES = ['IN_PLAY', 'PAUSED'];
  const KO_STAGES_BIS_HF = ['LAST_32', 'LAST_16', 'ROUND_OF_32', 'ROUND_OF_16', 'QUARTER_FINALS', 'SEMI_FINALS'];

  /* Robustes Parsen der Anstoßzeit (z. B. "2026-06-11T21:00+02:00").
   * Safari lehnt ISO-Strings ohne Sekunden teils ab, daher manuell. */
  function parseKickoff(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:([+-])(\d{2}):(\d{2})|Z)?$/.exec(String(s || ''));
    if (!m) return new Date(s);
    let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7]) t -= (m[7] === '+' ? 1 : -1) * ((+m[8]) * 60 + (+m[9])) * 60000;
    return new Date(t);
  }

  async function fetchJson(url) {
    const resp = await fetch(url, { headers: { accept: 'application/json' } });
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' für ' + url);
    return resp.json();
  }

  /* Holt Spiele + Torschützen über den Proxy. */
  async function fetchLive(proxyUrl) {
    const base = proxyUrl.replace(/\/$/, '');
    const [matchData, scorerData] = await Promise.all([
      fetchJson(base + '/matches'),
      fetchJson(base + '/scorers').catch(() => null) // Torschützen sind optional
    ]);
    return {
      apiMatches: matchData.matches || [],
      apiScorers: (scorerData && scorerData.scorers) || []
    };
  }

  function germanTeam(t) {
    if (!t) return null;
    return Teams.toGermanName(t.name, t.shortName, t.tla);
  }

  /* Ordnet ein API-Spiel einem Excel-Spiel zu: erst über Teamnamen,
   * dann über die Anstoßzeit (wichtig für K.o.-Spiele, deren Teams im
   * Excel noch fehlen). */
  function findExcelMatch(data, am, used) {
    const gH = germanTeam(am.homeTeam);
    const gA = germanTeam(am.awayTeam);
    if (gH && gA) {
      const hit = data.matches.find((m) => !used.has(m.id) && m.home === gH && m.away === gA);
      if (hit) return hit;
    }
    const t = parseKickoff(am.utcDate).getTime();
    if (!isNaN(t)) {
      const exact = data.matches.filter((m) => !used.has(m.id) && parseKickoff(m.kickoff).getTime() === t);
      if (exact.length === 1) return exact[0];
      const near = data.matches.filter((m) => !used.has(m.id) &&
        Math.abs(parseKickoff(m.kickoff).getTime() - t) <= 60 * 60 * 1000 && !m.home && !m.away);
      if (near.length === 1) return near[0];
    }
    return null;
  }

  /* Wandelt die API-Antwort in Ergebnis-/Info-Strukturen der App um. */
  function mapLiveData(data, apiMatches, apiScorers) {
    const results = {};
    const matchInfo = {};
    const used = new Set();
    let championTeam = null;
    let shootoutCount = 0;
    let tournamentFinished = false;

    for (const am of apiMatches) {
      const m = findExcelMatch(data, am, used);
      if (!m) continue;
      used.add(m.id);

      const score = am.score || {};
      const ft = score.fullTime || {};
      const live = LIVE_STATUSES.includes(am.status);
      const finished = am.status === 'FINISHED';

      matchInfo[m.id] = {
        status: am.status,
        utcDate: am.utcDate,
        group: am.group || null,
        homeDE: germanTeam(am.homeTeam),
        awayDE: germanTeam(am.awayTeam),
        crestHome: am.homeTeam && am.homeTeam.crest,
        crestAway: am.awayTeam && am.awayTeam.crest,
        penalties: score.duration === 'PENALTY_SHOOTOUT' ? (score.penalties || {}) : null
      };

      if ((live || finished) && ft.home != null && ft.away != null) {
        // fullTime = Stand nach 90/120 Min (Elfmeterschießen zählt fürs
        // Tippspiel nicht ins Ergebnis, steckt in score.penalties)
        results[m.id] = { home: ft.home, away: ft.away, live, finished };
      }

      if (score.duration === 'PENALTY_SHOOTOUT' && finished &&
          KO_STAGES_BIS_HF.includes(am.stage)) {
        shootoutCount++;
      }
      if (am.stage === 'FINAL' && finished && score.winner) {
        tournamentFinished = true;
        championTeam = score.winner === 'HOME_TEAM' ? germanTeam(am.homeTeam)
          : score.winner === 'AWAY_TEAM' ? germanTeam(am.awayTeam) : null;
      }
    }

    const scorers = apiScorers.map((s) => ({
      name: (s.player && s.player.name) || '?',
      goals: s.goals || 0,
      teamDE: germanTeam(s.team),
      crest: s.team && s.team.crest
    }));

    return { results, matchInfo, extras: { championTeam, scorers, shootoutCount, tournamentFinished } };
  }

  const api = { fetchLive, mapLiveData, findExcelMatch, parseKickoff };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LiveApi = api;
})();
