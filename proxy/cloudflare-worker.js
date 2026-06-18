/*
 * Cloudflare-Worker-Proxy für football-data.org – mit serverseitigem
 * Fallback-Zwischenspeicher (KV).
 *
 * Warum? football-data.org erlaubt keine direkten Browser-Zugriffe (CORS)
 * und der API-Key darf nicht im öffentlichen Frontend stehen. Dieser Worker
 * leitet genau zwei Endpunkte weiter, hängt den Key serverseitig an und
 * cached die Antworten 20 Sekunden (schont das Limit von 10 Anfragen/Minute).
 *
 * Robustheit: Jede *erfolgreiche* Antwort wird zusätzlich in KV abgelegt.
 * Ist der Upstream gestört (Rate-Limit 429, 5xx, Timeout), liefert der Worker
 * den zuletzt gespeicherten guten Stand aus KV aus (Header x-data-source:
 * stale) – so hat die Website auch bei API-Ausfall immer einen aktuellen
 * Zwischenstand. Der Upstream bleibt Primärquelle.
 *
 * Einrichtung (einmalig):
 *  1. Kostenlosen API-Key: https://www.football-data.org/client/register
 *  2. Dashboard -> Workers & Pages -> diesen Worker -> Code einfügen -> Deploy
 *  3. Settings -> Variables and Secrets: Secret FOOTBALL_DATA_API_KEY = Key
 *  4. Settings -> Bindings -> KV Namespace Binding hinzufügen:
 *       Variablenname: LIVE_CACHE
 *       Namespace:     wm-tippspiel-live-cache
 *     (per wrangler ist das Binding bereits in wrangler.toml hinterlegt.)
 *
 * Ohne LIVE_CACHE-Binding verhält sich der Worker wie zuvor (nur Proxy).
 */

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
    headers: Object.assign({
      'content-type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }, extra || {})
  });
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

    const cacheKey = 'snap:' + route;

    // 1) Upstream versuchen (Primärquelle)
    let upstream = null;
    let body = null;
    let ok = false;
    try {
      upstream = await fetch('https://api.football-data.org' + target, {
        headers: { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY },
        cf: { cacheTtl: 20, cacheEverything: true }
      });
      body = await upstream.text();
      ok = upstream.ok;
    } catch (e) {
      ok = false;
    }

    // 2) Erfolg -> ausliefern und als letzten guten Stand in KV sichern
    if (ok) {
      if (env.LIVE_CACHE) {
        // best effort, blockiert die Antwort nicht hart
        try {
          await env.LIVE_CACHE.put(cacheKey, body, { metadata: { ts: Date.now() } });
        } catch (e) { /* KV-Schreibfehler ignorieren */ }
      }
      return jsonResponse(body, 200, {
        'cache-control': 'public, max-age=20',
        'x-data-source': 'live'
      });
    }

    // 3) Upstream gestört -> letzten guten Stand aus KV liefern
    if (env.LIVE_CACHE) {
      try {
        const cached = await env.LIVE_CACHE.getWithMetadata(cacheKey);
        if (cached && cached.value) {
          const ts = (cached.metadata && cached.metadata.ts) || 0;
          return jsonResponse(cached.value, 200, {
            'cache-control': 'public, max-age=10',
            'x-data-source': 'stale',
            'x-snapshot-age': String(Date.now() - ts)
          });
        }
      } catch (e) { /* KV-Lesefehler -> unten Fehler durchreichen */ }
    }

    // 4) Kein Fallback vorhanden -> Originalfehler durchreichen
    return jsonResponse(
      body || JSON.stringify({ error: 'Upstream nicht erreichbar' }),
      upstream ? upstream.status : 502,
      { 'x-data-source': 'error' });
  }
};
