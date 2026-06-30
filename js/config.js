/*
 * Konfiguration der Live-App.
 *
 * proxyUrl: URL des Cloudflare-Worker-Proxys (siehe proxy/cloudflare-worker.js
 * und README). Solange leer, läuft die App im Offline-Modus und zeigt die
 * Stände aus der importierten Excel + data/manual-results.json.
 */
window.APP_CONFIG = {
  // App-Version – wird im Footer angezeigt und mit jeder Änderung erhöht.
  version: '1.9.0',
  proxyUrl: 'https://wm-tippspiel-proxy.f655fr7vs6.workers.dev',
  // Aktualisierungsintervall in Sekunden: schnell während laufender Spiele,
  // sparsam wenn gerade kein Spiel live ist (schont das API-/Worker-Limit).
  livePollSeconds: 20,
  idlePollSeconds: 60
};
