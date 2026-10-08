/* Halaman label pengiriman: form → pratinjau → simpan ke database → cetak. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = 'labelPengiriman.v1';
  var DEFAULT_BARCODE_NOTE = 'Kode Booking Ini Bukan No Resi Pengiriman';
  var PAPERS = {
    '100x100': { w: 100, h: 100, cols: 1, rows: 1 },
    '100x150': { w: 100, h: 150, cols: 1, rows: 1 },
    '105x148': { w: 105, h: 148, cols: 1, rows: 1 },
    '102x152': { w: 102, h: 152, cols: 1, rows: 1 },
    '78x118': { w: 78, h: 118, cols: 1, rows: 1 },
    'a4x4': { w: 210, h: 297, cols: 2, rows: 2 }
  };
  var PAGE_MARGIN = 2; // mm, jarak aman dari tepi kertas

  var master = { toko: [], ekspedisi: [] };
  var history = [];
  var selected = {};
  var prefs = loadPrefs();
  var frm = $('frm');

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function savePrefs() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch (e) { /* abaikan */ }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function rupiah(v) { return 'Rp ' + Math.round(num(v)).toLocaleString('id-ID'); }
  function kg(v) { return (Math.round(num(v) * 100) / 100) + ' Kg'; }

  function maskPhone(p, on) {
    p = String(p || '').trim();
    if (!on || !p) return p;
    var d = p.replace(/\D/g, '');
    if (d.charAt(0) === '0') d = '62' + d.slice(1);
    if (d.length <= 6) return d;
    return d.slice(0, 3) + new Array(d.length - 5).join('*') + d.slice(-3);
  }

  function api(url, body) {
    var opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' };
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { throw new Error('Respon server tidak valid (HTTP ' + r.status + ')'); });
    }).then(function (j) {
      if (!j.ok) throw new Error(j.error || 'Gagal');
      return j;
    });
  }

  function status(msg, isError) {
    var el = $('save-status');
    el.textContent = msg;
    el.style.color = isError ? '#b42318' : '';
  }

  /* ------------------------- Master toko & ekspedisi ------------------------- */

  function findMaster(type, id) {
    id = +id;
    for (var i = 0; i < master[type].length; i++) if (master[type][i].id === id) return master[type][i];
    return null;
  }

  function fillSelect(type) {
    var sel = frm.elements[type + '_id'], cur = sel.value;
    sel.innerHTML = '<option value="">(tanpa ' + type + ')</option>' + master[type].filter(function (r) {
      return r.aktif || String(r.id) === cur;
    }).map(function (r) { return '<option value="' + r.id + '">' + esc(r.nama) + '</option>'; }).join('');
    sel.value = cur;
  }

  function loadMaster() {
    return Promise.all(['toko', 'ekspedisi'].map(function (t) {
      return api('api/master.php?type=' + t).then(function (j) { master[t] = j.data; fillSelect(t); });
    })).catch(function (e) { status('Gagal memuat master: ' + e.message, true); });
  }

  /* ------------------------- Form ------------------------- */

  var FIELDS = ['id', 'toko_id', 'ekspedisi_id', 'layanan', 'no_invoice', 'kode_barcode', 'keterangan_barcode', 'berat_kg', 'ongkir',
    'metode_bayar', 'nilai_cod', 'catatan', 'penerima_nama', 'penerima_alamat', 'penerima_telepon',
    'pengirim_nama', 'pengirim_alamat', 'pengirim_telepon'];

  function emptyRecord() {
    var lastToko = prefs.lastToko && findMaster('toko', prefs.lastToko);
    var lastEks = prefs.lastEkspedisi && findMaster('ekspedisi', prefs.lastEkspedisi);
    return {
      id: '', toko_id: lastToko ? lastToko.id : '', ekspedisi_id: lastEks ? lastEks.id : '',
      layanan: lastEks ? lastEks.layanan_default || '' : '',
      no_invoice: '', kode_barcode: '', keterangan_barcode: DEFAULT_BARCODE_NOTE,
      berat_kg: 0, ongkir: 0, metode_bayar: 'non_tunai', nilai_cod: 0, catatan: '',
      penerima_nama: '', penerima_alamat: '', penerima_telepon: '',
      pengirim_nama: lastToko ? lastToko.pengirim_nama || '' : '',
      pengirim_alamat: lastToko ? lastToko.pengirim_alamat || '' : '',
      pengirim_telepon: lastToko ? lastToko.pengirim_telepon || '' : '',
      samarkan_telepon: 1,
      items: [{ produk: '', sku: '', jumlah: 1, satuan: 'pcs' }]
    };
  }

  function getForm() {
    var d = {};
    FIELDS.forEach(function (k) { d[k] = frm.elements[k].value; });
    d.samarkan_telepon = frm.elements.samarkan_telepon.checked ? 1 : 0;
    d.items = [];
    var rows = $('items').querySelectorAll('.item-row:not(.item-head)');
    for (var i = 0; i < rows.length; i++) {
      var q = rows[i].querySelectorAll('input');
      d.items.push({ produk: q[0].value, sku: q[1].value, jumlah: q[2].value, satuan: q[3].value });
    }
    return d;
  }

  function setForm(d) {
    FIELDS.forEach(function (k) { frm.elements[k].value = d[k] == null ? '' : d[k]; });
    ['berat_kg', 'ongkir', 'nilai_cod'].forEach(function (k) { frm.elements[k].value = num(d[k]); });
    frm.elements.samarkan_telepon.checked = d.samarkan_telepon == null ? true : !!+d.samarkan_telepon;
    var items = d.items && d.items.length ? d.items : [{ produk: '', sku: '', jumlah: 1, satuan: 'pcs' }];
    $('items').innerHTML = '<div class="item-row item-head"><span>Produk</span><span>SKU</span><span>Jml</span><span>Satuan</span><span></span></div>';
    items.forEach(addItemRow);
    onPayChange();
    renderPreview();
  }

  function addItemRow(it) {
    it = it || { produk: '', sku: '', jumlah: 1, satuan: 'pcs' };
    var row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = '<input placeholder="Nama produk" value="' + esc(it.produk) + '">' +
      '<input placeholder="SKU" value="' + esc(it.sku) + '">' +
      '<input type="number" min="0" value="' + esc(it.jumlah) + '">' +
      '<input value="' + esc(it.satuan || 'pcs') + '">' +
      '<button type="button" title="Hapus produk">✕</button>';
    $('items').appendChild(row);
  }

  function onPayChange() {
    $('fld-cod').style.visibility = frm.elements.metode_bayar.value === 'cod' ? 'visible' : 'hidden';
  }

  function saveDraft() {
    prefs.draft = getForm();
    savePrefs();
  }

  /* ------------------------- Desain label ------------------------- */

  var ICON_NO_PAY = '<svg viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1.3">' +
    '<rect x="3" y="6" width="15" height="11" rx="1.5"/><path d="M6 6V4.5h15V15h-3"/>' +
    '<text x="10.5" y="14.2" font-size="6" font-family="Arial" font-style="italic" fill="#555" stroke="none" text-anchor="middle">Rp</text>' +
    '<path d="M2 21L22 2"/></svg>';

  function richText(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }

  // d boleh berasal dari form maupun dari database (yang sudah membawa nama & logo toko/ekspedisi).
  function labelHtml(d, framed) {
    var toko = findMaster('toko', d.toko_id), eks = findMaster('ekspedisi', d.ekspedisi_id);
    var tokoNama = d.toko_nama || (toko && toko.nama) || '';
    var tokoLogo = d.toko_logo_url || (toko && toko.logo_url);
    var eksNama = d.ekspedisi_nama || (eks && eks.nama) || '';
    var eksLogo = d.ekspedisi_logo_url || (eks && eks.logo_url);
    var cod = d.metode_bayar === 'cod';
    var mask = !!+d.samarkan_telepon;

    var box;
    if (d.catatan && String(d.catatan).trim()) box = '<div class="sl-box' + (cod ? ' cod' : '') + '">' + (cod ? '' : ICON_NO_PAY) + '<span>' + richText(d.catatan) + '</span></div>';
    else if (cod) box = '<div class="sl-box cod"><span>COD — Kurir wajib menagih penerima sebesar ' + esc(rupiah(d.nilai_cod)) + '</span></div>';
    else box = '<div class="sl-box">' + ICON_NO_PAY + '<span>Penjual <b>tidak perlu</b> bayar apapun ke kurir, sudah dibayarkan otomatis</span></div>';

    var items = (d.items || []).filter(function (it) { return String(it.produk || '').trim(); });
    var itemsHtml = items.map(function (it) {
      return '<tr><td>' + esc(it.produk) + '</td><td class="sku">' + esc(it.sku) + '</td>' +
        '<td class="qty"><b>' + esc(it.jumlah) + '</b> ' + esc(it.satuan || 'pcs') + '</td></tr>';
    }).join('');

    return '<div class="sl' + (framed ? ' framed' : '') + '">' +
      '<div class="sl-head">' +
        (tokoLogo ? '<img src="' + esc(tokoLogo) + '" alt="' + esc(tokoNama) + '">' : '<span class="sl-shop">' + esc(tokoNama) + '</span>') +
        '<span class="sl-pay">' + (cod ? 'COD' : 'Non Tunai') + '</span>' +
      '</div>' +
      '<div class="sl-top">' +
        '<div>' +
          '<div class="sl-inv">' + esc(d.no_invoice) + '</div>' +
          '<div class="sl-courier">' + (eksLogo ? '<img src="' + esc(eksLogo) + '" alt="">' : '') +
            '<div class="nm">' + esc(eksNama) + (d.layanan ? '<b>' + esc(d.layanan) + '</b>' : '') + '</div></div>' +
          '<div class="sl-meta">' +
            '<span>Berat:<b>' + esc(kg(d.berat_kg)) + '</b></span>' +
            '<span>Ongkir:<b>' + (cod ? esc(rupiah(d.ongkir)) : '<s>' + esc(rupiah(d.ongkir)) + '</s>') + '</b></span>' +
          '</div>' +
        '</div>' +
        '<div class="sl-code">' +
          (d.kode_barcode ? '<svg class="bc" data-code="' + esc(d.kode_barcode) + '"></svg>' : '<div style="height:14.5mm"></div>') +
          '<div class="code">' + esc(d.kode_barcode) + '</div>' +
          (d.keterangan_barcode ? '<div class="note">' + esc(d.keterangan_barcode) + '</div>' : '') +
        '</div>' +
      '</div>' +
      box +
      '<div class="sl-addr">' +
        '<div><span class="t">Kepada:</span><b>' + esc(d.penerima_nama) + '</b>' + esc(d.penerima_alamat) +
          (d.penerima_telepon ? '\n' + esc(maskPhone(d.penerima_telepon, mask)) : '') + '</div>' +
        '<div><span class="t">Dari:</span><b>' + esc(d.pengirim_nama) + '</b>' + esc(d.pengirim_alamat) +
          (d.pengirim_telepon ? '\n' + esc(maskPhone(d.pengirim_telepon, mask)) : '') + '</div>' +
      '</div>' +
      (items.length ? '<div class="sl-items"><table><thead><tr><th>Produk</th><th class="sku">SKU</th><th class="qty">Jumlah</th></tr></thead>' +
        '<tbody>' + itemsHtml + '</tbody></table></div>' : '') +
    '</div>';
  }

  function drawBarcodes(root) {
    var svgs = root.querySelectorAll('svg.bc');
    for (var i = 0; i < svgs.length; i++) {
      var svg = svgs[i];
      try {
        JsBarcode(svg, svg.getAttribute('data-code'), { format: 'CODE128', displayValue: false, margin: 0, width: 2, height: 60 });
        var w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
        svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.removeAttribute('style');
      } catch (e) {
        svg.outerHTML = '<div class="error" style="height:14.5mm">Kode tidak bisa dibuat barcode</div>';
      }
    }
  }

  // Susun label ke halaman sesuai ukuran kertas; tiap label diperkecil/diperbesar agar pas di selnya.
  function pagesHtml(labels, paperKey) {
    var P = PAPERS[paperKey] || PAPERS['100x100'];
    var per = P.cols * P.rows, cw = P.w / P.cols, ch = P.h / P.rows;
    var out = [];
    for (var p = 0; p < Math.max(1, Math.ceil(labels.length / per)); p++) {
      out.push('<div class="ppage" style="width:' + P.w + 'mm;height:' + P.h + 'mm">');
      for (var i = 0; i < per; i++) {
        var lab = labels[p * per + i];
        if (lab == null) continue;
        var c = i % P.cols, r = Math.floor(i / P.cols);
        out.push('<div class="pcell" data-w="' + (cw - 2 * PAGE_MARGIN) + '" data-h="' + (ch - 2 * PAGE_MARGIN) + '" style="left:' +
          (c * cw + PAGE_MARGIN) + 'mm;top:' + (r * ch + PAGE_MARGIN) + 'mm;width:' + (cw - 2 * PAGE_MARGIN) + 'mm;height:' +
          (ch - 2 * PAGE_MARGIN) + 'mm">' + lab + '</div>');
      }
      out.push('</div>');
    }
    return out.join('');
  }

  function fitLabels(root) {
    var cells = root.querySelectorAll('.pcell');
    for (var i = 0; i < cells.length; i++) {
      var sl = cells[i].firstChild;
      sl.style.zoom = 1;
      var pxPerMm = sl.offsetWidth / 100;
      if (!pxPerMm) continue;
      var hMm = sl.offsetHeight / pxPerMm;
      var z = Math.min(+cells[i].getAttribute('data-w') / 100, +cells[i].getAttribute('data-h') / hMm);
      sl.style.zoom = Math.floor(z * 1000) / 1000;
    }
  }

  function whenImagesReady(root) {
    var imgs = root.querySelectorAll('img');
    return Promise.all(Array.prototype.map.call(imgs, function (img) {
      if (img.complete) return null;
      return new Promise(function (res) { img.onload = img.onerror = res; });
    }));
  }

  function setPageSize() {
    var P = PAPERS[prefs.paper] || PAPERS['100x100'];
    $('page-style').textContent = '@page { size: ' + P.w + 'mm ' + P.h + 'mm; margin: 0; }';
  }

  var previewTimer = null;
  function renderPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      var area = $('preview');
      area.innerHTML = pagesHtml([labelHtml(getForm(), prefs.frame !== false)], prefs.paper);
      drawBarcodes(area);
      fitLabels(area);
      whenImagesReady(area).then(function () { fitLabels(area); });
    }, 80);
  }

  function printRecords(records) {
    var area = $('print-area');
    setPageSize();
    area.innerHTML = pagesHtml(records.map(function (d) { return labelHtml(d, prefs.frame !== false); }), prefs.paper);
    area.style.display = 'block'; // perlu tampil agar ukuran bisa diukur
    area.style.position = 'absolute';
    area.style.left = '-10000px';
    drawBarcodes(area);
    return whenImagesReady(area).then(function () {
      fitLabels(area);
      area.style.display = area.style.position = area.style.left = '';
      window.print();
      var ids = records.map(function (r) { return +r.id; }).filter(Boolean);
      if (ids.length) return api('api/pengiriman.php', { action: 'printed', ids: ids }).then(loadHistory);
    });
  }

  /* ------------------------- Simpan & riwayat ------------------------- */

  function save() {
    var d = getForm();
    if (!d.kode_barcode.trim()) { status('Kode barcode / resi wajib diisi.', true); frm.elements.kode_barcode.focus(); return Promise.reject(); }
    if (!d.penerima_nama.trim()) { status('Nama penerima wajib diisi.', true); frm.elements.penerima_nama.focus(); return Promise.reject(); }
    status('Menyimpan…');
    return api('api/pengiriman.php', { action: 'save', data: d }).then(function (j) {
      frm.elements.id.value = j.id;
      prefs.lastToko = d.toko_id;
      prefs.lastEkspedisi = d.ekspedisi_id;
      saveDraft();
      status('Tersimpan (#' + j.id + ') ' + new Date().toLocaleTimeString('id-ID'));
      loadHistory();
      return j.id;
    }, function (e) { status('Gagal menyimpan: ' + e.message, true); throw e; });
  }

  function loadHistory() {
    var q = $('inp-search').value.trim();
    return api('api/pengiriman.php?limit=200' + (q ? '&q=' + encodeURIComponent(q) : '')).then(function (j) {
      history = j.data;
      renderHistory();
    }).catch(function (e) { $('hist-table').innerHTML = '<tr><td class="error">' + esc(e.message) + '</td></tr>'; });
  }

  function renderHistory() {
    var cur = +frm.elements.id.value;
    var html = '<thead><tr><th><input type="checkbox" id="chk-all"></th><th>Tanggal</th><th>Invoice</th><th>Kode</th><th>Penerima</th>' +
      '<th>Toko</th><th>Ekspedisi</th><th>Bayar</th><th>Status</th><th></th></tr></thead><tbody>';
    if (!history.length) html += '<tr><td colspan="10" class="empty">Belum ada label tersimpan.</td></tr>';
    history.forEach(function (r) {
      html += '<tr class="' + (+r.id === cur ? 'current' : '') + '">' +
        '<td><input type="checkbox" data-id="' + r.id + '"' + (selected[r.id] ? ' checked' : '') + '></td>' +
        '<td>' + esc(String(r.created_at).slice(0, 16)) + '</td>' +
        '<td class="wrap">' + esc(r.no_invoice) + '</td><td>' + esc(r.kode_barcode) + '</td>' +
        '<td class="wrap">' + esc(r.penerima_nama) + '</td><td>' + esc(r.toko_nama) + '</td>' +
        '<td>' + esc([r.ekspedisi_nama, r.layanan].filter(Boolean).join(' · ')) + '</td>' +
        '<td><span class="badge' + (r.metode_bayar === 'cod' ? ' cod' : '') + '">' + (r.metode_bayar === 'cod' ? 'COD' : 'Non Tunai') + '</span></td>' +
        '<td>' + (r.dicetak_at ? '<span class="badge ok" title="' + esc(r.dicetak_at) + '">Dicetak</span>' : '<span class="badge">Belum</span>') + '</td>' +
        '<td><button type="button" data-edit="' + r.id + '">Ubah</button> <button type="button" data-print="' + r.id + '">Cetak</button> ' +
        '<button type="button" class="danger" data-del="' + r.id + '">Hapus</button></td></tr>';
    });
    $('hist-table').innerHTML = html + '</tbody>';
    updateSelected();
  }

  function updateSelected() {
    var n = Object.keys(selected).filter(function (k) { return selected[k]; }).length;
    $('btn-print-selected').disabled = !n;
    $('btn-print-selected').textContent = n ? 'Cetak terpilih (' + n + ')' : 'Cetak terpilih';
    $('hist-count').textContent = history.length + ' label';
  }

  function fetchDetails(ids) {
    return api('api/pengiriman.php?ids=' + ids.join(',')).then(function (j) { return j.data; });
  }

  /* ------------------------- Event ------------------------- */

  frm.addEventListener('input', function () { renderPreview(); saveDraft(); });
  frm.addEventListener('change', function (e) {
    var name = e.target.name;
    if (name === 'toko_id') {
      var t = findMaster('toko', e.target.value);
      if (t) {
        frm.elements.pengirim_nama.value = t.pengirim_nama || '';
        frm.elements.pengirim_alamat.value = t.pengirim_alamat || '';
        frm.elements.pengirim_telepon.value = t.pengirim_telepon || '';
      }
    }
    if (name === 'ekspedisi_id') {
      var x = findMaster('ekspedisi', e.target.value);
      if (x && x.layanan_default) frm.elements.layanan.value = x.layanan_default;
    }
    if (name === 'metode_bayar') onPayChange();
    renderPreview();
    saveDraft();
  });
  $('items').addEventListener('click', function (e) {
    if (e.target.tagName !== 'BUTTON') return;
    e.target.parentNode.remove();
    renderPreview();
    saveDraft();
  });
  $('btn-add-item').addEventListener('click', function () {
    addItemRow();
    var rows = $('items').querySelectorAll('.item-row:not(.item-head)');
    rows[rows.length - 1].querySelector('input').focus();
  });

  $('btn-new').addEventListener('click', function () {
    setForm(emptyRecord());
    status('Label baru.');
    renderHistory();
    frm.elements.no_invoice.focus();
  });
  $('btn-save').addEventListener('click', function () { save().catch(function () {}); });
  $('btn-save-print').addEventListener('click', function () {
    save().then(function (id) { return fetchDetails([id]); }).then(printRecords).catch(function (e) {
      if (e) status('Gagal mencetak: ' + e.message, true);
    });
  });

  $('sel-paper').value = PAPERS[prefs.paper] ? prefs.paper : (prefs.paper = '100x100');
  $('sel-paper').addEventListener('change', function () { prefs.paper = this.value; savePrefs(); renderPreview(); });
  $('inp-zoom').value = prefs.zoom || 1.6;
  $('preview').style.zoom = $('inp-zoom').value;
  $('inp-zoom').addEventListener('input', function () { prefs.zoom = +this.value; $('preview').style.zoom = this.value; savePrefs(); });
  $('chk-frame').checked = prefs.frame !== false;
  $('chk-frame').addEventListener('change', function () { prefs.frame = this.checked; savePrefs(); renderPreview(); });

  var tabs = document.querySelectorAll('.tab');
  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener('click', function () {
      Array.prototype.forEach.call(tabs, function (t) { t.classList.toggle('active', t === tab); });
      $('tab-preview').hidden = tab.getAttribute('data-tab') !== 'preview';
      $('tab-history').hidden = tab.getAttribute('data-tab') !== 'history';
      if (!$('tab-history').hidden) loadHistory();
    });
  });

  var searchTimer = null;
  $('inp-search').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(loadHistory, 250); });

  $('hist-table').addEventListener('change', function (e) {
    if (e.target.id === 'chk-all') {
      history.forEach(function (r) { selected[r.id] = e.target.checked; });
      renderHistory();
      return;
    }
    var id = e.target.getAttribute('data-id');
    if (id) { selected[id] = e.target.checked; updateSelected(); }
  });
  $('hist-table').addEventListener('click', function (e) {
    var id = e.target.getAttribute('data-edit');
    if (id) {
      fetchDetails([id]).then(function (rows) {
        if (!rows.length) return;
        setForm(rows[0]);
        saveDraft();
        status('Mengubah label #' + id);
        tabs[0].click();
      }).catch(function (err) { alert(err.message); });
      return;
    }
    id = e.target.getAttribute('data-print');
    if (id) { fetchDetails([id]).then(printRecords).catch(function (err) { alert(err.message); }); return; }
    id = e.target.getAttribute('data-del');
    if (id && confirm('Hapus label #' + id + '?')) {
      api('api/pengiriman.php', { action: 'delete', id: +id }).then(function () {
        delete selected[id];
        if (frm.elements.id.value === id) frm.elements.id.value = '';
        loadHistory();
      }).catch(function (err) { alert(err.message); });
    }
  });
  $('btn-print-selected').addEventListener('click', function () {
    var ids = history.filter(function (r) { return selected[r.id]; }).map(function (r) { return r.id; });
    if (ids.length) fetchDetails(ids).then(printRecords).catch(function (err) { alert(err.message); });
  });

  if (typeof JsBarcode === 'undefined') status('Library barcode (vendor/JsBarcode.all.min.js) tidak ditemukan.', true);
  loadMaster().then(function () {
    setForm(prefs.draft || emptyRecord());
    loadHistory();
  });
})();
