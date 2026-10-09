/* Crop massal: baca foto dari folder/subfolder, deteksi wajah (MediaPipe Face Detector di browser),
 * crop otomatis menjadi pas foto / ukuran pilihan (mm atau piksel), lalu unduh sebagai ZIP.
 * Foto tidak pernah dikirim ke server; semuanya ada di memori browser. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = 'cropMassal.v1';
  var BUNDLE_URL = '../vendor/mediapipe/vision_bundle.mjs'; // relatif terhadap file ini
  var WASM_URL = 'vendor/mediapipe/wasm';
  var FACE_MODEL = 'vendor/mediapipe/blaze_face_short_range.tflite';
  var DETECT_MAX = 1280;           // sisi terpanjang gambar saat deteksi
  var IMG_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;

  // Ukuran standar (lebar × tinggi, cm) — sama dengan tabel di halaman Cetak Foto.
  var SIZES = [
    { key: '2x3', w: 2.16, h: 2.79 }, { key: '3x4', w: 2.79, h: 3.81 }, { key: '4x6', w: 3.81, h: 5.59 },
    { key: '2R', w: 5.59, h: 8.89 }, { key: '3R', w: 8.89, h: 12.70 }, { key: '4R', w: 10.16, h: 15.24 },
    { key: '5R', w: 12.70, h: 17.78 }, { key: '6R', w: 15.24, h: 20.32 }, { key: '8R', w: 20.32, h: 25.40 },
    { key: '8RS', w: 20.32, h: 30.48 }
  ];
  var BG_COLORS = [
    { name: 'Asli (tidak diganti)', v: '' }, { name: 'Merah', v: '#d71920' }, { name: 'Biru', v: '#1e5bb8' },
    { name: 'Biru muda', v: '#4a9be0' }, { name: 'Putih', v: '#ffffff' }, { name: 'Abu-abu', v: '#cfd3d8' }
  ];
  // Perbandingan anatomi untuk memperkirakan tinggi kepala (dagu–ubun-ubun) dari titik wajah.
  // Dikalibrasi pada foto potret: tinggi kepala ≈ 1,37 × kotak wajah ≈ 3,3 × jarak mata ≈ 3,15 × jarak mata–mulut.
  var HEAD_PER_BOX = 1.37, HEAD_PER_EYEMOUTH = 3.15, HEAD_PER_IPD = 3.3;
  var EYE_IN_HEAD = 0.49; // posisi garis mata dari ubun-ubun, terhadap tinggi kepala

  var settings = loadSettings();
  var items = [], nextId = 1, filter = 'all';

  function loadSettings() {
    var def = { sizes: ['3x4'], custom: false, cw: 35, ch: 45, unit: 'mm', dpi: 300, format: 'jpg',
      head: 62, eye: 42, straighten: true, noface: 'center', bg: '' };
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      for (var k in def) if (s[k] !== undefined) def[k] = s[k];
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
  function mmToPx(mm) { return Math.max(1, Math.round(mm / 25.4 * settings.dpi)); }

  /* ------------------------- Ukuran hasil ------------------------- */

  function targets() {
    var list = [];
    SIZES.forEach(function (s) {
      if (settings.sizes.indexOf(s.key) < 0) return;
      list.push({ key: s.key, folder: s.key, sizeKey: s.key, wMm: s.w * 10, hMm: s.h * 10, w: mmToPx(s.w * 10), h: mmToPx(s.h * 10) });
    });
    if (settings.custom) {
      var cw = Math.max(1, num(settings.cw, 35)), ch = Math.max(1, num(settings.ch, 45));
      if (settings.unit === 'px') {
        list.push({ key: 'custom', folder: 'kustom_' + Math.round(cw) + 'x' + Math.round(ch) + 'px', sizeKey: 'custom',
          w: Math.round(cw), h: Math.round(ch), wMm: cw / settings.dpi * 25.4, hMm: ch / settings.dpi * 25.4 });
      } else {
        list.push({ key: 'custom', folder: 'kustom_' + cw + 'x' + ch + 'mm', sizeKey: 'custom', wMm: cw, hMm: ch, w: mmToPx(cw), h: mmToPx(ch) });
      }
    }
    return list;
  }

  /* ------------------------- Membaca folder & file ------------------------- */

  function addEntries(list) {
    var added = 0;
    list.forEach(function (e) {
      if (!e.file || !(/^image\//.test(e.file.type) || IMG_EXT.test(e.file.name))) return;
      items.push({ id: nextId++, file: e.file, path: e.path.replace(/^\/+/, ''), name: e.file.name,
        face: null, faces: 0, crop: null, warn: [], status: 'pending', outs: {}, thumb: null, dirty: true, needDetect: true });
      added++;
    });
    $('pick-info').textContent = items.length + ' foto dimuat' + (added < list.length ? ' (' + (list.length - added) + ' file bukan gambar dilewati)' : '') + '.';
    renderGrid();
    items.forEach(function (it) { if (it.dirty) queue.push(it.id); });
    run();
  }

  function fromInput(files) {
    addEntries(Array.prototype.map.call(files, function (f) { return { file: f, path: f.webkitRelativePath || f.name }; }));
  }

  // Seret-lepas folder: telusuri subfolder lewat FileSystemEntry.
  function walkEntry(entry, out) {
    return new Promise(function (res) {
      if (entry.isFile) {
        entry.file(function (f) { out.push({ file: f, path: entry.fullPath }); res(); }, function () { res(); });
      } else if (entry.isDirectory) {
        var reader = entry.createReader(), all = [];
        (function readBatch() {
          reader.readEntries(function (batch) {
            if (!batch.length) {
              Promise.all(all.map(function (en) { return walkEntry(en, out); })).then(res);
              return;
            }
            all = all.concat(Array.prototype.slice.call(batch));
            readBatch();
          }, function () { res(); });
        })();
      } else res();
    });
  }

  // Muat foto sebagai <img> (orientasi EXIF ikut diterapkan). close() melepas memori.
  function loadPhoto(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        img.width = img.naturalWidth;
        img.height = img.naturalHeight;
        img.close = function () { URL.revokeObjectURL(url); img.removeAttribute('src'); };
        res(img);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('bukan gambar yang valid')); };
      img.src = url;
    });
  }

  /* ------------------------- Deteksi wajah ------------------------- */

  var detectorPromise = null;
  function getDetector() {
    if (!detectorPromise) {
      detectorPromise = import(BUNDLE_URL).then(function (mp) {
        return mp.FilesetResolver.forVisionTasks(WASM_URL).then(function (fileset) {
          var opts = function (delegate) {
            return { baseOptions: { modelAssetPath: FACE_MODEL, delegate: delegate }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 };
          };
          return mp.FaceDetector.createFromOptions(fileset, opts('GPU')).catch(function () {
            return mp.FaceDetector.createFromOptions(fileset, opts('CPU'));
          });
        });
      });
      detectorPromise.catch(function () { detectorPromise = null; });
    }
    return detectorPromise;
  }

  // Jalankan detektor pada potongan (sx, sy, sw, sh) gambar; hasil dalam koordinat gambar asli.
  function detectRegion(det, bmp, sx, sy, sw, sh) {
    var s = Math.min(1, DETECT_MAX / Math.max(sw, sh));
    var w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    var res = det.detect(c);
    return (res.detections || []).map(function (d) {
      var b = d.boundingBox, kp = d.keypoints || [];
      return {
        score: d.categories && d.categories[0] ? d.categories[0].score : 0,
        x: sx + b.originX / s, y: sy + b.originY / s, w: b.width / s, h: b.height / s,
        kp: kp.map(function (p) { return { x: sx + p.x * w / s, y: sy + p.y * h / s }; })
      };
    });
  }

  // Model "short range" peka untuk wajah yang cukup besar di gambar. Bila tidak ketemu (mis. foto seluruh badan
  // atau wajah kecil di foto besar), gambar dipindai per kotak yang makin kecil (tumpang-tindih 50%).
  var TILE_MIN_SCORE = 0.7; // lebih ketat agar pola acak tidak dikira wajah
  function detectFaces(det, bmp) {
    var W = bmp.width, H = bmp.height, L = Math.max(W, H);
    var found = detectRegion(det, bmp, 0, 0, W, H);
    [0.5, 0.33, 0.22].forEach(function (frac) {
      if (found.length) return;
      var T = Math.min(Math.min(W, H), frac * L), step = T / 2;
      for (var y = 0; y < H - step / 2; y += step) {
        for (var x = 0; x < W - step / 2; x += step) {
          var sx = Math.min(x, W - T), sy = Math.min(y, H - T);
          found = found.concat(detectRegion(det, bmp, sx, sy, T, T).filter(function (f) { return f.score >= TILE_MIN_SCORE; }));
        }
      }
      found = dedupe(found);
    });
    return found;
  }

  function dedupe(list) {
    list.sort(function (a, b) { return b.score - a.score; });
    var out = [];
    list.forEach(function (f) {
      var dup = out.some(function (g) {
        var ix = Math.max(0, Math.min(f.x + f.w, g.x + g.w) - Math.max(f.x, g.x));
        var iy = Math.max(0, Math.min(f.y + f.h, g.y + g.h) - Math.max(f.y, g.y));
        return ix * iy > 0.3 * Math.min(f.w * f.h, g.w * g.h);
      });
      if (!dup) out.push(f);
    });
    return out;
  }

  // Ubah deteksi wajah menjadi parameter crop: titik tengah mata, tinggi kepala, kemiringan.
  function faceParams(f) {
    var kp = f.kp;
    var a = kp[0], b = kp[1];
    if (!a || !b) {
      return { ex: f.x + f.w / 2, ey: f.y + f.h * 0.4, head: f.h * HEAD_PER_BOX, theta: 0 };
    }
    if (a.x > b.x) { var t = a; a = b; b = t; }
    var ex = (a.x + b.x) / 2, ey = (a.y + b.y) / 2;
    var ipd = Math.hypot(b.x - a.x, b.y - a.y);
    var est = [f.h * HEAD_PER_BOX, ipd * HEAD_PER_IPD];
    if (kp[3]) est.push(Math.hypot(kp[3].x - ex, kp[3].y - ey) * HEAD_PER_EYEMOUTH);
    est.sort(function (x, y) { return x - y; });
    var head = est.length === 3 ? est[1] : (est[0] + est[1]) / 2; // median: tahan terhadap kepala menoleh
    return { ex: ex, ey: ey, head: head, theta: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  /* ------------------------- Geometri crop ------------------------- */

  // Persegi crop (pusat, ukuran, sudut) untuk rasio lebar/tinggi A.
  function cropRect(p, A) {
    var ch = p.head / (settings.head / 100), cw = ch * A;
    var th = settings.straighten || p.manual ? p.theta : 0; // kemiringan yang diatur manual selalu dipakai
    var dy = (0.5 - settings.eye / 100) * ch;
    return { cx: p.ex - Math.sin(th) * dy, cy: p.ey + Math.cos(th) * dy, cw: cw, ch: ch, theta: th };
  }

  // Geser crop agar tetap di dalam foto bila foto cukup luas (komposisi sedikit bergeser, tanpa tepi putih).
  function keepInside(r, W, H) {
    var pts = corners(r);
    var minX = Math.min.apply(null, pts.map(function (p) { return p.x; })), maxX = Math.max.apply(null, pts.map(function (p) { return p.x; }));
    var minY = Math.min.apply(null, pts.map(function (p) { return p.y; })), maxY = Math.max.apply(null, pts.map(function (p) { return p.y; }));
    var dx = 0, dy = 0;
    if (maxX - minX <= W) dx = minX < 0 ? -minX : (maxX > W ? W - maxX : 0);
    if (maxY - minY <= H) dy = minY < 0 ? -minY : (maxY > H ? H - maxY : 0);
    return { cx: r.cx + dx, cy: r.cy + dy, cw: r.cw, ch: r.ch, theta: r.theta, shifted: Math.hypot(dx, dy) > 0.02 * r.ch };
  }

  function centerParams(W, H, A) {
    var ch = Math.min(H, W / A), head = ch * settings.head / 100;
    return { ex: W / 2, ey: H / 2 - (0.5 - settings.eye / 100) * ch, head: head, theta: 0 };
  }

  function corners(r) {
    var c = Math.cos(r.theta), s = Math.sin(r.theta);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (k) {
      var x = k[0] * r.cw / 2, y = k[1] * r.ch / 2;
      return { x: r.cx + x * c - y * s, y: r.cy + x * s + y * c };
    });
  }

  function renderCrop(bmp, r, W, H) {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(W / 2, H / 2);
    ctx.scale(W / r.cw, W / r.cw);
    ctx.rotate(-r.theta);
    ctx.translate(-r.cx, -r.cy);
    ctx.drawImage(bmp, 0, 0);
    return c;
  }

  /* ------------------------- Simpan ke file (dengan DPI) ------------------------- */

  function toBlob(canvas, type) {
    return new Promise(function (res) { canvas.toBlob(res, type, 0.95); });
  }

  var CRC_TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // Tulis resolusi (DPI) ke file agar ukuran cetak dalam mm tepat saat dibuka aplikasi lain.
  function withDpi(blob, dpi) {
    return blob.arrayBuffer().then(function (buf) {
      var u = new Uint8Array(buf);
      if (blob.type === 'image/jpeg') {
        if (u[2] === 0xFF && u[3] === 0xE0 && u[6] === 0x4A && u[7] === 0x46 && u[8] === 0x49 && u[9] === 0x46) {
          u[13] = 1; u[14] = dpi >> 8; u[15] = dpi & 255; u[16] = dpi >> 8; u[17] = dpi & 255;
          return new Blob([u], { type: blob.type });
        }
        var app0 = new Uint8Array([0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0]);
        return new Blob([u.subarray(0, 2), app0, u.subarray(2)], { type: blob.type });
      }
      if (blob.type === 'image/png') {
        var ppm = Math.round(dpi / 0.0254);
        var chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
        dv.setUint32(0, 9);
        chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
        dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
        dv.setUint32(17, crc32(chunk.subarray(4, 17)));
        return new Blob([u.subarray(0, 33), chunk, u.subarray(33)], { type: blob.type });
      }
      return blob;
    });
  }

  /* ------------------------- Antrian proses ------------------------- */

  var queue = [], running = false;

  function markAll(needDetect) {
    items.forEach(function (it) {
      it.dirty = true;
      if (needDetect) it.needDetect = true;
      queue.push(it.id);
    });
    run();
  }

  function findItem(id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; }

  function run() {
    if (running) return;
    running = true;
    updateProgress();
    (function next() {
      var id = queue.shift();
      if (id == null) { running = false; updateProgress(); return; }
      var it = findItem(id);
      if (!it || !it.dirty) { next(); return; }
      it.dirty = false;
      processItem(it).catch(function (e) {
        it.status = 'error';
        it.warn = ['Gagal: ' + (e && e.message ? e.message : e)];
      }).then(function () {
        updateCard(it);
        updateProgress();
        setTimeout(next, 0);
      });
    })();
  }

  function processItem(it) {
    var T = targets();
    if (!T.length) return Promise.resolve();
    return loadPhoto(it.file).then(function (bmp) {
      var step = Promise.resolve();
      if (it.needDetect) {
        step = getDetector().then(function (det) {
          var faces = detectFaces(det, bmp);
          it.needDetect = false;
          it.faces = faces.length;
          faces.sort(function (a, b) { return b.w * b.h * b.score - a.w * a.h * a.score; });
          it.face = faces.length ? faceParams(faces[0]) : null;
          it.multi = faces.length > 1 && faces[1].w * faces[1].h > 0.4 * faces[0].w * faces[0].h;
        });
      }
      return step.then(function () {
        it.iw = bmp.width; it.ih = bmp.height;
        it.warn = [];
        if (!it.face && !it.crop && settings.noface === 'skip') {
          it.status = 'skip';
          clearOuts(it);
          bmp.close();
          return;
        }
        var outs = {}, chain = Promise.resolve();
        T.forEach(function (t, idx) {
          chain = chain.then(function () {
            var A = t.w / t.h;
            var p = it.crop || it.face || centerParams(bmp.width, bmp.height, A);
            var r = cropRect(p, A);
            if (!it.crop) r = keepInside(r, bmp.width, bmp.height);
            if (idx === 0) checkWarnings(it, r, bmp, t);
            var c = renderCrop(bmp, r, t.w, t.h);
            var bg = settings.bg && window.FotoBG ? window.FotoBG.replaceBackground(c, { color: settings.bg }) : Promise.resolve(c);
            return bg.then(function (cc) {
              return toBlob(cc, settings.format === 'png' ? 'image/png' : 'image/jpeg');
            }).then(function (b) { return withDpi(b, Math.round(settings.dpi)); }).then(function (b) { outs[t.key] = b; });
          });
        });
        return chain.then(function () {
          bmp.close();
          clearOuts(it);
          it.outs = outs;
          it.thumb = URL.createObjectURL(outs[T[0].key]);
          it.status = 'done';
        });
      });
    });
  }

  function checkWarnings(it, r, bmp, t) {
    if (!it.face && !it.crop) it.warn.push('Wajah tidak terdeteksi — crop tengah');
    if (it.face && it.multi && !it.crop) it.warn.push('Lebih dari 1 wajah — dipilih yang terbesar');
    var out = corners(r).some(function (p) {
      return p.x < -0.01 * bmp.width || p.y < -0.01 * bmp.height || p.x > 1.01 * bmp.width || p.y > 1.01 * bmp.height;
    });
    if (out) it.warn.push('Foto kurang luas — tepi diisi putih');
    else if (r.shifted) it.warn.push('Posisi digeser agar tetap di dalam foto');
    if (r.cw < t.w * 0.75) it.warn.push('Resolusi rendah (diperbesar ' + Math.round(t.w / r.cw * 100) + '%)');
  }

  function clearOuts(it) {
    if (it.thumb) URL.revokeObjectURL(it.thumb);
    it.thumb = null;
    it.outs = {};
  }

  /* ------------------------- Tampilan ------------------------- */

  function category(it) {
    if (it.crop) return 'manual';
    if (it.status === 'error' || !it.face) return 'none';
    if (it.warn.some(function (w) { return !/^Posisi digeser/.test(w); })) return 'warn'; // geser posisi = info saja
    return 'ok';
  }

  function badge(it) {
    if (it.status === 'pending' || it.dirty) return '';
    if (it.status === 'skip') return '<span class="st none">Dilewati (tanpa wajah)</span>';
    if (it.status === 'error') return '<span class="st none">Gagal</span>';
    var c = category(it);
    return '<span class="st ' + (c === 'ok' ? '' : c) + '">' +
      ({ ok: 'Wajah OK', warn: 'Perlu dicek', none: 'Tanpa wajah', manual: 'Manual' })[c] + '</span>';
  }

  function cardHtml(it) {
    var T = targets(), ar = T.length ? T[0].w + ' / ' + T[0].h : '3 / 4';
    var dir = it.path.indexOf('/') >= 0 ? it.path.slice(0, it.path.lastIndexOf('/')) : '';
    return '<div class="crop-card" data-id="' + it.id + '"' + (visible(it) ? '' : ' hidden') + '>' +
      '<div class="pic" style="aspect-ratio:' + ar + '">' +
        (it.thumb ? '<img src="' + it.thumb + '" alt="">' : '<span class="spin">' + (it.status === 'skip' ? '—' : 'Memproses…') + '</span>') +
        badge(it) + '</div>' +
      '<div class="meta"><div class="nm" title="' + esc(it.name) + '">' + esc(it.name) + '</div>' +
        '<div class="path" title="' + esc(dir) + '">' + esc(dir || '—') + '</div>' +
        (it.warn.length ? '<div class="path" style="color:#a35a00;white-space:normal" title="' + esc(it.warn.join('\n')) + '">⚠ ' + esc(it.warn[0]) + '</div>' : '') +
      '</div>' +
      '<div class="acts"><button type="button" data-act="edit">Atur</button><button type="button" data-act="del" class="danger">Hapus</button></div>' +
      '</div>';
  }

  function visible(it) { return filter === 'all' || (it.status !== 'pending' && !it.dirty && category(it) === filter); }

  function renderGrid() {
    $('grid').innerHTML = items.length ? items.map(cardHtml).join('') :
      '<div class="empty" style="padding:60px">Pilih folder atau foto untuk mulai.</div>';
    $('filters').hidden = !items.length;
    updateCounts();
  }

  function updateCard(it) {
    var el = $('grid').querySelector('.crop-card[data-id="' + it.id + '"]');
    if (el) el.outerHTML = cardHtml(it);
    updateCounts();
  }

  function updateCounts() {
    var n = { all: items.length, ok: 0, warn: 0, none: 0, manual: 0 };
    items.forEach(function (it) { if (it.status !== 'pending' && !it.dirty) n[category(it)]++; });
    Array.prototype.forEach.call($('filters').querySelectorAll('[data-filter]'), function (b) {
      b.querySelector('span').textContent = '(' + n[b.getAttribute('data-filter')] + ')';
      b.classList.toggle('on', b.getAttribute('data-filter') === filter);
    });
    var label = { ok: 'wajah terdeteksi', warn: 'perlu dicek', none: 'tanpa wajah', manual: 'diatur manual' }[filter];
    $('filter-empty').hidden = !(items.length && filter !== 'all' && !n[filter]);
    $('filter-empty').textContent = 'Tidak ada foto dengan status "' + label + '".';
  }

  function updateProgress() {
    var total = items.length, done = items.filter(function (it) { return !it.dirty && it.status !== 'pending'; }).length;
    var busy = running || done < total;
    $('progress').hidden = !busy || !total;
    $('progress-bar').style.width = total ? (done / total * 100) + '%' : '0';
    $('progress-text').textContent = total ? (busy ? 'Memproses ' + done + ' / ' + total + '…' : total + ' foto selesai diproses') : '';
    var ready = items.some(function (it) { return it.status === 'done'; });
    $('btn-zip').disabled = busy || !ready;
    $('btn-to-print').disabled = busy || !ready;
    $('btn-process').disabled = busy || !total;
  }

  /* ------------------------- Editor manual ------------------------- */

  var ed = null; // { it, bmp, p, scale, view }

  function openEditor(it) {
    var T = targets();
    if (!T.length) return;
    loadPhoto(it.file).then(function (bmp) {
      var A = T[0].w / T[0].h;
      var p = it.crop || it.face || centerParams(bmp.width, bmp.height, A);
      var maxW = Math.min(680, window.innerWidth - 330), maxH = Math.min(540, window.innerHeight - 200);
      var s = Math.min(maxW / bmp.width, maxH / bmp.height);
      ed = { it: it, bmp: bmp, A: A, t: T[0], s: s, p: { ex: p.ex, ey: p.ey, head: p.head, theta: settings.straighten || p.manual ? p.theta : 0, manual: true }, base: p.head };
      var cv = $('edit-canvas');
      cv.width = Math.round(bmp.width * s);
      cv.height = Math.round(bmp.height * s);
      var pv = $('edit-preview');
      var ps = Math.min(1, 220 / T[0].w);
      pv.width = Math.round(T[0].w * ps); pv.height = Math.round(T[0].h * ps);
      $('edit-scale').value = 1;
      $('edit-rot').value = (ed.p.theta * 180 / Math.PI).toFixed(1);
      $('edit-info').textContent = it.path + ' — ' + bmp.width + '×' + bmp.height + ' px — ' + (it.faces ? it.faces + ' wajah terdeteksi' : 'wajah tidak terdeteksi');
      drawEditor();
      if (!$('dlg-edit').open) $('dlg-edit').showModal();
    });
  }

  function drawEditor() {
    var cv = $('edit-canvas'), ctx = cv.getContext('2d'), s = ed.s;
    var r = cropRect(ed.p, ed.A);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(ed.bmp, 0, 0, cv.width, cv.height);
    var pts = corners(r).map(function (q) { return { x: q.x * s, y: q.y * s }; });
    // gelapkan area di luar crop
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath();
    ctx.rect(0, 0, cv.width, cv.height);
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 3; i >= 1; i--) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach(function (q, k) { if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    ctx.closePath();
    ctx.stroke();
    // garis mata (merah), ubun-ubun & dagu (hijau) di dalam crop
    ctx.translate(r.cx * s, r.cy * s);
    ctx.rotate(r.theta);
    var hw = r.cw * s / 2, eyeY = (settings.eye / 100 - 0.5) * r.ch * s;
    var crown = eyeY - EYE_IN_HEAD * ed.p.head * s, chin = eyeY + (1 - EYE_IN_HEAD) * ed.p.head * s;
    [[eyeY, '#ff4d4f'], [crown, '#36d07a'], [chin, '#36d07a']].forEach(function (l) {
      ctx.strokeStyle = l[1];
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(-hw, l[0]); ctx.lineTo(hw, l[0]); ctx.stroke();
    });
    ctx.restore();
    $('edit-rot-v').textContent = (ed.p.theta * 180 / Math.PI).toFixed(1) + '°';
    // pratinjau hasil
    var pv = $('edit-preview'), pr = cropRect(ed.p, ed.A);
    var out = renderCrop(ed.bmp, pr, pv.width, pv.height);
    pv.getContext('2d').drawImage(out, 0, 0);
  }

  function closeEditor() {
    if (ed && ed.bmp) ed.bmp.close();
    ed = null;
    if ($('dlg-edit').open) $('dlg-edit').close();
  }

  (function initEditor() {
    var cv = $('edit-canvas'), drag = null;
    cv.addEventListener('pointerdown', function (e) {
      if (!ed) return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ }
      drag = { x: e.clientX, y: e.clientY, ex: ed.p.ex, ey: ed.p.ey };
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drag || !ed) return;
      var r = cv.getBoundingClientRect(), k = cv.width / r.width / ed.s;
      ed.p.ex = drag.ex + (e.clientX - drag.x) * k;
      ed.p.ey = drag.ey + (e.clientY - drag.y) * k;
      drawEditor();
    });
    cv.addEventListener('pointerup', function () { drag = null; });
    cv.addEventListener('wheel', function (e) {
      if (!ed) return;
      e.preventDefault();
      ed.p.head *= e.deltaY < 0 ? 1 / 1.05 : 1.05;
      $('edit-scale').value = (ed.p.head / ed.base).toFixed(2);
      drawEditor();
    }, { passive: false });
    $('edit-scale').addEventListener('input', function () { if (ed) { ed.p.head = ed.base * num(this.value, 1); drawEditor(); } });
    $('edit-rot').addEventListener('input', function () { if (ed) { ed.p.theta = num(this.value, 0) * Math.PI / 180; drawEditor(); } });
    $('edit-auto').addEventListener('click', function () {
      if (!ed) return;
      var it = ed.it;
      it.crop = null;
      closeEditor();
      it.dirty = true; queue.push(it.id); run();
      updateCard(it);
    });
    $('edit-cancel').addEventListener('click', closeEditor);
    $('edit-save').addEventListener('click', function () {
      if (!ed) return;
      var it = ed.it;
      it.crop = { ex: ed.p.ex, ey: ed.p.ey, head: ed.p.head, theta: ed.p.theta, manual: true };
      closeEditor();
      it.dirty = true; queue.push(it.id); run();
      updateCard(it);
    });
    $('dlg-edit').addEventListener('close', function () { if (ed) closeEditor(); });
  })();

  /* ------------------------- ZIP & kirim ke Cetak Foto ------------------------- */

  function outName(it, t, T) {
    var base = it.path.replace(/\.[^./]+$/, '') + '.' + (settings.format === 'png' ? 'png' : 'jpg');
    return (T.length > 1 ? t.folder + '/' : '') + base;
  }

  function downloadZip() {
    var T = targets(), zip = new JSZip(), n = 0;
    items.forEach(function (it) {
      if (it.status !== 'done') return;
      T.forEach(function (t) { if (it.outs[t.key]) { zip.file(outName(it, t, T), it.outs[t.key]); n++; } });
    });
    if (!n) return;
    $('btn-zip').disabled = true;
    zip.generateAsync({ type: 'blob', compression: 'STORE' }, function (m) {
      $('progress-text').textContent = 'Membuat ZIP… ' + Math.round(m.percent) + '%';
    }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'crop_' + T.map(function (t) { return t.folder; }).join('_') + '_' + new Date().toISOString().slice(0, 10) + '.zip';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      $('progress-text').textContent = n + ' file dimasukkan ke ZIP.';
      updateProgress();
    });
  }

  // Buka halaman Cetak Foto dan kirim hasil crop lewat postMessage (tetap di memori, tanpa penyimpanan).
  function sendToPrint() {
    var T = targets(), list = [];
    items.forEach(function (it) {
      if (it.status !== 'done') return;
      T.forEach(function (t) {
        var b = it.outs[t.key];
        if (!b) return;
        list.push({ file: new File([b], outName(it, t, T).split('/').pop(), { type: b.type }), size: t.sizeKey, cw: t.wMm, ch: t.hMm });
      });
    });
    if (!list.length) return;
    var win = window.open('foto.html#import', '_blank');
    if (!win) { alert('Jendela baru diblokir browser. Izinkan pop-up untuk halaman ini.'); return; }
    function onMsg(e) {
      if (e.origin !== location.origin || e.source !== win || !e.data || e.data.type !== 'cetakfoto-ready') return;
      window.removeEventListener('message', onMsg);
      win.postMessage({ type: 'cropmassal-files', items: list }, location.origin);
    }
    window.addEventListener('message', onMsg);
  }

  /* ------------------------- Pengaturan & event ------------------------- */

  function sizeInfo() {
    var T = targets();
    $('size-info').innerHTML = T.length ? T.map(function (t) {
      return '<b>' + esc(t.folder) + '</b>: ' + t.w + ' × ' + t.h + ' px' +
        (settings.custom && t.key === 'custom' && settings.unit === 'px' ? ' (±' + t.wMm.toFixed(1) + ' × ' + t.hMm.toFixed(1) + ' mm @' + settings.dpi + ' dpi)' :
          ' (' + t.wMm.toFixed(1) + ' × ' + t.hMm.toFixed(1) + ' mm @' + settings.dpi + ' dpi)');
    }).join('<br>') + (T.length > 1 ? '<br>Tiap ukuran disimpan di folder terpisah dalam ZIP.' : '') :
      '<span style="color:#b42318">Pilih minimal satu ukuran.</span>';
  }

  var rerenderTimer = null;
  function settingsChanged(needDetect) {
    saveSettings();
    sizeInfo();
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(function () {
      if (!items.length) return;
      renderGrid();
      markAll(needDetect);
    }, 350);
  }

  function init() {
    $('size-list').innerHTML = SIZES.map(function (s) {
      return '<label><input type="checkbox" value="' + s.key + '"' + (settings.sizes.indexOf(s.key) >= 0 ? ' checked' : '') + '> ' +
        s.key + ' <small>' + s.w + '×' + s.h + ' cm</small></label>';
    }).join('');
    $('size-list').addEventListener('change', function () {
      settings.sizes = Array.prototype.filter.call(this.querySelectorAll('input'), function (i) { return i.checked; })
        .map(function (i) { return i.value; });
      settingsChanged(false);
    });
    $('chk-custom').checked = settings.custom;
    $('inp-cw').value = settings.cw; $('inp-ch').value = settings.ch; $('sel-unit').value = settings.unit;
    $('inp-dpi').value = settings.dpi; $('sel-format').value = settings.format;
    $('inp-head').value = settings.head; $('inp-eye').value = settings.eye;
    $('chk-straighten').checked = settings.straighten; $('sel-noface').value = settings.noface;
    function labels() { $('v-head').textContent = settings.head + '%'; $('v-eye').textContent = settings.eye + '%'; }
    labels();

    $('chk-custom').addEventListener('change', function () { settings.custom = this.checked; settingsChanged(false); });
    ['inp-cw', 'inp-ch'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        settings[id === 'inp-cw' ? 'cw' : 'ch'] = Math.max(1, num(this.value, 1));
        if (settings.custom) settingsChanged(false); else saveSettings();
      });
    });
    $('sel-unit').addEventListener('change', function () { settings.unit = this.value; settingsChanged(false); });
    $('inp-dpi').addEventListener('input', function () { settings.dpi = Math.min(1200, Math.max(72, Math.round(num(this.value, 300)))); settingsChanged(false); });
    $('sel-format').addEventListener('change', function () { settings.format = this.value; settingsChanged(false); });
    $('inp-head').addEventListener('input', function () { settings.head = +this.value; labels(); settingsChanged(false); });
    $('inp-eye').addEventListener('input', function () { settings.eye = +this.value; labels(); settingsChanged(false); });
    $('chk-straighten').addEventListener('change', function () { settings.straighten = this.checked; settingsChanged(false); });
    $('sel-noface').addEventListener('change', function () { settings.noface = this.value; settingsChanged(false); });

    $('bg-swatches').innerHTML = BG_COLORS.map(function (c) {
      return '<button type="button" class="swatch' + (c.v ? '' : ' orig') + (settings.bg === c.v ? ' on' : '') + '" title="' + c.name +
        '" data-color="' + c.v + '" style="' + (c.v ? 'background:' + c.v : '') + '"></button>';
    }).join('');
    $('bg-swatches').addEventListener('click', function (e) {
      var c = e.target.getAttribute('data-color');
      if (c == null) return;
      settings.bg = c;
      Array.prototype.forEach.call(this.children, function (b) { b.classList.toggle('on', b === e.target); });
      settingsChanged(false);
    });

    $('pick-folder').addEventListener('change', function () { fromInput(this.files); this.value = ''; });
    $('pick-files').addEventListener('change', function () { fromInput(this.files); this.value = ''; });
    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); }); });
    drop.addEventListener('drop', function (e) {
      var dtItems = e.dataTransfer.items, out = [];
      if (dtItems && dtItems.length && dtItems[0].webkitGetAsEntry) {
        var entries = Array.prototype.map.call(dtItems, function (i) { return i.webkitGetAsEntry(); }).filter(Boolean);
        if (entries.length) {
          Promise.all(entries.map(function (en) { return walkEntry(en, out); })).then(function () { addEntries(out); });
          return;
        }
      }
      fromInput(e.dataTransfer.files);
    });

    $('grid').addEventListener('click', function (e) {
      var act = e.target.getAttribute('data-act'), card = e.target.closest('.crop-card');
      if (!act || !card) return;
      var it = findItem(+card.getAttribute('data-id'));
      if (act === 'edit') openEditor(it);
      if (act === 'del') {
        clearOuts(it);
        items.splice(items.indexOf(it), 1);
        card.remove();
        updateCounts();
        updateProgress();
        $('pick-info').textContent = items.length + ' foto dimuat.';
      }
    });
    $('filters').addEventListener('click', function (e) {
      var f = e.target.closest('[data-filter]');
      if (!f) return;
      filter = f.getAttribute('data-filter');
      renderGrid();
    });
    $('btn-clear').addEventListener('click', function () {
      if (!confirm('Hapus semua foto dari halaman ini?')) return;
      clearAll();
    });
    $('btn-process').addEventListener('click', function () { markAll(true); renderGrid(); });
    $('btn-zip').addEventListener('click', downloadZip);
    $('btn-to-print').addEventListener('click', sendToPrint);
    window.addEventListener('pagehide', clearAll);
    sizeInfo();
  }

  function clearAll() {
    closeEditor();
    items.forEach(clearOuts);
    items = [];
    queue = [];
    $('pick-info').textContent = '';
    renderGrid();
    updateProgress();
  }

  init();
})();
