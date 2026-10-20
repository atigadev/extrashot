/* Cetak foto / pas foto: susun foto ke kertas sesuai ukuran standar, lalu cetak dengan skala 100%. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = 'cetakFoto.v1';

  // Ukuran standar foto (lebar × tinggi, cm) sesuai tabel acuan.
  var SIZES = [
    { key: '2x3', inch: '0.85 x 1.1', w: 2.16, h: 2.79 },
    { key: '3x4', inch: '1.1 x 1.5', w: 2.79, h: 3.81 },
    { key: '4x6', inch: '1.5 x 2.2', w: 3.81, h: 5.59 },
    { key: '2R', inch: '2.2 x 3.5', w: 5.59, h: 8.89 },
    { key: '3R', inch: '3.5 x 5', w: 8.89, h: 12.70 },
    { key: '4R', inch: '4 x 6', w: 10.16, h: 15.24 },
    { key: '5R', inch: '5 x 7', w: 12.70, h: 17.78 },
    { key: '6R', inch: '6 x 8', w: 15.24, h: 20.32 },
    { key: '8R', inch: '8 x 10', w: 20.32, h: 25.40 },
    { key: '8RS', inch: '8 x 12', w: 20.32, h: 30.48 }
  ];
  var PAPERS = [
    { key: 'a4', name: 'A4 (210 × 297)', w: 210, h: 297 },
    { key: 'f4', name: 'F4 / Folio (215 × 330)', w: 215, h: 330 },
    { key: 'letter', name: 'Letter (216 × 279)', w: 215.9, h: 279.4 },
    { key: 'a3', name: 'A3 (297 × 420)', w: 297, h: 420 },
    { key: 'a5', name: 'A5 (148 × 210)', w: 148, h: 210 },
    { key: '4R', name: 'Kertas foto 4R (102 × 152)', w: 101.6, h: 152.4 },
    { key: '5R', name: 'Kertas foto 5R (127 × 178)', w: 127, h: 177.8 },
    { key: '6R', name: 'Kertas foto 6R (152 × 203)', w: 152.4, h: 203.2 },
    { key: '8R', name: 'Kertas foto 8R (203 × 254)', w: 203.2, h: 254 },
    { key: 'custom', name: 'Kustom', w: 210, h: 297 }
  ];
  var MIN_DPI = 150;

  var settings = loadSettings();
  var items = [];
  var nextId = 1;

  function loadSettings() {
    // guideMode: 'crop' = tanda potong standar cetak (bleed + crop marks), 'box' = kotak garis, 'none' = tanpa garis
    var def = { paper: 'a4', orient: 'portrait', pw: 210, ph: 297, margin: 10, gap: 2, guideMode: 'crop', bleed: 0, markLen: 5, ruler: true, ver: 2,
      guideOffset: 2, rotate: true, defSize: '3x4', defQty: 4, zoom: 0.7,
      // kertas sisa: lembar pertama hanya memakai bagian kertas yang tersisa setelah dipotong
      leftover: false, leftSide: 'bottom', leftSize: 150, cutSafe: 3, leftFeed: 'inplace',
      // leftShape 'side' = potong lurus satu sisi, 'corner' = potong sudut (sisa kertas berbentuk L)
      leftShape: 'side', cornerPos: 'tl', cornerW: 100, cornerH: 65, leftFlip: false,
      // kalibrasi posisi cetak (mm), berlaku untuk semua lembar
      offX: 0, offY: 0 };
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      for (var k in def) if (s[k] !== undefined) def[k] = s[k];
      if (s.guideMode === undefined && s.guides === false) def.guideMode = 'none'; // pengaturan versi lama
      // versi 2: hasil cetak harus persis ukuran pilihan → bleed lama (gambar melebar 2 mm) dikembalikan ke 0
      if (!(s.ver >= 2)) { def.bleed = 0; def.ver = 2; }
    } catch (e) { /* abaikan */ }
    return def;
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* abaikan */ }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function sizeByKey(k) { for (var i = 0; i < SIZES.length; i++) if (SIZES[i].key === k) return SIZES[i]; return null; }
  function paperByKey(k) { for (var i = 0; i < PAPERS.length; i++) if (PAPERS[i].key === k) return PAPERS[i]; return PAPERS[0]; }

  /* ------------------------- Foto ------------------------- */

  // Ukuran foto (mm) sesuai pilihan & orientasi item.
  function photoSize(it) {
    var w, h;
    if (it.size === 'custom') { w = it.cw; h = it.ch; }
    else { var s = sizeByKey(it.size); w = s.w * 10; h = s.h * 10; }
    return it.landscape ? { w: h, h: w } : { w: w, h: h };
  }

  function sizeLabel(it) {
    var d = photoSize(it), b = borderOf(it), a = imageArea(it);
    return (it.size === 'custom' ? 'Kustom' : it.size) + ' · ' + (d.w / 10).toFixed(2) + ' × ' + (d.h / 10).toFixed(2) + ' cm' +
      (b ? ' (gambar ' + (a.w / 10).toFixed(2) + ' × ' + (a.h / 10).toFixed(2) + ' cm di dalam border)' : '');
  }

  // Tebal border (mm). Ukuran hasil potong SELALU = ukuran pilihan: border berada di dalamnya, mengelilingi
  // gambar (gambar diperkecil, tidak tertutup border).
  function borderOf(it) {
    var d = photoSize(it);
    return Math.max(0, Math.min(num(it.borderW, 0), Math.min(d.w, d.h) / 2 - 1));
  }
  // Area gambar (mm, orientasi foto) = ukuran foto dikurangi border di tiap sisi.
  function imageArea(it) {
    var d = photoSize(it), b = borderOf(it);
    return { w: d.w - 2 * b, h: d.h - 2 * b };
  }

  // Posisi gambar di dalam bingkai (persen), mode "isi penuh" + perbesar + geser.
  function imgBox(it, w, h) {
    var a = it.iw / it.ih, c = w / h, wp, hp;
    if (a > c) { hp = 100; wp = 100 * a / c; } else { wp = 100; hp = 100 * c / a; }
    wp *= it.zoom; hp *= it.zoom;
    return { w: wp, h: hp, l: (100 - wp) * it.px, t: (100 - hp) * it.py };
  }
  function imgStyle(b) {
    return 'width:' + b.w.toFixed(3) + '%;height:' + b.h.toFixed(3) + '%;left:' + b.l.toFixed(3) + '%;top:' + b.t.toFixed(3) + '%';
  }
  function dpi(it) {
    var a = imageArea(it), b = imgBox(it, a.w, a.h);
    return Math.round(it.iw * (100 / b.w) / (a.w / 25.4));
  }

  // Pas foto (2x3, 3x4, 4x6) selalu tegak; ukuran R mengikuti arah foto aslinya.
  function autoOrient(it) {
    it.landscape = !/^\dx\d$/.test(it.size) && it.size !== 'custom' && it.iw > it.ih;
  }

  function loadImage(src) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('Gambar tidak bisa dibuka')); };
      img.src = src;
    });
  }

  function addFiles(files) {
    var list = Array.prototype.filter.call(files, function (f) { return /^image\//.test(f.type); });
    addPrepared(list.map(function (f) { return { file: f }; }));
  }

  // entries: [{ file, size?, cw?, ch?, qty? }] — size/cw/ch diisi bila ukuran sudah ditentukan (mis. dari Crop Massal).
  function addPrepared(entries) {
    if (!entries.length) return;
    Promise.all(entries.map(function (e) {
      var f = e.file, url = URL.createObjectURL(f);
      return loadImage(url).then(function (img) {
        return {
          id: nextId++, name: f.name, orig: url, ow: img.naturalWidth, oh: img.naturalHeight,
          src: url, iw: img.naturalWidth, ih: img.naturalHeight, rot: 0,
          size: e.size || settings.defSize, cw: e.cw || 30, ch: e.ch || 40, landscape: false, preset: !!e.size,
          qty: Math.max(1, Math.round(num(e.qty || settings.defQty, 1))), zoom: 1, px: 0.5, py: 0.5, borderW: 0, borderColor: '#ffffff'
        };
      }).catch(function () { URL.revokeObjectURL(url); alert('File "' + f.name + '" tidak bisa dibaca sebagai gambar.'); return null; });
    })).then(function (newItems) {
      newItems.forEach(function (it) {
        if (!it) return;
        if (!it.preset) autoOrient(it);
        delete it.preset;
        items.push(it);
      });
      renderItems();
      render();
    });
  }

  // Terima hasil dari halaman Crop Massal (dibuka sebagai foto.html#import). Data hanya lewat memori.
  if (location.hash === '#import' && window.opener) {
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || e.source !== window.opener || !e.data || e.data.type !== 'cropmassal-files') return;
      addPrepared((e.data.items || []).filter(function (x) { return x && x.file instanceof Blob; }).map(function (x) {
        var std = sizeByKey(x.size);
        return std ? { file: x.file, size: x.size, qty: 1 } : { file: x.file, size: 'custom', cw: +(+x.cw).toFixed(2), ch: +(+x.ch).toFixed(2), qty: 1 };
      }));
      history.replaceState(null, '', location.pathname);
    });
    window.opener.postMessage({ type: 'cetakfoto-ready' }, location.origin);
  }

  // Putar sumber gambar 90° searah jarum jam (hasil disimpan sebagai gambar baru).
  function rotateItem(it) {
    it.rot = (it.rot + 90) % 360;
    return rebuildSrc(it);
  }

  // Bentuk gambar yang dipakai: foto asli (atau hasil ganti background), lalu diputar sesuai it.rot.
  function rebuildSrc(it) {
    var base = it.bgUrl || it.orig;
    var old = it.src;
    if (old !== it.orig && old !== it.bgUrl && !items.some(function (x) { return x !== it && x.src === old; })) URL.revokeObjectURL(old);
    if (!it.rot) {
      it.src = base; it.iw = it.ow; it.ih = it.oh;
      return Promise.resolve();
    }
    return loadImage(base).then(function (img) {
      var cv = document.createElement('canvas');
      var side = it.rot % 180 !== 0;
      cv.width = side ? it.oh : it.ow;
      cv.height = side ? it.ow : it.oh;
      var ctx = cv.getContext('2d');
      ctx.translate(cv.width / 2, cv.height / 2);
      ctx.rotate(it.rot * Math.PI / 180);
      ctx.drawImage(img, -it.ow / 2, -it.oh / 2);
      return new Promise(function (res) {
        cv.toBlob(function (blob) {
          it.src = URL.createObjectURL(blob);
          it.iw = cv.width; it.ih = cv.height;
          res();
        }, 'image/jpeg', 0.95);
      });
    });
  }

  /* ------------------------- Daftar item ------------------------- */

  function sizeOptions(sel) {
    return SIZES.map(function (s) {
      return '<option value="' + s.key + '"' + (s.key === sel ? ' selected' : '') + '>' + s.key + ' (' + s.w + ' × ' + s.h + ' cm)</option>';
    }).join('') + '<option value="custom"' + (sel === 'custom' ? ' selected' : '') + '>Kustom…</option>';
  }

  // Border digambar di dalam ukuran foto (ukuran cetak tetap standar). `extra` = lebar tambahan di luar
  // ukuran potong (bleed) yang ikut diberi warna border; `unit` = 'mm' atau 'px'.
  var BORDER_COLORS = [
    { name: 'Putih', v: '#ffffff' }, { name: 'Hitam', v: '#000000' }, { name: 'Abu-abu', v: '#9aa0a6' },
    { name: 'Merah', v: '#d71920' }, { name: 'Biru', v: '#1e5bb8' }, { name: 'Emas', v: '#c9a227' }
  ];
  // Digambar sebagai SVG (bingkai = kotak luar dikurangi kotak dalam) agar tebalnya tepat dalam mm saat dicetak;
  // border CSS dibulatkan browser ke piksel utuh. W × H = ukuran wadah dalam mm.
  function borderHtml(it, extra, W, H) {
    var w = Math.max(0, num(it.borderW, 0));
    if (!w) return '';
    var t = Math.min(w + (extra || 0), W / 2, H / 2);
    var f = function (n) { return +n.toFixed(3); };
    var d = 'M0 0H' + f(W) + 'V' + f(H) + 'H0Z' + 'M' + f(t) + ' ' + f(t) + 'V' + f(H - t) + 'H' + f(W - t) + 'V' + f(t) + 'Z';
    return '<svg class="pborder" viewBox="0 0 ' + f(W) + ' ' + f(H) + '" preserveAspectRatio="none">' +
      '<path d="' + d + '" fill="' + esc(it.borderColor || '#ffffff') + '" fill-rule="evenodd"/></svg>';
  }

  // Foto ukuran pilihan (termasuk border) digambar dalam piksel dengan skala k px/mm; gambar di dalam border.
  function framedPx(it, k, cls) {
    var d = photoSize(it), bw = borderOf(it), a = imageArea(it);
    return { w: d.w * k, h: d.h * k, html:
      '<div class="photo ' + (cls || '') + '" style="left:' + (bw * k) + 'px;top:' + (bw * k) + 'px;width:' + (a.w * k) + 'px;height:' + (a.h * k) + 'px">' +
      '<img src="' + it.src + '" style="' + imgStyle(imgBox(it, a.w, a.h)) + '"></div>' + borderHtml(it, 0, d.w, d.h) };
  }

  function thumbHtml(it) {
    var d = photoSize(it);
    var k = Math.min(56 / d.w, 70 / d.h), f = framedPx(it, k);
    return '<div class="thumb" data-crop="' + it.id + '" title="Atur potongan" style="width:' + f.w + 'px;height:' + f.h + 'px">' + f.html + '</div>';
  }

  function renderItems() {
    var el = $('items');
    var total = items.reduce(function (s, it) { return s + it.qty; }, 0);
    $('item-count').textContent = items.length ? '(' + items.length + ' foto, ' + total + ' lembar foto)' : '';
    $('btn-clear-all').hidden = !items.length;
    if (!items.length) { el.innerHTML = '<p class="empty">Belum ada foto.</p>'; return; }
    el.innerHTML = items.map(function (it) {
      var q = dpi(it);
      return '<div class="photo-item" data-id="' + it.id + '">' +
        '<div style="display:flex;justify-content:center;align-items:center">' + thumbHtml(it) + '</div>' +
        '<div style="min-width:0">' +
          '<div class="name" title="' + esc(it.name) + '">' + esc(it.name) + (it.bgUrl ? '<span class="badge-bg">BG diganti</span>' : '') +
            (it.borderW > 0 ? '<span class="badge-bg" style="background:#eef0f3;color:#333"><i class="dot" style="background:' + esc(it.borderColor) + '"></i>Border ' + it.borderW + ' mm</span>' : '') + '</div>' +
          '<div class="row"><select data-f="size">' + sizeOptions(it.size) + '</select>' +
            '<input type="number" data-f="qty" min="0" value="' + it.qty + '" title="Jumlah cetak"></div>' +
          (it.size === 'custom' ? '<div class="row custom">L <input type="number" data-f="cw" min="5" step="0.5" value="' + it.cw + '"> × T ' +
            '<input type="number" data-f="ch" min="5" step="0.5" value="' + it.ch + '"> mm</div>' : '') +
          '<div class="row">' +
            '<button type="button" data-act="crop">Atur</button>' +
            '<button type="button" data-act="bg" title="Hapus & ganti background">Background</button>' +
            '<button type="button" data-act="flip" title="Tegak / mendatar">' + (it.landscape ? 'Mendatar' : 'Tegak') + '</button>' +
            '<button type="button" data-act="fill" title="Isi satu lembar kertas penuh dengan foto ini">Penuhi 1 lembar</button>' +
            '<button type="button" data-act="dup" title="Tambah ukuran lain dari foto yang sama">+ Ukuran</button>' +
            '<button type="button" data-act="del" class="danger">Hapus</button>' +
          '</div>' +
          (q < MIN_DPI ? '<div class="warn">⚠ Resolusi rendah (±' + q + ' dpi) — hasil cetak bisa buram.</div>' : '') +
        '</div></div>';
    }).join('');
  }

  function findItem(id) { for (var i = 0; i < items.length; i++) if (items[i].id === +id) return items[i]; return null; }

  $('items').addEventListener('change', function (e) {
    var f = e.target.getAttribute('data-f'), row = e.target.closest('.photo-item');
    if (!f || !row) return;
    var it = findItem(row.getAttribute('data-id'));
    if (f === 'size') { it.size = e.target.value; it.zoom = 1; it.px = it.py = 0.5; autoOrient(it); }
    if (f === 'qty') it.qty = Math.max(0, Math.round(num(e.target.value, 0)));
    if (f === 'cw') it.cw = Math.max(5, num(e.target.value, it.cw));
    if (f === 'ch') it.ch = Math.max(5, num(e.target.value, it.ch));
    renderItems();
    render();
  });

  $('items').addEventListener('click', function (e) {
    var row = e.target.closest('.photo-item');
    if (!row) return;
    var it = findItem(row.getAttribute('data-id'));
    var act = e.target.getAttribute('data-act') || (e.target.closest('[data-crop]') ? 'crop' : '');
    if (act === 'crop') openCrop(it);
    if (act === 'bg') openBackground(it);
    if (act === 'flip') { it.landscape = !it.landscape; it.px = it.py = 0.5; }
    if (act === 'fill') it.qty = Math.max(1, capacity(it));
    if (act === 'del') {
      items.splice(items.indexOf(it), 1);
      var shared = items.some(function (x) { return x.orig === it.orig; });
      if (!shared) URL.revokeObjectURL(it.orig);
      if (it.src !== it.orig && !items.some(function (x) { return x.src === it.src; })) URL.revokeObjectURL(it.src);
    }
    if (act === 'dup') {
      var copy = {};
      for (var k in it) copy[k] = it[k];
      copy.id = nextId++;
      var idx = -1;
      for (var i = 0; i < SIZES.length; i++) if (SIZES[i].key === it.size) idx = i;
      copy.size = idx >= 0 && idx < SIZES.length - 1 ? SIZES[idx + 1].key : it.size;
      copy.zoom = 1; copy.px = copy.py = 0.5;
      items.splice(items.indexOf(it) + 1, 0, copy);
    }
    if (act && act !== 'crop') { renderItems(); render(); }
  });

  /* ------------------------- Susun ke kertas ------------------------- */

  function paperDims() {
    var w = settings.pw, h = settings.ph;
    if (settings.orient === 'landscape' ? w < h : w > h) { var t = w; w = h; h = t; }
    return { w: w, h: h };
  }

  // Penyusunan MaxRects (aturan kiri-atas): tiap foto ditaruh di ruang kosong paling atas lalu paling kiri,
  // sehingga celah di samping foto besar ikut terisi foto kecil. Jarak antar foto ditangani dengan
  // "menggembungkan" tiap foto dan area kertas sebesar jarak tersebut.
  // Tata letak lembar ke-i: ukuran halaman, area yang boleh diisi foto, batas kertas fisik, dan bagian yang
  // sudah terpotong. Bila "kertas sisa" aktif, lembar pertama hanya memakai bagian kertas yang tersisa.
  //  - leftFeed 'inplace': sisa kertas diletakkan di posisi asalnya pada kertas utuh → halaman tetap ukuran penuh
  //  - leftFeed 'small'  : sisa kertas dimasukkan langsung → halaman = ukuran sisa kertas
  function pageLayout(i) {
    var P = paperDims(), m = Math.max(0, num(settings.margin, 0));
    if (!settings.leftover || i > 0) {
      return { w: P.w, h: P.h, area: { x: m, y: m, w: P.w - 2 * m, h: P.h - 2 * m }, bounds: { x0: 0, y0: 0, x1: P.w, y1: P.h }, cut: [], leftover: false };
    }
    var cs = Math.max(0, num(settings.cutSafe, 0)), R, cut;
    // Kertas dimasukkan terbalik (diputar 180°): posisi fisik (x, y) menjadi (lebar − x, tinggi − y) di cetakan.
    var FLIP_SIDE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
    var FLIP_CORNER = { tl: 'br', br: 'tl', tr: 'bl', bl: 'tr' };

    if (settings.leftShape === 'corner') {
      // Sudut kertas sudah terpotong: sisa kertas berbentuk L, ukuran luar tetap kertas utuh.
      var pos = settings.leftFlip ? FLIP_CORNER[settings.cornerPos] : settings.cornerPos;
      var cw = Math.max(1, Math.min(P.w, num(settings.cornerW, 50))), ch = Math.max(1, Math.min(P.h, num(settings.cornerH, 50)));
      var cx = pos === 'tl' || pos === 'bl' ? 0 : P.w - cw, cy = pos === 'tl' || pos === 'tr' ? 0 : P.h - ch;
      var hole = { x: cx, y: cy, w: cw, h: ch };
      // area yang dihindari = potongan + jarak aman di dua sisi bekas potongan (sisi ke arah tengah kertas)
      var avoid = { x: cx > 0 ? cx - cs : 0, y: cy > 0 ? cy - cs : 0, w: cw + cs, h: ch + cs };
      return { w: P.w, h: P.h, area: { x: m, y: m, w: P.w - 2 * m, h: P.h - 2 * m }, bounds: { x0: 0, y0: 0, x1: P.w, y1: P.h },
        cut: [hole], avoid: [avoid], leftover: true, corner: true, R: { x: 0, y: 0, w: P.w, h: P.h } };
    }

    var side = settings.leftFlip ? FLIP_SIDE[settings.leftSide] : settings.leftSide, vert = side === 'top' || side === 'bottom';
    var S = Math.max(5, Math.min(vert ? P.h : P.w, num(settings.leftSize, 100)));
    if (side === 'bottom') { R = { x: 0, y: P.h - S, w: P.w, h: S }; cut = { x: 0, y: 0, w: P.w, h: P.h - S }; }
    else if (side === 'top') { R = { x: 0, y: 0, w: P.w, h: S }; cut = { x: 0, y: S, w: P.w, h: P.h - S }; }
    else if (side === 'right') { R = { x: P.w - S, y: 0, w: S, h: P.h }; cut = { x: 0, y: 0, w: P.w - S, h: P.h }; }
    else { R = { x: 0, y: 0, w: S, h: P.h }; cut = { x: S, y: 0, w: P.w - S, h: P.h }; }
    // tepi asli kertas memakai margin kertas, tepi bekas potongan memakai jarak aman potongan
    var il = side === 'right' ? cs : m, ir = side === 'left' ? cs : m, it = side === 'bottom' ? cs : m, ib = side === 'top' ? cs : m;
    var area = { x: R.x + il, y: R.y + it, w: R.w - il - ir, h: R.h - it - ib };
    if (settings.leftFeed === 'small') {
      return { w: R.w, h: R.h, area: { x: area.x - R.x, y: area.y - R.y, w: area.w, h: area.h }, bounds: { x0: 0, y0: 0, x1: R.w, y1: R.h },
        cut: [], leftover: true, small: true, R: R };
    }
    return { w: P.w, h: P.h, area: area, bounds: { x0: R.x, y0: R.y, x1: R.x + R.w, y1: R.y + R.h }, cut: cut.w > 0 && cut.h > 0 ? [cut] : [],
      leftover: true, R: R };
  }

  function pack(pieces, firstPageOnly) {
    var g = Math.max(0, settings.gap), eps = 0.01;
    var full = pageLayout(1).area, aw = full.w, ah = full.h;
    // tiap halaman menyimpan daftar ruang kosongnya sendiri, jadi halaman sebelumnya tetap bisa diisi
    var pages = [];
    function newPage() {
      var L = pageLayout(pages.length);
      var pg = { L: L, cells: [], free: L.area.w > 0 && L.area.h > 0 ? [{ x: 0, y: 0, w: L.area.w + g, h: L.area.h + g }] : [] };
      // bagian kertas yang sudah tidak ada (potong sudut) dikeluarkan dari ruang kosong
      (L.avoid || []).forEach(function (a) { place(pg, { x: a.x - L.area.x, y: a.y - L.area.y, w: a.w, h: a.h }); });
      pages.push(pg);
      return pg;
    }

    function options(p) {
      var o = [{ w: p.w, h: p.h, rot: false }];
      var normalFits = p.w <= aw + eps && p.h <= ah + eps;
      if (Math.abs(p.w - p.h) > eps && (settings.rotate || !normalFits)) o.push({ w: p.h, h: p.w, rot: true });
      return o;
    }
    function findSpot(free, opts) {
      var best = null;
      free.forEach(function (fr) {
        opts.forEach(function (o, oi) {
          var w = o.w + g, h = o.h + g;
          if (w > fr.w + eps || h > fr.h + eps) return;
          // utamakan posisi teratas, lalu terkiri, lalu tanpa diputar
          var score = [Math.round(fr.y * 100), Math.round(fr.x * 100), oi];
          if (!best || score[0] < best.s[0] || (score[0] === best.s[0] && (score[1] < best.s[1] ||
              (score[1] === best.s[1] && score[2] < best.s[2])))) best = { x: fr.x, y: fr.y, o: o, s: score };
        });
      });
      return best;
    }
    function place(pg, r) {
      var next = [];
      pg.free.forEach(function (fr) {
        if (r.x >= fr.x + fr.w - eps || r.x + r.w <= fr.x + eps || r.y >= fr.y + fr.h - eps || r.y + r.h <= fr.y + eps) {
          next.push(fr);
          return;
        }
        if (r.x > fr.x + eps) next.push({ x: fr.x, y: fr.y, w: r.x - fr.x, h: fr.h });
        if (r.x + r.w < fr.x + fr.w - eps) next.push({ x: r.x + r.w, y: fr.y, w: fr.x + fr.w - r.x - r.w, h: fr.h });
        if (r.y > fr.y + eps) next.push({ x: fr.x, y: fr.y, w: fr.w, h: r.y - fr.y });
        if (r.y + r.h < fr.y + fr.h - eps) next.push({ x: fr.x, y: r.y + r.h, w: fr.w, h: fr.y + fr.h - r.y - r.h });
      });
      // buang ruang kosong yang sepenuhnya berada di dalam ruang kosong lain
      pg.free = next.filter(function (a, i) {
        return !next.some(function (b, j) {
          return i !== j && a.x >= b.x - eps && a.y >= b.y - eps && a.x + a.w <= b.x + b.w + eps && a.y + a.h <= b.y + b.h + eps &&
            (j < i || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h);
        });
      });
    }

    pieces.every(function (p) {
      var opts = options(p), pg = null, spot = null;
      for (var i = 0; i < pages.length && !spot; i++) { spot = findSpot(pages[i].free, opts); if (spot) pg = pages[i]; }
      if (!spot) {
        if (firstPageOnly && pages.length) return false;
        pg = newPage();
        spot = findSpot(pg.free, opts);
        // tidak muat di kertas sisa: pakai lembar utuh berikutnya
        if (!spot && pg.L.leftover && !firstPageOnly) { pg = newPage(); spot = findSpot(pg.free, opts); }
      }
      if (!spot) {
        if (firstPageOnly) return false;
        // lebih besar dari kertas: taruh sendiri di satu lembar (ditandai merah)
        pg.cells.push({ item: p.item, x: pg.L.area.x, y: pg.L.area.y, w: p.w, h: p.h, rot: false, tooBig: true });
        pg.free = [];
        return true;
      }
      pg.cells.push({ item: p.item, x: pg.L.area.x + spot.x, y: pg.L.area.y + spot.y, w: spot.o.w, h: spot.o.h, rot: spot.o.rot, tooBig: false });
      place(pg, { x: spot.x, y: spot.y, w: spot.o.w + g, h: spot.o.h + g });
      return true;
    });
    // kertas sisa yang tidak terisi apa pun tidak perlu dicetak
    leftoverUnused = !!(pages.length > 1 && pages[0].L.leftover && !pages[0].cells.length);
    if (leftoverUnused) pages.shift();
    if (!pages.length) newPage();
    return pages.map(function (pg) { var a = pg.cells; a.L = pg.L; return a; });
  }
  var leftoverUnused = false;

  // Ruang tambahan di tiap sisi foto (mm) yang ikut dihitung saat menyusun foto:
  // bleed untuk tanda potong standar, atau jarak kotak garis untuk mode kotak.
  function guidePad() {
    if (settings.guideMode === 'crop') return Math.max(0, num(settings.bleed, 0));
    if (settings.guideMode === 'box') return Math.max(0, num(settings.guideOffset, 0));
    return 0;
  }

  function buildPieces(list) {
    var pieces = [], pad = guidePad();
    list.forEach(function (it, order) {
      var d = photoSize(it);
      for (var k = 0; k < it.qty; k++) pieces.push({ item: it, w: d.w + 2 * pad, h: d.h + 2 * pad, order: order });
    });
    // tertinggi dulu agar baris rapat; foto yang sama tetap berurutan
    pieces.sort(function (a, b) { return Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.h - a.h || a.order - b.order; });
    return pieces;
  }

  // Berapa foto ini yang muat di satu lembar bila dicetak sendiri.
  function capacity(it) {
    var copy = {};
    for (var k in it) copy[k] = it[k];
    copy.qty = 2000;
    var pages = pack(buildPieces([copy]), true);
    return pages[0].filter(function (c) { return !c.tooBig; }).length;
  }

  /* ------------------------- Render ------------------------- */

  // Slot = ukuran potong foto + ruang tambahan di tiap sisi.
  //  - mode crop: gambar mengisi seluruh slot (bleed), ukuran potong ditunjukkan tanda potong di sudut
  //  - mode box : foto di tengah slot, kotak garis di tepi slot
  //  - border (bila ada) berada DI DALAM ukuran potong dan mengelilingi gambar (gambar diperkecil), sehingga
  //    hasil potong tetap persis ukuran pilihan; pada mode crop, bleed ikut berwarna border.
  function cellHtml(c) {
    var it = c.item, d = photoSize(it), pad = guidePad(), bleed = settings.guideMode === 'crop', bw = borderOf(it);
    var inset = bleed ? 0 : pad;                       // tepi bingkai (area berwarna) di dalam slot
    var fw = c.w - 2 * inset, fh = c.h - 2 * inset;    // ukuran bingkai
    var px, py, pw, ph, iw, ih;                        // posisi & ukuran area gambar (orientasi lembar), ukuran gambar (orientasi foto)
    if (bw > 0) {
      var a = imageArea(it);
      px = py = pad + bw;
      pw = c.rot ? a.h : a.w; ph = c.rot ? a.w : a.h;
      iw = a.w; ih = a.h;
    } else {
      px = py = inset; pw = fw; ph = fh;
      iw = bleed ? d.w + 2 * pad : d.w; ih = bleed ? d.h + 2 * pad : d.h;
    }
    var inner = 'width:' + iw + 'mm;height:' + ih + 'mm;transform:translate(-50%,-50%)' + (c.rot ? ' rotate(90deg)' : '');
    return '<div class="slot' + (settings.guideMode === 'box' ? ' guides' : '') + (c.tooBig ? ' bad' : '') + '" style="left:' + c.x.toFixed(2) +
      'mm;top:' + c.y.toFixed(2) + 'mm;width:' + c.w.toFixed(2) + 'mm;height:' + c.h.toFixed(2) + 'mm">' +
      '<div class="photo" style="left:' + px + 'mm;top:' + py + 'mm;width:' + pw.toFixed(2) + 'mm;height:' + ph.toFixed(2) + 'mm">' +
      '<div class="inner" style="' + inner + '"><img src="' + it.src + '" style="' + imgStyle(imgBox(it, iw, ih)) + '"></div></div>' +
      (bw > 0 ? '<div class="frame" style="left:' + inset + 'mm;top:' + inset + 'mm;width:' + fw.toFixed(2) + 'mm;height:' + fh.toFixed(2) + 'mm">' +
        borderHtml(it, bleed ? pad : 0, fw, fh) + '</div>' : '') +
      '</div>';
  }

  // Tanda potong standar cetak: di tiap sudut ukuran potong, dua garis pendek searah garis potong,
  // dimulai di luar area bleed. Tanda dipendekkan/dihilangkan bila mengenai gambar foto lain atau
  // keluar kertas, sehingga foto yang berdempetan memakai tanda di tepi luar susunan (step & repeat).
  var MARK_STROKE = 0.088; // 0,25 pt
  // lay = tata letak lembar (ukuran halaman & batas kertas fisik); tanda tidak keluar dari kertas yang ada.
  function marksSvg(cells, lay) {
    var P = { w: lay.w, h: lay.h }, B = lay.bounds;
    var b = Math.max(0, num(settings.bleed, 0)), L = Math.max(1, num(settings.markLen, 5));
    var off = Math.max(b, 2), eps = 0.3, minLen = 1;
    var rects = cells.map(function (c) { return { l: c.x - eps, t: c.y - eps, r: c.x + c.w + eps, b: c.y + c.h + eps }; });
    // bagian kertas yang sudah terpotong juga menjadi penghalang tanda potong
    (lay.cut || []).forEach(function (c) { rects.push({ l: c.x, t: c.y, r: c.x + c.w, b: c.y + c.h }); });
    var seen = {}, d = [];

    // garis mendatar (horiz) atau tegak di koordinat tetap `at`, dari `a` menuju `z`
    function add(horiz, at, a, z, own) {
      var dir = z > a ? 1 : -1, min = horiz ? B.x0 : B.y0, max = horiz ? B.x1 : B.y1;
      if (a < min || a > max) return;
      z = Math.max(min, Math.min(max, z));
      rects.forEach(function (R, i) {
        if (i === own) return;
        var lo = horiz ? R.t : R.l, hi = horiz ? R.b : R.r;
        if (at <= lo || at >= hi) return;
        var near = horiz ? (dir > 0 ? R.l : R.r) : (dir > 0 ? R.t : R.b);
        var far = horiz ? (dir > 0 ? R.r : R.l) : (dir > 0 ? R.b : R.t);
        var hit = dir > 0 ? (near < z && far > a) : (near > z && far < a);
        if (hit) z = dir > 0 ? Math.max(a, Math.min(z, near)) : Math.min(a, Math.max(z, near));
      });
      if (Math.abs(z - a) < minLen) return;
      var key = (horiz ? 'h' : 'v') + at.toFixed(2) + ':' + Math.min(a, z).toFixed(2) + ':' + Math.max(a, z).toFixed(2);
      if (seen[key]) return;
      seen[key] = true;
      d.push(horiz ? 'M' + a.toFixed(3) + ' ' + at.toFixed(3) + 'H' + z.toFixed(3) : 'M' + at.toFixed(3) + ' ' + a.toFixed(3) + 'V' + z.toFixed(3));
    }

    cells.forEach(function (c, i) {
      if (c.tooBig) return;
      var l = c.x + b, t = c.y + b, r = c.x + c.w - b, btm = c.y + c.h - b;
      [[l, t, -1, -1], [r, t, 1, -1], [l, btm, -1, 1], [r, btm, 1, 1]].forEach(function (k) {
        var x = k[0], y = k[1], sx = k[2], sy = k[3];
        add(true, y, x + sx * off, x + sx * (off + L), i);  // perpanjangan garis potong mendatar
        add(false, x, y + sy * off, y + sy * (off + L), i); // perpanjangan garis potong tegak
      });
    });
    if (!d.length) return '';
    return '<svg class="marks" viewBox="0 0 ' + P.w + ' ' + P.h + '" style="width:' + P.w + 'mm;height:' + P.h + 'mm">' +
      '<path d="' + d.join('') + '" stroke="#000" stroke-width="' + MARK_STROKE + '" fill="none"/></svg>';
  }

  // Penggaris 50 mm di margin bawah: ukur hasil cetak untuk memastikan printer mencetak skala 100%.
  var RULER_MM = 50;
  function rulerSvg(cells, L) {
    if (!settings.ruler) return '';
    var B = L.bounds, x0 = B.x0 + 3, y = B.y1 - 3.5;
    if (B.x1 - B.x0 < RULER_MM + 10) return '';
    // jangan menimpa foto: perlu ruang kosong ±7 mm di atas tepi bawah kertas
    var clash = cells.concat(L.cut || []).some(function (c) { return c.y + c.h > y - 4 && c.x < x0 + RULER_MM + 2; });
    if (clash) return '';
    var d = 'M' + x0 + ' ' + y + 'H' + (x0 + RULER_MM);
    for (var i = 0; i <= RULER_MM; i += 5) d += 'M' + (x0 + i) + ' ' + y + 'V' + (y - (i % 10 === 0 ? 2.5 : 1.5));
    return '<svg class="ruler" viewBox="0 0 ' + L.w + ' ' + L.h + '" style="width:' + L.w + 'mm;height:' + L.h + 'mm">' +
      '<path d="' + d + '" stroke="#000" stroke-width="0.15" fill="none"/>' +
      '<text x="' + (x0 + RULER_MM + 1.5) + '" y="' + (y + 0.6) + '" font-size="2.2" font-family="Arial" fill="#000">' + RULER_MM +
      ' mm — bila tidak tepat 50 mm, atur skala cetak 100%</text></svg>';
  }

  var renderTimer = null;
  function render() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(doRender, 60);
  }
  function doRender() {
    saveSettings();
    var P = paperDims();
    var L0 = pageLayout(0);
    $('page-style').textContent = '@page { size: ' + P.w + 'mm ' + P.h + 'mm; margin: 0; }' +
      (L0.small ? ' @page sisa { size: ' + L0.w + 'mm ' + L0.h + 'mm; margin: 0; }' : '');
    updateLeftoverUi();
    var active = items.filter(function (it) { return it.qty > 0; });
    if (!active.length) {
      $('pages').innerHTML = '<div class="empty" style="padding:60px">Tambahkan foto untuk mulai.</div>';
      $('summary').textContent = '';
      $('btn-print').disabled = true;
      return;
    }
    var pages = pack(buildPieces(active));
    lastPages = pages;
    var count = pages.reduce(function (s, p) { return s + p.length; }, 0);
    var bad = pages.some(function (p) { return p.some(function (c) { return c.tooBig; }); });
    var first = pages[0].L;
    $('summary').innerHTML = '<b>' + count + '</b> foto · <b>' + pages.length + '</b> lembar kertas ' + P.w + ' × ' + P.h + ' mm' +
      (first.leftover ? ' · lembar 1 = <b>' + (first.corner ? 'kertas terpotong sudut ' + round1(first.cut[0].w) + ' × ' + round1(first.cut[0].h) + ' mm'
        : 'sisa kertas ' + round1(first.R.w) + ' × ' + round1(first.R.h) + ' mm') + '</b> (' + pages[0].length + ' foto)' : '') +
      (settings.leftover && leftoverUnused ? ' · <span style="color:#c0392b">⚠ tidak ada foto yang muat di sisa kertas</span>' : '') +
      (bad ? ' · <span style="color:#c0392b">⚠ ada foto yang lebih besar dari kertas (bertanda merah)</span>' : '');
    var ox = num(settings.offX, 0), oy = num(settings.offY, 0);
    $('pages').innerHTML = pages.map(function (p, i) {
      var L = p.L;
      return '<div class="sheet' + (L.leftover ? ' is-leftover' : '') + '" style="width:' + L.w + 'mm;height:' + L.h + 'mm' + (L.small ? ';page:sisa' : '') + '">' +
        L.cut.map(function (c) {
          return '<div class="cutoff" style="left:' + c.x + 'mm;top:' + c.y + 'mm;width:' + c.w + 'mm;height:' + c.h + 'mm"><span>Bagian sudah terpotong</span></div>';
        }).join('') +
        '<div class="sheet-content" style="left:' + ox + 'mm;top:' + oy + 'mm;width:' + L.w + 'mm;height:' + L.h + 'mm">' +
          p.map(cellHtml).join('') +
          (settings.guideMode === 'crop' ? marksSvg(p, L) : '') +
          rulerSvg(p, L) +
          '<div class="region" style="left:' + L.bounds.x0 + 'mm;top:' + L.bounds.y0 + 'mm;width:' + (L.bounds.x1 - L.bounds.x0) + 'mm;height:' +
            (L.bounds.y1 - L.bounds.y0) + 'mm"></div>' +
        '</div>' +
        '<div class="sheet-no">Lembar ' + (i + 1) + '/' + pages.length + (L.leftover ? ' · sisa kertas' : '') + '</div></div>';
    }).join('');
    $('pages').style.zoom = settings.zoom;
    $('btn-print').disabled = false;
  }

  /* ------------------------- Kertas sisa & posisi cetak ------------------------- */

  var LAST_KEY = STORE_KEY + '.last'; // hanya koordinat area terpakai, tanpa foto
  var lastPages = null;
  function round1(n) { return Math.round(n * 10) / 10; }

  function updateLeftoverUi() {
    var vert = settings.leftSide === 'top' || settings.leftSide === 'bottom', corner = settings.leftShape === 'corner';
    $('lbl-left-size').textContent = (vert ? 'Tinggi' : 'Lebar') + ' sisa kertas (mm)';
    $('leftover-fields').hidden = !settings.leftover;
    Array.prototype.forEach.call(document.querySelectorAll('.left-side-only'), function (el) { el.hidden = corner; });
    Array.prototype.forEach.call(document.querySelectorAll('.left-corner-only'), function (el) { el.hidden = !corner; });
    $('left-flip-hint').textContent = settings.leftFlip
      ? 'Masukkan kertas dengan sisi yang biasanya di bawah masuk lebih dulu (diputar 180°). Pratinjau menampilkan kertas sesuai arah masuk printer.'
      : '';
    $('leftover-feed-hint').innerHTML = corner
      ? 'Kertas tetap dimasukkan sebagai kertas utuh ukuran ' + round1(paperDims().w) + ' × ' + round1(paperDims().h) +
        ' mm. Bila tepi depan kertas tinggal sebagian (potongan di tepi yang masuk lebih dulu), centang <b>kertas dimasukkan terbalik</b> agar sisi yang utuh masuk lebih dulu dan tidak macet.'
      : settings.leftFeed === 'small'
      ? 'Masukkan potongan sisa langsung ke printer dan pilih ukuran kertas <b>kustom ' + round1(pageLayout(0).w) + ' × ' + round1(pageLayout(0).h) +
        ' mm</b> di dialog cetak. Lembar berikutnya (bila ada) memakai kertas utuh. Tidak semua printer bisa menarik kertas kecil.'
      : 'Letakkan potongan sisa <b>tepat di posisi asalnya</b> di atas selembar kertas utuh (rapatkan ke tepi asli kertas), rekatkan sedikit selotip di bagian belakang, lalu masukkan ke printer seperti biasa.';
  }

  // Simpan area yang terpakai pada lembar terakhir yang dicetak (koordinat kertas utuh, mm).
  function rememberLastPrint() {
    if (!lastPages || !lastPages.length) return;
    var p = lastPages[lastPages.length - 1], L = p.L;
    if (!p.length) return;
    var ext = settings.guideMode === 'crop' ? Math.max(num(settings.bleed, 0), 2) + Math.max(1, num(settings.markLen, 5)) : 0;
    var dx = (L.small ? L.R.x : 0) + num(settings.offX, 0), dy = (L.small ? L.R.y : 0) + num(settings.offY, 0);
    var P = paperDims(), b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    p.forEach(function (c) {
      b.minX = Math.min(b.minX, c.x - ext + dx); b.minY = Math.min(b.minY, c.y - ext + dy);
      b.maxX = Math.max(b.maxX, c.x + c.w + ext + dx); b.maxY = Math.max(b.maxY, c.y + c.h + ext + dy);
    });
    var rec = { at: new Date().toISOString(), pw: P.w, ph: P.h,
      minX: Math.max(0, b.minX), minY: Math.max(0, b.minY), maxX: Math.min(P.w, b.maxX), maxY: Math.min(P.h, b.maxY) };
    try { localStorage.setItem(LAST_KEY, JSON.stringify(rec)); } catch (e) { /* abaikan */ }
    showLastInfo();
  }

  function readLast() {
    try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch (e) { return null; }
  }

  function showLastInfo() {
    var r = readLast();
    $('btn-from-last').disabled = !r;
    $('last-print-info').textContent = r
      ? 'Cetakan terakhir (' + new Date(r.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) + ', kertas ' +
        round1(r.pw) + ' × ' + round1(r.ph) + ' mm): area terpakai ' + round1(r.minX) + '–' + round1(r.maxX) + ' mm dari kiri, ' +
        round1(r.minY) + '–' + round1(r.maxY) + ' mm dari atas.'
      : 'Belum ada catatan cetakan sebelumnya di browser ini.';
  }

  // Perkirakan sisa kertas terbesar dari cetakan terakhir (dipotong lurus di luar area terpakai).
  function fillFromLast() {
    var r = readLast(), P = paperDims(), kerf = 1;
    if (!r) return;
    if (Math.abs(r.pw - P.w) > 1 || Math.abs(r.ph - P.h) > 1) {
      if (!confirm('Cetakan terakhir memakai kertas ' + round1(r.pw) + ' × ' + round1(r.ph) + ' mm, berbeda dengan kertas sekarang. Tetap pakai?')) return;
    }
    var opts = [
      { side: 'bottom', size: P.h - r.maxY - kerf, area: P.w * (P.h - r.maxY) },
      { side: 'top', size: r.minY - kerf, area: P.w * r.minY },
      { side: 'right', size: P.w - r.maxX - kerf, area: P.h * (P.w - r.maxX) },
      { side: 'left', size: r.minX - kerf, area: P.h * r.minX }
    ];
    // potong sudut: area terpakai berada di salah satu sudut → hanya sudut itu yang dibuang (sisa bentuk L)
    var near = function (v) { return v < 15; };
    var cornerOpt = null;
    var uw = { l: r.maxX + kerf, r: P.w - r.minX + kerf }, uh = { t: r.maxY + kerf, b: P.h - r.minY + kerf };
    if (near(r.minX) && near(r.minY)) cornerOpt = { pos: 'tl', w: uw.l, h: uh.t };
    else if (near(P.w - r.maxX) && near(r.minY)) cornerOpt = { pos: 'tr', w: uw.r, h: uh.t };
    else if (near(r.minX) && near(P.h - r.maxY)) cornerOpt = { pos: 'bl', w: uw.l, h: uh.b };
    else if (near(P.w - r.maxX) && near(P.h - r.maxY)) cornerOpt = { pos: 'br', w: uw.r, h: uh.b };
    if (cornerOpt && (P.w - cornerOpt.w < 30 || P.h - cornerOpt.h < 30)) cornerOpt = null; // sisa samping terlalu sempit → potong lurus
    if (cornerOpt) {
      cornerOpt.w = Math.min(P.w, Math.ceil(cornerOpt.w * 2) / 2);
      cornerOpt.h = Math.min(P.h, Math.ceil(cornerOpt.h * 2) / 2);
      opts.push({ corner: cornerOpt, size: Math.min(P.w - cornerOpt.w, P.h - cornerOpt.h), area: P.w * P.h - cornerOpt.w * cornerOpt.h });
    }
    opts.sort(function (a, b) { return b.area - a.area; });
    var best = opts[0];
    if (!best.corner && best.size < 10) { alert('Sisa kertas dari cetakan terakhir terlalu kecil (' + round1(Math.max(0, best.size)) + ' mm).'); return; }
    settings.leftover = true;
    if (best.corner) {
      settings.leftShape = 'corner';
      settings.cornerPos = best.corner.pos; settings.cornerW = best.corner.w; settings.cornerH = best.corner.h;
    } else {
      settings.leftShape = 'side';
      settings.leftSide = best.side;
      settings.leftSize = Math.floor(best.size * 2) / 2;
    }
    syncLeftoverInputs();
    render();
  }

  function syncLeftoverInputs() {
    $('chk-leftover').checked = !!settings.leftover;
    $('sel-left-side').value = settings.leftSide;
    $('inp-left-size').value = settings.leftSize;
    $('inp-cut-safe').value = settings.cutSafe;
    $('sel-left-feed').value = settings.leftFeed;
    $('sel-left-shape').value = settings.leftShape;
    $('sel-corner-pos').value = settings.cornerPos;
    $('inp-corner-w').value = settings.cornerW;
    $('inp-corner-h').value = settings.cornerH;
    $('chk-left-flip').checked = !!settings.leftFlip;
    $('inp-offx').value = settings.offX;
    $('inp-offy').value = settings.offY;
  }

  function initLeftover() {
    syncLeftoverInputs();
    showLastInfo();
    $('chk-leftover').addEventListener('change', function () { settings.leftover = this.checked; render(); });
    $('sel-left-side').addEventListener('change', function () { settings.leftSide = this.value; render(); });
    $('sel-left-shape').addEventListener('change', function () { settings.leftShape = this.value; render(); });
    $('sel-corner-pos').addEventListener('change', function () { settings.cornerPos = this.value; render(); });
    $('inp-corner-w').addEventListener('input', function () { settings.cornerW = Math.max(1, num(this.value, settings.cornerW)); render(); });
    $('inp-corner-h').addEventListener('input', function () { settings.cornerH = Math.max(1, num(this.value, settings.cornerH)); render(); });
    $('chk-left-flip').addEventListener('change', function () { settings.leftFlip = this.checked; render(); });
    $('inp-left-size').addEventListener('input', function () { settings.leftSize = Math.max(5, num(this.value, settings.leftSize)); render(); });
    $('inp-cut-safe').addEventListener('input', function () { settings.cutSafe = Math.max(0, num(this.value, 0)); render(); });
    $('sel-left-feed').addEventListener('change', function () { settings.leftFeed = this.value; render(); });
    $('inp-offx').addEventListener('input', function () { settings.offX = num(this.value, 0); render(); });
    $('inp-offy').addEventListener('input', function () { settings.offY = num(this.value, 0); render(); });
    $('btn-from-last').addEventListener('click', fillFromLast);
    // Cetak uji: hanya garis batas kertas sisa & tanda potong, tanpa foto — untuk mengecek posisi di kertas biasa.
    $('btn-test-print').addEventListener('click', function () {
      clearTimeout(renderTimer);
      doRender();
      document.body.classList.add('test-print');
      window.print();
      setTimeout(function () { document.body.classList.remove('test-print'); }, 500);
    });
  }

  /* ------------------------- Privasi: hapus semua foto dari memori ------------------------- */

  // Foto hanya ada sebagai blob di memori browser; fungsi ini melepas semuanya.
  function clearAll() {
    var urls = {};
    items.forEach(function (it) { [it.orig, it.bgUrl, it.src].forEach(function (u) { if (u) urls[u] = true; }); });
    Object.keys(urls).forEach(function (u) { URL.revokeObjectURL(u); });
    items = [];
    cropItem = null;
    if ($('dlg-crop').open) $('dlg-crop').close();
    if (window.FotoBG) window.FotoBG.reset();
    $('pages').innerHTML = '';
    renderItems();
    render();
  }

  $('btn-clear-all').addEventListener('click', function () {
    if (confirm('Hapus semua foto dari halaman ini?\nFoto tidak tersimpan di mana pun, jadi tidak bisa dikembalikan.')) clearAll();
  });
  window.addEventListener('pagehide', clearAll);

  /* ------------------------- Ganti background ------------------------- */

  // Hasil berlaku untuk semua item dari foto yang sama (mis. hasil "+ Ukuran").
  function openBackground(it) {
    if (!window.FotoBG) { alert('Modul ganti background (assets/foto-bg.js) tidak ditemukan.'); return; }
    window.FotoBG.open({ name: it.name, src: it.orig, state: it.bgState }, function (res) {
      var oldUrl = it.bgUrl;
      var same = items.filter(function (x) { return x.orig === it.orig; });
      Promise.all(same.map(function (x) {
        x.bgUrl = res.url;
        x.bgState = res.state;
        return rebuildSrc(x);
      })).then(function () {
        if (oldUrl && oldUrl !== res.url) URL.revokeObjectURL(oldUrl);
        renderItems();
        render();
        if ($('dlg-crop').open) drawCrop();
      });
    });
  }

  /* ------------------------- Atur potongan (crop) ------------------------- */

  var cropItem = null, drag = null;

  function openCrop(it) {
    cropItem = it;
    $('crop-zoom').value = it.zoom;
    drawCrop();
    $('dlg-crop').showModal();
  }

  function drawCrop() {
    var it = cropItem, d = photoSize(it), bw = borderOf(it);
    var maxW = Math.min(460, window.innerWidth - 80), maxH = Math.min(380, window.innerHeight - 320);
    var s = Math.min(maxW / d.w, maxH / d.h);
    var stage = $('crop-stage'), f = framedPx(it, s, 'crop-photo');
    stage.style.width = f.w + 'px';
    stage.style.height = f.h + 'px';
    stage.innerHTML = f.html;
    $('crop-info').textContent = it.name + ' — ' + sizeLabel(it) + ' — ±' + dpi(it) + ' dpi';
    $('crop-border').value = it.borderW || 0;
    $('crop-border-val').textContent = (it.borderW || 0) + ' mm';
    $('crop-border-color').value = it.borderColor || '#ffffff';
    var sw = $('border-swatches').querySelectorAll('[data-color]');
    for (var i = 0; i < sw.length; i++) sw[i].classList.toggle('on', sw[i].getAttribute('data-color') === (it.borderColor || '').toLowerCase());
    $('crop-flip').textContent = it.landscape ? 'Jadikan tegak' : 'Jadikan mendatar';
  }

  $('crop-stage').addEventListener('pointerdown', function (e) {
    drag = { x: e.clientX, y: e.clientY, px: cropItem.px, py: cropItem.py };
    this.setPointerCapture(e.pointerId);
  });
  $('crop-stage').addEventListener('pointermove', function (e) {
    if (!drag) return;
    var it = cropItem, a = imageArea(it), b = imgBox(it, a.w, a.h), area = this.querySelector('.crop-photo');
    var st = area.getBoundingClientRect();
    var dxPct = (e.clientX - drag.x) / st.width * 100, dyPct = (e.clientY - drag.y) / st.height * 100;
    if (b.w > 100.001) it.px = Math.min(1, Math.max(0, drag.px + dxPct / (100 - b.w)));
    if (b.h > 100.001) it.py = Math.min(1, Math.max(0, drag.py + dyPct / (100 - b.h)));
    area.querySelector('img').setAttribute('style', imgStyle(imgBox(it, a.w, a.h)));
  });
  $('crop-stage').addEventListener('pointerup', function () { drag = null; });
  $('crop-stage').addEventListener('wheel', function (e) {
    e.preventDefault();
    cropItem.zoom = Math.min(4, Math.max(1, cropItem.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
    $('crop-zoom').value = cropItem.zoom;
    drawCrop();
  }, { passive: false });
  $('crop-zoom').addEventListener('input', function () { cropItem.zoom = num(this.value, 1); drawCrop(); });
  $('crop-rotate').addEventListener('click', function () {
    rotateItem(cropItem).then(function () { cropItem.px = cropItem.py = 0.5; drawCrop(); });
  });
  $('crop-flip').addEventListener('click', function () {
    cropItem.landscape = !cropItem.landscape;
    cropItem.px = cropItem.py = 0.5;
    drawCrop();
  });
  $('crop-reset').addEventListener('click', function () {
    cropItem.zoom = 1; cropItem.px = cropItem.py = 0.5;
    $('crop-zoom').value = 1;
    drawCrop();
  });
  // Perbarui daftar & lembar langsung (event 'close' tetap dipakai untuk penutupan lewat tombol Esc).
  $('crop-done').addEventListener('click', function () { $('dlg-crop').close(); renderItems(); render(); });
  $('crop-bg').addEventListener('click', function () { openBackground(cropItem); });

  $('border-swatches').innerHTML = BORDER_COLORS.map(function (c) {
    return '<button type="button" class="swatch sm" title="' + c.name + '" data-color="' + c.v + '" style="background:' + c.v + '"></button>';
  }).join('') + '<label class="swatch sm picker" title="Warna lain"><input type="color" id="crop-border-color" value="#ffffff"></label>';
  function setBorder(w, color) {
    if (w != null) cropItem.borderW = Math.max(0, Math.min(20, num(w, 0)));
    if (color) {
      cropItem.borderColor = color.toLowerCase();
      if (!cropItem.borderW) cropItem.borderW = 2; // pilih warna = langsung tampil
    }
    drawCrop();
  }
  $('crop-border').addEventListener('input', function () { setBorder(this.value); });
  $('crop-border-color').addEventListener('input', function () { setBorder(null, this.value); });
  $('border-swatches').addEventListener('click', function (e) {
    var c = e.target.getAttribute('data-color');
    if (c) setBorder(null, c);
  });
  $('crop-border-all').addEventListener('click', function () {
    items.forEach(function (x) { x.borderW = cropItem.borderW; x.borderColor = cropItem.borderColor; });
    $('crop-border-all').textContent = 'Diterapkan ke ' + items.length + ' foto ✓';
    setTimeout(function () { $('crop-border-all').textContent = 'Terapkan ke semua foto'; }, 1800);
  });
  $('dlg-crop').addEventListener('close', function () { renderItems(); render(); });

  /* ------------------------- Pengaturan ------------------------- */

  function showGuideFields() {
    var els = document.querySelectorAll('.guide-crop, .guide-box');
    for (var i = 0; i < els.length; i++) els[i].hidden = !els[i].classList.contains('guide-' + settings.guideMode);
  }

  function initSettings() {
    $('sel-default-size').innerHTML = sizeOptions(settings.defSize).replace(/<option value="custom".*$/, '');
    $('sel-paper').innerHTML = PAPERS.map(function (p) { return '<option value="' + p.key + '">' + p.name + '</option>'; }).join('');
    $('size-table').innerHTML = '<thead><tr><th>Jenis</th><th>Inch</th><th>cm</th></tr></thead><tbody>' + SIZES.map(function (s) {
      return '<tr><td>' + s.key + '</td><td>' + s.inch + '</td><td>' + s.w.toFixed(2) + ' × ' + s.h.toFixed(2) + '</td></tr>';
    }).join('') + '</tbody>';

    $('sel-paper').value = settings.paper;
    $('sel-orient').value = settings.orient;
    $('inp-pw').value = settings.pw; $('inp-ph').value = settings.ph;
    $('inp-margin').value = settings.margin; $('inp-gap').value = settings.gap;
    $('chk-rotate').checked = settings.rotate;
    $('chk-ruler').checked = settings.ruler;
    $('sel-guide-mode').value = settings.guideMode;
    $('inp-bleed').value = settings.bleed;
    $('inp-mark-len').value = settings.markLen;
    $('inp-guide-offset').value = settings.guideOffset;
    showGuideFields();
    $('inp-default-qty').value = settings.defQty;
    $('inp-zoom').value = settings.zoom;

    $('sel-default-size').addEventListener('change', function () { settings.defSize = this.value; saveSettings(); });
    $('inp-default-qty').addEventListener('input', function () { settings.defQty = Math.max(1, Math.round(num(this.value, 1))); saveSettings(); });
    $('sel-paper').addEventListener('change', function () {
      settings.paper = this.value;
      if (this.value !== 'custom') {
        var p = paperByKey(this.value);
        settings.pw = p.w; settings.ph = p.h;
        $('inp-pw').value = p.w; $('inp-ph').value = p.h;
      }
      render();
    });
    $('sel-orient').addEventListener('change', function () { settings.orient = this.value; render(); });
    ['inp-pw', 'inp-ph'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        settings.paper = 'custom'; $('sel-paper').value = 'custom';
        settings.pw = Math.max(20, num($('inp-pw').value, settings.pw));
        settings.ph = Math.max(20, num($('inp-ph').value, settings.ph));
        render();
      });
    });
    $('inp-margin').addEventListener('input', function () { settings.margin = Math.max(0, num(this.value, 0)); render(); });
    $('inp-gap').addEventListener('input', function () { settings.gap = Math.max(0, num(this.value, 0)); render(); });
    $('sel-guide-mode').addEventListener('change', function () { settings.guideMode = this.value; showGuideFields(); render(); });
    $('inp-bleed').addEventListener('input', function () { settings.bleed = Math.max(0, num(this.value, 0)); render(); });
    $('inp-mark-len').addEventListener('input', function () { settings.markLen = Math.max(1, num(this.value, 5)); render(); });
    $('inp-guide-offset').addEventListener('input', function () { settings.guideOffset = Math.max(0, num(this.value, 0)); render(); });
    $('chk-rotate').addEventListener('change', function () { settings.rotate = this.checked; render(); });
    $('chk-ruler').addEventListener('change', function () { settings.ruler = this.checked; render(); });
    $('inp-zoom').addEventListener('input', function () { settings.zoom = num(this.value, 0.7); $('pages').style.zoom = settings.zoom; saveSettings(); });

    $('file-photo').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); });
    });
    drop.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });

    $('btn-print').addEventListener('click', function () {
      clearTimeout(renderTimer);
      doRender();
      var imgs = $('pages').querySelectorAll('img');
      Promise.all(Array.prototype.map.call(imgs, function (img) {
        return img.complete ? null : new Promise(function (r) { img.onload = img.onerror = r; });
      })).then(function () { window.print(); rememberLastPrint(); });
    });
    initLeftover();
  }

  initSettings();
  render();
})();
