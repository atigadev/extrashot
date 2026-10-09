/* Cetak Label dari Excel — semua proses berjalan di browser (SheetJS untuk membaca Excel). */
(function () {
  'use strict';

  var SIZE_FILE = 'Ukuran_Label_TJ_No100-129.xlsx';
  var STORE_KEY = 'cetakLabel.v1';
  // Perkiraan ukuran lembar label TJ (mm), dipakai untuk menghitung susunan kolom × baris.
  var TJ_SHEET = { w: 205, h: 165 };
  var PAPERS = {
    tj: null,
    a4: { w: 210, h: 297 },
    f4: { w: 215, h: 330 },
    letter: { w: 216, h: 279 },
    custom: null
  };

  // Cadangan bila file ukuran tidak bisa dibaca (mis. halaman dibuka lewat file://).
  // Format: [no, bentuk, tinggi, lebar, isi per lembar]
  var FALLBACK_SIZES = [
    [100, 'Persegi panjang', 38, 100, 8], [101, 'Persegi panjang', 50, 100, 6], [102, 'Persegi', 50, 50, 12],
    [103, 'Persegi panjang', 32, 64, 12], [104, 'Persegi panjang', 24, 75, 16], [105, 'Persegi panjang', 24, 37, 30],
    [106, 'Persegi', 25, 25, 42], [107, 'Persegi panjang', 18, 50, 30], [108, 'Persegi panjang', 18, 38, 40],
    [109, 'Persegi panjang', 13, 38, 55], [110, 'Persegi panjang', 16, 22, 81], [111, 'Persegi panjang', 12, 18, null],
    [112, 'Persegi panjang', 8, 20, 144], [113, 'Persegi panjang', 9, 12, 210], [114, 'Bulat', 13, 13, 130],
    [115, 'Bulat', 17, 17, 80], [116, 'Bulat', 19, 19, 80], [117, 'Bulat', 22, 22, 48], [118, 'Bulat', 32, 32, 24],
    [119, 'Persegi panjang', 102, 152, 2], [120, 'Persegi panjang', 78, 118, 2], [121, 'Persegi panjang', 38, 75, 10],
    [122, 'Persegi panjang', 17, 85, 16], [123, 'Persegi panjang', 11, 30, 72], [124, 'Persegi panjang', 40, 57, 9],
    [125, 'Persegi panjang', 16, 31, 54], [126, 'Persegi panjang', 10, 50, 48], [127, 'Persegi panjang', 35, 70, 10],
    [128, 'Persegi panjang', 11, 51, 48], [129, 'Persegi panjang', 17, 58, 24]
  ];

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    sizes: [],
    workbook: null,
    fileName: '',
    columns: [],
    rows: [],
    selected: [],
    testMode: false
  };

  var settings = loadSettings();

  function defaultSettings() {
    return {
      labelNo: null,
      template: '**{Nama}**\n{Alamat}\n{Kota}',
      font: 11, align: 'left', family: 'Arial, Helvetica, sans-serif', valign: 'center', pad: 1.5, rotate: 'auto',
      copies: 1, qtycol: '', start: 1, border: false,
      offx: 0, offy: 0, zoom: 1,
      sheet: '', headerRow: 1,
      profile: '',
      layouts: {}
    };
  }
  function mergeSettings(src) {
    var def = defaultSettings();
    if (src && typeof src === 'object') for (var k in def) if (src[k] !== undefined) def[k] = src[k];
    if (!def.layouts || typeof def.layouts !== 'object') def.layouts = {};
    return def;
  }
  function loadSettings() {
    try { return mergeSettings(JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); }
    catch (e) { return defaultSettings(); }
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* abaikan */ }
  }

  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function round1(n) { return Math.round(n * 10) / 10; }

  /* ------------------------- Ukuran label ------------------------- */

  function sizeFromRow(no, bentuk, tinggi, lebar, pcs, teks) {
    var round = /bulat|lingkar|round/i.test(bentuk || '');
    return {
      no: String(no).trim(),
      bentuk: bentuk || (round ? 'Bulat' : 'Persegi panjang'),
      round: round,
      h: tinggi, w: lebar,
      pcs: pcs > 0 ? Math.round(pcs) : null,
      teks: teks || (round ? 'Ø ' + tinggi + ' mm' : tinggi + ' x ' + lebar + ' mm')
    };
  }

  function parseSizesWorkbook(wb) {
    var out = [];
    wb.SheetNames.forEach(function (name) {
      var aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
      var hi = -1;
      for (var i = 0; i < aoa.length && hi < 0; i++) {
        if (aoa[i].some(function (c) { return /tinggi/i.test(c); }) &&
            aoa[i].some(function (c) { return /lebar/i.test(c); })) hi = i;
      }
      if (hi < 0) return;
      var head = aoa[hi].map(function (c) { return String(c); });
      var find = function (re) { for (var j = 0; j < head.length; j++) if (re.test(head[j])) return j; return -1; };
      var cNo = find(/^\s*no/i), cBentuk = find(/bentuk/i), cT = find(/tinggi/i), cL = find(/lebar/i),
        cTeks = find(/ukuran/i), cPcs = find(/isi|per\s*lembar|pcs/i);
      for (var r = hi + 1; r < aoa.length; r++) {
        var row = aoa[r];
        var t = num(row[cT], NaN), l = num(row[cL], NaN);
        var no = cNo >= 0 ? row[cNo] : '';
        if (no === '' || !(t > 0) || !(l > 0)) continue;
        out.push(sizeFromRow(no, cBentuk >= 0 ? row[cBentuk] : '', t, l,
          cPcs >= 0 ? num(row[cPcs], null) : null, cTeks >= 0 ? String(row[cTeks]) : ''));
      }
    });
    return out;
  }

  function setSizes(list, source) {
    state.sizes = list;
    $('size-source').textContent = source + ' — ' + list.length + ' jenis label.';
    var sel = $('sel-label');
    sel.innerHTML = list.map(function (s) {
      return '<option value="' + esc(s.no) + '">No. ' + esc(s.no) + ' — ' + esc(s.teks) +
        (s.pcs ? ' (' + s.pcs + ' pcs)' : '') + '</option>';
    }).join('');
    var keep = list.some(function (s) { return s.no === settings.labelNo; });
    if (!keep) settings.labelNo = list.length ? list[0].no : null;
    sel.value = settings.labelNo;
    onLabelChange();
  }

  function loadDefaultSizes() {
    fetch(encodeURI(SIZE_FILE), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(function (buf) {
        var list = parseSizesWorkbook(XLSX.read(buf, { type: 'array' }));
        if (!list.length) throw new Error('kosong');
        setSizes(list, 'File: ' + SIZE_FILE);
      })
      .catch(function () {
        setSizes(FALLBACK_SIZES.map(function (a) { return sizeFromRow(a[0], a[1], a[2], a[3], a[4]); }),
          'Data bawaan (file ' + SIZE_FILE + ' tidak terbaca — buka lewat http://localhost/…)');
      });
  }

  function currentSize() {
    for (var i = 0; i < state.sizes.length; i++) if (state.sizes[i].no === settings.labelNo) return state.sizes[i];
    return null;
  }

  /* ------------------------- Tata letak ------------------------- */

  function divisorPairs(n) {
    var out = [];
    for (var c = 1; c <= n; c++) if (n % c === 0) out.push([c, n / c]);
    return out;
  }

  // Cari susunan kolom × baris yang muat di lembar TJ. Utamakan tanpa diputar, lalu yang paling seimbang.
  function autoGrid(size, area) {
    var best = null;
    [false, true].forEach(function (rot) {
      var cw = rot ? size.h : size.w, ch = rot ? size.w : size.h;
      var pairs = size.pcs ? divisorPairs(size.pcs)
        : [[Math.max(1, Math.floor(area.w / cw)), Math.max(1, Math.floor(area.h / ch))]];
      pairs.forEach(function (p) {
        var gw = p[0] * cw, gh = p[1] * ch;
        var fits = gw <= area.w + 0.5 && gh <= area.h + 0.5;
        var score = (fits ? 0 : 1000 + Math.max(gw - area.w, gh - area.h)) +
          (rot ? 10 : 0) + Math.max(gw / area.w, gh / area.h);
        if (!best || score < best.score) best = { cols: p[0], rows: p[1], rot: rot, gw: gw, gh: gh, score: score };
      });
    });
    return best;
  }

  function autoLayout(size, paperKey, pw, ph) {
    // Di lembar TJ, susunan dihitung dari ukuran lembar itu sendiri; di kertas lain dari perkiraan lembar TJ.
    var g = autoGrid(size, paperKey === 'tj' ? { w: pw, h: ph } : TJ_SHEET);
    var L = { paper: paperKey, pw: pw, ph: ph, cols: g.cols, rows: g.rows, rot: g.rot, gx: 0, gy: 0 };
    L.ml = round1(Math.max(0, (pw - g.gw) / 2));
    L.mt = round1(Math.max(0, paperKey === 'tj' ? (ph - g.gh) / 2 : (TJ_SHEET.h - g.gh) / 2));
    return L;
  }

  function currentLayout() {
    var s = currentSize();
    if (!s) return null;
    if (!settings.layouts[s.no]) settings.layouts[s.no] = autoLayout(s, 'tj', TJ_SHEET.w, TJ_SHEET.h);
    return settings.layouts[s.no];
  }

  function showLayout() {
    var L = currentLayout();
    if (!L) return;
    $('sel-paper').value = L.paper;
    $('inp-pw').value = L.pw; $('inp-ph').value = L.ph;
    $('inp-cols').value = L.cols; $('inp-rows').value = L.rows;
    $('inp-mt').value = L.mt; $('inp-ml').value = L.ml;
    $('inp-gx').value = L.gx; $('inp-gy').value = L.gy;
    $('chk-rotcell').checked = !!L.rot;
  }

  function readLayout() {
    var L = currentLayout();
    if (!L) return;
    L.pw = Math.max(10, num($('inp-pw').value, L.pw));
    L.ph = Math.max(10, num($('inp-ph').value, L.ph));
    L.cols = Math.max(1, Math.round(num($('inp-cols').value, L.cols)));
    L.rows = Math.max(1, Math.round(num($('inp-rows').value, L.rows)));
    L.mt = num($('inp-mt').value, 0); L.ml = num($('inp-ml').value, 0);
    L.gx = Math.max(0, num($('inp-gx').value, 0)); L.gy = Math.max(0, num($('inp-gy').value, 0));
    L.rot = $('chk-rotcell').checked;
  }

  function onLabelChange() {
    settings.labelNo = $('sel-label').value;
    var s = currentSize();
    if (!s) { $('label-info').textContent = 'Tidak ada data ukuran.'; return; }
    $('label-info').innerHTML =
      '<b>No. ' + esc(s.no) + '</b> · ' + esc(s.bentuk) + '<br>' +
      (s.round ? 'Diameter ' + s.h + ' mm' : 'Tinggi ' + s.h + ' mm × Lebar ' + s.w + ' mm') +
      '<br>Isi per lembar: ' + (s.pcs ? s.pcs + ' pcs' : '<i>tidak diketahui (dihitung otomatis)</i>');
    showLayout();
    scheduleRender();
  }

  /* ------------------------- Data Excel ------------------------- */

  function loadDataFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        state.workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
      } catch (err) {
        alert('File tidak bisa dibaca: ' + err.message);
        return;
      }
      state.fileName = file.name;
      $('sel-sheet').innerHTML = state.workbook.SheetNames.map(function (n) {
        return '<option>' + esc(n) + '</option>';
      }).join('');
      $('sheet-field').hidden = state.workbook.SheetNames.length < 2;
      $('header-field').hidden = false;
      // pakai sheet & baris judul terakhir bila ada di file ini
      if (state.workbook.SheetNames.indexOf(settings.sheet) >= 0) $('sel-sheet').value = settings.sheet;
      $('inp-header-row').value = settings.headerRow || 1;
      readSheet(true);
    };
    reader.readAsArrayBuffer(file);
  }

  function readSheet(resetTemplate) {
    if (!state.workbook) return;
    settings.sheet = $('sel-sheet').value || state.workbook.SheetNames[0];
    settings.headerRow = Math.max(1, Math.round(num($('inp-header-row').value, 1)));
    var ws = state.workbook.Sheets[settings.sheet];
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
    var hr = settings.headerRow - 1;
    var head = (aoa[hr] || []).map(function (c, i) { return String(c).trim() || ('Kolom ' + (i + 1)); });
    var rows = aoa.slice(hr + 1).filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ''; });
    });
    var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, head.length);
    for (var i = head.length; i < width; i++) head.push('Kolom ' + (i + 1));
    state.columns = head;
    state.rows = rows.map(function (r) { return head.map(function (_, j) { return r[j] == null ? '' : String(r[j]).trim(); }); });
    state.selected = state.rows.map(function () { return true; });

    $('data-info').innerHTML = '<b>' + esc(state.fileName) + '</b> — ' + state.rows.length + ' baris, ' + head.length + ' kolom.';
    $('data-count').textContent = '(' + state.rows.length + ')';

    $('col-chips').innerHTML = head.map(function (h) {
      return '<button type="button" class="chip" data-col="' + esc(h) + '">{' + esc(h) + '}</button>';
    }).join('');
    $('sel-qtycol').innerHTML = '<option value="">(tidak)</option>' + head.map(function (h) {
      return '<option>' + esc(h) + '</option>';
    }).join('');
    if (head.indexOf(settings.qtycol) >= 0) $('sel-qtycol').value = settings.qtycol;
    else settings.qtycol = '';

    // Template lama dipertahankan bila semua {kolom}-nya ada di file baru; selain itu dibuat ulang dari kolom.
    var fields = settings.template.match(/\{[^}]+\}/g) || [];
    var tplMatches = fields.length > 0 && fields.every(function (t) { return head.indexOf(t.slice(1, -1)) >= 0; });
    if (resetTemplate && !tplMatches) {
      settings.template = head.map(function (h, i) { return i === 0 ? '**{' + h + '}**' : '{' + h + '}'; }).join('\n');
      $('inp-template').value = settings.template;
    }
    renderTable();
    scheduleRender();
  }

  function renderTable() {
    var q = $('inp-search').value.trim().toLowerCase();
    var html = '<thead><tr><th></th><th>#</th>' + state.columns.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>';
    state.rows.forEach(function (r, i) {
      if (q && r.join(' ').toLowerCase().indexOf(q) < 0) return;
      html += '<tr class="' + (state.selected[i] ? '' : 'off') + '"><td><input type="checkbox" data-row="' + i + '"' +
        (state.selected[i] ? ' checked' : '') + '></td><td>' + (i + 1) + '</td>' +
        r.map(function (c) { return '<td title="' + esc(c) + '">' + esc(c) + '</td>'; }).join('') + '</tr>';
    });
    $('data-table').innerHTML = html + '</tbody>';
    updateSelCount();
  }

  function updateSelCount() {
    var n = state.selected.filter(Boolean).length;
    $('sel-count').textContent = n + ' dari ' + state.rows.length + ' baris dipilih';
  }

  function downloadSample() {
    var aoa = [
      ['Nama', 'Alamat', 'Kota', 'Telepon', 'Jumlah'],
      ['Budi Santoso', 'Jl. Merdeka No. 10', 'Bandung 40111', '0812-3456-7890', 2],
      ['Siti Aminah', 'Jl. Sudirman Kav. 5', 'Jakarta 10220', '0813-2222-3333', 1],
      ['Andi Wijaya', 'Perum Griya Asri Blok C-7', 'Surabaya 60234', '0857-1111-2222', 3]
    ];
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, 'contoh_data_label.xlsx');
  }

  /* ------------------------- Isi label ------------------------- */

  function buildContent(row) {
    var tpl = settings.template;
    var lines = tpl.split(/\r?\n/);
    var out = [];
    lines.forEach(function (line) {
      var hasField = /\{[^}]+\}/.test(line), anyValue = false;
      var html = esc(line).replace(/\{([^}]+)\}/g, function (m, name) {
        var idx = state.columns.indexOf(name.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
        var v = row && idx >= 0 ? row[idx] : '';
        if (v !== '') anyValue = true;
        return esc(v);
      });
      if (hasField && !anyValue) return; // baris kosong karena datanya kosong → dilewati
      html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      out.push('<div class="ln">' + (html.trim() ? html : '&nbsp;') + '</div>');
    });
    return out.join('');
  }

  function buildItems() {
    var items = [];
    var hasData = state.rows.length > 0;
    var copies = Math.max(1, Math.round(num(settings.copies, 1)));
    var qIdx = settings.qtycol ? state.columns.indexOf(settings.qtycol) : -1;
    if (!hasData) {
      if (!settings.template.trim()) return items;
      var c = buildContent(null);
      for (var k = 0; k < copies; k++) items.push(c);
      return items;
    }
    state.rows.forEach(function (r, i) {
      if (!state.selected[i]) return;
      var n = copies;
      if (qIdx >= 0) n = Math.max(0, Math.round(num(String(r[qIdx]).replace(/[^\d.,-]/g, '').replace(',', '.'), 0)));
      var content = buildContent(r);
      for (var k = 0; k < n; k++) items.push(content);
    });
    return items;
  }

  /* ------------------------- Render ------------------------- */

  var renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 120);
  }

  function render() {
    var size = currentSize(), L = currentLayout();
    var pages = $('pages');
    if (!size || !L) { pages.innerHTML = '<div class="empty">Memuat ukuran label…</div>'; return; }
    saveSettings();

    $('page-style').textContent = '@page { size: ' + L.pw + 'mm ' + L.ph + 'mm; margin: 0; }';

    var perPage = L.cols * L.rows;
    var cellW = L.rot ? size.h : size.w, cellH = L.rot ? size.w : size.h;
    var angle = settings.rotate === 'auto' ? (L.rot ? 90 : 0) : Number(settings.rotate);
    var sideways = angle === 90 || angle === 270;
    var lblW = sideways ? cellH : cellW, lblH = sideways ? cellW : cellH;
    var pad = Math.max(0, num(settings.pad, 0));
    if (size.round) pad += Math.min(lblW, lblH) * 0.146; // area persegi di dalam lingkaran
    var boxW = Math.max(1, lblW - 2 * pad), boxH = Math.max(1, lblH - 2 * pad);

    var items = state.testMode ? null : buildItems();
    var start = state.testMode ? 0 : Math.max(0, Math.round(num(settings.start, 1)) - 1) % perPage;
    var total = state.testMode ? perPage : start + items.length;
    var nPages = Math.max(1, Math.ceil(total / perPage));

    var gridW = L.cols * cellW + (L.cols - 1) * L.gx, gridH = L.rows * cellH + (L.rows - 1) * L.gy;
    var warn = [];
    if (L.ml + gridW > L.pw + 0.5 || L.mt + gridH > L.ph + 0.5) warn.push('susunan label melebihi ukuran kertas');
    if (size.pcs && perPage !== size.pcs) warn.push('kolom × baris (' + perPage + ') ≠ isi per lembar (' + size.pcs + ')');

    $('summary').innerHTML = state.testMode ? '' :
      '<b>' + (items ? items.length : 0) + '</b> label · <b>' + nPages + '</b> lembar · ' +
      L.cols + ' kolom × ' + L.rows + ' baris = ' + perPage + ' per lembar · kertas ' + L.pw + ' × ' + L.ph + ' mm' +
      (warn.length ? ' · <span style="color:#c0392b">⚠ ' + esc(warn.join('; ')) + '</span>' : '');

    var family = settings.family, align = settings.align, valign = settings.valign;
    var html = [];
    for (var p = 0; p < nPages; p++) {
      html.push('<div class="sheet" style="width:' + L.pw + 'mm;height:' + L.ph + 'mm">');
      for (var s = 0; s < perPage; s++) {
        var idx = p * perPage + s;
        var c = s % L.cols, r = Math.floor(s / L.cols);
        var left = settings.offx + L.ml + c * (cellW + L.gx), top = settings.offy + L.mt + r * (cellH + L.gy);
        var content = state.testMode ? '' : (idx >= start && idx - start < items.length ? items[idx - start] : null);
        var cls = 'cell' + (size.round ? ' round' : '') +
          (state.testMode || (settings.border && content !== null) ? ' outline' : '') + (content === null ? ' ghost' : '');
        html.push('<div class="' + cls + '" style="left:' + left.toFixed(2) + 'mm;top:' + top.toFixed(2) +
          'mm;width:' + cellW + 'mm;height:' + cellH + 'mm">');
        if (content) {
          html.push('<div class="lbl" style="width:' + lblW + 'mm;height:' + lblH + 'mm;' +
            (angle ? 'transform:rotate(' + angle + 'deg);' : '') + '">' +
            '<div class="box" style="flex:none;margin:' + pad + 'mm;width:' + boxW + 'mm;height:' + boxH + 'mm;display:flex;flex-direction:column;justify-content:' +
            valign + ';overflow:hidden">' +
            '<div class="txt" style="flex:none;font-family:' + esc(family) + ';text-align:' + align + '">' + content + '</div></div></div>');
        }
        html.push('</div>');
      }
      html.push('<div class="sheet-no">Lembar ' + (p + 1) + '/' + nPages + '</div></div>');
    }
    pages.innerHTML = html.join('');
    applyZoom();
    fitText();
    $('btn-print').disabled = !state.testMode && !(items && items.length);
  }

  // Kecilkan huruf sampai isi muat di dalam label (hasil disimpan per isi yang sama).
  function fitText() {
    var max = Math.max(4, num(settings.font, 11)), min = 4;
    var cache = {};
    var boxes = $('pages').querySelectorAll('.box');
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i], txt = box.firstChild;
      var key = txt.innerHTML;
      if (cache[key] != null) { txt.style.fontSize = cache[key] + 'pt'; continue; }
      var fits = function (pt) {
        txt.style.fontSize = pt + 'pt';
        return txt.offsetHeight <= box.clientHeight + 0.5 && txt.scrollWidth <= box.clientWidth + 0.5;
      };
      var best = min;
      if (fits(max)) best = max;
      else {
        var lo = min, hi = max;
        while (hi - lo > 0.25) {
          var mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid; else hi = mid;
        }
        best = Math.floor(lo * 4) / 4;
      }
      txt.style.fontSize = best + 'pt';
      cache[key] = best;
    }
  }

  function applyZoom() {
    $('pages').style.zoom = settings.zoom;
  }

  /* ------------------------- Event ------------------------- */

  var bindings = [];
  function bindSetting(id, key, isNum, evt) {
    var el = $(id);
    bindings.push([el, key]);
    el.addEventListener(evt || (el.type === 'checkbox' ? 'change' : 'input'), function () {
      settings[key] = el.type === 'checkbox' ? el.checked : (isNum ? num(el.value, 0) : el.value);
      scheduleRender();
    });
  }

  // Tampilkan isi `settings` ke semua kontrol di panel.
  function syncUI() {
    bindings.forEach(function (b) {
      var el = b[0], v = settings[b[1]];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v == null ? '' : v;
    });
    $('inp-zoom').value = settings.zoom;
    applyZoom();
    if (state.sizes.length) {
      if (!currentSize()) settings.labelNo = state.sizes[0].no;
      $('sel-label').value = settings.labelNo;
      onLabelChange();
    }
  }

  /* ------------------------- Konfigurasi tersimpan ------------------------- */

  var PROFILE_API = 'api/config.php';
  var PROFILE_LOCAL = STORE_KEY + '.profiles';
  var profiles = {};
  var serverOk = true;

  function setProfileStatus(msg, isError) {
    var el = $('profile-status');
    el.textContent = msg;
    el.style.color = isError ? '#b42318' : '';
  }

  function snapshot() {
    var copy = JSON.parse(JSON.stringify(settings));
    delete copy.profile;
    return copy;
  }

  function renderProfiles() {
    var names = Object.keys(profiles).sort(function (a, b) { return a.localeCompare(b, 'id', { numeric: true }); });
    var sel = $('sel-profile');
    sel.innerHTML = names.length ? names.map(function (n) {
      return '<option value="' + esc(n) + '">' + esc(n) + '</option>';
    }).join('') : '<option value="">(belum ada)</option>';
    if (settings.profile && profiles[settings.profile]) sel.value = settings.profile;
    var none = !names.length;
    $('btn-prof-load').disabled = none;
    $('btn-prof-save').disabled = none;
    $('btn-prof-del').disabled = none;
  }

  function localProfiles() {
    try { return JSON.parse(localStorage.getItem(PROFILE_LOCAL) || '{}') || {}; } catch (e) { return {}; }
  }

  // Simpan di server (PHP); bila server tidak tersedia (mis. dibuka via file://) pakai penyimpanan browser.
  function profileRequest(body) {
    if (!serverOk) return Promise.reject(new Error('offline'));
    var opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' };
    return fetch(PROFILE_API, opt).then(function (r) {
      return r.json().catch(function () { throw new Error('offline'); }).then(function (j) {
        if (!j.ok) throw new Error(j.error || 'Gagal');
        return j.profiles || {};
      });
    }, function () { throw new Error('offline'); });
  }

  function profileAction(body) {
    return profileRequest(body).catch(function (err) {
      if (err.message !== 'offline') throw err;
      serverOk = false;
      var p = localProfiles();
      if (body && body.action === 'save') p[body.name] = { saved_at: new Date().toLocaleString('id-ID'), settings: body.settings };
      if (body && body.action === 'delete') delete p[body.name];
      try { localStorage.setItem(PROFILE_LOCAL, JSON.stringify(p)); } catch (e) { throw new Error('Penyimpanan browser tidak tersedia'); }
      return p;
    }).then(function (p) {
      profiles = p;
      renderProfiles();
      return p;
    });
  }

  function saveProfile(name) {
    return profileAction({ action: 'save', name: name, settings: snapshot() }).then(function () {
      settings.profile = name;
      saveSettings();
      renderProfiles();
      setProfileStatus('Konfigurasi "' + name + '" tersimpan' + (serverOk ? ' di server.' : ' di browser ini.'));
    }).catch(function (e) { setProfileStatus('Gagal menyimpan: ' + e.message, true); });
  }

  function applyConfig(obj, name) {
    var keepZoom = settings.zoom;
    settings = mergeSettings(obj);
    settings.zoom = obj && obj.zoom != null ? settings.zoom : keepZoom;
    settings.profile = name || '';
    syncUI();
    if (state.workbook) {
      if (state.workbook.SheetNames.indexOf(settings.sheet) >= 0) $('sel-sheet').value = settings.sheet;
      $('inp-header-row').value = settings.headerRow;
      readSheet(false);
      if (state.columns.indexOf(settings.qtycol) >= 0) $('sel-qtycol').value = settings.qtycol;
    }
    saveSettings();
    renderProfiles();
    scheduleRender();
  }

  function initProfiles() {
    $('btn-prof-load').addEventListener('click', function () {
      var name = $('sel-profile').value;
      if (!profiles[name]) return;
      applyConfig(profiles[name].settings, name);
      setProfileStatus('Konfigurasi "' + name + '" dimuat (disimpan ' + profiles[name].saved_at + ').');
    });
    $('btn-prof-save').addEventListener('click', function () {
      var name = $('sel-profile').value;
      if (!name) return;
      if (!confirm('Timpa konfigurasi "' + name + '" dengan pengaturan saat ini?')) return;
      saveProfile(name);
    });
    $('btn-prof-saveas').addEventListener('click', function () {
      var size = currentSize();
      var name = prompt('Nama konfigurasi baru:', size ? 'Label No. ' + size.no : '');
      if (name == null) return;
      name = name.trim();
      if (!name) return;
      if (name.length > 80) { alert('Nama maksimal 80 karakter.'); return; }
      if (profiles[name] && !confirm('Konfigurasi "' + name + '" sudah ada. Timpa?')) return;
      saveProfile(name);
    });
    $('btn-prof-del').addEventListener('click', function () {
      var name = $('sel-profile').value;
      if (!name || !confirm('Hapus konfigurasi "' + name + '"?')) return;
      profileAction({ action: 'delete', name: name }).then(function () {
        if (settings.profile === name) { settings.profile = ''; saveSettings(); }
        setProfileStatus('Konfigurasi "' + name + '" dihapus.');
      }).catch(function (e) { setProfileStatus('Gagal menghapus: ' + e.message, true); });
    });

    $('btn-export').addEventListener('click', function () {
      var out = { app: 'cetak-label', version: 1, exported_at: new Date().toISOString(), settings: snapshot(), profiles: profiles };
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'konfigurasi_label_' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      setProfileStatus('File konfigurasi diekspor (pengaturan saat ini + ' + Object.keys(profiles).length + ' konfigurasi tersimpan).');
    });

    $('file-import').addEventListener('change', function () {
      var f = this.files[0];
      this.value = '';
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function (e) {
        var data;
        try { data = JSON.parse(e.target.result); } catch (err) { alert('File bukan JSON yang valid.'); return; }
        if (!data || typeof data !== 'object' || (!data.settings && !data.profiles)) {
          alert('File ini bukan file konfigurasi label.');
          return;
        }
        var list = data.profiles && typeof data.profiles === 'object' ? Object.keys(data.profiles) : [];
        var jobs = list.filter(function (n) { return data.profiles[n] && data.profiles[n].settings; });
        if (jobs.length && !confirm('Impor ' + jobs.length + ' konfigurasi tersimpan? Konfigurasi dengan nama sama akan ditimpa.')) jobs = [];
        var chain = Promise.resolve();
        jobs.forEach(function (n) {
          chain = chain.then(function () { return profileAction({ action: 'save', name: n, settings: data.profiles[n].settings }); });
        });
        chain.then(function () {
          if (data.settings) applyConfig(data.settings, '');
          setProfileStatus('Impor selesai' + (jobs.length ? ': ' + jobs.length + ' konfigurasi ditambahkan.' : '.'));
        }).catch(function (err) { setProfileStatus('Gagal impor: ' + err.message, true); });
      };
      rd.readAsText(f);
    });

    profileAction(null).catch(function (e) { setProfileStatus('Gagal memuat konfigurasi: ' + e.message, true); });
  }

  function init() {
    if (typeof XLSX === 'undefined') {
      document.body.innerHTML = '<p style="padding:20px">Library pembaca Excel (vendor/xlsx.full.min.js) tidak ditemukan.</p>';
      return;
    }
    bindSetting('inp-template', 'template');
    bindSetting('inp-font', 'font', true);
    bindSetting('sel-align', 'align', false, 'change');
    bindSetting('sel-family', 'family', false, 'change');
    bindSetting('sel-valign', 'valign', false, 'change');
    bindSetting('inp-pad', 'pad', true);
    bindSetting('sel-rotate', 'rotate', false, 'change');
    bindSetting('inp-copies', 'copies', true);
    bindSetting('inp-start', 'start', true);
    bindSetting('chk-border', 'border');
    bindSetting('inp-offx', 'offx', true);
    bindSetting('inp-offy', 'offy', true);
    bindSetting('sel-qtycol', 'qtycol', false, 'change');

    $('inp-zoom').value = settings.zoom;
    $('inp-zoom').addEventListener('input', function () { settings.zoom = num(this.value, 1); applyZoom(); saveSettings(); });

    $('sel-label').addEventListener('change', onLabelChange);

    ['inp-pw', 'inp-ph', 'inp-cols', 'inp-rows', 'inp-mt', 'inp-ml', 'inp-gx', 'inp-gy', 'chk-rotcell'].forEach(function (id) {
      $(id).addEventListener(id === 'chk-rotcell' ? 'change' : 'input', function () {
        if ((id === 'inp-pw' || id === 'inp-ph') && $('sel-paper').value !== 'tj') {
          $('sel-paper').value = 'custom';
          currentLayout().paper = 'custom';
        }
        readLayout();
        scheduleRender();
      });
    });
    $('sel-paper').addEventListener('change', function () {
      var key = this.value, L = currentLayout(), size = currentSize();
      var dim = PAPERS[key] || (key === 'tj' ? TJ_SHEET : { w: L.pw, h: L.ph });
      var keepGrid = { cols: L.cols, rows: L.rows, rot: L.rot, gx: L.gx, gy: L.gy };
      var N = autoLayout(size, key, dim.w, dim.h);
      settings.layouts[size.no] = N;
      // pertahankan susunan yang sudah diatur pengguna, hanya posisi yang dihitung ulang
      for (var k in keepGrid) N[k] = keepGrid[k];
      var cw = N.rot ? size.h : size.w, ch = N.rot ? size.w : size.h;
      var gw = N.cols * cw + (N.cols - 1) * N.gx, gh = N.rows * ch + (N.rows - 1) * N.gy;
      N.ml = round1(Math.max(0, (dim.w - gw) / 2));
      N.mt = round1(Math.max(0, key === 'tj' ? (dim.h - gh) / 2 : (TJ_SHEET.h - gh) / 2));
      showLayout();
      scheduleRender();
    });
    $('btn-auto').addEventListener('click', function () {
      var size = currentSize(), L = currentLayout();
      var dim = PAPERS[L.paper] || { w: L.pw, h: L.ph };
      settings.layouts[size.no] = autoLayout(size, L.paper, dim.w, dim.h);
      showLayout();
      scheduleRender();
    });

    $('file-data').addEventListener('change', function () { if (this.files[0]) loadDataFile(this.files[0]); this.value = ''; });
    $('file-sizes').addEventListener('change', function () {
      var f = this.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function (e) {
        var list = parseSizesWorkbook(XLSX.read(new Uint8Array(e.target.result), { type: 'array' }));
        if (!list.length) { alert('Tidak ditemukan kolom "Tinggi" dan "Lebar" di file tersebut.'); return; }
        setSizes(list, 'File: ' + f.name);
      };
      rd.readAsArrayBuffer(f);
      this.value = '';
    });
    $('sel-sheet').addEventListener('change', function () { readSheet(true); });
    $('inp-header-row').addEventListener('change', function () { readSheet(true); });
    $('dl-sample').addEventListener('click', function (e) { e.preventDefault(); downloadSample(); });

    $('col-chips').addEventListener('click', function (e) {
      var col = e.target.getAttribute('data-col');
      if (col == null) return;
      var ta = $('inp-template'), pos = ta.selectionStart, ins = '{' + col + '}';
      ta.value = ta.value.slice(0, pos) + ins + ta.value.slice(ta.selectionEnd);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos + ins.length;
      settings.template = ta.value;
      scheduleRender();
    });

    $('data-table').addEventListener('change', function (e) {
      var i = e.target.getAttribute('data-row');
      if (i == null) return;
      state.selected[+i] = e.target.checked;
      e.target.closest('tr').className = e.target.checked ? '' : 'off';
      updateSelCount();
      scheduleRender();
    });
    $('inp-search').addEventListener('input', renderTable);
    function setVisible(v) {
      var boxes = $('data-table').querySelectorAll('input[data-row]');
      for (var i = 0; i < boxes.length; i++) state.selected[+boxes[i].getAttribute('data-row')] = v;
      renderTable();
      scheduleRender();
    }
    $('btn-all').addEventListener('click', function () { setVisible(true); });
    $('btn-none').addEventListener('click', function () { setVisible(false); });

    var tabs = document.querySelectorAll('.tab');
    for (var t = 0; t < tabs.length; t++) {
      tabs[t].addEventListener('click', function () {
        for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle('active', tabs[j] === this);
        var which = this.getAttribute('data-tab');
        $('tab-data').hidden = which !== 'data';
        $('tab-preview').hidden = which !== 'preview';
      });
    }

    $('btn-print').addEventListener('click', function () {
      clearTimeout(renderTimer);
      render();
      window.print();
    });
    $('btn-test').addEventListener('click', function () {
      clearTimeout(renderTimer);
      state.testMode = true;
      render();
      window.print();
    });
    window.addEventListener('afterprint', function () {
      if (state.testMode) { state.testMode = false; render(); }
    });

    syncUI();
    initProfiles();
    loadDefaultSizes();
  }

  init();
})();
