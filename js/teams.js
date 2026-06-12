/*
 * Team-Stammdaten: deutscher Name (wie im Excel-Tippzettel) ->
 * Aliasse für das Matching mit football-data.org (englische Namen, TLA)
 * und ISO-Code für die Flaggen-Anzeige.
 *
 * Das Matching gegen die API läuft über normalisierte Namen; zusätzlich
 * wird über Anstoßzeit gematcht (siehe api.js), so dass auch bei
 * abweichenden API-Schreibweisen nichts verloren geht.
 */
(function () {
  'use strict';


const TEAMS = {
  'Algerien':        { flag: 'dz', aliases: ['Algeria', 'ALG'] },
  'Argentinien':     { flag: 'ar', aliases: ['Argentina', 'ARG'] },
  'Australien':      { flag: 'au', aliases: ['Australia', 'AUS'] },
  'Belgien':         { flag: 'be', aliases: ['Belgium', 'BEL'] },
  'Bosnien-Herzeg.': { flag: 'ba', aliases: ['Bosnia and Herzegovina', 'Bosnia-Herzegovina', 'Bosnia', 'BIH'] },
  'Brasilien':       { flag: 'br', aliases: ['Brazil', 'BRA'] },
  'Curacao':         { flag: 'cw', aliases: ['Curaçao', 'Curacao', 'CUW'] },
  'Deutschland':     { flag: 'de', aliases: ['Germany', 'GER', 'DEU'] },
  'Ecuador':         { flag: 'ec', aliases: ['Ecuador', 'ECU'] },
  'Elfenbeinküste':  { flag: 'ci', aliases: ['Ivory Coast', "Côte d'Ivoire", "Cote d'Ivoire", 'CIV'] },
  'England':         { flag: 'gb-eng', aliases: ['England', 'ENG'] },
  'Frankreich':      { flag: 'fr', aliases: ['France', 'FRA'] },
  'Ghana':           { flag: 'gh', aliases: ['Ghana', 'GHA'] },
  'Haiti':           { flag: 'ht', aliases: ['Haiti', 'HAI', 'HTI'] },
  'IR Iran':         { flag: 'ir', aliases: ['Iran', 'IR Iran', 'IRN'] },
  'Irak':            { flag: 'iq', aliases: ['Iraq', 'IRQ'] },
  'Japan':           { flag: 'jp', aliases: ['Japan', 'JPN'] },
  'Jordanien':       { flag: 'jo', aliases: ['Jordan', 'JOR'] },
  'Kanada':          { flag: 'ca', aliases: ['Canada', 'CAN'] },
  'Kap Verde':       { flag: 'cv', aliases: ['Cape Verde Islands', 'Cape Verde', 'Cabo Verde', 'CPV'] },
  'Katar':           { flag: 'qa', aliases: ['Qatar', 'QAT'] },
  'Kolumbien':       { flag: 'co', aliases: ['Colombia', 'COL'] },
  'Kongo':           { flag: 'cd', aliases: ['DR Congo', 'Congo DR', 'Democratic Republic of the Congo', 'COD'] },
  'Kroatien':        { flag: 'hr', aliases: ['Croatia', 'CRO', 'HRV'] },
  'Marokko':         { flag: 'ma', aliases: ['Morocco', 'MAR'] },
  'Mexiko':          { flag: 'mx', aliases: ['Mexico', 'MEX'] },
  'Neuseeland':      { flag: 'nz', aliases: ['New Zealand', 'NZL'] },
  'Niederlande':     { flag: 'nl', aliases: ['Netherlands', 'Holland', 'NED', 'NLD'] },
  'Norwegen':        { flag: 'no', aliases: ['Norway', 'NOR'] },
  'Panama':          { flag: 'pa', aliases: ['Panama', 'PAN'] },
  'Paraguay':        { flag: 'py', aliases: ['Paraguay', 'PAR', 'PRY'] },
  'Portugal':        { flag: 'pt', aliases: ['Portugal', 'POR', 'PRT'] },
  'Saudi-Arabien':   { flag: 'sa', aliases: ['Saudi Arabia', 'KSA', 'SAU'] },
  'Schottland':      { flag: 'gb-sct', aliases: ['Scotland', 'SCO'] },
  'Schweden':        { flag: 'se', aliases: ['Sweden', 'SWE'] },
  'Schweiz':         { flag: 'ch', aliases: ['Switzerland', 'SUI', 'CHE'] },
  'Senegal':         { flag: 'sn', aliases: ['Senegal', 'SEN'] },
  'Spanien':         { flag: 'es', aliases: ['Spain', 'ESP'] },
  'Südafrika':       { flag: 'za', aliases: ['South Africa', 'RSA', 'ZAF'] },
  'Südkorea':        { flag: 'kr', aliases: ['South Korea', 'Korea Republic', 'Republic of Korea', 'KOR'] },
  'Tschechien':      { flag: 'cz', aliases: ['Czechia', 'Czech Republic', 'CZE'] },
  'Tunesien':        { flag: 'tn', aliases: ['Tunisia', 'TUN'] },
  'Türkei':          { flag: 'tr', aliases: ['Turkey', 'Türkiye', 'Turkiye', 'TUR'] },
  'USA':             { flag: 'us', aliases: ['United States', 'USA', 'United States of America'] },
  'Uruguay':         { flag: 'uy', aliases: ['Uruguay', 'URU', 'URY'] },
  'Usbekistan':      { flag: 'uz', aliases: ['Uzbekistan', 'UZB'] },
  'Ägypten':         { flag: 'eg', aliases: ['Egypt', 'EGY'] },
  'Österreich':      { flag: 'at', aliases: ['Austria', 'AUT'] }
};

function normTeam(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* Index: normalisierter Alias -> deutscher Name */
const ALIAS_INDEX = (() => {
  const idx = new Map();
  for (const [de, info] of Object.entries(TEAMS)) {
    idx.set(normTeam(de), de);
    for (const a of info.aliases) idx.set(normTeam(a), de);
  }
  return idx;
})();

/* Findet zum API-Teamnamen (name/shortName/tla) den deutschen Excel-Namen. */
function toGermanName(...apiNames) {
  for (const n of apiNames) {
    if (!n) continue;
    const hit = ALIAS_INDEX.get(normTeam(n));
    if (hit) return hit;
  }
  return null;
}

function flagEmoji(germanName) {
  const info = TEAMS[germanName];
  if (!info) return '⚽';
  const code = info.flag;
  const special = { 'gb-eng': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'gb-sct': '🏴󠁧󠁢󠁳󠁣󠁴󠁿' };
  if (special[code]) return special[code];
  const A = 0x1F1E6;
  return String.fromCodePoint(A + code.charCodeAt(0) - 97, A + code.charCodeAt(1) - 97);
}

const api = { TEAMS, toGermanName, flagEmoji, normTeam };
if (typeof module === 'object' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.Teams = api;

})();
