/* Tests für js/parser.js – Aufruf: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const TippParser = require('../tippzettel-tool/parser.js');

function wb() {
  return new ExcelJS.Workbook();
}

test('erkennt Spiele mit Teams in zwei Zellen und zwei Tippzellen', () => {
  const book = wb();
  const ws = book.addWorksheet('Tippzettel');
  ws.getCell('A1').value = 'Gruppe A';
  ws.getCell('A2').value = '11.06.2026';
  ws.getCell('B2').value = 'Deutschland';
  ws.getCell('E2').value = 'Spanien';
  ws.getCell('B3').value = 'Mexiko';
  ws.getCell('E3').value = 'Kanada';

  const matches = TippParser.parseWorkbook(book);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].home.name, 'Deutschland');
  assert.equal(matches[0].away.name, 'Spanien');
  assert.equal(matches[0].section, 'Gruppe A');
  assert.equal(matches[0].date, '11.06.2026');
  assert.equal(matches[0].target.type, 'pair');
  // Tippzellen liegen zwischen den Teams (C und D)
  assert.equal(matches[0].target.homeCol, 3);
  assert.equal(matches[0].target.awayCol, 4);
});

test('erkennt Spiele mit Tippzellen rechts neben den Teams', () => {
  const book = wb();
  const ws = book.addWorksheet('Blatt1');
  ws.getCell('A1').value = 'Frankreich';
  ws.getCell('B1').value = 'Brasilien';

  const matches = TippParser.parseWorkbook(book);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].target.type, 'pair');
  assert.equal(matches[0].target.homeCol, 3);
  assert.equal(matches[0].target.awayCol, 4);
});

test('erkennt Spiele mit beiden Teams in einer Zelle', () => {
  const book = wb();
  const ws = book.addWorksheet('Blatt1');
  ws.getCell('A1').value = 'Deutschland - Spanien';
  ws.getCell('A2').value = 'Japan vs. Australien';

  const matches = TippParser.parseWorkbook(book);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].home.name, 'Deutschland');
  assert.equal(matches[1].away.name, 'Australien');
});

test('erkennt Tippzellen mit ":"-Trennzelle', () => {
  const book = wb();
  const ws = book.addWorksheet('Blatt1');
  ws.getCell('A1').value = 'Italien';
  ws.getCell('B1').value = 'England';
  ws.getCell('D1').value = ':';

  const matches = TippParser.parseWorkbook(book);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].target.type, 'pair');
  assert.equal(matches[0].target.homeCol, 3);
  assert.equal(matches[0].target.awayCol, 5);
});

test('erkennt K.o.-Platzhalter wie "1. Gruppe A" und "Sieger Spiel 5"', () => {
  const book = wb();
  const ws = book.addWorksheet('KO');
  ws.getCell('A1').value = '1. Gruppe A';
  ws.getCell('B1').value = '2. Gruppe B';
  ws.getCell('A2').value = 'Sieger Spiel 1';
  ws.getCell('B2').value = 'Sieger Spiel 2';
  ws.getCell('A3').value = '1C';
  ws.getCell('B3').value = '2D';

  const matches = TippParser.parseWorkbook(book);
  assert.equal(matches.length, 3);
  assert.ok(matches.every((m) => m.home.placeholder && m.away.placeholder));
});

test('ignoriert Kopfzeilen und belegte Ergebniszellen', () => {
  const book = wb();
  const ws = book.addWorksheet('Blatt1');
  ws.getCell('A1').value = 'Heim';
  ws.getCell('B1').value = 'Gast';
  ws.getCell('A2').value = 'Polen';
  ws.getCell('B2').value = 'Senegal';

  const matches = TippParser.parseWorkbook(book);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].home.name, 'Polen');
});

test('Spalten-Vorlage erkennt unbekannte Teamnamen in gleichem Muster', () => {
  const book = wb();
  const ws = book.addWorksheet('Blatt1');
  const rows = [
    ['Deutschland', 'Spanien'],
    ['Frankreich', 'Brasilien'],
    ['Italien', 'England'],
    ['Mexiko', 'Kanada'],
    ['Japan', 'Ghana'],
    ['Wakanda', 'Atlantis'] // unbekannte Teams, gleiches Muster
  ];
  rows.forEach((row, i) => {
    ws.getCell(i + 1, 1).value = row[0];
    ws.getCell(i + 1, 2).value = row[1];
  });

  const matches = TippParser.parseWorkbook(book);
  assert.equal(matches.length, 6);
  const last = matches.find((m) => m.home.name === 'Wakanda');
  assert.ok(last, 'unbekanntes Team wurde über das Spaltenmuster erkannt');
  assert.equal(last.away.name, 'Atlantis');
});

test('applyTips schreibt Tipps und Namen in die Mappe', async () => {
  const book = wb();
  const ws = book.addWorksheet('Tippzettel');
  ws.getCell('A1').value = 'Name:';
  ws.getCell('A3').value = 'Deutschland';
  ws.getCell('B3').value = 'Spanien';
  ws.getCell('A4').value = 'Sieger HF 1 - Sieger HF 2';

  const matches = TippParser.parseWorkbook(book);
  assert.equal(matches.length, 2);

  const tips = {};
  tips[matches[0].id] = { home: 2, away: 1 };
  tips[matches[1].id] = { home: 0, away: 3 };
  const written = TippParser.applyTips(book, matches, tips, 'Carl');
  assert.equal(written, 2);

  // Roundtrip über Buffer, um sicherzugehen, dass die Datei gültig bleibt
  const buf = await book.xlsx.writeBuffer();
  const book2 = new ExcelJS.Workbook();
  await book2.xlsx.load(buf);
  const ws2 = book2.getWorksheet('Tippzettel');
  assert.equal(ws2.getCell('B1').value, 'Carl');
  assert.equal(ws2.getCell('C3').value, 2);
  assert.equal(ws2.getCell('D3').value, 1);
  assert.equal(ws2.getCell('B4').value, '0:3');
});

test('Beispiel-Vorlage wird vollständig erkannt', async () => {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'make-sample.js')]);

  const book = wb();
  await book.xlsx.readFile(path.join(__dirname, '..', 'tippzettel-tool', 'sample', 'Tippspiel_Vorlage.xlsx'));
  const matches = TippParser.parseWorkbook(book);
  // 4 Gruppen à 6 Spiele + 4 AF + 2 VF + 1 HF + 1 Finale = 32
  assert.equal(matches.length, 32);
  assert.ok(matches.every((m) => m.target && m.target.type === 'pair'));
  assert.equal(matches[0].section, 'Gruppe A');
  assert.ok(TippParser.findNameTarget(book.getWorksheet('Tippzettel')));

  // Tipps für alle Spiele schreiben und Datei prüfen
  const tips = {};
  matches.forEach((m) => { tips[m.id] = { home: 1, away: 0 }; });
  const written = TippParser.applyTips(book, matches, tips, 'Testtipper');
  assert.equal(written, 32);
  const buf = await book.xlsx.writeBuffer();
  const book2 = new ExcelJS.Workbook();
  await book2.xlsx.load(buf);
  const ws2 = book2.getWorksheet('Tippzettel');
  assert.equal(ws2.getCell('B2').value, 'Testtipper');
});
