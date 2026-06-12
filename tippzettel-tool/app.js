/* WM-Tippspiel Web-App: Upload → Tippen → Download */
(function () {
  'use strict';

  var state = {
    workbook: null,
    fileName: '',
    matches: [],
    tips: {}
  };

  var el = function (id) { return document.getElementById(id); };

  var dropzone = el('dropzone');
  var fileInput = el('file-input');
  var nameInput = el('name-input');
  var nameInput2 = el('name-input-2');
  var uploadStep = el('step-upload');
  var tipStep = el('step-tips');
  var matchList = el('match-list');
  var progressLabel = el('progress-label');
  var progressBar = el('progress-bar');
  var downloadBtn = el('download-btn');
  var resetBtn = el('reset-btn');
  var errorBox = el('error-box');
  var fileLabel = el('file-label');

  // ---------------------------------------------------------------- Upload --

  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', function () {
    dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
  }

  function handleFile(file) {
    clearError();
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
      showError('Bitte eine Excel-Datei (.xlsx) hochladen. Alte .xls-Dateien bitte vorher in Excel als .xlsx speichern.');
      return;
    }
    fileLabel.textContent = file.name;
    var reader = new FileReader();
    reader.onload = function () {
      var wb = new ExcelJS.Workbook();
      wb.xlsx.load(reader.result).then(function () {
        state.workbook = wb;
        state.fileName = file.name;
        state.matches = TippParser.parseWorkbook(wb);
        state.tips = {};
        if (!state.matches.length) {
          showError('In dieser Datei wurden leider keine Spiele erkannt. ' +
            'Die App sucht nach Zeilen mit zwei Teamnamen (z. B. "Deutschland" und "Spanien") ' +
            'und freien Zellen daneben für den Tipp.');
          return;
        }
        nameInput2.value = nameInput.value;
        renderMatches();
        uploadStep.hidden = true;
        tipStep.hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }).catch(function (err) {
        console.error(err);
        showError('Die Datei konnte nicht gelesen werden: ' + err.message);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  // ----------------------------------------------------------------- Liste --

  function flagFor(team) {
    if (team.placeholder) return '🏆';
    var code = team.code;
    if (!code) return '⚽';
    if (code.indexOf('gb-') === 0) {
      var special = { 'gb-eng': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'gb-sct': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'gb-wls': '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 'gb-nir': '🇬🇧' };
      return special[code] || '🇬🇧';
    }
    var A = 0x1F1E6;
    return String.fromCodePoint(A + code.charCodeAt(0) - 97, A + code.charCodeAt(1) - 97);
  }

  function renderMatches() {
    matchList.innerHTML = '';
    var currentHeader = null;

    state.matches.forEach(function (m) {
      var headerText = m.section || m.sheetName;
      if (headerText !== currentHeader) {
        currentHeader = headerText;
        var h = document.createElement('h3');
        h.className = 'section-header';
        h.textContent = headerText;
        matchList.appendChild(h);
      }

      var row = document.createElement('div');
      row.className = 'match';
      row.dataset.id = m.id;

      var home = document.createElement('div');
      home.className = 'team team-home';
      home.innerHTML = '<span class="flag">' + flagFor(m.home) + '</span>' +
        '<span class="team-name"></span>';
      home.querySelector('.team-name').textContent = m.home.name;

      var score = document.createElement('div');
      score.className = 'score';
      var inH = document.createElement('input');
      var inA = document.createElement('input');
      [inH, inA].forEach(function (inp) {
        inp.type = 'number';
        inp.min = '0';
        inp.max = '20';
        inp.inputMode = 'numeric';
        inp.placeholder = '–';
      });
      inH.setAttribute('aria-label', 'Tore ' + m.home.name);
      inA.setAttribute('aria-label', 'Tore ' + m.away.name);
      inH.addEventListener('input', function () { onTip(m.id, inH, inA, row); });
      inA.addEventListener('input', function () { onTip(m.id, inH, inA, row); });
      var colon = document.createElement('span');
      colon.textContent = ':';
      score.appendChild(inH);
      score.appendChild(colon);
      score.appendChild(inA);

      var away = document.createElement('div');
      away.className = 'team team-away';
      away.innerHTML = '<span class="team-name"></span>' +
        '<span class="flag">' + flagFor(m.away) + '</span>';
      away.querySelector('.team-name').textContent = m.away.name;

      row.appendChild(home);
      row.appendChild(score);
      row.appendChild(away);

      if (m.date) {
        var meta = document.createElement('div');
        meta.className = 'match-date';
        meta.textContent = m.date;
        row.appendChild(meta);
      }

      matchList.appendChild(row);
    });

    updateProgress();
  }

  function parseGoal(input) {
    if (input.value === '') return null;
    var n = parseInt(input.value, 10);
    if (isNaN(n) || n < 0) return null;
    return n;
  }

  function onTip(id, inH, inA, row) {
    var h = parseGoal(inH);
    var a = parseGoal(inA);
    if (h !== null && a !== null) {
      state.tips[id] = { home: h, away: a };
      row.classList.add('tipped');
    } else {
      delete state.tips[id];
      row.classList.remove('tipped');
    }
    updateProgress();
  }

  function updateProgress() {
    var done = Object.keys(state.tips).length;
    var total = state.matches.length;
    progressLabel.textContent = done + ' von ' + total + ' Spielen getippt';
    progressBar.style.width = total ? (100 * done / total) + '%' : '0%';
    downloadBtn.disabled = done === 0 || !currentName();
    el('download-hint').hidden = !(done > 0 && !currentName());
  }

  function currentName() {
    return (tipStep.hidden ? nameInput.value : nameInput2.value).trim();
  }

  nameInput.addEventListener('input', updateProgress);
  nameInput2.addEventListener('input', function () {
    nameInput.value = nameInput2.value;
    updateProgress();
  });

  // -------------------------------------------------------------- Download --

  downloadBtn.addEventListener('click', function () {
    var name = currentName();
    if (!name || !state.workbook) return;

    TippParser.applyTips(state.workbook, state.matches, state.tips, name);

    state.workbook.xlsx.writeBuffer().then(function (buffer) {
      var safeName = name.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_');
      var blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Tippspiel_' + safeName + '.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      el('done-box').hidden = false;
      el('done-filename').textContent = 'Tippspiel_' + safeName + '.xlsx';
    }).catch(function (err) {
      console.error(err);
      showError('Beim Erzeugen der Excel-Datei ist ein Fehler aufgetreten: ' + err.message);
    });
  });

  resetBtn.addEventListener('click', function () {
    state.workbook = null;
    state.matches = [];
    state.tips = {};
    fileInput.value = '';
    fileLabel.textContent = '';
    tipStep.hidden = true;
    uploadStep.hidden = false;
    el('done-box').hidden = true;
    clearError();
    window.scrollTo({ top: 0 });
  });
})();
