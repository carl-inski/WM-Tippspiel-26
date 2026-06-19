/*
 * Cloudflare-Worker-Proxy für das WM-Tippspiel – Hybrid aus zwei Quellen.
 *
 * Quellen:
 *  - football-data.org  : Spielplan, Endergebnisse, Torschützen (Basis).
 *  - Highlightly        : echte In-Play-Live-Stände (football-data liefert im
 *                         Free-Tarif keine Live-Daten während des Spiels).
 *
 * /matches:
 *   1) football-data laden (Basis).
 *   2) Nur wenn gerade ein Spiel im Anstoß-Fenster ist (spart Highlightly-
 *      Kontingent von 100/Tag), Highlightly für heute laden (Edge-Cache 120s).
 *   3) Laufende/eben beendete Spiele per Anstoßzeit + Teamname zuordnen und den
 *      Live-Stand einblenden (status IN_PLAY/FINISHED, score.fullTime). Schlägt
 *      Highlightly fehl/ist das Kontingent erschöpft -> unverändert
 *      football-data ausliefern (nie schlechter).
 * /scorers: football-data (wie bisher).
 *
 * Fallback bei football-data-Störung läuft CLIENT-seitig (localStorage-
 * Schnappschuss in der Web-App) – bewusst KEIN Workers-KV, da dessen Free-
 * Limit (1.000 Schreibvorgänge/Tag) bei Polling sofort gesprengt würde.
 *
 * Secrets (Settings -> Variables and Secrets):
 *   FOOTBALL_DATA_API_KEY   football-data.org API-Key
 *   HIGHLIGHTLY_API_KEY     Highlightly API-Key (für Live-Stände)
 */

const FD = 'https://api.football-data.org';
const HL = 'https://soccer.highlightly.net';
const HL_LEAGUE = '1635'; // FIFA World Cup 2026

const ROUTES = {
  '/matches': '/v4/competitions/WC/matches',
  '/scorers': '/v4/competitions/WC/scorers?limit=100'
};

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type'
};

function jsonResponse(body, status, extra) {
  return new Response(body, {
    status,
    headers: Object.assign(
      { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
      extra || {})
  });
}

/* Teamnamen tolerant vergleichen (football-data vs. Highlightly-Schreibweisen,
   z. B. "Czechia"/"Czech Republic", "Bosnia-Herzegovina"/"Bosnia & Herzegovina"). */
function normName(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
}
function nameSim(a, b) {
  a = normName(a); b = normName(b);
  if (!a || !b) return false;
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  return a.slice(0, 5).length >= 4 && a.slice(0, 5) === b.slice(0, 5);
}

function parseScore(cur) {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(cur || '').trim());
  return m ? { home: +m[1], away: +m[2] } : null;
}

const DEAD_STATES = ['not started', 'postponed', 'cancelled', 'canceled',
  'abandoned', 'suspended', 'awarded', 'tbd', 'to be decided', ''];
function isLiveDesc(d) {
  return !DEAD_STATES.includes(String(d || '').toLowerCase());
}

async function highlightlyForDate(env, dateStr) {
  if (!env.HIGHLIGHTLY_API_KEY) return null;
  const url = HL + '/matches?leagueId=' + HL_LEAGUE + '&date=' + dateStr + '&limit=50';
  const r = await fetch(url, {
    headers: { 'X-RapidAPI-Key': env.HIGHLIGHTLY_API_KEY },
    cf: { cacheTtl: 120, cacheEverything: true } // schont das 100/Tag-Limit
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return (j && (j.data || j.matches)) || null;
}

/* Blendet Highlightly-Live-Stände in die football-data-Spiele ein.
   Gibt die Zahl der überschriebenen Spiele zurück (0 = kein Overlay). */
async function overlayLive(fd, env) {
  const matches = (fd && fd.matches) || [];
  const now = Date.now();

  // Nur fragen, wenn ein Spiel gerade im Fenster ist (Anpfiff -1min .. +3h,
  // football-data noch nicht FINISHED).
  const inWindow = matches.filter((m) => {
    if (m.status === 'FINISHED') return false;
    const t = Date.parse(m.utcDate);
    return t && now >= t - 60000 && now <= t + 3 * 3600 * 1000;
  });
  if (!inWindow.length) return 0;

  const dates = [...new Set(inWindow.map((m) => String(m.utcDate).slice(0, 10)))];
  let hl = [];
  for (const d of dates) {
    const list = await highlightlyForDate(env, d);
    if (list) hl = hl.concat(list);
  }
  if (!hl.length) return 0;

  let overlaid = 0;
  for (const hm of hl) {
    const sc = parseScore(hm.state && hm.state.score && hm.state.score.current);
    if (!sc) continue;
    const desc = hm.state && hm.state.description;
    const finished = String(desc || '').toLowerCase() === 'finished';
    if (!finished && !isLiveDesc(desc)) continue;

    const t = Date.parse(hm.date);
    const cand = matches.filter((m) =>
      m.status !== 'FINISHED' && Math.abs(Date.parse(m.utcDate) - t) <= 120000);
    let fdm = cand.find((m) =>
      nameSim(m.homeTeam && m.homeTeam.name, hm.homeTeam && hm.homeTeam.name) &&
      nameSim(m.awayTeam && m.awayTeam.name, hm.awayTeam && hm.awayTeam.name));
    if (!fdm && cand.length === 1) fdm = cand[0];
    if (!fdm) continue;

    fdm.score = fdm.score || {};
    fdm.score.fullTime = { home: sc.home, away: sc.away };
    if (!fdm.score.duration) fdm.score.duration = 'REGULAR';
    fdm.status = finished ? 'FINISHED' : 'IN_PLAY';
    overlaid++;
  }
  return overlaid;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const route = url.pathname.replace(/\/$/, '') || '/';
    const target = ROUTES[route];
    if (!target) {
      return jsonResponse(
        JSON.stringify({ error: 'Unbekannter Pfad. Erlaubt: /matches, /scorers' }), 404);
    }

    // football-data (Primärquelle)
    let upstream = null, body = null, ok = false;
    try {
      upstream = await fetch(FD + target, {
        headers: { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY },
        cf: { cacheTtl: 20, cacheEverything: true }
      });
      body = await upstream.text();
      ok = upstream.ok;
    } catch (e) { ok = false; }

    if (!ok) {
      // Kein Server-Cache mehr: die Web-App fällt client-seitig auf ihren
      // letzten lokalen Schnappschuss bzw. die Excel zurück.
      return jsonResponse(
        body || JSON.stringify({ error: 'Upstream nicht erreichbar' }),
        upstream ? upstream.status : 502,
        { 'x-data-source': 'error' });
    }

    let liveCount = 0;
    if (route === '/matches') {
      try {
        const fd = JSON.parse(body);
        liveCount = await overlayLive(fd, env);
        if (liveCount) body = JSON.stringify(fd);
      } catch (e) { /* Overlay-Fehler ignorieren -> football-data pur */ }
    }

    return jsonResponse(body, 200, {
      'cache-control': 'public, max-age=' + (route === '/matches' ? 15 : 20),
      'x-data-source': 'live',
      'x-live-overlay': String(liveCount)
    });
  }
};
