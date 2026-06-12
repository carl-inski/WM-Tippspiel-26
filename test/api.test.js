/* Tests für das Mapping football-data.org -> Tippspiel (js/api.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const LiveApi = require('../js/api.js');

const data = require(path.join(__dirname, '..', 'data', 'tippspiel.json'));

function apiMatch(over) {
  return Object.assign({
    status: 'FINISHED',
    stage: 'GROUP_STAGE',
    utcDate: '2026-06-11T19:00:00Z',
    homeTeam: { name: 'Mexico' },
    awayTeam: { name: 'South Africa' },
    score: { duration: 'REGULAR', fullTime: { home: 2, away: 0 }, winner: 'HOME_TEAM' }
  }, over);
}

test('Gruppenspiel wird über Teamnamen zugeordnet', () => {
  const { results, matchInfo } = LiveApi.mapLiveData(data, [apiMatch({})], []);
  assert.deepEqual(results.m001, { home: 2, away: 0, live: false, finished: true });
  assert.equal(matchInfo.m001.homeDE, 'Mexiko');
});

test('Live-Spiel wird als live markiert', () => {
  const am = apiMatch({
    status: 'IN_PLAY',
    utcDate: '2026-06-12T19:00:00Z',
    homeTeam: { name: 'Canada' },
    awayTeam: { name: 'Bosnia and Herzegovina' },
    score: { duration: 'REGULAR', fullTime: { home: 1, away: 0 } }
  });
  const { results } = LiveApi.mapLiveData(data, [am], []);
  const m = data.matches.find((x) => x.home === 'Kanada' && x.away === 'Bosnien-Herzeg.');
  assert.ok(results[m.id].live);
  assert.equal(results[m.id].home, 1);
});

test('K.o.-Spiel ohne Excel-Teams wird über die Anstoßzeit zugeordnet', () => {
  const ko = data.matches.find((m) => m.round === 'Sechzehntelfinale');
  const utc = new Date(Date.parse(ko.kickoff)).toISOString().replace('.000', '');
  const am = apiMatch({
    stage: 'LAST_32',
    status: 'IN_PLAY',
    utcDate: utc,
    homeTeam: { name: 'Germany' },
    awayTeam: { name: 'Scotland' },
    score: { duration: 'REGULAR', fullTime: { home: 0, away: 0 } }
  });
  const { results, matchInfo } = LiveApi.mapLiveData(data, [am], []);
  assert.ok(results[ko.id], 'Ergebnis dem KO-Spiel zugeordnet');
  assert.equal(matchInfo[ko.id].homeDE, 'Deutschland');
  assert.equal(matchInfo[ko.id].awayDE, 'Schottland');
});

test('Elfmeterschießen bis HF werden gezählt, Finale liefert Weltmeister', () => {
  const af = data.matches.find((m) => m.round === 'Achtelfinale');
  const fin = data.matches.find((m) => m.round === 'Finale');
  const ams = [
    apiMatch({
      stage: 'LAST_16',
      utcDate: new Date(Date.parse(af.kickoff)).toISOString().replace('.000', ''),
      homeTeam: { name: 'Spain' }, awayTeam: { name: 'France' },
      score: {
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 1, away: 1 },
        penalties: { home: 4, away: 3 },
        winner: 'HOME_TEAM'
      }
    }),
    apiMatch({
      stage: 'FINAL',
      utcDate: new Date(Date.parse(fin.kickoff)).toISOString().replace('.000', ''),
      homeTeam: { name: 'Spain' }, awayTeam: { name: 'England' },
      score: { duration: 'REGULAR', fullTime: { home: 2, away: 1 }, winner: 'HOME_TEAM' }
    })
  ];
  const { results, extras } = LiveApi.mapLiveData(data, ams, []);
  assert.equal(extras.shootoutCount, 1);
  assert.equal(extras.tournamentFinished, true);
  assert.equal(extras.championTeam, 'Spanien');
  // Elfmeterschießen: Ergebnis nach 120 Min zählt (1:1), nicht das Schießen
  assert.equal(results[af.id].home, 1);
  assert.equal(results[af.id].away, 1);
});

test('Torschützen werden übersetzt', () => {
  const scorers = [{ player: { name: 'Kylian Mbappé' }, team: { name: 'France' }, goals: 3 }];
  const { extras } = LiveApi.mapLiveData(data, [], scorers);
  assert.equal(extras.scorers[0].teamDE, 'Frankreich');
  assert.equal(extras.scorers[0].goals, 3);
});
