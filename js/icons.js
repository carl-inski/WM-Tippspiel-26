/*
 * Monochrome Stroke-Icons im SF-Symbols-Stil (Pfade nach Lucide, MIT).
 * Liefert SVG-Strings bzw. fertige DOM-Knoten; Farbe über currentColor.
 */
(function () {
  'use strict';

  const PATHS = {
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="4"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5 16.3 10.6 14.66 15.7H9.34L7.7 10.6 12 7.5Z"/><path d="M12 3v4.5"/><path d="m20.6 9-4.3 1.6"/><path d="m17.7 19.4-3.04-3.7"/><path d="m6.3 19.4 3.04-3.7"/><path d="M3.4 9l4.3 1.6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    updown: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'
  };

  function svg(name, cls) {
    return '<svg class="icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + (PATHS[name] || '') + '</svg>';
  }

  function node(name, cls) {
    const span = document.createElement('span');
    span.innerHTML = svg(name, cls);
    return span.firstChild;
  }

  const api = { svg, node, PATHS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Icons = api;
})();
