/*
 * Konfiguration der Live-App.
 *
 * proxyUrl: URL des Cloudflare-Worker-Proxys (siehe proxy/cloudflare-worker.js
 * und README). Solange leer, läuft die App im Offline-Modus und zeigt die
 * Stände aus der importierten Excel + data/manual-results.json.
 */
window.APP_CONFIG = {
  proxyUrl: 'https://wm-tippspiel-proxy.f655fr7vs6.workers.dev',
  pollSeconds: 60
};
