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
    var def = { paper: 'a4', orient: 'portrait', pw: 210, ph: 297, margin: 10, gap: 2, guideMode: 'crop', bleed: 2, markLen: 5,
      guideOffset: 2, rotate: true, defSize: '3x4', defQty: 4, zoom: 0.7 };
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      for (var k in def) if (s[k] !== undefined) def[k] = s[k];
      if (s.guideMode === undefined && s.guides === false) def.guideMode = 'none'; // pengaturan versi lama
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
    var d = photoSize(it), b = borderOf(it);
    return (it.size === 'custom' ? 'Kustom' : it.size) + ' · ' + (d.w / 10).toFixed(2) + ' × ' + (d.h / 10).toFixed(2) + ' cm' +
      (b ? ' (dengan border ' + ((d.w + 2 * b) / 10).toFixed(2) + ' × ' + ((d.h + 2 * b) / 10).toFixed(2) + ' cm)' : '');
  }

  // Tebal border (mm). Border berada di luar foto, jadi menambah ukuran cetak sebesar 2 × tebal.
  function borderOf(it) { return Math.max(0, num(it.borderW, 0)); }

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
    var d = photoSize(it), b = imgBox(it, d.w, d.h);
    return Math.round(it.iw * (100 / b.w) / (d.w / 25.4));
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

  // Foto (ukuran asli) dengan border di luarnya, digambar dalam piksel dengan skala k px/mm.
  function framedPx(it, k, cls) {
    var d = photoSize(it), bw = borderOf(it), W = d.w + 2 * bw, H = d.h + 2 * bw;
    return { w: W * k, h: H * k, html:
      '<div class="photo ' + (cls || '') + '" style="left:' + (bw * k) + 'px;top:' + (bw * k) + 'px;width:' + (d.w * k) + 'px;height:' + (d.h * k) + 'px">' +
      '<img src="' + it.src + '" style="' + imgStyle(imgBox(it, d.w, d.h)) + '"></div>' + borderHtml(it, 0, W, H) };
  }

  function thumbHtml(it) {
    var d = photoSize(it), bw = borderOf(it), W = d.w + 2 * bw, H = d.h + 2 * bw;
    var k = Math.min(56 / W, 70 / H), f = framedPx(it, k);
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
            (it.borderW > 0 ? '<span class="badge-bg" style="background:#eef0f3;color:#333"><i class="dot" style="background:' + esc(it.borderColor) + '"></i>Border ' + it.borderW + ' mm di luar</span>' : '') + '</div>' +
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
  function pack(pieces, firstPageOnly) {
    var P = paperDims(), m = Math.max(0, settings.margin), g = Math.max(0, settings.gap);
    var aw = P.w - 2 * m, ah = P.h - 2 * m, eps = 0.01;
    // tiap halaman menyimpan daftar ruang kosongnya sendiri, jadi halaman sebelumnya tetap bisa diisi
    var pages = [];
    function newPage() { var pg = { cells: [], free: [{ x: 0, y: 0, w: aw + g, h: ah + g }] }; pages.push(pg); return pg; }

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
      }
      if (!spot) {
        // lebih besar dari kertas: taruh sendiri di satu lembar (ditandai merah)
        pg.cells.push({ item: p.item, x: m, y: m, w: p.w, h: p.h, rot: false, tooBig: true });
        pg.free = [];
        return !firstPageOnly;
      }
      pg.cells.push({ item: p.item, x: m + spot.x, y: m + spot.y, w: spot.o.w, h: spot.o.h, rot: spot.o.rot, tooBig: false });
      place(pg, { x: spot.x, y: spot.y, w: spot.o.w + g, h: spot.o.h + g });
      return true;
    });
    return pages.length ? pages.map(function (pg) { return pg.cells; }) : [[]];
  }

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
      var bw = borderOf(it);
      for (var k = 0; k < it.qty; k++) pieces.push({ item: it, w: d.w + 2 * (pad + bw), h: d.h + 2 * (pad + bw), order: order });
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
  //  - border (bila ada) berada di luar foto: foto tetap ukuran standar, border mengelilinginya;
  //    pada mode crop, bleed ikut berwarna border.
  function cellHtml(c) {
    var it = c.item, d = photoSize(it), pad = guidePad(), bleed = settings.guideMode === 'crop', bw = borderOf(it);
    var inset = bleed ? 0 : pad;                       // tepi bingkai (area berwarna) di dalam slot
    var fw = c.w - 2 * inset, fh = c.h - 2 * inset;    // ukuran bingkai
    var px, py, pw, ph, iw, ih;                        // posisi & ukuran area gambar (orientasi lembar), ukuran gambar (orientasi foto)
    if (bw > 0) {
      px = py = pad + bw;
      pw = c.rot ? d.h : d.w; ph = c.rot ? d.w : d.h;
      iw = d.w; ih = d.h;
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
  function marksSvg(cells, P) {
    var b = Math.max(0, num(settings.bleed, 0)), L = Math.max(1, num(settings.markLen, 5));
    var off = Math.max(b, 2), eps = 0.3, minLen = 1;
    var rects = cells.map(function (c) { return { l: c.x - eps, t: c.y - eps, r: c.x + c.w + eps, b: c.y + c.h + eps }; });
    var seen = {}, d = [];

    // garis mendatar (horiz) atau tegak di koordinat tetap `at`, dari `a` menuju `z`
    function add(horiz, at, a, z, own) {
      var dir = z > a ? 1 : -1, max = horiz ? P.w : P.h;
      if (a < 0 || a > max) return;
      z = Math.max(0, Math.min(max, z));
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

  var renderTimer = null;
  function render() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(doRender, 60);
  }
  function doRender() {
    saveSettings();
    var P = paperDims();
    $('page-style').textContent = '@page { size: ' + P.w + 'mm ' + P.h + 'mm; margin: 0; }';
    var active = items.filter(function (it) { return it.qty > 0; });
    if (!active.length) {
      $('pages').innerHTML = '<div class="empty" style="padding:60px">Tambahkan foto untuk mulai.</div>';
      $('summary').textContent = '';
      $('btn-print').disabled = true;
      return;
    }
    var pages = pack(buildPieces(active));
    var count = pages.reduce(function (s, p) { return s + p.length; }, 0);
    var bad = pages.some(function (p) { return p.some(function (c) { return c.tooBig; }); });
    $('summary').innerHTML = '<b>' + count + '</b> foto · <b>' + pages.length + '</b> lembar kertas ' +
      P.w + ' × ' + P.h + ' mm' + (bad ? ' · <span style="color:#c0392b">⚠ ada foto yang lebih besar dari kertas (bertanda merah)</span>' : '');
    $('pages').innerHTML = pages.map(function (p, i) {
      return '<div class="sheet" style="width:' + P.w + 'mm;height:' + P.h + 'mm">' + p.map(cellHtml).join('') +
        (settings.guideMode === 'crop' ? marksSvg(p, P) : '') +
        '<div class="sheet-no">Lembar ' + (i + 1) + '/' + pages.length + '</div></div>';
    }).join('');
    $('pages').style.zoom = settings.zoom;
    $('btn-print').disabled = false;
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
    var s = Math.min(maxW / (d.w + 2 * bw), maxH / (d.h + 2 * bw));
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
    var it = cropItem, d = photoSize(it), b = imgBox(it, d.w, d.h), area = this.querySelector('.crop-photo');
    var st = area.getBoundingClientRect();
    var dxPct = (e.clientX - drag.x) / st.width * 100, dyPct = (e.clientY - drag.y) / st.height * 100;
    if (b.w > 100.001) it.px = Math.min(1, Math.max(0, drag.px + dxPct / (100 - b.w)));
    if (b.h > 100.001) it.py = Math.min(1, Math.max(0, drag.py + dyPct / (100 - b.h)));
    area.querySelector('img').setAttribute('style', imgStyle(imgBox(it, d.w, d.h)));
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
      })).then(function () { window.print(); });
    });
  }

  initSettings();
  render();
})();
