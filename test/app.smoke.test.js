/*
 * Smoke-Test der kompletten App in jsdom: Vorlage "hochladen", Spiele tippen,
 * Download auslösen und die erzeugte Excel-Datei prüfen.
 * Aufruf: node --test test/app.smoke.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const ExcelJS = require('exceljs');

const root = path.join(__dirname, '..');

test('kompletter Ablauf: Upload -> Tippen -> Download', async () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;

  // Skripte wie der Browser in Reihenfolge ausführen
  for (const src of ['js/vendor/exceljs.min.js', 'js/parser.js', 'js/app.js']) {
    window.eval(fs.readFileSync(path.join(root, src), 'utf-8'));
  }

  const doc = window.document;
  doc.getElementById('name-input').value = 'Carl';

  // Upload simulieren: handleFile läuft über FileReader, daher direkt die
  // File-API von jsdom benutzen
  const buf = fs.readFileSync(path.join(root, 'sample', 'Tippspiel_Vorlage.xlsx'));
  const file = new window.File([buf], 'Tippspiel_Vorlage.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const input = doc.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new window.Event('change'));

  // auf asynchrones Einlesen warten
  await waitFor(() => !doc.getElementById('step-tips').hidden, 5000);

  const rows = doc.querySelectorAll('#match-list .match');
  assert.equal(rows.length, 32, 'alle 32 Spiele der Vorlage werden angezeigt');
  assert.ok(doc.querySelectorAll('#match-list .section-header').length >= 8);

  // alle Spiele tippen
  rows.forEach((row, i) => {
    const [h, a] = row.querySelectorAll('input');
    h.value = String(i % 4);
    a.value = String((i + 1) % 3);
    h.dispatchEvent(new window.Event('input'));
    a.dispatchEvent(new window.Event('input'));
  });
  assert.equal(doc.getElementById('progress-label').textContent, '32 von 32 Spielen getippt');

  const downloadBtn = doc.getElementById('download-btn');
  assert.equal(downloadBtn.disabled, false);

  // Download abfangen: createObjectURL gibt es in jsdom nicht -> stubben und
  // den Blob-Inhalt einsammeln
  let downloadedBlob = null;
  let downloadName = '';
  window.URL.createObjectURL = (blob) => { downloadedBlob = blob; return 'blob:fake'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };

  downloadBtn.dispatchEvent(new window.Event('click'));
  await waitFor(() => downloadedBlob !== null, 5000);

  assert.equal(downloadName, 'Tippspiel_Carl.xlsx');
  assert.equal(doc.getElementById('done-box').hidden, false);

  // erzeugte Datei prüfen
  const outBuf = Buffer.from(await downloadedBlob.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(outBuf);
  const ws = wb.getWorksheet('Tippzettel');
  assert.equal(ws.getCell('B2').value, 'Carl', 'Name wurde neben "Name:" eingetragen');
  assert.equal(ws.getCell('C5').value, 0, 'Heimtipp des ersten Spiels');
  assert.equal(ws.getCell('D5').value, 1, 'Gasttipp des ersten Spiels');
});

function waitFor(cond, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      if (cond()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('Timeout beim Warten'));
      setTimeout(poll, 25);
    })();
  });
}
