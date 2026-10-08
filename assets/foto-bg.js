/* Hapus & ganti background foto. Deteksi orang memakai MediaPipe Image Segmenter (berjalan di browser,
 * file ada di vendor/mediapipe), lalu hasilnya bisa dikoreksi dengan kuas Hapus/Pulihkan.
 *
 * window.FotoBG.open({ name, src, state }, onApply)
 *   src    : URL foto asli
 *   state  : hasil pengaturan sebelumnya (atau null)
 *   onApply: function ({ state, url })  — url = gambar hasil (null bila kembali ke foto asli)
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var MODEL_URL = 'vendor/mediapipe/selfie_multiclass_256x256.tflite';
  var WASM_URL = 'vendor/mediapipe/wasm';
  var BUNDLE_URL = '../vendor/mediapipe/vision_bundle.mjs'; // relatif terhadap file ini
  var MASK_MAX = 1280; // resolusi maksimum mask (sisi terpanjang)
  var COLORS = [
    { name: 'Merah', v: '#d71920' }, { name: 'Biru', v: '#1e5bb8' }, { name: 'Biru muda', v: '#4a9be0' },
    { name: 'Putih', v: '#ffffff' }, { name: 'Abu-abu', v: '#cfd3d8' }, { name: 'Hijau', v: '#2e9a4b' }, { name: 'Kuning', v: '#f2c230' }
  ];

  var segmenterPromise = null;
  function getSegmenter() {
    if (!segmenterPromise) {
      segmenterPromise = import(BUNDLE_URL).then(function (mp) {
        return mp.FilesetResolver.forVisionTasks(WASM_URL).then(function (fileset) {
          var opts = function (delegate) {
            return { baseOptions: { modelAssetPath: MODEL_URL, delegate: delegate }, runningMode: 'IMAGE',
              outputCategoryMask: false, outputConfidenceMasks: true };
          };
          return mp.ImageSegmenter.createFromOptions(fileset, opts('GPU')).catch(function () {
            return mp.ImageSegmenter.createFromOptions(fileset, opts('CPU'));
          });
        });
      });
      segmenterPromise.catch(function () { segmenterPromise = null; });
    }
    return segmenterPromise;
  }

  function loadImage(src) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('Gambar tidak bisa dibuka')); };
      img.src = src;
    });
  }
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /* ------------------------- Status editor ------------------------- */

  var S = null;        // state yang sedang diedit (salinan)
  var img = null;      // foto asli
  var onApply = null;
  var autoMask = null; // mask dari deteksi (setelah ambang)
  var mask = null;     // autoMask + goresan kuas
  var view = { w: 0, h: 0 };
  var brushMode = 'erase', drawing = null, pointer = null;

  function defaultState() {
    return { conf: null, mw: 0, mh: 0, threshold: 0.5, feather: 2, strokes: [], bgType: 'color', color: '#d71920', bgImage: null };
  }

  function status(msg, isError) {
    var el = $('bg-status');
    el.textContent = msg || '';
    el.style.color = isError ? '#b42318' : '';
  }

  // Jalankan model pada foto (diperkecil) → simpan tingkat keyakinan "orang" per piksel (0–255).
  function detect() {
    status('Memuat model & mendeteksi orang… (pertama kali bisa beberapa detik)');
    $('bg-detect').disabled = true;
    return getSegmenter().then(function (seg) {
      var s = Math.min(1, MASK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
      var c = canvas(w, h);
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      var res = seg.segment(c);
      var m = res.confidenceMasks[0]; // kategori 0 = background
      var bg = m.getAsFloat32Array();
      var conf = new Uint8ClampedArray(m.width * m.height);
      for (var i = 0; i < conf.length; i++) conf[i] = (1 - bg[i]) * 255;
      S.conf = conf; S.mw = m.width; S.mh = m.height;
      if (res.close) res.close();
      buildAutoMask();
      redraw();
      status('Selesai. Rapikan tepi dengan kuas bila perlu.');
    }).catch(function (e) {
      status('Deteksi gagal: ' + (e && e.message ? e.message : e), true);
    }).then(function () { $('bg-detect').disabled = false; });
  }

  function buildAutoMask() {
    if (!S.conf) return;
    autoMask = canvas(S.mw, S.mh);
    var ctx = autoMask.getContext('2d');
    var data = ctx.createImageData(S.mw, S.mh), d = data.data;
    // ambang lembut: di bawah lo = background, di atas hi = orang
    var t = S.threshold * 255, lo = t - 30, hi = t + 30;
    for (var i = 0, j = 0; i < S.conf.length; i++, j += 4) {
      var v = (S.conf[i] - lo) / (hi - lo);
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      d[j] = d[j + 1] = d[j + 2] = 255;
      d[j + 3] = v * v * (3 - 2 * v) * 255;
    }
    ctx.putImageData(data, 0, 0);
    rebuildMask();
  }

  function drawStroke(ctx, st, w, h) {
    ctx.save();
    ctx.globalCompositeOperation = st.mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = '#fff';
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.lineWidth = st.size * w;
    ctx.beginPath();
    st.pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0] * w, p[1] * h); else ctx.moveTo(p[0] * w, p[1] * h); });
    if (st.pts.length === 1) { ctx.arc(st.pts[0][0] * w, st.pts[0][1] * h, st.size * w / 2, 0, Math.PI * 2); ctx.fill(); }
    else ctx.stroke();
    ctx.restore();
  }

  function rebuildMask() {
    mask = canvas(S.mw, S.mh);
    var ctx = mask.getContext('2d');
    ctx.drawImage(autoMask, 0, 0);
    S.strokes.forEach(function (st) { drawStroke(ctx, st, S.mw, S.mh); });
  }

  /* ------------------------- Komposisi ------------------------- */

  // Gambar hasil (background baru + orang) pada kanvas berukuran w × h.
  function compose(w, h, forView) {
    var out = canvas(w, h), ctx = out.getContext('2d');
    if (!mask) { ctx.drawImage(img, 0, 0, w, h); return out; }

    if (S.bgType === 'image' && S.bgImage) {
      var bi = S.bgImage, r = Math.max(w / bi.naturalWidth, h / bi.naturalHeight);
      var bw = bi.naturalWidth * r, bh = bi.naturalHeight * r;
      ctx.drawImage(bi, (w - bw) / 2, (h - bh) / 2, bw, bh);
    } else if (S.bgType === 'blur') {
      ctx.filter = 'blur(' + Math.max(2, Math.round(Math.max(w, h) / 70)) + 'px)';
      ctx.drawImage(img, -w * 0.03, -h * 0.03, w * 1.06, h * 1.06);
      ctx.filter = 'none';
    } else {
      ctx.fillStyle = S.color;
      ctx.fillRect(0, 0, w, h);
    }

    var person = canvas(w, h), pc = person.getContext('2d');
    pc.drawImage(img, 0, 0, w, h);
    pc.globalCompositeOperation = 'destination-in';
    var blur = S.feather * Math.max(w, h) / 1000;
    if (blur > 0.3) pc.filter = 'blur(' + blur.toFixed(2) + 'px)';
    pc.imageSmoothingQuality = 'high';
    pc.drawImage(mask, 0, 0, w, h);
    ctx.drawImage(person, 0, 0);

    if (forView && $('bg-overlay').checked) {
      // tandai area terhapus dengan merah transparan di atas foto asli
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      var red = canvas(w, h), rc = red.getContext('2d');
      rc.fillStyle = 'rgba(230, 30, 30, 0.55)';
      rc.fillRect(0, 0, w, h);
      rc.globalCompositeOperation = 'destination-out';
      rc.drawImage(mask, 0, 0, w, h);
      ctx.drawImage(red, 0, 0);
    }
    return out;
  }

  function redraw() {
    var cv = $('bg-canvas'), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.drawImage(compose(view.w, view.h, true), 0, 0);
    if (pointer && mask) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, $('bg-brush').value / 100 * view.w / 2, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = brushMode === 'erase' ? '#e11d48' : '#16a34a';
      ctx.stroke();
      ctx.restore();
    }
  }

  function syncControls() {
    $('bg-threshold').value = S.threshold;
    $('bg-feather').value = S.feather;
    var sw = $('bg-swatches').querySelectorAll('.swatch[data-color]');
    for (var i = 0; i < sw.length; i++) {
      sw[i].classList.toggle('on', S.bgType === 'color' && sw[i].getAttribute('data-color').toLowerCase() === S.color.toLowerCase());
    }
    var custom = S.bgType === 'color' && !COLORS.some(function (c) { return c.v.toLowerCase() === S.color.toLowerCase(); });
    $('bg-swatches').querySelector('.picker').classList.toggle('on', custom);
    document.querySelector('[data-bgtype="blur"]').classList.toggle('on', S.bgType === 'blur');
    $('bg-image').parentNode.classList.toggle('on', S.bgType === 'image');
    $('bg-undo').disabled = !S.strokes.length;
    $('bg-clear').disabled = !S.strokes.length;
  }

  /* ------------------------- Buka / tutup ------------------------- */

  function open(opts, cb) {
    onApply = cb;
    S = defaultState();
    if (opts.state) {
      for (var k in opts.state) S[k] = opts.state[k];
      S.strokes = opts.state.strokes.slice();
    }
    mask = autoMask = null;
    status('');
    $('bg-remove').hidden = !opts.state;
    loadImage(opts.src).then(function (im) {
      img = im;
      var maxW = Math.min(640, window.innerWidth - 360), maxH = Math.min(560, window.innerHeight - 220);
      var s = Math.min(maxW / im.naturalWidth, maxH / im.naturalHeight);
      view.w = Math.max(50, Math.round(im.naturalWidth * s));
      view.h = Math.max(50, Math.round(im.naturalHeight * s));
      $('bg-canvas').width = view.w;
      $('bg-canvas').height = view.h;
      syncControls();
      if (!$('dlg-bg').open) $('dlg-bg').showModal();
      if (S.conf) { buildAutoMask(); redraw(); } else { redraw(); detect(); }
    }).catch(function (e) { alert(e.message); });
  }

  function apply() {
    if (!mask) { status('Tunggu deteksi selesai dulu.', true); return; }
    status('Membuat gambar hasil…');
    $('bg-apply').disabled = true;
    setTimeout(function () {
      var out = compose(img.naturalWidth, img.naturalHeight, false);
      out.toBlob(function (blob) {
        $('bg-apply').disabled = false;
        if (!blob) { status('Gambar terlalu besar untuk diproses.', true); return; }
        $('dlg-bg').close();
        var st = {};
        for (var k in S) st[k] = S[k];
        onApply({ state: st, url: URL.createObjectURL(blob) });
      }, 'image/jpeg', 0.95);
    }, 20);
  }

  /* ------------------------- Event ------------------------- */

  function init() {
    $('bg-swatches').innerHTML = COLORS.map(function (c) {
      return '<button type="button" class="swatch" title="' + c.name + '" data-color="' + c.v + '" style="background:' + c.v + '"></button>';
    }).join('') + '<label class="swatch picker" title="Warna lain"><input type="color" id="bg-color" value="#d71920"></label>';

    $('bg-swatches').addEventListener('click', function (e) {
      var c = e.target.getAttribute('data-color');
      if (!c) return;
      S.bgType = 'color'; S.color = c;
      syncControls(); redraw();
    });
    $('bg-color').addEventListener('input', function () { S.bgType = 'color'; S.color = this.value; syncControls(); redraw(); });
    document.querySelector('[data-bgtype="blur"]').addEventListener('click', function () { S.bgType = 'blur'; syncControls(); redraw(); });
    $('bg-image').addEventListener('change', function () {
      var f = this.files[0];
      this.value = '';
      if (!f) return;
      loadImage(URL.createObjectURL(f)).then(function (im) {
        S.bgImage = im; S.bgType = 'image';
        syncControls(); redraw();
      }).catch(function (e) { alert(e.message); });
    });

    $('bg-threshold').addEventListener('input', function () { S.threshold = +this.value; buildAutoMask(); redraw(); });
    $('bg-feather').addEventListener('input', function () { S.feather = +this.value; redraw(); });
    $('bg-overlay').addEventListener('change', redraw);
    $('bg-detect').addEventListener('click', detect);
    $('bg-mode').addEventListener('click', function (e) {
      var m = e.target.getAttribute('data-mode');
      if (!m) return;
      brushMode = m;
      Array.prototype.forEach.call(this.children, function (b) { b.classList.toggle('on', b === e.target); });
    });
    $('bg-undo').addEventListener('click', function () { S.strokes.pop(); rebuildMask(); syncControls(); redraw(); });
    $('bg-clear').addEventListener('click', function () { S.strokes = []; rebuildMask(); syncControls(); redraw(); });

    var cv = $('bg-canvas');
    function pos(e) {
      var r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) * view.w / r.width, y: (e.clientY - r.top) * view.h / r.height };
    }
    cv.addEventListener('pointerdown', function (e) {
      if (!mask) return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ }
      var p = pos(e);
      drawing = { mode: brushMode, size: $('bg-brush').value / 100, pts: [[p.x / view.w, p.y / view.h]] };
      S.strokes.push(drawing);
      drawStroke(mask.getContext('2d'), drawing, S.mw, S.mh);
      pointer = p;
      redraw();
    });
    cv.addEventListener('pointermove', function (e) {
      pointer = pos(e);
      if (drawing) {
        var last = drawing.pts[drawing.pts.length - 1];
        drawing.pts.push([pointer.x / view.w, pointer.y / view.h]);
        // gambar hanya potongan terakhir agar tetap ringan
        drawStroke(mask.getContext('2d'), { mode: drawing.mode, size: drawing.size, pts: [last, drawing.pts[drawing.pts.length - 1]] }, S.mw, S.mh);
      }
      redraw();
    });
    function end() { if (drawing) { drawing = null; syncControls(); } }
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', function () { pointer = null; if (!drawing) redraw(); });

    $('bg-apply').addEventListener('click', apply);
    $('bg-cancel').addEventListener('click', function () { $('dlg-bg').close(); });
    $('bg-remove').addEventListener('click', function () {
      $('dlg-bg').close();
      onApply({ state: null, url: null });
    });
  }

  // Dialog editor hanya ada di halaman Cetak Foto; halaman lain cukup memakai replaceBackground().
  function boot() { if ($('dlg-bg')) init(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // Lepaskan semua foto yang dipegang editor (dipanggil saat "Hapus semua foto" / halaman ditutup).
  function reset() {
    if ($('dlg-bg').open) $('dlg-bg').close();
    if (S && S.bgImage && /^blob:/.test(S.bgImage.src)) URL.revokeObjectURL(S.bgImage.src);
    S = img = mask = autoMask = onApply = drawing = pointer = null;
    var cv = $('bg-canvas');
    cv.width = cv.height = 0;
  }

  /* ------------------------- Mode otomatis (tanpa dialog) ------------------------- */

  // Ganti background sebuah gambar/kanvas secara otomatis (dipakai Crop Massal).
  // opts: { color, threshold (0..1, bawaan 0.5), feather (bawaan 2) } → Promise<canvas> berukuran sama.
  function replaceBackground(source, opts) {
    opts = opts || {};
    var W = source.width, H = source.height;
    return getSegmenter().then(function (seg) {
      var s = Math.min(1, MASK_MAX / Math.max(W, H));
      var w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
      var small = canvas(w, h);
      small.getContext("2d").drawImage(source, 0, 0, w, h);
      var res = seg.segment(small), m = res.confidenceMasks[0], bg = m.getAsFloat32Array();
      var mc = canvas(m.width, m.height), mctx = mc.getContext("2d"), data = mctx.createImageData(m.width, m.height), d = data.data;
      var t = (opts.threshold == null ? 0.5 : opts.threshold) * 255, lo = t - 30, hi = t + 30;
      for (var i = 0, j = 0; i < bg.length; i++, j += 4) {
        var v = ((1 - bg[i]) * 255 - lo) / (hi - lo);
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        d[j] = d[j + 1] = d[j + 2] = 255;
        d[j + 3] = v * v * (3 - 2 * v) * 255;
      }
      mctx.putImageData(data, 0, 0);
      if (res.close) res.close();

      var out = canvas(W, H), ctx = out.getContext("2d");
      ctx.fillStyle = opts.color || "#ffffff";
      ctx.fillRect(0, 0, W, H);
      var person = canvas(W, H), pc = person.getContext("2d");
      pc.drawImage(source, 0, 0);
      pc.globalCompositeOperation = "destination-in";
      var blur = (opts.feather == null ? 2 : opts.feather) * Math.max(W, H) / 1000;
      if (blur > 0.3) pc.filter = "blur(" + blur.toFixed(2) + "px)";
      pc.imageSmoothingQuality = "high";
      pc.drawImage(mc, 0, 0, W, H);
      ctx.drawImage(person, 0, 0);
      return out;
    });
  }

  window.FotoBG = { open: open, reset: reset, replaceBackground: replaceBackground, preload: function () { return getSegmenter(); } };
})();
