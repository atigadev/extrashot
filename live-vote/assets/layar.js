/* Layar hasil live: membaca api/layar.php berkala dan menganimasikan perubahan. */
(function () {
  'use strict';
  const { api, esc, qrSvg, voteUrl, BAR_COLORS } = window.LV;
  const kode = new URLSearchParams(location.search).get('k') || '';
  const POLL_MS = 1500;
  const STATUS_TEXT = { draf: 'BELUM DIBUKA', dibuka: 'LIVE', ditutup: 'SELESAI' };

  const $ = id => document.getElementById(id);
  const barsEl = $('bars');
  const body = document.body;

  // Preferensi tampilan disimpan per layar (opsional; tetap jalan tanpa localStorage).
  const prefKey = 'lv_layar_' + kode;
  let pref = { hide: false, sort: false, qr: true };
  try { Object.assign(pref, JSON.parse(localStorage.getItem(prefKey) || '{}')); } catch (e) { /* abaikan */ }
  function savePref() {
    try { localStorage.setItem(prefKey, JSON.stringify(pref)); } catch (e) { /* abaikan */ }
  }

  let data = null;
  let rows = {};         // id pilihan -> elemen baris
  let shownTotal = 0;
  let failCount = 0;
  let qrFor = '';

  async function poll() {
    try {
      data = await api('api/layar.php?k=' + encodeURIComponent(kode));
      failCount = 0;
      $('msg').hidden = true;
      render();
    } catch (ex) {
      failCount++;
      if (!data || ex.status === 404) {
        $('judul').textContent = '';
        $('tanya').textContent = ex.message;
        return;
      }
      if (failCount >= 2) {
        $('msg').textContent = 'Koneksi terputus — mencoba lagi…';
        $('msg').hidden = false;
      }
    } finally {
      setTimeout(poll, document.hidden ? POLL_MS * 4 : POLL_MS);
    }
  }

  function render() {
    const s = data.sesi;
    document.title = s.judul + ' — Layar Hasil';
    $('judul').textContent = s.judul;
    $('tanya').textContent = s.pertanyaan;
    const st = $('status');
    st.className = 'l-status ' + s.status;
    st.textContent = STATUS_TEXT[s.status];

    animateNumber($('total'), shownTotal, data.total);
    shownTotal = data.total;
    $('total-label').textContent = data.terdaftar != null ? `suara dari ${data.terdaftar} pemilih` : 'suara';

    // Panel bergabung: mode undangan memakai link pribadi, jadi QR umum tidak ditampilkan.
    const joinable = s.mode === 'terbuka' && s.status !== 'ditutup';
    body.classList.toggle('l-noqr', !pref.qr || !joinable);
    if (joinable && qrFor !== s.kode) {
      qrFor = s.kode;
      const url = voteUrl(s.kode);
      $('qr').innerHTML = qrSvg(url, '#0d0f1f');
      $('url').textContent = url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
      $('kode').textContent = s.kode;
    }

    renderBars();
  }

  function renderBars() {
    const list = data.pilihan;
    const ids = list.map(p => p.id);

    // Buang baris pilihan yang sudah dihapus admin, buat baris untuk pilihan baru.
    Object.keys(rows).forEach(id => {
      if (!ids.includes(+id)) { rows[id].remove(); delete rows[id]; }
    });
    list.forEach((p, i) => {
      let row = rows[p.id];
      if (!row) {
        row = document.createElement('div');
        row.className = 'l-row';
        row.innerHTML = '<div class="top"><span class="lbl"></span><span class="val"><b>0</b><small>0%</small></span></div>' +
          '<div class="track"><div class="fill"></div></div>';
        row._shown = 0;
        barsEl.appendChild(row);
        rows[p.id] = row;
      }
      const color = BAR_COLORS[i % BAR_COLORS.length];
      row.style.color = color;
      row.querySelector('.fill').style.backgroundColor = color;
      row.querySelector('.lbl').textContent = p.label;
    });

    let empty = barsEl.querySelector('.l-empty');
    if (!list.length) {
      if (!empty) barsEl.insertAdjacentHTML('beforeend', '<div class="l-empty">Belum ada pilihan.</div>');
      return;
    }
    if (empty) empty.remove();

    const total = data.total;
    const max = Math.max(0, ...list.map(p => p.jumlah));
    const closed = data.sesi.status === 'ditutup' && total > 0 && !pref.hide;
    list.forEach(p => {
      const row = rows[p.id];
      const pct = total ? (p.jumlah * 100 / total) : 0;
      // Lebar bar relatif terhadap pilihan terbanyak agar perbedaan terlihat jelas di layar.
      row.querySelector('.fill').style.width = (max ? (p.jumlah * 100 / max) : 0) + '%';
      animateNumber(row.querySelector('.val b'), row._shown, p.jumlah);
      row._shown = p.jumlah;
      row.querySelector('.val small').textContent = (Math.round(pct * 10) / 10) + '%';
      row.classList.toggle('win', closed && p.jumlah === max);
      row.classList.toggle('dim', closed && p.jumlah !== max);
    });

    layout();
  }

  /** Atur posisi baris; urutan berubah dengan animasi geser. */
  function layout() {
    if (!data) return;
    const list = data.pilihan.slice();
    if (pref.sort && !pref.hide) list.sort((a, b) => b.jumlah - a.jumlah || a.label.localeCompare(b.label));
    const H = barsEl.clientHeight;
    const slot = Math.min(H / Math.max(list.length, 1), 170);
    barsEl.style.setProperty('--rh', (slot * 0.86) + 'px');
    list.forEach((p, i) => {
      const row = rows[p.id];
      if (row) row.style.transform = `translateY(${i * slot}px)`;
    });
  }

  function animateNumber(el, from, to) {
    cancelAnimationFrame(el._raf);
    clearTimeout(el._end);
    if (from === to) { el.textContent = to; return; }
    const start = performance.now();
    const dur = 700;
    // Pastikan angka akhir tetap tampil walau animasi tertunda (tab di latar belakang).
    el._end = setTimeout(() => { cancelAnimationFrame(el._raf); el.textContent = to; }, dur + 100);
    const step = now => {
      const k = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * eased);
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  // ---------- Kontrol ----------
  function applyPref() {
    body.classList.toggle('l-hide', pref.hide);
    document.querySelectorAll('#ctrl [data-k]').forEach(b => {
      const k = b.dataset.k;
      b.classList.toggle('on', (k === 'h' && pref.hide) || (k === 's' && pref.sort) || (k === 'q' && !pref.qr) || (k === 'f' && !!document.fullscreenElement));
    });
    if (data) render();
  }

  function command(k) {
    if (k === 'h') pref.hide = !pref.hide;
    else if (k === 's') pref.sort = !pref.sort;
    else if (k === 'q') pref.qr = !pref.qr;
    else if (k === 'f') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
      return;
    } else return;
    savePref();
    applyPref();
  }

  $('ctrl').addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (b) command(b.dataset.k);
  });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    command(e.key.toLowerCase());
  });
  document.addEventListener('fullscreenchange', applyPref);

  // Tombol kontrol & kursor muncul saat mouse bergerak, hilang sendiri agar layar bersih.
  let idleTimer;
  document.addEventListener('mousemove', () => {
    $('ctrl').classList.add('show');
    body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { $('ctrl').classList.remove('show'); body.classList.add('idle'); }, 2500);
  });

  window.addEventListener('resize', () => requestAnimationFrame(layout));

  applyPref();
  if (!kode) {
    $('judul').textContent = '';
    $('tanya').textContent = 'Link layar hasil tidak lengkap. Buka dari halaman admin.';
  } else {
    poll();
  }
})();
