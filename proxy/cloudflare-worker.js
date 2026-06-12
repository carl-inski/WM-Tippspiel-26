/*
 * Cloudflare-Worker-Proxy für football-data.org
 *
 * Warum? football-data.org erlaubt keine direkten Browser-Zugriffe (CORS)
 * und der API-Key darf nicht im öffentlichen Frontend stehen. Dieser Worker
 * leitet genau zwei Endpunkte weiter, hängt den Key serverseitig an und
 * cached die Antworten 30 Sekunden (schont das Limit von 10 Anfragen/Minute).
 *
 * Einrichtung (einmalig, ~10 Minuten, alles kostenlos):
 *  1. Kostenlosen API-Key holen: https://www.football-data.org/client/register
 *  2. Bei Cloudflare anmelden: https://dash.cloudflare.com -> Workers & Pages
 *     -> Create Worker -> diesen Code einfügen -> Deploy
 *  3. Im Worker unter Settings -> Variables and Secrets:
 *     Secret anlegen: Name FOOTBALL_DATA_API_KEY, Wert = dein API-Key
 *  4. Die Worker-URL (https://<name>.<account>.workers.dev) in js/config.js
 *     als proxyUrl eintragen.
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    const target = ROUTES[url.pathname.replace(/\/$/, '') || '/'];
    if (!target) {
      return new Response(JSON.stringify({ error: 'Unbekannter Pfad. Erlaubt: /matches, /scorers' }), {
        status: 404,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS }
      });
    }

    const upstream = await fetch('https://api.football-data.org' + target, {
      headers: { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY },
      cf: { cacheTtl: 30, cacheEverything: true }
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=30',
        ...CORS_HEADERS
      }
    });
  }
};
