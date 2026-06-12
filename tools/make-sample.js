/*
 * Erzeugt eine Beispiel-Tippzettel-Vorlage (sample/Tippspiel_Vorlage.xlsx),
 * wie sie ein Tippspiel-Organisator typischerweise verschickt.
 *
 * Aufruf: node tools/make-sample.js
 */
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const GROUPS = {
  'Gruppe A': [
    ['11.06.2026', 'Mexiko', 'Südafrika'],
    ['11.06.2026', 'Kanada', 'Marokko'],
    ['18.06.2026', 'Mexiko', 'Kanada'],
    ['18.06.2026', 'Südafrika', 'Marokko'],
    ['24.06.2026', 'Marokko', 'Mexiko'],
    ['24.06.2026', 'Südafrika', 'Kanada']
  ],
  'Gruppe B': [
    ['12.06.2026', 'USA', 'Paraguay'],
    ['12.06.2026', 'Australien', 'Ecuador'],
    ['19.06.2026', 'USA', 'Australien'],
    ['19.06.2026', 'Paraguay', 'Ecuador'],
    ['25.06.2026', 'Ecuador', 'USA'],
    ['25.06.2026', 'Paraguay', 'Australien']
  ],
  'Gruppe C': [
    ['13.06.2026', 'Deutschland', 'Japan'],
    ['13.06.2026', 'Norwegen', 'Ghana'],
    ['20.06.2026', 'Deutschland', 'Norwegen'],
    ['20.06.2026', 'Japan', 'Ghana'],
    ['26.06.2026', 'Ghana', 'Deutschland'],
    ['26.06.2026', 'Japan', 'Norwegen']
  ],
  'Gruppe D': [
    ['14.06.2026', 'Frankreich', 'Senegal'],
    ['14.06.2026', 'Uruguay', 'Südkorea'],
    ['21.06.2026', 'Frankreich', 'Uruguay'],
    ['21.06.2026', 'Senegal', 'Südkorea'],
    ['27.06.2026', 'Südkorea', 'Frankreich'],
    ['27.06.2026', 'Senegal', 'Uruguay']
  ]
};

const KO = [
  ['Achtelfinale', [
    ['29.06.2026', '1. Gruppe A', '2. Gruppe B'],
    ['29.06.2026', '1. Gruppe C', '2. Gruppe D'],
    ['30.06.2026', '1. Gruppe B', '2. Gruppe A'],
    ['30.06.2026', '1. Gruppe D', '2. Gruppe C']
  ]],
  ['Viertelfinale', [
    ['04.07.2026', 'Sieger Spiel 1', 'Sieger Spiel 2'],
    ['05.07.2026', 'Sieger Spiel 3', 'Sieger Spiel 4']
  ]],
  ['Halbfinale', [
    ['08.07.2026', 'Sieger VF 1', 'Sieger VF 2']
  ]],
  ['Finale', [
    ['19.07.2026', 'Sieger HF 1', 'Sieger HF 2']
  ]]
];

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tippzettel');

  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 6;
  ws.getColumn(4).width = 6;
  ws.getColumn(5).width = 22;

  let r = 1;
  ws.getCell(r, 1).value = 'WM 2026 – Tippzettel';
  ws.getCell(r, 1).font = { bold: true, size: 16 };
  r += 1;
  ws.getCell(r, 1).value = 'Name:';
  ws.getCell(r, 1).font = { bold: true };
  r += 2;

  const header = (title) => {
    ws.getCell(r, 1).value = title;
    ws.getCell(r, 1).font = { bold: true, size: 12, color: { argb: 'FF0B6E3F' } };
    r += 1;
  };

  const matchRow = (date, home, away) => {
    ws.getCell(r, 1).value = date;
    ws.getCell(r, 2).value = home;
    ws.getCell(r, 3).value = '';
    ws.getCell(r, 4).value = '';
    ws.getCell(r, 5).value = away;
    [3, 4].forEach((c) => {
      ws.getCell(r, c).border = { bottom: { style: 'thin' } };
      ws.getCell(r, c).alignment = { horizontal: 'center' };
    });
    r += 1;
  };

  for (const [group, matches] of Object.entries(GROUPS)) {
    header(group);
    matches.forEach((m) => matchRow(...m));
    r += 1;
  }

  for (const [round, matches] of KO) {
    header(round);
    matches.forEach((m) => matchRow(...m));
    r += 1;
  }

  const outDir = path.join(__dirname, '..', 'tippzettel-tool', 'sample');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'Tippspiel_Vorlage.xlsx');
  await wb.xlsx.writeFile(out);
  console.log('geschrieben:', out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
