/* Aplikasi Net Plan: daftar event, editor denah, daftar perangkat, topologi, pengaturan proyek, cetak. */
(function () {
  'use strict';
  const { TYPES, TYPE_ORDER, STATUS, MEDIA, KONEKSI, api, esc, toast, progres, copy, downloadBlob, downloadCsv, fmtBw, fmtM, fmtDate, slug } = NP;
  const API = 'api/admin.php';
  const $ = (s, root) => (root || document).querySelector(s);
  const $$ = (s, root) => [...(root || document).querySelectorAll(s)];
  const qs = new URLSearchParams(location.search);
  // ?lihat=KODE = link lihat-saja; ?tim=TOKEN = link akses tim (lihat + update status sesuai izin).
  // Keduanya mode non-admin: S.lihat terisi agar seluruh tampilan baca-saja berlaku.
  const timToken = qs.get('tim');
  const lihatKode = qs.get('lihat') || timToken;
  const S = {
    lihat: lihatKode,
    tim: timToken,
    akses: null, // izin link tim: {nama, peran, status_boleh, jenis_boleh, lihat_password}
    lapisan: 'semua', // layer jaringan yang ditampilkan di peta / daftar / topologi ('semua' atau id layer)
    foto: [], // foto bukti pemasangan event ini: [{id, perangkat_id, lat, lng, akurasi_m, diambil_at, oleh, akses_id}]
    canEdit: !lihatKode,
    proyek: null,
    list: [],
    model: null,
    tab: 'denah',
    sel: null,
    parentCtx: null, // perangkat induk bawaan saat menaruh perangkat baru
    sort: { k: 'jenis', dir: 1 },
    loadedAt: 0,
    katalog: [], // item katalog perangkat (admin: semua; lihat-saja: yang dipakai event ini)
    katalogBasi: false, // katalog diubah di halaman Katalog -> muat ulang saat kembali ke editor
    epTipe: null, // tipe endpoint yang dipakai saat menaruh endpoint baru
    pilih: new Set(), // perangkat terpilih di Daftar perangkat (aksi massal)
    urutDaftar: [], // urutan baris Daftar saat ini (untuk Shift+klik)
  };

  // ======================================================================== simpan (antrean berurutan)

  let chain = Promise.resolve();
  let pending = 0;
  const pendingById = new Map();

  function setSaveState(s) {
    const el = $('#save-state');
    el.className = 'save-state ' + s;
    el.textContent = { saving: 'Menyimpan…', saved: 'Tersimpan ✓', error: 'Gagal menyimpan', '': '' }[s];
  }

  /** Jalankan request secara berurutan (perubahan cepat beruntun tidak saling menimpa). */
  function enqueue(fn) {
    pending++;
    setSaveState('saving');
    const p = chain.then(fn);
    chain = p.catch(() => {}).then(() => {
      pending--;
      if (!pending && !$('#save-state').classList.contains('error')) setSaveState('saved');
    });
    return p;
  }

  // ======================================================================== riwayat ubah (Ctrl+Z / Ctrl+Y)

  const hist = { undo: [], redo: [], grup: null, sibuk: false };
  const salin = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

  /** Catat satu langkah {label, undo, redo}. Langkah di dalam kelompok() digabung jadi satu. */
  function catat(langkah) {
    if (hist.sibuk || !S.canEdit) return;
    if (hist.grup) return void hist.grup.push(langkah);
    hist.undo.push(langkah);
    if (hist.undo.length > 100) hist.undo.shift();
    hist.redo.length = 0;
    syncRiwayat();
  }

  /** Jalankan fn; semua perubahan di dalamnya dibatalkan/diulang sekaligus. */
  async function kelompok(label, fn) {
    const g = hist.grup = [];
    try {
      return await fn();
    } finally {
      hist.grup = null;
      if (g.length) {
        catat({
          label,
          undo: async () => { for (const l of g.slice().reverse()) await l.undo(); },
          redo: async () => { for (const l of g) await l.redo(); },
        });
      }
    }
  }

  async function jalankanRiwayat(arah) {
    if (!S.canEdit || hist.sibuk) return;
    const dari = arah === 'undo' ? hist.undo : hist.redo;
    const ke = arah === 'undo' ? hist.redo : hist.undo;
    const l = dari.pop();
    if (!l) return toast(arah === 'undo' ? 'Tidak ada perubahan untuk dibatalkan' : 'Tidak ada perubahan untuk diulang');
    hist.sibuk = true;
    try {
      await l[arah]();
      ke.push(l);
      toast((arah === 'undo' ? 'Dibatalkan: ' : 'Diulang: ') + l.label);
    } catch (e) {
      // Data di server sudah berbeda (mis. diubah dari perangkat lain): riwayat tidak lagi bisa dipercaya.
      setSaveState('error');
      toast(e.message || 'Gagal membatalkan', true);
      reloadProyek();
      hist.undo.length = 0;
      hist.redo.length = 0;
    } finally {
      hist.sibuk = false;
      syncRiwayat();
    }
  }

  function resetRiwayat() {
    hist.undo.length = 0;
    hist.redo.length = 0;
    syncRiwayat();
  }

  function syncRiwayat() {
    const u = $('#btn-undo'), r = $('#btn-redo');
    if (!u) return;
    const lu = hist.undo[hist.undo.length - 1], lr = hist.redo[hist.redo.length - 1];
    u.disabled = !lu;
    r.disabled = !lr;
    u.title = lu ? `Batalkan: ${lu.label} (Ctrl+Z)` : 'Batalkan (Ctrl+Z)';
    r.title = lr ? `Ulangi: ${lr.label} (Ctrl+Y)` : 'Ulangi (Ctrl+Y)';
  }

  function labelUbah(d, patch) {
    if ('x' in patch) return 'geser ' + d.nama;
    if ('uplink_id' in patch) return 'koneksi ' + d.nama;
    if ('jalur' in patch) return 'jalur kabel ' + d.nama;
    if ('nama' in patch) return `nama ${d.nama} → ${patch.nama}`;
    if ('status' in patch) return 'status ' + d.nama;
    return 'ubah ' + d.nama;
  }

  /** Simpan sebagian isian perangkat (optimistis: tampilan diperbarui dulu). */
  function saveDev(id, patch, opts) {
    opts = opts || {};
    const d = S.model.byId.get(id);
    if (!d) return Promise.resolve();
    if (!opts.noHistory) {
      const sebelum = {};
      for (const k in patch) sebelum[k] = salin(d[k]);
      const sesudah = salin(patch);
      if (JSON.stringify(sebelum) !== JSON.stringify(sesudah)) {
        catat({
          label: labelUbah(d, patch),
          undo: () => saveDev(id, sebelum, { noHistory: true }),
          redo: () => saveDev(id, sesudah, { noHistory: true }),
        });
      }
    }
    Object.assign(d, patch);
    refreshModel(opts);
    pendingById.set(id, (pendingById.get(id) || 0) + 1);
    return enqueue(() => api(API, Object.assign({ action: 'perangkat_save', id }, patch)))
      .then(res => {
        const n = pendingById.get(id) - 1;
        pendingById.set(id, n);
        if ('status' in patch) riwayat.id = null; // riwayat status perangkat ini dimuat ulang
        // Terapkan versi server hanya bila tidak ada perubahan lain yang masih antre untuk perangkat ini.
        if (!n) {
          const i = S.list.findIndex(x => x.id === id);
          if (i >= 0) {
            S.list[i] = res.perangkat;
            refreshModel({ keepPanel: true });
          }
        }
        return res.perangkat;
      })
      .catch(err => {
        pendingById.set(id, (pendingById.get(id) || 1) - 1);
        setSaveState('error');
        toast(err.message, true);
        reloadProyek();
        throw err;
      });
  }

  // ======================================================================== data

  function refreshModel(opts) {
    opts = opts || {};
    S.model = NP.Model.create(S.proyek, S.list, S.katalog);
    if (S.sel != null && !S.model.byId.has(S.sel)) S.sel = null;
    if (S.parentCtx != null && !S.model.byId.has(S.parentCtx)) S.parentCtx = null;
    if (!S.model.lantaiList().some(l => l.id === S.lantai)) S.lantai = 'F1';
    peta.setData(S.model, denahUrl(S.lantai), lantaiAktif());
    terapkanLantai();
    terapkanAnot();
    terapkanLapisan();
    peta.select(S.sel);
    if (S.tab === 'denah') {
      if (opts.keepPanel) renderPanelInfo();
      else renderPanel();
    } else {
      renderTab();
    }
    updateHint();
  }

  /** URL gambar denah lantai lid (default F1 = denah utama) atau null bila lantai itu belum punya denah. */
  function denahUrl(lid) {
    const p = S.proyek;
    if (!p) return null;
    const L = lid && lid !== 'F1' ? (p.lantai || []).find(l => l.id === lid) : null;
    const v = lid && lid !== 'F1' ? L && L.denah_v : p.denah_v;
    if (!v) return null;
    const q = `v=${v}${L ? '&lantai=' + encodeURIComponent(L.id) : ''}`;
    if (S.tim) return `api/denah.php?t=${encodeURIComponent(S.tim)}&${q}`;
    return S.lihat
      ? `api/denah.php?k=${encodeURIComponent(S.lihat)}&${q}`
      : `api/denah.php?id=${p.id}&${q}`;
  }

  async function loadProyek(id) {
    const res = S.tim
      ? await api('api/tim.php?t=' + encodeURIComponent(S.tim))
      : S.lihat
        ? await api('api/lihat.php?k=' + encodeURIComponent(S.lihat))
        : await api(API + '?action=get&id=' + id);
    if (res.akses) S.akses = res.akses;
    if (isInstaller() && !$('#toolbar .usul')) buildToolbar(); // alat usulan baru tahu kategori tugas setelah akses dimuat
    const changed = !S.proyek || S.proyek.id !== res.proyek.id;
    S.proyek = res.proyek;
    S.list = res.perangkat;
    S.loadedAt = Date.now();
    S.foto = res.foto || [];
    S.unit = res.unit || []; // unit gudang yang dipakai perangkat event ini
    NP.setEndpointTipe(res.endpoint_tipe);
    if (S.lihat) {
      S.katalog = res.katalog || [];
    } else if (changed || S.katalogBasi || !S.katalog.length) {
      await muatKatalog();
    }
    if (changed) {
      S.sel = null;
      S.parentCtx = null;
      S.anotSel = null;
      resetRiwayat();
      // Layer jaringan terakhir yang dipilih di event ini.
      try { S.lapisan = localStorage.getItem(kunciLapisan()) || 'semua'; } catch (err) { S.lapisan = 'semua'; }
      try { S.lantai = localStorage.getItem(kunciLantai()) || 'F1'; } catch (err) { S.lantai = 'F1'; }
    }
    return changed;
  }

  /** Katalog lengkap (admin). Gagal memuat katalog tidak menghalangi editor. */
  async function muatKatalog() {
    try {
      S.katalog = await NP.Katalog.load(S.proyek && S.proyek.id);
      S.katalogBasi = false;
    } catch (e) {
      S.katalog = S.katalog || [];
    }
  }

  async function reloadProyek() {
    if (!S.proyek) return;
    try {
      const sig = JSON.stringify([S.proyek, S.list]);
      await loadProyek(S.proyek.id);
      if (JSON.stringify([S.proyek, S.list]) !== sig) refreshModel({ keepPanel: true });
      renderCrumb();
    } catch (e) {
      if (e.status === 401) return showLogin();
    }
  }

  // Perbarui data saat kembali ke tab browser (mis. diubah dari perangkat lain) dan berkala di mode lihat.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.proyek && !pending && Date.now() - S.loadedAt > 20000) reloadProyek();
  });
  if (S.lihat) {
    setInterval(() => {
      if (document.visibilityState === 'visible' && S.proyek) reloadProyek();
    }, 30000);
  }

  // ======================================================================== login & routing

  async function boot() {
    document.body.classList.toggle('mode-lihat', !!S.lihat);
    buildToolbar();
    buildFilters();
    if (S.lihat) {
      try {
        await loadProyek();
      } catch (e) {
        document.body.innerHTML = `<div class="state-page"><h2>Link tidak bisa dibuka</h2><p>${esc(e.message)}</p></div>`;
        return;
      }
      peta.setEditable(false);
      // Link tim yang boleh update status: kolom centang & ubah status massal di Daftar perangkat.
      document.body.classList.toggle('boleh-status', bolehStatus());
      isiPilihanStatus();
      showEditor();
      return;
    }
    $('#btn-logout').hidden = false;
    try {
      const me = await api(API + '?action=me');
      if (!me.login) return showLogin();
      setPeran(me.peran, me.proyek);
    } catch (e) {
      toast(e.message, true);
      return;
    }
    route();
  }

  /** Peran login: 'super' (admin utama) atau 'event' (admin event, hanya event tertentu). */
  function setPeran(peran, proyek) {
    S.peran = peran || 'super';
    S.proyekBoleh = proyek || [];
    $('#btn-akun').hidden = false;
    // Tombol khusus admin utama (buat/hapus/duplikat event, ubah katalog & tipe endpoint) disembunyikan;
    // server tetap menolak aksi tersebut untuk admin event.
    document.body.classList.toggle('peran-event', S.peran === 'event');
  }

  // Ganti password login: admin utama -> password admin utama; admin event -> password admin event-nya.
  $('#btn-akun').addEventListener('click', () => {
    const f = $('#form-akun');
    f.reset();
    $('#akun-err').hidden = true;
    $('#akun-info').innerHTML = S.peran === 'event'
      ? 'Password <b>admin event</b> yang Anda pakai login. Login lain dengan password lama langsung keluar.'
      : 'Password <b>admin utama</b> (berlaku untuk semua event). Login admin utama lain dengan password lama langsung keluar. Lupa? Jalankan <span class="mono">php net-plan/api/reset-admin.php</span> lewat SSH.';
    $('#dlg-akun').showModal();
    f.elements.lama.focus();
  });
  $('#form-akun [data-close]').addEventListener('click', () => $('#dlg-akun').close());
  $('#form-akun').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const err = $('#akun-err');
    err.hidden = true;
    if (f.elements.baru.value !== f.elements.ulang.value) {
      err.textContent = 'Ulangan password baru tidak sama';
      err.hidden = false;
      return;
    }
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      if (S.peran === 'event') {
        // Admin event: password semua event yang terbuka dengan login ini (biasanya satu event).
        for (const id of S.proyekBoleh) {
          await api(API, { action: 'proyek_password', id, password: f.elements.baru.value, lama: f.elements.lama.value });
        }
      } else {
        await api(API, { action: 'admin_password', lama: f.elements.lama.value, baru: f.elements.baru.value });
      }
      $('#dlg-akun').close();
      toast('Password diganti. Login berikutnya memakai password baru.');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  function showLogin() {
    $('#login').hidden = false;
    setTimeout(() => $('#login-pass').focus(), 50);
  }

  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    $('#login-err').hidden = true;
    try {
      const res = await api(API, { action: 'login', password: $('#login-pass').value });
      $('#login').hidden = true;
      $('#login-pass').value = '';
      setPeran(res.peran, res.proyek);
      // Admin satu event: langsung buka eventnya.
      if (res.peran === 'event' && res.proyek.length === 1 && !location.hash.startsWith('#/p/')) location.hash = `#/p/${res.proyek[0]}/denah`;
      else route();
    } catch (err) {
      $('#login-err').textContent = err.message;
      $('#login-err').hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    await api(API, { action: 'logout' }).catch(() => {});
    location.hash = '#/';
    location.reload();
  });

  window.addEventListener('hashchange', () => {
    if (!S.lihat) route();
  });

  /** #/ = daftar event, #/p/ID[/tab] = editor. */
  async function route() {
    if (/^#\/katalog/.test(location.hash)) return showKatalog();
    const m = location.hash.match(/^#\/p\/(\d+)(?:\/(\w+))?/);
    if (!m) {
      S.proyek = null;
      showHome();
      return;
    }
    const id = +m[1];
    const tab = ['denah', 'daftar', 'topologi', 'support', 'ceklis', 'port', 'proyek'].includes(m[2]) ? m[2] : 'denah';
    try {
      if (!S.proyek || S.proyek.id !== id) await loadProyek(id);
      else if (S.katalogBasi) await muatKatalog();
    } catch (e) {
      if (e.status === 401) return showLogin();
      toast(e.message, true);
      location.hash = '#/';
      return;
    }
    S.tab = tab;
    showEditor();
  }

  function go(tab) {
    if (S.lihat) {
      S.tab = tab;
      showEditor();
    } else {
      location.hash = `#/p/${S.proyek.id}/${tab}`;
    }
  }

  // ======================================================================== daftar event

  /** Halaman katalog perangkat (#/katalog). */
  async function showKatalog() {
    $('#editor').hidden = true;
    $('#home').hidden = true;
    $('#katalog-page').hidden = false;
    $('#btn-print').hidden = true;
    $('#save-state').textContent = '';
    document.title = 'Katalog perangkat — Net Plan';
    $('#crumb').innerHTML = '<a href="#/" title="Semua event"><span class="hide-phone">Semua event</span><span class="show-phone">←</span></a><span class="sep hide-phone">/</span><b>Katalog perangkat</b>';
    try {
      // Tipe endpoint dipakai di isian konfigurasi standar kategori Endpoint.
      if (!NP.ET.length) NP.setEndpointTipe((await api(API + '?action=endpoint_tipe_list')).endpoint_tipe);
      await NP.Katalog.show(list => {
        S.katalog = list;
        S.katalogBasi = true;
      });
    } catch (e) {
      if (e.status === 401) showLogin();
    }
  }

  async function showHome() {
    $('#editor').hidden = true;
    $('#katalog-page').hidden = true;
    $('#home').hidden = false;
    $('#btn-print').hidden = true;
    $('#save-state').textContent = '';
    document.title = 'Net Plan — Perencanaan Jaringan Event';
    renderCrumb();
    const grid = $('#proj-grid');
    grid.innerHTML = '<p class="muted">Memuat…</p>';
    let res;
    try {
      res = await api(API + '?action=list');
    } catch (e) {
      if (e.status === 401) return showLogin();
      grid.innerHTML = `<p class="err-text">${esc(e.message)}</p>`;
      return;
    }
    if (!res.proyek.length) {
      grid.innerHTML = `<div class="empty-big"><b>Belum ada event.</b><br>Klik <b>+ Event baru</b>, upload denah venue, lalu taruh titik-titik jaringannya.</div>`;
      return;
    }
    grid.innerHTML = res.proyek.map(p => `
      <div class="proj-wrap">
        <a class="proj-card" href="#/p/${p.id}">
          <div class="thumb">${p.denah_v ? `<img src="api/denah.php?id=${p.id}&v=${p.denah_v}" alt="" loading="lazy">` : '<span>Belum ada denah</span>'}</div>
          <div class="info">
            <b>${esc(p.nama)}</b>
            <span class="muted">${esc(p.venue || '—')}</span>
            <span class="meta">${p.tanggal_mulai ? esc(fmtDate(p.tanggal_mulai)) + (p.tanggal_selesai && p.tanggal_selesai !== p.tanggal_mulai ? ' – ' + esc(fmtDate(p.tanggal_selesai)) : '') + ' · ' : ''}${p.jumlah} perangkat</span>
          </div>
        </a>
        <button type="button" class="card-del" data-del="${p.id}" data-nama="${esc(p.nama)}" data-jumlah="${p.jumlah}" title="Hapus event" aria-label="Hapus event ${esc(p.nama)}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
        </button>
      </div>`).join('');
  }

  $('#proj-grid').addEventListener('click', async e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    e.preventDefault();
    if (await hapusEvent(+b.dataset.del, b.dataset.nama, +b.dataset.jumlah)) showHome();
  });

  $('#btn-new').addEventListener('click', () => openProyekDialog(null));

  // Backup semua event (+ seluruh katalog & tipe endpoint) ke satu file, dan pulihkan dari file.
  $('#btn-backup-semua').addEventListener('click', async () => {
    try {
      const ids = (await api(API + '?action=list')).proyek.map(p => p.id);
      if (!ids.length) return toast('Belum ada event untuk di-backup', true);
      await NP.Backup.buat(ids, 'netplan-semua', true);
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('#btn-pulihkan').addEventListener('click', () => $('#file-pulihkan').click());
  $('#file-pulihkan').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const hasil = await NP.Backup.pulihkan(file);
      S.katalogBasi = true;
      toast(`${hasil.length} event dipulihkan: ${hasil.map(p => p.nama).join(', ')}`);
      if (hasil.length === 1) location.hash = `#/p/${hasil[0].id}/denah`;
      else showHome();
    } catch (err) {
      toast(err.message, true);
      showHome();
    }
  });

  let editingProyek = false;
  /** Password acak mudah dibaca, mis. "kq7m-x3pt-9hwa" (tanpa huruf/angka yang mirip). */
  function buatPassword() {
    const huruf = 'abcdefghjkmnpqrstuvwxyz23456789';
    const acak = crypto.getRandomValues(new Uint32Array(12));
    return [0, 4, 8].map(i => Array.from(acak.slice(i, i + 4), n => huruf[n % huruf.length]).join('')).join('-');
  }

  // Tombol di isian password: lihat / acak / salin (dialog event baru & kartu password admin event).
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-pw]');
    if (!b) return;
    const inp = b.closest('.inline').querySelector('input');
    if (b.dataset.pw === 'lihat') inp.type = inp.type === 'password' ? 'text' : 'password';
    else if (b.dataset.pw === 'acak') {
      inp.value = buatPassword();
      inp.type = 'text';
      // Dialog ganti password: isian "ulangi" ikut diisi agar langsung cocok.
      const ulang = inp.form && inp.form.elements.ulang;
      if (ulang) {
        ulang.value = inp.value;
        ulang.type = 'text';
      }
    } else if (b.dataset.pw === 'salin' && inp.value) copy(inp.value);
  });

  function openProyekDialog(p) {
    editingProyek = !!p;
    const dlg = $('#dlg-proyek');
    const f = $('#form-proyek');
    f.reset();
    $('#dlg-proyek-title').textContent = p ? 'Ubah event' : 'Event baru';
    $$('.new-only', f).forEach(e => { e.hidden = !!p; });
    if (p) ['nama', 'venue', 'tanggal_mulai', 'tanggal_selesai'].forEach(k => { f.elements[k].value = p[k] || ''; });
    if (!p) {
      // Event baru: langsung disiapkan password admin event acak (boleh diganti / dikosongkan).
      f.elements.password.value = buatPassword();
      f.elements.password.type = 'password';
    }
    dlg.showModal();
    f.elements.nama.focus();
  }

  $('#form-proyek [data-close]').addEventListener('click', () => $('#dlg-proyek').close());
  $('#form-proyek').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    const body = { action: 'proyek_save' };
    ['nama', 'venue', 'tanggal_mulai', 'tanggal_selesai'].forEach(k => { body[k] = f.elements[k].value; });
    const editing = editingProyek;
    if (editing) {
      Object.assign(body, { id: S.proyek.id, catatan: S.proyek.catatan, slack_kabel: S.proyek.slack_kabel });
    } else if (f.elements.password.value) {
      body.password = f.elements.password.value;
    }
    btn.disabled = true;
    try {
      // Denah PDF diubah jadi gambar dulu, agar event tidak terlanjur dibuat bila PDF gagal dibaca / dibatalkan.
      const file = !editing && f.elements.denah.files[0] ? await siapkanDenah(f.elements.denah.files[0]) : null;
      const res = await api(API, body);
      if (file) await uploadDenah(res.proyek.id, file, false);
      $('#dlg-proyek').close();
      if (!editing && body.password) {
        // Password hanya disimpan sebagai hash: tampilkan sekali lagi agar bisa dicatat.
        prompt(`Event "${res.proyek.nama}" dibuat.\n\nPassword admin event (salin & simpan — tidak bisa dilihat lagi; bisa diganti di tab Proyek):`, body.password);
      }
      if (editing) {
        S.proyek = res.proyek;
        renderCrumb();
        renderTab();
      } else {
        location.hash = `#/p/${res.proyek.id}/denah`;
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  /**
   * File denah siap upload: gambar dikirim apa adanya; PDF (denah arsitek / CAD yang diekspor ke PDF) dirender di browser
   * dengan pdf.js menjadi gambar. PDF lebih dari 1 halaman: pilih halamannya. Sisi terpanjang ±6000 px (tajam saat
   * di-zoom), dibatasi 100 MP agar muat di kanvas browser. PNG (garis tajam); JPEG bila PNG terlalu besar.
   */
  async function siapkanDenah(file) {
    if (!file || !(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) return file;
    progres.buka('Mengubah PDF menjadi gambar', 'Memuat pembaca PDF…');
    let pdf = null;
    try {
      await muatSkrip('vendor/pdf.min.js?v=3.11.174');
      const lib = window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js?v=3.11.174';
      progres.set(10, 'Membaca file PDF…');
      pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
      const jml = pdf.numPages;
      let no = 1;
      if (jml > 1) {
        progres.tutup();
        const j = prompt(`PDF berisi ${jml} halaman. Halaman berapa yang dipakai sebagai denah? (1–${jml})`, '1');
        if (j == null) throw new Error('Upload denah dibatalkan');
        no = Math.min(jml, Math.max(1, parseInt(j, 10) || 1));
        progres.buka('Mengubah PDF menjadi gambar');
      }
      progres.set(25, `Merender halaman ${no}${jml > 1 ? ' dari ' + jml : ''}…`);
      const page = await pdf.getPage(no);
      const v1 = page.getViewport({ scale: 1 });
      let scale = 6000 / Math.max(v1.width, v1.height);
      const MAKS_AREA = 100e6;
      if (v1.width * v1.height * scale * scale > MAKS_AREA) scale = Math.sqrt(MAKS_AREA / (v1.width * v1.height));
      const vp = page.getViewport({ scale });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width);
      cv.height = Math.round(vp.height);
      const g = cv.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      progres.set(85, `Menyimpan gambar ${cv.width} × ${cv.height} px…`);
      await progres.jeda();
      let blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      if (!blob || blob.size > 10 * 1024 * 1024) blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9));
      if (!blob) throw new Error('PDF gagal diubah menjadi gambar (halaman terlalu besar untuk browser ini)');
      progres.set(100, 'Selesai');
      const nama = file.name.replace(/\.pdf$/i, '') + (jml > 1 ? '-hal' + no : '') + (blob.type === 'image/png' ? '.png' : '.jpg');
      return new File([blob], nama, { type: blob.type });
    } catch (e) {
      throw new Error(e && e.name === 'PasswordException' ? 'PDF dilindungi password — buka kuncinya dulu' : (e && e.message) || 'PDF tidak bisa dibaca');
    } finally {
      if (pdf) pdf.destroy();
      progres.tutup();
    }
  }

  async function uploadDenah(id, file, sesuaikan) {
    file = await siapkanDenah(file);
    const fd = new FormData();
    fd.append('action', 'denah_upload');
    fd.append('id', id);
    fd.append('sesuaikan', sesuaikan ? '1' : '0');
    fd.append('denah', file);
    toast('Mengunggah denah…');
    return api(API, fd);
  }

  function renderCrumb() {
    const c = $('#crumb');
    if (!S.proyek) {
      c.innerHTML = '';
      return;
    }
    const p = S.proyek;
    c.innerHTML = `${S.lihat ? '' : '<a href="#/" title="Semua event"><span class="hide-phone">Semua event</span><span class="show-phone">←</span></a><span class="sep hide-phone">/</span>'}
      <b>${esc(p.nama)}</b>${p.venue ? `<span class="muted"> · ${esc(p.venue)}</span>` : ''}
      ${S.tim && S.akses ? `<span class="badge">${esc(S.akses.nama)} · ${S.akses.peran === 'status' ? 'update status' : S.akses.peran === 'installer' ? 'installer' : S.akses.peran === 'cek' ? 'checker' + progresCekTxt() : 'lihat saja'}</span>` : S.lihat ? '<span class="badge">Lihat saja</span>' : ''}`;
    document.title = p.nama + ' — Net Plan';
  }

  // ======================================================================== editor

  function showEditor() {
    $('#home').hidden = true;
    $('#katalog-page').hidden = true;
    $('#editor').hidden = false;
    $('#btn-print').hidden = false;
    renderCrumb();
    $$('#tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === S.tab);
      if (S.lihat && b.dataset.tab === 'proyek') b.textContent = 'Info';
    });
    $$('.tab-pane').forEach(p => { p.hidden = p.dataset.pane !== S.tab; });
    if (S.tab === 'denah') updateInset();
    refreshModel();
    if (S.tab === 'denah') requestAnimationFrame(() => peta.refresh());
  }

  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) go(b.dataset.tab);
  });

  function renderTab() {
    if (S.tab === 'daftar') renderDaftar();
    else if (S.tab === 'topologi') renderTopologi();
    else if (S.tab === 'support') renderSupport();
    else if (S.tab === 'ceklis') renderCeklisPage();
    else if (S.tab === 'port') renderPortPage();
    else if (S.tab === 'proyek') renderProyek();
  }

  // ------------------------------------------------------------------------ peta

  const peta = NP.Peta($('#map'), {
    onSelect(id) {
      if (id == null && S.anotSel != null) S.anotSel = null; // klik area kosong: lepas label juga
      selectDev(id, false);
    },
    onHover(id, x, y) {
      kartuHover(id, x, y);
    },
    onKonteks(target, x, y) {
      if (target.id != null) menuPerangkat(target.id, x, y);
      else menuLabel(target.anot, x, y);
    },
    // Label & panah (anotasi): peta sudah mengubah objek label saat digeser; app hanya menyimpan.
    onAnotBaru(a) {
      if (!S.canEdit) return;
      buatAnot(a);
    },
    onAnot() {
      simpanAnot();
      if (S.anotSel != null) renderPanel(); // "Panah ke" ikut perangkat tempat ujung panah dilepas
    },
    onAnotSelect(id) {
      pilihAnot(id);
    },
    onAnotEdit(id) {
      pilihAnot(id, true);
    },
    onPlace(jenis, x, y) {
      if (isInstaller()) return bukaUsulan(jenis, x, y);
      addDev(jenis, x, y);
    },
    // Peta sudah mengubah posisi/arah/jalur selama drag; kembalikan nilai awal dulu agar saveDev mencatat
    // "sebelum" yang benar untuk Ctrl+Z.
    onMove(id, x, y, ox, oy) {
      const d = S.model.byId.get(id);
      if (d && ox != null) Object.assign(d, { x: ox, y: oy });
      saveDev(id, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }, { keepPanel: true }).catch(() => {});
    },
    onLink(childId, parentId) {
      linkDev(childId, parentId);
    },
    onUnlink(id) {
      putusKoneksi(id);
    },
    onAtribut(id, atribut, awal) {
      // Arah sektor AP diputar di denah -> isian "Arah sektor" di panel ikut diperbarui.
      const d = S.model.byId.get(id);
      if (d && awal !== undefined) d.atribut = awal;
      saveDev(id, { atribut }).catch(() => {});
    },
    onAtributLain(id, atribut, awal) {
      // Bentuk jalur sambungan tambahan (UP2 / WAN2) diubah di denah -> simpan atribut (bisa di-Ctrl+Z).
      const d = S.model.byId.get(id);
      if (d && awal !== undefined) d.atribut = awal;
      saveDev(id, { atribut }, { keepPanel: true, label: 'jalur kabel tambahan' }).catch(() => {});
    },
    onRoute(id, jalur, awal) {
      const d = S.model.byId.get(id);
      if (d && awal !== undefined) d.jalur = awal;
      saveDev(id, { jalur }, { keepPanel: true }).catch(() => {});
    },
    onKabel(id, x, y, lain) {
      // HP/tablet: panel bawah tetap ringkas agar popover status kabel tidak tertutup.
      if (mqSheet.matches) setSheet('peek');
      bukaKabelPop([id], x, y, lain);
    },
    onMeasure(pts) {
      renderPanel();
      if (pts.length === 2) openSheet();
    },
    onHint() {
      updateHint();
    },
  });

  function selectDev(id, center) {
    tutupKabelPop();
    S.sel = id;
    const d = id != null && S.model.byId.get(id);
    // Perangkat dari layer lain (mis. lewat pencarian): tampilkan layernya agar tidak tetap samar.
    if (d && !masukLapisan(d)) {
      S.lapisan = S.model.lapisanOf(d);
      try { localStorage.setItem(kunciLapisan(), S.lapisan); } catch (err) { /* abaikan */ }
      terapkanLapisan();
    }
    // Perangkat di lantai lain: pindah ke denah lantainya.
    if (d && multiLantai() && S.model.lantaiOf(d) !== S.lantai) {
      S.lantai = S.model.lantaiOf(d);
      try { localStorage.setItem(kunciLantai(), S.lantai); } catch (err) { /* abaikan */ }
      peta.setData(S.model, denahUrl(S.lantai), lantaiAktif());
      terapkanLantai();
      terapkanAnot();
    }
    if (d && TYPES[d.jenis] && TYPES[d.jenis].parent) S.parentCtx = id;
    peta.select(id);
    if (peta.tool !== 'ukur') renderPanel();
    panelIkutPilihan(id);
    if (id != null) openSheet();
    else if (mqSheet.matches) setSheet('peek');
    updateInset(); // ukuran layar bisa berubah (rotasi) sejak terakhir dihitung
    if (center && id != null) {
      peta.centerOn(id);
      peta.flash(id);
    } else if (id != null) {
      peta.ensureVisible(id);
    }
    updateHint();
  }

  /** Nama otomatis: AP-01, AP-02, ... (lanjut dari nomor terbesar). */
  function nextName(jenis, prefix) {
    const pre = prefix || (TYPES[jenis] || TYPES.lainnya).prefix;
    let max = 0;
    const re = new RegExp('^' + pre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-?(\\d+)$', 'i');
    for (const d of S.list) {
      const m = d.nama.match(re);
      if (m) max = Math.max(max, +m[1]);
    }
    return pre + '-' + String(max + 1).padStart(2, '0');
  }

  // ------------------------------------------------------------------------ tipe endpoint

  /** Tipe endpoint berubah: perbarui pemilih, panel, peta, dan daftar. */
  function epBerubah(list) {
    NP.setEndpointTipe(list);
    if (S.epTipe != null && !NP.ET.some(t => t.id === S.epTipe)) S.epTipe = null;
    renderEpRows();
    if (S.proyek && !$('#editor').hidden) refreshModel();
    renderEpPicker();
  }

  async function bukaKelolaEp() {
    if (S.lihat) return;
    try {
      const res = await api(API + '?action=endpoint_tipe_list');
      NP.setEndpointTipe(res.endpoint_tipe);
      epDipakai = new Map(res.endpoint_tipe.map(t => [t.id, t.dipakai]));
    } catch (e) {
      return toast(e.message, true);
    }
    renderEpRows();
    $('#dlg-ep').showModal();
  }
  let epDipakai = new Map();

  function ikonOptions(pilih) {
    return Object.keys(NP.IKON).map(k => `<option value="${k}"${k === (pilih || 'umum') ? ' selected' : ''}>${esc(NP.IKON[k].label)}</option>`).join('');
  }
  $('#ep-new-ikon').innerHTML = ikonOptions('umum');

  /**
   * Uplink endpoint baru: titik LAN yang sedang dipilih, atau titik LAN terdekat dari posisi klik.
   * Bila event belum punya titik LAN, pakai perangkat induk yang dipilih (mis. switch).
   */
  function lanUntukEndpoint(x, y) {
    const pilih = S.parentCtx != null && S.model.byId.get(S.parentCtx);
    if (pilih && NP.titikLan(pilih.jenis)) return { lan: pilih, cara: 'dipilih' };
    let best = null;
    for (const d of S.list) {
      if (!NP.titikLan(d.jenis) || (multiLantai() && S.model.lantaiOf(d) !== S.lantai)) continue; // titik LAN / port LAN gedung di lantai yang tampil
      const jarak = Math.hypot(d.x - x, d.y - y);
      if (!best || jarak < best.jarak) best = { lan: d, jarak };
    }
    return best ? { lan: best.lan, cara: 'terdekat' } : null;
  }

  /** Port terkecil yang belum dipakai perangkat lain di uplink tersebut (1, 2, 3, ...). */
  function portKosong(parentId) {
    const P = S.model.byId.get(parentId);
    // AP & wireless bridge: klien tersambung lewat radio, tanpa port.
    if (!P || P.jenis === 'ap' || P.jenis === 'bridge' || P.jenis === 'isp') return '';
    // Peta port diketahui: port kosong pertama (port WAN router sudah dicadangkan), gaya nama mengikuti (ether3 / 3).
    if (S.model.portMap(P).ports.length) return portKosong2(P)[0] || '';
    const pakai = new Set(S.model.kids(parentId).map(c => S.model.kunciPort(c.port_uplink)).filter(Boolean));
    S.model.portWan(P).forEach(w => pakai.add(S.model.kunciPort(w.port)));
    let n = 1;
    while (pakai.has('e' + n)) n++;
    return String(n);
  }

  /**
   * Media yang wajar untuk kabel anak -> uplink (aturan jaringan): klien AP = wireless, bridge ke bridge = wireless,
   * selain AP/bridge tidak punya radio = kabel. Pilihan fiber/lainnya yang sudah ada tetap dipakai.
   */
  function mediaWajar(jenis, P, sekarang) {
    if (!P) return sekarang || 'utp';
    const radio = P.jenis === 'ap' || P.jenis === 'bridge';
    if (P.jenis === 'ap' && !['switch', 'router', 'lan', 'lan_gedung', 'isp', 'ap'].includes(jenis)) return 'wireless';
    if (P.jenis === 'bridge' && jenis === 'bridge') return 'wireless';
    if (!radio && sekarang === 'wireless') return 'utp';
    return sekarang || 'utp';
  }

  function renderEpRows() {
    const box = $('#ep-rows');
    if (!box) return;
    box.innerHTML = NP.ET.length ? NP.ET.map(t => `<form class="ep-row" data-id="${t.id}" autocomplete="off">
        <input type="color" name="warna" value="${esc(t.warna)}" aria-label="Warna">
        <input type="text" name="nama" maxlength="60" value="${esc(t.nama)}" required aria-label="Nama tipe">
        <input type="text" name="singkatan" maxlength="4" value="${esc(t.singkatan)}" required aria-label="Singkatan">
        <input type="text" name="prefix" maxlength="12" value="${esc(t.prefix)}" aria-label="Prefix nama">
        <select name="ikon" aria-label="Ikon">${ikonOptions(t.ikon)}</select>
        <span class="ep-prev"><i style="background:${esc(t.warna)}">${NP.ikonSvg(t.ikon, 16)}</i><small class="muted">${epDipakai.get(t.id) || 0} dipakai</small></span>
        <button type="button" class="small danger" data-ep-del title="Hapus tipe">✕</button>
      </form>`).join('') : '<p class="muted">Belum ada tipe. Tambahkan di bawah.</p>';
  }

  async function simpanEp(form, id) {
    const f = form.elements;
    const body = { action: 'endpoint_tipe_save', id, nama: f.nama.value, singkatan: f.singkatan.value, warna: f.warna.value, prefix: f.prefix.value, ikon: f.ikon.value };
    try {
      const res = await api(API, body);
      epBerubah(res.endpoint_tipe);
      return true;
    } catch (err) {
      toast(err.message, true);
      return false;
    }
  }

  // Baris tipe: simpan otomatis saat isian berubah.
  $('#ep-rows').addEventListener('change', e => {
    const form = e.target.closest('.ep-row');
    if (form && form.reportValidity()) simpanEp(form, +form.dataset.id).then(ok => ok && toast('Tipe tersimpan'));
  });
  $('#ep-rows').addEventListener('submit', e => e.preventDefault());
  $('#ep-rows').addEventListener('click', async e => {
    const b = e.target.closest('[data-ep-del]');
    if (!b) return;
    const id = +b.closest('.ep-row').dataset.id;
    const t = NP.ET.find(x => x.id === id);
    if (!confirm(`Hapus tipe endpoint "${t.nama}"?`)) return;
    try {
      const res = await api(API, { action: 'endpoint_tipe_delete', id });
      epBerubah(res.endpoint_tipe);
      toast('Tipe dihapus');
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('#ep-new').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    if (await simpanEp(form, null)) {
      toast('Tipe ditambahkan');
      form.reset();
      form.elements.warna.value = '#ea580c';
    }
  });
  $('#dlg-ep [data-close]').addEventListener('click', () => $('#dlg-ep').close());
  $('#kat-ep').addEventListener('click', bukaKelolaEp);

  /** Pemilih tipe saat alat "Endpoint" aktif: tipe yang dipilih dipakai untuk endpoint berikutnya. */
  function renderEpPicker() {
    const el = $('#ep-picker');
    const aktif = peta.tool === 'tambah:endpoint';
    el.hidden = !aktif;
    if (!aktif) return;
    if (S.epTipe == null && NP.ET[0]) S.epTipe = NP.ET[0].id;
    el.innerHTML = `<span class="muted small">Tipe:</span>` + NP.ET.map(t =>
      `<button type="button" class="ep-chip${t.id === S.epTipe ? ' on' : ''}" data-ep="${t.id}"><i style="background:${esc(t.warna)}">${NP.ikonSvg(t.ikon, 14)}</i>${esc(t.nama)}</button>`).join('') +
      `<button type="button" class="ep-chip kelola super-only" data-ep-kelola>+ Kelola tipe</button>`;
  }
  $('#ep-picker').addEventListener('click', e => {
    if (e.target.closest('[data-ep-kelola]')) return bukaKelolaEp();
    const b = e.target.closest('[data-ep]');
    if (!b) return;
    S.epTipe = +b.dataset.ep;
    renderEpPicker();
    updateHint();
  });

  // ------------------------------------------------------------------------ penamaan per group
  // Group = perangkat sejenis yang terhubung ke uplink yang sama. Nama group disimpan di atribut perangkat
  // induknya (kunci "grup_<jenis>"), anggotanya dinamai <GROUP>-01, <GROUP>-02, ... urut port lalu nomor lama.

  const grupKey = jenis => 'grup_' + jenis;

  function grupNama(parentId, jenis) {
    const p = parentId != null && S.model.byId.get(parentId);
    return (p && p.atribut && p.atribut[grupKey(jenis)]) || '';
  }

  function grupAnggota(parentId, jenis) {
    const portNo = d => { const m = String(d.port_uplink || '').match(/\d+/); return m ? +m[0] : Infinity; };
    const tail = d => { const m = d.nama.match(/(\d+)\s*$/); return m ? +m[1] : Infinity; };
    return S.list.filter(d => d.uplink_id === parentId && d.jenis === jenis)
      .sort((a, b) => portNo(a) - portNo(b) || tail(a) - tail(b) || a.id - b.id);
  }

  const grupDasar = g => g.trim().replace(/[-\s]+$/, '');
  const grupLabel = (g, n) => grupDasar(g) + '-' + String(n).padStart(2, '0');
  const grupRe = g => new RegExp('^' + grupDasar(g).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$', 'i');

  /** Nama berikutnya di group = nomor terbesar yang sudah dipakai + 1. */
  function grupNext(g, kecualiId) {
    const re = grupRe(g);
    let max = 0;
    for (const d of S.list) {
      const m = d.id !== kecualiId && d.nama.match(re);
      if (m) max = Math.max(max, +m[1]);
    }
    return grupLabel(g, max + 1);
  }

  /** Nama untuk perangkat yang (akan) masuk ke group uplink tersebut, atau null bila group belum bernama / sudah sesuai. */
  function namaMasukGrup(d, parentId, jenis) {
    const g = grupNama(parentId, jenis || d.jenis);
    if (!g || grupRe(g).test(d.nama)) return null;
    return grupNext(g, d.id);
  }

  /** Rencana ganti nama agar anggota group berurutan 01, 02, ... */
  function grupRencana(parentId, jenis, g) {
    if (g == null) g = grupNama(parentId, jenis);
    if (!grupDasar(g)) return [];
    return grupAnggota(parentId, jenis).map((d, i) => ({ id: d.id, lama: d.nama, baru: grupLabel(g, i + 1) }))
      .filter(x => x.lama !== x.baru);
  }

  /** Rencana untuk semua group bernama di event ini. */
  function semuaRencana() {
    const out = [];
    for (const p of S.list) {
      for (const k of Object.keys(p.atribut || {})) {
        if (k.startsWith('grup_') && p.atribut[k]) out.push(...grupRencana(p.id, k.slice(5)));
      }
    }
    return out;
  }

  /** Simpan perubahan nama massal; notifikasi menyediakan tombol Batalkan. */
  async function terapkanNama(items, pesan, tanpaUndo, onUndo) {
    if (!items.length) return;
    try {
      await enqueue(() => api(API, { action: 'perangkat_rename', items: items.map(x => ({ id: x.id, nama: x.baru })) }));
      for (const x of items) {
        const d = S.model.byId.get(x.id);
        if (d) d.nama = x.baru;
      }
      refreshModel();
      if (!tanpaUndo) {
        const balik = items.map(x => ({ id: x.id, lama: x.baru, baru: x.lama }));
        catat({ label: pesan, undo: () => terapkanNama(balik, 'Nama dikembalikan', true), redo: () => terapkanNama(items, pesan, true) });
      }
      toast(pesan, false, tanpaUndo ? undefined : {
        label: 'Batalkan',
        fn: async () => {
          if (onUndo) await onUndo();
          terapkanNama(items.map(x => ({ id: x.id, lama: x.baru, baru: x.lama })), 'Nama dikembalikan', true);
        },
      });
    } catch (err) {
      setSaveState('error');
      toast(err.message, true);
      reloadProyek();
    }
  }

  /** Beri/ubah nama group lalu namai ulang anggotanya. Nama kosong = hapus nama group (nama perangkat tidak diubah). */
  async function setGrupNama(parentId, jenis, nama) {
    const p = S.model.byId.get(parentId);
    if (!p || !S.canEdit) return;
    nama = grupDasar(nama || '');
    if (nama.length > 40) return toast('Nama group maksimal 40 karakter', true);
    const atrLama = Object.assign({}, p.atribut);
    const atr = Object.assign({}, p.atribut);
    if (nama) atr[grupKey(jenis)] = nama;
    else delete atr[grupKey(jenis)];
    const rencana = grupRencana(parentId, jenis, nama);
    // Nama group + nama anggotanya = satu langkah Ctrl+Z.
    return kelompok('nama group ' + (nama || TYPES[jenis].label), () => grupSimpan(p, parentId, jenis, nama, atr, atrLama, rencana));
  }

  async function grupSimpan(p, parentId, jenis, nama, atr, atrLama, rencana) {
    try {
      await saveDev(parentId, { atribut: atr }, { keepPanel: true });
    } catch (e) {
      return;
    }
    if (!nama) return toast(`Nama group ${TYPES[jenis].label} di ${p.nama} dihapus`);
    if (!rencana.length) return toast(`Group ${nama} tersimpan — nama sudah berurutan`);
    // Batalkan = kembalikan nama perangkat dan nama group sebelumnya.
    await terapkanNama(rencana, `${rencana.length} perangkat dinamai ${grupLabel(nama, 1)} …`, false,
      () => saveDev(parentId, { atribut: atrLama }, { keepPanel: true, noHistory: true }).catch(() => {}));
  }

  /** Editor nama group untuk perangkat sejenis di bawah satu uplink. */
  function grupEditor(parentId, jenis) {
    const p = S.model.byId.get(parentId);
    const anggota = grupAnggota(parentId, jenis);
    const g = grupNama(parentId, jenis);
    // Perangkat sejenis yang belum punya uplink tidak termasuk group mana pun -> beri tahu agar tidak membingungkan.
    const lepas = S.list.filter(d => d.jenis === jenis && d.uplink_id == null).length;
    // Anggota yang namanya belum mengikuti group (mis. disambungkan sebelum fitur group / penamaan gagal).
    const belum = g ? grupRencana(parentId, jenis).length : 0;
    const t = TYPES[jenis] || TYPES.lainnya;
    const contoh = n => (g ? grupLabel(g, 1) + (n > 1 ? ' … ' + grupLabel(g, n) : '') : '');
    if (!S.canEdit) {
      return g ? `<div class="kv"><span>Group</span><b>${esc(g)} <span class="muted">(${anggota.length} ${esc(t.label)} di ${esc(p.nama)})</span></b></div>` : '';
    }
    return `<div class="grp" data-grup-parent="${parentId}" data-grup-jenis="${jenis}" data-n="${anggota.length}">
      <span class="route-lbl">Nama group · ${anggota.length} ${esc(t.label)} di ${esc(p.nama)}</span>
      <div class="inline"><input type="text" class="grup-input" value="${esc(g)}" maxlength="40" placeholder="mis. BOOTH-A" aria-label="Nama group">
        <button type="button" class="small" data-grup-apply>${g ? 'Ubah' : 'Terapkan'}</button></div>
      <p class="muted small grp-hint">${g ? `Anggota dinamai <b>${esc(contoh(anggota.length))}</b>, urut nomor port lalu nomor lama. Perangkat baru di sini otomatis lanjut nomornya.`
        : `Isi nama group agar ${anggota.length > 1 ? 'semua ' + anggota.length + ' ' : ''}${esc(t.label)} di ${esc(p.nama)} otomatis dinamai NAMA-01, NAMA-02, …`}</p>
      ${belum ? `<p class="note grp-belum">${belum} anggota belum mengikuti nama <b>${esc(g)}</b>. <button type="button" class="small" data-grup-apply>Rapikan sekarang</button></p>` : ''}
      ${lepas ? `<p class="note grp-lepas">${lepas} ${esc(t.label)} lain belum tersambung ke uplink mana pun, jadi tidak ikut group ini. Sambungkan dulu ke ${esc(p.nama)} (alat <b>Hubungkan</b> atau pilihan Uplink) agar ikut dinamai.</p>` : ''}
    </div>`;
  }

  async function addDev(jenis, x, y, base) {
    const parent = S.parentCtx != null && S.model.byId.get(S.parentCtx);
    // Endpoint langsung tersambung ke titik LAN (yang dipilih / terdekat); perangkat lain ke induk yang dipilih.
    const lanEp = jenis === 'endpoint' && !(base && base.uplink_id !== undefined) ? lanUntukEndpoint(x, y) : null;
    const uplinkId = base && base.uplink_id !== undefined ? base.uplink_id
      : lanEp ? lanEp.lan.id : (jenis !== 'isp' && NP.grupJenis(jenis) !== 'support' && parent && !NP.nonJaringan(parent) ? parent.id : null);
    const g = uplinkId != null ? grupNama(uplinkId, jenis) : '';
    // Endpoint: tipe dari perangkat yang diduplikat, atau tipe yang dipilih di pemilih tipe.
    const ep = jenis === 'endpoint'
      ? NP.tipeEp({ jenis, atribut: (base && base.atribut) || {} }) || NP.ET.find(t => t.id === S.epTipe) || NP.ET[0] || null
      : null;
    const body = Object.assign({
      action: 'perangkat_save',
      proyek_id: S.proyek.id,
      jenis,
      nama: g ? grupNext(g) : nextName(jenis, ep ? ep.prefix : null),
      uplink_id: uplinkId,
      media: jenis === 'isp' || NP.grupJenis(jenis) === 'support' ? '' : mediaWajar(jenis, uplinkId != null ? S.model.byId.get(uplinkId) : null, 'utp'),
      status: 'rencana',
      // Endpoint baru memakai tipe yang dipilih di pemilih tipe (Laptop, Printer, ...).
      atribut: ep ? { tipe_endpoint: String(ep.id) } : TYPES[jenis].listrik ? { fase: '1 fase' } : {},
      port_uplink: jenis === 'endpoint' && uplinkId != null ? portKosong(uplinkId) : '',
    }, base || {}, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    // Layer jaringan: ikut uplink-nya; tanpa uplink = layer yang sedang aktif di peta.
    if (S.model.lapisanList().length > 1) {
      const up = uplinkId != null && S.model.byId.get(uplinkId);
      const lid = up ? S.model.lapisanOf(up) : S.lapisan !== 'semua' ? S.lapisan : (body.atribut && body.atribut.lapisan) || '';
      if (lid) body.atribut = Object.assign({}, body.atribut, { lapisan: lid });
    }
    // Lantai: perangkat ditaruh di denah lantai yang sedang tampil.
    if (multiLantai() || (body.atribut && body.atribut.lantai)) {
      body.atribut = Object.assign({}, body.atribut);
      if (atrLantai(S.lantai)) body.atribut.lantai = S.lantai;
      else delete body.atribut.lantai;
    }
    try {
      const res = await enqueue(() => api(API, body));
      S.list.push(res.perangkat);
      S.sel = res.perangkat.id;
      refreshModel();
      peta.flash(res.perangkat.id);
      // Titik listrik baru: langsung buka isian MCB (daya yang bisa dipakai dihitung dari situ).
      if (TYPES[jenis].listrik && !base) {
        const simpan = pnTab;
        pnTab = 'jenis';
        terapkanPnTab();
        pnTab = simpan;
        const mcb = $('#panel [data-f="arus_a"]');
        if (mcb) setTimeout(() => mcb.focus(), 50);
      }
      const row = salin(res.perangkat);
      catat({
        label: 'tambah ' + row.nama,
        undo: () => hapusLangsung([row.id]),
        redo: () => pulihkanPerangkat([row], []),
      });
      return res.perangkat;
    } catch (e) {
      setSaveState('error');
      toast(e.message, true);
    }
  }

  function linkDev(childId, parentId) {
    const c = S.model.byId.get(childId);
    const p = S.model.byId.get(parentId);
    if (!c || !p) return;
    // Titik listrik & peralatan support bukan jaringan: perangkat (jaringan / support) → titik listrik = pilih sumber
    // listrik; selain itu ditolak.
    if (NP.isListrik(c)) return toast(`${c.nama} adalah titik listrik — hubungkan perangkat ke titik listrik ini, bukan sebaliknya`, true);
    if (NP.nonJaringan(p) && !NP.isListrik(p)) return toast(`${p.nama} adalah peralatan support — tidak bisa menjadi uplink / sumber listrik`, true);
    if (NP.nonJaringan(c) && !NP.isListrik(p)) return toast(`${c.nama} adalah peralatan support — hanya bisa dihubungkan ke titik listrik`, true);
    if (NP.isListrik(p)) {
      const atr = Object.assign({}, c.atribut, { listrik_id: String(p.id) });
      if (!atr.listrik || atr.listrik === 'poe' || atr.listrik === 'baterai') atr.listrik = 'ada';
      saveDev(childId, { atribut: atr }).then(() => toast(`${c.nama} ⚡ mendapat listrik dari ${p.nama}`)).catch(() => {});
      return;
    }
    // Router yang sudah punya uplink dihubungkan ke Sumber WAN lain = tambah WAN (multi-WAN), bukan ganti uplink.
    if (c.jenis === 'router' && p.jenis === 'isp' && c.uplink_id != null && c.uplink_id !== parentId) {
      if (S.model.wanLain(c).some(w => w.dev.id === parentId)) return toast(`${p.nama} sudah menjadi WAN ${c.nama}`);
      simpanWan(c, [...wanList(c), { id: parentId, port: '' }], S.model.wanMode(c))
        .then(() => toast(`${p.nama} ditambahkan sebagai WAN${S.model.wanLain(c).length + 1} untuk ${c.nama} (atur mode di tab Koneksi)`));
      return;
    }
    // Switch yang sudah punya uplink dihubungkan ke router/switch lain: tawarkan sebagai uplink kedua (redundan / LACP).
    if (c.jenis === 'switch' && ['router', 'switch'].includes(p.jenis) && c.uplink_id != null && !S.model.descendants(childId).has(parentId)) {
      if (S.model.uplinkLain(c).some(w => w.dev.id === parentId)) return toast(`${p.nama} sudah menjadi uplink kedua ${c.nama}`);
      const sama = c.uplink_id === parentId;
      const pesan = sama
        ? `${p.nama} sudah uplink utama ${c.nama}.\n\nOK = tambah kabel kedua ke ${p.nama} (LACP, bandwidth digabung)\nBatal = tidak jadi`
        : `${c.nama} sudah punya uplink ke ${(S.model.parentOf(c) || {}).nama}.\n\nOK = jadikan ${p.nama} uplink KEDUA (redundan)\nBatal = GANTI uplink utama ke ${p.nama}`;
      if (confirm(pesan)) {
        simpanUplink(c, [...upList(c), { id: parentId, port: '', media: 'utp' }], sama ? 'lacp' : S.model.uplinkMode(c))
          .then(() => toast(`${p.nama} ditambahkan sebagai uplink kedua ${c.nama}${sama ? ' (LACP)' : ' (redundan)'} — atur di tab Koneksi`));
        return;
      }
      if (sama) return;
    }
    if (S.model.descendants(childId).has(parentId)) {
      toast(`${p.nama} berada di bawah ${c.nama} — tidak bisa jadi uplinknya (loop)`, true);
      return;
    }
    const patch = { uplink_id: parentId };
    const md = mediaWajar(c.jenis, p, c.media);
    if (md !== c.media) patch.media = md;
    if (md === 'wireless' && (p.jenis === 'ap' || p.jenis === 'bridge') && c.port_uplink) patch.port_uplink = '';
    const lama = c.nama;
    const baru = namaMasukGrup(c, parentId);
    if (baru) patch.nama = baru;
    saveDev(childId, patch).then(() => toast(`${lama}${baru ? ' → ' + baru : ''} · uplink ${p.nama}`)).catch(() => {});
  }

  /** Hapus koneksi perangkat ke uplinknya (port uplink & bentuk jalur ikut dikosongkan). Bisa dibatalkan. */
  function putusKoneksi(id) {
    const d = S.model.byId.get(id);
    const p = d && S.model.parentOf(d);
    if (!p || !S.canEdit) return;
    const sebelum = { uplink_id: d.uplink_id, port_uplink: d.port_uplink, jalur: d.jalur };
    saveDev(id, { uplink_id: null, port_uplink: '', jalur: null })
      .then(() => toast(`Koneksi ${d.nama} → ${p.nama} dihapus`, false, {
        label: 'Batalkan',
        fn: () => saveDev(id, sebelum).then(() => toast(`${d.nama} → ${p.nama} tersambung lagi`)).catch(() => {}),
      }))
      .catch(() => {});
  }

  async function deleteDev(ids) {
    ids = [].concat(ids);
    const names = ids.map(id => S.model.byId.get(id)).filter(Boolean).map(d => d.nama);
    const anak = ids.reduce((n, id) => n + S.model.kids(id).filter(c => !ids.includes(c.id)).length, 0);
    // Hapus massal: tampilkan maksimal 12 nama agar dialog konfirmasi tetap terbaca.
    const daftar = names.length > 12 ? names.slice(0, 12).join(', ') + ` … dan ${names.length - 12} lainnya` : names.join(', ');
    // Satu perangkat tanpa sambungan: langsung hapus (bisa dibatalkan). Selebihnya minta konfirmasi dulu.
    if ((names.length > 1 || anak) && !confirm(`Hapus ${names.length > 1 ? names.length + ' perangkat: ' : ''}${daftar}?` + (anak ? `\n\n${anak} perangkat yang terhubung ke sini akan menjadi tanpa uplink.` : '') + '\n\nBisa dibatalkan dengan Ctrl+Z.')) return;
    const rows = ids.map(id => S.list.find(d => d.id === id)).filter(Boolean).map(salin);
    const sambung = S.list.filter(d => ids.includes(d.uplink_id) && !ids.includes(d.id)).map(d => ({ id: d.id, uplink_id: d.uplink_id }));
    try {
      await hapusLangsung(ids);
      catat({
        label: names.length > 1 ? `hapus ${names.length} perangkat` : 'hapus ' + names[0],
        undo: () => pulihkanPerangkat(rows, sambung),
        redo: () => hapusLangsung(ids),
      });
      toast(names.length > 1 ? `${names.length} perangkat dihapus` : names[0] + ' dihapus', false, {
        label: 'Batalkan',
        fn: () => jalankanRiwayat('undo'),
      });
    } catch (e) {
      setSaveState('error');
      toast(e.message, true);
    }
  }

  async function hapusLangsung(ids) {
    await enqueue(() => api(API, { action: 'perangkat_delete', ids }));
    S.list = S.list.filter(d => !ids.includes(d.id));
    S.list.forEach(d => { if (ids.includes(d.uplink_id)) d.uplink_id = null; });
    ids.forEach(id => S.pilih.delete(id));
    if (ids.includes(S.sel)) S.sel = null;
    refreshModel();
  }

  /** Kembalikan perangkat yang dihapus (id semula) beserta sambungan perangkat lain ke situ. */
  async function pulihkanPerangkat(rows, sambung) {
    const res = await enqueue(() => api(API, { action: 'perangkat_pulihkan', proyek_id: S.proyek.id, perangkat: rows, sambung }));
    S.list = res.perangkat;
    refreshModel();
    if (rows.length === 1 && S.model.byId.has(rows[0].id)) {
      if (S.tab === 'denah') selectDev(rows[0].id);
      peta.flash(rows[0].id);
    }
  }

  /** Kunci / buka kunci posisi titik (satu atau banyak). Bisa dibatalkan dengan Ctrl+Z. */
  async function kunciPerangkat(ids, kunci, tanpaRiwayat) {
    const ubah = ids.filter(id => {
      const d = S.model.byId.get(id);
      return d && NP.terkunci(d) !== kunci;
    });
    if (!ubah.length) return toast(kunci ? 'Posisi sudah terkunci' : 'Posisi memang tidak terkunci');
    try {
      await enqueue(() => api(API, { action: 'perangkat_kunci', ids: ubah, kunci }));
      ubah.forEach(id => {
        const d = S.model.byId.get(id);
        const a = Object.assign({}, d.atribut);
        if (kunci) a.kunci = '1';
        else delete a.kunci;
        d.atribut = a;
      });
      refreshModel();
      const label = `${kunci ? 'kunci' : 'buka kunci'} posisi ${ubah.length > 1 ? ubah.length + ' perangkat' : S.model.byId.get(ubah[0]).nama}`;
      if (!tanpaRiwayat) catat({ label, undo: () => kunciPerangkat(ubah, !kunci, true), redo: () => kunciPerangkat(ubah, kunci, true) });
      toast(label.charAt(0).toUpperCase() + label.slice(1));
    } catch (e) {
      setSaveState('error');
      toast(e.message, true);
    }
  }

  function duplicateDev(id) {
    const d = S.model.byId.get(id);
    const base = {};
    ['model', 'vlan', 'media', 'bandwidth_mbps', 'pic', 'catatan', 'uplink_id', 'katalog_id'].forEach(k => { base[k] = d[k]; });
    base.atribut = Object.assign({}, d.atribut);
    delete base.atribut.kunci; // salinan baru perlu ditempatkan, jadi tidak ikut terkunci
    if (S.lihat) return;
    const off = 40 / Math.max(peta.size().W / 2000, 0.5);
    addDev(d.jenis, d.x + off, d.y + off, base);
  }

  // Toolbar: alat + jenis perangkat
  function buildToolbar() {
    const tools = [
      { t: 'pilih', key: 'V', label: 'Pilih / geser', icon: '<path d="M5 3l14 8-6 2-3 6z"/>' },
      { t: 'hubung', key: 'L', label: 'Hubungkan ke uplink', icon: '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M8 16L16 8" stroke-width="2.2"/>', edit: true },
      { t: 'ukur', key: 'M', label: 'Ukur jarak / kalibrasi skala', icon: '<path d="M3 17L17 3l4 4L7 21z" fill="none" stroke-width="1.8"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2" stroke-width="1.6"/>' },
      { t: 'label', key: 'T', label: 'Label & panah (klik titik yang ditunjuk)', icon: '<path d="M4 4h12v8H9l-5 4z" fill="none" stroke-width="1.9" stroke-linejoin="round"/><path d="M14 14l6 6M20 15v5h-5" fill="none" stroke-width="1.9" stroke-linecap="round"/>', edit: true },
    ];
    let h = tools.map(x => `<button type="button" class="tool${x.edit ? ' edit-only' : ''}" data-tool="${x.t}" title="${x.label} (${x.key})">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="currentColor">${x.icon}</svg><span>${x.label.split(' ')[0]}</span></button>`).join('');
    const inst = isInstaller();
    document.body.classList.toggle('mode-installer', inst);
    h += inst ? '<div class="tb-sep" title="Alat baru masuk sebagai usulan; admin yang menentukan bisa dipasang atau tidak">Usulkan</div>' : '<div class="tb-sep edit-only">Tambah</div>';
    h += TYPE_ORDER.map((j, i) => {
      const t = TYPES[j];
      if (inst && !bolehUsul(j)) return '';
      return `<button type="button" class="tool add${inst ? ' usul' : ' edit-only'}" data-tool="tambah:${j}" title="${inst ? 'Usulkan' : 'Tambah'} ${t.label}${inst ? '' : ` (${i + 1})`}">
        <i style="background:${t.color}"${j === 'endpoint' ? ' class="sq"' : ''}>${j === 'endpoint' ? NP.ikonSvg('pc', 15) : esc(t.short)}</i><span>${esc(t.tb || t.label.split(/[ /(]/)[0])}</span></button>`;
    }).join('');
    $('#toolbar').innerHTML = h;
    setTool('pilih');
    syncHidden();
  }

  function setTool(tool) {
    peta.setTool(tool);
    $$('#toolbar .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    if (S.model) renderPanel();
    updateHint();
    renderEpPicker();
  }

  $('#toolbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    setTool(peta.tool === b.dataset.tool && b.dataset.tool !== 'pilih' ? 'pilih' : b.dataset.tool);
  });

  function updateHint() {
    const el = $('#map-hint');
    const tool = peta.tool;
    let h = '';
    if (tool === 'hubung') {
      const src = peta.linkSrc != null && S.model && S.model.byId.get(peta.linkSrc);
      h = src
        ? `Klik perangkat <b>uplink</b> untuk <b>${esc(src.nama)}</b> <span class="muted">(Shift+klik: tetap pada ${esc(src.nama)} · Esc batal)</span>`
        : 'Klik perangkat yang ingin dihubungkan, lalu klik perangkat uplinknya (sumber koneksinya).';
    } else if (tool === 'ukur') {
      h = 'Klik dua titik untuk mengukur. Klik titik perangkat untuk mengukur antarperangkat.';
    } else if (tool.startsWith('tambah:')) {
      const ep = tool === 'tambah:endpoint' && (NP.ET.find(x => x.id === S.epTipe) || NP.ET[0]);
      const t = ep ? { label: ep.nama } : TYPES[tool.slice(7)];
      const par = S.parentCtx != null && S.model && S.model.byId.get(S.parentCtx);
      const adaLan = S.list.some(d => NP.titikLan(d.jenis));
      h = `${isInstaller() ? 'Klik lokasi <b>usulan</b> alat baru' : 'Klik di denah untuk menaruh'} <b>${esc(t.label)}</b>` +
        (ep ? (par && NP.titikLan(par.jenis) ? ` · tersambung ke <b>${esc(par.nama)}</b> <span class="muted">(pilih titik LAN lain untuk mengganti)</span>`
          : adaLan ? ' · tersambung otomatis ke <b>titik LAN terdekat</b>'
            : par ? ` · belum ada titik LAN, tersambung ke <b>${esc(par.nama)}</b>` : ' · <span class="muted">taruh titik LAN dulu agar endpoint tersambung otomatis</span>')
          : tool !== 'tambah:isp' ? (par ? ` · uplink otomatis: <b>${esc(par.nama)}</b> <span class="muted">(pilih perangkat lain untuk mengganti)</span>` : ' · <span class="muted">pilih router/switch dulu agar uplink terisi otomatis</span>') : '') +
        ' · Esc selesai';
    }
    el.innerHTML = h;
    el.hidden = !h;
  }

  $('.map-ctrl').addEventListener('click', e => {
    const b = e.target.closest('[data-zoom]');
    if (!b) return;
    if (b.dataset.zoom === 'fit') peta.fit();
    else peta.zoomBy(b.dataset.zoom === 'in' ? 1.4 : 1 / 1.4);
  });

  $('#map-layers').addEventListener('change', e => {
    const c = e.target.closest('[data-layer]');
    if (!c) return;
    peta.setLayer(c.dataset.layer, c.checked);
    if (c.dataset.layer === 'kabel') $$('[data-kabel-layer]').forEach(x => { x.checked = c.checked; });
    try { localStorage.setItem('np-layers', JSON.stringify(peta.layers)); } catch (err) { /* abaikan */ }
  });
  try {
    const saved = JSON.parse(localStorage.getItem('np-layers') || 'null');
    if (saved) {
      for (const k in saved) {
        const c = $(`[data-layer="${k}"]`);
        if (c) {
          c.checked = !!saved[k];
          peta.setLayer(k, !!saved[k]);
        }
      }
    }
  } catch (err) { /* abaikan */ }

  // Opasitas denah: dipudarkan agar titik & garis lebih menonjol. Disimpan per browser.
  function setOpacity(pct, save) {
    pct = Math.max(10, Math.min(100, Math.round(pct) || 100));
    $('#denah-opacity').value = pct;
    $('#denah-opacity-val').textContent = pct + '%';
    peta.setOpacity(pct / 100);
    if (save) {
      try { localStorage.setItem('np-opacity', pct); } catch (err) { /* abaikan */ }
    }
  }
  $('#denah-opacity').addEventListener('input', e => setOpacity(+e.target.value, true));
  try { setOpacity(+(localStorage.getItem('np-opacity') || 100), false); } catch (err) { /* abaikan */ }

  const hiddenTypes = new Set();

  // Tampilan denah: semua / hanya jaringan / hanya support (titik listrik & peralatan support). Disimpan per browser.
  let viewGrup = 'semua';
  try { viewGrup = localStorage.getItem('np-view') || 'semua'; } catch (err) { /* abaikan */ }
  /** Jenis yang termasuk tampilan: 'semua', kelompok ('jaringan' / 'support'), atau satu jenis ('jenis:ap'). */
  function masukView(j) {
    if (viewGrup === 'semua') return true;
    if (viewGrup.startsWith('jenis:')) return j === viewGrup.slice(6);
    return NP.grupJenis(j) === viewGrup;
  }
  function syncHidden() {
    if (!$(`#view-switch [data-view="${viewGrup}"]`)) viewGrup = 'semua'; // nilai tersimpan yang tidak dikenal
    const h = new Set(hiddenTypes);
    TYPE_ORDER.forEach(j => { if (!masukView(j)) h.add(j); });
    peta.setHidden(h);
    $$('#view-switch [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === viewGrup));
    // Tombol tambah di toolbar mengikuti tampilan.
    $$('#toolbar [data-tool^="tambah:"]').forEach(b => { b.hidden = !masukView(b.dataset.tool.slice(7)); });
  }
  function setView(v) {
    viewGrup = v;
    try { localStorage.setItem('np-view', v); } catch (err) { /* abaikan */ }
    if (S.sel != null && !masukView((S.model.byId.get(S.sel) || {}).jenis)) selectDev(null);
    syncHidden();
  }
  $('#view-switch').addEventListener('click', e => {
    const b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  });

  // ------------------------------------------------------------------------ layer jaringan

  /** Event punya lebih dari satu layer jaringan (beberapa jaringan terpisah dalam satu denah). */
  const multiLapisan = () => !!S.model && S.model.lapisanList().length > 1;
  /** Perangkat termasuk layer yang sedang ditampilkan. */
  const masukLapisan = d => S.lapisan === 'semua' || !multiLapisan() || S.model.lapisanOf(d) === S.lapisan;
  const kunciLapisan = () => 'np-lapisan-' + (S.proyek ? S.proyek.id : '');

  /** Terapkan layer aktif ke peta (layer lain samar) & tombol pemilih layer; dipanggil setiap model diperbarui. */
  /** Nama layer tanpa awalan bersama (dipotong di batas kata / pemisah " - ", " · ", ": "). Map id -> nama. */
  function namaRingkasLapisan(daftar) {
    const out = new Map(daftar.map(l => [l.id, l.nama]));
    if (daftar.length < 2) return out;
    let pre = daftar[0].nama;
    daftar.forEach(l => { while (pre && !l.nama.startsWith(pre)) pre = pre.slice(0, -1); });
    const m = pre.match(/^.*(\s[-–·:|/]\s|\s)/); // potong di pemisah / spasi terakhir dalam awalan
    const buang = m ? m[0].length : 0;
    if (buang < 3) return out;
    daftar.forEach(l => { const s = l.nama.slice(buang).trim(); if (s) out.set(l.id, s); });
    return out;
  }
  function terapkanLapisan() {
    const box = $('#lapisan-switch');
    if (!multiLapisan()) {
      S.lapisan = 'semua';
      if (box) box.hidden = true;
      peta.setRedup(null);
      return;
    }
    const daftar = S.model.lapisanList();
    if (S.lapisan !== 'semua' && !daftar.some(l => l.id === S.lapisan)) S.lapisan = 'semua';
    peta.setRedup(S.lapisan === 'semua' ? null : d => S.model.lapisanOf(d) !== S.lapisan);
    if (!box) return;
    const n = id => S.model.list.filter(d => S.model.lapisanOf(d) === id).length;
    box.hidden = false;
    // Nama ringkas: buang awalan yang sama di semua layer (mis. "BSI EXPO 2026 - EXPO LINE" → "EXPO LINE"); nama lengkap di tooltip.
    const pendek = namaRingkasLapisan(daftar);
    box.innerHTML = `<span class="lp-lbl">Layer</span><button type="button" data-lapisan="semua" class="${S.lapisan === 'semua' ? 'on' : ''}" title="Semua layer jaringan">Semua</button>` +
      daftar.map(l => `<button type="button" data-lapisan="${esc(l.id)}" class="${S.lapisan === l.id ? 'on' : ''}" title="${esc(l.nama)} · ${n(l.id)} perangkat">
        <i style="background:${esc(l.warna)}"></i><span>${esc(pendek.get(l.id))}</span></button>`).join('');
  }
  /**
   * Layer yang dijadikan kolom rincian di tabel ringkasan (kebutuhan perangkat, kabel, WAN): semua layer bila event
   * punya > 1 layer dan yang ditampilkan "Semua". cetak = laporan (pilihan layer dari dialog cetak, bukan peta).
   */
  function kolomLapisan(cetak) {
    if (!multiLapisan()) return [];
    return (cetak ? !S.labelLapisan : S.lapisan === 'semua') ? S.model.lapisanList() : [];
  }
  /** Label layer berwarna di laporan gabungan beberapa layer (kosong bila satu layer / satu jaringan). */
  function lapisanLabel(d) {
    if (!kolomLapisan(true).length) return '';
    const L = S.model.lapisanById(S.model.lapisanOf(d));
    return ` · <b style="color:${esc(L.warna)}">● ${esc(L.nama)}</b>`;
  }
  const thLapisan = (L, cls) => `<th class="${cls || 'num'} th-lp" title="Layer ${esc(L.nama)}"><i style="background:${esc(L.warna)}"></i>${esc(L.nama)}</th>`;

  /** Tabel kebutuhan perangkat; dengan kolom per layer bila cols berisi layer. */
  function bomTabel(bom, cols, cetak) {
    const stokCell = b => b.stok == null ? (cetak ? '—' : '<span class="muted">—</span>')
      : b.jumlah > b.stok ? `<b class="bad">${b.stok} (kurang ${b.jumlah - b.stok})</b>` : String(b.stok);
    const nol = cetak ? '—' : '<span class="muted">—</span>';
    return `<table class="${cetak ? 'pr-table' : 'mini'}"><tr><th>Jenis</th><th>Nama alat</th>${cols.map(L => thLapisan(L)).join('')}<th class="num">${cols.length ? 'Total' : 'Jumlah'}</th><th class="num">Stok</th></tr>${bom.map(b =>
      `<tr><td>${esc((TYPES[b.jenis] || TYPES.lainnya).label)}</td><td>${b.model ? esc(b.model) : cetak ? '(belum diisi)' : '<span class="muted">(belum diisi)</span>'}${b.katalog && !cetak ? ' <span class="tag-kat" title="Dari katalog">katalog</span>' : ''}</td>
        ${cols.map(L => `<td class="num">${b.lp[L.id] || nol}</td>`).join('')}<td class="num"><b>${b.jumlah}</b></td><td class="num">${stokCell(b)}</td></tr>`).join('')}
      ${cols.length ? `<tr class="tot"><td colspan="2">Total perangkat</td>${cols.map(L => `<td class="num"><b>${bom.reduce((s, b) => s + (b.lp[L.id] || 0), 0)}</b></td>`).join('')}<td class="num"><b>${bom.reduce((s, b) => s + b.jumlah, 0)}</b></td><td></td></tr>` : ''}</table>`;
  }

  /** Tabel estimasi kabel per media; dengan kolom per layer (link · meter) bila cols berisi layer. */
  function kabelTabel(kb, cols, cetak) {
    const keys = Object.keys(kb.tot);
    if (!keys.length) return '';
    const sel = x => (x ? `${x.n} link · ≈ ${esc(fmtM(x.m))}` : cetak ? '—' : '<span class="muted">—</span>');
    return `<table class="${cetak ? 'pr-table' : 'mini'}"><tr><th>Media</th>${cols.map(L => thLapisan(L)).join('')}<th class="num">Link</th><th class="num">Total</th></tr>${keys.map(k =>
      `<tr><td>${esc(MEDIA[k] ? MEDIA[k].label : k)}</td>${cols.map(L => `<td class="num">${sel(kb.tot[k].lp[L.id])}</td>`).join('')}<td class="num">${kb.tot[k].n}</td><td class="num"><b>≈ ${esc(fmtM(kb.tot[k].m))}</b></td></tr>`).join('')}</table>`;
  }

  /**
   * Jalankan fn (sinkron) dengan S.model hanya berisi layer aktif — untuk halaman yang dihitung dari S.model
   * (Ceklis, Support & listrik). Semua layer / satu jaringan: model penuh. Halaman diberi catatan layer yang tampil.
   */
  function modelLapisanAktif(fn, pane) {
    if (!multiLapisan() || S.lapisan === 'semua') return fn();
    const asli = S.model;
    const L = asli.lapisanById(S.lapisan);
    S.model = NP.Model.create(S.proyek, S.list.filter(d => asli.lapisanOf(d) === S.lapisan), S.katalog);
    try {
      return fn();
    } finally {
      S.model = asli;
      const box = pane && $(pane);
      if (box && !box.querySelector('.lp-note')) {
        box.insertAdjacentHTML('afterbegin', `<div class="lp-note"><i style="background:${esc(L.warna)}"></i>Menampilkan layer <b>${esc(L.nama)}</b>
          <button type="button" class="small ghost" data-lapisan-semua>Tampilkan semua layer</button></div>`);
      }
    }
  }
  function renderCeklisPage() { return modelLapisanAktif(renderCeklisPageIsi, '#ceklis-pane'); }
  function renderSupport() { return modelLapisanAktif(renderSupportIsi, '#support-pane'); }
  document.addEventListener('click', e => {
    if (e.target.closest('.lp-note [data-lapisan-semua]')) setLapisan('semua');
  });

  /** Label kecil layer perangkat (daftar / topologi) bila semua layer ditampilkan. */
  function lapisanChip(d) {
    if (!multiLapisan() || S.lapisan !== 'semua') return '';
    const L = S.model.lapisanById(S.model.lapisanOf(d));
    return `<span class="lp-chip" style="--c:${esc(L.warna)}" title="Layer ${esc(L.nama)}">${esc(namaRingkasLapisan(S.model.lapisanList()).get(L.id))}</span>`;
  }
  function setLapisan(id) {
    S.lapisan = id;
    try { localStorage.setItem(kunciLapisan(), id); } catch (err) { /* abaikan */ }
    if (S.sel != null && !masukLapisan(S.model.byId.get(S.sel) || {})) selectDev(null);
    terapkanLapisan();
    if (S.tab !== 'denah') renderTab();
    else if (S.sel == null) renderPanel(); // ringkasan ikut layer
  }
  $('#lapisan-switch').addEventListener('click', e => {
    const b = e.target.closest('[data-lapisan]');
    if (b) setLapisan(b.dataset.lapisan);
  });

  // ------------------------------------------------------------------------ lantai (beberapa denah satu gedung)

  /** Event punya lebih dari satu lantai (denah berbeda per lantai). Peta selalu menampilkan satu lantai. */
  const multiLantai = () => !!S.model && S.model.multiLantai();
  const kunciLantai = () => 'np-lantai-' + (S.proyek ? S.proyek.id : '');
  /** Data lantai yang sedang tampil di peta: {id, nama, denah_w, denah_h, skala, denah_v, ...}. */
  const lantaiAktif = () => S.model.lantaiById(S.lantai || 'F1');
  const namaLantai = d => S.model.lantaiById(S.model.lantaiOf(d)).nama;
  /** Nilai atribut "lantai" untuk perangkat baru di lantai id (F1 = kosong). */
  const atrLantai = id => (id && id !== 'F1' ? id : '');

  /** Terapkan lantai aktif: perangkat lantai lain tidak digambar & tombol pemilih lantai. */
  function terapkanLantai() {
    const box = $('#lantai-switch');
    if (!multiLantai()) {
      S.lantai = 'F1';
      if (box) box.hidden = true;
      peta.setSaring(null);
      return;
    }
    const daftar = S.model.lantaiList();
    if (!daftar.some(l => l.id === S.lantai)) S.lantai = 'F1';
    peta.setSaring(d => S.model.lantaiOf(d) !== S.lantai);
    if (!box) return;
    const n = id => S.model.list.filter(d => S.model.lantaiOf(d) === id).length;
    box.hidden = false;
    // Urut atas -> bawah seperti tombol lift.
    box.innerHTML = `<span class="lp-lbl">Lantai</span>` + daftar.slice().reverse().map(l =>
      `<button type="button" data-lantai="${esc(l.id)}" class="${S.lantai === l.id ? 'on' : ''}" title="${esc(l.nama)} · ${n(l.id)} perangkat${l.denah_v ? '' : ' · belum ada denah'}">${esc(l.nama)}</button>`).join('');
  }
  function setLantai(id) {
    if (id === S.lantai) return;
    S.lantai = id;
    try { localStorage.setItem(kunciLantai(), id); } catch (err) { /* abaikan */ }
    peta.clearMeasure();
    if (S.sel != null && S.model.byId.has(S.sel) && S.model.lantaiOf(S.model.byId.get(S.sel)) !== id) {
      S.sel = null;
      peta.select(null);
    }
    peta.setData(S.model, denahUrl(id), lantaiAktif());
    terapkanLantai();
    terapkanAnot();
    if (S.tab === 'denah') renderPanel();
    updateHint();
  }
  $('#lantai-switch').addEventListener('click', e => {
    const b = e.target.closest('[data-lantai]');
    if (b) setLantai(b.dataset.lantai);
  });
  // ------------------------------------------------------------------------ kartu info saat hover titik

  /** Waktu singkat "29 Okt 10:15" (tahun ditulis bila bukan tahun ini). */
  function waktuSingkat(s) {
    const t = s ? new Date(String(s).replace(' ', 'T')) : null;
    if (!t || isNaN(t)) return '';
    const opsi = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
    if (t.getFullYear() !== new Date().getFullYear()) opsi.year = 'numeric';
    return t.toLocaleString('id-ID', opsi);
  }

  let hoverEl = null, hoverIdAktif = null;
  /** Kartu info titik di dekat kursor: status pemasangan, koneksi uplink, SSID (AP), IP/VLAN, dst. id null = tutup. */
  function kartuHover(id, x, y) {
    const d = id != null && S.model && S.model.byId.get(id);
    if (!hoverEl) {
      hoverEl = document.createElement('div');
      hoverEl.className = 'hover-card';
      hoverEl.setAttribute('role', 'tooltip');
      document.body.appendChild(hoverEl);
    }
    if (!d) {
      hoverEl.classList.remove('show');
      hoverIdAktif = null;
      return;
    }
    if (hoverIdAktif !== id) {
      hoverIdAktif = id;
      hoverEl.innerHTML = isiHover(d);
    }
    hoverEl.classList.add('show');
    // Di kanan bawah kursor; dibalik bila mepet tepi layar.
    const r = hoverEl.getBoundingClientRect();
    let left = x + 16, top = y + 16;
    if (left + r.width > innerWidth - 8) left = x - r.width - 16;
    if (top + r.height > innerHeight - 8) top = Math.max(8, y - r.height - 16);
    hoverEl.style.left = Math.max(8, left) + 'px';
    hoverEl.style.top = top + 'px';
  }

  function isiHover(d) {
    const m = S.model;
    const a = d.atribut || {};
    const t = NP.tampil(d);
    const kt = m.kat(d);
    const baris = [];
    const row = (l, v) => { if (v) baris.push(`<div class="hc-row"><span>${l}</span><b>${v}</b></div>`); };
    const st = STATUS[d.status] || STATUS.rencana;
    row('Pemasangan', `<i class="hc-dot" style="background:${st.color}"></i>${esc(st.label)}${d.updated_at ? ` <small>· ${esc(waktuSingkat(d.updated_at))}</small>` : ''}`);
    if (!NP.nonJaringan(d)) {
      const K = KONEKSI[m.koneksi(d)];
      row('Internet', `<i class="hc-dot" style="background:${K.color}"></i>${esc(K.label)}`);
      const p = m.parentOf(d);
      if (p) {
        const kl = KONEKSI[m.koneksiLink(d)];
        const kabel = NP.kabelTertanam(d) ? 'tertanam di gedung' : NP.perluKabel(d) ? NP.KABEL[NP.kabelSt(d)].label.toLowerCase() : '';
        row('Uplink', `${esc(p.nama)}${d.port_uplink ? ' port ' + esc(d.port_uplink) : ''}<small> · ${esc(MEDIA[d.media] ? MEDIA[d.media].short || MEDIA[d.media].label : d.media || '—')}${kabel ? ' · kabel ' + esc(kabel) : ''}</small>`);
        row('Status uplink', `<i class="hc-dot" style="background:${kl.color}"></i>${esc(kl.label)}${d.status === 'bermasalah' ? ' <small>· perangkat ini bermasalah</small>' : ''}`);
      } else if (d.jenis === 'isp' || d.jenis === 'lan_gedung') {
        row('Uplink', `<small>${d.jenis === 'isp' ? 'sumber WAN' : 'jaringan gedung'}</small>`);
      } else row('Uplink', '<small class="bad">belum tersambung</small>');
    }
    if (d.jenis === 'ap' || d.jenis === 'bridge') {
      row('SSID', a.ssid ? esc(a.ssid) + (a.keamanan ? ` <small>· ${esc(a.keamanan)}</small>` : '') : '<small>belum diisi</small>');
      if (a.ssid_lain) row('SSID lain', esc(a.ssid_lain));
      row('Radio', esc([a.band, a.channel ? 'ch ' + a.channel : '', a.lebar_kanal].filter(Boolean).join(' · ')));
    }
    row('IP / VLAN', esc([d.ip, d.vlan ? 'VLAN ' + d.vlan : ''].filter(Boolean).join(' · ')));
    const anak = m.kids(d.id).length;
    if (anak) row('Terhubung ke sini', anak + ' perangkat');
    const v = NP.verifOf(d);
    if (v && NP.VERIF[v.h]) row('Pengecekan', `<span style="color:${NP.VERIF[v.h].color}">${NP.VERIF[v.h].icon} ${esc(NP.VERIF[v.h].label)}</span>`);
    if (multiLapisan()) row('Layer', esc(m.lapisanById(m.lapisanOf(d)).nama));
    if (multiLantai()) row('Lantai', esc(namaLantai(d)));
    const un = unitOf(d);
    if (un) row('Unit', esc([un.sn ? 'SN ' + un.sn : '', un.firmware ? 'FW ' + un.firmware : '', un.aset].filter(Boolean).join(' · ')) || 'terpasang');
    if (d.pic) row('PIC', esc(d.pic));
    return `<div class="hc-head"><i class="hc-ico" style="background:${t.color}">${esc(t.short)}</i><div><b>${esc(d.nama)}</b>
        <small>${esc(jenisLabel(d))}${kt ? ' · ' + esc([kt.merek, kt.model].filter(Boolean).join(' ')) : d.model ? ' · ' + esc(d.model) : ''}</small></div></div>
      ${baris.join('')}${NP.terkunci(d) ? '<div class="hc-foot">🔒 Posisi terkunci</div>' : ''}`;
  }

  // ------------------------------------------------------------------------ menu klik kanan (titik & label)

  let menuEl = null;
  /** Menu konteks di (x, y): items [{label, ikon, pintas, fn, bahaya}] atau '-' (pemisah). */
  function bukaMenu(judul, items, x, y) {
    tutupMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'ctx-menu';
    menuEl.setAttribute('role', 'menu');
    const isi = items.filter(Boolean);
    menuEl.innerHTML = `<div class="ctx-judul">${esc(judul)}</div>` + isi.map((it, i) => it === '-' ? '<hr>'
      : `<button type="button" role="menuitem" data-i="${i}"${it.bahaya ? ' class="bahaya"' : ''}><i>${it.ikon || ''}</i><span>${esc(it.label)}</span>${it.pintas ? `<kbd>${esc(it.pintas)}</kbd>` : ''}</button>`).join('');
    document.body.appendChild(menuEl);
    // Di kanan bawah kursor, dibalik bila mepet tepi layar.
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(6, x + r.width > innerWidth - 6 ? x - r.width : x) + 'px';
    menuEl.style.top = Math.max(6, y + r.height > innerHeight - 6 ? y - r.height : y) + 'px';
    menuEl.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const it = isi[+b.dataset.i];
      tutupMenu();
      it.fn();
    });
    const pertama = menuEl.querySelector('button');
    if (pertama) pertama.focus({ preventScroll: true });
  }
  function tutupMenu() {
    if (menuEl) menuEl.remove();
    menuEl = null;
  }
  document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target)) tutupMenu(); }, true);
  document.addEventListener('keydown', e => {
    if (!menuEl) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return tutupMenu(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Navigasi keyboard antar item menu.
      e.preventDefault();
      const bs = [...menuEl.querySelectorAll('button')];
      const i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
    }
  }, true);
  window.addEventListener('resize', tutupMenu);
  window.addEventListener('blur', tutupMenu);

  /** Ringkasan teks perangkat untuk disalin (nama, jenis, IP/VLAN, uplink, SSID). */
  function teksInfo(d) {
    const m = S.model;
    const a = d.atribut || {};
    const p = m.parentOf(d);
    return [
      `${d.nama} — ${jenisLabel(d)}${d.model ? ' (' + d.model + ')' : ''}`,
      `Status: ${(STATUS[d.status] || STATUS.rencana).label}`,
      d.ip || d.vlan ? `IP: ${[d.ip, d.vlan ? 'VLAN ' + d.vlan : ''].filter(Boolean).join(' · ')}` : '',
      p ? `Uplink: ${p.nama}${d.port_uplink ? ' port ' + d.port_uplink : ''}` : '',
      a.ssid ? `SSID: ${a.ssid}${a.ssid_lain ? ' + ' + a.ssid_lain : ''}` : '',
      d.pic ? `PIC: ${d.pic}` : '',
    ].filter(Boolean).join('\n');
  }

  function menuPerangkat(id, x, y) {
    const d = S.model.byId.get(id);
    if (!d) return;
    if (S.sel !== id) selectDev(id);
    const edit = S.canEdit;
    const kunci = NP.terkunci(d);
    bukaMenu(d.nama, [
      edit && { label: 'Duplikat perangkat', ikon: '⧉', pintas: 'Ctrl+D', fn: () => duplicateDev(id) },
      { label: 'Salin nama', ikon: '📋', fn: () => copy(d.nama) },
      d.ip && { label: `Salin IP (${d.ip})`, ikon: '📋', fn: () => copy(d.ip) },
      { label: 'Salin info perangkat', ikon: '📄', fn: () => copy(teksInfo(d)) },
      edit && '-',
      edit && { label: kunci ? 'Buka kunci posisi' : 'Kunci posisi', ikon: kunci ? '🔓' : '🔒', pintas: 'K', fn: () => kunciPerangkat([id], !kunci) },
      '-',
      { label: 'Pusatkan di peta', ikon: '◎', fn: () => selectDev(id, true) },
      edit && { label: 'Hapus perangkat', ikon: '🗑', pintas: 'Del', bahaya: true, fn: () => deleteDev(id) },
    ], x, y);
  }

  function menuLabel(aid, x, y) {
    const a = anotList().find(z => z.id === aid);
    if (!a) return;
    pilihAnot(aid);
    const edit = S.canEdit;
    bukaMenu('Label', [
      edit && { label: 'Ubah teks', ikon: '✎', fn: () => pilihAnot(aid, true) },
      edit && { label: 'Duplikat label', ikon: '⧉', pintas: 'Ctrl+D', fn: () => duplikatAnot(aid) },
      { label: 'Salin teks', ikon: '📋', fn: () => copy(a.teks || '') },
      edit && { label: a.kunci ? 'Buka kunci posisi' : 'Kunci posisi', ikon: a.kunci ? '🔓' : '🔒', pintas: 'K', fn: () => kunciLabel(aid) },
      edit && '-',
      edit && { label: 'Hapus label', ikon: '🗑', pintas: 'Del', bahaya: true, fn: () => hapusAnot(aid) },
    ], x, y);
  }

  // ------------------------------------------------------------------------ label & panah (anotasi denah)

  /** Daftar label event (objek yang sama dipakai peta; dimutasi langsung lalu disimpan utuh). */
  function anotList() {
    if (!S.proyek) return [];
    if (!Array.isArray(S.proyek.anotasi)) S.proyek.anotasi = [];
    return S.proyek.anotasi;
  }
  const kunciAnot = () => 'np-anot-' + (S.proyek ? S.proyek.id : '');
  /** Tampilkan label di peta (pilihan per event, disimpan di browser). */
  function terapkanAnot() {
    let tampil = true;
    try { tampil = localStorage.getItem(kunciAnot()) !== '0'; } catch (err) { /* abaikan */ }
    peta.setLayer('anotasi', tampil);
    peta.setAnotasi(anotList(), S.lantai || 'F1');
    const b = $('#btn-anot');
    const n = anotList().filter(a => (a.lantai || 'F1') === (S.lantai || 'F1')).length;
    if (b) {
      b.hidden = !anotList().length && !S.canEdit;
      b.classList.toggle('off', !tampil);
      b.setAttribute('aria-pressed', String(tampil));
      b.querySelector('b').textContent = n ? String(n) : '';
      b.title = tampil ? 'Sembunyikan label & panah' : 'Tampilkan label & panah';
    }
  }
  $('#btn-anot').addEventListener('click', () => {
    const tampil = !peta.layers.anotasi;
    try { localStorage.setItem(kunciAnot(), tampil ? '1' : '0'); } catch (err) { /* abaikan */ }
    if (!tampil && S.anotSel != null) pilihAnot(null);
    terapkanAnot();
  });

  function buatAnot(posisi) {
    const list = anotList();
    if (list.length >= 500) return toast('Maksimal 500 label per event', true);
    const no = Math.max(0, ...list.map(a => +String(a.id).slice(1) || 0)) + 1;
    const d = posisi.ke != null && S.model.byId.get(posisi.ke);
    const a = Object.assign({ id: 'A' + no, teks: d ? d.nama : '', warna: 'hijau', lantai: S.lantai || 'F1', panah: true }, posisi);
    list.push(a);
    // Label tampil walau sebelumnya disembunyikan, lalu langsung bisa diketik.
    try { localStorage.setItem(kunciAnot(), '1'); } catch (err) { /* abaikan */ }
    setTool('pilih');
    pilihAnot(a.id, true);
    terapkanAnot();
    simpanAnot();
  }

  /** Pilih label (null = lepas); ketik = fokus ke isian teks. */
  function pilihAnot(id, ketik) {
    S.anotSel = id;
    if (id != null) {
      S.sel = null;
      openSheet();
    }
    peta.selectAnot(id, false);
    renderPanel();
    if (ketik && id != null) {
      const t = $('#panel [data-anot-teks]');
      if (t) { t.focus(); t.select(); }
    }
  }

  let anotTimer = null;
  /** Simpan semua label (ditunda sebentar agar ketikan / geseran beruntun jadi satu permintaan). */
  function simpanAnot() {
    clearTimeout(anotTimer);
    anotTimer = setTimeout(() => {
      // Label yang menunjuk perangkat: simpan juga posisi perangkat saat ini sebagai cadangan ujung panah.
      const list = anotList();
      list.forEach(a => {
        const d = a.ke != null && S.model.byId.get(a.ke);
        if (d) { a.tx = d.x; a.ty = d.y; } else if (a.ke != null) a.ke = null;
      });
      enqueue(() => api(API, { action: 'anotasi_save', id: S.proyek.id, anotasi: list }))
        .then(() => setSaveState('saved'))
        .catch(err => { setSaveState('error'); toast(err.message, true); });
    }, 500);
  }

  /** Teks label berikutnya: angka terakhir dinaikkan dengan lebar yang sama (GATE-IN-03 → GATE-IN-04, Pintu 9 → Pintu 10). */
  function teksBerikut(teks) {
    const m = String(teks || '').match(/^([\s\S]*?)(\d+)(\D*)$/);
    if (!m) return teks || '';
    const n = String(+m[2] + 1).padStart(m[2].length, '0');
    return m[1] + n + m[3];
  }

  /** Duplikat label: di bawah label asal, warna & panah sama, teks bernomor berikutnya, tidak terkunci. */
  function duplikatAnot(id) {
    const list = anotList();
    const a = list.find(x => x.id === id);
    if (!a) return;
    if (list.length >= 500) return toast('Maksimal 500 label per event', true);
    const no = Math.max(0, ...list.map(x => +String(x.id).slice(1) || 0)) + 1;
    const geser = 44 / (peta.zoom || 1); // ±44 px layar ke bawah
    const dev = a.ke != null && S.model.byId.get(a.ke);
    const ux = dev ? dev.x : a.tx, uy = dev ? dev.y : a.ty;
    const b = Object.assign({}, a, { id: 'A' + no, teks: teksBerikut(a.teks), y: a.y + geser, tx: ux, ty: uy + geser, ke: null, kunci: false });
    list.push(b);
    pilihAnot(b.id);
    terapkanAnot();
    simpanAnot();
    toast(`Label diduplikat: ${b.teks || 'Label'}`);
  }

  /** Kunci / buka kunci posisi label (kotak & ujung panah tidak bisa digeser). */
  function kunciLabel(id) {
    const a = anotList().find(x => x.id === id);
    if (!a) return;
    a.kunci = !a.kunci;
    terapkanAnot();
    renderPanel();
    simpanAnot();
    toast(a.kunci ? 'Posisi label dikunci' : 'Kunci label dibuka');
  }

  function hapusAnot(id) {
    const list = anotList();
    const i = list.findIndex(a => a.id === id);
    if (i < 0) return;
    list.splice(i, 1);
    pilihAnot(null);
    terapkanAnot();
    simpanAnot();
    toast('Label dihapus');
  }

  /** Panel label terpilih: teks, warna, arah panah, hapus. */
  function panelAnot(a) {
    const dis = S.canEdit ? '' : ' disabled';
    const devs = NP.Model.sortDev(S.model.list.filter(d => S.model.lantaiOf(d) === (a.lantai || 'F1')));
    const arah = a.panah === false ? 'tanpa' : a.ke != null ? String(a.ke) : 'titik';
    return `<div class="pn-sec anot-ed">
        <h3>Label</h3>
        <label class="field"><span>Isi label</span>
          <textarea data-anot-teks maxlength="500" rows="4" placeholder="mis. Port LAN existing ke ruang server&#10;PIC: Pak Budi"${dis}>${esc(a.teks || '')}</textarea></label>
        <div class="field"><span>Warna</span><div class="anot-warna">${Object.keys(NP.ANOT_WARNA).map(k =>
          `<button type="button" data-anot-warna="${k}" class="${(a.warna || 'hijau') === k ? 'on' : ''}" style="--c:${NP.ANOT_WARNA[k].bg}" title="${NP.ANOT_WARNA[k].label}" aria-label="Warna ${NP.ANOT_WARNA[k].label}"${dis}></button>`).join('')}</div></div>
        <label class="field"><span>Panah ke</span><select data-anot-arah${dis}>
          <option value="titik"${arah === 'titik' ? ' selected' : ''}>Titik di denah (tarik ujung panah)</option>
          <option value="tanpa"${arah === 'tanpa' ? ' selected' : ''}>Tanpa panah</option>
          <optgroup label="Perangkat">${devs.map(d => `<option value="${d.id}"${arah === String(d.id) ? ' selected' : ''}>${esc(d.nama)}</option>`).join('')}</optgroup></select></label>
        <p class="muted small">${a.kunci ? '🔒 Posisi label & panah terkunci — tidak bisa tergeser saat menata denah. Teks & warna tetap bisa diubah.'
          : 'Geser kotak untuk memindah. Tarik ujung panah (bulatan) dan lepas di atas perangkat agar panah menempel ke perangkat itu. Klik ganda label untuk mengubah teks.'}</p>
        ${S.canEdit ? `<div class="btn-row"><button type="button" class="small${a.kunci ? ' primary' : ''}" data-anot-kunci title="Pintasan K">${a.kunci ? '🔓 Buka kunci' : '🔒 Kunci posisi'}</button>
          <button type="button" class="small" data-anot-dup title="Ctrl+D">⧉ Duplikat</button>
          <button type="button" class="small danger" data-anot-hapus>Hapus label</button><span class="spacer"></span><button type="button" class="small" data-anot-selesai>Selesai</button></div>` : ''}
      </div>`;
  }
  $('#panel').addEventListener('input', e => {
    const t = e.target.closest('[data-anot-teks]');
    const a = t && anotList().find(x => x.id === S.anotSel);
    if (!a) return;
    a.teks = t.value.slice(0, 500);
    peta.setAnotasi(anotList(), S.lantai || 'F1');
    simpanAnot();
  });
  $('#panel').addEventListener('change', e => {
    const s = e.target.closest('[data-anot-arah]');
    const a = s && anotList().find(x => x.id === S.anotSel);
    if (!a) return;
    if (s.value === 'tanpa') a.panah = false;
    else {
      a.panah = true;
      const d = s.value !== 'titik' && S.model.byId.get(+s.value);
      a.ke = d ? d.id : null;
      if (d) { a.tx = d.x; a.ty = d.y; }
    }
    terapkanAnot();
    simpanAnot();
  });
  $('#panel').addEventListener('click', e => {
    const a = S.anotSel != null && anotList().find(x => x.id === S.anotSel);
    if (!a) return;
    const w = e.target.closest('[data-anot-warna]');
    if (w) {
      a.warna = w.dataset.anotWarna;
      terapkanAnot();
      renderPanel();
      return simpanAnot();
    }
    if (e.target.closest('[data-anot-kunci]')) return kunciLabel(a.id);
    if (e.target.closest('[data-anot-dup]')) return duplikatAnot(a.id);
    if (e.target.closest('[data-anot-hapus]')) return hapusAnot(a.id);
    if (e.target.closest('[data-anot-selesai]')) pilihAnot(null);
  });

  /** Label kecil lantai perangkat di daftar / laporan (kosong bila satu lantai). */
  function lantaiChip(d) {
    return multiLantai() ? `<span class="lt-chip" title="Lantai">${esc(namaLantai(d))}</span>` : '';
  }

  document.addEventListener('keydown', e => {
    if (S.tab !== 'denah' || $('#editor').hidden || document.querySelector('dialog[open]')) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'd' && S.anotSel != null && S.canEdit) {
      e.preventDefault();
      return duplikatAnot(S.anotSel);
    }
    if ((e.ctrlKey || e.metaKey) && k === 'd' && S.sel != null && S.canEdit) {
      e.preventDefault();
      return duplicateDev(S.sel);
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const arah = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
    if (k === 'escape') {
      if (peta.tool !== 'pilih') setTool('pilih');
      else if (S.sel != null) selectDev(null);
    } else if (arah && S.sel != null && S.canEdit) geserKeyboard(S.sel, arah, e.shiftKey);
    else if (k === 'tab' && S.model.list.length) {
      // Telusuri perangkat satu per satu (urutan topologi), peta mengikuti.
      const urut = NP.Model.sortDev(S.model.list.filter(d => !hiddenTypes.has(d.jenis)));
      if (!urut.length) return;
      const i = urut.findIndex(d => d.id === S.sel);
      const n = i < 0 ? (e.shiftKey ? urut.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + urut.length) % urut.length;
      selectDev(urut[n].id, true);
    } else if (k === 'u' && S.sel != null) {
      const p = S.model.parentOf(S.model.byId.get(S.sel));
      if (p) selectDev(p.id, true);
      else toast('Perangkat ini belum punya uplink');
    } else if (k === 'p' && !mqSheet.matches) togglePanel();
    else if (k === 'k' && S.anotSel != null && S.canEdit) kunciLabel(S.anotSel);
    else if (k === 'k' && S.sel != null && S.canEdit) kunciPerangkat([S.sel], !NP.terkunci(S.model.byId.get(S.sel)));
    else if (k === 'v') setTool('pilih');
    else if (k === 'l' && S.canEdit) setTool('hubung');
    else if (k === 'm') setTool('ukur');
    else if (k === 't' && S.canEdit) setTool('label');
    else if (k === 'f') peta.fit();
    else if (k === '+' || k === '=') peta.zoomBy(1.4);
    else if (k === '-') peta.zoomBy(1 / 1.4);
    else if (/^[1-9]$/.test(k) && S.canEdit) setTool('tambah:' + TYPE_ORDER[+k - 1]);
    else if ((k === 'delete' || k === 'backspace') && S.anotSel != null && S.canEdit) hapusAnot(S.anotSel);
    else if ((k === 'delete' || k === 'backspace') && S.sel != null && S.canEdit) deleteDev(S.sel);
    else return;
    e.preventDefault();
  });

  /**
   * Geser perangkat terpilih dengan tombol panah (1 px layar, Shift = 10 px). Tekan beruntun disimpan sekali
   * setelah berhenti menekan, sehingga satu Ctrl+Z mengembalikan seluruh geseran.
   */
  const geser = { id: null, x0: 0, y0: 0, t: 0 };
  function geserKeyboard(id, arah, jauh) {
    const d = S.model.byId.get(id);
    if (!d) return;
    if (NP.terkunci(d)) return toast(`Posisi ${d.nama} terkunci — tekan K atau tombol 🔒 untuk membuka`);
    if (geser.id !== id) {
      if (geser.id != null) simpanGeser();
      Object.assign(geser, { id, x0: d.x, y0: d.y });
    }
    const step = (jauh ? 10 : 1) / (peta.zoom || 1);
    const { W, H } = peta.size();
    d.x = Math.max(0, Math.min(W, d.x + arah[0] * step));
    d.y = Math.max(0, Math.min(H, d.y + arah[1] * step));
    refreshModel({ keepPanel: true });
    clearTimeout(geser.t);
    geser.t = setTimeout(simpanGeser, 450);
  }
  function simpanGeser() {
    clearTimeout(geser.t);
    const d = geser.id != null && S.model.byId.get(geser.id);
    const id = geser.id;
    geser.id = null;
    if (!d) return;
    const x = Math.round(d.x * 10) / 10, y = Math.round(d.y * 10) / 10;
    d.x = geser.x0;
    d.y = geser.y0;
    saveDev(id, { x, y }, { keepPanel: true }).catch(() => {});
  }

  // ------------------------------------------------------------------------ pintasan global, menu, riwayat

  /** Menu tarik-turun (<details class="menu">): tutup saat klik di luar atau setelah memilih item. */
  document.addEventListener('click', e => {
    $$('details.menu[open]').forEach(m => {
      if (!m.contains(e.target) || e.target.closest('.menu-pop button')) m.open = false;
    });
  });

  // Tandai kotak teks yang sedang diketik (belum tersimpan) — Ctrl+Z di situ tetap undo teks bawaan browser.
  document.addEventListener('input', e => {
    if (e.target.matches && e.target.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea')) e.target.dataset.ketik = '1';
  }, true);
  document.addEventListener('change', e => { if (e.target.dataset) delete e.target.dataset.ketik; }, true);
  document.addEventListener('focusin', e => { if (e.target.dataset) delete e.target.dataset.ketik; }, true);

  $('#btn-undo').addEventListener('click', () => jalankanRiwayat('undo'));
  $('#btn-redo').addEventListener('click', () => jalankanRiwayat('redo'));
  $('#btn-pintasan').addEventListener('click', () => $('#dlg-pintasan').showModal());
  $('#dlg-pintasan [data-close]').addEventListener('click', () => $('#dlg-pintasan').close());

  document.addEventListener('keydown', e => {
    const diEditor = !$('#editor').hidden;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const dlg = document.querySelector('dialog[open]');
    const ketik = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
    if (mod && k === 'k' && diEditor && !(dlg && dlg.id !== 'dlg-cari')) {
      e.preventDefault();
      return dlg ? dlg.close() : bukaCari();
    }
    if (dlg || !diEditor) return;
    if (mod && !e.altKey && (k === 'z' || k === 'y')) {
      // Di kotak isian: undo teks bawaan browser hanya selama sedang mengetik (belum tersimpan);
      // selebihnya (isian sudah tersimpan, dropdown, centang) = batalkan perubahan aplikasi.
      if (ketik && ketik.dataset.ketik === '1') return;
      e.preventDefault();
      if (ketik) ketik.blur();
      if (geser.id != null) simpanGeser();
      return jalankanRiwayat(k === 'y' || e.shiftKey ? 'redo' : 'undo');
    }
    if (ketik) return;
    if (e.altKey && !mod && /^[1-7]$/.test(e.key)) {
      e.preventDefault();
      return go(['denah', 'daftar', 'topologi', 'support', 'ceklis', 'port', 'proyek'][+e.key - 1]);
    }
    if (mod || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      bukaCari();
    } else if (e.key === '?') {
      e.preventDefault();
      $('#dlg-pintasan').showModal();
    }
  });

  // ------------------------------------------------------------------------ cari cepat (Ctrl+K)

  const cari = { items: [], i: 0 };

  function bukaCari() {
    if (!S.model) return;
    $('#cari-q').value = '';
    renderCari();
    $('#dlg-cari').showModal();
    $('#cari-q').focus();
  }

  /** Perintah yang bisa dijalankan dari kotak cari. */
  function perintahCari() {
    const c = [
      { t: 'Buka tab Denah', k: 'denah peta', fn: () => go('denah') },
      { t: 'Buka Daftar perangkat', k: 'daftar tabel list', fn: () => go('daftar') },
      { t: 'Buka Topologi & cek', k: 'topologi pohon cek pemeriksaan bom kebutuhan kabel', fn: () => go('topologi') },
      { t: 'Denah: tampilkan AP saja', k: 'ap access point saja filter tampilan wifi', fn: () => { go('denah'); setTimeout(() => setView('jenis:ap'), 80); } },
      { t: 'Denah: tampilkan switch saja', k: 'switch saja filter tampilan', fn: () => { go('denah'); setTimeout(() => setView('jenis:switch'), 80); } },
      { t: 'Denah: tampilkan semua perangkat', k: 'semua tampilan filter reset', fn: () => { go('denah'); setTimeout(() => setView('semua'), 80); } },
      { t: 'Buka Support & listrik (rekap listrik)', k: 'support listrik rekap daya mcb watt ups genset', fn: () => go('support') },
      { t: S.lihat ? 'Buka Info event' : 'Buka Proyek (info, denah, akses tim)', k: 'proyek info event akses tim link', fn: () => go('proyek') },
      { t: 'Cetak laporan / sheet AP', k: 'cetak print laporan sheet ap pdf', fn: () => $('#btn-print').click() },
      { t: 'Seluruh denah (zoom pas)', k: 'fit zoom seluruh denah', fn: () => { go('denah'); setTimeout(() => peta.fit(), 80); } },
      { t: 'Pintasan keyboard', k: 'bantuan help shortcut pintasan keyboard', fn: () => $('#dlg-pintasan').showModal() },
      { t: (peta.layers.kabel ? 'Sembunyikan' : 'Tampilkan') + ' progres kabel di denah', k: 'kabel progres penarikan tarik layer warna', fn: () => { go('denah'); setTimeout(() => setLayerKabel(!peta.layers.kabel), 80); } },
      { t: 'Daftar kabel yang belum ditarik', k: 'kabel belum ditarik daftar filter', fn: () => { ['#list-q', '#list-jenis', '#list-status', '#list-koneksi'].forEach(s => { $(s).value = ''; }); $('#list-kabel').value = 'belum'; go('daftar'); setTimeout(renderDaftar, 60); } },
    ];
    if (S.canEdit) {
      c.push({ t: 'Batalkan perubahan terakhir', k: 'undo batalkan', fn: () => jalankanRiwayat('undo') });
      c.push({ t: 'Kunci posisi semua perangkat', k: 'kunci lock posisi semua', fn: () => kunciPerangkat(S.list.map(d => d.id), true) });
      c.push({ t: 'Buka kunci posisi semua perangkat', k: 'buka kunci unlock posisi semua', fn: () => kunciPerangkat(S.list.map(d => d.id), false) });
      TYPE_ORDER.forEach((j, i) => c.push({
        t: 'Tambah ' + TYPES[j].label, k: 'tambah taruh baru ' + j + ' ' + TYPES[j].label, kbd: i < 9 ? String(i + 1) : '',
        fn: () => { go('denah'); setTimeout(() => setTool('tambah:' + j), 80); },
      }));
      c.push({ t: 'Unduh CSV perangkat', k: 'csv unduh export excel', fn: () => $('#btn-csv').click() });
    }
    return c;
  }

  function renderCari() {
    const q = $('#cari-q').value.trim().toLowerCase();
    const kata = q.split(/\s+/).filter(Boolean);
    const cocok = teks => kata.every(w => teks.includes(w));
    const m = S.model;
    // Perangkat: nama diutamakan (awalan nama > bagian nama > isian lain).
    const dev = m.list.map(d => {
      const nama = d.nama.toLowerCase();
      const isi = [d.nama, d.model, d.ip, d.vlan, d.pic, jenisLabel(d), ...Object.values(d.atribut || {})].join(' ').toLowerCase();
      if (q && !cocok(isi)) return null;
      return { d, skor: !q ? 0 : nama.startsWith(q) ? 0 : nama.includes(q) ? 1 : 2 };
    }).filter(Boolean).sort((a, b) => a.skor - b.skor || a.d.nama.localeCompare(b.d.nama, 'id', { numeric: true }));
    const cmd = perintahCari().filter(c => !q || cocok((c.t + ' ' + c.k).toLowerCase()));
    cari.items = [...dev.slice(0, 50).map(x => ({ dev: x.d })), ...(q ? cmd : cmd.slice(0, 6)).map(c => ({ cmd: c }))];
    cari.i = 0;
    let h = '';
    let judul = null;
    cari.items.forEach((it, i) => {
      const grup = it.dev ? 'Perangkat' + (dev.length > 50 ? ` (50 dari ${dev.length})` : ` (${dev.length})`) : 'Perintah';
      if (grup !== judul) {
        h += `<div class="cari-grup">${grup}</div>`;
        judul = grup;
      }
      if (it.dev) {
        const d = it.dev;
        const p = m.parentOf(d);
        const kon = KONEKSI[m.koneksi(d)];
        h += `<div class="cari-item" role="option" data-i="${i}">
          <i class="dotc" style="background:${NP.tampil(d).color}"></i>
          <b>${esc(d.nama)}</b><span class="muted">${esc(jenisLabel(d))}${d.ip ? ' · ' + esc(d.ip) : ''}${p ? ' · ↑ ' + esc(p.nama) : ''}</span>
          <span class="spacer"></span><span class="st st-${d.status}">${esc((STATUS[d.status] || STATUS.rencana).label)}</span>
          <span class="kon" title="${esc(kon.label)}" style="color:${kon.color}">${kon.icon}</span></div>`;
      } else {
        h += `<div class="cari-item cmd" role="option" data-i="${i}"><i class="dotc cmd">›</i><span>${esc(it.cmd.t)}</span>
          <span class="spacer"></span>${it.cmd.kbd ? `<kbd>${it.cmd.kbd}</kbd>` : ''}</div>`;
      }
    });
    $('#cari-list').innerHTML = h || '<div class="muted center cari-kosong">Tidak ada yang cocok</div>';
    tandaiCari();
  }

  function tandaiCari() {
    $$('#cari-list .cari-item').forEach(el => el.classList.toggle('aktif', +el.dataset.i === cari.i));
    const a = $('#cari-list .cari-item.aktif');
    if (a) a.scrollIntoView({ block: 'nearest' });
  }

  function pilihCari(i, keDaftar) {
    const it = cari.items[i];
    if (!it) return;
    $('#dlg-cari').close();
    if (it.cmd) return it.cmd.fn();
    const id = it.dev.id;
    if (keDaftar) {
      $('#list-q').value = it.dev.nama;
      ['#list-jenis', '#list-status', '#list-koneksi', '#list-kabel'].forEach(s => { $(s).value = ''; });
      go('daftar');
      setTimeout(renderDaftar, 60);
      return;
    }
    hiddenTypes.delete(it.dev.jenis);
    syncHidden();
    if (S.tab !== 'denah') {
      S.sel = id;
      go('denah');
      setTimeout(() => selectDev(id, true), 80);
    } else {
      selectDev(id, true);
    }
  }

  $('#btn-cari').addEventListener('click', bukaCari);
  $('#cari-q').addEventListener('input', renderCari);
  $('#cari-q').addEventListener('keydown', e => {
    const n = cari.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) cari.i = (cari.i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      tandaiCari();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pilihCari(cari.i, e.shiftKey);
    }
  });
  $('#cari-list').addEventListener('click', e => {
    const it = e.target.closest('.cari-item');
    if (it) pilihCari(+it.dataset.i, e.shiftKey);
  });
  $('#cari-list').addEventListener('mousemove', e => {
    const it = e.target.closest('.cari-item');
    if (it && +it.dataset.i !== cari.i) {
      cari.i = +it.dataset.i;
      tandaiCari();
    }
  });
  // Klik di luar kotak (latar) menutup dialog.
  $('#dlg-cari').addEventListener('click', e => { if (e.target === $('#dlg-cari')) $('#dlg-cari').close(); });

  // ------------------------------------------------------------------------ panel kanan

  function renderPanel() {
    const panel = $('#panel-body');
    if (!S.model) return;
    if (peta.tool === 'ukur') {
      panel.innerHTML = panelUkur();
      $('#sheet-title').textContent = 'Ukur jarak';
      return;
    }
    const an = S.anotSel != null && anotList().find(a => a.id === S.anotSel);
    if (an) {
      panel.innerHTML = panelAnot(an);
      $('#sheet-title').textContent = 'Label';
      return;
    }
    const d = S.sel != null && S.model.byId.get(S.sel);
    panel.innerHTML = d ? panelDev(d) : panelRingkasan();
    $('#sheet-title').textContent = d ? d.nama : 'Ringkasan · ' + S.model.list.length + ' perangkat';
    if (d) {
      renderPanelInfo();
      terapkanPnTab();
      if ($('#unit-pilih')) isiPilihanUnit(d); // stok gudang dimuat terpisah (asinkron)
    }
  }

  // ------------------------------------------------------------------------ panel sebagai lembar bawah (HP & tablet)

  const mqSheet = matchMedia('(max-width: 900px)');
  const SHEETS = ['peek', 'half', 'full'];

  function setSheet(state) {
    const p = $('#panel');
    p.dataset.sheet = state;
    $('#sheet-toggle').textContent = state === 'full' ? '▾' : '▴';
    updateInset();
  }

  /** Bagian peta yang tertutup panel (sama dengan tinggi di np.css) — agar "Pusatkan" tepat di area yang terlihat. */
  function updateInset() {
    if (!mqSheet.matches) return peta.setInset(0);
    const h = $('.peta-layout').getBoundingClientRect().height;
    const st = $('#panel').dataset.sheet;
    peta.setInset(st === 'peek' ? 52 : st === 'half' ? h * 0.5 : h);
  }
  mqSheet.addEventListener('change', updateInset);

  /** Buka panel minimal setengah layar (dipanggil saat perangkat dipilih di HP/tablet). */
  function openSheet() {
    if (mqSheet.matches && $('#panel').dataset.sheet === 'peek') setSheet('half');
  }

  $('#sheet-toggle').addEventListener('click', e => {
    e.stopPropagation();
    const cur = $('#panel').dataset.sheet;
    setSheet(cur === 'full' ? 'peek' : cur === 'half' ? 'full' : 'half');
  });

  // Geser bar ke atas/bawah untuk mengubah tinggi panel; ketuk bar = buka/tutup.
  (function () {
    const bar = $('#sheet-bar');
    let startY = null;
    bar.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      startY = e.clientY;
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointerup', e => {
      if (startY == null) return;
      const dy = e.clientY - startY;
      startY = null;
      const i = SHEETS.indexOf($('#panel').dataset.sheet);
      if (Math.abs(dy) < 8) setSheet(i === 0 ? 'half' : 'peek');
      else setSheet(SHEETS[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1) * (Math.abs(dy) > 220 ? 2 : 1)))]);
    });
    bar.addEventListener('pointercancel', () => { startY = null; });
  })();

  // Kontrol lapisan: di layar kecil dilipat ke tombol ☰, tertutup lagi saat peta disentuh.
  function setLayersOpen(open) {
    $('#map-layers').classList.toggle('open', open);
    $('#btn-layers').setAttribute('aria-expanded', open);
  }
  $('#btn-layers').addEventListener('click', () => setLayersOpen(!$('#map-layers').classList.contains('open')));
  $('#map').addEventListener('pointerdown', () => setLayersOpen(false));
  // Tutup popover tampilan peta saat klik di luar atau Esc.
  document.addEventListener('pointerdown', e => {
    if ($('#map-layers').classList.contains('open') && !e.target.closest('#map-layers, #btn-layers')) setLayersOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#map-layers').classList.contains('open')) setLayersOpen(false);
  });

  // Rel alat ringkas: nama alat sebagai tooltip di kanan ikon (desktop; layar sentuh memakai title bawaan).
  (() => {
    const tip = document.createElement('div');
    tip.className = 'tb-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
    const tb = $('#toolbar');
    tb.addEventListener('pointerover', e => {
      const b = e.target.closest('.tool');
      if (!b || e.pointerType === 'touch' || matchMedia('(max-width: 640px)').matches) return;
      if (!b.dataset.tip) b.dataset.tip = b.title;
      b.removeAttribute('title'); // hindari tooltip ganda dari browser
      const m = b.dataset.tip.match(/^(.*) \((.+)\)$/);
      tip.innerHTML = m ? `${esc(m[1])}<kbd>${esc(m[2])}</kbd>` : esc(b.dataset.tip);
      const r = b.getBoundingClientRect();
      tip.style.left = r.right + 10 + 'px';
      tip.style.top = r.top + r.height / 2 + 'px';
      tip.hidden = false;
    });
    tb.addEventListener('pointerout', e => { if (!e.relatedTarget || !tb.contains(e.relatedTarget)) tip.hidden = true; });
    tb.addEventListener('scroll', () => { tip.hidden = true; });
    tb.addEventListener('click', () => { tip.hidden = true; });
  })();

  // Lebar panel kanan bisa diatur dengan menyeret tepi kirinya (280–560 px, disimpan per browser; klik ganda = bawaan).
  (() => {
    const lay = $('.peta-layout');
    const grip = document.createElement('div');
    grip.className = 'panel-grip';
    grip.title = 'Seret untuk mengubah lebar panel · klik ganda = lebar bawaan';
    lay.appendChild(grip);
    const pasang = w => {
      if (w) lay.style.setProperty('--panel-w', w + 'px');
      else lay.style.removeProperty('--panel-w');
    };
    try { const w = +localStorage.getItem('np-panel-w'); if (w >= 280 && w <= 560) pasang(w); } catch (err) { /* abaikan */ }
    let mulai = null;
    grip.addEventListener('pointerdown', e => {
      mulai = { x: e.clientX, w: $('#panel').getBoundingClientRect().width };
      grip.setPointerCapture(e.pointerId);
      document.body.classList.add('geser-panel');
    });
    grip.addEventListener('pointermove', e => {
      if (!mulai) return;
      pasang(Math.round(Math.min(560, Math.max(280, mulai.w + (mulai.x - e.clientX)))));
    });
    const selesai = () => {
      if (!mulai) return;
      mulai = null;
      document.body.classList.remove('geser-panel');
      const w = Math.round($('#panel').getBoundingClientRect().width);
      try { localStorage.setItem('np-panel-w', w); } catch (err) { /* abaikan */ }
      requestAnimationFrame(updateInset);
    };
    grip.addEventListener('pointerup', selesai);
    grip.addEventListener('pointercancel', selesai);
    grip.addEventListener('dblclick', () => {
      pasang(0);
      try { localStorage.removeItem('np-panel-w'); } catch (err) { /* abaikan */ }
      requestAnimationFrame(updateInset);
    });
  })();

  // Peta layar penuh: sembunyikan header & tab (dan bar browser bila Fullscreen API tersedia, mis. Android).
  function setFull(on) {
    document.body.classList.toggle('map-full', on);
    $('#btn-full').setAttribute('aria-pressed', on);
    $('#btn-full').textContent = on ? '✕' : '⛶';
    $('#btn-full').title = on ? 'Keluar layar penuh' : 'Peta layar penuh';
    const fs = document.fullscreenElement;
    if (on && !fs && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && fs && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    requestAnimationFrame(updateInset);
  }
  $('#btn-full').addEventListener('click', () => setFull(!document.body.classList.contains('map-full')));

  // Panel kanan (desktop) bisa disembunyikan agar denah lebih luas. Saat tersembunyi, memilih perangkat tetap
  // membuka panel sementara (untuk isian), dan panel tertutup lagi setelah pilihan dilepas. Disimpan per browser.
  const panelSt = { tutup: false, sementara: false };
  try { panelSt.tutup = localStorage.getItem('np-panel') === 'tutup'; } catch (err) { /* abaikan */ }

  function terapkanPanel() {
    const tutup = panelSt.tutup && !panelSt.sementara;
    $('.peta-layout').classList.toggle('panel-tutup', tutup);
    const b = $('#btn-panel');
    b.setAttribute('aria-pressed', String(!panelSt.tutup));
    b.title = panelSt.tutup ? 'Tampilkan panel kanan (P)' : 'Sembunyikan panel kanan (P)';
  }

  function togglePanel() {
    panelSt.tutup = !panelSt.tutup;
    panelSt.sementara = false;
    try { localStorage.setItem('np-panel', panelSt.tutup ? 'tutup' : 'buka'); } catch (err) { /* abaikan */ }
    terapkanPanel();
  }

  /** Dipanggil saat pilihan perangkat berubah. */
  function panelIkutPilihan(id) {
    if (!panelSt.tutup) return;
    panelSt.sementara = id != null;
    terapkanPanel();
  }

  $('#btn-panel').addEventListener('click', togglePanel);
  terapkanPanel();
  // Keluar dari fullscreen lewat tombol Back / Esc browser -> kembalikan tampilan.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('map-full')) setFull(false);
  });

  /** Contoh garis untuk legenda (sama dengan gaya garis di peta, termasuk tepi putih). */
  function lineLegend() {
    const sample = (color, dash, w) => `<svg width="34" height="10"><line x1="3" y1="5" x2="31" y2="5" stroke="#fff" stroke-width="${w + 3}" stroke-linecap="round"/>` +
      `<line x1="3" y1="5" x2="31" y2="5" stroke="${color}" stroke-width="${w}" stroke-dasharray="${dash}" stroke-linecap="round"/></svg>`;
    return ['utp', 'fiber', 'wireless'].map(k => ({ svg: sample(MEDIA[k].color, MEDIA[k].dash, 4), label: MEDIA[k].label }))
      .concat([
        { svg: sample(KONEKSI.offline.color, '1 7', 4.5), label: 'Belum membawa internet' },
        { svg: sample(KONEKSI.gangguan.color, '10 5', 4), label: 'Ada gangguan di jalur' },
      ]);
  }

  /** Rincian endpoint per tipe di legenda ringkasan, mis. "Laptop 3 · Printer network 1". */
  function epRincian(m) {
    const n = new Map();
    m.list.forEach(d => {
      if (d.jenis !== 'endpoint') return;
      const e = NP.tipeEp(d);
      const k = e ? e.id : 0;
      if (!n.has(k)) n.set(k, { e, jumlah: 0 });
      n.get(k).jumlah++;
    });
    return `<div class="ep-rincian">${[...n.values()].map(x => x.e
      ? `<span><i style="background:${esc(x.e.warna)}">${NP.ikonSvg(x.e.ikon, 11)}</i>${esc(x.e.nama)} <b>${x.jumlah}</b></span>`
      : `<span class="muted">tanpa tipe <b>${x.jumlah}</b></span>`).join('')}</div>`;
  }

  /** Chip perangkat yang bisa diklik untuk memilihnya di denah. */
  function chipDev(x) {
    return `<button type="button" class="chip" data-sel="${x.id}"><i style="background:${NP.tampil(x).color}"></i>${esc(x.nama)}</button>`;
  }

  /** Lencana status internet, mis. "✓ Terhubung". */
  function konBadge(k) {
    const K = KONEKSI[k];
    return `<span class="kon kon-${k}"><i>${K.icon}</i>${esc(K.short)}</span>`;
  }

  // ------------------------------------------------------------------------ penarikan kabel

  const KABEL = NP.KABEL;
  const kbSpan = k => {
    k = KABEL[k] ? k : 'belum';
    return `<span class="kb kb-${k}"${k !== 'belum' ? ` style="background:${KABEL[k].color}"` : ''}>${KABEL[k].icon} ${esc(KABEL[k].short)}</span>`;
  };
  const kabelBadge = d => kbSpan(NP.kabelSt(d));
  /** Badge yang bisa diklik untuk membuka pemilih status (daftar & pohon topologi). */
  const kabelBadgeBtn = d => {
    const k = NP.kabelSt(d);
    return `<button type="button" class="kb kb-${k}"${k !== 'belum' ? ` style="background:${KABEL[k].color}"` : ''} data-kb-pop="${d.id}" title="${esc(KABEL[k].label)} — klik untuk ubah">${KABEL[k].icon} ${esc(KABEL[k].short)} ▾</button>`;
  };
  /** Boleh mengubah status kabel perangkat ini: admin, atau tim update status pada kategori tugasnya. */
  const bolehKabel = d => S.canEdit || (bolehStatus() && (!d || tugasTim(d)));

  const LANGKAH = ['belum', 'ditarik', 'terminasi', 'dites'];

  /**
   * Pemilih status kabel bertahap: 4 langkah (Belum → Ditarik → Terminasi → Dites) + tombol "lanjut" ke tahap
   * berikutnya (aksi paling sering, satu klik) + Bermasalah terpisah. ids = perangkat yang diubah.
   */
  // ------------------------------------------------------------------------ script MikroTik (router)

  const MT = NP.Mikrotik;
  const ZONA = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore', 'UTC'];

  /** Tab MikroTik: hanya hasil (validasi, script, salin / unduh); konfigurasinya diisi sekali di tab Router. */
  function mtPanelHtml(d) {
    return `<div class="pn-sec mt-panel">
      <h4>Script MikroTik <span class="small">RouterOS v7 · .rsc</span></h4>
      <p class="muted small" style="margin:0 0 6px">Script dibuat dari konfigurasi di tab <b>Router</b>. <button type="button" class="small ghost" data-pt-go="jenis">Ubah konfigurasi →</button></p>
      <div id="mt-hasil">${mtHasilHtml(d)}</div>
    </div>`;
  }

  /**
   * Satu-satunya form konfigurasi router (tab Router): sistem, WAN, LAN & DHCP, VLAN, keamanan, bandwidth.
   * Isian router lama (subnet LAN, pool, lease, DNS, admin, hotspot) tetap dipakai — tidak ada isian kembar.
   */
  function mtFormHtml(d) {
    const m = S.model;
    const r = MT.rangkum(d, m);
    const mt = r.mt;
    const a = d.atribut || {};
    const inp = (key, label, ph, extra) => `<label class="field${extra && extra.wide ? ' wide' : ''}"><span>${label}</span><input type="${(extra && extra.type) || 'text'}" data-mt="${key}" value="${esc(mt[key] == null ? '' : mt[key])}" placeholder="${esc(ph || '')}"></label>`;
    const cek = (key, label, hint) => `<label class="check mt-cek"><input type="checkbox" data-mt="${key}"${mt[key] ? ' checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
    const fld = (k, label, ph, type) => `<label class="field"><span>${label}</span><input type="${type || 'text'}" data-f="${k}" data-attr="1" value="${esc(a[k] || '')}" placeholder="${esc(ph || '')}"${type === 'password' ? ' autocomplete="new-password"' : ''}></label>`;
    const sec = (n, judul, isi) => `<details class="mt-sec"${n <= 2 ? ' open' : ''}><summary><span class="mt-no">${n}</span>${judul}</summary><div class="mt-isi">${isi}</div></details>`;

    // 1. Sistem
    const s1 = `<div class="fgrid">
        ${inp('identitas', 'Identitas router', d.nama)}
        <label class="field"><span>Zona waktu</span><select data-mt="tz">${ZONA.map(z => `<option${mt.tz === z ? ' selected' : ''}>${z}</option>`).join('')}</select></label>
        ${inp('ntp', 'Server NTP', MT.DEF.ntp)}
        ${inp('jumlah_port', 'Jumlah port ether', String(r.lan.nPort), { type: 'number' })}
      </div>`;

    // 2. WAN
    const s2 = r.wans.length ? r.wans.map(w => {
      const k = w.isp.id;
      const c = mt.wan[k] || {};
      const v = key => esc(c[key] == null ? '' : c[key]);
      return `<div class="mt-wan">
        <div class="mt-wan-h"><span class="wan-no">WAN${w.no}</span><b>${esc(w.isp.nama)}</b><span class="muted small">${esc((w.isp.atribut || {}).provider || '')}${w.down ? ' · ' + fmtBw(w.down) : ''}${w.lewat ? ' · lewat ' + esc(w.lewat.nama) : ''}</span></div>
        <div class="fgrid">
          <label class="field"><span>Port di router${w.otomatis ? ' <span class="bad small">belum diisi</span>' : ''}</span><input type="text" data-mt-wanport="${k}" value="${w.otomatis ? '' : esc(w.iface)}" placeholder="${esc(w.iface)} (otomatis)" title="Sama dengan port di tab Koneksi — peta port & script ikut berubah"></label>
          <label class="field"><span>Tipe</span><select data-mt-wan="${k}:tipe">${[['dhcp', 'DHCP client'], ['pppoe', 'PPPoE'], ['statis', 'IP statis']].map(([x, l]) => `<option value="${x}"${w.tipe === x ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          ${w.tipe === 'pppoe' ? `<label class="field"><span>User PPPoE</span><input type="text" data-mt-wan="${k}:user" value="${v('user')}" autocomplete="off"></label>
            <label class="field"><span>Password PPPoE</span><input type="password" data-mt-wan="${k}:pass" value="${v('pass')}" autocomplete="new-password"></label>` : ''}
          ${w.tipe === 'statis' ? `<label class="field"><span>IP / prefix</span><input type="text" data-mt-wan="${k}:ip" value="${v('ip')}" placeholder="${esc((w.isp.atribut || {}).ip_publik || '203.0.113.10/29')}"></label>` : ''}
          ${w.tipe === 'statis' || (r.wans.length > 1 && r.mode === 'loadbalance' && w.tipe === 'dhcp') ? `<label class="field"><span>Gateway</span><input type="text" data-mt-wan="${k}:gw" value="${v('gw')}" placeholder="${esc((w.isp.atribut || {}).gateway || '203.0.113.9')}"></label>` : ''}
        </div>
      </div>`;
    }).join('') + (r.wans.length > 1 ? `<label class="field"><span>Mode multi-WAN</span><select data-mt-mode>
        <option value="failover"${r.mode === 'failover' ? ' selected' : ''}>Failover (WAN berikutnya cadangan)</option>
        <option value="loadbalance"${r.mode === 'loadbalance' ? ' selected' : ''}>Load balance PCC</option></select></label>` : '')
      : '<p class="note">Router belum tersambung ke Sumber WAN/ISP. Sambungkan uplink router ke titik WAN di denah (atau tambah WAN di tab Koneksi).</p>';

    // 3. LAN
    const s3 = `<div class="fgrid">
        ${inp('lan_ip', 'IP LAN router (CIDR)', r.lan.ip || '10.10.0.1/22')}
        ${inp('lan_iface', 'Port LAN (bridge)', r.lan.ifaces.join(', '))}
        ${fld('dhcp', 'Pool DHCP', r.lan.pool ? MT.ipStr(r.lan.pool[0]) + ' – ' + MT.ipStr(r.lan.pool[1]) : '10.10.1.10 – 10.10.3.250')}
        ${fld('lease', 'Lease DHCP', '30m')}
        ${fld('dns', 'DNS upstream', '1.1.1.1, 8.8.8.8')}
      </div>
      <p class="muted small">Kosong = otomatis dari IP router & port yang bukan WAN. Event ramai: subnet /22 dan lease pendek (10–30m).</p>`;

    // 4. VLAN
    const vlanDev = [...new Set(m.list.map(x => parseInt(x.vlan, 10)).filter(v => v >= 2 && v <= 4094))].filter(v => !mt.vlan.some(x => +x.id === v));
    const s4 = `${mt.vlan.length ? `<table class="mini mt-vlan mt-vdef"><colgroup><col style="width:15%"><col style="width:22%"><col style="width:36%"><col style="width:10%"><col style="width:10%"><col style="width:7%"></colgroup><tr><th>ID</th><th>Nama</th><th>Gateway (CIDR)</th><th class="center" title="DHCP server">DHCP</th><th class="center" title="Isolasi: hanya boleh ke internet, tidak ke LAN/VLAN lain">Iso.</th><th></th></tr>${mt.vlan.map((v, i) => `<tr>
        <td><input type="number" data-mt-vlan="${i}:id" value="${esc(v.id || '')}" min="2" max="4094"></td>
        <td><input type="text" data-mt-vlan="${i}:nama" value="${esc(v.nama || '')}" placeholder="TAMU"></td>
        <td><input type="text" data-mt-vlan="${i}:ip" value="${esc(v.ip || '')}" placeholder="10.10.${esc(v.id || 'X')}.1/24"></td>
        <td class="center"><input type="checkbox" data-mt-vlan="${i}:dhcp"${v.dhcp !== false ? ' checked' : ''}></td>
        <td class="center"><input type="checkbox" data-mt-vlan="${i}:isolasi"${v.isolasi ? ' checked' : ''}></td>
        <td><button type="button" class="icon" data-mt-vlan-hapus="${i}" title="Hapus VLAN">✕</button></td></tr>`).join('')}</table>` : '<p class="muted small">Belum ada VLAN — semua perangkat di satu jaringan LAN.</p>'}
      <div class="btn-row"><button type="button" class="small" data-mt-vlan-tambah>+ Tambah VLAN</button>
        ${vlanDev.length ? `<button type="button" class="small" data-mt-vlan-dari="${vlanDev.join(',')}">Ambil dari perangkat (VLAN ${vlanDev.join(', ')})</button>` : ''}</div>
      ${r.vlan.length ? vlanPortTabel(r) : ''}`;

    // 5. Keamanan
    const s5 = `${cek('firewall', 'Firewall dasar', 'Tolak akses router dari WAN, buang paket invalid, fasttrack (bila tanpa limit).')}
      ${cek('layanan', 'Kunci layanan manajemen', 'Matikan telnet/ftp/www/api; winbox & SSH hanya dari LAN.')}
      <div class="fgrid">${fld('user_admin', 'User admin baru', 'mis. netadmin')}${fld('pass_admin', 'Password admin', 'min. 8 karakter', 'password')}</div>
      ${cek('matikan_admin', 'Nonaktifkan user "admin" bawaan', 'Setelah user baru dibuat.')}
      <label class="field"><span>Hotspot / captive portal</span><select data-f="hotspot" data-attr="1">${['', 'Tidak', 'Ya (hotspot router)', 'Ya (controller/cloud)'].map(o => `<option value="${esc(o)}"${(a.hotspot || '') === o ? ' selected' : ''}>${esc(o || '—')}</option>`).join('')}</select></label>`;

    // 6. Bandwidth
    const s6 = `${cek('bw_aktif', 'Limit bandwidth per user (PCQ)', 'Bandwidth dibagi rata antar pengguna aktif, maksimal per user sesuai isian.')}
      <div class="fgrid">
        ${inp('bw_down', 'Per user download (Mbps)', '5', { type: 'number' })}
        ${inp('bw_up', 'Per user upload (Mbps)', '2', { type: 'number' })}
        ${inp('bw_tot_down', 'Total download (Mbps)', String(r.bw.totDown || ''), { type: 'number' })}
        ${inp('bw_tot_up', 'Total upload (Mbps)', String(r.bw.totUp || ''), { type: 'number' })}
      </div>
      ${a.qos ? `<p class="muted small">Catatan QoS lama: <i>${esc(a.qos)}</i></p>` : ''}`;

    const nErr = MT.validasi(r).filter(c => c.level === 'err').length;
    return `<div class="mt-form">
      ${sec(1, 'Sistem', s1)}${sec(2, `WAN <span class="muted small">${r.wans.length} sumber</span>`, s2)}${sec(3, 'LAN & DHCP', s3)}
      ${sec(4, `VLAN <span class="muted small">${mt.vlan.length}</span>`, s4)}${sec(5, 'Keamanan & admin', s5)}${sec(6, 'Bandwidth', s6)}
      <div class="mt-status"><span class="mt-st ${nErr ? 'bad' : 'ok'}">${nErr ? `${nErr} perlu diperbaiki` : '✓ konfigurasi lengkap'}</span>
        <button type="button" class="small" data-pt-go="mikrotik">Lihat script MikroTik →</button></div>
    </div>`;
  }

  /** Validasi + script + tombol salin / unduh. */
  function mtHasilHtml(d) {
    const r = MT.rangkum(d, S.model);
    const cek = MT.validasi(r);
    const nErr = cek.filter(c => c.level === 'err').length;
    const script = MT.buat(d, S.model, S.proyek);
    return `<div class="mt-hasil-h"><b>Hasil</b>
        <span class="mt-st ${nErr ? 'bad' : 'ok'}">${nErr ? `${nErr} perlu diperbaiki` : '✓ siap dipakai'}</span>
        <span class="spacer"></span>
        <button type="button" class="small" data-mt-salin>⧉ Salin script</button>
        <button type="button" class="small primary" data-mt-unduh>⬇ Unduh .rsc</button></div>
      ${cek.length ? `<ul class="issues">${cek.map(c => `<li class="lv-${c.level}">${esc(c.msg)}</li>`).join('')}</ul>` : ''}
      <details class="mt-cara"><summary>Cara memasang di router</summary><ol>
        <li>Reset router tanpa konfigurasi bawaan: <code>/system reset-configuration no-defaults=yes skip-backup=yes</code></li>
        <li>Login lewat Winbox → <i>Neighbors</i> (MAC address), seret file <b>${esc(nmFile(r.identitas))}</b> ke menu <i>Files</i>.</li>
        <li>Di Terminal: <code>/import file-name=${esc(nmFile(r.identitas))} verbose=yes</code></li>
        <li>Login ulang dengan user admin baru, cek internet dari laptop LAN.</li>
      </ol><p class="muted small">Alternatif: salin script lalu tempel di Terminal Winbox (router sudah reset).</p></details>
      <pre class="mt-script">${esc(script)}</pre>`;
  }
  const nmFile = s => (String(s || 'router').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'router') + '.rsc';

  /** Simpan perubahan konfigurasi MikroTik (atribut "mt"), lalu perbarui hasil tanpa merender ulang form. */
  /**
   * Tabel VLAN per port LAN router (ether2, ether3, ...): trunk / access / LAN saja. Port yang tersambung ke perangkat
   * menyimpan pilihan di perangkat itu (sama dengan kotak VLAN di tab Koneksi); port kosong di mt.port.
   */
  function vlanPortTabel(r) {
    const dis = S.canEdit ? '' : ' disabled';
    const rows = r.portVlan.map(p => {
      const cfg = p.dev ? { mode: (p.dev.atribut || {}).vlan_mode || '', izin: (p.dev.atribut || {}).vlan_izin || '' } : (r.mt.port[p.iface] || {});
      const mode = cfg.mode || '';
      const k = esc(p.iface);
      const isi = p.lv.mode === 'trunk' ? `<span class="vl vl-trunk">T ${p.lv.tagged.join(',') || '—'}</span>`
        : p.lv.mode === 'access' ? `<span class="vl vl-access">A ${p.lv.untagged}</span>` : '<span class="muted small">LAN</span>';
      const ph = p.dev ? (p.lv.butuh.join(',') || 'mis. 10,20') : r.vlanIds.join(',');
      return `<tr>
        <td><b class="mono">${k}</b><br>${p.dev ? `<a href="#" class="small" data-sel="${p.dev.id}">${esc(p.dev.nama)}</a>` : '<span class="muted small">kosong</span>'}${p.ganda ? ' <span class="bad small">dobel</span>' : ''}</td>
        <td><select data-mt-port="${k}:mode" title="Mode port ${k}"${dis}>
          <option value=""${!mode ? ' selected' : ''}>Otomatis</option>
          <option value="trunk"${mode === 'trunk' ? ' selected' : ''}>Trunk</option>
          <option value="access"${mode === 'access' ? ' selected' : ''}>Access</option>
          <option value="native"${mode === 'native' ? ' selected' : ''}>LAN saja</option></select></td>
        <td>${mode === 'trunk' || mode === 'access' ? `<input type="text" data-mt-port="${k}:izin" value="${esc(cfg.izin || '')}" placeholder="${esc(mode === 'access' ? ph.split(',')[0] : ph)}" title="${mode === 'trunk' ? 'VLAN diizinkan, dipisah koma' : 'Satu VLAN access'}"${dis}>` : ''}<div class="vp-hasil">${isi}</div></td></tr>`;
    }).join('');
    return `<h4 class="mt-sub" style="margin:12px 0 4px">VLAN per port</h4>
      <table class="mini mt-vlan mt-vport"><colgroup><col style="width:36%"><col style="width:32%"><col style="width:32%"></colgroup><tr><th>Port</th><th>Mode</th><th title="Trunk: VLAN diizinkan (kosong = sesuai kebutuhan). Access: satu VLAN.">VLAN</th></tr>${rows}</table>
      <p class="muted small">Otomatis = dari VLAN perangkat di port itu & di bawahnya; port kosong = trunk semua VLAN. Trunk: VLAN dipisah koma (10,20). Access: satu VLAN untagged.</p>`;
  }

  function simpanMt(d, ubah, renderForm) {
    // ubah = null: hanya render ulang (data sudah disimpan di tempat lain).
    if (ubah) {
      const mt = MT.baca(d);
      ubah(mt);
      const atr = Object.assign({}, d.atribut, { mt: JSON.stringify(mt) });
      saveDev(d.id, { atribut: atr }, { keepPanel: true }).catch(() => {});
    }
    const form = $('#panel .mt-form');
    if (renderForm && form) {
      const buka = $$('details.mt-sec', form).map(x => x.open);
      form.outerHTML = mtFormHtml(S.model.byId.get(d.id));
      $$('#panel .mt-form details.mt-sec').forEach((x, i) => { if (buka[i] != null) x.open = buka[i]; });
    }
    perbaruiHasilMt();
  }
  /** Perbarui hasil script (tab MikroTik) & status form (tab Router) setelah isian berubah. */
  function perbaruiHasilMt() {
    if (S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    const h = $('#mt-hasil');
    if (h) h.innerHTML = mtHasilHtml(d);
    const st = $('#panel .mt-status .mt-st');
    if (st) {
      const nErr = MT.validasi(MT.rangkum(d, S.model)).filter(c => c.level === 'err').length;
      st.className = 'mt-st ' + (nErr ? 'bad' : 'ok');
      st.textContent = nErr ? `${nErr} perlu diperbaiki` : '✓ konfigurasi lengkap';
    }
  }
  // Pindah tab panel dari tombol (mis. "Lihat script MikroTik →").
  $('#panel').addEventListener('click', e => {
    const b = e.target.closest('[data-pt-go]');
    if (!b) return;
    const tab = $(`#panel .pn-tabs [data-pt="${b.dataset.ptGo}"]`);
    if (tab) tab.click();
  });

  // Port WAN diubah di tab Koneksi -> form Router (port WAN, VLAN per port) & hasil script ikut diperbarui.
  $('#panel').addEventListener('change', e => {
    if (!e.target.matches('[data-f="port_lokal"], [data-wan-port]') || S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    if (d && d.jenis === 'router' && $('#panel .mt-form')) setTimeout(() => simpanMt(S.model.byId.get(S.sel), null, true), 60);
  });
  $('#panel').addEventListener('change', e => {
    const box = e.target.closest('.mt-form');
    if (!box || S.sel == null || !S.canEdit) return;
    const d = S.model.byId.get(S.sel);
    const t = e.target;
    const nilai = t.type === 'checkbox' ? t.checked : t.value.trim();
    if (t.dataset.mt) return simpanMt(d, mt => { mt[t.dataset.mt] = nilai; });
    if (t.dataset.mtWan) {
      const [k, f] = t.dataset.mtWan.split(':');
      // Ganti tipe WAN mengubah isian yang tampil (PPPoE / statis) -> form dirender ulang.
      return simpanMt(d, mt => { mt.wan[k] = Object.assign({}, mt.wan[k] || {}, { [f]: nilai }); }, f === 'tipe');
    }
    if (t.dataset.mtVlan) {
      const [i, f] = t.dataset.mtVlan.split(':');
      return simpanMt(d, mt => { mt.vlan[+i] = Object.assign({}, mt.vlan[+i] || {}, { [f]: f === 'id' ? parseInt(nilai, 10) || '' : nilai }); });
    }
    if (t.dataset.mtWanport) {
      // Port WAN disimpan di topologi (port di perangkat ini / port WAN tambahan), bukan di konfigurasi MikroTik.
      const id = +t.dataset.mtWanport;
      const w = MT.rangkum(d, S.model).wans.find(x => x.isp.id === id);
      if (!w) return;
      const mt = MT.baca(d);
      if (mt.wan[id]) delete mt.wan[id].iface;
      const atr = Object.assign({}, d.atribut, { mt: JSON.stringify(mt) });
      const patch = { atribut: atr };
      if (w.utama) patch.port_lokal = nilai;
      else {
        let arr = [];
        try { arr = JSON.parse(atr.wan_lain || '[]') || []; } catch (er) { arr = []; }
        arr.forEach(x => { if (+x.id === id) x.port = nilai; });
        atr.wan_lain = JSON.stringify(arr);
      }
      // Isian port yang sama di tab Koneksi ikut diperbarui.
      const kon = $(w.utama ? '#panel [data-f="port_lokal"]' : `#panel [data-wan-port="${id}"]`);
      if (kon) kon.value = nilai;
      return saveDev(d.id, patch, { keepPanel: true }).then(() => simpanMt(S.model.byId.get(d.id), null, true)).catch(() => {});
    }
    if (t.dataset.mtPort) {
      const [ifc, f] = t.dataset.mtPort.split(':');
      const p = MT.rangkum(d, S.model).portVlan.find(x => x.iface === ifc);
      const ulang = f === 'mode';
      if (p && p.dev) {
        // Port tersambung: simpan di perangkatnya, sama dengan kotak VLAN di tab Koneksi perangkat itu.
        const atr = Object.assign({}, p.dev.atribut, { [f === 'mode' ? 'vlan_mode' : 'vlan_izin']: nilai });
        return saveDev(p.dev.id, { atribut: atr }, { keepPanel: true }).then(() => simpanMt(S.model.byId.get(d.id), null, ulang)).catch(() => {});
      }
      return simpanMt(d, mt => {
        const cfg = Object.assign({}, mt.port[ifc] || {}, { [f]: nilai });
        if (!cfg.mode && !cfg.izin) delete mt.port[ifc]; else mt.port[ifc] = cfg;
      }, ulang);
    }
    if (t.hasAttribute('data-mt-mode')) {
      const atr = Object.assign({}, d.atribut, { wan_mode: t.value });
      return saveDev(d.id, { atribut: atr }, { keepPanel: true }).then(() => simpanMt(S.model.byId.get(d.id), () => {}, true)).catch(() => {});
    }
    // Isian router biasa (pool DHCP, lease, DNS, admin) disimpan oleh handler umum -> perbarui hasil sesudahnya.
    if (t.dataset.f) setTimeout(perbaruiHasilMt, 30);
  });
  $('#panel').addEventListener('click', e => {
    if (!e.target.closest('.mt-form, [data-pp="mikrotik"]') || S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    if (e.target.closest('[data-mt-vlan-tambah]')) return simpanMt(d, mt => { mt.vlan.push({ id: '', nama: '', ip: '', dhcp: true }); }, true);
    const hapus = e.target.closest('[data-mt-vlan-hapus]');
    if (hapus) return simpanMt(d, mt => { mt.vlan.splice(+hapus.dataset.mtVlanHapus, 1); }, true);
    const dari = e.target.closest('[data-mt-vlan-dari]');
    if (dari) {
      return simpanMt(d, mt => {
        dari.dataset.mtVlanDari.split(',').map(Number).forEach(id => mt.vlan.push({ id, nama: 'VLAN' + id, ip: `10.${Math.floor(id / 256) + 20}.${id % 256}.1/24`, dhcp: true }));
      }, true);
    }
    const r = MT.rangkum(d, S.model);
    if (e.target.closest('[data-mt-salin]')) return copy(MT.buat(d, S.model, S.proyek)).then(() => toast('Script MikroTik disalin — tempel di Terminal Winbox'));
    if (e.target.closest('[data-mt-unduh]')) {
      downloadBlob(new Blob([MT.buat(d, S.model, S.proyek).replace(/\n/g, '\r\n')], { type: 'text/plain' }), nmFile(r.identitas));
      return toast(`${nmFile(r.identitas)} diunduh`);
    }
  });

  // ------------------------------------------------------------------------ salin SSID & password WiFi

  const SAMAR = '••••••';
  /** Nilai WiFi terkini: isian di panel (bila sedang dibuka, walau belum tersimpan) atau data tersimpan. */
  function nilaiWifi(d) {
    const ambil = k => {
      const el = $(`#panel [data-f="${k}"]`);
      return (el ? el.value : (d.atribut || {})[k] || '').trim();
    };
    return { ssid: ambil('ssid'), pass: ambil('password') };
  }

  /** Kotak salin SSID / password / keduanya (ringkas = baris di tab Info). */
  function wifiCopyHtml(d, ringkas) {
    const a = d.atribut || {};
    const samar = a.password === SAMAR;
    const btn = (k, l, title) => `<button type="button" class="small" data-wifi-copy="${k}" title="${title}">${l}</button>`;
    return `<div class="wifi-copy${ringkas ? ' ringkas' : ''}">
      <div class="wifi-copy-v"><span class="muted small">WiFi</span><b class="mono">${esc(a.ssid || '—')}</b>${a.password ? `<span class="muted small">· ${samar ? 'password disamarkan' : 'password terisi'}</span>` : ''}</div>
      <div class="btn-row">${btn('ssid', '⧉ SSID', 'Salin SSID ke clipboard')}${samar ? '' : btn('pass', '⧉ Password', 'Salin password WiFi ke clipboard')}${samar ? '' : btn('both', '⧉ SSID + password', 'Salin SSID dan password sekaligus')}</div>
    </div>`;
  }

  $('#panel').addEventListener('click', e => {
    const b = e.target.closest('[data-wifi-copy]');
    if (!b || S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    const w = nilaiWifi(d);
    if (b.dataset.wifiCopy !== 'ssid' && w.pass === SAMAR) return toast('Password disamarkan di link ini', true);
    const teks = b.dataset.wifiCopy === 'ssid' ? w.ssid : b.dataset.wifiCopy === 'pass' ? w.pass : `SSID: ${w.ssid}\nPassword: ${w.pass || '(tanpa password)'}`;
    if (!teks || (b.dataset.wifiCopy === 'ssid' && !w.ssid) || (b.dataset.wifiCopy === 'pass' && !w.pass)) return toast(b.dataset.wifiCopy === 'pass' ? 'Password WiFi belum diisi' : 'SSID belum diisi', true);
    copy(teks).then(() => toast(b.dataset.wifiCopy === 'ssid' ? `SSID "${w.ssid}" disalin` : b.dataset.wifiCopy === 'pass' ? 'Password WiFi disalin' : 'SSID & password disalin'));
  });

  // ------------------------------------------------------------------------ VLAN per port (trunk / access)

  /** Lencana mode VLAN kabel uplink perangkat: T 10,20 (trunk) / A 20 (access); kosong bila native. */
  function vlanBadge(d) {
    const lv = S.model.linkVlan(d);
    if (lv.mode === 'native') return '';
    const isi = lv.mode === 'trunk' ? 'T ' + (lv.tagged.join(',') || '—') : 'A ' + lv.untagged;
    return `<span class="vl vl-${lv.mode}${lv.auto ? '' : ' manual'}" title="${lv.mode === 'trunk' ? 'Trunk (tagged): VLAN ' + lv.tagged.join(', ') + ' + LAN untagged' : 'Access (untagged) VLAN ' + lv.untagged}${lv.auto ? ' · otomatis' : ' · diatur manual'}">${isi}</span>`;
  }

  /** Bagian "VLAN di port uplink" (tab Koneksi): hasil turunan otomatis + pilihan menimpa (trunk / access). */
  function vlanPortHtml(d, dis) {
    const m = S.model;
    const p = m.parentOf(d);
    const lv = m.linkVlan(d);
    const a = d.atribut || {};
    const def = m.vlanDef();
    if (lv.ujungVlan || (!lv.butuh.length && !a.vlan_mode && !def.size)) return '';
    const nm = v => (def.get(v) && def.get(v).nama ? `${v} ${def.get(v).nama}` : String(v));
    const hasil = lv.mode === 'trunk' ? `<b>Trunk</b> — tagged VLAN ${lv.tagged.map(nm).join(', ') || '—'} + LAN untagged`
      : lv.mode === 'access' ? `<b>Access</b> — untagged VLAN ${nm(lv.untagged)}` : '<b>Native</b> — LAN tanpa VLAN';
    return `<div class="vl-box">
      <div class="vl-box-h">VLAN di port ${esc(d.port_uplink || '')} ${esc(p.nama)} ${vlanBadge(d)}</div>
      <p class="small" style="margin:2px 0 6px">${hasil}${lv.auto ? ' <span class="muted">(otomatis dari VLAN perangkat ini & di bawahnya)</span>' : ''}${lv.dariPort ? ` <span class="muted">(dari pengaturan port ${esc(d.port_uplink)} di tabel VLAN per port ${esc(p.nama)})</span>` : ''}</p>
      ${lv.butuh.length ? `<p class="muted small" style="margin:0 0 6px">Dibutuhkan: VLAN ${lv.butuh.map(nm).join(', ')}</p>` : ''}
      ${(() => {
        const cek = m.checks().filter(c => c.ids.includes(d.id) && /VLAN/.test(c.msg));
        return cek.length ? `<ul class="issues" style="margin:0 0 6px">${cek.map(c => `<li class="lv-${c.level}">${esc(c.msg)}</li>`).join('')}</ul>` : '';
      })()}
      <div class="fgrid">
        <label class="field"><span>Mode port</span><select data-f="vlan_mode" data-attr="1"${dis}>
          <option value=""${!a.vlan_mode ? ' selected' : ''}>Otomatis</option>
          <option value="trunk"${a.vlan_mode === 'trunk' ? ' selected' : ''}>Trunk (tagged)</option>
          <option value="access"${a.vlan_mode === 'access' ? ' selected' : ''}>Access (untagged)</option>
          <option value="native"${a.vlan_mode === 'native' ? ' selected' : ''}>LAN saja (tanpa VLAN)</option></select></label>
        ${a.vlan_mode === 'trunk' || a.vlan_mode === 'access' ? `<label class="field"><span>${a.vlan_mode === 'trunk' ? 'VLAN diizinkan' : 'VLAN access'}</span><input type="text" data-f="vlan_izin" data-attr="1" value="${esc(a.vlan_izin || '')}" placeholder="${esc(lv.butuh.join(',') || 'mis. 10,20')}"${dis}></label>` : ''}
      </div>
    </div>`;
  }

  /** Kartu "VLAN" di tab Topologi: definisi di router, jumlah perangkat, dan peringatan VLAN. */
  function vlanSumHtml() {
    const m = S.model;
    const rk = m.vlanRingkas();
    if (!rk.length) return '<p class="muted">Belum ada VLAN. Buat di tab Router → VLAN, lalu isi kolom VLAN perangkat (mis. AP tamu = 20).</p>';
    const cek = m.checks().filter(c => /VLAN/.test(c.msg));
    return `<table class="mini"><tr><th>VLAN</th><th>Nama</th><th>Gateway</th><th class="num">Perangkat</th></tr>${rk.map(x => `<tr${x.def ? '' : ' class="bad-row"'}>
        <td><b>${x.id}</b></td><td>${esc(x.def ? x.def.nama : '')}${x.def ? '' : ' <span class="bad small">belum dibuat di router</span>'}</td>
        <td class="mono">${esc(x.def ? x.def.ip : '—')}</td><td class="num">${x.perangkat.length}</td></tr>`).join('')}</table>
      ${cek.length ? `<ul class="issues" style="margin-top:8px">${cek.map(c => `<li class="lv-${c.level}">${esc(c.msg)} ${c.ids.slice(0, 1).map(id => `<a href="#" data-sel="${id}">lihat</a>`).join('')}</li>`).join('')}</ul>` : '<p class="ok-text" style="margin-top:8px">✓ Konfigurasi VLAN konsisten di sepanjang jalur.</p>'}`;
  }

  // ------------------------------------------------------------------------ port switch / router

  /** Label port kosong perangkat P, mengikuti gaya penamaan yang sudah dipakai (mis. "ether7", "sfp1"). */
  function portKosong2(P) {
    const pm = S.model.portMap(P);
    return pm.ports.filter(p => !p.isi.length).map(p => (p.sfp ? 'sfp' + p.label.slice(3) : pm.prefix + p.label));
  }

  /** "Terhubung ke sini": peta port (terpakai / kosong) + perangkat beserta port-nya + pilih port untuk yang belum. */
  function terhubungHtml(P, kids, sumKids, chip) {
    const m = S.model;
    const pm = m.portMap(P);
    const nama = x => `${x.dev.nama}${x.peran === 'uplink' ? (P.jenis === 'router' ? ' (WAN utama)' : ' (uplink)') : x.peran === 'wan' ? ' (WAN tambahan)' : x.peran === 'up2' ? ' (uplink kedua)' : ''}${x.otomatis ? ' — port otomatis, belum diisi' : ''}`;
    let h = `<div class="kv col"><span>Terhubung ke sini (${kids.length})${sumKids ? ' · total alokasi ' + fmtBw(sumKids) : ''}</span>`;
    if (pm.ports.length) {
      h += `<div class="port-sum muted small">${pm.eth} port${pm.sfp ? ' + ' + pm.sfp + ' SFP' : ''} · <b>${pm.terpakai}</b> terpakai · <b>${pm.ports.length - pm.terpakai}</b> kosong</div>
        <div class="port-grid">${pm.ports.map(pt => {
          const x = pt.isi[0];
          const warna = x ? NP.tampil(x.dev).color : '';
          return `<button type="button" class="port${x ? ' isi' : ''}${pt.isi.length > 1 ? ' bentrok' : ''}${pt.sfp ? ' sfp' : ''}${x && x.peran !== 'anak' ? ' up' : ''}${x && x.otomatis ? ' oto' : ''}"${x ? ` data-sel="${x.dev.id}" style="--c:${warna}"` : ''}
            title="Port ${esc(pt.label)}: ${x ? esc(pt.isi.map(nama).join(', ')) : 'kosong'}">${esc(pt.sfp ? 'S' + pt.label.slice(3) : pt.label)}</button>`;
        }).join('')}</div>`;
      if (P.jenis === 'switch') h += vlanSwHtml(P, pm);
    } else {
      h += `<p class="muted small" style="margin:2px 0 6px">Isi <b>Jumlah port</b> (tab ${esc(tabJenis(P))}) atau pilih alat dari katalog agar peta port tampil.</p>`;
    }
    // Perangkat terhubung beserta port-nya.
    const portLbl = c => {
      const k = m.kunciPort(c.port_uplink);
      const ada = k && pm.ports.some(p => p.key === k);
      return vlanBadge(c) + (c.port_uplink ? `<span class="port-tag${pm.ports.length && !ada ? ' bad' : ''}" title="Port di ${esc(P.nama)}">${esc(c.port_uplink)}</span>` : '<span class="port-tag kosong">tanpa port</span>');
    };
    h += `<div class="path wrap">${kids.map(c => `<span class="chip-x">${chip(c)}${portLbl(c)}${S.canEdit ? `<button type="button" data-unlink="${c.id}" title="Hapus koneksi ${esc(c.nama)} ke sini" aria-label="Putuskan ${esc(c.nama)}">✕</button>` : ''}</span>`).join('')}</div>`;
    // Belum punya port: pilih langsung dari port yang masih kosong.
    if (S.canEdit && pm.tanpa.length && pm.ports.length) {
      const kosong = portKosong2(P);
      h += `<div class="port-pilih"><span class="muted small">Belum ada port:</span>${pm.tanpa.map(c => `<label class="port-pilih-row"><b>${esc(c.nama)}</b>
        <select data-port-anak="${c.id}"><option value="">pilih port…</option>${kosong.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('')}</select></label>`).join('')}
        ${kosong.length >= pm.tanpa.length ? `<button type="button" class="small" data-port-otomatis>Isi otomatis berurutan</button>` : `<span class="small bad">Port kosong kurang ${pm.tanpa.length - kosong.length}</span>`}</div>`;
    } else if (S.canEdit && pm.tanpa.length) {
      // Jumlah port belum diketahui: tetap bisa diketik langsung.
      h += `<div class="port-pilih"><span class="muted small">Belum ada port:</span>${pm.tanpa.map(c => `<label class="port-pilih-row"><b>${esc(c.nama)}</b>
        <input type="text" data-port-anak="${c.id}" placeholder="mis. ether2 / 5" style="width:9em"></label>`).join('')}</div>`;
    }
    return h + '</div>';
  }

  /**
   * VLAN per port switch: trunk dari uplink dibagi menjadi access / trunk di port-port lain. Port yang tersambung
   * perangkat menyimpan pilihan di perangkat itu (sama dengan kotak VLAN tab Koneksi); port kosong di atribut vlan_port.
   * Tampil bila event punya VLAN (didefinisikan di router atau dipakai perangkat).
   */
  function vlanSwHtml(P, pm) {
    const m = S.model;
    const lvUp = m.parentOf(P) ? m.linkVlan(P) : null;
    const vlanAda = urutVlan([...m.vlanDef().keys(), ...(lvUp ? lvUp.butuh : [])]);
    if (!vlanAda.length) return '';
    const dis = S.canEdit ? '' : ' disabled';
    const conf = m.vlanPortSw(P);
    const hasil = lv => (lv.mode === 'trunk' ? `<span class="vl vl-trunk">T ${lv.tagged.join(',') || '—'}</span>`
      : lv.mode === 'access' ? `<span class="vl vl-access">A ${lv.untagged}</span>` : '<span class="muted small">LAN</span>');
    const pilih = (attr, mode, izin, ph) => `<td><select ${attr}="mode"${dis}>
        <option value=""${!mode ? ' selected' : ''}>${attr.includes('anak') ? 'Otomatis' : 'LAN saja'}</option>
        <option value="access"${mode === 'access' ? ' selected' : ''}>Access</option>
        <option value="trunk"${mode === 'trunk' ? ' selected' : ''}>Trunk</option>
        ${attr.includes('anak') ? `<option value="native"${mode === 'native' ? ' selected' : ''}>LAN saja</option>` : ''}</select></td>
      <td>${mode === 'access' || mode === 'trunk' ? `<input type="text" ${attr}="izin" value="${esc(izin || '')}" placeholder="${esc(mode === 'access' ? String(ph[0] || '10') : ph.join(',') || '10,20')}"${dis}>` : ''}`;
    const rows = pm.ports.map(pt => {
      const x = pt.isi[0];
      const nama = pt.sfp ? 'sfp' + pt.label.slice(3) : (pm.prefix || '') + pt.label;
      if (x && x.peran !== 'anak') {
        // Port uplink switch ini (mis. eth1): trunk dari atas, diatur di tab Koneksi switch ini.
        const lv = x.peran === 'uplink' && lvUp ? lvUp : null;
        return `<tr class="vs-up"><td><b class="mono">${esc(nama)}</b><br><span class="small muted">↑ ${esc(x.dev.nama)}</span></td>
          <td colspan="2">${lv ? hasil(lv) : ''} <span class="muted small">${x.peran === 'uplink' ? 'uplink — atur di tab Koneksi' : 'uplink kedua'}</span></td></tr>`;
      }
      if (x) {
        // Pengaturan efektif: kotak VLAN perangkat itu, atau pengaturan port ini yang dibuat saat port masih kosong.
        const mp = m.modePort(x.dev);
        const lv = m.linkVlan(x.dev);
        return `<tr${mp.beda ? ' class="vs-beda"' : ''}><td><b class="mono">${esc(nama)}</b><br><a href="#" class="small" data-sel="${x.dev.id}">${esc(x.dev.nama)}</a></td>
          ${pilih(`data-vs-anak="${x.dev.id}" data-vs-key="${pt.key}" data-vs`, mp.mode, mp.izin, lv.butuh.length ? lv.butuh : vlanAda)}<div class="vp-hasil">${hasil(lv)}${mp.beda ? ' <span class="bad small" title="Pengaturan port ini berbeda dengan kotak VLAN perangkat">beda</span>' : ''}</div></td></tr>`;
      }
      const c = conf[pt.key] || {};
      return `<tr class="vs-kosong"><td><b class="mono">${esc(nama)}</b><br><span class="muted small">kosong</span></td>
        ${pilih(`data-vs-port="${pt.key}" data-vs`, c.mode || '', c.izin, vlanAda)}<div class="vp-hasil">${hasil(m.vlanPortKosong(P, pt.key))}</div></td></tr>`;
    }).join('');
    const opsiPort = pm.ports.map((pt, i) => `<option value="${i}">${esc(pt.sfp ? 'sfp' + pt.label.slice(3) : (pm.prefix || '') + pt.label)}</option>`).join('');
    return `<details class="vs-box"${S.vsBuka ? ' open' : ''}>
      <summary>VLAN per port <span class="muted small">${lvUp && lvUp.mode === 'trunk' ? `trunk masuk: VLAN ${lvUp.tagged.join(', ')}` : `VLAN ${vlanAda.join(', ')}`}</span></summary>
      ${S.canEdit ? `<div class="vs-bagi">Port <select data-vs-dari>${opsiPort}</select> s/d <select data-vs-sampai>${opsiPort}</select>
        → <select data-vs-mode><option value="access">Access</option><option value="trunk">Trunk</option><option value="">LAN saja</option></select>
        VLAN <input type="text" data-vs-vlan placeholder="${esc(String(vlanAda[0]))}" style="width:5.5em"> <button type="button" class="small primary" data-vs-terapkan>Terapkan</button></div>` : ''}
      <table class="mini mt-vlan mt-vport"><colgroup><col style="width:34%"><col style="width:30%"><col style="width:36%"></colgroup>
        <tr><th>Port</th><th>Mode</th><th title="Access: satu VLAN untagged. Trunk: VLAN tagged dipisah koma.">VLAN</th></tr>${rows}</table>
      <p class="muted small">Access = satu VLAN untagged (laptop, printer, AP tanpa multi-SSID). Trunk = beberapa VLAN tagged (switch / AP multi-SSID).
        VLAN yang dipakai di port ikut dibawa trunk uplink switch ini secara otomatis.</p>
    </details>`;
  }
  const urutVlan = arr => [...new Set(arr.filter(v => v >= 2 && v <= 4094))].sort((a, b) => a - b);

  /** Simpan VLAN port switch: port tersambung -> atribut perangkat di port itu; port kosong -> vlan_port switch. */
  function patchVlanPort(P, ubah) {
    // ubah: [{anak: id | null, key, mode, izin}] -> daftar [id, patch]
    const out = [];
    const conf = S.model.vlanPortSw(P);
    let ubahP = false;
    for (const u of ubah) {
      if (u.anak) {
        const c = S.model.byId.get(u.anak);
        const a = Object.assign({}, c.atribut, { vlan_mode: u.mode, vlan_izin: u.mode ? u.izin : '' });
        out.push([c.id, { atribut: a }]);
        // Satu sumber: pengaturan lama port ini (dibuat saat port masih kosong) dihapus.
        if (u.key && conf[u.key]) {
          delete conf[u.key];
          ubahP = true;
        }
      } else {
        if (u.mode) conf[u.key] = { mode: u.mode, izin: u.izin };
        else delete conf[u.key];
        ubahP = true;
      }
    }
    if (ubahP) out.push([P.id, { atribut: Object.assign({}, P.atribut, { vlan_port: Object.keys(conf).length ? JSON.stringify(conf) : '' }) }]);
    return out;
  }
  $('#panel').addEventListener('toggle', e => {
    if (e.target.classList && e.target.classList.contains('vs-box')) S.vsBuka = e.target.open;
  }, true);
  $('#panel').addEventListener('change', async e => {
    const el = e.target.closest('[data-vs]');
    if (!el || !S.canEdit || S.sel == null) return;
    const P = S.model.byId.get(S.sel);
    const tr = el.closest('tr');
    const modeEl = tr.querySelector('select[data-vs]');
    const izinEl = tr.querySelector('input[data-vs]');
    const mode = modeEl.value;
    const izin = izinEl ? izinEl.value.trim() : '';
    const anak = el.dataset.vsAnak ? +el.dataset.vsAnak : null;
    S.vsBuka = true;
    for (const [id, patch] of patchVlanPort(P, [{ anak, key: el.dataset.vsPort || el.dataset.vsKey, mode, izin }])) await saveDev(id, patch, { keepPanel: true }).catch(() => {});
  });
  $('#panel').addEventListener('click', async e => {
    if (!e.target.closest('[data-vs-terapkan]') || !S.canEdit || S.sel == null) return;
    const box = e.target.closest('.vs-box');
    const P = S.model.byId.get(S.sel);
    const pm = S.model.portMap(P);
    let i = +box.querySelector('[data-vs-dari]').value, j = +box.querySelector('[data-vs-sampai]').value;
    if (i > j) [i, j] = [j, i];
    const mode = box.querySelector('[data-vs-mode]').value;
    const izin = box.querySelector('[data-vs-vlan]').value.trim();
    if (mode && !/\d/.test(izin)) return toast('Isi nomor VLAN, mis. 10 (trunk: 10,20)', true);
    if (mode === 'access' && /\d+\D+\d+/.test(izin)) return toast('Access hanya satu VLAN', true);
    const ubah = [];
    pm.ports.slice(i, j + 1).forEach(pt => {
      const x = pt.isi[0];
      if (x && x.peran !== 'anak') return; // port uplink tidak diubah
      ubah.push(x ? { anak: x.dev.id, key: pt.key, mode, izin } : { anak: null, key: pt.key, mode, izin });
    });
    if (!ubah.length) return toast('Tidak ada port yang bisa diubah di rentang itu', true);
    S.vsBuka = true;
    await kelompok(`VLAN ${ubah.length} port ${P.nama}`, async () => {
      for (const [id, patch] of patchVlanPort(P, ubah)) await saveDev(id, patch, { keepPanel: true }).catch(() => {});
    });
    renderPanelInfo();
    toast(`${ubah.length} port ${P.nama} → ${mode ? (mode === 'access' ? 'access' : 'trunk') + ' VLAN ' + izin : 'LAN saja'} (Ctrl+Z untuk membatalkan)`);
  });

  $('#panel').addEventListener('change', e => {
    const s = e.target.closest('[data-port-anak]');
    if (!s || !s.value || !S.canEdit) return;
    const c = S.model.byId.get(+s.dataset.portAnak);
    if (c) saveDev(c.id, { port_uplink: s.value.trim().slice(0, 50) }).then(() => toast(`${c.nama} → port ${s.value}`)).catch(() => {});
  });
  // Isi otomatis: perangkat tanpa port mendapat port kosong berurutan (satu langkah Ctrl+Z).
  $('#panel').addEventListener('click', async e => {
    if (!e.target.closest('[data-port-otomatis]') || !S.canEdit || S.sel == null) return;
    const P = S.model.byId.get(S.sel);
    const tanpa = S.model.portMap(P).tanpa;
    const kosong = portKosong2(P);
    await kelompok(`isi port ${tanpa.length} perangkat di ${P.nama}`, async () => {
      for (let i = 0; i < tanpa.length && i < kosong.length; i++) await saveDev(tanpa[i].id, { port_uplink: kosong[i] }, { keepPanel: true }).catch(() => {});
    });
    renderPanel();
    toast(`${Math.min(tanpa.length, kosong.length)} perangkat diberi port di ${P.nama}`);
  });

  // Status pemasangan perangkat: tampilan bertahap sama dengan status kabel.
  const LANGKAH_ST = ['rencana', 'terpasang', 'diuji'];
  const ST_UI = {
    rencana: { icon: '○', short: 'Rencana' },
    terpasang: { icon: '◑', short: 'Terpasang', aksi: 'Tandai terpasang' },
    diuji: { icon: '✓', short: 'Sudah diuji', aksi: 'Tandai sudah diuji' },
    bermasalah: { icon: '⚠', short: 'Bermasalah' },
  };

  /**
   * Pemilih status pemasangan bertahap: Rencana → Terpasang → Sudah diuji + "lanjut" satu klik, Bermasalah terpisah.
   * mode 'admin' (simpan langsung, bisa Ctrl+Z), 'tim' (hanya status yang diizinkan PM, ikut catatan lapangan),
   * '' = hanya lihat.
   */
  function statusPicker(d, mode) {
    const st = STATUS[d.status] ? d.status : 'rencana';
    const bad = st === 'bermasalah';
    const step = bad ? -1 : LANGKAH_ST.indexOf(st);
    const boleh = k => mode === 'admin' || (mode === 'tim' && S.akses && S.akses.status_boleh.includes(k));
    const attr = k => (mode === 'tim' ? `data-tim-status="${k}"` : `data-st-set="${k}"`);
    const next = !bad && step < 2 ? LANGKAH_ST[step + 1] : null;
    const c = STATUS[st].color;
    return `<div class="kb-box st-box${bad ? ' bad' : ''}" style="--c:${c}">
      <div class="kb-step tiga" role="radiogroup" aria-label="Status pemasangan">
        <span class="kb-fill" style="width:${Math.max(0, step) / 2 * 66.6}%"></span>
        ${LANGKAH_ST.map((k, i) => `<button type="button" role="radio" aria-checked="${k === st}" ${attr(k)} class="${k === st ? 'on' : step > i ? 'lewat' : ''}" style="--c:${STATUS[k].color}" title="${esc(STATUS[k].label)}"${boleh(k) ? '' : ' disabled'}>
          <i>${k === st || step > i ? ST_UI[k].icon : i + 1}</i>${esc(ST_UI[k].short)}</button>`).join('')}
      </div>
      ${mode ? `<div class="kb-actions">
        ${next && boleh(next) ? `<button type="button" class="small kb-next" ${attr(next)} style="--c:${STATUS[next].color}">${ST_UI[next].icon} ${esc(ST_UI[next].aksi)}</button>`
          : bad && boleh('terpasang') ? `<button type="button" class="small" ${attr('terpasang')}>Sudah diperbaiki → terpasang</button>`
            : st === 'diuji' ? '<span class="small" style="color:#16a34a;font-weight:700">✓ Perangkat siap</span>' : ''}
        <span class="spacer"></span>
        ${boleh('bermasalah') ? `<button type="button" class="small kb-bad${bad ? ' on' : ''}" ${attr('bermasalah')}>⚠ Bermasalah</button>` : ''}
      </div>` : ''}
    </div>`;
  }

  $('#panel').addEventListener('click', e => {
    const b = e.target.closest('[data-st-set]');
    if (!b || b.disabled || !S.canEdit || S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    if (d && d.status !== b.dataset.stSet) {
      saveDev(d.id, { status: b.dataset.stSet }).then(() => toast(`${d.nama} → ${STATUS[b.dataset.stSet].label}`)).catch(() => {});
    }
  });

  function kabelPicker(ids, st, boleh, judul, lain) {
    const k = KABEL[st] || KABEL.belum;
    const bad = st === 'bermasalah';
    const step = bad ? -1 : k.step;
    const next = !bad && step < 3 ? LANGKAH[step + 1] : null;
    const c = bad ? KABEL.bermasalah.color : k.color;
    const dis = boleh ? '' : ' disabled';
    return `<div class="kb-box${bad ? ' bad' : ''}" data-kb-ids="${ids.join(',')}"${lain ? ` data-kb-lain="${lain.ke}:${lain.kunci}"` : ''} style="--c:${c}">
      ${judul ? `<div class="kb-box-t">${judul}</div>` : ''}
      <div class="kb-step" role="radiogroup" aria-label="Status penarikan kabel">
        <span class="kb-fill" style="width:${Math.max(0, step) / 3 * 75}%"></span>
        ${LANGKAH.map((s, i) => `<button type="button" role="radio" aria-checked="${s === st}" data-kb-set="${s}" class="${s === st ? 'on' : step > i ? 'lewat' : ''}" style="--c:${KABEL[s].color}" title="${esc(KABEL[s].label)} (${i + 1})"${dis}>
          <i>${s === st || step > i ? KABEL[s].icon : i + 1}</i>${esc(KABEL[s].short)}</button>`).join('')}
      </div>
      ${boleh ? `<div class="kb-actions">
        ${next ? `<button type="button" class="small kb-next" data-kb-set="${next}" style="--c:${KABEL[next].color}">${KABEL[next].icon} ${esc(KABEL[next].aksi)}</button>` : bad ? `<button type="button" class="small" data-kb-set="ditarik">Sudah diperbaiki → ditarik</button>` : '<span class="small" style="color:#16a34a;font-weight:700">✓ Kabel selesai</span>'}
        <span class="spacer"></span>
        <button type="button" class="small kb-bad${bad ? ' on' : ''}" data-kb-set="bermasalah" title="Kabel bermasalah (5)">⚠ Bermasalah</button>
      </div>` : ''}
    </div>`;
  }

  /** Popover status kabel di dekat titik klik (garis di denah / badge di daftar). */
  function bukaKabelPop(ids, x, y, lain) {
    tutupKabelPop();
    const ds = ids.map(id => S.model.byId.get(id)).filter(d => d && (lain || NP.perluKabel(d)));
    if (!ds.length) return;
    const d = ds[0];
    const p = lain ? S.model.byId.get(lain.ke) : S.model.parentOf(d);
    const km = lain ? S.model.kabelWanM(d, p) : ds.length === 1 ? S.model.kabelM(d) : null;
    const boleh = ds.every(bolehKabel);
    const st = lain ? statusLain(d, lain) : ds.every(x2 => NP.kabelSt(x2) === NP.kabelSt(d)) ? NP.kabelSt(d) : '';
    const pop = document.createElement('div');
    pop.className = 'kb-pop';
    pop.id = 'kb-pop';
    pop.setAttribute('role', 'dialog');
    pop.innerHTML = `<div class="kb-pop-h"><span>🔌</span><b>${ds.length > 1 ? ds.length + ' kabel' : `${esc(d.nama)} → ${esc(p ? p.nama : '')}`}</b>
        ${km ? `<span class="muted small">≈ ${esc(fmtM(km))}</span>` : ''}<button type="button" class="icon" data-kb-tutup aria-label="Tutup">✕</button></div>
      ${lain ? `<div class="muted small" style="margin:-2px 0 4px">${lain.kunci === 'wan_lain' ? 'WAN tambahan' : 'Uplink kedua (' + (S.model.uplinkMode(d) === 'lacp' ? 'LACP' : 'redundan') + ')'}</div>` : ''}
      ${kabelPicker(ds.map(x2 => x2.id), st, boleh, '', lain)}
      <p class="hint">${boleh ? 'Tekan 1–4 untuk tahap, 5 = bermasalah, Enter = tahap berikutnya, Esc = tutup.' : 'Hanya bisa dilihat.'}</p>`;
    document.body.appendChild(pop);
    const r = pop.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2)) + 'px';
    pop.style.top = (y + 16 + r.height > innerHeight - 8 ? Math.max(8, y - r.height - 16) : y + 16) + 'px';
    const fokus = pop.querySelector('.kb-next') || pop.querySelector('[data-kb-set]');
    if (fokus) fokus.focus({ preventScroll: true });
  }
  /** "12:uplink_lain" -> {ke: 12, kunci: 'uplink_lain'} (sambungan tambahan) atau null. */
  function parseLain(v) {
    if (!v) return null;
    const [ke, kunci] = v.split(':');
    return { ke: +ke, kunci };
  }
  /** Badge status kabel sambungan tambahan yang bisa diklik. */
  function kabelLainBtn(d, w, boleh) {
    const k = w.kabel;
    const isi = `${KABEL[k].icon} ${esc(KABEL[k].short)}`;
    const gaya = k !== 'belum' ? ` style="background:${KABEL[k].color}"` : '';
    return boleh ? `<button type="button" class="kb kb-${k}"${gaya} data-kb-pop="${d.id}" data-kb-lain="${w.dev.id}:${w.kunci}" title="Status kabel ke ${esc(w.dev.nama)} — klik untuk ubah">${isi} ▾</button>`
      : `<span class="kb kb-${k}"${gaya}>${isi}</span>`;
  }
  function tutupKabelPop() {
    const p = $('#kb-pop');
    if (p) p.remove();
  }

  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-kb-set]');
    if (b && !b.disabled) {
      const box = b.closest('[data-kb-ids]');
      const ids = box.dataset.kbIds.split(',').map(Number).filter(Boolean);
      const diPop = !!b.closest('#kb-pop');
      setKabel(ids, b.dataset.kbSet, false, parseLain(box.dataset.kbLain)).then(() => { if (diPop) tutupKabelPop(); });
      return;
    }
    const lb = e.target.closest && e.target.closest('[data-kb-pop]');
    if (lb) {
      e.preventDefault();
      e.stopPropagation();
      const r = lb.getBoundingClientRect();
      return bukaKabelPop([+lb.dataset.kbPop], r.left + r.width / 2, r.bottom - 8, parseLain(lb.dataset.kbLain));
    }
    if (e.target.closest && (e.target.closest('[data-kb-tutup]') || (!e.target.closest('#kb-pop') && !e.target.closest('#map')))) tutupKabelPop();
  });
  document.addEventListener('keydown', e => {
    const pop = $('#kb-pop');
    if (!pop) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return tutupKabelPop();
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const pilihan = /^[1-5]$/.test(e.key) ? [...LANGKAH, 'bermasalah'][+e.key - 1] : e.key === 'Enter' ? ((pop.querySelector('.kb-next') || {}).dataset || {}).kbSet : null;
    if (!pilihan) return;
    e.preventDefault();
    e.stopPropagation();
    const btn = pop.querySelector(`[data-kb-set="${pilihan}"]`);
    if (btn) btn.click();
  }, true);

  /** Progres penarikan kabel: ringkas (panel denah) atau lengkap (tab Topologi). */
  function progresKabelHtml(ringkas) {
    const pk = S.model.progresKabel();
    if (!pk.total) return ringkas ? '' : '<p class="muted">Belum ada sambungan kabel (perangkat dengan uplink non-wireless).</p>';
    const urut = ['dites', 'terminasi', 'ditarik', 'bermasalah', 'belum'];
    const bar = `<div class="kb-bar" title="${pk.selesai} dari ${pk.total} kabel sudah ditarik">${urut.map(k => pk.per[k].n
      ? `<i style="width:${pk.per[k].n / pk.total * 100}%;background:${KABEL[k].color}" title="${esc(KABEL[k].label)}: ${pk.per[k].n}"></i>` : '').join('')}</div>`;
    const meter = pk.totalM ? ` · ${fmtM(pk.selesaiM)} dari ${fmtM(pk.totalM)}` : '';
    const layer = `<label class="small"><input type="checkbox" data-kabel-layer${peta.layers.kabel ? ' checked' : ''}> Warnai garis di denah menurut status kabel</label>`;
    if (ringkas) {
      return `<div class="pn-sec"><h4>Penarikan kabel <span class="muted small">${pk.selesai}/${pk.total} link (${pk.pct}%)${meter}</span></h4>${bar}
        <div class="legend">${urut.map(k => `<span class="lg-item"><i class="kb-dot" style="background:${KABEL[k].color}">${KABEL[k].icon}</i>${esc(KABEL[k].label)}<b>${pk.per[k].n}</b></span>`).join('')}</div>${layer}</div>`;
    }
    return `<div class="kb-head"><span class="kb-pct">${pk.pct}%</span><span class="muted">${pk.selesai} dari ${pk.total} kabel sudah ditarik${meter}</span></div>${bar}
      <table class="kb-rows">${urut.map(k => `<tr><td><span class="kb-dot" style="background:${KABEL[k].color}">${KABEL[k].icon}</span>${esc(KABEL[k].label)}</td>
        <td class="num"><b>${pk.per[k].n}</b> link</td><td class="num muted">${pk.per[k].m ? fmtM(pk.per[k].m) : ''}</td>
        <td class="num">${pk.per[k].n ? `<a href="#" data-kabel-filter="${k}">lihat</a>` : ''}</td></tr>`).join('')}</table>
      <p style="margin:10px 0 0">${layer}</p>`;
  }

  /** Ubah status kabel (admin: semua; tim: kategori tugasnya). Admin bisa membatalkan dengan Ctrl+Z. */
  async function setKabel(ids, kabel, tanpaRiwayat, lain) {
    // lain = {ke, kunci}: kabel sambungan tambahan (WAN tambahan / uplink kedua) satu perangkat.
    const lama = new Map(ids.map(id => [id, lain ? statusLain(S.model.byId.get(id), lain) : NP.kabelSt(S.model.byId.get(id))]));
    try {
      const extra = lain ? { ke: lain.ke, kunci: lain.kunci } : {};
      const res = S.tim
        ? await api('api/tim.php', Object.assign({ t: S.tim, action: 'kabel', ids, kabel }, extra))
        : await enqueue(() => api(API, Object.assign({ action: 'perangkat_kabel', ids, kabel }, extra)));
      res.perangkat.forEach(p => {
        const i = S.list.findIndex(x => x.id === p.id);
        if (i >= 0) S.list[i] = p;
      });
      riwayat.id = null;
      refreshModel();
      const n = res.perangkat.length;
      if (!S.tim && !tanpaRiwayat && n) {
        const ok = res.perangkat.map(p => p.id);
        catat({
          label: `status kabel ${n > 1 ? n + ' perangkat' : res.perangkat[0].nama}`,
          undo: async () => {
            const grup = new Map();
            ok.forEach(id => { const st = lama.get(id); if (!grup.has(st)) grup.set(st, []); grup.get(st).push(id); });
            for (const [st, gids] of grup) await setKabel(gids, st, true, lain);
          },
          redo: () => setKabel(ok, kabel, true, lain),
        });
      }
      if (!tanpaRiwayat) {
        toast(n ? `Kabel ${n > 1 ? n + ' perangkat' : res.perangkat[0].nama}${lain ? ' → ' + ((S.model.byId.get(lain.ke) || {}).nama || '') : ''}: ${KABEL[kabel].label}` +
          (res.dilewati ? ` · ${res.dilewati} dilewati (tanpa kabel / di luar tugas)` : '') : 'Tidak ada kabel yang bisa diubah (tanpa uplink / wireless / di luar tugas)', !n);
      }
    } catch (e) {
      setSaveState('error');
      toast(e.message, true);
    }
  }

  /** Status kabel sambungan tambahan perangkat d ke lain.ke. */
  function statusLain(d, lain) {
    const w = d && S.model.linkLain(d).find(x => x.dev.id === lain.ke && x.kunci === lain.kunci);
    return w ? w.kabel : 'belum';
  }

  // Kotak centang "warnai garis menurut status kabel" (panel ringkasan & tab Topologi) = lapisan Progres kabel.
  function setLayerKabel(on) {
    peta.setLayer('kabel', on);
    const c = $('[data-layer="kabel"]');
    if (c) c.checked = on;
    try { localStorage.setItem('np-layers', JSON.stringify(peta.layers)); } catch (err) { /* abaikan */ }
  }
  document.addEventListener('change', e => {
    const c = e.target.closest && e.target.closest('[data-kabel-layer]');
    if (c) setLayerKabel(c.checked);
  });
  document.addEventListener('click', e => {
    const f = e.target.closest && e.target.closest('[data-kabel-filter]');
    if (!f) return;
    e.preventDefault();
    ['#list-q', '#list-jenis', '#list-status', '#list-koneksi', '#list-kabel'].forEach(s => { $(s).value = ''; });
    $('#list-kabel').value = f.dataset.kabelFilter;
    go('daftar');
    setTimeout(renderDaftar, 60);
  });

  function panelRingkasan() {
    const m = S.model;
    const p = S.proyek;
    // Ringkasan mengikuti layer jaringan yang sedang ditampilkan.
    const ds = m.list.filter(masukLapisan);
    const dalam = new Set(ds.map(d => d.id));
    const counts = {};
    ds.forEach(d => { counts[d.jenis] = (counts[d.jenis] || 0) + 1; });
    const checks = m.checks().filter(c => !c.ids.length || c.ids.some(id => dalam.has(id)));
    const nErr = checks.filter(c => c.level === 'err').length;
    const nWarn = checks.filter(c => c.level === 'warn').length;
    const st = {};
    ds.forEach(d => { st[d.status] = (st[d.status] || 0) + 1; });
    const kon = { online: [], gangguan: [], offline: [] };
    ds.forEach(d => { if (!NP.nonJaringan(d)) kon[m.koneksi(d)].push(d); });
    return `
      <div class="pn-sec">
        <h3>${esc(p.nama)}</h3>
        ${S.tim && S.akses ? `<div class="tim-info"><b>${esc(S.akses.nama)}</b>${aksesRingkas(S.akses)}${progresTim()}</div>` : ''}
        <p class="muted small">${ds.length} perangkat${multiLapisan() && S.lapisan !== 'semua' ? ' · layer ' + esc(m.lapisanById(S.lapisan).nama) : ''}${multiLantai() ? ' · denah ' + esc(lantaiAktif().nama) : ''}${lantaiAktif().skala ? ` · skala 1 px = ${fmtM(lantaiAktif().skala).replace(' m', '')} m` : ''}</p>
        ${!lantaiAktif().denah_v && S.canEdit ? `<p class="note">Belum ada denah${multiLantai() ? ' ' + esc(lantaiAktif().nama) : ''}. Upload di tab <a href="#" data-go="proyek">Proyek</a>.</p>` : ''}
        ${!lantaiAktif().skala ? `<p class="note">Skala belum dikalibrasi — panjang kabel &amp; cakupan AP belum bisa dihitung. Pakai alat <a href="#" data-tool-go="ukur">Ukur</a> pada garis skala denah (mis. "7000 cm").</p>` : ''}
      </div>
      <div class="pn-sec">
        <h4>Jenis perangkat <span class="muted small">klik untuk sembunyikan</span></h4>
        <div class="legend">
          ${TYPE_ORDER.map(j => `<button type="button" class="lg-item${hiddenTypes.has(j) ? ' off' : ''}" data-hide="${j}">
            <i style="background:${TYPES[j].color}"${j === 'endpoint' ? ' class="sq"' : ''}>${j === 'endpoint' ? NP.ikonSvg('pc', 13) : esc(TYPES[j].short)}</i>${esc(TYPES[j].label)}<b>${counts[j] || 0}</b></button>${j === 'endpoint' && counts[j] ? epRincian(m) : ''}`).join('')}
        </div>
      </div>
      <div class="pn-sec">
        <h4>Koneksi internet</h4>
        <div class="legend">
          ${Object.keys(KONEKSI).map(k => `<span class="lg-item"><i class="net-i" style="background:${KONEKSI[k].color}">${KONEKSI[k].icon}</i>${KONEKSI[k].label}<b>${kon[k].length}</b></span>`).join('')}
        </div>
        ${kon.offline.length ? `<p class="small muted" style="margin-top:8px">Belum terhubung:</p><div class="path wrap">${NP.Model.sortDev(kon.offline).map(chipDev).join('')}</div>` : ''}
      </div>
      <div class="pn-sec">
        <h4>Status pemasangan</h4>
        <div class="legend">
          ${Object.keys(STATUS).filter(k => k !== 'usulan' || st[k]).map(k => `<span class="lg-item"><i class="ring" style="border-color:${STATUS[k].color}"></i>${STATUS[k].label}<b>${st[k] || 0}</b></span>`).join('')}
        </div>
      </div>
      ${progresKabelHtml(true)}
      <div class="pn-sec">
        <h4>Garis uplink</h4>
        <div class="legend">
          ${lineLegend().map(x => `<span class="lg-item">${x.svg}${esc(x.label)}</span>`).join('')}
        </div>
      </div>
      <div class="pn-sec">
        <h4>Pemeriksaan</h4>
        ${checks.length ? `<p><a href="#" data-go="topologi">${nErr ? `<span class="lv err">${nErr} masalah</span> ` : ''}${nWarn ? `<span class="lv warn">${nWarn} peringatan</span> ` : ''}${checks.length - nErr - nWarn ? `<span class="lv info">${checks.length - nErr - nWarn} catatan</span>` : ''}</a></p>` : '<p class="muted small">Tidak ada masalah terdeteksi.</p>'}
      </div>
      <div class="pn-sec muted small">
        ${S.canEdit ? `<p><b>Cara cepat:</b> pilih router/switch, lalu pilih alat <b>AP</b> dan klik-klik di denah — AP otomatis ber-uplink ke switch tersebut.</p>
        <p class="kbd-hint">Pintasan: <kbd>V</kbd> pilih · <kbd>L</kbd> hubungkan · <kbd>M</kbd> ukur · <kbd>1</kbd>–<kbd>9</kbd> tambah · <kbd>Del</kbd> hapus · <kbd>F</kbd> seluruh denah · scroll = zoom · geser latar = pan</p>`
        : '<p>Klik titik perangkat untuk melihat konfigurasinya. Scroll/pinch untuk zoom, geser untuk pan.</p>'}
      </div>`;
  }

  function panelUkur() {
    const ms = peta.measure;
    const p = lantaiAktif(); // skala denah lantai yang tampil
    let h = '<div class="pn-sec"><h3>Ukur jarak</h3>';
    if (ms.length < 2) {
      h += '<p class="muted">Klik dua titik di denah.</p>';
    } else {
      const px = Math.hypot(ms[1].x - ms[0].x, ms[1].y - ms[0].y);
      h += `<p class="big-num">${p.skala ? esc(fmtM(px * p.skala)) : Math.round(px) + ' px'}</p>
        ${p.skala ? `<p class="muted small">${Math.round(px)} px di denah</p>` : ''}`;
      if (S.canEdit) {
        h += `<form class="cal-form" id="cal-form">
            <label class="field"><span>Kalibrasi: jarak sebenarnya garis ini</span>
              <div class="inline"><input type="number" name="m" step="any" min="0.01" required placeholder="mis. 70"> <span>meter</span></div></label>
            <button type="submit" class="primary">Set skala denah</button>
          </form>`;
      }
    }
    h += `<p class="muted small">Tip kalibrasi: ukur garis skala yang tertera di denah (mis. "7000 cm" → isi 70), atau dua titik yang jaraknya Anda ketahui (lebar hall, panjang booth).</p>
      <p class="small">Skala sekarang: ${p.skala ? `1 px = ${(p.skala * 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })} cm` : '<b>belum dikalibrasi</b>'}</p></div>`;
    return h;
  }

  $('#panel').addEventListener('submit', async e => {
    if (e.target.id !== 'cal-form') return;
    e.preventDefault();
    const meter = parseFloat(e.target.elements.m.value);
    const ms = peta.measure;
    const px = Math.hypot(ms[1].x - ms[0].x, ms[1].y - ms[0].y);
    if (!(meter > 0) || !(px > 0)) return;
    try {
      const lid = S.lantai || 'F1';
      const res = await enqueue(() => api(API, lid === 'F1' ? { action: 'proyek_skala', id: S.proyek.id, skala: meter / px }
        : { action: 'lantai_skala', id: S.proyek.id, lantai_id: lid, skala: meter / px }));
      S.proyek = res.proyek;
      toast('Skala tersimpan');
      refreshModel();
    } catch (err) {
      setSaveState('error');
      toast(err.message, true);
    }
  });

  function fieldHtml(f, val, dis) {
    const id = 'f-' + f.k;
    const v = val == null ? '' : val;
    let input;
    if (f.type === 'endpoint') {
      // Tipe endpoint: pilihan dari daftar tipe (bisa ditambah lewat "Kelola tipe").
      input = `<div class="inline"><select id="${id}" data-f="${f.k}" data-attr="1"${dis}><option value="">—</option>${NP.ET.map(t =>
        `<option value="${t.id}"${String(t.id) === String(v) ? ' selected' : ''}>${esc(t.nama)}</option>`).join('')}</select>
        ${S.canEdit ? '<button type="button" class="small super-only" data-act="ep-kelola" title="Tambah / ubah tipe endpoint">Kelola</button>' : ''}</div>`;
    } else if (f.type === 'select') {
      const opts = f.options.includes(v) ? f.options : f.options.concat([v]);
      input = `<select id="${id}" data-f="${f.k}"${f.attr ? ' data-attr="1"' : ''}${dis}>${opts.map(o => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(o || '—')}</option>`).join('')}</select>`;
    } else if (f.type === 'password') {
      input = `<div class="inline"><input type="password" id="${id}" data-f="${f.k}" data-attr="1" value="${esc(v)}" autocomplete="new-password"${dis}>
        <button type="button" class="small" data-reveal="${id}" title="Tampilkan">👁</button></div>`;
    } else {
      // f.list = nilai umum untuk dipilih (datalist), tetap bisa diketik bebas (mis. ukuran MCB standar).
      input = `<input type="${f.type === 'number' ? 'number' : 'text'}" ${f.type === 'number' ? 'step="any" min="0"' : ''} id="${id}" data-f="${f.k}"${f.attr ? ' data-attr="1"' : ''} value="${esc(v)}" placeholder="${esc(f.ph || '')}"${f.list ? ` list="dl-${f.k}"` : ''}${dis}>` +
        (f.list ? `<datalist id="dl-${f.k}">${f.list.map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : '');
    }
    return `<label class="field${f.wide ? ' wide' : ''}"><span>${esc(f.label)}</span>${input}</label>`;
  }

  // ------------------------------------------------------------------------ unit gudang yang dipasang di titik

  /** Unit gudang yang sedang dipakai perangkat d (atau null). */
  const unitOf = d => (d && (S.unit || []).find(u => u.perangkat_id === d.id)) || null;
  const ukuranFile = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
  const unitPilihanCache = new Map(); // katalog_id -> unit gudang (untuk pemilih unit di panel)

  /**
   * Tab Unit: unit fisik dari gudang (katalog) yang dipasang di titik ini — data SN/MAC/firmware/akses, catatan & file
   * konfigurasinya tersimpan di gudang. Belum terpasang: pilih dari unit yang tersedia untuk alat katalog yang sama.
   */
  function unitPanelHtml(d) {
    const k = S.model.kat(d);
    if (!k) {
      return `<div class="pn-sec"><h4>Unit dari gudang</h4><p class="muted small">Titik ini belum memakai alat dari katalog. Pilih alat di tab
        <a href="#" data-pt-go="identitas">Identitas</a> dulu — unit fisik (SN, MAC, firmware, file konfigurasi) diambil dari gudang alat tersebut.</p></div>`;
    }
    const u = unitOf(d);
    const nama = esc(NP.Katalog.label(k));
    if (u) {
      const kd = NP.UNIT_KONDISI[u.kondisi] || NP.UNIT_KONDISI.baik;
      const row = (l, v) => (v ? `<div class="kv"><span>${l}</span><b>${v}</b></div>` : '');
      return `<div class="pn-sec unit-kartu">
          <h4>Unit terpasang <span class="small">dari gudang ${nama}</span></h4>
          ${row('Nomor seri (SN)', `<span class="mono">${esc(u.sn) || '—'}</span>`)}
          ${row('MAC', u.mac ? `<span class="mono">${esc(u.mac)}</span>` : '')}
          ${row('Firmware', esc(u.firmware))}
          ${row('No. aset', esc(u.aset))}
          ${row('IP manajemen', u.ip_mgmt ? `<span class="mono">${esc(u.ip_mgmt)}</span>` : '')}
          ${row('User admin', esc(u.user_admin))}
          ${row('Password admin', u.pass_admin ? `<span class="mono" data-unit-pass="${esc(u.pass_admin)}">••••••</span>${S.lihat ? '' : ' <button type="button" class="small" data-unit-pass-lihat title="Tampilkan">👁</button>'}` : '')}
          ${row('Kondisi', `<i class="hc-dot" style="background:${kd.color}"></i>${esc(kd.label)}`)}
          ${u.catatan ? `<div class="kv col"><span>Catatan konfigurasi unit</span><pre class="unit-cat">${esc(u.catatan)}</pre></div>` : ''}
          ${u.berkas.length ? `<div class="kv col"><span>File konfigurasi / backup</span><ul class="berkas-list">${u.berkas.map(b =>
            `<li><a href="api/berkas.php?id=${b.id}" download>📄 <b>${esc(b.nama)}</b></a><small class="muted">${esc(ukuranFile(b.ukuran))} · ${esc(waktuSingkat(b.created_at))}</small></li>`).join('')}</ul></div>` : ''}
          ${S.canEdit ? `<div class="btn-row" style="margin-top:8px"><button type="button" class="small primary" data-unit-ubah>✎ Data &amp; file unit</button>
            <button type="button" class="small" data-unit-ganti>Ganti unit</button>
            <button type="button" class="small" data-unit-lepas title="Unit kembali tersedia di gudang">Lepas ke gudang</button></div>` : ''}
        </div>`;
    }
    if (!S.canEdit) return `<div class="pn-sec"><h4>Unit dari gudang</h4><p class="muted small">Belum ada unit fisik ${nama} yang dipasang di titik ini.</p></div>`;
    return `<div class="pn-sec"><h4>Pasang unit dari gudang <span class="small">${nama}</span></h4>
        <div id="unit-pilih"><p class="muted small">Memuat stok gudang…</p></div></div>`;
  }

  /** Isi pemilih unit (asinkron): unit tersedia di gudang untuk alat katalog perangkat d. */
  async function isiPilihanUnit(d) {
    const box = $('#unit-pilih');
    const k = d && S.model.kat(d);
    if (!box || !k) return;
    let units;
    try {
      units = (await api(API + '?action=unit_list&katalog_id=' + k.id)).unit;
      unitPilihanCache.set(k.id, units);
    } catch (err) {
      box.innerHTML = `<p class="err-text small">${esc(err.message)}</p>`;
      return;
    }
    if (!$('#unit-pilih') || S.sel !== d.id) return; // panel sudah berganti
    const ada = units.filter(u => !u.perangkat_id && u.kondisi !== 'rusak');
    const dipakai = units.filter(u => u.perangkat_id).length;
    const ket = u => [u.sn ? 'SN ' + u.sn : '', u.aset, u.lokasi ? '📍 ' + u.lokasi : '', u.kondisi === 'servis' ? '(servis)' : ''].filter(Boolean).join(' · ') || 'Unit #' + u.id;
    box.innerHTML = ada.length
      ? `<p class="muted small" style="margin:0 0 6px">${ada.length} unit tersedia · ${dipakai} sedang dipakai (semua event)</p>
        <div class="inline"><select data-unit-pilih>${ada.map(u => `<option value="${u.id}">${esc(ket(u))}</option>`).join('')}</select>
          <button type="button" class="small primary" data-unit-pasang>Pasang</button></div>`
      : `<p class="muted small" style="margin:0 0 6px">${units.length ? `Tidak ada unit tersedia — ${dipakai} unit sedang dipakai di event lain / servis.` : 'Gudang alat ini masih kosong.'}</p>`;
    box.innerHTML += `<div class="btn-row" style="margin-top:8px"><button type="button" class="small super-only" data-unit-baru>＋ Unit baru ke gudang</button>
      <button type="button" class="small ghost" data-unit-gudang>Lihat gudang</button></div>`;
  }

  async function pasangUnit(d, unitId) {
    try {
      S.unit = (await api(API, { action: 'unit_pasang', perangkat_id: d.id, unit_id: unitId })).unit;
      const u = unitOf(d);
      toast(`${d.nama}: unit ${u ? u.sn || u.aset || '#' + u.id : ''} terpasang`);
      renderPanel();
    } catch (err) {
      toast(err.message, true);
    }
  }

  $('#panel').addEventListener('click', async e => {
    const d = S.sel != null && S.model.byId.get(S.sel);
    if (!d || !e.target.closest('[data-pp="unit"]')) return;
    const k = S.model.kat(d);
    if (e.target.closest('[data-unit-pasang]')) return pasangUnit(d, +$('[data-unit-pilih]').value);
    if (e.target.closest('[data-unit-lepas]')) {
      if (!confirm(`Lepas unit dari ${d.nama}? Unit kembali tersedia di gudang (datanya tetap tersimpan).`)) return;
      try {
        S.unit = (await api(API, { action: 'unit_lepas', perangkat_id: d.id })).unit;
        renderPanel();
        toast('Unit kembali ke gudang');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    if (e.target.closest('[data-unit-ganti]')) {
      // Tampilkan pemilih unit (unit lama baru dilepas saat unit pengganti dipasang).
      const sec = e.target.closest('.pn-sec');
      sec.insertAdjacentHTML('afterend', `<div class="pn-sec"><h4>Ganti dengan unit lain</h4><div id="unit-pilih"><p class="muted small">Memuat stok gudang…</p></div></div>`);
      e.target.closest('[data-unit-ganti]').disabled = true;
      return isiPilihanUnit(d);
    }
    if (e.target.closest('[data-unit-ubah]')) {
      const u = unitOf(d);
      return NP.Katalog.bukaUnit(u, k, (baru, hapus) => {
        S.unit = hapus ? S.unit.filter(x => x.id !== u.id) : S.unit.map(x => (x.id === baru.id ? baru : x));
        renderPanel();
      });
    }
    if (e.target.closest('[data-unit-baru]')) {
      // Unit baru langsung dipasang di titik ini setelah disimpan.
      return NP.Katalog.bukaUnit({ katalog_id: k.id, kondisi: 'baik', berkas: [] }, k, (u, hapus) => { if (!hapus) pasangUnit(d, u.id); });
    }
    if (e.target.closest('[data-unit-gudang]')) return NP.Katalog.bukaGudang(k, () => isiPilihanUnit(d));
    const lihat = e.target.closest('[data-unit-pass-lihat]');
    if (lihat) {
      const s = lihat.previousElementSibling;
      s.textContent = s.textContent === '••••••' ? s.dataset.unitPass : '••••••';
    }
  });

  /** Dialog "Unit per seri" (event ini): titik per alat katalog beserta unit gudang yang terpasang; CSV. */
  function bukaUnitSeri(fokusKat) {
    const m = S.model;
    const ds = NP.Model.sortDev(m.list.filter(d => !NP.nonJaringan(d)));
    const grup = new Map();
    ds.forEach(d => {
      const k = m.kat(d);
      const key = k ? 'k' + k.id : 'tanpa';
      if (!grup.has(key)) grup.set(key, { key, k, ds: [] });
      grup.get(key).ds.push(d);
    });
    const sel = v => (v ? esc(v) : '<span class="muted">—</span>');
    const urut = [...grup.values()].sort((a, b) => (!a.k) - (!b.k) || (a.k && b.k ? TYPE_ORDER.indexOf(a.k.jenis) - TYPE_ORDER.indexOf(b.k.jenis) || NP.Katalog.label(a.k).localeCompare(NP.Katalog.label(b.k)) : 0));
    const isi = urut.map(g => {
      const t = g.k ? TYPES[g.k.jenis] || TYPES.lainnya : TYPES.lainnya;
      const terpasang = g.ds.filter(unitOf).length;
      return `<section class="us-grup${g.k && g.k.id === fokusKat ? ' fokus' : ''}">
        <h3><i style="background:${t.color}">${esc(t.short)}</i>${g.k ? esc(NP.Katalog.label(g.k)) : 'Tanpa alat katalog'}
          <span class="muted small">${g.ds.length} titik${g.k ? ` · unit terpasang ${terpasang}/${g.ds.length}${g.k.gudang ? ' · gudang: ' + esc(NP.Katalog.ringkasGudang(g.k.gudang)) : ''}` : ' — pilih alat katalog agar bisa dipasangi unit gudang'}</span>
          ${g.k ? `<button type="button" class="small" data-us-gudang="${g.k.id}">📦 Gudang</button>` : ''}</h3>
        <div class="us-wrap"><table class="mini us-tbl"><tr><th>Titik</th><th>SN</th><th>MAC</th><th>Firmware</th><th>IP manajemen</th><th>No. aset</th><th>File</th></tr>
        ${g.ds.map(d => {
          const u = unitOf(d);
          return `<tr><td><a href="#" data-us-sel="${d.id}">${esc(d.nama)}</a></td>${u
            ? `<td class="mono">${sel(u.sn)}</td><td class="mono">${sel(u.mac)}</td><td>${sel(u.firmware)}</td><td class="mono">${sel(u.ip_mgmt)}</td><td>${sel(u.aset)}</td><td>${u.berkas.length ? '📄 ' + u.berkas.length : '<span class="muted">—</span>'}</td>`
            : `<td colspan="6" class="muted">${g.k ? 'belum ada unit terpasang' : '—'}</td>`}</tr>`;
        }).join('')}</table></div></section>`;
    }).join('');
    const dlg = $('#dlg-unit');
    dlg.querySelector('.us-isi').innerHTML = isi || '<p class="muted">Belum ada perangkat jaringan.</p>';
    if (!dlg.open) dlg.showModal();
    const f = dlg.querySelector('.us-grup.fokus');
    if (f) f.scrollIntoView({ block: 'start' });
  }
  $('#btn-unit-seri').addEventListener('click', () => bukaUnitSeri(null));
  $('#dlg-unit').addEventListener('click', e => {
    if (e.target.closest('[data-close]')) return $('#dlg-unit').close();
    const g = e.target.closest('[data-us-gudang]');
    if (g) {
      const k = S.katalog.find(x => x.id === +g.dataset.usGudang);
      if (k) NP.Katalog.bukaGudang(k);
      return;
    }
    const s = e.target.closest('[data-us-sel]');
    if (s) {
      e.preventDefault();
      $('#dlg-unit').close();
      pnTab = 'unit';
      go('denah');
      selectDev(+s.dataset.usSel, true);
      return;
    }
    if (e.target.closest('[data-us-csv]')) {
      const rows = [['Alat katalog', 'Jenis', 'Titik', 'SN', 'MAC', 'Firmware', 'IP manajemen', 'No. aset', 'Kondisi', 'Lokasi gudang', 'Jumlah file', 'Catatan unit']];
      NP.Model.sortDev(S.model.list.filter(d => !NP.nonJaringan(d))).forEach(d => {
        const k = S.model.kat(d);
        const u = unitOf(d) || {};
        rows.push([k ? NP.Katalog.label(k) : '', (TYPES[d.jenis] || TYPES.lainnya).label, d.nama, u.sn || '', u.mac || '', u.firmware || '',
          u.ip_mgmt || '', u.aset || '', u.kondisi ? (NP.UNIT_KONDISI[u.kondisi] || {}).label : '', u.lokasi || '', u.berkas ? u.berkas.length : '', u.catatan || '']);
      });
      downloadCsv(rows, `unit-perangkat-${slug(S.proyek.nama)}.csv`);
    }
  });

  /** Pilihan alat dari katalog (sesuai kategori perangkat) + ringkasan spesifikasinya. */
  function katalogField(d, dis) {
    const k = S.model.kat(d);
    const items = S.katalog.filter(x => x.jenis === d.jenis);
    const ringkas = k ? NP.specSummary(k.spesifikasi) : '';
    if (!S.canEdit) {
      return k ? `<div class="field wide kat-info"><span>Alat dari katalog</span><b>${esc(NP.Katalog.label(k))}</b>${ringkas ? `<small>${esc(ringkas)}</small>` : ''}</div>` : '';
    }
    const opt = x => `<option value="${x.id}"${x.id === d.katalog_id ? ' selected' : ''}>${esc(NP.Katalog.label(x))}${x.stok != null ? ` · stok ${x.stok}` : ''}</option>`;
    return `<div class="field wide kat-pick"><span>Pilih dari katalog · ${esc((TYPES[d.jenis] || TYPES.lainnya).label)}</span>
        <div class="inline"><select data-kat${dis}><option value="">${items.length ? '— isi manual —' : '— katalog kategori ini kosong —'}</option>${items.map(opt).join('')}
            <option value="baru" class="super-only">＋ Tambah alat baru ke katalog…</option></select>
          <button type="button" class="small super-only" data-act="kat-baru" title="Tambah alat ke katalog tanpa meninggalkan denah">＋ Alat baru</button></div>
        ${k ? `<div class="kat-info"><small>${esc(ringkas || 'Spesifikasi belum diisi di katalog')}</small>
          <button type="button" class="small" data-act="kat-terapkan" title="Timpa isian perangkat dengan konfigurasi standar katalog">Terapkan konfigurasi standar</button></div>` : ''}
      </div>`;
  }

  /**
   * Tambah alat ke katalog lewat modal tanpa meninggalkan denah (kategori = jenis perangkat ini). Setelah disimpan,
   * daftar katalog diperbarui dan alat baru langsung dipakai perangkat d.
   */
  function katalogBaru(d) {
    NP.Katalog.openEditor({ jenis: d.jenis }, k => {
      S.katalog = NP.Katalog.list.slice();
      const cur = S.model.byId.get(d.id);
      if (cur && k.jenis === cur.jenis) pilihKatalog(cur, k.id);
      else refreshModel({ keepPanel: true });
    });
  }

  /** Pilih / lepas alat katalog. Isian yang masih kosong otomatis diisi konfigurasi standar. */
  function pilihKatalog(d, katId) {
    // Ganti / lepas alat katalog: unit gudang alat lama kembali ke gudang (server melepasnya saat menyimpan).
    S.unit = (S.unit || []).filter(u => !(u.perangkat_id === d.id && u.katalog_id !== katId));
    if (!katId) return saveDev(d.id, { katalog_id: null }).catch(() => {});
    const k = S.katalog.find(x => x.id === katId);
    if (!k) return;
    saveDev(d.id, NP.Katalog.patchUntuk(d, k, false))
      .then(() => toast(`${d.nama}: ${NP.Katalog.label(k)} · konfigurasi standar diisikan ke isian yang kosong`))
      .catch(() => {});
  }

  function uplinkOptions(d) {
    const excl = S.model.descendants(d.id);
    excl.add(d.id);
    const cands = NP.Model.sortDev(S.list.filter(x => !excl.has(x.id) && !NP.nonJaringan(x)));
    return `<option value="">— tidak ada —</option>` + TYPE_ORDER.map(j => {
      const g = cands.filter(x => x.jenis === j);
      return g.length ? `<optgroup label="${esc(TYPES[j].label)}">${g.map(x => `<option value="${x.id}"${x.id === d.uplink_id ? ' selected' : ''}>${esc(x.nama)}${x.model ? ' · ' + esc(x.model) : ''}</option>`).join('')}</optgroup>` : '';
    }).join('');
  }

  function panelDev(d) {
    const t = TYPES[d.jenis] || TYPES.lainnya;
    const dis = S.canEdit ? '' : ' disabled';
    const a = d.atribut || {};
    return `
      <div class="pn-top">
      <div class="pn-head">
        <i class="glyph${NP.tampil(d).ikon ? ' sq' : ''}" style="background:${NP.tampil(d).color}">${NP.tampil(d).ikon ? NP.ikonSvg(NP.tampil(d).ikon, 20) : esc(NP.tampil(d).short)}</i>
        <div class="grow"><h3 id="pn-nama">${esc(d.nama)}</h3><span class="muted small">${esc(t.label)}${d.model ? ' · ' + esc(d.model) : ''}</span></div>
        <button type="button" class="icon" data-act="close" title="Tutup (Esc)">✕</button>
      </div>
      <div class="pn-actions">
        <button type="button" class="small" data-act="center">Pusatkan</button>
        ${S.canEdit ? `<button type="button" class="small${NP.terkunci(d) ? ' kunci-on' : ''}" data-act="kunci" title="${NP.terkunci(d) ? 'Posisi terkunci — klik untuk membuka (K)' : 'Kunci posisi agar titik tidak tergeser (K)'}">${NP.terkunci(d) ? '🔒 Terkunci' : '🔓 Kunci'}</button>
        <button type="button" class="small" data-act="dup">Duplikat</button>
        <button type="button" class="small danger" data-act="del">Hapus</button>` : ''}
      </div>
      <nav class="pn-tabs" role="tablist" aria-label="Bagian isian perangkat">
        <button type="button" role="tab" data-pt="info">Info<i class="pt-dot" hidden></i></button>
        <button type="button" role="tab" data-pt="identitas">Identitas</button>
        ${NP.nonJaringan(d) ? "" : `<button type="button" role="tab" data-pt="koneksi">Koneksi</button>`}
        <button type="button" role="tab" data-pt="jenis">${esc(tabJenis(d))}</button>
        ${NP.nonJaringan(d) ? '' : `<button type="button" role="tab" data-pt="unit">📦 Unit${unitOf(d) ? '<span class="pt-n" title="Unit gudang terpasang">✓</span>' : ''}</button>`}
        ${NP.isListrik(d) ? "" : `<button type="button" role="tab" data-pt="listrik">⚡ Listrik</button>`}
        ${d.jenis === "router" && S.canEdit ? `<button type="button" role="tab" data-pt="mikrotik">⚙ MikroTik</button>` : ""}
        <button type="button" role="tab" data-pt="ceklis">✓ Ceklis <span class="pt-n">${(p => p.selesai + "/" + p.total)(NP.ceklisProgres(d))}</span></button>
        ${NP.nonJaringan(d) ? "" : `<button type="button" role="tab" data-pt="grup">Group<span class="pt-n pt-grup" hidden></span></button>`}
      </nav>
      </div>
      <div data-pp="info">
        <div id="pn-info"></div>
        ${usulanBoxHtml(d)}
        <div id="pn-tim"></div>
        <div id="pn-verif"></div>
        <div id="pn-foto"></div>
        ${!S.lihat || S.tim ? '<div class="pn-sec" id="pn-riwayat"><h4>Riwayat status &amp; catatan</h4><p class="muted small">Memuat…</p></div>' : ''}
      </div>
      <form id="dev-form" autocomplete="off" onsubmit="return false">
        <div class="pn-sec" data-pp="identitas">
          <div class="fgrid">
            ${fieldHtml({ k: 'nama', label: 'Nama / label *' }, d.nama, dis)}
            <label class="field"><span>Jenis</span><select data-f="jenis"${dis}>${TYPE_ORDER.map(j => `<option value="${j}"${j === d.jenis ? ' selected' : ''}>${esc(TYPES[j].label)}</option>`).join('')}</select></label>
            ${katalogField(d, dis)}
            ${fieldHtml({ k: 'model', label: d.katalog_id != null ? 'Nama alat (dari katalog, bisa disesuaikan)' : 'Nama alat (merek/tipe)', ph: 'mis. MikroTik hAP ax², TP-Link EAP650', wide: true }, d.model, dis)}
            <div class="field wide"><span>Status pemasangan</span>${d.status === 'usulan' ? '<p class="small"><span class="st st-usulan">Usulan baru</span> — putuskan di kotak usulan (tab Info).</p>' : statusPicker(d, S.canEdit ? 'admin' : '')}</div>
            ${fieldHtml({ k: 'pic', label: 'PIC / teknisi' }, d.pic, dis)}
            ${multiLapisan() ? `<label class="field"><span>Layer jaringan</span><select data-lapisan-dev${dis}>${S.model.lapisanList().map(l => `<option value="${esc(l.id)}"${l.id === S.model.lapisanOf(d) ? ' selected' : ''}>${esc(l.nama)}</option>`).join('')}</select></label>` : ''}
            ${multiLantai() ? `<label class="field"><span>Lantai (denah)</span><select data-lantai-dev${dis}>${S.model.lantaiList().slice().reverse().map(l => `<option value="${esc(l.id)}"${l.id === S.model.lantaiOf(d) ? ' selected' : ''}>${esc(l.nama)}</option>`).join('')}</select></label>` : ''}
          </div>
        </div>
        <div class="pn-sec" data-pp="koneksi">
          <div class="fgrid">
            <label class="field wide"><span>Uplink (sumber koneksi)</span>
              <div class="inline"><select data-f="uplink_id"${dis}>${uplinkOptions(d)}</select>
              ${S.canEdit ? '<button type="button" class="small" data-act="pick" title="Pilih uplink dengan klik di denah">Pilih di denah</button>' : ''}
              ${S.canEdit && d.uplink_id != null ? '<button type="button" class="small danger" data-act="unlink" title="Hapus koneksi ke uplink">Putuskan</button>' : ''}</div></label>
            ${fieldHtml({ k: 'port_uplink', label: 'Port di uplink', ph: S.model.parentOf(d) && portKosong2(S.model.parentOf(d)).length ? 'pilih port kosong / ketik' : 'mis. ether3 / port 5', list: S.model.parentOf(d) ? portKosong2(S.model.parentOf(d)) : null }, d.port_uplink, dis)}
            ${fieldHtml({ k: 'port_lokal', label: 'Port di perangkat ini', ph: 'mis. ether1 / WAN' }, d.port_lokal, dis)}
            <label class="field"><span>Media ke uplink</span><select data-f="media"${dis}>${Object.keys(MEDIA).map(k => `<option value="${k}"${k === d.media ? ' selected' : ''}>${esc(MEDIA[k].label)}</option>`).join('')}</select></label>
            ${fieldHtml({ k: 'bandwidth_mbps', label: t.bwLabel, type: 'number' }, d.bandwidth_mbps, dis)}
            ${NP.perluKabel(d) ? `<div class="wide field"><span>Status penarikan kabel ke uplink</span>${kabelPicker([d.id], NP.kabelSt(d), bolehKabel(d), '')}</div>` : ''}
            ${S.model.parentOf(d) && !NP.nonJaringan(d) ? `<div class="wide">${vlanPortHtml(d, dis)}</div>` : ""}
            <div class="wide" id="pn-route"></div>
            ${d.jenis === 'router' || S.model.wanLain(d).length ? `<div class="wide" id="pn-wan">${wanEditor(d)}</div>` : ''}
            ${d.jenis === 'switch' ? `<div class="wide pn-up" id="pn-up">${uplinkEditor(d)}</div>` : ''}
            ${fieldHtml({ k: 'ip', label: 'IP address', ph: 'mis. 10.10.0.11/22 · DHCP' }, d.ip, dis)}
            ${fieldHtml({ k: 'vlan', label: 'VLAN', ph: 'mis. 10 (tamu)' }, d.vlan, dis)}
          </div>
        </div>
        <div data-pp="jenis">
          ${d.jenis === "router" && S.canEdit ? `<div class="pn-sec"><h4>Konfigurasi router <span class="small">sekali isi — dipakai juga untuk script MikroTik</span></h4>${mtFormHtml(d)}</div>` : t.fields.length ? `<div class="pn-sec">
            <h4>Pengaturan ${esc(t.label)}</h4>
            ${["ap", "bridge"].includes(d.jenis) ? wifiCopyHtml(d) : ""}
            ${NP.isListrik(d) ? `<div id="mcb-live">${mcbInfoHtml(d, a)}</div>` : ''}
            <div class="fgrid">${t.fields.map(f => fieldHtml(Object.assign({ attr: true }, f), a[f.k], dis)).join('')}</div>
          </div>` : ''}
          <div class="pn-sec">
            <h4>Keterangan konfigurasi</h4>
            <textarea data-f="catatan" rows="8" class="mono" placeholder="Catatan setting, mis.&#10;- ether1 → WAN Indihome (PPPoE: user@telkom.net)&#10;- bridge-lan: ether2-5, VLAN 10/20&#10;- /ip dhcp-server ... lease 30m&#10;- AP mode: access point, controller 10.10.0.5"${dis}>${esc(d.catatan)}</textarea>
          </div>
        </div>
        ${NP.nonJaringan(d) ? '' : `<div data-pp="unit">${unitPanelHtml(d, dis)}</div>`}
      </form>
      ${d.jenis === "router" && S.canEdit ? `<div data-pp="mikrotik">${mtPanelHtml(d)}</div>` : ""}
      <div data-pp="ceklis">${ceklisPanelHtml(d)}</div>
      ${NP.isListrik(d) ? "" : `<div data-pp="listrik">${dayaSection(d, dis)}</div>`}
      <div data-pp="grup">
        <div class="pn-sec" id="pn-grup-sec"><h4>Group perangkat ini</h4><div id="pn-grup"></div></div>
        <div class="pn-sec" id="pn-grup-anak-sec"><h4>Group perangkat yang terhubung ke sini</h4><div id="pn-grup-anak-box"></div></div>
      </div>
      ${S.canEdit ? '<p class="muted small pn-auto">Semua isian tersimpan otomatis saat pindah isian · Ctrl+Z membatalkan.</p>' : ''}`;
  }

  // ------------------------------------------------------------------------ multi-WAN (router)

  /** Simpan daftar WAN tambahan + mode di atribut perangkat (JSON [{id, port}]). */
  function simpanWan(d, daftar, mode) {
    const atr = Object.assign({}, d.atribut);
    if (daftar.length) atr.wan_lain = JSON.stringify(daftar.map(w => Object.assign({ id: w.id, port: w.port || '' }, w.kabel && w.kabel !== 'belum' ? { kabel: w.kabel } : {}, w.jalur ? { jalur: w.jalur } : {})));
    else delete atr.wan_lain;
    if (mode) atr.wan_mode = mode;
    if (!daftar.length) delete atr.wan_mode;
    return saveDev(d.id, { atribut: atr }).catch(() => {});
  }
  const wanList = d => S.model.linkLain(d).filter(w => w.kunci === 'wan_lain').map(w => ({ id: w.dev.id, port: w.port, kabel: w.kabel, jalur: w.jalur }));

  // ------------------------------------------------------------------------ uplink kedua (switch): redundan / LACP

  const upList = d => S.model.uplinkLain(d).map(w => ({ id: w.dev.id, port: w.port, media: w.media, kabel: w.kabel, jalur: w.jalur }));
  function simpanUplink(d, daftar, mode) {
    const atr = Object.assign({}, d.atribut);
    if (daftar.length) {
      atr.uplink_lain = JSON.stringify(daftar.map(w => Object.assign({ id: w.id, port: w.port || '', media: w.media || 'utp' }, w.kabel && w.kabel !== 'belum' ? { kabel: w.kabel } : {}, w.jalur ? { jalur: w.jalur } : {})));
      atr.uplink_mode = mode || 'redundan';
    } else {
      delete atr.uplink_lain;
      delete atr.uplink_mode;
    }
    return saveDev(d.id, { atribut: atr }).catch(() => {});
  }

  /** Calon uplink kedua: router/switch lain yang bukan perangkat di bawahnya (agar tidak loop). */
  function calonUplink(d) {
    const m = S.model;
    const bawah = m.descendants(d.id);
    const pakai = new Set(m.uplinkLain(d).map(w => w.dev.id));
    return NP.Model.sortDev(m.list.filter(x => ['router', 'switch'].includes(x.jenis) && x.id !== d.id && !bawah.has(x.id) && !pakai.has(x.id)));
  }

  function uplinkEditor(d) {
    const m = S.model;
    const dis = S.canEdit ? '' : ' disabled';
    const lain = m.uplinkLain(d);
    const mode = m.uplinkMode(d);
    const p = m.parentOf(d);
    const calon = calonUplink(d);
    const baris = (no, x, isi) => `<div class="wan-row"><span class="wan-no up">UP${no}</span>
      <span class="dotlbl"><i style="background:${NP.tampil(x).color}"></i><b>${esc(x.nama)}</b></span>
      <span class="muted small">${esc(TYPES[x.jenis].label)}</span>${konBadge(m.koneksi(x))}<span class="spacer"></span>${isi}</div>`;
    let h = `<span class="route-lbl">Uplink switch${lain.length ? ` · <b>${lain.length + (p ? 1 : 0)} uplink · ${mode === 'lacp' ? 'LACP' : 'redundan'}</b>` : ''}</span><div class="wan-list">`;
    h += p ? baris(1, p, `<span class="tag-kat">utama</span>`) : '<div class="wan-row muted small"><span class="wan-no up">UP1</span>Pilih Uplink utama di atas</div>';
    lain.forEach((w, i) => {
      h += baris(i + 2, w.dev, `${kabelLainBtn(d, { dev: w.dev, kabel: w.kabel, kunci: 'uplink_lain' }, bolehKabel(d))}`) +
        `<div class="wan-row sub"><input type="text" class="wan-port" data-up-port="${w.dev.id}" value="${esc(w.port)}" placeholder="port, mis. sfp1 / ge24" aria-label="Port UP${i + 2}"${dis}>
          <select data-up-media="${w.dev.id}" aria-label="Media UP${i + 2}"${dis}><option value="utp"${w.media === 'utp' ? ' selected' : ''}>UTP</option><option value="fiber"${w.media === 'fiber' ? ' selected' : ''}>Fiber optik</option></select>
          ${S.canEdit ? `<button type="button" class="small danger" data-up-del="${w.dev.id}" title="Lepas UP${i + 2}">✕</button>` : ''}</div>`;
    });
    h += '</div>';
    if (S.canEdit) {
      h += `<div class="inline wan-add">${calon.length
        ? `<select data-up-add aria-label="Tambah uplink kedua"><option value="">+ Tambah uplink kedua (redundan / LACP)…</option>${calon.map(x => `<option value="${x.id}">${esc(x.nama)} — ${esc(TYPES[x.jenis].label)}${p && x.id === p.id ? ' (kabel kedua ke uplink yang sama = LACP)' : ''}</option>`).join('')}</select>`
        : '<span class="muted small">Tidak ada router/switch lain yang bisa jadi uplink kedua.</span>'}</div>`;
    }
    if (lain.length) {
      h += `<label class="field"><span>Mode uplink</span><select data-up-mode${dis}>
        <option value="redundan"${mode === 'redundan' ? ' selected' : ''}>Redundan (STP/RSTP) — satu aktif, lainnya cadangan</option>
        <option value="lacp"${mode === 'lacp' ? ' selected' : ''}>LACP (802.3ad) — kabel digabung, bandwidth dijumlah</option></select></label>
        <p class="muted small">${mode === 'lacp' ? 'Bandwidth maks. = jumlah semua uplink. LACP ke switch berbeda butuh stacking/MLAG.' : 'Internet tetap tersambung selama salah satu uplink masih baik. Aktifkan STP/RSTP agar tidak loop.'}</p>`;
    }
    return h;
  }

  $('#panel').addEventListener('change', e => {
    if (!S.canEdit || S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    const add = e.target.closest('[data-up-add]');
    if (add && add.value) {
      const x = S.model.byId.get(+add.value);
      const lacp = d.uplink_id === x.id;
      return simpanUplink(d, [...upList(d), { id: x.id, port: '', media: 'utp' }], lacp ? 'lacp' : S.model.uplinkMode(d))
        .then(() => toast(`${x.nama} ditambahkan sebagai uplink kedua ${d.nama}${lacp ? ' (LACP)' : ' (redundan)'}`));
    }
    const port = e.target.closest('[data-up-port]');
    if (port) return simpanUplink(d, upList(d).map(w => (w.id === +port.dataset.upPort ? Object.assign(w, { port: port.value.trim().slice(0, 50) }) : w)), S.model.uplinkMode(d));
    const media = e.target.closest('[data-up-media]');
    if (media) return simpanUplink(d, upList(d).map(w => (w.id === +media.dataset.upMedia ? Object.assign(w, { media: media.value }) : w)), S.model.uplinkMode(d));
    const mode = e.target.closest('[data-up-mode]');
    if (mode) return simpanUplink(d, upList(d), mode.value);
  });
  $('#panel').addEventListener('click', e => {
    const del = e.target.closest('[data-up-del]');
    if (!del || !S.canEdit || S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    simpanUplink(d, upList(d).filter(w => w.id !== +del.dataset.upDel), S.model.uplinkMode(d));
  });

  /** Editor WAN: WAN utama (lewat uplink) + WAN tambahan ke Sumber WAN/ISP lain, mode failover / load balance. */
  function wanEditor(d) {
    const m = S.model;
    const dis = S.canEdit ? '' : ' disabled';
    const utama = m.wanOf(d);
    const lain = m.wanLain(d);
    const mode = m.wanMode(d);
    const bw = x => (x.bandwidth_mbps != null ? ' · ' + fmtBw(x.bandwidth_mbps) : '');
    const prov = x => esc([x.atribut.provider, x.atribut.jenis_koneksi].filter(Boolean).join(' · '));
    const pakai = new Set([d.id, d.uplink_id, ...lain.map(w => w.dev.id), utama && utama.id]);
    const calon = NP.Model.sortDev(m.list.filter(x => x.jenis === 'isp' && !pakai.has(x.id)));
    const baris = (no, x, isi) => `<div class="wan-row"><span class="wan-no">WAN${no}</span>
      <span class="dotlbl"><i style="background:${NP.tampil(x).color}"></i><b>${esc(x.nama)}</b></span>
      <span class="muted small">${prov(x)}${bw(x)}</span><span class="spacer"></span>${isi}</div>`;
    let h = `<span class="route-lbl">WAN / sumber internet${lain.length ? ` · <b>${lain.length + (utama ? 1 : 0)} WAN</b>` : ''}</span><div class="wan-list">`;
    h += utama
      ? baris(1, utama, `<span class="tag-kat" title="Lewat uplink">utama</span>`)
      : `<div class="wan-row muted small"><span class="wan-no">WAN1</span>Lewat uplink — ${d.uplink_id != null ? 'belum berujung di Sumber WAN' : 'pilih Uplink ke Sumber WAN/ISP di atas'}</div>`;
    lain.forEach((w, i) => {
      h += baris(i + 2, w.dev, kabelLainBtn(d, { dev: w.dev, kabel: statusLain(d, { ke: w.dev.id, kunci: 'wan_lain' }), kunci: 'wan_lain' }, bolehKabel(d)) +
        `<input type="text" class="wan-port" data-wan-port="${w.dev.id}" value="${esc(w.port)}" placeholder="port, mis. ether2" aria-label="Port WAN${i + 2}"${dis}>` +
        (S.canEdit ? `<button type="button" class="small danger" data-wan-del="${w.dev.id}" title="Lepas WAN${i + 2}">✕</button>` : ''));
    });
    h += '</div>';
    if (S.canEdit) {
      h += `<div class="inline wan-add">${calon.length
        ? `<select data-wan-add aria-label="Tambah WAN"><option value="">+ Tambah WAN dari Sumber WAN/ISP…</option>${calon.map(x => `<option value="${x.id}">${esc(x.nama)}${x.atribut.provider ? ' — ' + esc(x.atribut.provider) : ''}${esc(bw(x))}</option>`).join('')}</select>`
        : '<span class="muted small">Taruh Sumber WAN/ISP lain di denah untuk menambah WAN (atau alat Hubungkan: router → ISP kedua).</span>'}</div>`;
    }
    if (lain.length) {
      h += `<label class="field"><span>Mode multi-WAN</span><select data-wan-mode${dis}>
        <option value="failover"${mode === 'failover' ? ' selected' : ''}>Failover — WAN berikutnya cadangan bila WAN utama putus</option>
        <option value="loadbalance"${mode === 'loadbalance' ? ' selected' : ''}>Load balance — bandwidth semua WAN digabung</option></select></label>
        <p class="muted small">Internet dianggap tersambung selama salah satu WAN masih baik. Bandwidth maks.: ${mode === 'loadbalance' ? 'jumlah semua WAN' : 'WAN terbesar'}.</p>`;
    }
    return h;
  }

  $('#panel').addEventListener('change', e => {
    if (!S.canEdit || S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    const add = e.target.closest('[data-wan-add]');
    if (add && add.value) {
      const isp = S.model.byId.get(+add.value);
      return simpanWan(d, [...wanList(d), { id: +add.value, port: '' }], S.model.wanMode(d))
        .then(() => toast(`${isp.nama} ditambahkan sebagai WAN${S.model.wanLain(d).length + 1} untuk ${d.nama}`));
    }
    const port = e.target.closest('[data-wan-port]');
    if (port) return simpanWan(d, wanList(d).map(w => (w.id === +port.dataset.wanPort ? { id: w.id, port: port.value.trim().slice(0, 50) } : w)), S.model.wanMode(d));
    const mode = e.target.closest('[data-wan-mode]');
    if (mode) return simpanWan(d, wanList(d), mode.value);
  });
  $('#panel').addEventListener('click', e => {
    const del = e.target.closest('[data-wan-del]');
    if (!del || !S.canEdit || S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    simpanWan(d, wanList(d).filter(w => w.id !== +del.dataset.wanDel), S.model.wanMode(d));
  });

  // ------------------------------------------------------------------------ daya listrik

  const LISTRIK = NP.LISTRIK;
  const listrikBadge = k => {
    const x = LISTRIK[k] || LISTRIK[''];
    return `<span class="kb${k ? '' : ' kb-belum'}"${k ? ` style="background:${x.color}"` : ''}>${esc(x.short)}</span>`;
  };
  // Watt persis (mis. 3.520 W) agar mudah dicocokkan dengan perhitungan MCB di lapangan.
  const fmtW = w => Math.round(w).toLocaleString('id-ID') + ' W';

  /** Bagian "Daya listrik" perangkat jaringan: sumber di lokasi, titik listrik pemasok, konsumsi daya. */
  function dayaSection(d, dis) {
    const m = S.model;
    const a = d.atribut || {};
    const titik = m.list.filter(NP.isListrik)
      // Titik listrik di lantai yang sama lebih dulu (jarak hanya bisa diukur di denah yang sama).
      .map(L => ({ L, beda: m.bedaLantai(d, L), jarak: m.bedaLantai(d, L) ? 0 : m.distPx(d, L) * (m.skalaOf(d) || 0) }))
      .sort((x, y) => x.beda - y.beda || m.distPx(d, x.L) - m.distPx(d, y.L));
    const katW = parseFloat(m.spec(d).daya_w) > 0 ? parseFloat(m.spec(d).daya_w) : null;
    const L = m.listrikOf(d);
    // Ringkasan titik listrik terpilih: kapasitas MCB, terpakai (termasuk perangkat ini) & sisa.
    let ringkas = '';
    if (L) {
      const b = m.bebanListrik().find(x => x.L.id === L.id);
      const mcb = NP.dayaMcb(L.atribut || {});
      const sisa = b && b.kap ? b.kap - b.watt : null;
      ringkas = `<div class="lst-src">
        <div class="lst-src-h"><button type="button" class="chip" data-sel="${L.id}"><i style="background:${TYPES.listrik.color}"></i>⚡ ${esc(L.nama)}</button>
          <span class="muted small">${mcb ? `MCB ${mcb.a} A · ${mcb.v} V${mcb.tiga ? ' · 3 fase' : ''}` : 'MCB belum diisi'}</span>
          ${S.canEdit ? '<button type="button" class="small" data-listrik-lepas>Lepas</button>' : ''}</div>
        ${b && b.kap ? `<div class="kb-bar"><i style="width:${Math.min(100, b.pct)}%;background:${warnaBeban(b.pct)}"></i></div>
          <div class="mcb-rows"><span>Kapasitas</span><b>${fmtW(b.kap)}</b><span>Terpakai (${b.devs.length} perangkat)</span><b>${fmtW(b.watt)} (${b.pct}%)</b>
            <span>Sisa</span><b class="${sisa < 0 ? 'bad' : b.pct >= 80 ? 'warn-t' : 'ok-t'}">${fmtSisa(sisa)}</b></div>` : ''}
      </div>`;
    }
    return `<div class="pn-sec">
      <h4>Listrik <span class="small">opsional — kosongkan bila tidak perlu dicatat</span></h4>
      ${titik.length ? `<label class="field"><span>Sumber listrik (titik listrik yang sudah dibuat)</span>
        <select data-listrik-src${dis}><option value="">— tidak memakai titik listrik —</option>${titik.map(x => `<option value="${x.L.id}"${L && L.id === x.L.id ? ' selected' : ''}>${esc(x.L.nama)}${x.jarak ? ' · ≈ ' + esc(fmtM(x.jarak)) : ''}${x.beda ? ' · ' + esc(namaLantai(x.L)) : ''}${(() => { const mc = NP.dayaMcb(x.L.atribut || {}); return mc ? ' · MCB ' + mc.a + ' A' : ''; })()}</option>`).join('')}</select></label>`
        : `<p class="note">Belum ada titik listrik di event ini.${S.canEdit ? ' <button type="button" class="small" data-listrik-buat>⚡ Buat titik listrik</button>' : ''}</p>`}
      ${ringkas}
      <div class="fgrid">
        <label class="field"><span>Listrik di lokasi</span>
          <select data-f="listrik" data-attr="1"${dis}>${Object.keys(LISTRIK).map(k => `<option value="${k}"${(a.listrik || '') === k ? ' selected' : ''}>${esc(LISTRIK[k].label)}</option>`).join('')}</select></label>
        ${fieldHtml({ k: 'daya_w', label: NP.nonJaringan(d) ? 'Daya per unit (W) × jumlah' : 'Konsumsi daya (W)', type: 'number', ph: katW ? `dari katalog: ${katW} W` : 'mis. 15', attr: true }, a.daya_w, dis)}
      </div>
    </div>`;
  }

  // Sumber listrik dipilih / dilepas dari menu Listrik perangkat.
  $('#panel').addEventListener('change', e => {
    const sel = e.target.closest('[data-listrik-src]');
    if (!sel || !S.canEdit || S.sel == null) return;
    pasangListrik([S.sel], sel.value ? +sel.value : null);
  });
  $('#panel').addEventListener('click', e => {
    if (e.target.closest('[data-listrik-lepas]') && S.canEdit && S.sel != null) return pasangListrik([S.sel], null);
    if (e.target.closest('[data-listrik-buat]')) setTool('tambah:listrik');
  });

  /**
   * Pasang / lepas titik listrik pemasok untuk satu atau banyak perangkat (bisa di-Ctrl+Z sebagai satu langkah).
   * Memasang mengisi "Listrik di lokasi" = stop kontak tersedia bila belum diisi / PoE / baterai.
   */
  async function pasangListrik(ids, lid) {
    const L = lid != null ? S.model.byId.get(lid) : null;
    const ds = ids.map(id => S.model.byId.get(id)).filter(d => d && !NP.isListrik(d));
    if (!ds.length) return toast('Tidak ada perangkat yang bisa diberi sumber listrik', true);
    await kelompok(L ? `sumber listrik ${ds.length > 1 ? ds.length + ' perangkat' : ds[0].nama} → ${L.nama}` : `lepas sumber listrik ${ds.length > 1 ? ds.length + ' perangkat' : ds[0].nama}`, async () => {
      for (const d of ds) {
        const atr = Object.assign({}, d.atribut);
        if (L) {
          atr.listrik_id = String(L.id);
          if (!atr.listrik || atr.listrik === 'poe' || atr.listrik === 'baterai') atr.listrik = 'ada';
        } else {
          delete atr.listrik_id;
        }
        await saveDev(d.id, { atribut: atr }, { keepPanel: ds.length > 1 }).catch(() => {});
      }
    });
    toast(L ? `${ds.length > 1 ? ds.length + ' perangkat' : ds[0].nama} ⚡ memakai listrik dari ${L.nama}` : `Sumber listrik ${ds.length > 1 ? ds.length + ' perangkat' : ds[0].nama} dilepas`);
  }

  /**
   * Pindahkan perangkat ke layer jaringan lid. Dengan bawahnya = semua perangkat di bawahnya ikut (satu jaringan).
   * Satu langkah Ctrl+Z.
   */
  async function pindahLapisan(ids, lid, bawahnya) {
    const m = S.model;
    const semua = new Set(ids);
    if (bawahnya) ids.forEach(id => m.descendants(id).forEach(x => semua.add(x)));
    const ds = [...semua].map(id => m.byId.get(id)).filter(d => d && m.lapisanOf(d) !== lid);
    const L = m.lapisanById(lid);
    if (!ds.length) return toast(`Semua perangkat terpilih sudah di layer ${L.nama}`);
    await kelompok(`pindah ${ds.length} perangkat ke layer ${L.nama}`, async () => {
      for (const d of ds) {
        await saveDev(d.id, { atribut: Object.assign({}, d.atribut, { lapisan: lid }) }, { keepPanel: true }).catch(() => {});
      }
    });
    // Layer aktif tertentu: ikut ke layer tujuan agar perangkat yang dipindah tetap terlihat.
    if (S.lapisan !== 'semua' && S.lapisan !== lid && ds.some(d => d.id === S.sel)) setLapisan(lid);
    toast(`${ds.length} perangkat dipindah ke layer ${L.nama} (Ctrl+Z untuk membatalkan)`);
  }
  /**
   * Pindahkan perangkat ke lantai lid. Posisi diskalakan mengikuti ukuran denah tujuan (denah dianggap sejajar);
   * lekukan jalur kabel dihapus karena digambar di denah lantai asal. Satu langkah Ctrl+Z; peta ikut ke lantai tujuan.
   */
  async function pindahLantai(ids, lid) {
    const m = S.model;
    const ds = ids.map(id => m.byId.get(id)).filter(d => d && m.lantaiOf(d) !== lid);
    const L = m.lantaiById(lid);
    if (!ds.length) return toast(`Semua perangkat terpilih sudah di ${L.nama}`);
    const tuju = ukuranLantai(lid);
    await kelompok(`pindah ${ds.length} perangkat ke ${L.nama}`, async () => {
      for (const d of ds) {
        const asal = ukuranLantai(m.lantaiOf(d));
        const atribut = Object.assign({}, d.atribut);
        if (atrLantai(lid)) atribut.lantai = lid;
        else delete atribut.lantai;
        const r = v => Math.round(v * 10) / 10;
        await saveDev(d.id, { atribut, x: r(d.x * tuju.W / asal.W), y: r(d.y * tuju.H / asal.H), jalur: null }, { keepPanel: true }).catch(() => {});
      }
    });
    toast(`${ds.length} perangkat dipindah ke ${L.nama} (Ctrl+Z untuk membatalkan)`);
  }
  $('#panel').addEventListener('change', async e => {
    const s = e.target.closest('[data-lantai-dev]');
    if (!s || S.sel == null || !S.canEdit) return;
    const id = S.sel;
    await pindahLantai([id], s.value);
    selectDev(id, true); // tampilkan denah lantai tujuan
  });
  $('#bulk-lantai').addEventListener('change', e => {
    const v = e.target.value;
    e.target.value = '';
    if (!v || !S.pilih.size) return;
    if (!confirm(`Pindahkan ${S.pilih.size} perangkat terpilih ke ${S.model.lantaiById(v).nama}?`)) return;
    pindahLantai([...S.pilih], v);
  });
  $('#panel').addEventListener('change', e => {
    const s = e.target.closest('[data-lapisan-dev]');
    if (!s || S.sel == null || !S.canEdit) return;
    pindahLapisan([S.sel], s.value, true);
  });

  /** Sel daftar untuk titik listrik: beban / kapasitas. */
  function listrikTitikCell(L) {
    const b = S.model.bebanListrik().find(x => x.L.id === L.id);
    if (!b) return '';
    const bad = b.pct != null && b.pct > 100;
    return `<span${bad ? ' class="bad"' : ''}>⚡ ${fmtW(b.watt)}${b.kap ? ' / ' + fmtW(b.kap) + ` (${b.pct}%)` : ''}</span> <span class="muted">${b.devs.length} perangkat</span>`;
  }

  /** Kartu "Kebutuhan listrik" di tab Topologi. */
  function listrikSumHtml() {
    const m = S.model;
    const rk = m.ringkasListrik();
    const beban = m.bebanListrik();
    const chipL = d => `<a href="#" class="dev-link" data-sel="${d.id}"><i style="background:${NP.tampil(d).color}">${esc(NP.tampil(d).short)}</i>${esc(d.nama)}</a>`;
    let h = `<p style="margin:0 0 8px">Total konsumsi perangkat: <b>${fmtW(rk.total)}</b></p>`;
    h += `<div class="legend">${['perlu', 'ada', 'poe', 'baterai', ''].map(k => `<span class="lg-item"><i class="kb-dot" style="background:${LISTRIK[k].color}"></i>${esc(LISTRIK[k].label)}<b>${rk.per[k].length}</b></span>`).join('')}</div>`;
    if (rk.per.perlu.length) {
      h += `<p class="small" style="margin:8px 0 4px"><b>Perlu tarik listrik:</b></p><div class="path wrap">${NP.Model.sortDev(rk.per.perlu).map(d => `<span>${chipL(d)}</span>`).join(' ')}</div>`;
    }
    h += beban.length
      ? `<table class="mini" style="margin-top:10px"><tr><th>Titik listrik</th><th class="num">Beban</th><th class="num">Kapasitas</th><th class="num">Soket</th></tr>${beban.map(b => {
        const warna = b.pct == null ? '#94a3b8' : b.pct > 100 ? '#dc2626' : b.pct >= 80 ? '#d97706' : '#16a34a';
        return `<tr><td>${chipL(b.L)}<div class="kb-bar" style="margin:4px 0 0;height:6px"><i style="width:${Math.min(100, b.pct || 0)}%;background:${warna}"></i></div></td>
          <td class="num">${fmtW(b.watt)}${b.pct != null ? ` <span class="muted">(${b.pct}%)</span>` : ''}</td><td class="num">${b.kap ? fmtW(b.kap) : '—'}</td>
          <td class="num">${b.soket ? `${b.devs.length}/${b.soket}` : b.devs.length}</td></tr>`;
      }).join('')}</table>`
      : '<p class="muted small" style="margin-top:8px">Belum ada titik listrik. Tambahkan dari toolbar denah (⚡ Titik listrik) untuk menghitung beban daya.</p>';
    return h;
  }

  /**
   * Ringkasan daya dari MCB untuk titik listrik: daya maksimal, batas aman 80%, terpakai & sisa.
   * atr = isian (bisa nilai yang sedang diketik, untuk pratinjau langsung).
   */
  function mcbInfoHtml(L, atr) {
    const mcb = NP.dayaMcb(atr);
    const manual = parseFloat(atr.kapasitas_w) > 0 ? parseFloat(atr.kapasitas_w) : null;
    const kap = manual || (mcb && mcb.w);
    if (!kap) return '<div class="mcb-info kosong">Isi <b>MCB (A)</b> untuk menghitung daya yang bisa dipakai di titik listrik ini.</div>';
    const b = S.model.bebanListrik().find(x => x.L.id === L.id);
    const pakai = b ? b.watt : 0;
    const aman = kap * 0.8;
    const sisa = kap - pakai;
    return `<div class="mcb-info">
      <div class="mcb-big">${fmtW(kap)}</div>
      <div class="muted small">${manual ? 'kapasitas manual' : `MCB ${mcb.a} A × ${mcb.v} V${mcb.tiga ? ' × √3 (3 fase)' : ''}`}</div>
      <div class="mcb-rows">
        <span>Aman dipakai (80%)</span><b>${fmtW(aman)}</b>
        <span>Terpakai</span><b>${fmtW(pakai)}${b && b.devs.length ? ` <span class="muted">(${b.devs.length} perangkat)</span>` : ''}</b>
        <span>Sisa</span><b class="${sisa < 0 ? 'bad' : pakai > aman ? 'warn-t' : 'ok-t'}">${sisa < 0 ? 'kurang ' + fmtW(-sisa) : fmtW(sisa)}</b>
      </div>
    </div>`;
  }

  // Pratinjau langsung saat MCB / tegangan / fase / kapasitas diketik (sebelum tersimpan).
  $('#panel').addEventListener('input', e => {
    const box = $('#mcb-live');
    const inp = e.target.closest('[data-f]');
    if (!box || !inp || !['arus_a', 'tegangan_v', 'fase', 'kapasitas_w'].includes(inp.dataset.f) || S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    const atr = Object.assign({}, d.atribut);
    ['arus_a', 'tegangan_v', 'fase', 'kapasitas_w'].forEach(k => {
      const el = $(`#panel [data-f="${k}"]`);
      if (el) atr[k] = el.value;
    });
    box.innerHTML = mcbInfoHtml(d, atr);
  });

  /** Info peralatan support: kategori, jumlah, daya & titik listrik pemasoknya. */
  function infoSupport(d, chip) {
    const m = S.model;
    const a = d.atribut || {};
    const Lp = m.listrikOf(d);
    const w = m.dayaW(d);
    let h = '<div class="pn-sec info">';
    h += `<div class="kv"><span>Kategori</span><b>${esc(a.kategori_support || '—')}${a.jumlah && +a.jumlah > 1 ? ' · ' + esc(a.jumlah) + ' unit' : ''}</b></div>`;
    if (a.kapasitas_support) h += `<div class="kv"><span>Kapasitas / ukuran</span><b>${esc(a.kapasitas_support)}</b></div>`;
    h += `<div class="kv"><span>Listrik</span><b>${listrikBadge(a.listrik || '')}${Lp ? ` ⚡ ${chip(Lp)}` : ''}${w ? ` <span class="muted">${fmtW(w)}</span>` : ''}</b></div>`;
    const issues = m.checks().filter(c => c.ids.includes(d.id));
    if (issues.length) h += `<ul class="issues">${issues.map(c => `<li class="lv-${c.level}">${esc(c.msg)}</li>`).join('')}</ul>`;
    return h + '</div>';
  }

  /** Info titik listrik: kapasitas, beban perangkat yang ditenagai, stop kontak. */
  function infoListrik(L, chip) {
    const m = S.model;
    const b = m.bebanListrik().find(x => x.L.id === L.id) || { devs: [], watt: 0, kap: m.kapasitasW(L), pct: null, tanpaDaya: 0, soket: null };
    const warna = b.pct == null ? '#94a3b8' : b.pct > 100 ? '#dc2626' : b.pct >= 80 ? '#d97706' : '#16a34a';
    const a = L.atribut || {};
    let h = '<div class="pn-sec info">';
    h += mcbInfoHtml(L, a);
    h += `<div class="kv"><span>Sumber</span><b>${esc(a.sumber_listrik || '—')}${a.lokasi_panel ? ' · ' + esc(a.lokasi_panel) : ''}</b></div>`;
    h += `<div class="kv col"><span>Beban ${b.devs.length} perangkat: <b>${fmtW(b.watt)}</b>${b.kap ? ` dari ${fmtW(b.kap)} (${b.pct}%)` : ''}${b.tanpaDaya ? ` · <span class="muted">${b.tanpaDaya} belum diisi watt-nya</span>` : ''}</span>
      ${b.kap ? `<div class="kb-bar"><i style="width:${Math.min(100, b.pct)}%;background:${warna}"></i></div>` : ''}</div>`;
    if (b.soket) h += `<div class="kv"><span>Stop kontak</span><b${b.devs.length > b.soket ? ' class="bad"' : ''}>${b.devs.length} / ${b.soket} terpakai</b></div>`;
    h += b.devs.length
      ? `<div class="path wrap">${NP.Model.sortDev(b.devs).map(d => `<span class="wan-chip">${chip(d)} <span class="muted small">${m.dayaW(d) ? fmtW(m.dayaW(d)) : '? W'}</span></span>`).join('')}</div>`
      : '<p class="muted small">Belum ada perangkat yang memakai titik listrik ini. Pilih di tab pengaturan perangkat (Daya listrik), atau pakai alat <b>Hubungkan</b>: perangkat → titik listrik ini.</p>';
    const issues = m.checks().filter(c => c.ids.includes(L.id));
    if (issues.length) h += `<ul class="issues">${issues.map(c => `<li class="lv-${c.level}">${esc(c.msg)}</li>`).join('')}</ul>`;
    return h + '</div>';
  }

  /** Label tab pengaturan khusus jenis: "Switch", "Access Point", "Sumber WAN", "Laptop", … */
  function tabJenis(d) {
    if (d.jenis === 'endpoint') return NP.tampil(d).label || 'Endpoint';
    const t = TYPES[d.jenis] || TYPES.lainnya;
    return t.label.replace(/\s*\(.*\)/, '').split(' / ')[0] || 'Konfigurasi';
  }

  // Tab panel perangkat; tab terakhir diingat agar mengisi banyak perangkat (mis. IP) tidak perlu pindah tab terus.
  let pnTab = 'info';
  try { pnTab = localStorage.getItem('np-pn-tab') || 'info'; } catch (err) { /* abaikan */ }

  function terapkanPnTab() {
    const body = $('#panel-body');
    if (!body.querySelector('.pn-tabs')) return;
    const aktif = body.querySelector(`.pn-tabs [data-pt="${pnTab}"]`) ? pnTab : 'info';
    $$('.pn-tabs [data-pt]', body).forEach(b => {
      const on = b.dataset.pt === aktif;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    $$('[data-pp]', body).forEach(p => { p.hidden = p.dataset.pp !== aktif; });
  }

  $('#panel').addEventListener('click', e => {
    const b = e.target.closest('.pn-tabs [data-pt]');
    if (!b) return;
    pnTab = b.dataset.pt;
    try { localStorage.setItem('np-pn-tab', pnTab); } catch (err) { /* abaikan */ }
    terapkanPnTab();
    $('#panel').scrollTop = 0;
    $('#panel-body').scrollTop = 0;
  });

  /** Bagian info (jalur WAN, bandwidth, kabel, anak, peringatan) — diperbarui tanpa mengganggu form. */
  function renderPanelInfo() {
    const box = $('#pn-info');
    const d = S.sel != null && S.model.byId.get(S.sel);
    if (!box || !d) {
      if (!box && S.tab === 'denah' && peta.tool !== 'ukur') renderPanel();
      return;
    }
    if ($('#panel-body .grup-input[data-dirty]')) return; // nama group sedang diketik
    const m = S.model;
    const nm = $('#pn-nama');
    if (nm) nm.textContent = d.nama;
    $('#sheet-title').textContent = d.nama;
    const path = m.path(d);
    const wan = m.wanOf(d);
    const bw = m.bwEfektif(d);
    const kids = NP.Model.sortDev(m.kids(d.id));
    const sumKids = kids.reduce((s, c) => s + (c.bandwidth_mbps || 0), 0);
    const jarak = m.jarakM(d);
    const kabel = m.kabelM(d);
    const issues = m.checks().filter(c => c.ids.includes(d.id));
    const chip = x => `<button type="button" class="chip" data-sel="${x.id}"><i style="background:${NP.tampil(x).color}"></i>${esc(x.nama)}</button>`;

    if (NP.nonJaringan(d)) {
      box.innerHTML = NP.isListrik(d) ? infoListrik(d, chip) : infoSupport(d, chip);
      renderTimBox(d);
      renderVerif(d);
      renderFoto(d);
      renderRiwayat(d);
      return;
    }
    const kon = m.koneksi(d);
    let h = `<div class="pn-sec info"><div class="kv"><span>Internet</span><b>${konBadge(kon)}${kon === 'gangguan'
      ? ` <span class="muted">(${esc(path.filter(n => n.status === 'bermasalah').map(n => n.nama).join(', '))} bermasalah)</span>` : ''}</b></div>`;
    if (d.jenis === 'isp' && !m.parentOf(d)) {
      h += `<div class="kv"><span>Sumber WAN</span><b>${esc(d.atribut.provider || d.nama)}${d.bandwidth_mbps != null ? ' · ' + fmtBw(d.bandwidth_mbps) : ''}</b></div>`;
    } else {
      h += `<div class="kv col"><span>Jalur ke internet</span><div class="path">${path.map(chip).join('<span class="arr">→</span>')}${wan ? '' : '<span class="lv warn">tanpa sumber WAN</span>'}</div></div>`;
      const semuaWan = m.wans(d);
      const wanTxt = x => esc([x.atribut.provider, x.atribut.jenis_koneksi].filter(Boolean).join(' · ') || x.nama) + (x.bandwidth_mbps != null ? ' · ' + fmtBw(x.bandwidth_mbps) : '');
      if (semuaWan.length === 1) h += `<div class="kv"><span>WAN</span><b>${wanTxt(semuaWan[0].dev)}</b></div>`;
      else if (semuaWan.length > 1) {
        const gw = semuaWan.find(w => w.via);
        h += `<div class="kv col"><span>Multi-WAN (${semuaWan.length}) · ${m.wanMode(gw.via) === 'loadbalance' ? 'load balance' : 'failover'} di ${esc(gw.via.nama)}</span>
          <div class="path wrap">${semuaWan.map((w, i) => `<span class="wan-chip">WAN${i + 1} ${chip(w.dev)} <span class="muted small">${wanTxt(w.dev)}</span> ${konBadge(m.koneksi(w.dev))}</span>`).join('')}</div></div>`;
      }
    }
    if (["ap", "bridge"].includes(d.jenis) && (d.atribut || {}).ssid) h += wifiCopyHtml(d, true);
    const up2 = m.uplinkLain(d);
    if (up2.length) {
      const p1 = m.parentOf(d);
      h += `<div class="kv col"><span>Uplink (${up2.length + (p1 ? 1 : 0)}) · ${m.uplinkMode(d) === 'lacp' ? 'LACP — bandwidth digabung' : 'redundan — STP/RSTP'}</span>
        <div class="path wrap">${p1 ? `<span class="wan-chip up">UP1 ${chip(p1)} ${konBadge(m.koneksi(p1))}</span>` : ''}${up2.map((w, i) => `<span class="wan-chip up">UP${i + 2} ${chip(w.dev)} ${konBadge(m.koneksi(w.dev))}
          ${kabelLainBtn(d, { dev: w.dev, kabel: w.kabel, kunci: 'uplink_lain' }, bolehKabel(d))}</span>`).join('')}</div></div>`;
    }
    if (d.jenis !== 'isp' || (d.atribut && d.atribut.listrik)) {
      const Lp = m.listrikOf(d);
      const w = m.dayaW(d);
      h += `<div class="kv"><span>Listrik</span><b>${listrikBadge((d.atribut || {}).listrik || '')}${Lp ? ` ⚡ ${chip(Lp)}` : ''}${w ? ` <span class="muted">${fmtW(w)}</span>` : ''}</b></div>`;
    }
    if (bw.mbps != null) {
      h += `<div class="kv"><span>Bandwidth maks.</span><b>${fmtBw(bw.mbps)}${bw.gabung ? ` <span class="muted">(gabungan ${bw.gabung} ${bw.at && bw.at.jenis === 'switch' ? 'uplink' : 'WAN'})</span>` : bw.at && bw.at.id !== d.id ? ` <span class="muted">(dibatasi ${esc(bw.at.nama)})</span>` : ''}</b></div>`;
    }
    if (m.parentOf(d) && NP.kabelTertanam(d)) {
      h += `<div class="kv"><span>Kabel ke uplink</span><b>Tertanam di gedung <span class="muted">(jaringan existing ke ${esc(m.parentOf(d).nama)}, tidak ditarik)</span></b></div>`;
    } else if (!m.parentOf(d) && d.jenis === 'lan_gedung') {
      h += `<div class="kv"><span>Sumber</span><b>Jaringan gedung / venue${(d.atribut || {}).ruang_server ? ` <span class="muted">(${esc(d.atribut.ruang_server)})</span>` : ''}</b></div>`;
    } else if (m.parentOf(d)) {
      const berbelok = m.routePts(d).length > 2;
      h += `<div class="kv"><span>${d.media === 'wireless' ? 'Jarak link' : 'Kabel ke uplink'}</span><b>${jarak == null
        ? '<span class="muted">kalibrasi skala dulu</span>'
        : d.media === 'wireless' ? fmtM(jarak) : `≈ ${fmtM(kabel)} <span class="muted">(${berbelok ? 'jalur' : 'lurus'} ${fmtM(m.jalurM(d))} + ${S.proyek.slack_kabel}%)</span>`}${m.multiLantai() && m.bedaLantai(d, m.parentOf(d)) ? `<br><span class="muted small">termasuk riser ${fmtM(m.naikM(d, m.parentOf(d)))} ke ${esc(namaLantai(m.parentOf(d)))}</span>` : ''}</b></div>`;
      // Tim update status punya pemilih kabel sendiri di kotak tim (di bawah), jadi di sini tidak diulang.
      if (NP.perluKabel(d) && !(S.tim && bolehKabel(d))) {
        h += kabelPicker([d.id], NP.kabelSt(d), bolehKabel(d), `<span>🔌 Kabel ke <b>${esc(m.parentOf(d).nama)}</b></span>${kabel ? `<span class="muted">≈ ${esc(fmtM(kabel))}</span>` : ''}`);
      }
    }
    if (kids.length) {
      h += terhubungHtml(d, kids, sumKids, chip);
    }
    if (issues.length) {
      h += `<ul class="issues">${issues.map(c => `<li class="lv-${c.level}">${esc(c.msg)}</li>`).join('')}</ul>`;
    }
    h += '</div>';
    box.innerHTML = h;
    renderRoute(d);
    renderTimBox(d);
    renderVerif(d);
    renderFoto(d);
    renderRiwayat(d);
    // Tab Group: group perangkat ini (di uplinknya) + group tiap jenis perangkat yang terhubung ke sini.
    const p = m.parentOf(d);
    const gSendiri = p ? grupEditor(p.id, d.jenis) : '';
    const jenisAnak = [...new Set(kids.map(c => c.jenis))];
    const gAnak = jenisAnak.map(j => grupEditor(d.id, j)).join('');
    $('#pn-grup').innerHTML = gSendiri || `<p class="muted small">${p ? 'Belum ada nama group.' : 'Sambungkan perangkat ini ke uplink dulu (tab Koneksi) — perangkat sejenis di uplink yang sama bisa diberi nama group, mis. BOOTH-A-01, BOOTH-A-02.'}</p>`;
    $('#pn-grup-anak-box').innerHTML = `<div class="grp-list">${gAnak}</div>`;
    $('#pn-grup-anak-sec').hidden = !gAnak;
    const nGrup = (p && grupNama(p.id, d.jenis) ? 1 : 0) + jenisAnak.filter(j => grupNama(d.id, j)).length;
    const pn = $('.pn-tabs .pt-grup');
    pn.textContent = nGrup;
    pn.hidden = !nGrup;
    // Tanda di tab Info bila ada masalah/peringatan desain pada perangkat ini.
    const dot = $('.pn-tabs .pt-dot');
    const lv = issues.some(c => c.level === 'err') ? 'err' : issues.some(c => c.level === 'warn') ? 'warn' : '';
    dot.hidden = !lv;
    dot.className = 'pt-dot ' + lv;
    dot.title = lv ? issues.length + ' catatan desain' : '';
  }

  // ------------------------------------------------------------------------ akses tim: update status & riwayat

  const PERAN_LABEL = { status: 'Update status', installer: 'Installer', cek: 'Checker penempatan', lihat: 'Lihat saja' };
  /** Peran yang boleh mengubah status pemasangan (installer = update status + mengusulkan alat baru). */
  function pemasang(a) {
    return !!a && (a.peran === 'status' || a.peran === 'installer');
  }
  /** Link tim berperan installer (pemasang perangkat). */
  function isInstaller() {
    return !!(S.tim && S.akses && S.akses.peran === 'installer');
  }
  /** Kategori yang boleh diusulkan installer ini (kosong = semua; port LAN gedung bukan alat yang dipasang). */
  const bolehUsul = j => isInstaller() && j !== 'lan_gedung' && (!S.akses.jenis_boleh.length || S.akses.jenis_boleh.includes(j));

  // Usulan alat baru dari installer: pilih kategori di toolbar -> klik lokasi di denah -> isi nama & keterangan -> kirim.
  let usulPos = null;
  function bukaUsulan(jenis, x, y) {
    usulPos = { jenis, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    const f = $('#form-usul');
    f.reset();
    const par = S.parentCtx != null && S.model.byId.get(S.parentCtx);
    usulPos.uplink_id = par && jenis !== 'isp' && !NP.nonJaringan(par) && NP.grupJenis(jenis) !== 'support' ? par.id : null;
    $('#usul-jenis').textContent = TYPES[jenis].label;
    $('#usul-uplink').innerHTML = usulPos.uplink_id != null ? `Uplink: <b>${esc(par.nama)}</b> <span class="muted">(pilih perangkat lain di denah sebelum menaruh untuk mengganti)</span>` : 'Tanpa uplink — admin yang menyambungkan.';
    f.elements.nama.value = nextName(jenis);
    $('#dlg-usul').showModal();
    f.elements.nama.select();
  }
  $('#form-usul [data-close]').addEventListener('click', () => $('#dlg-usul').close());
  $('#form-usul').addEventListener('submit', async e => {
    e.preventDefault();
    if (!usulPos) return;
    const f = e.target;
    const body = Object.assign({ t: S.tim, action: 'tambah', nama: f.elements.nama.value.trim(), model: f.elements.model.value.trim(), catatan: f.elements.catatan.value.trim() }, usulPos);
    if (multiLantai() && atrLantai(S.lantai)) body.lantai = S.lantai;
    try {
      const res = await api('api/tim.php', body);
      $('#dlg-usul').close();
      usulPos = null;
      S.list.push(res.perangkat);
      S.sel = res.perangkat.id;
      setTool('pilih');
      refreshModel();
      peta.flash(res.perangkat.id);
      toast(`${res.perangkat.nama} diusulkan — menunggu keputusan admin`);
    } catch (err) {
      toast(err.message, true);
    }
  });
  async function tarikUsulan(d) {
    if (!confirm(`Tarik usulan "${d.nama}"? Titiknya dihapus dari denah.`)) return;
    try {
      await api('api/tim.php', { t: S.tim, action: 'usulan_hapus', id: d.id });
      S.list = S.list.filter(x => x.id !== d.id);
      S.sel = null;
      refreshModel();
      toast('Usulan ditarik');
    } catch (err) {
      toast(err.message, true);
    }
  }

  /** Kotak status usulan di panel perangkat: admin memutuskan, installer pengusul bisa menarik usulannya. */
  function usulanBoxHtml(d) {
    if (d.status !== 'usulan') return '';
    const a = d.atribut || {};
    const milik = isInstaller() && String(a.usulan_akses || '') === String(S.akses.id);
    return `<div class="pn-sec usul-box">
      <h4><span class="st st-usulan">Usulan baru</span> menunggu keputusan admin</h4>
      <p class="small">Diusulkan oleh <b>${esc(a.usulan_oleh || 'tim')}</b>${a.usulan_waktu ? ' · ' + esc(fmtWaktu(a.usulan_waktu)) : ''}. Alat ini belum masuk plan — status pemasangannya bisa diubah setelah admin menyetujui.</p>
      ${S.canEdit ? `<div class="btn-row"><button type="button" class="small primary" data-usulan="setuju" data-id="${d.id}">✓ Bisa dipasang</button>
        <button type="button" class="small danger" data-usulan="tolak" data-id="${d.id}">✕ Tolak</button></div>`
        : milik ? `<button type="button" class="small" data-usul-tarik>Tarik usulan</button>` : ''}
    </div>`;
  }

  /** Apakah perangkat termasuk tugas tim (kategori diizinkan; kosong = semua). */
  function tugasTim(d) {
    const a = S.akses;
    return pemasang(a) && (!a.jenis_boleh.length || a.jenis_boleh.includes(d.jenis));
  }

  // ------------------------------------------------------------------------ pengecekan penempatan (checker)

  /** Link tim berperan checker penempatan. */
  const isChecker = () => !!(S.tim && S.akses && S.akses.peran === 'cek');
  /** Perangkat termasuk tugas checker (kategori diizinkan; kosong = semua). */
  const tugasCek = d => isChecker() && (!S.akses.jenis_boleh.length || S.akses.jenis_boleh.includes(d.jenis));
  /** Titik yang dicek di lapangan: semua kecuali Sumber WAN (layanan ISP, bukan alat yang dipasang). */
  const perluCek = d => d.jenis !== 'isp';
  /** Daftar perangkat yang harus dicek (checker: kategori tugasnya), urut jenis & nama. */
  function daftarCek() {
    return NP.Model.sortDev((S.list || []).filter(d => perluCek(d) && (!isChecker() || tugasCek(d))));
  }
  function progresCekTxt() {
    const ds = daftarCek();
    return ` · ${ds.filter(d => NP.verifOf(d)).length}/${ds.length} dicek`;
  }

  /** Kotak pengecekan: acuan plan (khusus checker), hasil, catatan, tombol Sesuai / Tidak sesuai. */
  function renderVerif(d) {
    const box = $('#pn-verif');
    if (!box) return;
    if (box.querySelector('textarea[data-dirty]')) return; // catatan sedang diketik
    const v = NP.verifOf(d);
    const admin = !S.tim && !S.lihat && S.canEdit;
    const bisa = tugasCek(d) || admin;
    if (isChecker() && perluCek(d) && !tugasCek(d)) {
      box.innerHTML = `<div class="pn-sec"><p class="note">${esc(d.nama)} di luar tugas <b>${esc(S.akses.nama)}</b> — hanya bisa dilihat.</p></div>`;
      return;
    }
    if (!perluCek(d) || (!v && !bisa)) {
      box.innerHTML = '';
      return;
    }
    const m = S.model;
    const p = m.parentOf(d);
    const a = d.atribut || {};
    const V = v && NP.VERIF[v.h];
    const plan = [
      ['Alat', jenisLabel(d) + (d.model ? ' · ' + d.model : '')],
      ['Uplink', p ? `${p.nama}${d.port_uplink ? ' port ' + d.port_uplink : ''}${d.media ? ' · ' + MEDIA[d.media].label : ''}` : ''],
      ['Posisi pasang', [a.mounting, a.lokasi_rak, a.tinggi].filter(Boolean).join(' · ')],
      ['Arah', a.arah || ''],
      ['IP / VLAN', [d.ip, d.vlan ? 'VLAN ' + d.vlan : ''].filter(Boolean).join(' · ')],
      ['Catatan plan', d.catatan || ''],
    ].filter(x => x[1]);
    const nFoto = fotoOf(d.id).length;
    box.innerHTML = `<div class="pn-sec verif-box${V ? ' vf-' + v.h : ''}">
      <h4>🔍 Pengecekan penempatan${isChecker() ? ' · ' + esc(S.akses.nama) : ''}</h4>
      ${isChecker() ? `${denahUrl(S.model.lantaiOf(d)) ? `<div class="cek-map" title="Posisi ${esc(d.nama)} di denah plan">${staticMap({ vb: cropAround(d), focus: d.id, cls: 'crop-map' })}</div>` : ''}
        <dl class="cek-plan">${plan.map(([k, x]) => `<dt>${k}</dt><dd>${esc(x)}</dd>`).join('')}</dl>` : ''}
      ${V ? `<div class="vf-hasil"><b style="color:${V.color}">${V.icon} ${esc(V.label)}</b> <span class="muted small">${esc(v.o || '')} · ${esc(v.t || '')}</span>${v.c ? `<p>${esc(v.c)}</p>` : ''}</div>`
        : '<p class="muted small" style="margin:0 0 6px">Belum dicek.</p>'}
      ${bisa ? `<label class="field"><span>Catatan pengecekan <small class="muted">(wajib bila tidak sesuai)</small></span>
          <textarea id="vf-catatan" rows="2" maxlength="2000" placeholder="mis. AP bergeser ±2 m dari plan ke dekat pintu, tinggi 3 m, kabel lewat plafon"></textarea></label>
        <div class="vf-btn"><button type="button" class="vf-ok" data-verif="sesuai">✓ Sesuai plan</button><button type="button" class="vf-no" data-verif="tidak">✕ Tidak sesuai</button></div>
        <div class="btn-row">${isChecker() ? '<button type="button" class="small" data-cek-catatan>Kirim catatan saja</button>' : ''}
          ${v ? '<button type="button" class="small ghost" data-verif="">Hapus hasil</button>' : ''}
          ${isChecker() ? '<button type="button" class="small" data-cek-next>Berikutnya belum dicek →</button>' : ''}</div>
        ${isChecker() && !nFoto ? '<p class="muted small" style="margin:6px 0 0">Lanjutkan dengan foto bukti di bawah.</p>' : ''}` : ''}
    </div>`;
  }

  async function kirimVerif(d, hasil) {
    const ta = $('#vf-catatan');
    const catatan = ta ? ta.value.trim() : '';
    if (hasil === 'tidak' && !catatan) {
      if (ta) ta.focus();
      return toast('Tulis catatan: apa yang tidak sesuai dengan plan', true);
    }
    if (hasil === '' && !confirm(`Hapus hasil pengecekan ${d.nama}?`)) return;
    const waktu = waktuLokal(new Date()).slice(0, 16);
    try {
      const res = S.tim
        ? await api('api/tim.php', { t: S.tim, action: 'verif', id: d.id, hasil, catatan, waktu })
        : await api(API, { action: 'perangkat_verif', id: d.id, hasil, catatan, waktu });
      if (ta) delete ta.dataset.dirty;
      const i = S.list.findIndex(x => x.id === d.id);
      if (i >= 0) S.list[i] = res.perangkat;
      riwayat.id = null;
      refreshModel({ keepPanel: true });
      renderCrumb();
      const sisa = fotoOf(d.id).length ? '' : ' — ambil foto bukti';
      toast(hasil ? `${d.nama}: ${NP.VERIF[hasil].label}${sisa}` : 'Hasil pengecekan dihapus', hasil === 'tidak');
    } catch (e) {
      toast(e.message, true);
    }
  }

  /** Checker: lompat ke perangkat berikutnya yang belum dicek (urutan daftar tugas). */
  function cekBerikutnya(d) {
    const ds = daftarCek();
    const i = ds.findIndex(x => x.id === d.id);
    const next = ds.slice(i + 1).concat(ds.slice(0, i + 1)).find(x => !NP.verifOf(x));
    if (!next) return toast('Semua titik tugas sudah dicek ✓');
    selectDev(next.id, true);
  }

  $('#panel').addEventListener('click', e => {
    if (S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    if (!d) return;
    const b = e.target.closest('[data-verif]');
    if (b) return void kirimVerif(d, b.dataset.verif);
    if (e.target.closest('[data-cek-next]')) return cekBerikutnya(d);
    if (e.target.closest('[data-cek-catatan]')) {
      const ta = $('#vf-catatan');
      const catatan = ta ? ta.value.trim() : '';
      if (!catatan) return toast('Catatan masih kosong', true);
      api('api/tim.php', { t: S.tim, action: 'catatan', id: d.id, catatan }).then(() => {
        ta.value = '';
        delete ta.dataset.dirty;
        riwayat.id = null;
        renderRiwayat(d);
        toast('Catatan terkirim');
      }).catch(err => toast(err.message, true));
    }
  });
  $('#panel').addEventListener('input', e => {
    if (e.target.id === 'vf-catatan') e.target.dataset.dirty = '1';
  });

  // ------------------------------------------------------------------------ foto bukti pemasangan

  const FOTO_MAKS = 3;
  const fotoOf = id => S.foto.filter(f => f.perangkat_id === id);
  const fotoUrl = f => `api/foto.php?id=${f.id}${S.tim ? '&t=' + encodeURIComponent(S.tim) : S.lihat ? '&k=' + encodeURIComponent(S.lihat) : ''}`;
  const petaUrl = f => `https://www.google.com/maps?q=${f.lat},${f.lng}`;
  const koordinat = f => (f.lat != null ? `${(+f.lat).toFixed(6)}, ${(+f.lng).toFixed(6)}` : '');
  /** Boleh mengambil foto perangkat ini: admin, atau tim update-status dengan kategori tugasnya. */
  const bisaFoto = d => (S.tim ? tugasTim(d) || tugasCek(d) : !S.lihat && S.canEdit);
  /** Boleh menghapus foto: admin semua; tim hanya foto yang diambilnya. */
  const bisaHapusFoto = (d, f) => (S.tim ? (tugasTim(d) || tugasCek(d)) && f.akses_id != null && S.akses && f.oleh === S.akses.nama : !S.lihat && S.canEdit);

  /** Waktu lokal "YYYY-MM-DD HH:mm:ss". */
  function waktuLokal(t) {
    const p = n => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
  }

  /** Posisi GPS ponsel: {lat, lng, acc} atau {gagal: alasan}. Butuh HTTPS (atau localhost) & izin lokasi. */
  function lokasiSekarang() {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve({ gagal: 'perangkat tidak mendukung GPS' });
      if (!window.isSecureContext) return resolve({ gagal: 'lokasi hanya bisa dibaca lewat HTTPS' });
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
        e => resolve({ gagal: e.code === 1 ? 'izin lokasi ditolak' : e.code === 3 ? 'GPS terlalu lama merespons' : 'lokasi tidak tersedia' }),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
    });
  }

  /** Buka kamera belakang ponsel (desktop: pilih file gambar). Resolve File, atau null bila batal. */
  function bukaKamera() {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.setAttribute('capture', 'environment');
      inp.addEventListener('change', () => resolve(inp.files && inp.files[0] || null), { once: true });
      inp.addEventListener('cancel', () => resolve(null), { once: true });
      inp.click();
    });
  }

  async function bacaGambar(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* pakai <img> */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  /**
   * Perkecil foto (sisi terpanjang 1600 px) dan beri cap di bawah: judul event, nama perangkat, koordinat, waktu.
   * Hasil JPEG tanpa metadata EXIF asli.
   */
  async function capFoto(file, d, pos, waktu) {
    const img = await bacaGambar(file);
    const sw = img.width, sh = img.height;
    const k = Math.min(1, 1600 / Math.max(sw, sh));
    const W = Math.round(sw * k), H = Math.round(sh * k);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0, W, H);
    if (img.close) img.close();
    const fs = Math.max(14, Math.round(Math.min(W, H) * 0.034));
    const pad = Math.round(fs * 0.7);
    const baris = [
      { t: S.proyek.nama, b: true },
      { t: `${d.nama} · ${jenisLabel(d)}`, b: true },
      { t: pos && pos.lat != null ? `📍 ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}${pos.acc != null ? ` (±${Math.round(pos.acc)} m)` : ''}` : `📍 Lokasi tidak tersedia${pos && pos.gagal ? ' — ' + pos.gagal : ''}` },
      { t: `🕒 ${waktu}${S.tim && S.akses ? ' · ' + S.akses.nama : ''}` },
    ];
    const lh = Math.round(fs * 1.35);
    const tinggi = pad * 2 + lh * baris.length;
    g.fillStyle = 'rgba(0,0,0,.6)';
    g.fillRect(0, H - tinggi, W, tinggi);
    g.fillStyle = '#fff';
    g.textBaseline = 'top';
    baris.forEach((r, i) => {
      g.font = `${r.b ? '700 ' : ''}${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      let t = r.t;
      while (t.length > 4 && g.measureText(t).width > W - pad * 2) t = t.slice(0, -2) + '…';
      g.fillText(t, pad, H - tinggi + pad + i * lh);
    });
    return new Promise(resolve => cv.toBlob(resolve, 'image/jpeg', 0.85));
  }

  /** Ambil foto bukti untuk perangkat d: kamera + GPS bersamaan, cap, unggah. */
  async function ambilFoto(d) {
    if (fotoOf(d.id).length >= FOTO_MAKS) return toast(`${d.nama} sudah punya ${FOTO_MAKS} foto. Hapus salah satu untuk mengganti.`, true);
    const posJanji = lokasiSekarang(); // izin & GPS berjalan selama kamera terbuka
    const file = await bukaKamera();
    if (!file) return;
    const btn = $('#pn-foto [data-foto-ambil]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Membaca lokasi & mengunggah…';
    }
    try {
      const pos = await posJanji;
      const waktu = waktuLokal(new Date());
      const blob = await capFoto(file, d, pos, waktu);
      if (!blob) throw new Error('Foto tidak bisa diproses');
      const fd = new FormData();
      if (S.tim) {
        fd.append('t', S.tim);
        fd.append('action', 'foto');
      } else fd.append('action', 'foto_upload');
      fd.append('id', d.id);
      fd.append('foto', blob, 'foto.jpg');
      fd.append('waktu', waktu);
      if (pos && pos.lat != null) {
        fd.append('lat', pos.lat);
        fd.append('lng', pos.lng);
        if (pos.acc != null) fd.append('akurasi', pos.acc);
      }
      const res = await api(S.tim ? 'api/tim.php' : API, fd);
      S.foto = res.foto;
      const n = fotoOf(d.id).length;
      toast(`Foto ${n}/${FOTO_MAKS} ${d.nama} tersimpan${pos && pos.lat != null ? '' : ' — tanpa koordinat (' + ((pos && pos.gagal) || 'lokasi tidak tersedia') + ')'}`, !(pos && pos.lat != null));
    } catch (e) {
      toast(e.message, true);
    }
    const now = S.model.byId.get(d.id);
    if (now && S.sel === d.id) renderFoto(now);
  }

  async function hapusFoto(d, id) {
    if (!confirm('Hapus foto ini? Foto yang dihapus tidak bisa dikembalikan.')) return;
    try {
      const res = S.tim
        ? await api('api/tim.php', { t: S.tim, action: 'foto_hapus', id })
        : await api(API, { action: 'foto_hapus', id, proyek_id: S.proyek.id });
      S.foto = res.foto;
      toast('Foto dihapus');
    } catch (e) {
      toast(e.message, true);
    }
    if (S.sel === d.id) renderFoto(d);
  }

  /**
   * Penampil foto (modal) dengan zoom. Foto perangkat d mulai dari foto id.
   * - Laptop: scroll roda = zoom di titik kursor, seret = geser, klik 2× = perbesar / kembali, tombol − / 100% / +,
   *   keyboard + − 0, ← → pindah foto, Esc tutup.
   * - Ponsel: cubit 2 jari = zoom, 1 jari = geser saat diperbesar, ketuk 2× = perbesar / kembali,
   *   usap kiri / kanan (saat tidak diperbesar) = pindah foto.
   * Zoom 1×–6×, posisi dibatasi agar foto tidak lepas dari layar; zoom kembali ke 1× saat pindah foto.
   */
  const ZOOM_MAKS = 6, ZOOM_KETUK = 2.5;
  const viewer = { d: null, list: [], i: 0, s: 1, x: 0, y: 0, ptr: new Map(), gest: null, ketuk: null, geser: false, turun: null };

  function lihatFoto(d, id) {
    viewer.d = d;
    viewer.list = fotoOf(d.id);
    viewer.i = Math.max(0, viewer.list.findIndex(f => f.id === id));
    let dlg = $('#dlg-foto');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'dlg-foto';
      dlg.className = 'dlg-foto';
      dlg.innerHTML = `<div class="fv-top"><b class="fv-judul"></b><span class="fv-n"></span>
          <div class="fv-zoom" role="group" aria-label="Zoom foto">
            <button type="button" data-fv="zoom-" title="Perkecil (−)" aria-label="Perkecil">−</button>
            <button type="button" class="fv-pct" data-fv="pas" title="Kembali ke ukuran layar (0)">100%</button>
            <button type="button" data-fv="zoom+" title="Perbesar (+)" aria-label="Perbesar">+</button>
          </div>
          <a class="fv-unduh" title="Unduh foto" aria-label="Unduh foto">⬇</a>
          <button type="button" class="fv-x" data-fv="tutup" title="Tutup (Esc)" aria-label="Tutup">✕</button></div>
        <div class="fv-stage" tabindex="-1" autofocus><button type="button" class="fv-nav prev" data-fv="-1" aria-label="Foto sebelumnya">‹</button>
          <img class="fv-img" alt="" draggable="false"><button type="button" class="fv-nav next" data-fv="1" aria-label="Foto berikutnya">›</button></div>
        <div class="fv-cap"></div>
        <div class="fv-bawah"><div class="fv-dots"></div><span class="fv-hint"></span></div>`;
      document.body.appendChild(dlg);
      const st = dlg.querySelector('.fv-stage');
      dlg.addEventListener('click', e => {
        const b = e.target.closest('[data-fv]');
        if (b) {
          const a = b.dataset.fv;
          if (a === 'tutup') return dlg.close();
          if (a === 'zoom+') return zoomKe(viewer.s * 1.6);
          if (a === 'zoom-') return zoomKe(viewer.s / 1.6);
          if (a === 'pas') return zoomKe(1);
          return geserFoto(+a);
        }
        const dot = e.target.closest('[data-fv-i]');
        if (dot) return tampilFoto(+dot.dataset.fvI);
        // Klik latar menutup, kecuali baru saja menggeser / zoom.
        // (pointer capture membuat target klik = area foto, jadi pakai elemen tempat tekan dimulai).
        const t0 = viewer.turun || e.target;
        viewer.turun = null;
        if (!viewer.geser && viewer.s === 1 && (t0 === dlg || t0 === st)) dlg.close();
      });
      dlg.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft') geserFoto(-1);
        else if (e.key === 'ArrowRight') geserFoto(1);
        else if (e.key === '+' || e.key === '=') zoomKe(viewer.s * 1.6);
        else if (e.key === '-') zoomKe(viewer.s / 1.6);
        else if (e.key === '0') zoomKe(1);
      });
      // Roda mouse / touchpad: zoom di titik kursor.
      st.addEventListener('wheel', e => {
        e.preventDefault();
        zoomKe(viewer.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), e.clientX, e.clientY);
      }, { passive: false });
      st.addEventListener('pointerdown', e => {
        if (e.target.closest('.fv-nav')) return;
        if (!viewer.ptr.size) viewer.turun = e.target;
        try { st.setPointerCapture(e.pointerId); } catch (er) { /* pointer sintetis / tidak didukung */ }
        viewer.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
        viewer.geser = false;
        mulaiGestur();
      });
      st.addEventListener('pointermove', e => {
        if (!viewer.ptr.has(e.pointerId)) return;
        viewer.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const g = viewer.gest;
        if (!g) return;
        const ps = [...viewer.ptr.values()];
        if (ps.length >= 2 && g.d0) {
          // Cubit: skala mengikuti jarak 2 jari, titik tengah tetap di bawah jari.
          const mid = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
          const s = klem(g.s0 * Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / g.d0, 1, ZOOM_MAKS);
          const c = pusatStage();
          const p0 = { x: g.mid.x - c.x, y: g.mid.y - c.y };
          viewer.s = s;
          viewer.x = mid.x - c.x - (p0.x - g.x0) * s / g.s0;
          viewer.y = mid.y - c.y - (p0.y - g.y0) * s / g.s0;
          viewer.geser = true;
          terapkanZoom(false);
        } else if (ps.length === 1) {
          const dx = ps[0].x - g.p.x, dy = ps[0].y - g.p.y;
          if (Math.abs(dx) + Math.abs(dy) > 6) viewer.geser = true;
          if (viewer.s > 1) {
            viewer.x = g.x0 + dx;
            viewer.y = g.y0 + dy;
            terapkanZoom(false);
          } else if (viewer.list.length > 1) {
            // Tidak diperbesar: foto ikut usapan sedikit sebagai umpan balik pindah foto.
            dlg.querySelector('.fv-img').style.transform = `translate(${dx * 0.35}px, 0)`;
          }
        }
      });
      const lepas = e => {
        if (!viewer.ptr.has(e.pointerId)) return;
        const g = viewer.gest;
        const akhir = viewer.ptr.get(e.pointerId);
        viewer.ptr.delete(e.pointerId);
        if (viewer.ptr.size) return mulaiGestur(); // sisa 1 jari: lanjut geser dari posisi sekarang
        viewer.gest = null;
        if (!g || g.d0) return terapkanZoom(true);
        const dx = akhir.x - g.p.x, dy = akhir.y - g.p.y;
        // Usap (tidak diperbesar): pindah foto.
        if (viewer.s === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && viewer.list.length > 1) {
          viewer.ketuk = null;
          return geserFoto(dx < 0 ? 1 : -1);
        }
        terapkanZoom(true);
        // Ketuk 2× (sentuh / pena): perbesar di titik itu, atau kembali ke ukuran layar.
        if (!viewer.geser && e.type === 'pointerup' && e.pointerType !== 'mouse') {
          const now = Date.now();
          const k = viewer.ketuk;
          if (k && now - k.t < 320 && Math.hypot(akhir.x - k.x, akhir.y - k.y) < 30) {
            viewer.ketuk = null;
            if (e.target.closest('.fv-img') || viewer.s > 1) zoomKe(viewer.s > 1 ? 1 : ZOOM_KETUK, akhir.x, akhir.y);
          } else viewer.ketuk = { t: now, x: akhir.x, y: akhir.y };
        }
        if (viewer.geser) setTimeout(() => { viewer.geser = false; }, 0);
      };
      // Mouse: klik 2× memakai dblclick bawaan browser (jeda klik sesuai setelan sistem).
      st.addEventListener('dblclick', e => {
        if (e.target.closest('.fv-nav')) return;
        if (e.target.closest('.fv-img') || viewer.s > 1) zoomKe(viewer.s > 1 ? 1 : ZOOM_KETUK, e.clientX, e.clientY);
      });
      st.addEventListener('pointerup', lepas);
      st.addEventListener('pointercancel', lepas);
    }
    // Petunjuk sesuai perangkat saat ini (layar sentuh / mouse).
    dlg.querySelector('.fv-hint').textContent = matchMedia('(pointer: coarse)').matches
      ? 'Cubit untuk zoom · ketuk 2× perbesar · usap untuk pindah foto'
      : 'Scroll untuk zoom · seret untuk geser · klik 2× perbesar';
    tampilFoto(viewer.i);
    if (!dlg.open) dlg.showModal();
  }

  const klem = (v, a, b) => Math.min(b, Math.max(a, v));
  function pusatStage() {
    const r = $('#dlg-foto .fv-stage').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }
  /** Mulai gestur dari keadaan sekarang (1 jari = geser, 2 jari = cubit). */
  function mulaiGestur() {
    const ps = [...viewer.ptr.values()];
    const g = { s0: viewer.s, x0: viewer.x, y0: viewer.y, p: ps[0] };
    if (ps.length >= 2) {
      g.d0 = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1;
      g.mid = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
    }
    viewer.gest = g;
  }
  /** Zoom ke skala s dengan titik layar (cx, cy) tetap di tempatnya (bawaan: tengah). */
  function zoomKe(s, cx, cy) {
    if (!$('#dlg-foto .fv-stage')) return;
    const c = pusatStage();
    const s1 = klem(s, 1, ZOOM_MAKS);
    const px = (cx == null ? c.x : cx) - c.x, py = (cy == null ? c.y : cy) - c.y;
    viewer.x = px - (px - viewer.x) * s1 / viewer.s;
    viewer.y = py - (py - viewer.y) * s1 / viewer.s;
    viewer.s = s1;
    terapkanZoom(true);
  }
  /** Terapkan skala & posisi; geser dibatasi agar tepi foto tidak masuk melewati tepi layar. */
  function terapkanZoom(halus) {
    const dlg = $('#dlg-foto');
    if (!dlg) return;
    const img = dlg.querySelector('.fv-img');
    const c = pusatStage();
    if (viewer.s <= 1.001) {
      viewer.s = 1;
      viewer.x = viewer.y = 0;
    } else {
      const mx = Math.max(0, (img.offsetWidth * viewer.s - c.w) / 2);
      const my = Math.max(0, (img.offsetHeight * viewer.s - c.h) / 2);
      viewer.x = klem(viewer.x, -mx, mx);
      viewer.y = klem(viewer.y, -my, my);
    }
    img.classList.toggle('halus', !!halus);
    img.style.transform = `translate(${viewer.x}px, ${viewer.y}px) scale(${viewer.s})`;
    dlg.classList.toggle('zoom', viewer.s > 1);
    dlg.querySelector('.fv-pct').textContent = Math.round(viewer.s * 100) + '%';
    dlg.querySelector('[data-fv="zoom-"]').disabled = viewer.s <= 1;
    dlg.querySelector('[data-fv="zoom+"]').disabled = viewer.s >= ZOOM_MAKS;
  }
  function geserFoto(arah) {
    const n = viewer.list.length;
    if (n > 1) tampilFoto((viewer.i + arah + n) % n);
  }
  function tampilFoto(i) {
    const dlg = $('#dlg-foto');
    const f = viewer.list[i];
    if (!dlg || !f) return;
    viewer.i = i;
    viewer.s = 1;
    viewer.x = viewer.y = 0;
    const n = viewer.list.length;
    const img = dlg.querySelector('.fv-img');
    img.src = fotoUrl(f);
    img.alt = `Foto ${i + 1} ${viewer.d.nama}`;
    terapkanZoom(false);
    dlg.querySelector('.fv-judul').textContent = viewer.d.nama;
    dlg.querySelector('.fv-n').textContent = `Foto ${i + 1}/${n}`;
    dlg.querySelector('.fv-unduh').href = fotoUrl(f) + '&unduh=1';
    dlg.querySelectorAll('.fv-nav').forEach(b => { b.hidden = n < 2; });
    dlg.querySelector('.fv-cap').innerHTML = `${f.lat != null
      ? `<a href="${petaUrl(f)}" target="_blank" rel="noopener">📍 ${koordinat(f)}${f.akurasi_m != null ? ` (±${Math.round(f.akurasi_m)} m)` : ''}</a>`
      : '<span class="bad">📍 tanpa koordinat</span>'} <span>🕒 ${esc(f.diambil_at || '')}${f.oleh ? ' · ' + esc(f.oleh) : ''}</span>`;
    dlg.querySelector('.fv-dots').innerHTML = n > 1 ? viewer.list.map((x, j) => `<button type="button" class="${j === i ? 'on' : ''}" data-fv-i="${j}" aria-label="Foto ${j + 1}"></button>`).join('') : '';
  }

  /** Galeri kecil foto bukti (dipakai di panel & laporan). */
  function fotoGaleri(d, hapus) {
    const fs = fotoOf(d.id);
    return fs.map((f, i) => `<figure class="foto-it">
        <button type="button" class="foto-buka" data-foto-buka="${f.id}" title="Lihat foto ${i + 1}"><img src="${fotoUrl(f)}" alt="Foto ${i + 1} ${esc(d.nama)}" loading="lazy"></button>
        <figcaption>${f.lat != null ? `<a href="${petaUrl(f)}" target="_blank" rel="noopener" title="Buka di Google Maps${f.akurasi_m != null ? ' · akurasi ±' + Math.round(f.akurasi_m) + ' m' : ''}">📍 ${koordinat(f)}</a>` : '<span class="bad">📍 tanpa koordinat</span>'}
          <span class="muted">${esc((f.diambil_at || '').slice(0, 16))}${f.oleh ? ' · ' + esc(f.oleh) : ''}</span></figcaption>
        ${hapus && bisaHapusFoto(d, f) ? `<button type="button" class="foto-del" data-foto-hapus="${f.id}" title="Hapus foto" aria-label="Hapus foto ${i + 1}">✕</button>` : ''}
      </figure>`).join('');
  }

  function renderFoto(d) {
    const box = $('#pn-foto');
    if (!box) return;
    const n = fotoOf(d.id).length;
    const boleh = bisaFoto(d);
    if (!n && !boleh) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `<div class="pn-sec foto-box">
      <h4>📷 Foto bukti pemasangan <span class="foto-n${n ? ' ok' : ''}">${n}/${FOTO_MAKS}</span></h4>
      ${n ? `<div class="foto-grid">${fotoGaleri(d, true)}</div>` : ''}
      ${boleh && n < FOTO_MAKS ? `<button type="button" class="primary foto-ambil" data-foto-ambil>📷 Ambil foto ${n + 1}/${FOTO_MAKS}</button>
        <p class="muted small">Kamera ponsel terbuka langsung. Judul event, nama perangkat, koordinat GPS, dan waktu dicap di foto. Izinkan akses lokasi.</p>` : ''}
    </div>`;
  }

  $('#panel').addEventListener('click', e => {
    if (S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    if (!d) return;
    if (e.target.closest('[data-foto-ambil]')) return void ambilFoto(d);
    const buka = e.target.closest('[data-foto-buka]');
    if (buka) return lihatFoto(d, +buka.dataset.fotoBuka);
    const h = e.target.closest('[data-foto-hapus]');
    if (h) hapusFoto(d, +h.dataset.fotoHapus);
  });

  /** Kotak update status + catatan lapangan untuk link tim (hanya status yang diizinkan PM). */
  function renderTimBox(d) {
    const box = $('#pn-tim');
    if (!box || !S.tim || !S.akses) return;
    if (box.querySelector('textarea[data-dirty]')) return; // catatan sedang diketik
    if (!pemasang(S.akses) || d.status === 'usulan') {
      box.innerHTML = '';
      return;
    }
    if (!tugasTim(d)) {
      box.innerHTML = `<div class="pn-sec"><p class="note">${esc(d.nama)} di luar tugas <b>${esc(S.akses.nama)}</b> — hanya bisa dilihat.</p></div>`;
      return;
    }
    box.innerHTML = `<div class="pn-sec tim-box">
        <h4>Update status · ${esc(S.akses.nama)}</h4>
        ${statusPicker(d, 'tim')}
        ${NP.perluKabel(d) ? `<h4 style="margin-top:12px">Kabel ke ${esc((S.model.parentOf(d) || {}).nama || 'uplink')}${S.model.kabelM(d) ? ` <span class="muted small">≈ ${esc(fmtM(S.model.kabelM(d)))}</span>` : ''}</h4>
        ${kabelPicker([d.id], NP.kabelSt(d), true, '')}` : ''}
        <label class="field" style="margin-top:8px"><span>Catatan lapangan (opsional, ikut terkirim bersama status)</span>
          <textarea rows="2" id="tim-catatan" maxlength="2000" placeholder="mis. Terpasang di tiang 3 m, kabel kurang 5 m, sinyal -58 dBm"></textarea></label>
        <button type="button" class="small" data-tim-catatan>Kirim catatan saja</button>
      </div>`;
  }

  async function kirimTim(d, status) {
    const ta = $('#tim-catatan');
    const catatan = ta ? ta.value.trim() : '';
    if (!status && !catatan) return toast('Catatan masih kosong', true);
    try {
      const res = await api('api/tim.php', { t: S.tim, action: status ? 'status' : 'catatan', id: d.id, status, catatan });
      if (ta) {
        ta.value = '';
        delete ta.dataset.dirty;
      }
      const i = S.list.findIndex(x => x.id === d.id);
      if (i >= 0) S.list[i] = res.perangkat;
      riwayat.id = null; // muat ulang riwayat
      refreshModel({ keepPanel: true });
      toast(status ? `${d.nama}: ${STATUS[status].label}` : 'Catatan terkirim');
    } catch (err) {
      toast(err.message, true);
    }
  }

  // Riwayat per perangkat: dimuat sekali saat perangkat dipilih (dan setelah ada perubahan), lalu dipakai ulang.
  const riwayat = { id: null, list: [], memuat: false };

  async function renderRiwayat(d) {
    const box = $('#pn-riwayat');
    if (!box) return;
    if (riwayat.id !== d.id) {
      if (riwayat.memuat === d.id) return;
      riwayat.memuat = d.id;
      try {
        const res = S.tim
          ? await api(`api/tim.php?t=${encodeURIComponent(S.tim)}&action=log&id=${d.id}`)
          : await api(`${API}?action=log_list&id=${S.proyek.id}&perangkat_id=${d.id}`);
        riwayat.id = d.id;
        riwayat.list = res.log;
      } catch (e) {
        riwayat.list = [];
      } finally {
        riwayat.memuat = false;
      }
      if (S.sel !== d.id) return; // pengguna sudah memilih perangkat lain
    }
    const el = $('#pn-riwayat');
    if (el) el.innerHTML = `<h4>Riwayat status &amp; catatan</h4>${logHtml(riwayat.list, false) || '<p class="muted small">Belum ada riwayat.</p>'}`;
  }

  /** Daftar riwayat; denganPerangkat = tampilkan nama perangkat (feed aktivitas event). */
  function logHtml(list, denganPerangkat) {
    return list.length ? `<ul class="log-list">${list.map(l => {
      const ubah = l.status_baru && l.status_baru !== l.status_lama;
      const waktu = new Date(l.created_at.replace(' ', 'T')).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<li>
        <div class="log-top"><b>${esc(l.oleh || 'Admin')}</b>${denganPerangkat ? ` · ${l.perangkat_id != null ? `<a href="#" data-sel="${l.perangkat_id}">${esc(l.perangkat_nama)}</a>` : esc(l.perangkat_nama)}` : ''}
          <span class="muted small">${esc(waktu)}</span></div>
        ${ubah && l.status_baru.startsWith('kabel:')
          ? `<div><span class="muted small">Kabel:</span> ${kbSpan(l.status_lama.slice(6))} → ${kbSpan(l.status_baru.slice(6))}</div>`
          : ubah && !l.status_lama ? `<div><span class="st st-${esc(l.status_baru)}">${esc((STATUS[l.status_baru] || {}).label || l.status_baru)}</span></div>`
          : ubah ? `<div><span class="st st-${esc(l.status_lama)}">${esc((STATUS[l.status_lama] || {}).label || l.status_lama || '—')}</span> → <span class="st st-${esc(l.status_baru)}">${esc((STATUS[l.status_baru] || {}).label || l.status_baru)}</span></div>` : ''}
        ${l.catatan ? `<div class="log-cat">${esc(l.catatan)}</div>` : ''}
      </li>`;
    }).join('')}</ul>` : '';
  }

  $('#panel').addEventListener('click', e => {
    if (e.target.closest('[data-usul-tarik]') && S.sel != null) return tarikUsulan(S.model.byId.get(S.sel));
    const b = e.target.closest('[data-tim-status], [data-tim-catatan]');
    if (!b || S.sel == null) return;
    kirimTim(S.model.byId.get(S.sel), b.dataset.timStatus || null);
  });
  $('#panel').addEventListener('input', e => {
    if (e.target.id === 'tim-catatan') e.target.dataset.dirty = '1';
  });

  /** Pilihan bentuk jalur kabel ke uplink. */
  function renderRoute(d) {
    const box = $('#pn-route');
    if (!box) return;
    if (!S.model.parentOf(d) || d.media === 'wireless') {
      box.innerHTML = '';
      return;
    }
    const mode = d.jalur ? d.jalur.m : 'lurus';
    const n = S.model.routePts(d).length - 2;
    const opts = [
      ['lurus', 'Lurus', '<path d="M3 19L19 3"/>'],
      ['h', 'Siku ┐', '<path d="M3 5h14v14"/>'],
      ['v', 'Siku └', '<path d="M5 3v14h14"/>'],
      ['bebas', 'Ikuti gedung', '<path d="M3 19v-7h7V5h9"/>'],
    ];
    box.innerHTML = `<span class="route-lbl">Bentuk jalur kabel</span>
      <div class="seg">${opts.map(([k, lbl, ic]) => `<button type="button" data-route="${k}" class="${mode === k ? 'active' : ''}"${S.canEdit ? '' : ' disabled'}>
        <svg viewBox="0 0 22 22" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">${ic}</svg>${lbl}</button>`).join('')}</div>
      ${S.canEdit ? `<p class="muted small route-tip">${mode === 'bebas'
        ? `${n} lekukan. Tarik <b>bulatan</b> di tengah garis untuk menambah lekukan, geser <b>kotak</b> untuk memindahkan, klik ganda/klik kanan kotak untuk menghapus. Otomatis lurus/siku saat sejajar (tahan <kbd>Alt</kbd> untuk bebas).`
        : 'Tarik bulatan di tengah garis pada denah untuk membelokkan jalur mengikuti dinding/koridor.'}</p>` : ''}`;
  }

  $('#panel').addEventListener('click', e => {
    const go2 = e.target.closest('[data-go]');
    if (go2) {
      e.preventDefault();
      return go(go2.dataset.go);
    }
    const tg = e.target.closest('[data-tool-go]');
    if (tg) {
      e.preventDefault();
      return setTool(tg.dataset.toolGo);
    }
    const hide = e.target.closest('[data-hide]');
    if (hide) {
      const j = hide.dataset.hide;
      if (hiddenTypes.has(j)) hiddenTypes.delete(j);
      else hiddenTypes.add(j);
      syncHidden();
      hide.classList.toggle('off', hiddenTypes.has(j));
      return;
    }
    const chip = e.target.closest('[data-sel]');
    if (chip) return selectDev(+chip.dataset.sel, true);
    const ul = e.target.closest('[data-unlink]');
    if (ul) return putusKoneksi(+ul.dataset.unlink);
    const rt = e.target.closest('[data-route]');
    if (rt && S.canEdit && S.sel != null) {
      const d = S.model.byId.get(S.sel);
      const k = rt.dataset.route;
      let jalur = null;
      if (k === 'h' || k === 'v') {
        jalur = { m: k };
      } else if (k === 'bebas') {
        // Mulai dari bentuk yang sedang tampil; bila masih lurus, mulai dari satu siku agar ada lekukan untuk digeser.
        let pts = S.model.routePts(d).slice(1, -1);
        if (!pts.length) {
          const p = S.model.parentOf(d);
          pts = [{ x: p.x, y: d.y }];
        }
        jalur = { m: 'bebas', p: pts.map(q => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10]) };
      }
      if (peta.tool !== 'pilih') setTool('pilih');
      saveDev(d.id, { jalur }, { keepPanel: true }).catch(() => {});
      return;
    }
    const rv = e.target.closest('[data-reveal]');
    if (rv) {
      const inp = document.getElementById(rv.dataset.reveal);
      inp.type = inp.type === 'password' ? 'text' : 'password';
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const id = S.sel;
    switch (act.dataset.act) {
      case 'close': return selectDev(null);
      case 'center': peta.centerOn(id); peta.flash(id); return;
      case 'dup': return duplicateDev(id);
      case 'kunci': return kunciPerangkat([id], !NP.terkunci(S.model.byId.get(id)));
      case 'del': return deleteDev(id);
      case 'pick': return setTool('hubung');
      case 'unlink': return putusKoneksi(id);
      case 'ep-kelola': return bukaKelolaEp();
      case 'kat-baru': return katalogBaru(S.model.byId.get(id));
      case 'kat-terapkan': {
        const d = S.model.byId.get(id);
        const k = S.model.kat(d);
        if (!k || !confirm(`Timpa isian ${d.nama} dengan konfigurasi standar "${NP.Katalog.label(k)}"?

Isian khusus, bandwidth, dan keterangan konfigurasi diganti nilai standar katalog (yang kosong di katalog tidak diubah).`)) return;
        return saveDev(id, NP.Katalog.patchUntuk(d, k, true)).then(() => toast('Konfigurasi standar diterapkan')).catch(() => {});
      }
    }
  });

  // Nama group: pratinjau saat mengetik, simpan dengan Enter / tombol Terapkan.
  function applyGrup(box) {
    const inp = box.querySelector('.grup-input');
    delete inp.dataset.dirty;
    const parentId = +box.dataset.grupParent, jenis = box.dataset.grupJenis;
    // Nama sama dengan yang tersimpan (mis. blur setelah Enter): tidak perlu disimpan ulang, tetapi anggota yang
    // namanya belum mengikuti group (mis. baru disambungkan) tetap dirapikan.
    if (grupDasar(inp.value) === grupNama(parentId, jenis)) {
      const rencana = grupRencana(parentId, jenis);
      if (rencana.length) terapkanNama(rencana, `${rencana.length} perangkat dirapikan mengikuti group ${grupNama(parentId, jenis)}`);
      return;
    }
    setGrupNama(parentId, jenis, inp.value);
  }
  // Seperti isian lain: nama group juga diterapkan saat pindah isian (blur), bukan hanya dengan Enter / tombol.
  $('#panel').addEventListener('change', e => {
    const inp = e.target.closest('.grup-input');
    if (inp && S.canEdit) applyGrup(inp.closest('.grp'));
  });
  $('#panel').addEventListener('input', e => {
    const inp = e.target.closest('.grup-input');
    if (!inp) return;
    inp.dataset.dirty = '1';
    const box = inp.closest('.grp');
    const n = +box.dataset.n;
    const g = grupDasar(inp.value);
    box.querySelector('.grp-hint').innerHTML = g
      ? `Hasil: <b>${esc(grupLabel(g, 1))}${n > 1 ? ' … ' + esc(grupLabel(g, n)) : ''}</b> — diterapkan saat Enter, klik Ubah/Terapkan, atau pindah ke isian lain`
      : 'Kosongkan lalu Terapkan untuk menghapus nama group (nama perangkat tidak diubah).';
  });
  $('#panel').addEventListener('keydown', e => {
    const inp = e.target.closest('.grup-input');
    if (!inp || e.key !== 'Enter') return;
    e.preventDefault();
    applyGrup(inp.closest('.grp'));
  });
  $('#panel').addEventListener('click', e => {
    const b = e.target.closest('[data-grup-apply]');
    if (b) applyGrup(b.closest('.grp'));
  });

  // Simpan otomatis tiap isian berubah.
  $('#panel').addEventListener('change', e => {
    const ks = e.target.closest('[data-kat]');
    if (ks && S.canEdit && S.sel != null && ks.value === 'baru') {
      const d = S.model.byId.get(S.sel);
      ks.value = d.katalog_id != null ? String(d.katalog_id) : '';
      return katalogBaru(d);
    }
    if (ks && S.canEdit && S.sel != null) return pilihKatalog(S.model.byId.get(S.sel), ks.value ? +ks.value : null);
    const inp = e.target.closest('[data-f]');
    if (!inp || !S.canEdit || S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    const k = inp.dataset.f;
    let v = inp.value;
    let patch;
    if (inp.dataset.attr) {
      const atr = Object.assign({}, d.atribut);
      if (String(v).trim() === '') delete atr[k];
      else atr[k] = String(v).trim();
      patch = { atribut: atr };
    } else if (k === 'uplink_id') {
      patch = { uplink_id: v === '' ? null : +v };
      const md = v !== '' ? mediaWajar(d.jenis, S.model.byId.get(+v), d.media) : d.media;
      if (md !== d.media) {
        patch.media = md;
        toast(`Media ke uplink: ${(NP.MEDIA[md] || {}).label || md} (sesuai jenis uplink)`);
      }
      const P2 = v !== '' && S.model.byId.get(+v);
      if (P2 && (P2.jenis === 'ap' || P2.jenis === 'bridge') && md === 'wireless' && d.port_uplink) patch.port_uplink = '';
      const baru = v !== '' && namaMasukGrup(d, +v);
      if (baru) {
        patch.nama = baru;
        toast(`${d.nama} dinamai ${baru} sesuai group`);
      }
    } else if (k === 'bandwidth_mbps') {
      patch = { bandwidth_mbps: v === '' ? null : +v };
    } else if (k === 'nama') {
      v = v.trim();
      if (!v) {
        inp.value = d.nama;
        return toast('Nama wajib diisi', true);
      }
      patch = { nama: v };
    } else {
      patch = { [k]: v };
      // Ganti kategori: alat katalog kategori lama tidak berlaku lagi.
      if (k === 'jenis' && d.katalog_id != null) patch.katalog_id = null;
    }
    // Ganti jenis atau uplink -> isian/opsi lain ikut berubah, gambar ulang panel.
    const full = k === 'jenis' || k === 'tipe_endpoint' || k === 'vlan_mode' || k === 'vlan' || (k !== 'nama' && !!patch.nama) || (k === 'uplink_id' && 'media' in patch);
    saveDev(d.id, patch, { keepPanel: !full }).catch(() => {});
  });

  // ------------------------------------------------------------------------ daftar perangkat

  function buildFilters() {
    // Kelompok (jaringan / support) lalu jenis per kelompok.
    $('#list-jenis').innerHTML += `<optgroup label="Kelompok"><option value="grup:jaringan">Semua ${esc(NP.GRUP.jaringan.toLowerCase())}</option><option value="grup:support">Semua support &amp; listrik</option></optgroup>` +
      ['jaringan', 'support'].map(g => `<optgroup label="${esc(NP.GRUP[g])}">${TYPE_ORDER.filter(j => NP.grupJenis(j) === g).map(j => `<option value="${j}">${esc(TYPES[j].label)}</option>`).join('')}</optgroup>`).join('');
    $('#list-status').innerHTML += Object.keys(STATUS).map(k => `<option value="${k}">${STATUS[k].label}</option>`).join('');
    $('#list-koneksi').innerHTML += Object.keys(KONEKSI).map(k => `<option value="${k}">${KONEKSI[k].short}</option>`).join('');
    $('#list-kabel').innerHTML += Object.keys(NP.KABEL).map(k => `<option value="${k}">Kabel: ${NP.KABEL[k].short}</option>`).join('') + '<option value="perlu">Kabel: semua link kabel</option>';
  }
  ['#list-q', '#list-jenis', '#list-status', '#list-koneksi', '#list-kabel'].forEach(s => $(s).addEventListener('input', renderDaftar));

  /** Label jenis perangkat; endpoint ditambah tipenya, mis. "Endpoint (klien) · Laptop". */
  function jenisLabel(d) {
    const e = NP.tipeEp(d);
    return (TYPES[d.jenis] || TYPES.lainnya).label + (e ? ' · ' + e.nama : '');
  }

  /** Ringkasan isian khusus jenis, mis. "SSID: EVENT · Ch: 36 · 5 GHz". */
  function attrSummary(d, hideSecret) {
    const t = TYPES[d.jenis] || TYPES.lainnya;
    const a = d.atribut || {};
    // Tipe endpoint disimpan sebagai id -> tampilkan namanya.
    const val = f => (f.type === 'endpoint' ? ((NP.tipeEp(d) || {}).nama || '') : a[f.k]);
    return t.fields.filter(f => a[f.k]).map(f => `${f.label}: ${f.secret && hideSecret ? '••••' : val(f)}`).join(' · ');
  }

  const COLS = [
    { k: 'nama', label: 'Nama', v: d => d.nama },
    { k: 'jenis', label: 'Jenis', v: d => TYPE_ORDER.indexOf(d.jenis), show: d => (TYPES[d.jenis] || TYPES.lainnya).label },
    { k: 'model', label: 'Nama alat', v: d => d.model },
    { k: 'ip', label: 'IP', v: d => d.ip.split('.').map(x => x.padStart(3, '0')).join('.') , show: d => d.ip },
    { k: 'vlan', label: 'VLAN', v: d => d.vlan },
    { k: 'uplink', label: 'Uplink', v: d => { const p = S.model.parentOf(d); return p ? p.nama : ''; } },
    { k: 'grup', label: 'Group', v: d => d.uplink_id != null ? grupNama(d.uplink_id, d.jenis) : '' },
    { k: 'internet', label: 'Internet', v: d => Object.keys(KONEKSI).indexOf(S.model.koneksi(d)) },
    { k: 'media', label: 'Media', v: d => d.media, show: d => d.media ? (MEDIA[d.media].short || d.media) : '' },
    { k: 'bw', label: 'Bandwidth', v: d => d.bandwidth_mbps == null ? -1 : d.bandwidth_mbps, show: d => fmtBw(d.bandwidth_mbps) },
    { k: 'kabel', label: 'Kabel', v: d => S.model.kabelM(d) || 0 },
    { k: 'kabelst', label: 'Status kabel', v: d => (NP.perluKabel(d) ? ['bermasalah', 'belum', 'ditarik', 'terminasi', 'dites'].indexOf(NP.kabelSt(d)) : 9) },
    { k: 'status', label: 'Status', v: d => Object.keys(STATUS).indexOf(d.status) },
    { k: 'pic', label: 'PIC', v: d => d.pic },
    { k: 'listrik', label: 'Listrik', v: d => (NP.isListrik(d) ? 'zz' + d.nama : ['perlu', '', 'ada', 'poe', 'baterai'].indexOf((d.atribut || {}).listrik || '')) },
  ];

  function kabelShow(d) {
    const k = S.model.kabelM(d);
    return k == null ? '' : '≈ ' + fmtM(k);
  }

  function filteredList() {
    const q = $('#list-q').value.trim().toLowerCase();
    const j = $('#list-jenis').value;
    const s = $('#list-status').value;
    const kn = $('#list-koneksi').value;
    const kb = $('#list-kabel').value;
    const cocokKabel = d => !kb || (NP.perluKabel(d) && (kb === 'perlu' || NP.kabelSt(d) === kb));
    return S.list.filter(d => masukLapisan(d) && (!j || (j.startsWith('grup:') ? NP.grupJenis(d.jenis) === j.slice(5) : d.jenis === j)) && (!s || d.status === s) && (!kn || S.model.koneksi(d) === kn) && cocokKabel(d) &&
      (!q || [d.nama, d.model, d.ip, d.vlan, d.pic, d.catatan, d.port_uplink, d.port_lokal, ...Object.values(d.atribut || {})].join(' ').toLowerCase().includes(q)));
  }

  function renderDaftar() {
    const col = COLS.find(c => c.k === S.sort.k) || COLS[1];
    const rows = filteredList().sort((a, b) => {
      const x = col.v(a), y = col.v(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'id', { numeric: true });
      return (c || a.nama.localeCompare(b.nama, 'id', { numeric: true })) * S.sort.dir;
    });
    isiPilihanStatus();
    // Pilihan untuk aksi massal hanya berlaku pada baris yang tampil: baris yang tersembunyi oleh filter/pencarian
    // (atau sudah terhapus) dilepas, agar "Hapus terpilih" tidak pernah mengenai perangkat yang tidak terlihat.
    const tampil = new Set(rows.map(d => d.id));
    S.pilih.forEach(id => { if (!tampil.has(id)) S.pilih.delete(id); });
    S.urutDaftar = rows.map(d => d.id);
    const semua = rows.length > 0 && rows.every(d => S.pilih.has(d.id));
    const head = `<th class="c-cek pilih-only"><input type="checkbox" id="cek-semua" title="Pilih semua yang tampil"${semua ? ' checked' : ''} aria-label="Pilih semua"></th>` +
      COLS.map(c => `<th data-sort="${c.k}" class="${c.k === S.sort.k ? (S.sort.dir > 0 ? 'asc' : 'desc') : ''}">${c.label}</th>`).join('') + '<th>Konfigurasi</th>';
    const body = rows.map(d => {
      const t = TYPES[d.jenis] || TYPES.lainnya;
      const p = S.model.parentOf(d);
      const extra = [attrSummary(d, true), d.catatan].filter(Boolean).join(' — ');
      // data-label dipakai tampilan kartu di HP; sel kosong disembunyikan di sana.
      const td = (label, html, cls) => `<td data-label="${label}" class="${cls || ''}${html ? '' : ' empty'}">${html}</td>`;
      return `<tr data-id="${d.id}"${S.pilih.has(d.id) ? ' class="dipilih"' : ''}>
        <td class="c-cek pilih-only"><input type="checkbox" data-cek="${d.id}"${S.pilih.has(d.id) ? ' checked' : ''} aria-label="Pilih ${esc(d.nama)}"></td>
        ${td('Nama', `<span class="dotlbl"><i style="background:${NP.tampil(d).color}"></i><b>${esc(d.nama)}</b>${lapisanChip(d)}${lantaiChip(d)}${NP.terkunci(d) ? '<span class="lock-i" title="Posisi terkunci">🔒</span>' : ''}</span>`, 'c-nama')}
        ${td('Jenis', esc(jenisLabel(d)), 'c-jenis')}
        ${td('Nama alat', esc(d.model))}
        ${td('IP', esc(d.ip), 'mono')}
        ${td('VLAN', esc(d.vlan))}
        ${td('Uplink', NP.nonJaringan(d) ? '' : p ? esc(p.nama) + (d.port_uplink ? ` <span class="muted">(${esc(d.port_uplink)})</span>` : '') : '<span class="muted">—</span>')}
        ${td('Group', d.uplink_id != null ? esc(grupNama(d.uplink_id, d.jenis)) : '')}
        ${td('Internet', NP.nonJaringan(d) ? '' : konBadge(S.model.koneksi(d)))}
        ${td('Media', esc(d.media ? (MEDIA[d.media].short || d.media) : ''))}
        ${td('Bandwidth', esc(fmtBw(d.bandwidth_mbps)), 'num')}
        ${td('Kabel', esc(kabelShow(d)), 'num')}
        ${td('Status kabel', NP.perluKabel(d) ? (bolehKabel(d) ? kabelBadgeBtn(d) : kabelBadge(d)) : '')}
        ${td('Status', `<span class="st st-${d.status}">${esc((STATUS[d.status] || STATUS.rencana).label)}</span>`, 'c-status')}
        ${td('PIC', esc(d.pic))}
        ${td('Listrik', NP.isListrik(d) ? listrikTitikCell(d) : d.jenis === 'isp' && !(d.atribut || {}).listrik ? '' : listrikBadge((d.atribut || {}).listrik || '') + (S.model.listrikOf(d) ? ' <span class="muted">⚡ ' + esc(S.model.listrikOf(d).nama) + '</span>' : ''))}
        <td data-label="Konfigurasi" class="cfg${extra ? '' : ' empty'}" title="${esc(extra)}">${esc(extra)}</td>
      </tr>`;
    }).join('');
    $('#dev-table').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${COLS.length + 2}" class="muted center">Tidak ada perangkat${S.list.length ? ' yang cocok' : ' — tambahkan dari tab Denah'}.</td></tr>`}</tbody>`;
    sembunyikanKolomKosong(rows.length);
    const adaFilter = ['#list-q', '#list-jenis', '#list-status', '#list-koneksi', '#list-kabel'].some(s => $(s).value);
    $('#list-reset').hidden = !adaFilter;
    const lpTxt = multiLapisan() && S.lapisan !== 'semua' ? ` · layer ${S.model.lapisanById(S.lapisan).nama}` : '';
    $('#list-count').textContent = (adaFilter || lpTxt ? `${rows.length} dari ${S.list.length} perangkat` : `${S.list.length} perangkat`) + lpTxt;
    updateBulk();
  }

  // Kolom yang kosong di semua baris yang tampil disembunyikan agar tabel ringkas (bisa dimatikan di menu Lainnya).
  let kolomSemua = false;
  try { kolomSemua = localStorage.getItem('np-kolom') === 'semua'; } catch (err) { /* abaikan */ }

  function sembunyikanKolomKosong(n) {
    $('#kolom-mode').textContent = kolomSemua ? 'ditampilkan' : 'disembunyikan';
    const tb = $('#dev-table');
    const rows = $$('tbody tr[data-id]', tb);
    const ths = $$('thead th', tb);
    ths.forEach((th, i) => {
      if (th.classList.contains('c-cek') || i <= 2) return; // centang, nama & jenis selalu tampil
      const kosong = !kolomSemua && n > 0 && rows.every(tr => tr.children[i] && tr.children[i].classList.contains('empty'));
      th.classList.toggle('col-off', kosong);
      rows.forEach(tr => tr.children[i] && tr.children[i].classList.toggle('col-off', kosong));
    });
  }

  $('#btn-kolom').addEventListener('click', () => {
    kolomSemua = !kolomSemua;
    try { localStorage.setItem('np-kolom', kolomSemua ? 'semua' : 'auto'); } catch (err) { /* abaikan */ }
    renderDaftar();
  });

  $('#list-reset').addEventListener('click', () => {
    ['#list-q', '#list-jenis', '#list-status', '#list-koneksi', '#list-kabel'].forEach(s => { $(s).value = ''; });
    renderDaftar();
  });

  // ---- pilih banyak & aksi massal
  let cekTerakhir = null; // id baris terakhir yang dicentang (untuk Shift+klik)

  function updateBulk() {
    const n = S.pilih.size;
    $('#bulk-bar').hidden = !n || !(S.canEdit || bolehStatus());
    $('#bulk-n').textContent = `${n} perangkat dipilih`;
    const semua = $('#cek-semua');
    if (semua) {
      const tampil = S.urutDaftar.filter(id => S.pilih.has(id)).length;
      semua.checked = tampil > 0 && tampil === S.urutDaftar.length;
      semua.indeterminate = tampil > 0 && tampil < S.urutDaftar.length;
    }
  }

  function setPilih(id, on) {
    if (on) S.pilih.add(id);
    else S.pilih.delete(id);
    const tr = $(`#dev-table tr[data-id="${id}"]`);
    if (tr) {
      tr.classList.toggle('dipilih', on);
      tr.querySelector('[data-cek]').checked = on;
    }
  }

  $('#dev-table').addEventListener('click', e => {
    if (e.target.closest('[data-kb-pop]')) return; // badge status kabel: buka pemilih, bukan pindah ke denah
    // Kolom centang: jangan pindah ke denah. Klik di sel (bukan kotaknya) ikut mencentang.
    const sel = e.target.closest('.c-cek');
    if (sel) {
      const cb = sel.querySelector('input');
      if (e.target !== cb) cb.click();
      return;
    }
    const th = e.target.closest('th[data-sort]');
    if (th) {
      S.sort = { k: th.dataset.sort, dir: S.sort.k === th.dataset.sort ? -S.sort.dir : 1 };
      return renderDaftar();
    }
    const tr = e.target.closest('tr[data-id]');
    if (tr) {
      S.sel = +tr.dataset.id;
      go('denah');
      setTimeout(() => selectDev(+tr.dataset.id, true), 60);
    }
  });

  $('#dev-table').addEventListener('change', e => {
    if (e.target.id === 'cek-semua') {
      // Pilih / lepas semua baris yang sedang tampil (mengikuti filter & pencarian).
      S.urutDaftar.forEach(id => setPilih(id, e.target.checked));
      cekTerakhir = null;
      return updateBulk();
    }
    const cb = e.target.closest('[data-cek]');
    if (!cb) return;
    const id = +cb.dataset.cek;
    if (e.target.dataset.shift === '1' && cekTerakhir != null) {
      // Shift+klik: rentang dari centang terakhir sampai baris ini ikut berubah.
      const a = S.urutDaftar.indexOf(cekTerakhir), b = S.urutDaftar.indexOf(id);
      if (a >= 0 && b >= 0) S.urutDaftar.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => setPilih(x, cb.checked));
    }
    delete e.target.dataset.shift;
    setPilih(id, cb.checked);
    cekTerakhir = id;
    updateBulk();
  });
  // Tandai Shift saat klik kotak centang (event change tidak membawa info tombol).
  $('#dev-table').addEventListener('mousedown', e => {
    const cb = e.target.closest('[data-cek]') || (e.target.closest('.c-cek') && e.target.closest('.c-cek').querySelector('[data-cek]'));
    if (cb) cb.dataset.shift = e.shiftKey ? '1' : '';
  });

  $('#bulk-all').addEventListener('click', () => {
    S.urutDaftar.forEach(id => setPilih(id, true));
    updateBulk();
  });
  $('#bulk-clear').addEventListener('click', () => {
    S.pilih.clear();
    cekTerakhir = null;
    renderDaftar();
  });
  $('#bulk-del').addEventListener('click', async () => {
    const ids = [...S.pilih];
    if (!ids.length) return;
    await deleteDev(ids);
    renderDaftar();
  });
  /** Link tim dengan peran update status. */
  function bolehStatus() {
    return !!(S.tim && pemasang(S.akses));
  }

  /** Pilihan status di bar aksi: admin semua status, tim hanya status yang diizinkan PM. */
  function isiPilihanStatus() {
    const boleh = S.canEdit ? Object.keys(STATUS).filter(k => k !== 'usulan') : bolehStatus() ? S.akses.status_boleh : [];
    $('#bulk-status').innerHTML = '<option value="">Ubah status…</option>' +
      boleh.map(k => `<option value="${k}">→ ${esc(STATUS[k].label)}</option>`).join('');
    // Sumber listrik massal: daftar titik listrik yang sudah dibuat (opsional).
    const titik = S.model ? NP.Model.sortDev(S.model.list.filter(NP.isListrik)) : [];
    $('#bulk-listrik').innerHTML = '<option value="">⚡ Titik listrik…</option>' +
      titik.map(L => {
        const mc = NP.dayaMcb(L.atribut || {});
        return `<option value="${L.id}">→ ${esc(L.nama)}${mc ? ' · MCB ' + mc.a + ' A' : ''}</option>`;
      }).join('') + (titik.length ? '<option value="lepas">— lepas titik listrik</option>' : '<option value="" disabled>(belum ada titik listrik)</option>');
    // Layer jaringan massal (hanya bila event punya > 1 layer).
    const lp = $('#bulk-lapisan');
    lp.hidden = !multiLapisan();
    lp.innerHTML = '<option value="">◧ Layer…</option>' + (multiLapisan() ? S.model.lapisanList().map(l => `<option value="${esc(l.id)}">→ ${esc(l.nama)}</option>`).join('') : '');
    const lt = $('#bulk-lantai');
    lt.hidden = !multiLantai();
    lt.innerHTML = '<option value="">⇅ Lantai…</option>' + (multiLantai() ? S.model.lantaiList().slice().reverse().map(l => `<option value="${esc(l.id)}">→ ${esc(l.nama)}</option>`).join('') : '');
  }

  $('#bulk-lapisan').addEventListener('change', e => {
    const v = e.target.value;
    e.target.value = '';
    if (!v || !S.pilih.size) return;
    const L = S.model.lapisanById(v);
    if (!confirm(`Pindahkan ${S.pilih.size} perangkat terpilih ke layer ${L.nama}?`)) return;
    pindahLapisan([...S.pilih], v, false);
  });
  $('#bulk-listrik').addEventListener('change', e => {
    const v = e.target.value;
    e.target.value = '';
    if (!v) return;
    const ids = [...S.pilih].filter(id => !NP.isListrik(S.model.byId.get(id)));
    if (!ids.length) return toast('Pilih perangkat (bukan titik listrik) terlebih dahulu', true);
    const L = v === 'lepas' ? null : S.model.byId.get(+v);
    if (!confirm(L ? `Pasang ${ids.length} perangkat ke titik listrik ${L.nama}?` : `Lepas titik listrik dari ${ids.length} perangkat?`)) return;
    pasangListrik(ids, L ? L.id : null);
  });

  /** Ubah status perangkat terpilih sekaligus. Admin bisa membatalkan (status lama tiap perangkat dikembalikan). */
  async function statusMassal(ids, status, tanpaUndo, dilewati) {
    try {
      if (S.tim) {
        const res = await api('api/tim.php', { t: S.tim, action: 'status_massal', ids, status });
        res.perangkat.forEach(p => {
          const i = S.list.findIndex(x => x.id === p.id);
          if (i >= 0) S.list[i] = p;
        });
        riwayat.id = null;
        refreshModel();
        const lewat = res.dilewati + (dilewati || 0);
        toast(`${res.perangkat.length} perangkat → ${STATUS[status].label}` + (lewat ? ` · ${lewat} di luar tugas tim dilewati` : ''));
        return;
      }
      const lama = new Map(ids.map(id => [id, (S.model.byId.get(id) || {}).status]));
      const res = await enqueue(() => api(API, { action: 'perangkat_status_massal', ids, status }));
      ids.forEach(id => {
        const d = S.model.byId.get(id);
        if (d) d.status = status;
      });
      riwayat.id = null;
      refreshModel();
      if (!tanpaUndo) catat({ label: `status ${ids.length} perangkat`, undo: () => kembalikanStatus(lama, status), redo: () => statusMassal(ids, status, true) });
      toast(`${res.jumlah} perangkat → ${STATUS[status].label}`, false, tanpaUndo ? undefined : {
        label: 'Batalkan',
        fn: async () => {
          await kembalikanStatus(lama, status);
          toast('Status dikembalikan');
        },
      });
    } catch (err) {
      setSaveState('error');
      toast(err.message, true);
    }
  }

  /** Kembalikan status lama tiap perangkat (dikelompokkan per status agar request sedikit). */
  async function kembalikanStatus(lama, status) {
    const grup = new Map();
    lama.forEach((st, id) => {
      if (!st || st === status) return;
      if (!grup.has(st)) grup.set(st, []);
      grup.get(st).push(id);
    });
    for (const [st, gids] of grup) await statusMassal(gids, st, true);
  }

  $('#bulk-status').addEventListener('change', e => {
    const status = e.target.value;
    e.target.value = '';
    if (!status) return;
    let ids = [...S.pilih];
    if (S.tim) {
      // Tim hanya mengubah perangkat dalam kategori tugasnya.
      const luar = ids.filter(id => !tugasTim(S.model.byId.get(id)));
      ids = ids.filter(id => !luar.includes(id));
      if (!ids.length) return toast('Perangkat terpilih di luar tugas tim Anda', true);
      ids.dilewati = luar.length;
    }
    if (!confirm(`Ubah status ${ids.length} perangkat menjadi "${STATUS[status].label}"?`)) return;
    statusMassal(ids, status, false, ids.dilewati || 0);
  });

  $('#bulk-kabel').innerHTML += Object.keys(NP.KABEL).map(k => `<option value="${k}">→ Kabel ${esc(NP.KABEL[k].short)}</option>`).join('');
  $('#bulk-kabel').addEventListener('change', e => {
    const kabel = e.target.value;
    e.target.value = '';
    if (!kabel) return;
    const ids = [...S.pilih].filter(id => NP.perluKabel(S.model.byId.get(id)));
    if (!ids.length) return toast('Perangkat terpilih tidak punya kabel ke uplink (belum tersambung / wireless)', true);
    if (!confirm(`Ubah status kabel ${ids.length} perangkat menjadi "${NP.KABEL[kabel].label}"?`)) return;
    setKabel(ids, kabel);
  });

  $('#bulk-kunci').addEventListener('click', () => kunciPerangkat([...S.pilih], true));
  $('#bulk-buka').addEventListener('click', () => kunciPerangkat([...S.pilih], false));

  $('#bulk-unlink').addEventListener('click', async () => {
    const ds = [...S.pilih].map(id => S.model.byId.get(id)).filter(d => d && d.uplink_id != null);
    if (!ds.length) return toast('Perangkat terpilih tidak punya koneksi uplink');
    if (!confirm(`Putuskan koneksi uplink ${ds.length} perangkat?\nPort uplink & bentuk jalur kabelnya ikut dikosongkan.`)) return;
    await kelompok(`putus ${ds.length} koneksi`, async () => {
      for (const d of ds) await saveDev(d.id, { uplink_id: null, port_uplink: '', jalur: null }, { keepPanel: true }).catch(() => {});
    });
    toast(`${ds.length} koneksi diputus`);
  });

  $('#btn-csv').addEventListener('click', () => {
    // Event dengan beberapa layer: kolom Layer di depan, baris diurutkan per layer.
    const lp = multiLapisan();
    const rows = [[...(lp ? ['Layer'] : []), 'Nama', 'Jenis', 'Nama alat', 'IP', 'VLAN', 'Uplink', 'Group', 'Port uplink', 'Port lokal', 'Media', 'Bandwidth (Mbps)',
      'Bandwidth maks. (Mbps)', 'Sumber WAN', 'Internet', 'Kabel (m)', 'Status kabel', 'Status', 'PIC', 'Isian khusus', 'Keterangan konfigurasi']];
    const urut = NP.Model.sortDev(filteredList());
    if (lp) { const idx = S.model.lapisanList().map(l => l.id); urut.sort((a, b) => idx.indexOf(S.model.lapisanOf(a)) - idx.indexOf(S.model.lapisanOf(b))); }
    for (const d of urut) {
      const p = S.model.parentOf(d);
      const w = S.model.wanOf(d);
      const k = S.model.kabelM(d);
      rows.push([...(lp ? [S.model.lapisanById(S.model.lapisanOf(d)).nama] : []), d.nama, jenisLabel(d), d.model, d.ip, d.vlan, p ? p.nama : '', p ? grupNama(p.id, d.jenis) : '', d.port_uplink, d.port_lokal,
        d.media ? MEDIA[d.media].label : '', d.bandwidth_mbps == null ? '' : d.bandwidth_mbps, S.model.bwEfektif(d).mbps == null ? '' : S.model.bwEfektif(d).mbps,
        w ? w.nama : '', KONEKSI[S.model.koneksi(d)].label, k == null ? '' : Math.round(k), NP.perluKabel(d) ? NP.KABEL[NP.kabelSt(d)].label : '', (STATUS[d.status] || STATUS.rencana).label, d.pic, attrSummary(d, false), d.catatan]);
    }
    downloadCsv(rows, `perangkat-${slug(S.proyek.nama)}.csv`);
  });

  $('#btn-export').addEventListener('click', () => {
    const p = S.proyek;
    const data = {
      format: 'net-plan', versi: 1, diekspor: new Date().toISOString(),
      proyek: { nama: p.nama, venue: p.venue, tanggal_mulai: p.tanggal_mulai, tanggal_selesai: p.tanggal_selesai, catatan: p.catatan, skala: p.skala, slack_kabel: p.slack_kabel, denah_w: p.denah_w, denah_h: p.denah_h },
      perangkat: S.list.map(d => {
        const o = Object.assign({}, d);
        delete o.proyek_id; delete o.created_at; delete o.updated_at;
        return o;
      }),
    };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `netplan-${slug(p.nama)}.json`);
  });

  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#btn-del-all').addEventListener('click', () => hapusSemuaPerangkat());
  $('#btn-rapikan').addEventListener('click', () => {
    const grupAda = S.list.some(p => Object.keys(p.atribut || {}).some(k => k.startsWith('grup_') && p.atribut[k]));
    if (!grupAda) return toast('Belum ada group bernama. Pilih perangkat, lalu isi "Nama group" di panel Koneksi.', true);
    const rencana = semuaRencana();
    if (!rencana.length) return toast('Semua nama group sudah berurutan');
    const contoh = rencana.slice(0, 15).map(x => `${x.lama}  →  ${x.baru}`).join('\n');
    if (!confirm(`Ganti nama ${rencana.length} perangkat agar berurutan sesuai group?\n\n${contoh}${rencana.length > 15 ? `\n… dan ${rencana.length - 15} lainnya` : ''}`)) return;
    terapkanNama(rencana, `${rencana.length} perangkat dirapikan namanya`);
  });
  $('#import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      return toast('File bukan JSON yang valid', true);
    }
    const list = Array.isArray(data) ? data : data && data.perangkat;
    if (!Array.isArray(list) || !list.length) return toast('File tidak berisi daftar perangkat', true);
    // Posisi disesuaikan bila ukuran denah sumber berbeda.
    const src = data.proyek || {};
    const fx = src.denah_w && S.proyek.denah_w ? S.proyek.denah_w / src.denah_w : 1;
    const fy = src.denah_h && S.proyek.denah_h ? S.proyek.denah_h / src.denah_h : 1;
    if (!confirm(`Tambahkan ${list.length} perangkat dari "${file.name}" ke event ini?\n(Perangkat yang sudah ada tidak diubah.)`)) return;
    // katalog_id dari file lain belum tentu menunjuk alat yang sama di server ini -> dilepas.
    const perangkat = list.map(d => Object.assign({}, d, {
      katalog_id: null,
      x: (+d.x || 0) * fx,
      y: (+d.y || 0) * fy,
      jalur: d.jalur && d.jalur.m === 'bebas' && Array.isArray(d.jalur.p)
        ? { m: 'bebas', p: d.jalur.p.map(q => [q[0] * fx, q[1] * fy]) }
        : d.jalur || null,
    }));
    try {
      const res = await enqueue(() => api(API, { action: 'perangkat_import', proyek_id: S.proyek.id, perangkat }));
      S.proyek = res.proyek;
      S.list = res.perangkat;
      refreshModel();
      toast(`${res.jumlah} perangkat diimpor`);
    } catch (err) {
      setSaveState('error');
      toast(err.message, true);
    }
  });

  // ------------------------------------------------------------------------ topologi & cek

  function renderTopologi() {
    const m = S.model;
    const chip = d => `<a href="#" class="dev-link" data-sel="${d.id}"><i style="background:${NP.tampil(d).color}">${esc(NP.tampil(d).short)}</i>${esc(d.nama)}</a>`;
    const issuesBy = new Map();
    const checks = m.checks();
    checks.forEach(c => c.ids.forEach(id => {
      const prev = issuesBy.get(id);
      if (!prev || c.level === 'err' || (c.level === 'warn' && prev === 'info')) issuesBy.set(id, c.level);
    }));

    const seen = new Set();
    function node(d, depth) {
      if (seen.has(d.id)) return '';
      seen.add(d.id);
      const t = TYPES[d.jenis] || TYPES.lainnya;
      const a = d.atribut || {};
      const lainWan = m.wanLain(d);
      const pakaiWan = d.jenis === 'isp' ? m.pemakaiWan(d.id) : [];
      const meta = [d.model, d.ip, d.vlan ? 'VLAN ' + d.vlan : '', a.ssid ? 'SSID ' + a.ssid : '', a.channel ? 'ch ' + a.channel : '', fmtBw(d.bandwidth_mbps),
        lainWan.length ? `+ WAN tambahan: ${lainWan.map(w => w.dev.nama + (w.port ? ' (' + w.port + ')' : '')).join(', ')} · ${m.wanMode(d) === 'loadbalance' ? 'load balance' : 'failover'}` : '',
        pakaiWan.length ? 'WAN tambahan untuk ' + pakaiWan.map(x => x.nama).join(', ') : '',
        m.uplinkLain(d).length ? `+ uplink kedua: ${m.uplinkLain(d).map(w => w.dev.nama + (w.port ? ' (' + w.port + ')' : '') + (w.media === 'fiber' ? ' · FO' : '')).join(', ')} · ${m.uplinkMode(d) === 'lacp' ? 'LACP' : 'redundan'}` : ''].filter(Boolean);
      const port = [d.port_lokal, d.port_uplink].filter(Boolean).join(' ↔ ');
      const lv = issuesBy.get(d.id);
      const kids = NP.Model.sortDev(m.kids(d.id));
      const tutup = kids.length && treeTutup.has(d.id);
      // Cabang tertutup: ringkasan isi cabang (jumlah per jenis) agar tetap informatif.
      let ringkas = '';
      if (tutup) {
        const hit = new Map();
        m.descendants(d.id).forEach(id => {
          const x = m.byId.get(id);
          const l = x ? NP.tampil(x).label : '';
          if (l) hit.set(l, (hit.get(l) || 0) + 1);
        });
        ringkas = `<button type="button" class="tsum" data-twig="${d.id}">${[...hit].map(([l, n]) => `${n} ${esc(l)}`).join(' · ')}</button>`;
      }
      const tog = kids.length
        ? `<button type="button" class="twig${tutup ? '' : ' buka'}" data-twig="${d.id}" aria-expanded="${!tutup}" title="${tutup ? 'Buka' : 'Tutup'} cabang (${m.descendants(d.id).size} perangkat)">▸</button>`
        : '<span class="twig-x"></span>';
      return `<div class="tnode" style="--d:${depth}">
          <div class="trow">
            ${tog}${chip(d)}
            <span class="muted small">${esc(jenisLabel(d))}</span>
            ${port ? `<span class="port" title="Port lokal ↔ port di uplink">${esc(port)}${d.media ? ' · ' + esc(MEDIA[d.media].short || d.media) : ''}</span>` : d.media && depth ? `<span class="port">${esc(MEDIA[d.media].short || d.media)}</span>` : ''}
            <span class="st st-${d.status}">${esc((STATUS[d.status] || STATUS.rencana).label)}</span>
            ${konBadge(m.koneksi(d))}
            ${vlanBadge(d)}
            ${NP.perluKabel(d) && m.parentOf(d) ? `<span title="Status kabel ke ${esc(m.parentOf(d).nama)}">🔌 ${bolehKabel(d) ? kabelBadgeBtn(d) : kabelBadge(d)}</span>` : ''}
            ${lv ? `<span class="lv ${lv}">${lv === 'err' ? 'masalah' : lv === 'warn' ? 'peringatan' : 'catatan'}</span>` : ''}
          </div>
          ${meta.length ? `<div class="tmeta">${meta.map(esc).join(' · ')}</div>` : ''}
          ${ringkas ? `<div class="tmeta">${ringkas}</div>` : ''}
        </div>` + (tutup ? '' : kids.map(c => node(c, depth + 1)).join(''));
    }
    muatTreeTutup();
    // Layer jaringan: satu layer dipilih = hanya pohonnya; semua layer = pohon dikelompokkan per layer.
    const roots = m.roots().filter(masukLapisan);
    const nTampil = m.list.filter(masukLapisan).length;
    if (multiLapisan() && S.lapisan === 'semua') {
      $('#tree').innerHTML = m.lapisanList().map(L => {
        const rs = roots.filter(r => m.lapisanOf(r) === L.id);
        const n = m.list.filter(d => m.lapisanOf(d) === L.id).length;
        return `<div class="tree-lp"><div class="tree-lp-h"><i style="background:${esc(L.warna)}"></i><b>${esc(L.nama)}</b><span class="muted small">${n} perangkat · ${rs.length} akar</span>
          <button type="button" class="small ghost" data-lapisan-pilih="${esc(L.id)}">Tampilkan layer ini</button></div>
          ${rs.length ? rs.map(r => node(r, 0)).join('') : '<p class="muted small">Belum ada perangkat di layer ini.</p>'}</div>`;
      }).join('');
    } else {
      $('#tree').innerHTML = roots.length ? roots.map(r => node(r, 0)).join('') : '<p class="muted">Belum ada perangkat.</p>';
    }
    $('#topo-count').textContent = `${nTampil} perangkat · ${roots.length} akar${multiLapisan() && S.lapisan !== 'semua' ? ' · layer ' + m.lapisanById(S.lapisan).nama : ''}`;

    $('#checks').innerHTML = checks.length
      ? `<ul class="issues">${checks.map(c => `<li class="lv-${c.level}">${esc(c.msg)} ${c.ids.slice(0, 1).map(id => `<a href="#" data-sel="${id}">lihat</a>`).join('')}</li>`).join('')}</ul>`
      : '<p class="ok-text">✓ Tidak ada masalah terdeteksi.</p>';

    // Ringkasan (WAN, SSID, kebutuhan perangkat, kabel): satu layer dipilih = layer itu saja; "Semua" = rincian per layer.
    const mS = multiLapisan() && S.lapisan !== 'semua' ? NP.Model.create(S.proyek, S.list.filter(masukLapisan), S.katalog) : m;
    const cols = kolomLapisan(false);
    const wans = mS.list.filter(d => d.jenis === 'isp');
    const totalWan = wans.reduce((s, d) => s + (d.bandwidth_mbps || 0), 0);
    $('#wan-sum').innerHTML = wans.length ? `<table class="mini">${wans.map(w => {
      const n = m.descendants(w.id).size;
      const pakai = m.pemakaiWan(w.id);
      return `<tr><td>${chip(w)}${lapisanChip(w)}</td><td>${esc([w.atribut.provider, w.atribut.jenis_koneksi].filter(Boolean).join(' · '))}</td><td class="num">${esc(fmtBw(w.bandwidth_mbps))}</td><td class="num muted">${n ? n + ' perangkat' : ''}${pakai.length ? `${n ? '<br>' : ''}WAN tambahan ${esc(pakai.map(x => x.nama).join(', '))}` : n ? '' : '0 perangkat'}</td></tr>`;
    }).join('')}${cols.map(L => { const ws = wans.filter(w => m.lapisanOf(w) === L.id); return ws.length ? `<tr class="tot"><td colspan="2"><i class="lp-dot" style="background:${esc(L.warna)}"></i>Kapasitas ${esc(L.nama)}</td><td class="num">${esc(fmtBw(ws.reduce((s, d) => s + (d.bandwidth_mbps || 0), 0)))}</td><td class="num muted">${ws.length} WAN</td></tr>` : ''; }).join('')}${wans.length > 1 ? `<tr class="tot"><td colspan="2">Total kapasitas</td><td class="num">${esc(fmtBw(totalWan))}</td><td></td></tr>` : ''}</table>` : '<p class="muted">Belum ada Sumber WAN/ISP.</p>';

    const ss = mS.ssids();
    $('#ssid-sum').innerHTML = ss.length ? `<table class="mini"><tr><th>SSID</th><th>Keamanan</th><th>VLAN</th><th class="num">AP</th></tr>${ss.map(s =>
      `<tr><td><b>${esc(s.ssid)}</b></td><td>${esc([...s.keamanan].join(', '))}</td><td>${esc([...s.vlan].join(', '))}</td><td class="num">${s.ap.length}</td></tr>`).join('')}</table>` : '<p class="muted">Belum ada AP dengan SSID.</p>';

    const bom = mS.bom();
    $('#kabel-progres').innerHTML = progresKabelHtml(false);
    $('#listrik-sum').innerHTML = listrikSumHtml();
    $('#vlan-sum').innerHTML = vlanSumHtml();
    // Stok: hanya untuk alat dari katalog; merah bila kebutuhan event melebihi stok. "Semua" layer: kolom per layer.
    $('#bom').innerHTML = bom.length ? bomTabel(bom, cols, false) : '<p class="muted">—</p>';

    const kb = mS.kabel();
    const keys = Object.keys(kb.tot);
    $('#kabel-sum').innerHTML = (keys.length ? `${kabelTabel(kb, cols, false)}
      <p class="muted small">Jarak lurus antartitik + ${S.proyek.slack_kabel}% (belokan, naik-turun, sisa). Tambahkan patch cord di rak.</p>` : '') +
      (kb.tanpaSkala ? `<p class="muted small">${kb.tanpaSkala} link belum bisa dihitung — kalibrasi skala denah dengan alat Ukur.</p>` : '') +
      (!keys.length && !kb.tanpaSkala ? '<p class="muted">Belum ada link kabel.</p>' : '');
  }

  // Cabang pohon topologi yang ditutup, disimpan per event di browser.
  let treeTutup = new Set();
  let treeProyek = null;
  function muatTreeTutup() {
    if (treeProyek === S.proyek.id) return;
    treeProyek = S.proyek.id;
    try { treeTutup = new Set(JSON.parse(localStorage.getItem('np-tree-' + treeProyek) || '[]')); } catch (err) { treeTutup = new Set(); }
  }
  function simpanTreeTutup() {
    try { localStorage.setItem('np-tree-' + treeProyek, JSON.stringify([...treeTutup])); } catch (err) { /* abaikan */ }
  }

  $('[data-pane="topologi"]').addEventListener('click', e => {
    const lpb = e.target.closest('[data-lapisan-pilih]');
    if (lpb) return setLapisan(lpb.dataset.lapisanPilih);
    const tw = e.target.closest('[data-twig]');
    if (tw) {
      const id = +tw.dataset.twig;
      if (treeTutup.has(id)) treeTutup.delete(id);
      else treeTutup.add(id);
      simpanTreeTutup();
      return renderTopologi();
    }
    const tb = e.target.closest('[data-tree]');
    if (tb) {
      const m = S.model;
      const induk = m.list.filter(d => m.kids(d.id).length);
      if (tb.dataset.tree === 'buka') treeTutup.clear();
      else if (tb.dataset.tree === 'tutup') treeTutup = new Set(m.roots().filter(d => m.kids(d.id).length).map(d => d.id));
      else treeTutup = new Set(induk.filter(d => m.kids(d.id).every(c => c.jenis === 'endpoint')).map(d => d.id));
      simpanTreeTutup();
      return renderTopologi();
    }
    const a = e.target.closest('[data-sel]');
    if (!a) return;
    e.preventDefault();
    const id = +a.dataset.sel;
    S.sel = id;
    go('denah');
    setTimeout(() => selectDev(id, true), 60);
  });

  // ------------------------------------------------------------------------ support & listrik (rekap listrik)

  /** Data rekap listrik: titik listrik + beban, perangkat tanpa titik pemasok, perlu tarik listrik, total. */
  function dataRekapListrik() {
    const m = S.model;
    const titik = m.bebanListrik().map(b => Object.assign(b, { mcb: NP.dayaMcb(b.L.atribut || {}) }));
    const konsumen = m.list.filter(d => !NP.isListrik(d) && !(d.jenis === 'isp' && !(d.atribut || {}).listrik));
    const st = d => (d.atribut || {}).listrik || '';
    const tanpa = konsumen.filter(d => !['poe', 'baterai'].includes(st(d)) && !m.listrikOf(d));
    const kap = titik.reduce((s, b) => s + (b.kap || 0), 0);
    const pakai = titik.reduce((s, b) => s + b.watt, 0);
    return {
      titik, tanpa, kap, pakai,
      total: konsumen.reduce((s, d) => s + (m.dayaW(d) || 0), 0),
      perlu: konsumen.filter(d => st(d) === 'perlu'),
      belum: konsumen.filter(d => st(d) === ''),
    };
  }

  const warnaBeban = pct => (pct == null ? '#94a3b8' : pct > 100 ? '#dc2626' : pct >= 80 ? '#d97706' : '#16a34a');
  const fmtSisa = w => (w < 0 ? '−' + fmtW(-w) : fmtW(w));

  function renderSupportIsi() {
    const m = S.model;
    const r = dataRekapListrik();
    const chipL = d => `<a href="#" class="dev-link" data-sel="${d.id}"><i style="background:${NP.tampil(d).color}">${NP.isListrik(d) ? '⚡' : esc(NP.tampil(d).short)}</i>${esc(d.nama)}</a>`;
    const grupLbl = d => (NP.nonJaringan(d) ? 'Support' : 'Jaringan');
    const tile = (n, l, cls) => `<div class="sp-tile${cls ? ' ' + cls : ''}"><b>${n}</b><span>${l}</span></div>`;
    const sisa = r.kap - r.pakai;
    let h = `<div class="sp-head">
        <div><h1>Support &amp; listrik</h1><p class="muted">Rekap daya per titik listrik (MCB) dan daftar peralatan support event ini.</p></div>
        <div class="btn-row">
          <button type="button" data-sp="denah">⚡ Lihat support di denah</button>
          <button type="button" data-sp="csv">Unduh CSV rekap listrik</button>
          <button type="button" data-sp="cetak">Cetak rekap listrik</button>
          <button type="button" class="primary" data-sp="cetak-support">Cetak laporan support (denah)</button>
        </div>
      </div>
      <div class="sp-tiles">
        ${tile(r.titik.length, 'titik listrik')}
        ${tile(fmtW(r.kap), 'total kapasitas (MCB)')}
        ${tile(fmtW(r.pakai), 'terpakai di titik listrik', r.kap && r.pakai > r.kap * 0.8 ? 'warn' : '')}
        ${tile(r.kap ? fmtSisa(sisa) : '—', 'sisa daya', sisa < 0 ? 'bad' : '')}
        ${tile(fmtW(r.total), 'total konsumsi semua perangkat')}
        ${tile(r.perlu.length, 'perlu tarik listrik', r.perlu.length ? 'bad' : '')}
        ${tile(r.tanpa.length, 'belum punya titik pemasok', r.tanpa.length ? 'warn' : '')}
      </div>`;

    // Per titik listrik
    h += '<div class="card"><h2>Rekap per titik listrik</h2>';
    h += r.titik.length ? r.titik.map(b => {
      const a = b.L.atribut || {};
      const sisaL = b.kap ? b.kap - b.watt : null;
      return `<div class="sp-titik">
        <div class="sp-titik-h">
          <div>${chipL(b.L)} <span class="muted small">${esc([a.sumber_listrik, a.lokasi_panel].filter(Boolean).join(' · '))}</span></div>
          <div class="sp-angka">
            <span>MCB <b>${b.mcb ? b.mcb.a + ' A' : '—'}</b>${b.mcb ? ` <span class="muted">${b.mcb.v} V${b.mcb.tiga ? ' · 3 fase' : ''}</span>` : ''}</span>
            <span>Kapasitas <b>${b.kap ? fmtW(b.kap) : '—'}</b></span>
            <span>Aman 80% <b>${b.kap ? fmtW(b.kap * 0.8) : '—'}</b></span>
            <span>Terpakai <b>${fmtW(b.watt)}</b>${b.pct != null ? ` <span class="muted">(${b.pct}%)</span>` : ''}</span>
            <span>Sisa <b class="${sisaL != null && sisaL < 0 ? 'bad' : ''}">${sisaL == null ? '—' : fmtSisa(sisaL)}</b></span>
            ${b.soket ? `<span>Soket <b${b.devs.length > b.soket ? ' class="bad"' : ''}>${b.devs.length}/${b.soket}</b></span>` : ''}
          </div>
        </div>
        ${b.kap ? `<div class="kb-bar"><i style="width:${Math.min(100, b.pct)}%;background:${warnaBeban(b.pct)}"></i></div>` : '<p class="muted small">Isi MCB titik listrik ini agar kapasitasnya terhitung.</p>'}
        ${b.devs.length ? `<table class="mini"><tr><th>Perangkat</th><th>Kelompok</th><th>Jenis</th><th class="num">Daya</th></tr>${NP.Model.sortDev(b.devs).map(d =>
          `<tr><td>${chipL(d)}</td><td>${grupLbl(d)}</td><td>${esc(jenisLabel(d))}</td><td class="num">${m.dayaW(d) ? fmtW(m.dayaW(d)) : '<span class="bad">belum diisi</span>'}</td></tr>`).join('')}</table>`
          : '<p class="muted small">Belum ada perangkat yang memakai titik listrik ini.</p>'}
      </div>`;
    }).join('') : '<p class="muted">Belum ada titik listrik. Tambahkan dari toolbar denah (⚡ Listrik), lalu isi MCB-nya.</p>';
    h += '</div>';

    // Perangkat yang belum jelas sumber listriknya
    if (r.tanpa.length) {
      h += `<div class="card"><h2>Belum punya titik listrik pemasok <span class="muted small">${r.tanpa.length} perangkat · ${fmtW(r.tanpa.reduce((s, d) => s + (m.dayaW(d) || 0), 0))}</span></h2>
        <table class="mini"><tr><th>Perangkat</th><th>Kelompok</th><th>Listrik di lokasi</th><th class="num">Daya</th></tr>${NP.Model.sortDev(r.tanpa).map(d =>
        `<tr><td>${chipL(d)}</td><td>${grupLbl(d)}</td><td>${listrikBadge((d.atribut || {}).listrik || '')}</td><td class="num">${m.dayaW(d) ? fmtW(m.dayaW(d)) : '—'}</td></tr>`).join('')}</table></div>`;
    }

    // Peralatan support
    const sup = NP.Model.sortDev(m.list.filter(d => NP.nonJaringan(d) && !NP.isListrik(d)));
    h += `<div class="card"><h2>Peralatan support <span class="muted small">${sup.length} item</span></h2>${sup.length
      ? `<table class="mini"><tr><th>Nama</th><th>Kategori</th><th class="num">Jumlah</th><th>Kapasitas / ukuran</th><th class="num">Daya</th><th>Titik listrik</th><th>Status</th><th>PIC</th></tr>${sup.map(d => {
        const a = d.atribut || {};
        const L = m.listrikOf(d);
        return `<tr><td>${chipL(d)}</td><td>${esc(a.kategori_support || '—')}</td><td class="num">${esc(a.jumlah || '1')}</td><td>${esc(a.kapasitas_support || '')}</td>
          <td class="num">${m.dayaW(d) ? fmtW(m.dayaW(d)) : '—'}</td><td>${L ? chipL(L) : listrikBadge(a.listrik || '')}</td>
          <td><span class="st st-${d.status}">${esc((STATUS[d.status] || STATUS.rencana).label)}</span></td><td>${esc(d.pic)}</td></tr>`;
      }).join('')}</table>`
      : '<p class="muted">Belum ada peralatan support. Tambahkan dari toolbar denah (Support): UPS, genset, terminal, rak, monitor, sound, lampu, ...</p>'}</div>`;
    $('#support-pane').innerHTML = h;
  }

  function csvRekapListrik() {
    const m = S.model;
    const r = dataRekapListrik();
    const rows = [['Titik listrik', 'MCB (A)', 'Tegangan (V)', 'Fase', 'Kapasitas (W)', 'Aman 80% (W)', 'Terpakai (W)', 'Sisa (W)', 'Perangkat', 'Kelompok', 'Jenis', 'Listrik di lokasi', 'Daya (W)']];
    const baris = (b, d) => {
      const mc = b && b.mcb;
      return [b ? b.L.nama : '(belum ada titik pemasok)', mc ? mc.a : '', mc ? mc.v : '', mc ? (mc.tiga ? '3 fase' : '1 fase') : '',
        b && b.kap ? Math.round(b.kap) : '', b && b.kap ? Math.round(b.kap * 0.8) : '', b ? Math.round(b.watt) : '', b && b.kap ? Math.round(b.kap - b.watt) : '',
        d ? d.nama : '', d ? (NP.nonJaringan(d) ? 'Support' : 'Jaringan') : '', d ? jenisLabel(d) : '',
        d ? NP.LISTRIK[(d.atribut || {}).listrik || ''].label : '', d && m.dayaW(d) ? Math.round(m.dayaW(d)) : ''];
    };
    r.titik.forEach(b => {
      if (!b.devs.length) rows.push(baris(b, null));
      NP.Model.sortDev(b.devs).forEach(d => rows.push(baris(b, d)));
    });
    NP.Model.sortDev(r.tanpa).forEach(d => rows.push(baris(null, d)));
    downloadCsv(rows, `rekap-listrik-${slug(S.proyek.nama)}.csv`);
  }

  /** Kepala laporan cetak. */
  function prHead(judul) {
    const p = S.proyek;
    return `<div class="pr-head"><h1>${esc(judul)}${S.labelLapisan ? ' · Layer ' + esc(S.labelLapisan) : ''} — ${esc(p.nama)}</h1><p>${esc(p.venue || '')} · dicetak ${esc(new Date().toLocaleString('id-ID'))}</p></div>`;
  }

  /** Rekap listrik saja (tabel), A4 tegak. */
  function cetakRekapListrik() {
    $('#print').className = 'print';
    $('#print').innerHTML = prHead('Rekap listrik') + htmlRekapListrik();
    printWith('A4 portrait');
  }

  /**
   * Laporan support & listrik: denah berisi titik listrik & peralatan support (perangkat jaringan yang memakai /
   * butuh listrik digambar samar sebagai konteks) + garis listrik, lalu rekap listrik & daftar peralatan support.
   */
  function cetakLaporanSupport() {
    const m = S.model;
    const butuh = d => !NP.nonJaringan(d) && (!!m.listrikOf(d) || (d.atribut || {}).listrik === 'perlu');
    const denahSvg = petaLaporan({ filter: NP.nonJaringan, redup: butuh, pwr: true, tanpaInternet: true });
    const lg = (warna, isi, teks) => `<span><i style="background:${warna}">${isi}</i>${esc(teks)}</span>`;
    $('#print').className = 'print';
    $('#print').innerHTML = prHead('Laporan support & listrik') +
      `<div class="pr-legend">${lg(TYPES.listrik.color, '⚡', 'Titik listrik')}${lg(TYPES.support.color, 'SUP', 'Peralatan support')}
        <span><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="#ca8a04" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round"/></svg>Jalur listrik ke titik pemasok</span>
        <span style="opacity:.45"><i style="background:#64748b"></i>Perangkat jaringan yang memakai / butuh listrik (samar)</span></div>
      ${denahSvg}` +
      htmlRekapListrik();
    printWith('A4 landscape');
  }

  /**
   * Laporan foto pemasangan: ringkasan kelengkapan, satu kartu per perangkat berfoto (1–3 foto + koordinat, waktu,
   * pengambil, status, uplink & port), lalu daftar perangkat yang belum difoto. Menunggu semua foto dimuat sebelum cetak.
   */
  async function cetakLaporanFoto() {
    const m = S.model;
    const semua = NP.Model.sortDev(m.list.filter(d => !NP.isListrik(d)));
    const ada = semua.filter(d => fotoOf(d.id).length);
    const belum = semua.filter(d => !fotoOf(d.id).length);
    const tanpaGps = S.foto.filter(f => f.lat == null && m.byId.get(f.perangkat_id)).length;
    const st = d => (STATUS[d.status] || STATUS.rencana).label;
    // Hasil checker penempatan: "✓ Sesuai plan (Budi · 2026-10-24 10:00) — catatan".
    const verifTxt = d => {
      const v = NP.verifOf(d);
      if (!v) return '';
      const V = NP.VERIF[v.h];
      return `<b style="color:${V.color}">${V.icon} ${esc(V.label)}</b> (${esc(v.o || '')} · ${esc(v.t || '')})${v.c ? ' — ' + esc(v.c) : ''}`;
    };
    const lokasi = d => {
      const p = m.parentOf(d);
      return p ? `${esc(p.nama)}${d.port_uplink ? ' port ' + esc(d.port_uplink) : ''}` : '—';
    };
    const tr = (cells, th) => `<tr>${cells.map(c => `<${th ? 'th' : 'td'}>${c}</${th ? 'th' : 'td'}>`).join('')}</tr>`;
    $('#print').className = 'print';
    $('#print').innerHTML = prHead('Laporan foto pemasangan') +
      `<p>Perangkat: <b>${semua.length}</b> · Sudah difoto: <b>${ada.length}</b> · Belum difoto: <b>${belum.length}</b> · Total foto: <b>${S.foto.filter(f => m.byId.get(f.perangkat_id)).length}</b>` +
      `${tanpaGps ? ` · Foto tanpa koordinat: <b>${tanpaGps}</b>` : ''} · Terpasang/diuji: <b>${semua.filter(d => d.status === 'terpasang' || d.status === 'diuji').length}</b> · Dicek checker: <b>${semua.filter(d => NP.verifOf(d)).length}</b> (sesuai <b>${semua.filter(d => (NP.verifOf(d) || {}).h === 'sesuai').length}</b>, tidak sesuai <b>${semua.filter(d => (NP.verifOf(d) || {}).h === 'tidak').length}</b>)</p>`;
    isiFoto();
    toast('Menyiapkan foto…');
    // Semua foto harus selesai dimuat agar ikut tercetak.
    await Promise.all($$('#print img').map(img => (img.complete ? null : new Promise(r => { img.onload = img.onerror = r; }))));
    printWith('A4 portrait');

    /** Kartu foto satu perangkat. */
    function kartuFoto(d) {
      const a = d.atribut || {};
      return `<section class="pr-foto">
          <h3>${esc(d.nama)} <small>${esc(jenisLabel(d))}${d.model ? ' · ' + esc(d.model) : ''}</small></h3>
          <p class="pr-foto-meta">Status: <b>${esc(st(d))}</b> · Uplink: ${lokasi(d)}${d.ip ? ' · IP ' + esc(d.ip) : ''}${a.lokasi_rak ? ' · ' + esc(a.lokasi_rak) : ''}${d.pic ? ' · PIC ' + esc(d.pic) : ''}</p>${verifTxt(d) ? `<p class="pr-foto-meta pr-vf">${verifTxt(d)}</p>` : ''}
          <div class="pr-foto-grid">${fotoOf(d.id).map((f, i) => `<figure>
            <img src="${fotoUrl(f)}" alt="Foto ${i + 1} ${esc(d.nama)}">
            <figcaption><b>Foto ${i + 1}</b> · ${esc((f.diambil_at || '').slice(0, 16))}${f.oleh ? ' · ' + esc(f.oleh) : ''}<br>
              ${f.lat != null ? `📍 ${koordinat(f)}${f.akurasi_m != null ? ` (±${Math.round(f.akurasi_m)} m)` : ''}` : '📍 tanpa koordinat'}</figcaption></figure>`).join('')}</div>
        </section>`;
    }
    /** Tabel perangkat yang belum difoto. */
    function tabelBelum(ds, judul) {
      return ds.length ? `<h3 class="pr-belum">${judul} (${ds.length})</h3><table class="pr-table">${tr(['Perangkat', 'Jenis', 'Status', 'Uplink / port', 'Pengecekan', 'PIC'], true)}${ds.map(d =>
        tr([`<b>${esc(d.nama)}</b>`, esc(jenisLabel(d)), esc(st(d)), lokasi(d), verifTxt(d) || '—', esc(d.pic)])).join('')}</table>` : '';
    }
    /**
     * Isi laporan. Gabungan beberapa layer: rekap per layer, lalu per layer judul berwarna + kartu foto + tabel belum
     * difoto; satu layer / satu jaringan: kartu foto lalu tabel belum difoto.
     */
    function isiFoto() {
      const colsLp = kolomLapisan(true);
      let h = '';
      if (colsLp.length) {
        h += `<table class="pr-table pr-rekap-lp">${tr(['Layer', 'Perangkat', 'Sudah difoto', 'Belum difoto', 'Sesuai plan', 'Tidak sesuai'], true)}${colsLp.map(L => {
          const ds = semua.filter(d => m.lapisanOf(d) === L.id);
          const n = h2 => ds.filter(d => (NP.verifOf(d) || {}).h === h2).length;
          return tr([`<b style="color:${esc(L.warna)}">● ${esc(L.nama)}</b>`, ds.length, ds.filter(d => fotoOf(d.id).length).length, ds.filter(d => !fotoOf(d.id).length).length, n('sesuai'), n('tidak')]);
        }).join('')}</table>`;
        colsLp.forEach(L => {
          const dsA = ada.filter(d => m.lapisanOf(d) === L.id);
          const dsB = belum.filter(d => m.lapisanOf(d) === L.id);
          if (!dsA.length && !dsB.length) return;
          h += `<h2 class="pr-lp" style="border-left-color:${esc(L.warna)}">Layer ${esc(L.nama)} <small>${dsA.length} perangkat berfoto · ${dsB.length} belum difoto</small></h2>` +
            dsA.map(kartuFoto).join('') + tabelBelum(dsB, `Belum ada foto — ${esc(L.nama)}`);
        });
      } else {
        h += ada.map(kartuFoto).join('') + tabelBelum(belum, 'Belum ada foto');
      }
      $('#print').insertAdjacentHTML('beforeend', h);
    }
  }

  // ------------------------------------------------------------------------ laporan foto PowerPoint

  const skripDimuat = new Map();
  /** Muat skrip pustaka sekali saja, saat dibutuhkan (mis. PptxGenJS ±470 KB hanya saat unduh PowerPoint). */
  function muatSkrip(src) {
    if (!skripDimuat.has(src)) {
      skripDimuat.set(src, new Promise((ok, gagal) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = ok;
        s.onerror = () => {
          skripDimuat.delete(src);
          gagal(new Error('Pustaka PowerPoint gagal dimuat — periksa koneksi lalu coba lagi'));
        };
        document.head.appendChild(s);
      }));
    }
    return skripDimuat.get(src);
  }

  async function keDataUrl(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Gambar tidak bisa dimuat');
    const blob = await res.blob();
    return new Promise((ok, gagal) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result);
      fr.onerror = gagal;
      fr.readAsDataURL(blob);
    });
  }

  /** Potongan denah di sekitar d (PNG data URL) dengan penanda titik; img = gambar denah yang sudah dimuat. */
  function potonganDenah(img, d) {
    const { W, H } = ukuranLantai(S.model.lantaiOf(d));
    const [x, y, w, h] = cropAround(d, 0.5);
    const kx = img.naturalWidth / W, ky = img.naturalHeight / H;
    const cw = 900, ch = Math.round(cw * h / w);
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cw, ch);
    g.drawImage(img, x * kx, y * ky, w * kx, h * ky, 0, 0, cw, ch);
    const px = (d.x - x) / w * cw, py = (d.y - y) / h * ch;
    const t = NP.tampil(d);
    g.lineWidth = 6;
    g.strokeStyle = '#dc2626';
    g.beginPath();
    g.arc(px, py, 26, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = t.color;
    g.beginPath();
    g.arc(px, py, 14, 0, Math.PI * 2);
    g.fill();
    g.font = 'bold 26px system-ui, sans-serif';
    g.lineWidth = 6;
    g.strokeStyle = '#fff';
    g.strokeText(d.nama, px + 32, py + 9);
    g.fillStyle = '#111827';
    g.fillText(d.nama, px + 32, py + 9);
    return cv.toDataURL('image/png');
  }

  /**
   * Denah penempatan satu lantai (PNG data URL): gambar denah pudar (opacity 20%) + titik perangkat ds berwarna per
   * jenis (lingkaran; endpoint = kotak) dengan singkatan & nama. img = gambar denah yang sudah dimuat (null = kanvas
   * polos). warnaLp(d) = warna cincin layer (null = putih); tanpaLabel(d) = true: nama tidak ditulis (denah padat).
   */
  function petaPenempatan(img, lid, ds, warnaLp, tanpaLabel, potong) {
    const { W, H } = ukuranLantai(lid);
    // potong: zoom ke area perangkat (kotak pembatas + margin), rasio mengikuti area slide (≈ 2 : 1), min. 30% denah.
    let [vx, vy, vw, vh] = [0, 0, W, H];
    if (potong && ds.length) {
      const pad = Math.max(W, H) * 0.06;
      let x0 = Math.min(...ds.map(d => d.x)) - pad, x1 = Math.max(...ds.map(d => d.x)) + pad;
      let y0 = Math.min(...ds.map(d => d.y)) - pad, y1 = Math.max(...ds.map(d => d.y)) + pad * 1.4; // ruang label di bawah
      let w = Math.max(x1 - x0, W * 0.3), h = Math.max(y1 - y0, H * 0.3);
      const rasio = 2.05;
      if (w / h > rasio) h = w / rasio; else w = h * rasio;
      w = Math.min(w, W);
      h = Math.min(h, H);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      vx = Math.max(0, Math.min(W - w, cx - w / 2));
      vy = Math.max(0, Math.min(H - h, cy - h / 2));
      vw = w;
      vh = h;
    }
    const cw = 2400, ch = Math.round(cw * vh / vw);
    const k = cw / vw;
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cw, ch);
    if (img) {
      const kx = img.naturalWidth / W, ky = img.naturalHeight / H;
      g.globalAlpha = 0.2;
      g.drawImage(img, vx * kx, vy * ky, vw * kx, vh * ky, 0, 0, cw, ch);
      g.globalAlpha = 1;
    }
    const r = 20;
    const urut = ds.slice().sort((a, b) => TYPE_ORDER.indexOf(b.jenis) - TYPE_ORDER.indexOf(a.jenis)); // infrastruktur di atas
    for (const d of urut) {
      const t = NP.tampil(d);
      const x = (d.x - vx) * k, y = (d.y - vy) * k;
      const sk = d.jenis === 'ap' && NP.sektor(d);
      if (sk) {
        // AP sektoral: kipas arah pancaran.
        const a0 = (sk.arah - sk.lebar / 2 - 90) * Math.PI / 180, a1 = (sk.arah + sk.lebar / 2 - 90) * Math.PI / 180;
        g.fillStyle = t.color;
        g.globalAlpha = 0.3;
        g.beginPath();
        g.moveTo(x, y);
        g.arc(x, y, r * 2.6, a0, a1);
        g.closePath();
        g.fill();
        g.globalAlpha = 1;
      }
      const kotak = d.jenis === 'endpoint';
      const bentuk = (rr) => {
        g.beginPath();
        if (kotak) g.roundRect(x - rr, y - rr, rr * 2, rr * 2, rr * 0.35);
        else g.arc(x, y, rr, 0, Math.PI * 2);
      };
      g.fillStyle = (warnaLp && warnaLp(d)) || '#fff';
      bentuk(r + 4);
      g.fill();
      g.fillStyle = t.color;
      bentuk(r);
      g.fill();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `bold ${Math.round(r * (t.short.length > 2 ? 0.62 : 0.8))}px Arial, sans-serif`;
      g.fillText(t.short, x, y + 1);
      if (tanpaLabel && tanpaLabel(d)) continue;
      g.font = `bold ${Math.round(r * 0.95)}px Arial, sans-serif`;
      g.textBaseline = 'top';
      g.lineWidth = Math.max(4, r * 0.3);
      g.lineJoin = 'round';
      g.strokeStyle = '#fff';
      g.strokeText(d.nama, x, y + r + 6);
      g.fillStyle = '#111827';
      g.fillText(d.nama, x, y + r + 6);
    }
    return { data: cv.toDataURL('image/png'), w: cw, h: ch };
  }

  /** Isian jenis yang bukan spesifikasi alat (setelan jaringan router / data layanan) — tidak masuk laporan. */
  const BUKAN_SPEK = ['subnet_lan', 'dhcp', 'lease', 'dns', 'qos', 'user_admin', 'mode_wan', 'hotspot', 'id_layanan', 'kontak_noc',
    'ip_publik', 'gateway', 'mounting', 'lokasi_rak', 'tipe_endpoint', 'vlan_trunk', 'kontak'];

  /**
   * Spesifikasi & data titik untuk laporan: [[label, nilai], ...]. Urutan: alat (merek/model katalog), data pemasangan
   * (uplink & port, IP/VLAN, posisi pasang, limit, PIC), spesifikasi katalog (satuan dipindah ke nilai, mis.
   * "Konsumsi daya maks. (W)" → "15 W"), lalu isian jenis (tanpa password). Label kembar dilewati; maks. 20 baris.
   */
  function specPpt(d) {
    const m = S.model;
    const k = m.kat(d);
    const a = d.atribut || {};
    const out = [];
    const ada = new Set();
    const tambah = (label, nilai) => {
      const v = String(nilai == null ? '' : nilai).trim();
      const kunci = label.toLowerCase();
      if (!v || ada.has(kunci)) return;
      ada.add(kunci);
      out.push([label, v]);
    };
    const satuan = (label, nilai) => {
      const u = label.match(/\s*\((W|Mbps|m|°|dBi|GHz)\)$/);
      return u ? [label.slice(0, u.index), `${nilai}${u[1] === '°' ? '°' : ' ' + u[1]}`] : [label, nilai];
    };
    tambah('Alat', k ? [k.merek, k.model].filter(Boolean).join(' ') : d.model);
    // Data pemasangan lebih dulu: tetap tampil walau spesifikasi katalog panjang (batas 20 baris).
    const up = m.parentOf(d);
    tambah('Uplink', up ? `${up.nama}${d.port_uplink ? ' port ' + d.port_uplink : ''}${d.media ? ' · ' + MEDIA[d.media].label : ''}` : '');
    tambah('IP / VLAN', [d.ip, d.vlan ? 'VLAN ' + d.vlan : ''].filter(Boolean).join(' · '));
    tambah('Posisi pasang', [m.multiLantai() ? m.lantaiById(m.lantaiOf(d)).nama : '', a.mounting, a.lokasi_rak].filter(Boolean).join(' · '));
    tambah('Limit bandwidth', d.bandwidth_mbps > 0 ? fmtBw(d.bandwidth_mbps) : '');
    tambah('PIC', d.pic);
    const sp = (k && k.spesifikasi) || {};
    NP.specFields(d.jenis).forEach(f => {
      if (sp[f.k] === undefined || sp[f.k] === '' || sp[f.k] === 'Tidak') return;
      tambah(...satuan(f.label, sp[f.k]));
    });
    ((TYPES[d.jenis] || TYPES.lainnya).fields || []).forEach(f => {
      if (f.secret || f.type === 'password' || BUKAN_SPEK.includes(f.k) || !a[f.k]) return;
      tambah(...satuan(f.label, a[f.k]));
    });
    return out.slice(0, 20);
  }

  /** Kotak gambar (contain) di dalam area x, y, w, h sesuai rasio foto. */
  function pasKotak(fw, fh, x, y, w, h) {
    const r = fw && fh ? fw / fh : 4 / 3;
    let iw = w, ih = w / r;
    if (ih > h) { ih = h; iw = h * r; }
    return { x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih };
  }

  /**
   * Laporan foto per titik dalam PowerPoint (16:9): sampul + ringkasan, tabel semua titik (status, foto, pengecekan),
   * lalu satu slide per titik berfoto berisi 1–3 foto bercap, keterangan tiap foto, potongan denah lokasi, dan data
   * titik (alat, uplink & port, IP/VLAN, posisi pasang, hasil pengecekan).
   */
  async function unduhPptFoto() {
    const m = S.model;
    const p = S.proyek;
    // Laporan gabungan beberapa layer: urut per layer lalu jenis; tiap bagian diberi tanda layer.
    const colsLp = kolomLapisan(true);
    const idxLp = id => m.lapisanList().findIndex(l => l.id === id);
    const semua = NP.Model.sortDev(m.list.filter(d => !NP.isListrik(d)));
    if (colsLp.length) semua.sort((a, b) => idxLp(m.lapisanOf(a)) - idxLp(m.lapisanOf(b)));
    const Lof = d => m.lapisanById(m.lapisanOf(d));
    const ada = semua.filter(d => fotoOf(d.id).length);
    if (!ada.length) return toast('Belum ada foto bukti untuk dibuat PowerPoint', true);
    const btn = $('#btn-foto-pptx');
    if (btn) btn.disabled = true;
    // Progress: pustaka 0–5%, denah 5–15%, ringkasan 15–20%, penempatan 20–40%, foto per titik 40–94%, simpan file.
    dlgPrint.close();
    progres.buka('Membuat PowerPoint', 'Memuat pustaka PowerPoint…');
    try {
      await muatSkrip('vendor/pptxgenjs.bundle.js?v=3.12.0');
      // Gambar denah per lantai yang berisi perangkat (penempatan & potongan denah titik berfoto).
      const denahImgs = new Map();
      const lidDenah = [...new Set(semua.map(d => m.lantaiOf(d)))];
      for (const [i, lid] of lidDenah.entries()) {
        progres.set(5 + 10 * i / lidDenah.length, 'Memuat gambar denah…');
        const du = denahUrl(lid);
        if (!du) continue;
        const im = new Image();
        im.src = await keDataUrl(du);
        if (await im.decode().then(() => true, () => false)) denahImgs.set(lid, im);
      }
      progres.set(15, 'Menyusun sampul & ringkasan…');
      await progres.jeda();
      const ppt = new window.PptxGenJS();
      ppt.layout = 'LAYOUT_WIDE'; // 13,33 × 7,5 in
      ppt.title = `Laporan pemasangan perangkat — ${p.nama}`;
      ppt.company = 'Net Plan';
      const F = 'Calibri';
      const GELAP = '1F2937', ABU = '64748B', GARIS = 'CBD5E1';
      const tgl = p.tanggal_mulai ? fmtDate(p.tanggal_mulai) + (p.tanggal_selesai && p.tanggal_selesai !== p.tanggal_mulai ? ' – ' + fmtDate(p.tanggal_selesai) : '') : '';
      const uplink = d => {
        const up = m.parentOf(d);
        return up ? `${up.nama}${d.port_uplink ? ' port ' + d.port_uplink : ''}` : '—';
      };
      // Tarikan LAN = kabel UTP titik ini ke uplink-nya (+ kabel UTP sambungan tambahan), tanpa kabel WAN ke ISP: [{ke, port, m}].
      // Laporan hanya berisi jumlah perangkat & tarikan LAN (tanpa status pemasangan, progres foto, pengecekan).
      const lanOf = d => {
        const out = [];
        const up = m.parentOf(d);
        if (up && up.jenis !== 'isp' && (d.media || 'utp') === 'utp' && NP.perluKabel(d)) out.push({ ke: up, port: d.port_uplink, m: m.kabelM(d) });
        m.linkLain(d).filter(w => w.media === 'utp' && w.dev.jenis !== 'isp').forEach(w => out.push({ ke: w.dev, port: w.port, m: m.kabelWanM(d, w.dev) }));
        return out;
      };
      const rekap = ds => {
        const lan = ds.flatMap(lanOf);
        return { n: ds.length, lan: lan.length, m: lan.reduce((t, x) => t + (x.m || 0), 0), tanpaM: lan.filter(x => x.m == null).length };
      };
      const fmtLanM = r => (r.lan ? `≈ ${fmtM(r.m)}${r.tanpaM ? ` (+${r.tanpaM} belum terukur)` : ''}` : '—');
      // Opsi dialog Cetak: panjang kabel (meter) ikut ditampilkan atau tidak (bawaan: tidak, hanya jumlah).
      const pakaiM = !!(formPrint.elements.panjang_kabel && formPrint.elements.panjang_kabel.checked);
      const tambahM = r => (pakaiM && r.lan ? ' · ' + fmtLanM(r) : '');
      const kaki = (s, teks) => s.addText(teks, { x: 0.4, y: 7.05, w: 12.5, h: 0.3, fontFace: F, fontSize: 9, color: ABU });

      // 1. Sampul + ringkasan angka.
      const s1 = ppt.addSlide();
      s1.background = { color: '0F172A' };
      s1.addText('LAPORAN PEMASANGAN PERANGKAT', { x: 0.7, y: 1.1, w: 12, h: 0.5, fontFace: F, fontSize: 16, bold: true, color: '93C5FD', charSpacing: 2 });
      s1.addText(p.nama, { x: 0.7, y: 1.6, w: 12, h: 1.2, fontFace: F, fontSize: 40, bold: true, color: 'FFFFFF', fit: 'shrink' });
      s1.addText([p.venue, tgl, S.labelLapisan ? 'Layer ' + S.labelLapisan : ''].filter(Boolean).join(' · ') || ' ', { x: 0.7, y: 2.8, w: 12, h: 0.5, fontFace: F, fontSize: 18, color: 'CBD5E1' });
      const tot = rekap(semua);
      const kartu = [['Total perangkat', String(tot.n)], ['Tarikan LAN', String(tot.lan)], ...(pakaiM ? [['Panjang kabel LAN', tot.lan ? '≈ ' + fmtM(tot.m) : '—']] : [])];
      const kw = (11.95 - 0.2 * (kartu.length - 1)) / kartu.length;
      kartu.forEach(([l, n], i) => {
        const x = 0.7 + i * (kw + 0.2);
        s1.addShape(ppt.ShapeType.roundRect, { x, y: 4.1, w: kw, h: 1.35, fill: { color: '1E293B' }, line: { color: '334155' }, rectRadius: 0.08 });
        s1.addText(n, { x, y: 4.2, w: kw, h: 0.75, align: 'center', fontFace: F, fontSize: 30, bold: true, color: 'FFFFFF', fit: 'shrink' });
        s1.addText(l, { x, y: 4.95, w: kw, h: 0.4, align: 'center', fontFace: F, fontSize: 12, color: '94A3B8' });
      });
      // Gabungan beberapa layer: angka per layer di bawah kartu ringkasan.
      if (colsLp.length) {
        s1.addText(colsLp.map(L => {
          const r = rekap(semua.filter(d => m.lapisanOf(d) === L.id));
          return [{ text: '● ', options: { color: L.warna.slice(1), fontSize: 16 } },
            { text: `${L.nama}  `, options: { bold: true, color: 'FFFFFF' } },
            { text: `${r.n} perangkat · ${r.lan} tarikan LAN${tambahM(r)}`, options: { color: '94A3B8', breakLine: true } }];
        }).flat(), { x: 0.7, y: 5.65, w: 12, h: 0.95, fontFace: F, fontSize: 13, valign: 'top' });
      }
      s1.addText(`Dibuat ${new Date().toLocaleString('id-ID')} · Net Plan`, { x: 0.7, y: 6.7, w: 12, h: 0.35, fontFace: F, fontSize: 10, color: '64748B' });

      // 2. Ringkasan per jenis perangkat: rekap angka per jenis, lalu satu slide daftar titik per jenis
      //    (berlanjut otomatis ke slide berikutnya bila panjang). Urutan jenis mengikuti TYPE_ORDER.
      //    Gabungan beberapa layer: kelompok = layer + jenis (mis. "EXPO LINE · Switch").
      const grup = (colsLp.length ? colsLp : [null]).flatMap(L => TYPE_ORDER.map(j => ({
        j, L, ds: semua.filter(d => d.jenis === j && (!L || m.lapisanOf(d) === L.id)),
      }))).filter(g => g.ds.length);
      const sel = (t, o) => ({ text: String(t), options: o || {} });
      const th = t => sel(t, { bold: true, fill: { color: 'E2E8F0' }, color: GELAP });
      const angka = (n, warna) => sel(n, { align: 'center', bold: !!n, color: n ? warna : ABU });
      const s2 = ppt.addSlide();
      s2.addText(colsLp.length ? 'Ringkasan per layer & jenis perangkat' : 'Ringkasan per jenis perangkat', { x: 0.4, y: 0.3, w: 12.5, h: 0.6, fontFace: F, fontSize: 24, bold: true, color: GELAP });
      const barisRekap = r => [angka(r.n, GELAP), angka(r.lan, '0369A1'), ...(pakaiM ? [sel(fmtLanM(r), { align: 'center', color: r.lan ? GELAP : ABU })] : [])];
      // Gabungan beberapa layer: baris judul per layer (rekap layer, berwarna) lalu jenis-jenis di layer itu.
      const barisJenis = colsLp.length
        ? colsLp.flatMap(L => {
          const gs = grup.filter(g => g.L === L);
          if (!gs.length) return [];
          const isi = { fill: { color: 'F8FAFC' }, bold: true };
          const judul = [sel(`● Layer ${L.nama}`, Object.assign({ color: L.warna.slice(1) }, isi)), ...barisRekap(rekap(gs.flatMap(g => g.ds))).map(c => ({ text: c.text, options: Object.assign({}, c.options, isi) }))];
          return [judul, ...gs.map(g => [sel('    ' + (TYPES[g.j] || TYPES.lainnya).label, { color: GELAP }), ...barisRekap(rekap(g.ds))])];
        })
        : grup.map(g => [sel((TYPES[g.j] || TYPES.lainnya).label, { bold: true, color: GELAP }), ...barisRekap(rekap(g.ds))]);
      s2.addTable([['Jenis perangkat', 'Jumlah perangkat', 'Tarikan LAN', ...(pakaiM ? ['Panjang kabel LAN'] : [])].map(th)]
        .concat(barisJenis)
        .concat([[sel('Total', { bold: true, fill: { color: 'F1F5F9' } }), ...barisRekap(tot).map(c => ({ text: c.text, options: Object.assign({}, c.options, { fill: { color: 'F1F5F9' }, bold: true }) }))]]), {
        x: 0.4, y: 1.0, w: 12.5, colW: pakaiM ? [4.7, 2.4, 2.4, 3.0] : [6.5, 3.0, 3.0], fontFace: F, fontSize: 12, color: '334155', rowH: 0.4, valign: 'middle',
        border: { type: 'solid', pt: 0.5, color: GARIS }, autoPage: true, autoPageRepeatHeader: true, newSlideStartY: 0.5,
      });
      // Daftar titik per jenis: tiap jenis jadi satu bagian (garis warna + nama jenis + angka + tabel). Jenis besar
      // dipecah rata maks. 19 baris (mis. 22 → 11 + 11, berjudul "Switch (1/2)"); bagian kecil digabung dalam satu
      // slide selama muat (tinggi area 1,0–7,0 in), agar jenis berisi 1–2 titik tidak menghabiskan satu slide.
      const PER = 19, BARIS = 0.27, KEPALA = 0.5, JARAK = 0.2, BATAS = 6.0;
      const bagian = [];
      for (const g of grup) {
        const hal = Math.ceil(g.ds.length / PER);
        const per = Math.ceil(g.ds.length / hal);
        for (let h = 0; h < hal; h++) bagian.push({ g, ds: g.ds.slice(h * per, (h + 1) * per), ke: h + 1, dari: hal });
      }
      const tinggiBagian = b => KEPALA + BARIS * (b.ds.length + 1) + JARAK;
      const halaman = [];
      bagian.forEach(b => {
        const akhir = halaman[halaman.length - 1];
        if (akhir && akhir.pakai + tinggiBagian(b) <= BATAS) {
          akhir.isi.push(b);
          akhir.pakai += tinggiBagian(b);
        } else halaman.push({ isi: [b], pakai: tinggiBagian(b) });
      });
      halaman.forEach(hl => {
        const sg = ppt.addSlide();
        let y = 0.45;
        hl.isi.forEach(b => {
          const T = TYPES[b.g.j] || TYPES.lainnya;
          const r = rekap(b.g.ds);
          sg.addShape(ppt.ShapeType.rect, { x: 0.4, y: y + 0.06, w: 0.1, h: 0.34, fill: { color: (b.g.L ? b.g.L.warna : T.color).slice(1) }, line: { type: 'none' } });
          sg.addText([...(b.g.L ? [{ text: b.g.L.nama + ' · ', options: { color: b.g.L.warna.slice(1) } }] : []), { text: T.label + (b.dari > 1 ? ` (${b.ke}/${b.dari})` : '') }],
            { x: 0.58, y, w: 7, h: 0.46, fontFace: F, fontSize: 18, bold: true, color: GELAP, valign: 'middle', fit: 'shrink' });
          sg.addText(`${r.n} perangkat · ${r.lan} tarikan LAN${tambahM(r)}`,
            { x: 6.0, y, w: 6.9, h: 0.46, align: 'right', fontFace: F, fontSize: 11, color: ABU, valign: 'middle' });
          const rows = [['Titik', b.g.j === 'endpoint' ? 'Tipe' : 'Alat', 'Uplink / port', 'Media', 'Tarikan LAN'].map(th)].concat(b.ds.map(d => {
            const kt = m.kat(d);
            const r = rekap([d]);
            return [sel(d.nama, { bold: true }), b.g.j === 'endpoint' ? jenisLabel(d).replace(/^[^·]*·\s*/, '') : (kt ? [kt.merek, kt.model].filter(Boolean).join(' ') : d.model) || '—',
              uplink(d), d.media && MEDIA[d.media] ? MEDIA[d.media].short || '—' : '—',
              sel(!r.lan ? '—' : pakaiM ? (r.lan > 1 ? r.lan + ' kabel · ' : '') + fmtLanM(r) : r.lan + ' kabel', { color: r.lan ? GELAP : ABU })];
          }));
          sg.addTable(rows, {
            x: 0.4, y: y + KEPALA, w: 12.5, colW: [2.4, 3.2, 3.2, 1.0, 2.7], rowH: BARIS, fontFace: F, fontSize: 10, color: '334155',
            border: { type: 'solid', pt: 0.5, color: GARIS }, margin: [0.02, 0.08, 0.02, 0.08],
          });
          y += tinggiBagian(b);
        });
      });

      // 3. Penempatan perangkat di denah (pudar 20%): semua perangkat jaringan (seluruh denah), lalu per kelompok jenis
      //    (zoom ke area perangkatnya); per lantai.
      const jar = semua.filter(d => !NP.nonJaringan(d));
      const KELOMPOK = [
        { nama: 'Semua perangkat jaringan', cocok: () => true },
        { nama: 'Router & Sumber WAN', cocok: d => d.jenis === 'router' || d.jenis === 'isp' },
        { nama: 'Switch', cocok: d => d.jenis === 'switch' },
        { nama: 'Access Point', cocok: d => d.jenis === 'ap' || d.jenis === 'bridge' },
        { nama: 'Endpoint (laptop, EDC, printer, …)', cocok: d => d.jenis === 'endpoint' },
        { nama: 'Perangkat lain (titik LAN, server, CCTV, …)', cocok: d => !['router', 'isp', 'switch', 'ap', 'bridge', 'endpoint'].includes(d.jenis) },
      ];
      const lantaiPakai = m.lantaiList().filter(L => jar.some(d => m.lantaiOf(d) === L.id));
      const warnaLp = colsLp.length ? d => Lof(d).warna : null;
      const nPen = KELOMPOK.length * lantaiPakai.length;
      let iPen = 0;
      for (const kel of KELOMPOK) {
        for (const L of lantaiPakai) {
          progres.set(20 + 20 * iPen++ / nPen, `Penempatan ${kel.nama}${lantaiPakai.length > 1 ? ' · ' + L.nama : ''}…`);
          const ds = jar.filter(d => kel.cocok(d) && m.lantaiOf(d) === L.id);
          if (!ds.length || (kel !== KELOMPOK[0] && ds.length === jar.filter(d => m.lantaiOf(d) === L.id).length)) continue; // kelompok = semua: tidak diulang
          await progres.jeda();
          // Slide gabungan: nama endpoint tidak ditulis (booth padat); namanya ada di slide Endpoint.
          const pt = petaPenempatan(denahImgs.get(L.id) || null, L.id, ds, warnaLp, kel === KELOMPOK[0] ? d => d.jenis === 'endpoint' : null, kel !== KELOMPOK[0]);
          const s = ppt.addSlide();
          s.addText([{ text: 'Penempatan ' + kel.nama, options: { bold: true } }, ...(lantaiPakai.length > 1 ? [{ text: ' · ' + L.nama, options: { color: '7C3AED' } }] : [])],
            { x: 0.4, y: 0.2, w: 9.2, h: 0.55, fontFace: F, fontSize: 22, color: GELAP, valign: 'middle', fit: 'shrink' });
          // Rincian jumlah per jenis di kanan judul.
          const perJenis = TYPE_ORDER.map(j => [j, ds.filter(d => d.jenis === j).length]).filter(x => x[1]);
          s.addText(perJenis.map(([j, n]) => `${j === 'lainnya' ? 'Lain' : (TYPES[j] || TYPES.lainnya).short} ${n}`).join(' · ') + ` · total ${ds.length}`,
            { x: 9.6, y: 0.2, w: 3.3, h: 0.55, align: 'right', fontFace: F, fontSize: 11, color: ABU, valign: 'middle', fit: 'shrink' });
          const kotak = pasKotak(pt.w, pt.h, 0.4, 0.85, 12.5, colsLp.length ? 5.85 : 6.1);
          s.addImage({ data: pt.data, ...kotak, line: { color: GARIS } });
          if (colsLp.length) {
            s.addText(colsLp.map(Lp => [{ text: '● ', options: { color: Lp.warna.slice(1) } }, { text: Lp.nama + '    ', options: { color: '334155' } }]).flat(),
              { x: 0.4, y: 6.72, w: 12.5, h: 0.3, fontFace: F, fontSize: 10 });
          }
          kaki(s, `${p.nama} · Penempatan perangkat`);
        }
      }

      // 4. Satu slide per titik berfoto.
      for (let k = 0; k < ada.length; k++) {
        const d = ada[k];
        progres.set(40 + 54 * k / ada.length, `Slide foto ${k + 1} dari ${ada.length} · ${d.nama}`);
        const fs = fotoOf(d.id);
        // Gabungan beberapa layer: slide pembatas di awal tiap layer.
        if (colsLp.length && (k === 0 || m.lapisanOf(ada[k - 1]) !== m.lapisanOf(d))) {
          const L = Lof(d);
          const rL = rekap(semua.filter(x => m.lapisanOf(x) === L.id));
          const sp = ppt.addSlide();
          sp.background = { color: '0F172A' };
          sp.addShape(ppt.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: L.warna.slice(1) }, line: { type: 'none' } });
          sp.addText('LAYER JARINGAN', { x: 0.9, y: 2.3, w: 11.5, h: 0.5, fontFace: F, fontSize: 16, bold: true, color: '93C5FD', charSpacing: 2 });
          sp.addText(L.nama, { x: 0.9, y: 2.8, w: 11.5, h: 1.2, fontFace: F, fontSize: 40, bold: true, color: 'FFFFFF', fit: 'shrink' });
          sp.addText(`${rL.n} perangkat · ${rL.lan} tarikan LAN${tambahM(rL)}`,
            { x: 0.9, y: 4.0, w: 11.5, h: 0.5, fontFace: F, fontSize: 16, color: 'CBD5E1' });
        }
        const s = ppt.addSlide();
        s.addShape(ppt.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.95, fill: { color: GELAP } });
        if (colsLp.length) s.addShape(ppt.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 0.95, fill: { color: Lof(d).warna.slice(1) }, line: { type: 'none' } });
        s.addText([{ text: d.nama, options: { bold: true, fontSize: 24, color: 'FFFFFF' } },
          { text: `   ${jenisLabel(d)}${d.model ? ' · ' + d.model : ''}${!S.labelLapisan && m.lapisanList().length > 1 ? ' · Layer ' + m.lapisanById(m.lapisanOf(d)).nama : ''}`, options: { fontSize: 14, color: 'CBD5E1' } }],
        { x: 0.4, y: 0.12, w: 9.6, h: 0.7, fontFace: F, valign: 'middle' });

        // Spesifikasi & data titik: alat (katalog), spesifikasi katalog, isian jenis (tanpa password / setelan jaringan
        // router), lalu uplink, IP, posisi pasang, PIC. Disusun dua pasang kolom di bawah foto.
        const spek = specPpt(d);
        const barisSpek = Math.ceil(spek.length / 2);
        const tinggiSpek = spek.length ? 0.34 + barisSpek * 0.26 : 0;
        // Foto (kiri, 9,3 in): 1 besar / 2 berdampingan / 3 kolom; keterangan di bawah tiap foto.
        const lebar = 9.3, gap = 0.2, n = fs.length;
        const bw = (lebar - gap * (n - 1)) / n;
        // Tinggi area foto mengikuti rasio foto paling tinggi (tanpa ruang kosong), dibatasi agar tabel spesifikasi muat.
        const bhMaks = 6.95 - 1.15 - 0.62 - (tinggiSpek ? tinggiSpek + 0.1 : 0);
        const bh = Math.max(1.6, Math.min(bhMaks, n === 1 ? 5.2 : n === 2 ? 4.9 : 4.6, Math.max(...fs.map(f => (f.w && f.h ? bw * f.h / f.w : bw * 0.75)))));
        for (let i = 0; i < n; i++) {
          const f = fs[i];
          const bx = 0.4 + i * (bw + gap);
          const kotak = pasKotak(f.w, f.h, bx, 1.15, bw, bh);
          s.addShape(ppt.ShapeType.rect, { x: bx, y: 1.15, w: bw, h: bh, fill: { color: 'F1F5F9' }, line: { color: 'E2E8F0' } });
          s.addImage({ data: await keDataUrl(fotoUrl(f)), ...kotak });
          s.addText([
            { text: `Foto ${i + 1}`, options: { bold: true } },
            { text: ` · ${(f.diambil_at || '').slice(0, 16)}${f.oleh ? ' · ' + f.oleh : ''}`, options: { breakLine: true } },
            f.lat != null
              ? { text: `📍 ${koordinat(f)}${f.akurasi_m != null ? ` (±${Math.round(f.akurasi_m)} m)` : ''}`, options: { hyperlink: { url: petaUrl(f) }, color: '2563EB' } }
              : { text: '📍 tanpa koordinat', options: { color: 'B91C1C' } },
          ], { x: bx, y: 1.2 + bh, w: bw, h: 0.55, fontFace: F, fontSize: 10, color: '334155', valign: 'top' });
        }
        if (spek.length) {
          const ty = 1.15 + bh + 0.62 + 0.1;
          s.addText('Spesifikasi & data titik', { x: 0.4, y: ty, w: 9.3, h: 0.28, fontFace: F, fontSize: 11, bold: true, color: GELAP });
          const sel = (x, label) => ({ text: x || '', options: label ? { color: ABU } : { bold: true, color: GELAP } });
          const baris = [];
          for (let r = 0; r < barisSpek; r++) {
            const A1 = spek[r], B1 = spek[r + barisSpek];
            baris.push([sel(A1[0], true), sel(A1[1]), sel(B1 ? B1[0] : '', true), sel(B1 ? B1[1] : '')]);
          }
          s.addTable(baris, {
            x: 0.4, y: ty + 0.3, w: 9.3, colW: [1.55, 3.05, 1.55, 3.15], rowH: 0.26, fontFace: F, fontSize: 9.5, margin: [0.02, 0.06, 0.02, 0.06],
            border: { type: 'solid', pt: 0.5, color: 'E2E8F0' }, fill: { color: 'FFFFFF' },
          });
        }
        // Kolom kanan: lokasi di denah + tarikan LAN titik ini.
        const rx = 9.95, rw = 3.0;
        let ry = 1.15;
        const denahImg = denahImgs.get(m.lantaiOf(d));
        if (denahImg) {
          s.addText(multiLantai() ? `Lokasi di denah · ${namaLantai(d)}` : 'Lokasi di denah', { x: rx, y: ry, w: rw, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: GELAP });
          const [, , cw, ch] = cropAround(d, 0.5);
          const kotak = pasKotak(cw, ch, rx, ry + 0.32, rw, 2.3);
          s.addImage({ data: potonganDenah(denahImg, d), ...kotak, line: { color: GARIS } });
          ry += 0.32 + kotak.h + 0.25;
        }
        const lan = lanOf(d);
        const lh = Math.min(6.85 - ry, 0.5 + Math.max(1, lan.length) * 0.42);
        s.addShape(ppt.ShapeType.roundRect, { x: rx, y: ry, w: rw, h: lh, fill: { color: 'F0F9FF' }, line: { color: lan.length ? '0369A1' : GARIS }, rectRadius: 0.06 });
        s.addText([
          { text: 'Tarikan LAN', options: { fontSize: 9, color: ABU, breakLine: true } },
          ...(lan.length ? lan.map((x, i) => ({ text: `${x.ke.nama}${x.port ? ' port ' + x.port : ''}${pakaiM && x.m != null ? '  ≈ ' + fmtM(x.m) : ''}`, options: { bold: true, fontSize: 12, color: '0369A1', breakLine: i < lan.length - 1 } }))
            : [{ text: m.parentOf(d) ? `${MEDIA[d.media] ? MEDIA[d.media].label : d.media} ke ${m.parentOf(d).nama}` : 'Tanpa kabel LAN', options: { fontSize: 12, color: ABU } }]),
        ], { x: rx + 0.08, y: ry + 0.04, w: rw - 0.16, h: lh - 0.08, fontFace: F, valign: 'top', fit: 'shrink' });
        kaki(s, `${p.nama}${colsLp.length ? ' · Layer ' + Lof(d).nama : ''} · Titik ${k + 1}/${ada.length}`);
      }

      const nama = `laporan-pemasangan-${slug(p.nama)}.pptx`;
      progres.set(95, 'Menyimpan file PowerPoint…');
      await progres.jeda();
      await ppt.writeFile({ fileName: nama });
      progres.set(100, 'Selesai');
      progres.tutup();
      toast(`${nama} diunduh — ${tot.n} perangkat, ${tot.lan} tarikan LAN, ${ada.length} titik berfoto`);
    } catch (e) {
      progres.tutup();
      toast(e.message || 'PowerPoint gagal dibuat', true);
    } finally {
      progres.tutup();
      if (btn) btn.disabled = false;
    }
  }

  // ------------------------------------------------------------------------ laporan penggunaan port switch / router

  /** Kategori sambungan di port (warna kotak port & kolom rekap). */
  const KAT_PORT = {
    uplink: { label: 'Uplink', color: '#1f2937' },
    wan: { label: 'WAN', color: '#e11d48' },
    switch: { label: 'Antar switch', color: '#2563eb' },
    router: { label: 'Router', color: '#7c3aed' },
    ap: { label: 'Access point', color: '#059669' },
    bridge: { label: 'Wireless bridge', color: '#0891b2' },
    lan: { label: 'Titik LAN', color: '#d97706' },
    lan_gedung: { label: 'Port LAN gedung', color: '#92400e' },
    endpoint: { label: 'Endpoint', color: '#ea580c' },
    cctv: { label: 'CCTV', color: '#be185d' },
    server: { label: 'Server', color: '#475569' },
    lainnya: { label: 'Lainnya', color: '#64748b' },
  };
  /** Kategori sambungan x di port perangkat P (x = isi port dari Model.portMap). */
  function katPort(P, x) {
    if (x.peran === 'wan' || (x.peran === 'uplink' && x.dev.jenis === 'isp')) return 'wan';
    if (x.peran === 'uplink' || x.peran === 'up2') return x.dev.jenis === 'switch' && P.jenis === 'switch' ? 'switch' : 'uplink';
    return KAT_PORT[x.dev.jenis] ? x.dev.jenis : 'lainnya';
  }

  /**
   * Data penggunaan port semua switch & router (mengikuti S.model — terfilter layer bila dicetak per layer):
   * [{P, pm, baris:[{port, label, isi, kat, ...}], rekap:{kat: n}, tanpa, lain, masuk}].
   * masuk = switch lain yang memakai P sebagai uplink kedua (port di sisi P tidak tercatat).
   */
  function dataPort() {
    const m = S.model;
    const lp = kolomLapisan(true);
    const idx = d => (lp.length ? lp.findIndex(l => l.id === m.lapisanOf(d)) : 0);
    const alat = NP.Model.sortDev(m.list.filter(d => d.jenis === 'switch' || d.jenis === 'router')).sort((a, b) => idx(a) - idx(b));
    return alat.map(P => {
      const pm = m.portMap(P);
      const nama = pt => (pt.sfp ? pt.label : (pm.prefix || '') + pt.label);
      const baris = pm.ports.map(pt => {
        const x = pt.isi[0];
        if (!x) {
          // Port kosong switch yang sudah diberi VLAN (disiapkan untuk perangkat yang dicolok di lapangan).
          const lk = P.jenis === 'switch' ? m.vlanPortKosong(P, pt.key) : null;
          return { port: nama(pt), kosong: true, vlan: lk && lk.mode === 'access' ? 'A ' + lk.untagged : lk && lk.mode === 'trunk' ? 'T ' + lk.tagged.join(',') : '' };
        }
        const dev = x.dev;
        const kat = katPort(P, x);
        // Kabel & VLAN: sambungan ke anak = kabel anak; ke uplink = kabel P sendiri.
        const kabelDari = x.peran === 'anak' ? dev : x.peran === 'uplink' ? P : null;
        const lv = kabelDari && !NP.nonJaringan(kabelDari) ? m.linkVlan(kabelDari) : null;
        return {
          port: nama(pt), dev, kat, peran: x.peran, otomatis: x.otomatis, dobel: pt.isi.length > 1 ? pt.isi.map(i => i.dev.nama) : null,
          media: kabelDari && kabelDari.media ? MEDIA[kabelDari.media].short : '',
          kabel: kabelDari && NP.perluKabel(kabelDari) ? NP.KABEL[NP.kabelSt(kabelDari)].label : '',
          vlan: lv && lv.mode === 'trunk' ? 'Trunk ' + (lv.tagged.join(',') || '—') : lv && lv.mode === 'access' ? 'Access ' + lv.untagged : '',
          ip: dev.ip || '',
        };
      });
      const rekap = {};
      baris.forEach(b => { if (!b.kosong) rekap[b.kat] = (rekap[b.kat] || 0) + 1; });
      const masuk = m.list.filter(d => d.id !== P.id && m.uplinkLain(d).some(w => w.dev.id === P.id));
      return { P, pm, baris, rekap, tanpa: pm.tanpa, lain: pm.lain, masuk };
    });
  }

  /** Laporan penggunaan port: rekap semua switch/router, lalu per perangkat panel port + tabel port. */
  function cetakLaporanPort() {
    const m = S.model;
    const data = dataPort();
    const lp = kolomLapisan(true);
    const katDipakai = Object.keys(KAT_PORT).filter(k => data.some(x => x.rekap[k]));
    const tr = (cells, th) => `<tr>${cells.map(c => `<${th ? 'th' : 'td'}>${c}</${th ? 'th' : 'td'}>`).join('')}</tr>`;
    const adaVlan = data.some(x => x.baris.some(b => b.vlan));
    const totP = data.reduce((s, x) => s + x.pm.ports.length, 0);
    const totPakai = data.reduce((s, x) => s + x.pm.terpakai, 0);
    const rekapBaris = x => tr([`<b>${esc(x.P.nama)}</b><br><span class="muted">${esc(x.P.model || jenisLabel(x.P))}</span>`,
      x.pm.ports.length ? `${x.pm.eth}${x.pm.sfp ? ' + ' + x.pm.sfp + ' SFP' : ''}` : '<span class="muted">belum diisi</span>',
      x.pm.terpakai, x.pm.ports.length ? x.pm.ports.length - x.pm.terpakai : '—',
      ...katDipakai.map(k => x.rekap[k] || ''), (x.tanpa.length + x.lain.length) || '']);
    let h = prHead('Laporan penggunaan port') +
      `<p>Switch &amp; router: <b>${data.length}</b> · Port tercatat: <b>${totP}</b> · Terpakai: <b>${totPakai}</b> · Kosong: <b>${totP - totPakai}</b>${totP ? ` (${Math.round(totPakai / totP * 100)}% terpakai)` : ''}</p>
      <div class="pr-legend">${katDipakai.map(k => `<span><i style="background:${KAT_PORT[k].color}"></i>${esc(KAT_PORT[k].label)}</span>`).join('')}<span><i style="background:#fff;border:1px solid #94a3b8"></i>Kosong</span></div>
      <h2>Rekap per perangkat</h2>
      <table class="pr-table pr-port-rekap">${tr(['Perangkat', 'Port', 'Terpakai', 'Kosong', ...katDipakai.map(k => esc(KAT_PORT[k].label)), 'Tanpa port / di luar'], true)}${
        lp.length ? lp.map(L => {
          const xs = data.filter(x => m.lapisanOf(x.P) === L.id);
          return xs.length ? `<tr class="pr-grp"><td colspan="${5 + katDipakai.length}" style="border-left:5px solid ${esc(L.warna)}"><b>Layer ${esc(L.nama)}</b> · ${xs.length} perangkat</td></tr>${xs.map(rekapBaris).join('')}` : '';
        }).join('') : data.map(rekapBaris).join('')}</table>`;
    data.forEach(x => {
      const P = x.P;
      const up = m.parentOf(P);
      h += `<section class="pr-port">
        <h3>${esc(P.nama)} <small>${esc(jenisLabel(P))}${P.model ? ' · ' + esc(P.model) : ''}${lapisanLabel(P)}</small></h3>
        <p class="pr-foto-meta">Uplink: <b>${up ? esc(up.nama) + (P.port_uplink ? ' port ' + esc(P.port_uplink) : '') : '—'}</b>${P.ip ? ' · IP ' + esc(P.ip) : ''}${(P.atribut || {}).managed ? ' · ' + esc(P.atribut.managed) : ''}${(P.atribut || {}).poe ? ' · PoE ' + esc(P.atribut.poe) : ''}
          · ${x.pm.ports.length ? `<b>${x.pm.terpakai}</b> dari ${x.pm.ports.length} port terpakai` : 'jumlah port belum diisi'}</p>
        ${x.pm.ports.length ? `<div class="pr-ports">${x.baris.map(b => `<div class="pp${b.kosong ? ' kosong' : ''}${b.dobel ? ' dobel' : ''}" style="${b.kosong ? '' : `--c:${KAT_PORT[b.kat].color}`}">
            <span class="pp-n">${esc(b.port)}</span><span class="pp-d">${b.kosong ? esc(b.vlan || '') : esc(b.dev.nama)}</span></div>`).join('')}</div>` : ''}
        <table class="pr-table">${tr(['Port', 'Terhubung ke', 'Kategori', 'Media · kabel', ...(adaVlan ? ['VLAN'] : []), 'IP'], true)}${x.baris.filter(b => !b.kosong).map(b => tr([
          `<b>${esc(b.port)}</b>`,
          `${esc(b.dev.nama)}${b.peran === 'uplink' ? ' <span class="muted">(uplink)</span>' : b.peran === 'up2' ? ' <span class="muted">(uplink kedua)</span>' : ''}${b.otomatis ? ' <span class="muted">(port otomatis)</span>' : ''}${b.dobel ? `<br><span class="bad">dobel: ${esc(b.dobel.join(', '))}</span>` : ''}`,
          `<span style="color:${KAT_PORT[b.kat].color};font-weight:600">${esc(KAT_PORT[b.kat].label)}</span>${b.kat === 'endpoint' && NP.tipeEp(b.dev) ? ' · ' + esc(NP.tipeEp(b.dev).nama) : ''}`,
          esc([b.media, b.kabel].filter(Boolean).join(' · ')), ...(adaVlan ? [esc(b.vlan)] : []), esc(b.ip)])).join('') || `<tr><td colspan="${adaVlan ? 6 : 5}" class="muted">Belum ada perangkat dengan port tercatat.</td></tr>`}</table>
        ${x.tanpa.length ? `<p class="pr-port-cat"><b>Tersambung tanpa nomor port (${x.tanpa.length}):</b> ${x.tanpa.map(d => esc(d.nama)).join(', ')}</p>` : ''}
        ${x.lain.length ? `<p class="pr-port-cat bad"><b>Port di luar jumlah port:</b> ${x.lain.map(l => `${esc(l.dev.nama)} (${esc(l.teks)})`).join(', ')}</p>` : ''}
        ${x.masuk.length ? `<p class="pr-port-cat"><b>Uplink kedua dari:</b> ${x.masuk.map(d => esc(d.nama)).join(', ')} <span class="muted">(port di ${esc(P.nama)} tidak tercatat)</span></p>` : ''}
      </section>`;
    });
    $('#print').className = 'print';
    $('#print').innerHTML = h;
    printWith('A4 portrait');
  }

  /** CSV penggunaan port: satu baris per port (termasuk port kosong). */
  function csvLaporanPort() {
    const data = dataPort();
    const lp = kolomLapisan(true).length > 0;
    const rows = [[...(lp ? ['Layer'] : []), 'Switch / router', 'Nama alat', 'Port', 'Status port', 'Terhubung ke', 'Jenis perangkat', 'Kategori', 'Peran', 'Media', 'Status kabel', 'VLAN', 'IP']];
    data.forEach(x => {
      const pre = [...(lp ? [S.model.lapisanById(S.model.lapisanOf(x.P)).nama] : []), x.P.nama, x.P.model || ''];
      x.baris.forEach(b => rows.push(b.kosong ? [...pre, b.port, 'Kosong', '', '', '', '', '', '', '', '']
        : [...pre, b.port, b.dobel ? 'Dobel' : 'Terpakai', b.dev.nama, jenisLabel(b.dev), KAT_PORT[b.kat].label,
          b.peran === 'anak' ? 'downlink' : b.peran === 'up2' ? 'uplink kedua' : b.peran, b.media, b.kabel, b.vlan, b.ip]));
      x.tanpa.forEach(d => rows.push([...pre, '', 'Tanpa nomor port', d.nama, jenisLabel(d), '', 'downlink', '', '', '', d.ip || '']));
      x.lain.forEach(l => rows.push([...pre, l.teks, 'Di luar jumlah port', l.dev.nama, jenisLabel(l.dev), '', l.peran, '', '', '', l.dev.ip || '']));
    });
    downloadCsv(rows, `penggunaan-port-${slug(S.proyek.nama)}.csv`);
  }
  // ------------------------------------------------------------------------ halaman Port (rapikan lalu cetak)

  const ptFilter = { q: '', masalah: false };
  /** Masalah port satu perangkat: tanpa nomor port, port dobel, port di luar jumlah port, jumlah port belum diisi. */
  const masalahPort = x => x.tanpa.length + x.lain.length + x.baris.filter(b => b.dobel).length + (x.pm.ports.length ? 0 : 1);

  /**
   * Halaman penggunaan port: isi sama dengan laporan cetak, tetapi bisa dirapikan langsung — nomor port tiap
   * perangkat, perangkat tanpa nomor port (pilih / isi otomatis), port dobel & di luar jumlah, jumlah port switch.
   * Setelah benar: Cetak / PDF atau CSV (mengikuti layer aktif).
   */
  function renderPortPage() {
    const box = $('#port-pane');
    if (!box || !S.model) return;
    const m = S.model;
    const edit = S.canEdit;
    const semua = dataPort().filter(x => masukLapisan(x.P));
    const q = ptFilter.q.trim().toLowerCase();
    const data = semua.filter(x => (!ptFilter.masalah || masalahPort(x)) &&
      (!q || [x.P.nama, x.P.model, ...x.baris.filter(b => !b.kosong).map(b => b.dev.nama), ...x.tanpa.map(d => d.nama)].join(' ').toLowerCase().includes(q)));
    const totP = semua.reduce((s, x) => s + x.pm.ports.length, 0);
    const totPakai = semua.reduce((s, x) => s + x.pm.terpakai, 0);
    const nTanpa = semua.reduce((s, x) => s + x.tanpa.length, 0);
    const nDobel = semua.reduce((s, x) => s + x.baris.filter(b => b.dobel).length + x.lain.length, 0);
    const nBelum = semua.filter(x => !x.pm.ports.length).length;
    const katDipakai = Object.keys(KAT_PORT).filter(k => semua.some(x => x.rekap[k]));
    const lpNama = multiLapisan() && S.lapisan !== 'semua' ? ' · layer ' + esc(m.lapisanById(S.lapisan).nama) : '';
    const tile = (n, l, cls) => `<div class="sp-tile${cls && n ? ' ' + cls : ''}"><b>${n}</b><span>${l}</span></div>`;
    const chipDev = d => `<a href="#" class="dev-link" data-sel="${d.id}"><i style="background:${NP.tampil(d).color}">${esc(NP.tampil(d).short)}</i>${esc(d.nama)}</a>`;
    // Pilihan port: port kosong perangkat P + nilai sekarang (agar bisa dipertahankan / dikosongkan).
    const pilihPort = (P, sekarang, attrs) => {
      const kosong = portKosong2(P);
      const opsi = [...new Set([sekarang, ...kosong].filter(Boolean))];
      return `<select class="pt-sel" ${attrs}${edit ? '' : ' disabled'}><option value="">${sekarang ? '— kosongkan' : 'pilih port…'}</option>${opsi.map(o => `<option value="${esc(o)}"${o === sekarang ? ' selected' : ''}>${esc(o)}${o === sekarang ? '' : ' (kosong)'}</option>`).join('')}</select>`;
    };
    const kartu = x => {
      const P = x.P;
      const up = m.parentOf(P);
      const nM = masalahPort(x);
      const adaVlan = x.baris.some(b => b.vlan);
      return `<section class="card pt-card${nM ? ' pt-masalah' : ''}" id="pt-${P.id}">
        <div class="pt-h">
          <div class="pt-judul"><h2>${esc(P.nama)} <small>${esc(jenisLabel(P))}${P.model ? ' · ' + esc(P.model) : ''}</small>${lapisanChip(P)}${lantaiChip(P)}</h2>
            <p class="muted small">Uplink: <b>${up ? esc(up.nama) + (P.port_uplink ? ' port ' + esc(P.port_uplink) : '') : '—'}</b>${P.ip ? ' · IP ' + esc(P.ip) : ''}${(P.atribut || {}).managed ? ' · ' + esc(P.atribut.managed) : ''}
              · ${x.pm.ports.length ? `<b>${x.pm.terpakai}</b> dari ${x.pm.ports.length} port terpakai` : '<span class="bad">jumlah port belum diisi</span>'}</p></div>
          <div class="pt-aksi">
            <label class="field pt-jml"><span>Jumlah port</span><input type="number" min="0" max="96" value="${x.pm.eth || ''}" placeholder="mis. 8" data-pt-jml="${P.id}"${edit ? '' : ' disabled'}></label>
            <button type="button" class="small ghost" data-pt-denah="${P.id}" title="Pilih ${esc(P.nama)} di denah">Lihat di denah</button>
          </div>
        </div>
        ${x.pm.ports.length ? `<div class="pt-ports">${x.baris.map(b => `<button type="button" class="pp${b.kosong ? ' kosong' : ''}${b.dobel ? ' dobel' : ''}"${b.kosong ? '' : ` style="--c:${KAT_PORT[b.kat].color}" data-sel="${b.dev.id}"`}
            title="${esc(b.port)}: ${b.kosong ? 'kosong' : esc((b.dobel || [b.dev.nama]).join(', ')) + ' · ' + esc(KAT_PORT[b.kat].label)}"><span class="pp-n">${esc(b.port)}</span><span class="pp-d">${b.kosong ? esc(b.vlan || '') : esc(b.dev.nama)}</span></button>`).join('')}</div>` : ''}
        ${x.baris.some(b => !b.kosong) ? `<div class="pt-tbl-wrap"><table class="mini pt-tbl"><tr><th>Port</th><th>Terhubung ke</th><th>Kategori</th><th>Media · kabel</th>${adaVlan ? '<th>VLAN</th>' : ''}<th>IP</th></tr>
          ${x.baris.filter(b => !b.kosong).map(b => {
            // Port bisa diubah: sambungan ke anak (port di uplink anak) & ke uplink P sendiri (port lokal P).
            const ubah = b.peran === 'anak' ? pilihPort(P, b.port, `data-pt-anak="${b.dev.id}"`)
              : b.peran === 'uplink' && P.jenis !== 'router' ? pilihPort(P, b.port, `data-pt-lokal="${P.id}"`) : `<b>${esc(b.port)}</b>`;
            return `<tr class="${b.dobel ? 'bad-row' : ''}"><td>${ubah}</td>
              <td>${chipDev(b.dev)}${b.peran === 'uplink' ? ' <span class="muted small">(uplink)</span>' : b.peran === 'up2' ? ' <span class="muted small">(uplink kedua)</span>' : b.peran === 'wan' ? ' <span class="muted small">(WAN tambahan)</span>' : ''}${b.otomatis ? ' <span class="muted small">(port otomatis)</span>' : ''}${b.dobel ? `<br><span class="bad small">dobel: ${esc(b.dobel.join(', '))}</span>` : ''}</td>
              <td><span class="pt-kat" style="--c:${KAT_PORT[b.kat].color}">${esc(KAT_PORT[b.kat].label)}</span>${b.kat === 'endpoint' && NP.tipeEp(b.dev) ? ' <span class="muted small">' + esc(NP.tipeEp(b.dev).nama) + '</span>' : ''}</td>
              <td>${esc([b.media, b.kabel].filter(Boolean).join(' · '))}</td>${adaVlan ? `<td>${esc(b.vlan)}</td>` : ''}<td class="mono">${esc(b.ip)}</td></tr>`;
          }).join('')}</table></div>` : '<p class="muted small">Belum ada perangkat dengan nomor port tercatat.</p>'}
        ${x.tanpa.length ? `<div class="pt-perlu"><div class="pt-perlu-h"><b>Tersambung tanpa nomor port (${x.tanpa.length})</b>
            ${edit && x.pm.ports.length ? `<button type="button" class="small primary" data-pt-oto="${P.id}"${portKosong2(P).length < x.tanpa.length ? ' disabled title="Port kosong tidak cukup"' : ''}>Isi otomatis berurutan</button>` : ''}</div>
          <div class="pt-perlu-list">${x.tanpa.map(d => `<label class="pt-row">${chipDev(d)}${x.pm.ports.length ? pilihPort(P, '', `data-pt-anak="${d.id}"`) : '<span class="muted small">isi jumlah port dulu</span>'}</label>`).join('')}</div></div>` : ''}
        ${x.lain.length ? `<div class="pt-perlu bad-box"><b>Port di luar jumlah port (${x.lain.length})</b><div class="pt-perlu-list">${x.lain.map(l => `<label class="pt-row">${chipDev(l.dev)} <span class="mono">${esc(l.teks)}</span>
            ${l.peran === 'anak' ? pilihPort(P, '', `data-pt-anak="${l.dev.id}"`) : ''}</label>`).join('')}</div></div>` : ''}
        ${x.masuk.length ? `<p class="muted small">Uplink kedua dari: ${x.masuk.map(chipDev).join(' ')} (port di ${esc(P.nama)} tidak tercatat)</p>` : ''}
      </section>`;
    };
    box.innerHTML = `<div class="sp-head"><div><h1>Penggunaan port</h1>
        <p class="muted">Rapikan nomor port switch &amp; router di sini, lalu cetak / simpan PDF${lpNama}.</p></div>
        <div class="btn-row"><button type="button" class="primary" data-pt-cetak>🖨 Cetak / PDF</button><button type="button" data-pt-csv>Unduh CSV</button></div></div>
      <div class="sp-tiles">${tile(semua.length, 'Switch &amp; router')}${tile(totP, 'Port tercatat')}${tile(totPakai, `Terpakai${totP ? ' (' + Math.round(totPakai / totP * 100) + '%)' : ''}`)}${tile(totP - totPakai, 'Kosong')}
        ${tile(nTanpa, 'Tanpa nomor port', 'warn')}${tile(nDobel, 'Port dobel / di luar', 'bad')}${tile(nBelum, 'Jumlah port belum diisi', 'warn')}</div>
      <div class="pt-tools"><input type="search" id="pt-q" placeholder="Cari switch / perangkat…" value="${esc(ptFilter.q)}" aria-label="Cari">
        <label class="check-inline"><input type="checkbox" id="pt-masalah"${ptFilter.masalah ? ' checked' : ''}> Hanya yang perlu dirapikan</label>
        <span class="pt-legend">${katDipakai.map(k => `<span><i style="background:${KAT_PORT[k].color}"></i>${esc(KAT_PORT[k].label)}</span>`).join('')}<span><i class="kosong"></i>Kosong</span></span></div>
      ${semua.length ? `<div class="card"><h2>Rekap</h2><div class="pt-tbl-wrap"><table class="mini pt-rekap"><tr><th>Perangkat</th><th class="num">Port</th><th class="num">Terpakai</th><th class="num">Kosong</th>${katDipakai.map(k => `<th class="num">${esc(KAT_PORT[k].label)}</th>`).join('')}<th class="num">Perlu dirapikan</th></tr>
        ${data.map(x => `<tr data-pt-ke="${x.P.id}" class="pt-klik"><td><b>${esc(x.P.nama)}</b>${lapisanChip(x.P)}${lantaiChip(x.P)}<br><span class="muted small">${esc(x.P.model || jenisLabel(x.P))}</span></td>
          <td class="num">${x.pm.ports.length || '<span class="muted">—</span>'}</td><td class="num">${x.pm.terpakai}</td><td class="num">${x.pm.ports.length ? x.pm.ports.length - x.pm.terpakai : '—'}</td>
          ${katDipakai.map(k => `<td class="num">${x.rekap[k] || ''}</td>`).join('')}<td class="num">${masalahPort(x) ? `<b class="bad">${masalahPort(x)}</b>` : '<span class="ok-text">✓</span>'}</td></tr>`).join('')}</table></div></div>` : ''}
      ${data.length ? data.map(kartu).join('') : `<p class="muted">${semua.length ? 'Tidak ada yang cocok dengan filter.' : 'Belum ada switch / router di event ini.'}</p>`}`;
  }

  $('#port-pane').addEventListener('input', e => {
    if (e.target.id !== 'pt-q') return;
    ptFilter.q = e.target.value;
    clearTimeout(renderPortPage.t);
    renderPortPage.t = setTimeout(() => {
      renderPortPage();
      const q = $('#pt-q');
      if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    }, 250);
  });
  $('#port-pane').addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'pt-masalah') {
      ptFilter.masalah = t.checked;
      return renderPortPage();
    }
    if (!S.canEdit) return;
    if (t.dataset.ptAnak) {
      const d = S.model.byId.get(+t.dataset.ptAnak);
      if (d) await saveDev(d.id, { port_uplink: t.value }).then(() => toast(t.value ? `${d.nama} → port ${t.value}` : `Port ${d.nama} dikosongkan`)).catch(() => {});
    } else if (t.dataset.ptLokal) {
      const P = S.model.byId.get(+t.dataset.ptLokal);
      if (P) await saveDev(P.id, { port_lokal: t.value }).then(() => toast(`Port uplink ${P.nama} → ${t.value || 'kosong'}`)).catch(() => {});
    } else if (t.dataset.ptJml) {
      const P = S.model.byId.get(+t.dataset.ptJml);
      const n = parseInt(t.value, 10);
      if (!P) return;
      const atr = Object.assign({}, P.atribut);
      if (n > 0) atr.jumlah_port = String(Math.min(96, n));
      else delete atr.jumlah_port;
      await saveDev(P.id, { atribut: atr }).then(() => toast(`Jumlah port ${P.nama}: ${n > 0 ? n : 'belum diisi'}`)).catch(() => {});
    }
  });
  $('#port-pane').addEventListener('click', async e => {
    const ke = e.target.closest('[data-pt-ke]');
    if (ke && !e.target.closest('a')) {
      const el = $('#pt-' + ke.dataset.ptKe);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const den = e.target.closest('[data-pt-denah]');
    if (den) {
      const id = +den.dataset.ptDenah;
      go('denah');
      return setTimeout(() => selectDev(id, true), 80);
    }
    if (e.target.closest('[data-pt-cetak]')) return denganLapisan(() => cetakLaporanPort(), S.lapisan);
    if (e.target.closest('[data-pt-csv]')) return denganLapisan(() => csvLaporanPort(), S.lapisan);
    const oto = e.target.closest('[data-pt-oto]');
    if (oto && S.canEdit) {
      const P = S.model.byId.get(+oto.dataset.ptOto);
      const pm = S.model.portMap(P);
      const kosong = portKosong2(P);
      const ds = pm.tanpa.slice(0, kosong.length);
      await kelompok(`isi ${ds.length} port ${P.nama}`, async () => {
        for (let i = 0; i < ds.length; i++) await saveDev(ds[i].id, { port_uplink: kosong[i] }, { keepPanel: true }).catch(() => {});
      });
      toast(`${ds.length} perangkat di ${P.nama} diberi nomor port berurutan (Ctrl+Z untuk membatalkan)`);
      return;
    }
    // Nama perangkat / kotak port: buka perangkat itu di denah.
    const a = e.target.closest('[data-sel]');
    if (!a || e.target.closest('select')) return;
    e.preventDefault();
    const id = +a.dataset.sel;
    S.sel = id;
    go('denah');
    setTimeout(() => selectDev(id, true), 60);
  });


  /** Isi rekap listrik untuk dicetak: ringkasan, per titik listrik, tanpa pemasok, peralatan support. */
  function htmlRekapListrik() {
    const m = S.model;
    const r = dataRekapListrik();
    const tr = (cells, th) => `<tr>${cells.map(c => `<${th ? 'th' : 'td'}>${c}</${th ? 'th' : 'td'}>`).join('')}</tr>`;
    let h = `
      <p>Titik listrik: <b>${r.titik.length}</b> · Total kapasitas: <b>${fmtW(r.kap)}</b> · Terpakai: <b>${fmtW(r.pakai)}</b> · Sisa: <b>${fmtSisa(r.kap - r.pakai)}</b> ·
        Total konsumsi semua perangkat: <b>${fmtW(r.total)}</b> · Perlu tarik listrik: <b>${r.perlu.length}</b> · Belum ada titik pemasok: <b>${r.tanpa.length}</b></p>
      <h2>Per titik listrik</h2>
      <table class="pr-table">${tr(['Titik listrik', 'Sumber / panel', 'MCB', 'Kapasitas', 'Aman 80%', 'Terpakai', 'Sisa', 'Soket', 'Perangkat (daya)'], true)}${r.titik.map(b => {
        const a = b.L.atribut || {};
        return tr([`<b>${esc(b.L.nama)}</b>${lapisanLabel(b.L)}`, esc([a.sumber_listrik, a.lokasi_panel].filter(Boolean).join(' · ')),
          b.mcb ? `${b.mcb.a} A · ${b.mcb.v} V${b.mcb.tiga ? ' · 3 fase' : ''}` : '—', b.kap ? fmtW(b.kap) : '—', b.kap ? fmtW(b.kap * 0.8) : '—',
          `${fmtW(b.watt)}${b.pct != null ? ` (${b.pct}%)` : ''}`, b.kap ? fmtSisa(b.kap - b.watt) : '—', b.soket ? `${b.devs.length}/${b.soket}` : String(b.devs.length),
          NP.Model.sortDev(b.devs).map(d => `${esc(d.nama)} (${m.dayaW(d) ? fmtW(m.dayaW(d)) : '? W'})`).join(', ')]);
      }).join('')}</table>`;
    if (r.tanpa.length) {
      h += `<h2>Belum punya titik listrik pemasok</h2><table class="pr-table">${tr(['Perangkat', 'Kelompok', 'Jenis', 'Listrik di lokasi', 'Daya'], true)}${NP.Model.sortDev(r.tanpa).map(d =>
        tr([esc(d.nama), NP.nonJaringan(d) ? 'Support' : 'Jaringan', esc(jenisLabel(d)), esc(NP.LISTRIK[(d.atribut || {}).listrik || ''].label), m.dayaW(d) ? fmtW(m.dayaW(d)) : '—'])).join('')}</table>`;
    }
    const sup = NP.Model.sortDev(m.list.filter(d => NP.nonJaringan(d) && !NP.isListrik(d)));
    if (sup.length) {
      h += `<h2>Peralatan support</h2><table class="pr-table">${tr(['Nama', 'Kategori', 'Jumlah', 'Kapasitas / ukuran', 'Daya', 'Titik listrik', 'Status', 'PIC'], true)}${sup.map(d => {
        const a = d.atribut || {};
        const L = m.listrikOf(d);
        return tr([esc(d.nama) + lapisanLabel(d), esc(a.kategori_support || ''), esc(a.jumlah || '1'), esc(a.kapasitas_support || ''), m.dayaW(d) ? fmtW(m.dayaW(d)) : '—',
          L ? esc(L.nama) : esc(NP.LISTRIK[a.listrik || ''].label), esc((STATUS[d.status] || STATUS.rencana).label), esc(d.pic)]);
      }).join('')}</table>`;
    }
    return h;
  }

  $('[data-pane="support"]').addEventListener('click', e => {
    const b = e.target.closest('[data-sp]');
    if (b) {
      if (b.dataset.sp === 'csv') return denganLapisan(() => csvRekapListrik(), S.lapisan);
      if (b.dataset.sp === 'cetak') return denganLapisan(() => cetakRekapListrik(), S.lapisan);
      if (b.dataset.sp === 'cetak-support') return denganLapisan(() => cetakLaporanSupport(), S.lapisan);
      if (b.dataset.sp === 'denah') {
        setView('support');
        return go('denah');
      }
    }
    const a = e.target.closest('[data-sel]');
    if (!a) return;
    e.preventDefault();
    const id = +a.dataset.sel;
    S.sel = id;
    go('denah');
    setTimeout(() => selectDev(id, true), 60);
  });

  // ------------------------------------------------------------------------ ceklis pekerjaan

  const CKG = NP.CEKLIS_GRUP;
  const SEB_KABEL = { ditarik: 'belum', terminasi: 'ditarik', dites: 'terminasi' };
  const SEB_STATUS = { terpasang: 'rencana', diuji: 'terpasang' };

  /** Boleh mencentang ceklis perangkat ini: admin, atau tim update status pada kategori tugasnya. */
  const bolehCeklis = d => S.canEdit || (bolehStatus() && tugasTim(d));

  /**
   * Centang / batal centang satu item. Item tersinkron mengubah status kabel / status pemasangan;
   * item lain disimpan di atribut "ceklis" (admin: bisa Ctrl+Z; tim: lewat api tim, tercatat di riwayat).
   */
  async function setCeklis(d, it, cek) {
    if (!bolehCeklis(d)) return toast('Tidak punya izin mengubah ceklis perangkat ini', true);
    if (it.link) {
      const [jenis, st] = it.link.split(':');
      if (jenis === 'kabel') return setKabel([d.id], cek ? st : SEB_KABEL[st]);
      const tujuan = cek ? st : SEB_STATUS[st];
      if (S.tim) {
        if (!S.akses.status_boleh.includes(tujuan)) return toast(`Tim ini tidak diizinkan mengubah status menjadi "${STATUS[tujuan].label}"`, true);
        return kirimTim(d, tujuan);
      }
      return saveDev(d.id, { status: tujuan }).then(() => toast(`${d.nama} → ${STATUS[tujuan].label}`)).catch(() => {});
    }
    if (S.tim) {
      try {
        const res = await api('api/tim.php', { t: S.tim, action: 'ceklis', id: d.id, item: it.key, cek, label: it.label });
        const i = S.list.findIndex(x => x.id === d.id);
        if (i >= 0) S.list[i] = res.perangkat;
        riwayat.id = null;
        refreshModel();
      } catch (e) {
        toast(e.message, true);
      }
      return;
    }
    const data = NP.ceklisData(d);
    const n = new Date(), dua = x => String(x).padStart(2, '0');
    if (cek) data[it.key] = { t: `${n.getFullYear()}-${dua(n.getMonth() + 1)}-${dua(n.getDate())} ${dua(n.getHours())}:${dua(n.getMinutes())}`, o: 'Admin' };
    else delete data[it.key];
    const atr = Object.assign({}, d.atribut);
    if (Object.keys(data).length) atr.ceklis = JSON.stringify(data);
    else delete atr.ceklis;
    return saveDev(d.id, { atribut: atr }, { keepPanel: false }).catch(() => {});
  }

  /** Item ceklis berdasarkan kunci (dari data-ck). */
  function ckItem(d, key) {
    return NP.ceklisItems(d).find(x => x.key === key);
  }

  const ckBar = (pct, tinggi) => `<div class="kb-bar" style="height:${tinggi || 8}px;margin:4px 0"><i style="width:${pct}%;background:${pct >= 100 ? '#16a34a' : pct >= 50 ? '#0284c7' : '#d97706'}"></i></div>`;

  /** Isi tab Ceklis di panel perangkat. */
  function ceklisPanelHtml(d) {
    const pg = NP.ceklisProgres(d);
    const boleh = bolehCeklis(d);
    let h = `<div class="pn-sec"><h4>Ceklis pekerjaan <span class="small">${pg.selesai}/${pg.total} selesai (${pg.pct}%)</span></h4>${ckBar(pg.pct)}`;
    for (const g of Object.keys(CKG)) {
      const items = pg.items.filter(x => x.grup === g);
      if (!items.length) continue;
      h += `<div class="ck-grup"><div class="ck-grup-h">${CKG[g].icon} ${esc(CKG[g].label)} <span class="muted small">${pg.per[g].selesai}/${pg.per[g].total}</span></div>`;
      h += items.map(it => `<label class="ck-item${it.ok ? ' ok' : ''}">
          <input type="checkbox" data-ck-id="${d.id}" data-ck-key="${it.key}"${it.ok ? ' checked' : ''}${boleh ? '' : ' disabled'}>
          <span class="ck-lbl">${esc(it.label)}${it.link ? ` <span class="ck-link" title="Tersinkron dengan ${it.link.startsWith('kabel') ? 'status kabel' : 'status pemasangan'}">↔ ${it.link.startsWith('kabel') ? 'status kabel' : 'status'}</span>` : ''}
            ${it.info ? `<small class="muted">${esc(it.info.o || '')} · ${esc(it.info.t || '')}</small>` : ''}</span>
          ${g === 'lain' && S.canEdit ? `<button type="button" class="icon" data-ck-hapus="${it.key}" title="Hapus item tambahan">✕</button>` : ''}
        </label>`).join('');
      h += '</div>';
    }
    if (S.canEdit) {
      h += `<div class="inline ck-tambah"><input type="text" id="ck-baru" maxlength="80" placeholder="Tambah item ceklis, mis. Pasang bracket dinding"><button type="button" class="small" data-ck-tambah>Tambah</button></div>`;
    }
    return h + '</div>';
  }

  /** Tambah / hapus item ceklis tambahan perangkat (atribut ceklis_x). */
  function ubahCeklisX(d, fn) {
    let x = [];
    try { x = JSON.parse((d.atribut || {}).ceklis_x || '[]'); } catch (e) { x = []; }
    if (!Array.isArray(x)) x = [];
    const baru = fn(x.slice());
    const atr = Object.assign({}, d.atribut);
    if (baru.filter(Boolean).length) atr.ceklis_x = JSON.stringify(baru);
    else delete atr.ceklis_x;
    return saveDev(d.id, { atribut: atr }).catch(() => {});
  }

  // Centang di panel / halaman Ceklis (delegasi, berlaku di mana pun data-ck-* berada).
  document.addEventListener('change', e => {
    const c = e.target.closest && e.target.closest('[data-ck-id]');
    if (!c) return;
    const d = S.model.byId.get(+c.dataset.ckId);
    const it = d && ckItem(d, c.dataset.ckKey);
    if (it) setCeklis(d, it, c.checked);
  });
  document.addEventListener('click', e => {
    const chip = e.target.closest && e.target.closest('[data-ck-chip]');
    if (chip) {
      const [id, key] = chip.dataset.ckChip.split(':');
      const d = S.model.byId.get(+id);
      const it = d && ckItem(d, key);
      if (it) setCeklis(d, it, !chip.classList.contains('ok'));
      return;
    }
    if (S.sel == null) return;
    const d = S.model.byId.get(S.sel);
    if (e.target.closest && e.target.closest('[data-ck-tambah]')) {
      const v = ($('#ck-baru') || {}).value || '';
      if (!v.trim()) return;
      return ubahCeklisX(d, x => x.concat([v.trim().slice(0, 80)]));
    }
    const hapus = e.target.closest && e.target.closest('[data-ck-hapus]');
    if (hapus) {
      e.preventDefault();
      const i = +hapus.dataset.ckHapus.slice(1) - 1;
      // Item tambahan dikosongkan (bukan digeser) agar centang item lain tetap pada kuncinya.
      return ubahCeklisX(d, x => { x[i] = ''; return x; });
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'ck-baru') {
      e.preventDefault();
      const b = $('[data-ck-tambah]');
      if (b) b.click();
    }
  });

  // ---- halaman Ceklis (semua perangkat)

  // Filter halaman Ceklis. tutup = jenis yang bagiannya dilipat (null = default: bagian > 20 perangkat dilipat).
  const ckF = { grup: '', jenis: '', belum: false, q: '', tutup: null, buka: new Set() };
  const mqCk = matchMedia('(max-width: 700px)');
  mqCk.addEventListener('change', () => { if (S.tab === 'ceklis') renderCeklisPage(); });

  /** Baris perangkat yang tampil sesuai filter: [{d, items (sesuai filter kelompok), pg}]. */
  function barisCeklis() {
    const q = ckF.q.trim().toLowerCase();
    return NP.Model.sortDev(S.model.list)
      .filter(d => masukLapisan(d) && (!ckF.jenis || d.jenis === ckF.jenis) && (!q || d.nama.toLowerCase().includes(q)))
      .map(d => {
        const pg = NP.ceklisProgres(d);
        return { d, pg, items: pg.items.filter(it => !ckF.grup || it.grup === ckF.grup) };
      })
      .filter(r => r.items.length && (!ckF.belum || r.items.some(it => !it.ok)));
  }

  const ckPct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  const ckDev = d => `<a href="#" class="dev-link" data-sel="${d.id}"><i style="background:${NP.tampil(d).color}">${NP.isListrik(d) ? '⚡' : esc(NP.tampil(d).short)}</i>${esc(d.nama)}</a>`;
  const ckTip = it => `${CKG[it.grup].label}: ${it.label}${it.info ? ' — ' + it.info.o + ', ' + it.info.t : ''}${it.link ? ' (tersinkron ' + (it.link.startsWith('kabel') ? 'status kabel' : 'status pemasangan') + ')' : ''}`;

  function renderCeklisPageIsi() {
    const m = S.model;
    // Ringkasan per kelompok pekerjaan (seluruh event, tidak terpengaruh filter) — kartu bisa diklik untuk memfilter.
    const tot = { '': { s: 0, t: 0 } };
    Object.keys(CKG).forEach(g => { tot[g] = { s: 0, t: 0 }; });
    let selesaiDev = 0;
    m.list.forEach(d => {
      const pg = NP.ceklisProgres(d);
      if (pg.total && pg.selesai === pg.total) selesaiDev++;
      pg.items.forEach(it => { tot[it.grup].t++; tot[''].t++; if (it.ok) { tot[it.grup].s++; tot[''].s++; } });
    });
    const tile = (g, judul) => `<button type="button" class="sp-tile ck-tile${ckF.grup === g ? ' on' : ''}" data-ck-grupf="${g}">
        <b>${ckPct(tot[g].s, tot[g].t)}%</b><span>${judul}</span><span class="muted small">${tot[g].s}/${tot[g].t} item</span>${ckBar(ckPct(tot[g].s, tot[g].t), 6)}</button>`;
    let h = `<div class="sp-head">
        <div><h1>Ceklis pekerjaan</h1><p class="muted">${selesaiDev}/${m.list.length} perangkat selesai semua. Klik kotak untuk mencentang · <b>✓ semua</b> di kepala kolom mencentang satu pekerjaan untuk semua perangkat.</p></div>
        <div class="btn-row"><button type="button" data-ckp="csv">Unduh CSV</button><button type="button" class="primary" data-ckp="cetak">Cetak ceklis</button></div>
      </div>
      <div class="sp-tiles ck-tiles">${tile('', 'Semua pekerjaan')}${Object.keys(CKG).filter(g => tot[g].t).map(g => tile(g, CKG[g].icon + ' ' + CKG[g].label)).join('')}</div>
      <div class="list-tools ck-tools">
        <input type="search" id="ck-q" placeholder="Cari perangkat…" value="${esc(ckF.q)}">
        <select id="ck-jenis"><option value="">Semua jenis</option>${TYPE_ORDER.filter(j => m.list.some(d => d.jenis === j)).map(j => `<option value="${j}"${ckF.jenis === j ? ' selected' : ''}>${esc(TYPES[j].label)}</option>`).join('')}</select>
        <label class="check-inline"><input type="checkbox" id="ck-belum"${ckF.belum ? ' checked' : ''}> Hanya yang belum selesai</label>
        <span class="spacer"></span>
        <button type="button" class="small ghost" data-ck-lipat="buka">Buka semua</button><button type="button" class="small ghost" data-ck-lipat="tutup">Lipat semua</button>
      </div>`;
    const rows = barisCeklis();
    if (!rows.length) {
      $('#ceklis-pane').innerHTML = h + '<div class="card"><p class="muted center">Tidak ada pekerjaan yang cocok dengan filter.</p></div>';
      return;
    }
    // Dikelompokkan per jenis perangkat; setiap jenis punya kolom pekerjaan sendiri.
    const perJenis = new Map();
    rows.forEach(r => {
      if (!perJenis.has(r.d.jenis)) perJenis.set(r.d.jenis, []);
      perJenis.get(r.d.jenis).push(r);
    });
    if (!ckF.tutup) ckF.tutup = new Set([...perJenis].filter(([, rs]) => rs.length > 20).map(([j]) => j));
    for (const [j, rs] of perJenis) h += mqCk.matches ? kartuJenis(j, rs) : matriksJenis(j, rs);
    $('#ceklis-pane').innerHTML = h;
  }

  /** Kepala bagian per jenis: nama, jumlah, progres, lipat. */
  function kepalaJenis(j, rs) {
    const s = rs.reduce((n, r) => n + r.items.filter(it => it.ok).length, 0);
    const t = rs.reduce((n, r) => n + r.items.length, 0);
    const tutup = ckF.tutup.has(j);
    return `<button type="button" class="ck-sec-h" data-ck-sec="${j}" aria-expanded="${!tutup}">
      <span class="twig${tutup ? '' : ' buka'}">▸</span><i class="dotc" style="background:${TYPES[j].color}"></i>
      <b>${esc(TYPES[j].label)}</b><span class="muted small">${rs.length} perangkat · ${s}/${t} item</span>
      <span class="spacer"></span><span class="ck-sec-p">${ckPct(s, t)}%</span><span class="ck-sec-bar">${ckBar(ckPct(s, t), 6)}</span></button>`;
  }

  /** Desktop: matriks perangkat × pekerjaan untuk satu jenis. */
  function matriksJenis(j, rs) {
    let h = `<div class="card ck-sec">${kepalaJenis(j, rs)}`;
    if (ckF.tutup.has(j)) return h + '</div>';
    // Kolom = gabungan item semua perangkat jenis ini, urut kelompok pekerjaan.
    const kol = [];
    const ada = new Set();
    Object.keys(CKG).forEach(g => rs.forEach(r => r.items.filter(it => it.grup === g).forEach(it => {
      if (!ada.has(it.key)) { ada.add(it.key); kol.push(it); }
    })));
    const boleh = rs.some(r => bolehCeklis(r.d));
    // Baris judul kelompok pekerjaan di atas kolom-kolomnya.
    const span = [];
    kol.forEach(k => { if (span.length && span[span.length - 1].g === k.grup) span[span.length - 1].n++; else span.push({ g: k.grup, n: 1 }); });
    h += `<div class="ck-scroll"><table class="ck-mx"><thead><tr class="ck-grp-row"><th class="ck-mx-dev"></th>${span.map(s => `<th colspan="${s.n}" class="ck-g-${s.g}">${CKG[s.g].icon} ${esc(CKG[s.g].label)}</th>`).join('')}<th></th></tr>
      <tr><th class="ck-mx-dev">Perangkat</th>${kol.map(k => {
      const punya = rs.filter(r => r.items.some(it => it.key === k.key));
      const s = punya.filter(r => r.items.find(it => it.key === k.key).ok).length;
      return `<th class="ck-g-${k.grup}" title="${esc(CKG[k.grup].label)}: ${esc(k.label)}"><span class="ck-th-l">${esc(k.label)}</span>
        <span class="ck-th-n${s === punya.length ? ' ok' : ''}">${s}/${punya.length}</span>
        ${boleh && s < punya.length ? `<button type="button" class="ck-all" data-ck-all="${j}:${k.key}" title="Centang ${esc(k.label)} untuk semua ${esc(TYPES[j].label)} yang tampil">✓ semua</button>` : ''}</th>`;
    }).join('')}<th class="ck-mx-p">Progres</th></tr></thead><tbody>`;
    h += rs.map(r => {
      const s = r.items.filter(it => it.ok).length;
      const bol = bolehCeklis(r.d);
      return `<tr><td class="ck-mx-dev">${ckDev(r.d)}</td>${kol.map(k => {
        const it = r.items.find(x => x.key === k.key);
        if (!it) return '<td class="ck-na">—</td>';
        return `<td><button type="button" class="ck-cell${it.ok ? ' ok' : ''}" ${bol ? `data-ck-chip="${r.d.id}:${it.key}"` : 'disabled'} title="${esc(ckTip(it))}" aria-label="${esc(it.label)}">${it.ok ? '✓' : ''}</button></td>`;
      }).join('')}<td class="ck-mx-p"><b>${s}/${r.items.length}</b>${ckBar(ckPct(s, r.items.length), 5)}</td></tr>`;
    }).join('');
    return h + '</tbody></table></div></div>';
  }

  /** HP: kartu per perangkat — progres + pekerjaan berikutnya (satu ketuk) + daftar lengkap bisa dibuka. */
  function kartuJenis(j, rs) {
    let h = `<div class="card ck-sec">${kepalaJenis(j, rs)}`;
    if (ckF.tutup.has(j)) return h + '</div>';
    h += rs.map(r => {
      const s = r.items.filter(it => it.ok).length;
      const bol = bolehCeklis(r.d);
      const next = r.items.find(it => !it.ok);
      const buka = ckF.buka.has(r.d.id);
      return `<div class="ck-card">
        <div class="ck-card-h">${ckDev(r.d)}<span class="spacer"></span><b>${s}/${r.items.length}</b></div>
        ${ckBar(ckPct(s, r.items.length), 5)}
        ${next ? `<button type="button" class="ck-next" ${bol ? `data-ck-chip="${r.d.id}:${next.key}"` : 'disabled'}>○ <span class="muted">Berikutnya:</span> ${esc(next.label)}</button>` : '<div class="ck-done">✓ Semua pekerjaan selesai</div>'}
        <button type="button" class="ck-more" data-ck-buka="${r.d.id}">${buka ? '▾ Tutup daftar' : `▸ Semua item (${r.items.length})`}</button>
        ${buka ? `<div class="ck-chips">${r.items.map(it => `<button type="button" class="ck-chip${it.ok ? ' ok' : ''}" ${bol ? `data-ck-chip="${r.d.id}:${it.key}"` : 'disabled'} title="${esc(ckTip(it))}">${it.ok ? '✓' : '○'} ${esc(it.label)}</button>`).join('')}</div>` : ''}
      </div>`;
    }).join('');
    return h + '</div>';
  }

  /**
   * Centang satu pekerjaan untuk banyak perangkat sekaligus (satu langkah Ctrl+Z untuk admin). Item tersinkron
   * memakai aksi massal status kabel / status pemasangan.
   */
  async function ceklisMassal(ds, key) {
    const target = ds.map(d => ({ d, it: ckItem(d, key) })).filter(x => x.it && !x.it.ok && bolehCeklis(x.d));
    if (!target.length) return;
    const it0 = target[0].it;
    if (!confirm(`Centang "${it0.label}" untuk ${target.length} perangkat?`)) return;
    if (it0.link) {
      const [jenis, st] = it0.link.split(':');
      const ids = target.map(x => x.d.id);
      if (jenis === 'kabel') return setKabel(ids, st);
      if (S.tim) {
        for (const x of target) await setCeklis(x.d, x.it, true);
        return;
      }
      return statusMassal(ids, st);
    }
    if (S.tim) {
      for (const x of target) await setCeklis(x.d, x.it, true);
      return toast(`${target.length} perangkat: ${it0.label} ✓`);
    }
    await kelompok(`ceklis "${it0.label}" ${target.length} perangkat`, async () => {
      for (const x of target) {
        const data = NP.ceklisData(x.d);
        const n = new Date(), dua = v => String(v).padStart(2, '0');
        data[key] = { t: `${n.getFullYear()}-${dua(n.getMonth() + 1)}-${dua(n.getDate())} ${dua(n.getHours())}:${dua(n.getMinutes())}`, o: 'Admin' };
        await saveDev(x.d.id, { atribut: Object.assign({}, x.d.atribut, { ceklis: JSON.stringify(data) }) }, { keepPanel: true }).catch(() => {});
      }
    });
    renderTab();
    toast(`${target.length} perangkat: ${it0.label} ✓`);
  }

  $('[data-pane="ceklis"]').addEventListener('input', e => {
    if (e.target.id === 'ck-q') { ckF.q = e.target.value; renderCeklisPage(); const i = $('#ck-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  });
  $('[data-pane="ceklis"]').addEventListener('change', e => {
    if (e.target.id === 'ck-jenis') ckF.jenis = e.target.value;
    else if (e.target.id === 'ck-belum') ckF.belum = e.target.checked;
    else return;
    renderCeklisPage();
  });
  $('[data-pane="ceklis"]').addEventListener('click', e => {
    const b = e.target.closest('[data-ckp]');
    if (b) return denganLapisan(() => (b.dataset.ckp === 'csv' ? csvCeklis() : cetakCeklis()), S.lapisan);
    const tg = e.target.closest('[data-ck-grupf]');
    if (tg) {
      ckF.grup = ckF.grup === tg.dataset.ckGrupf ? '' : tg.dataset.ckGrupf;
      return renderCeklisPage();
    }
    const sec = e.target.closest('[data-ck-sec]');
    if (sec) {
      const j = sec.dataset.ckSec;
      if (ckF.tutup.has(j)) ckF.tutup.delete(j);
      else ckF.tutup.add(j);
      return renderCeklisPage();
    }
    const lipat = e.target.closest('[data-ck-lipat]');
    if (lipat) {
      ckF.tutup = lipat.dataset.ckLipat === 'buka' ? new Set() : new Set(TYPE_ORDER);
      return renderCeklisPage();
    }
    const more = e.target.closest('[data-ck-buka]');
    if (more) {
      const id = +more.dataset.ckBuka;
      if (ckF.buka.has(id)) ckF.buka.delete(id);
      else ckF.buka.add(id);
      return renderCeklisPage();
    }
    const all = e.target.closest('[data-ck-all]');
    if (all) {
      const [j, key] = all.dataset.ckAll.split(':');
      return ceklisMassal(barisCeklis().filter(r => r.d.jenis === j).map(r => r.d), key);
    }
    const a = e.target.closest('[data-sel]');
    if (!a) return;
    e.preventDefault();
    const id = +a.dataset.sel;
    S.sel = id;
    go('denah');
    setTimeout(() => selectDev(id, true), 60);
  });

  function csvCeklis() {
    const rows = [['Perangkat', 'Jenis', 'Kelompok pekerjaan', 'Item', 'Selesai', 'Oleh', 'Waktu']];
    for (const d of NP.Model.sortDev(S.model.list)) {
      for (const it of NP.ceklisProgres(d).items) {
        rows.push([d.nama, jenisLabel(d), CKG[it.grup].label, it.label, it.ok ? 'Ya' : 'Belum', it.info ? it.info.o : '', it.info ? it.info.t : '']);
      }
    }
    downloadCsv(rows, `ceklis-${slug(S.proyek.nama)}.csv`);
  }

  /** Lembar ceklis untuk teknisi (A4 tegak): per perangkat, kotak ☐ / ☑ per item, mengikuti filter halaman. */
  function cetakCeklis() {
    const m = S.model;
    const q = ckF.q.trim().toLowerCase();
    const ds = NP.Model.sortDev(m.list).filter(d => (!ckF.jenis || d.jenis === ckF.jenis) && (!q || d.nama.toLowerCase().includes(q)));
    const blok = ds.map(d => {
      const pg = NP.ceklisProgres(d);
      const items = pg.items.filter(it => !ckF.grup || it.grup === ckF.grup);
      if (!items.length || (ckF.belum && items.every(it => it.ok))) return '';
      const p = m.parentOf(d);
      return `<div class="ck-print">
        <div class="ck-print-h"><b>${esc(d.nama)}</b> <span>${esc(jenisLabel(d))}${p ? ' · uplink ' + esc(p.nama) + (d.port_uplink ? ' (' + esc(d.port_uplink) + ')' : '') : ''}${d.ip ? ' · ' + esc(d.ip) : ''}</span>
          <span class="ck-print-p">${items.filter(it => it.ok).length}/${items.length}</span></div>
        <div class="ck-print-i">${items.map(it => `<span>${it.ok ? '☑' : '☐'} ${esc(it.label)}</span>`).join('')}</div>
      </div>`;
    }).join('');
    $('#print').className = 'print';
    $('#print').innerHTML = prHead('Ceklis pekerjaan' + (ckF.grup ? ' — ' + CKG[ckF.grup].label : '')) +
      `<p>Paraf teknisi: ____________ &nbsp; Tanggal: ____________</p>${blok || '<p>Tidak ada item.</p>'}`;
    printWith('A4 portrait');
  }

  // ------------------------------------------------------------------------ proyek / info

  /** Kepala tab Proyek: identitas event + ringkasan progres; admin juga mendapat navigasi bagian. */
  function pjHead(p, tgl, admin) {
    const plan = S.list.filter(d => d.status !== 'usulan');
    const n = k => plan.filter(d => d.status === k).length;
    const selesai = n('terpasang') + n('diuji');
    const pct = plan.length ? Math.round(selesai / plan.length * 100) : 0;
    const usul = S.list.length - plan.length;
    const stat = (v, l, cls) => `<div class="pj-stat${cls ? ' ' + cls : ''}"><b>${v}</b><span>${l}</span></div>`;
    return `<div class="card pj-head">
      <div class="pj-id">
        <h2>${esc(p.nama)}${admin ? '<span class="spacer"></span><button type="button" class="small" data-p="edit">Ubah info</button><button type="button" class="small" data-p="backup">Backup</button>' : ''}</h2>
        <p class="muted">${esc(p.venue || 'Venue belum diisi')}${tgl !== '—' ? ' · ' + esc(tgl) : ''}</p>
      </div>
      <div class="pj-stats">
        ${stat(plan.length, 'perangkat di plan')}
        ${stat(pct + '%', `terpasang (${selesai})`, 'ok')}
        ${n('bermasalah') ? stat(n('bermasalah'), 'bermasalah', 'bad') : ''}
        ${usul ? `<a href="#" class="pj-stat usul"${admin ? ' data-p="grup" data-g="tim"' : ''}><b>${usul}</b><span>usulan installer</span></a>` : ''}
      </div>
      <div class="progres"><i style="width:${pct}%"></i></div>
      ${admin ? `<nav class="pj-nav" role="tablist">${PJ_GRUP.map(([k, l]) => `<button type="button" role="tab" data-p="grup" data-g="${k}" aria-selected="${k === pjGrup}"${k === pjGrup ? ' class="on"' : ''}>${esc(l)}${k === 'tim' && usul ? ` <span class="pill usul">${usul}</span>` : ''}</button>`).join('')}</nav>` : ''}
    </div>`;
  }

  // Bagian tab Proyek (tampil satu per satu); pilihan terakhir diingat di browser ini.
  const PJ_GRUP = [['umum', 'Umum'], ['denah', 'Denah & lantai'], ['jaringan', 'Jaringan'], ['tim', 'Tim & installer'], ['data', 'Keamanan & data']];
  let pjGrup = 'umum';
  try {
    const g = localStorage.getItem('np-pj-grup');
    if (PJ_GRUP.some(x => x[0] === g)) pjGrup = g;
  } catch (e) { /* penyimpanan browser tidak tersedia */ }
  function pilihPjGrup(g) {
    pjGrup = g;
    try { localStorage.setItem('np-pj-grup', g); } catch (e) { /* abaikan */ }
    $$('#proyek-pane .pj-sec').forEach(s => { s.hidden = s.id !== 'pj-' + g; });
    $$('#proyek-pane .pj-nav [data-g]').forEach(b => {
      b.classList.toggle('on', b.dataset.g === g);
      b.setAttribute('aria-selected', b.dataset.g === g);
    });
  }

  /** Kartu usulan alat baru dari installer (tab Proyek, admin): setujui = masuk plan, tolak = titik dihapus. */
  function usulanCardHtml() {
    const ds = S.list.filter(d => d.status === 'usulan');
    return `<h2>Usulan alat baru${ds.length ? ` <span class="pill usul">${ds.length}</span>` : ''}</h2>
      <p class="muted small">Alat yang ditambahkan <b>installer</b> di lapangan masuk sebagai <span class="st st-usulan">Usulan baru</span>. Periksa lalu putuskan: <b>Bisa dipasang</b> (masuk plan sebagai Rencana) atau <b>Tolak</b> (titiknya dihapus, alasan tercatat di aktivitas).</p>
      ${ds.length ? `<ul class="usul-list">${ds.map(d => {
        const a = d.atribut || {};
        const up = d.uplink_id != null && S.model && S.model.byId.get(d.uplink_id);
        return `<li>
          <div class="usul-top"><i class="dot" style="background:${(TYPES[d.jenis] || TYPES.lainnya).color}"></i>
            <a href="#" data-p="lihat-dev" data-id="${d.id}"><b>${esc(d.nama)}</b></a>
            <span class="muted small">${esc(jenisLabel(d))}${d.model ? ' · ' + esc(d.model) : ''}${up ? ' · uplink ' + esc(up.nama) : ''}</span></div>
          <div class="muted small">Oleh <b>${esc(a.usulan_oleh || 'tim')}</b>${a.usulan_waktu ? ' · ' + esc(fmtWaktu(a.usulan_waktu)) : ''}</div>
          <div class="btn-row"><button type="button" class="small primary" data-usulan="setuju" data-id="${d.id}">✓ Bisa dipasang</button>
            <button type="button" class="small danger" data-usulan="tolak" data-id="${d.id}">✕ Tolak</button></div>
        </li>`;
      }).join('')}</ul>` : '<p class="muted">Tidak ada usulan yang menunggu keputusan.</p>'}
      ${S.list.length && !aksesList.some(a => a.peran === 'installer') ? '<p class="muted small">Belum ada akses <b>Installer</b> — buat di kartu <i>Akses tim</i>.</p>' : ''}`;
  }

  /** Daftar usulan milik installer ini (halaman tim). */
  function usulanSaya() {
    const ds = S.list.filter(d => d.status === 'usulan' && String((d.atribut || {}).usulan_akses || '') === String(S.akses.id));
    return ds.length ? `<h4>Usulan Anda menunggu keputusan admin (${ds.length})</h4>
      <div class="akses-izin">${ds.map(d => `<span class="st st-usulan">${esc(d.nama)}</span>`).join('')}</div>` : '';
  }

  const fmtWaktu = s => new Date(String(s).replace(' ', 'T')).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  /** Keputusan admin atas usulan installer. */
  async function putusUsulan(id, keputusan) {
    const d = S.model && S.model.byId.get(id);
    if (!d) return;
    let catatan = '';
    if (keputusan === 'tolak') {
      const v = prompt(`Tolak usulan "${d.nama}"? Titiknya akan dihapus dari denah.\n\nAlasan (opsional, tercatat di aktivitas):`, '');
      if (v == null) return;
      catatan = v.trim();
    }
    try {
      const res = await enqueue(() => api(API, { action: 'perangkat_usulan', id, keputusan, catatan }));
      const i = S.list.findIndex(x => x.id === id);
      if (res.perangkat && i >= 0) S.list[i] = res.perangkat;
      else if (i >= 0) {
        S.list.splice(i, 1);
        S.list.forEach(x => { if (x.uplink_id === id) x.uplink_id = null; });
        if (S.sel === id) S.sel = null;
      }
      riwayat.id = null;
      refreshModel({ keepPanel: true });
      const card = $('#card-usulan');
      if (card) card.innerHTML = usulanCardHtml();
      if (S.tab === 'proyek') muatAktivitas();
      toast(keputusan === 'setuju' ? `${d.nama} bisa dipasang — masuk plan sebagai Rencana` : `Usulan ${d.nama} ditolak`);
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-usulan]');
    if (!b || !S.canEdit) return;
    e.preventDefault();
    putusUsulan(+b.dataset.id, b.dataset.usulan);
  });

  function renderProyek() {
    const p = S.proyek;
    const base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    const link = base + 'index.html?lihat=' + p.kode_lihat;
    const tgl = p.tanggal_mulai ? fmtDate(p.tanggal_mulai) + (p.tanggal_selesai && p.tanggal_selesai !== p.tanggal_mulai ? ' – ' + fmtDate(p.tanggal_selesai) : '') : '—';
    if (S.lihat) {
      $('#proyek-pane').innerHTML = `${pjHead(p, tgl, false)}<div class="pj-cols"><div class="card"><h2>Catatan event</h2>
        ${p.catatan ? `<div class="pre">${esc(p.catatan)}</div>` : '<p class="muted">Belum ada catatan.</p>'}
        <p class="muted small">${S.tim ? 'Halaman tim.' : 'Halaman lihat-saja.'} ${S.akses && S.akses.lihat_password ? '' : 'Password disamarkan. '}Data diperbarui otomatis tiap 30 detik.</p></div>
        ${S.tim && S.akses ? `<div class="card"><h2>Akses Anda</h2>${aksesRingkas(S.akses)}${progresTim()}
          ${isInstaller() ? `<p class="muted small">Alat yang belum ada di plan bisa diusulkan dari tab <b>Denah</b>: tombol <b>Usulkan</b> di toolbar → klik lokasinya. Admin yang menentukan alat itu bisa dipasang atau tidak.</p>${usulanSaya()}` : ''}</div>
        <div class="card" id="card-aktivitas"><h2>Aktivitas tim</h2><p class="muted small">Memuat…</p></div>` : ''}</div>`;
      if (S.tim) muatAktivitas();
      return;
    }
    const sec = (id, judul, isi) => `<section class="pj-sec" id="pj-${id}" role="tabpanel"${id === pjGrup ? '' : ' hidden'}><div class="pj-cols">${isi}</div></section>`;
    $('#proyek-pane').innerHTML = pjHead(p, tgl, true) + sec('umum', 'Umum', `
      <div class="card">
        <h2>Catatan event</h2>
        <form id="form-catatan" autocomplete="off">
          <label class="field"><span>Catatan umum jaringan (topologi, kontak, jadwal setting)</span>
            <textarea name="catatan" rows="6" maxlength="5000" placeholder="mis. Loading barang H-1 jam 14.00, PIC venue Pak Budi 08xx, ISP aktif H-2...">${esc(p.catatan || '')}</textarea></label>
          <label class="field"><span>Tambahan panjang kabel dari jarak lurus (%)</span>
            <input type="number" name="slack_kabel" min="0" max="300" value="${p.slack_kabel}" style="max-width:120px"></label>
          <button type="submit" class="primary">Simpan</button>
        </form>
      </div>
      <div class="card">
        <h2>Link lihat-saja (teknisi lapangan)</h2>
        <div class="share">
          <div class="qr">${qrSvg(link)}</div>
          <div class="grow">
            <p class="muted small">Tanpa login, tidak bisa mengubah data, password WiFi/admin disamarkan.</p>
            <input type="text" readonly value="${esc(link)}" class="mono small-input" onclick="this.select()">
            <div class="btn-row" style="margin-top:8px">
              <button type="button" class="small" data-p="copy" data-link="${esc(link)}">Salin</button>
              <a class="btn small" href="${esc(link)}" target="_blank" rel="noopener">Buka</a>
              <button type="button" class="small" data-p="kode-baru">Ganti link</button>
            </div>
          </div>
        </div>
      </div>`) + sec('denah', 'Denah &amp; lantai', `
      <div class="card">
        <h2>Denah venue</h2>
        ${p.denah_v ? `<img class="denah-prev" src="${esc(denahUrl())}" alt="Denah"><p class="muted small">${p.denah_w} × ${p.denah_h} piksel</p>` : '<p class="muted">Belum ada denah.</p>'}
        <label class="field"><span>${p.denah_v ? 'Ganti' : 'Upload'} denah (PDF/PNG/JPG/WEBP, maks. 30 MB)</span>
          <input type="file" id="denah-file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf"></label>
        ${p.denah_v ? `<label class="check"><input type="checkbox" id="denah-sesuaikan" checked>
          <span>Denah baru = venue yang sama (hanya resolusi/versi berbeda)<small>Posisi perangkat & skala diskalakan mengikuti ukuran gambar baru. Hapus centang bila denahnya berbeda — skala perlu dikalibrasi ulang.</small></span></label>
          <button type="button" class="small danger" data-p="denah-del">Hapus denah</button>` : ''}
        <p class="muted small">PDF diubah otomatis menjadi gambar di browser (PDF banyak halaman: pilih halamannya). File CAD (DWG): ekspor dulu ke PDF. Resolusi lebih tinggi = lebih tajam saat di-zoom.</p>
      </div>
      <div class="card">
        <h2>Skala denah</h2>
        <p>${p.skala ? `1 piksel denah = <b>${(p.skala * 100).toLocaleString('id-ID', { maximumFractionDigits: 3 })} cm</b>. Lebar denah ≈ <b>${esc(fmtM(p.skala * (p.denah_w || 2000)))}</b>.` : 'Belum dikalibrasi.'}</p>
        <p class="muted small">Kalibrasi di tab Denah: alat <b>Ukur</b> → klik dua ujung garis skala → isi jarak sebenarnya → <b>Set skala</b>.</p>
        ${p.skala ? '<button type="button" class="small" data-p="skala-reset">Hapus kalibrasi</button>' : ''}
      </div>
      <div class="card" id="card-lantai"></div>`) + sec('jaringan', 'Jaringan', `
      <div class="card" id="card-lapisan"></div>`) + sec('tim', 'Tim &amp; installer', `
      <div class="card" id="card-usulan">${usulanCardHtml()}</div>
      <div class="card" id="card-akses"><h2>Akses tim</h2><p class="muted small">Memuat…</p></div>
      <div class="card" id="card-aktivitas"><h2>Aktivitas tim</h2><p class="muted small">Memuat…</p></div>`) + sec('data', 'Keamanan &amp; data', `
      <div class="card" id="card-admin-event">
        <h2>Admin event</h2>
        <p>${p.ada_password ? '<b class="ok-text">✓ Password admin event sudah diatur.</b>' : '<b>Belum ada password admin event</b> — hanya admin utama yang bisa mengelola event ini.'}</p>
        <p class="muted small">Login di <span class="mono">${esc(location.href.replace(/[?#].*$/, ''))}</span> dengan password ini → hanya bisa mengelola event <b>${esc(p.nama)}</b> (tidak bisa membuat/menghapus event, mengubah katalog, atau melihat event lain). Password lama langsung tidak berlaku setelah diganti.</p>
        <form id="form-pw-event" autocomplete="off">
          ${S.peran === 'event' ? '<label class="field"><span>Password lama</span><input type="password" name="lama" required autocomplete="current-password"></label>' : ''}
          <label class="field"><span>${p.ada_password ? 'Ganti password' : 'Buat password'} (min. 8 karakter)</span>
            <div class="inline"><input type="password" name="password" minlength="8" maxlength="72" required autocomplete="new-password" class="mono">
              <button type="button" class="small" data-pw="lihat" title="Tampilkan">👁</button>
              <button type="button" class="small" data-pw="acak">Acak</button>
              <button type="button" class="small" data-pw="salin">Salin</button></div></label>
          <div class="btn-row"><button type="submit" class="primary small">Simpan password</button>
            ${p.ada_password ? '<button type="button" class="small danger super-only" data-p="pw-hapus">Hapus password</button>' : ''}</div>
        </form>
      </div>
      <div class="card">
        <h2>Backup &amp; hapus</h2>
        <div class="btn-row">
          <button type="button" data-p="backup" title="Simpan event ini (denah, perangkat, katalog yang dipakai) ke satu file">Backup event ini</button>
          <button type="button" class="super-only" data-p="dup">Duplikat event</button>
        </div>
        <p class="muted small"><b>Backup</b> menyimpan event lengkap (denah, skala, perangkat, koneksi, katalog &amp; tipe endpoint yang dipakai) ke satu file <code>.netplan.json</code>; buka kembali lewat <b>Buka backup…</b> di halaman daftar event. <b>Duplikat</b> menyalin event di server ini — cocok untuk event berulang di venue yang sama.</p>
        <div class="danger-zone">
          <h4>Zona berbahaya</h4>
          <div class="dz-row">
            <div><b>Hapus semua perangkat</b><p class="muted small">${S.list.length} perangkat dihapus. Event, denah, skala, dan link lihat-saja tetap.</p></div>
            <button type="button" class="danger" data-p="del-all"${S.list.length ? '' : ' disabled'}>Hapus semua perangkat</button>
          </div>
          <div class="dz-row">
            <div><b>Hapus event</b><p class="muted small">Event, gambar denah, dan semua perangkatnya dihapus permanen.</p></div>
            <button type="button" class="danger super-only" data-p="del">Hapus event</button>
          </div>
        </div>
      </div>`);
    renderLapisanCard();
    renderLantaiCard();
    muatAkses();
    muatAktivitas();
  }

  // ------------------------------------------------------------------------ akses tim (admin / PM)

  let aksesList = [];
  const aksesLink = a => location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '') + 'index.html?tim=' + a.token;

  /** Ringkasan izin: peran, status yang boleh, kategori tugas, password. */
  function aksesRingkas(a) {
    const jenis = a.jenis_boleh.length ? a.jenis_boleh.map(j => (TYPES[j] || TYPES.lainnya).label).join(', ') : 'semua kategori';
    return `<div class="akses-izin">
      <span class="tag-peran ${a.peran}">${PERAN_LABEL[a.peran] || 'Lihat saja'}</span>
      ${pemasang(a) ? a.status_boleh.map(k => `<span class="st st-${k}">${esc(STATUS[k].label)}</span>`).join('') : ''}${a.peran === 'installer' ? '<span class="st st-usulan">+ usulkan alat baru</span>' : ''}
      <span class="muted small">· ${esc(jenis)}${a.lihat_password ? ' · boleh lihat password' : ''}</span>
    </div>`;
  }

  /** Progres tugas tim (perangkat di kategori tugasnya) per status. */
  function progresTim() {
    const a = S.akses;
    const ds = S.list.filter(d => d.status !== 'usulan' && (!a.jenis_boleh.length || a.jenis_boleh.includes(d.jenis)));
    if (!ds.length) return '';
    const n = {};
    ds.forEach(d => { n[d.status] = (n[d.status] || 0) + 1; });
    const selesai = (n.terpasang || 0) + (n.diuji || 0);
    return `<h4>Progres tugas (${ds.length} perangkat)</h4>
      <div class="progres"><i style="width:${Math.round(selesai / ds.length * 100)}%"></i></div>
      <div class="akses-izin">${Object.keys(STATUS).filter(k => k !== 'usulan').map(k => `<span class="st st-${k}">${esc(STATUS[k].label)} ${n[k] || 0}</span>`).join('')}</div>`;
  }

  // ------------------------------------------------------------------------ kartu layer jaringan (tab Proyek)

  const WARNA_LAPISAN = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777', '#475569', '#65a30d', '#7c3aed', '#be123c'];

  /** Daftar layer untuk disimpan (layer bawaan "Jaringan utama" ikut ditulis eksplisit). */
  const lapisanSekarang = () => S.model.lapisanList().map(l => ({ id: l.id, nama: l.nama, warna: l.warna }));
  function lapisanBaru(arr, nama) {
    const n = Math.max(0, ...arr.map(l => parseInt(l.id.slice(1), 10) || 0)) + 1;
    return { id: 'L' + n, nama: nama || 'Layer ' + n, warna: WARNA_LAPISAN[arr.length % WARNA_LAPISAN.length] };
  }

  async function simpanLapisan(arr) {
    try {
      const res = await api(API, { action: 'proyek_lapisan', id: S.proyek.id, lapisan: arr });
      S.proyek = res.proyek;
      refreshModel();
      renderLapisanCard();
    } catch (e) {
      toast(e.message, true);
      renderLapisanCard();
    }
  }

  function renderLapisanCard() {
    const box = $('#card-lapisan');
    if (!box) return;
    const m = S.model;
    const daftar = m.lapisanList();
    const n = id => m.list.filter(d => m.lapisanOf(d) === id).length;
    box.innerHTML = `<h2>Layer jaringan</h2>
      <p class="muted small">Beberapa jaringan terpisah dalam satu denah — mis. sumber WAN &amp; tarikan kabel ke endpoint berbeda (EXPO LINE, BSI LINE).
        Tiap layer punya pohon topologi, pemeriksaan (IP ganda, kabel lintas layer) dan laporan sendiri; di denah layer lain tampil samar.</p>
      <table class="mini lp-tbl"><tr><th>Warna</th><th>Nama layer</th><th class="num">Perangkat</th><th></th></tr>
        ${daftar.map(l => `<tr>
          <td><input type="color" value="${esc(l.warna)}" data-lp-warna="${esc(l.id)}" aria-label="Warna layer ${esc(l.nama)}"></td>
          <td><input type="text" value="${esc(l.nama)}" maxlength="60" data-lp-nama="${esc(l.id)}" aria-label="Nama layer"></td>
          <td class="num">${n(l.id)}</td>
          <td class="lp-aksi">${daftar.length > 1 ? `<button type="button" class="small ghost" data-lapisan-pilih="${esc(l.id)}">Tampilkan</button>` : ''}
            ${daftar.length > 1 ? `<button type="button" class="icon" data-lp-hapus="${esc(l.id)}" title="${n(l.id) ? 'Pindahkan / hapus perangkatnya dulu' : 'Hapus layer'}"${n(l.id) ? ' disabled' : ''} aria-label="Hapus layer ${esc(l.nama)}">✕</button>` : ''}</td></tr>`).join('')}
      </table>
      <div class="btn-row"><button type="button" class="small" data-lp-tambah>+ Tambah layer</button></div>
      <h3 style="margin:14px 0 4px;font-size:14px">Impor event lain sebagai layer</h3>
      <p class="muted small" style="margin:0 0 6px">Semua perangkat event itu (posisi, uplink &amp; port, konfigurasi, status, foto bukti) disalin menjadi layer baru di event ini.
        Posisi disesuaikan bila ukuran denah berbeda. Event asal tidak berubah.</p>
      <div class="inline lp-impor"><select id="lp-sumber" aria-label="Event sumber"><option value="">Memuat daftar event…</option></select>
        <button type="button" class="small primary" data-lp-impor>Impor sebagai layer</button></div>`;
    api(API + '?action=list').then(res => {
      const s = $('#lp-sumber');
      if (!s) return;
      const lain = res.proyek.filter(x => x.id !== S.proyek.id);
      s.innerHTML = lain.length ? '<option value="">Pilih event…</option>' + lain.map(x => `<option value="${x.id}">${esc(x.nama)}${x.venue ? ' · ' + esc(x.venue) : ''}</option>`).join('')
        : '<option value="">(tidak ada event lain)</option>';
    }).catch(() => {});
  }

  $('#proyek-pane').addEventListener('change', e => {
    const t = e.target;
    if (!t.matches('[data-lp-nama], [data-lp-warna]')) return;
    const arr = lapisanSekarang();
    const l = arr.find(x => x.id === (t.dataset.lpNama || t.dataset.lpWarna));
    if (!l) return;
    if (t.dataset.lpNama) {
      if (!t.value.trim()) return toast('Nama layer wajib diisi', true);
      l.nama = t.value.trim();
    } else l.warna = t.value;
    simpanLapisan(arr);
  });
  $('#proyek-pane').addEventListener('click', async e => {
    if (e.target.closest('[data-lp-tambah]')) {
      const arr = lapisanSekarang();
      if (arr.length >= 12) return toast('Maksimal 12 layer', true);
      arr.push(lapisanBaru(arr));
      return simpanLapisan(arr);
    }
    const h = e.target.closest('[data-lp-hapus]');
    if (h) {
      const arr = lapisanSekarang().filter(l => l.id !== h.dataset.lpHapus);
      return simpanLapisan(arr.length > 1 ? arr : []);
    }
    const pl = e.target.closest('[data-lapisan-pilih]');
    if (pl && e.target.closest('#card-lapisan')) {
      setLapisan(pl.dataset.lapisanPilih);
      return go('denah');
    }
    if (e.target.closest('[data-lp-impor]')) {
      const s = $('#lp-sumber');
      const sumber = s && +s.value;
      if (!sumber) return toast('Pilih event sumber terlebih dahulu', true);
      const namaSumber = s.options[s.selectedIndex].textContent.replace(/ · .*$/, '');
      const arr = lapisanSekarang();
      if (arr.length >= 12) return toast('Maksimal 12 layer', true);
      const baru = lapisanBaru(arr, namaSumber.slice(0, 60));
      // Sudah ada layer bernama sama: kemungkinan event ini sudah pernah diimpor (perangkat akan dobel).
      const kembar = arr.find(l => l.nama.trim().toLowerCase() === namaSumber.trim().toLowerCase());
      if (kembar && !confirm(`Layer "${kembar.nama}" sudah ada — event ini kemungkinan sudah pernah diimpor, perangkatnya akan menjadi dobel.\nTetap impor lagi sebagai layer baru?`)) return;
      if (!kembar && !confirm(`Salin semua perangkat "${namaSumber}" menjadi layer baru "${baru.nama}" di event ini?\nEvent asal tidak berubah.`)) return;
      arr.push(baru);
      const btn = e.target.closest('[data-lp-impor]');
      btn.disabled = true;
      btn.textContent = 'Mengimpor…';
      try {
        const res = await api(API, { action: 'lapisan_impor', id: S.proyek.id, sumber_id: sumber, lapisan: arr, lapisan_id: baru.id, lantai_id: S.lantai || 'F1' });
        S.proyek = res.proyek;
        S.list = res.perangkat;
        S.foto = res.foto || [];
        S.unit = res.unit || S.unit;
        resetRiwayat();
        refreshModel();
        renderLapisanCard();
        toast(`${res.jumlah} perangkat diimpor sebagai layer "${baru.nama}"`);
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.textContent = 'Impor sebagai layer';
      }
    }
  });

  // ------------------------------------------------------------------------ kartu lantai (tab Proyek)

  /** Daftar lantai tersimpan untuk dikirim ulang: [{id, nama, tinggi}] urut bawah -> atas (minimal F1). */
  function lantaiSekarang() {
    return S.model.lantaiList().map(l => ({ id: l.id, nama: l.nama, tinggi: l.tinggi }));
  }
  function lantaiBaru(arr) {
    const no = Math.max(0, ...arr.map(l => +l.id.slice(1))) + 1;
    return { id: 'F' + no, nama: 'Lantai ' + (arr.length + 1), tinggi: 4 };
  }
  async function simpanLantai(arr) {
    try {
      const res = await enqueue(() => api(API, { action: 'lantai_save', id: S.proyek.id, lantai: arr }));
      S.proyek = res.proyek;
      refreshModel();
      renderLantaiCard();
    } catch (err) {
      toast(err.message, true);
      renderLantaiCard();
    }
  }

  function renderLantaiCard() {
    const box = $('#card-lantai');
    if (!box) return;
    const m = S.model;
    const daftar = m.lantaiList();
    const n = id => m.list.filter(d => m.lantaiOf(d) === id).length;
    const skalaTxt = l => (l.skala ? `1 px = ${(l.skala * 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })} cm` : '<span class="bad">belum dikalibrasi</span>');
    box.innerHTML = `<h2>Lantai gedung</h2>
      <p class="muted small">Satu gedung dengan denah berbeda per lantai. Tiap lantai punya gambar denah &amp; skala sendiri; layer jaringan tetap bisa melintasi lantai.
        Kabel ke perangkat di lantai lain ditandai <b>⇅</b> (riser) dan panjangnya = jalur di denah sampai titik riser + selisih ketinggian lantai.
        Titik riser = posisi uplink pada denah lantai ini (denah antar lantai dianggap sejajar).</p>
      <div class="lt-list">${daftar.slice().reverse().map(l => {
        const i = daftar.indexOf(l);
        return `<div class="lt-row" data-lt="${esc(l.id)}">
          <div class="lt-thumb">${denahUrl(l.id) ? `<img src="${esc(denahUrl(l.id))}" alt="" loading="lazy">` : '<span>Belum ada denah</span>'}</div>
          <div class="lt-isi">
            <div class="inline"><input type="text" value="${esc(l.nama)}" maxlength="60" data-lt-nama aria-label="Nama lantai">
              <label class="lt-tinggi" title="Tinggi lantai ke lantai (untuk panjang kabel riser)"><input type="number" min="0" max="50" step="0.1" value="${l.tinggi}" data-lt-tinggi aria-label="Tinggi lantai"> m</label></div>
            <p class="muted small">${n(l.id)} perangkat · ${l.denah_w ? `${l.denah_w} × ${l.denah_h} px · ` : ''}skala ${skalaTxt(l)} · elevasi ${l.elev.toLocaleString('id-ID')} m</p>
            ${l.utama ? '<p class="muted small">Denah utama — ganti gambarnya di kartu <b>Denah venue</b>.</p>'
              : `<div class="inline lt-up"><label class="btn small">${l.denah_v ? 'Ganti' : 'Upload'} denah<input type="file" data-lt-file accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf" hidden></label>
                ${l.denah_v ? `<label class="check small"><input type="checkbox" data-lt-sesuai checked><span>Venue sama (skalakan posisi)</span></label>` : ''}
                ${l.skala ? '<button type="button" class="small ghost" data-lt-skala-reset>Hapus kalibrasi</button>' : ''}</div>`}
          </div>
          <div class="lt-aksi">
            <button type="button" class="small ghost" data-lt-pilih>Tampilkan</button>
            <button type="button" class="icon" data-lt-geser="1" title="Naikkan urutan"${i === daftar.length - 1 ? ' disabled' : ''} aria-label="Naik">↑</button>
            <button type="button" class="icon" data-lt-geser="-1" title="Turunkan urutan"${i === 0 ? ' disabled' : ''} aria-label="Turun">↓</button>
            ${l.utama ? '' : `<button type="button" class="icon" data-lt-hapus title="${n(l.id) ? 'Pindahkan perangkatnya dulu' : 'Hapus lantai'}"${n(l.id) ? ' disabled' : ''} aria-label="Hapus lantai">✕</button>`}
          </div></div>`;
      }).join('')}</div>
      <div class="btn-row"><button type="button" class="small" data-lt-tambah>+ Tambah lantai</button></div>`;
  }

  $('#proyek-pane').addEventListener('change', async e => {
    const row = e.target.closest('#card-lantai [data-lt]');
    if (!row) return;
    const lid = row.dataset.lt;
    const t = e.target;
    if (t.matches('[data-lt-nama], [data-lt-tinggi]')) {
      const arr = lantaiSekarang();
      const l = arr.find(x => x.id === lid);
      if (t.matches('[data-lt-nama]')) {
        if (!t.value.trim()) return toast('Nama lantai wajib diisi', true);
        l.nama = t.value.trim();
      } else l.tinggi = Math.max(0, Math.min(50, parseFloat(t.value) || 0));
      return simpanLantai(arr);
    }
    if (t.matches('[data-lt-file]') && t.files[0]) {
      const s = row.querySelector('[data-lt-sesuai]');
      const fd = new FormData();
      fd.append('action', 'lantai_denah');
      fd.append('id', S.proyek.id);
      fd.append('lantai_id', lid);
      fd.append('sesuaikan', s && s.checked ? '1' : '0');
      try {
        fd.append('denah', await siapkanDenah(t.files[0]));
      } catch (err) {
        t.value = '';
        return toast(err.message, true);
      }
      toast('Mengunggah denah…');
      try {
        const res = await api(API, fd);
        S.proyek = res.proyek;
        S.list = res.perangkat;
        refreshModel();
        renderLantaiCard();
        toast(`Denah ${S.model.lantaiById(lid).nama} tersimpan`);
      } catch (err) {
        toast(err.message, true);
        t.value = '';
      }
    }
  });
  $('#proyek-pane').addEventListener('click', async e => {
    if (!e.target.closest('#card-lantai')) return;
    if (e.target.closest('[data-lt-tambah]')) {
      const arr = lantaiSekarang();
      if (arr.length >= 30) return toast('Maksimal 30 lantai', true);
      arr.push(lantaiBaru(arr));
      return simpanLantai(arr);
    }
    const row = e.target.closest('[data-lt]');
    if (!row) return;
    const lid = row.dataset.lt;
    if (e.target.closest('[data-lt-pilih]')) {
      go('denah');
      return setLantai(lid);
    }
    const g = e.target.closest('[data-lt-geser]');
    if (g) {
      const arr = lantaiSekarang();
      const i = arr.findIndex(l => l.id === lid);
      const j = i + +g.dataset.ltGeser;
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return simpanLantai(arr);
    }
    if (e.target.closest('[data-lt-hapus]')) {
      const L = S.model.lantaiById(lid);
      if (!confirm(`Hapus ${L.nama} beserta gambar denahnya?`)) return;
      return simpanLantai(lantaiSekarang().filter(l => l.id !== lid));
    }
    if (e.target.closest('[data-lt-skala-reset]')) {
      if (!confirm('Hapus kalibrasi skala lantai ini?')) return;
      try {
        const res = await enqueue(() => api(API, { action: 'lantai_skala', id: S.proyek.id, lantai_id: lid, skala: null }));
        S.proyek = res.proyek;
        refreshModel();
        renderLantaiCard();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  async function muatAkses() {
    const card = $('#card-akses');
    if (!card || !S.proyek) return;
    try {
      aksesList = (await api(`${API}?action=akses_list&id=${S.proyek.id}`)).akses;
      const cu = $('#card-usulan');
      if (cu) cu.innerHTML = usulanCardHtml(); // petunjuk "belum ada akses installer" bergantung pada daftar akses
    } catch (e) {
      card.innerHTML = `<h2>Akses tim</h2><p class="err-text">${esc(e.message)}</p>`;
      return;
    }
    card.innerHTML = `<h2>Akses tim <span class="spacer"></span><button type="button" class="small primary" data-akses="baru">+ Tambah akses</button></h2>
      <p class="muted small">Link khusus per tim/anggota tanpa password admin. Tim <b>update status</b> hanya bisa mengubah status yang Anda izinkan, pada kategori tugasnya; <b>installer</b> juga bisa mengusulkan alat baru. Setiap perubahan tercatat di <i>Aktivitas tim</i>.</p>
      ${aksesList.length ? aksesList.map(a => `<div class="akses-row${a.aktif ? '' : ' nonaktif'}" data-id="${a.id}">
        <div class="akses-top"><b>${esc(a.nama)}</b>${a.aktif ? '' : ' <span class="lv warn">nonaktif</span>'}
          <span class="muted small">${a.terakhir_dipakai ? 'dibuka ' + esc(new Date(a.terakhir_dipakai.replace(' ', 'T')).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : 'belum pernah dibuka'}</span></div>
        ${aksesRingkas(a)}
        <div class="inline akses-link"><input type="text" readonly value="${esc(aksesLink(a))}" class="mono small-input" onclick="this.select()">
          <button type="button" class="small" data-akses="salin">Salin</button>
          <button type="button" class="small" data-akses="qr">QR</button></div>
        <div class="akses-qr" hidden></div>
        <div class="btn-row"><button type="button" class="small" data-akses="ubah">Ubah</button>
          <button type="button" class="small" data-akses="token" title="Link lama tidak berlaku lagi">Ganti link</button>
          <button type="button" class="small danger" data-akses="hapus">Hapus</button></div>
      </div>`).join('') : '<p class="muted">Belum ada akses tim.</p>'}`;
  }

  async function muatAktivitas() {
    const card = $('#card-aktivitas');
    if (!card || !S.proyek) return;
    try {
      const res = S.tim
        ? await api(`api/tim.php?t=${encodeURIComponent(S.tim)}&action=log`)
        : await api(`${API}?action=log_list&id=${S.proyek.id}`);
      card.innerHTML = `<h2>Aktivitas tim <span class="spacer"></span><button type="button" class="small" data-akses="muat-log">Muat ulang</button></h2>
        ${logHtml(res.log, true) || '<p class="muted">Belum ada perubahan status atau catatan lapangan.</p>'}`;
    } catch (e) {
      card.innerHTML = `<h2>Aktivitas tim</h2><p class="err-text">${esc(e.message)}</p>`;
    }
  }

  // Dialog tambah / ubah akses
  let aksesEdit = null;
  $('#akses-status-list').innerHTML = Object.keys(STATUS).filter(k => k !== 'usulan').map(k =>
    `<label class="cek"><input type="checkbox" name="status_boleh" value="${k}"> <span class="st st-${k}">${esc(STATUS[k].label)}</span></label>`).join('');
  $('#akses-jenis-list').innerHTML = TYPE_ORDER.map(j =>
    `<label class="cek"><input type="checkbox" name="jenis_boleh" value="${j}"> ${esc(TYPES[j].label)}</label>`).join('');

  function bukaAkses(a) {
    aksesEdit = a || null;
    const f = $('#form-akses');
    f.reset();
    $('#dlg-akses-title').textContent = a ? 'Ubah akses tim' : 'Tambah akses tim';
    f.elements.nama.value = a ? a.nama : '';
    f.querySelector(`[name=peran][value="${a ? a.peran : 'status'}"]`).checked = true;
    // Bawaan akses baru: tim lapangan boleh menandai terpasang & bermasalah.
    const st = a ? a.status_boleh : ['terpasang', 'bermasalah'];
    f.querySelectorAll('[name=status_boleh]').forEach(c => { c.checked = st.includes(c.value); });
    f.querySelectorAll('[name=jenis_boleh]').forEach(c => { c.checked = !!a && a.jenis_boleh.includes(c.value); });
    f.elements.lihat_password.checked = !!(a && a.lihat_password);
    f.elements.aktif.checked = a ? !!a.aktif : true;
    syncAkses();
    $('#dlg-akses').showModal();
    f.elements.nama.focus();
  }
  function syncAkses() {
    $('#akses-status').hidden = !['status', 'installer'].includes($('#form-akses').elements.peran.value);
  }
  $('#form-akses').addEventListener('change', syncAkses);
  $('#form-akses [data-close]').addEventListener('click', () => $('#dlg-akses').close());
  $('#form-akses').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const val = n => [...f.querySelectorAll(`[name=${n}]:checked`)].map(c => c.value);
    try {
      await api(API, {
        action: 'akses_save', id: aksesEdit ? aksesEdit.id : null, proyek_id: S.proyek.id, nama: f.elements.nama.value,
        peran: f.elements.peran.value, status_boleh: val('status_boleh'), jenis_boleh: val('jenis_boleh'),
        lihat_password: f.elements.lihat_password.checked, aktif: f.elements.aktif.checked,
      });
      $('#dlg-akses').close();
      toast(aksesEdit ? 'Akses diperbarui' : 'Akses tim dibuat — salin link-nya untuk tim');
      muatAkses();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#proyek-pane').addEventListener('click', async e => {
    const sel = e.target.closest('#card-aktivitas [data-sel]');
    if (sel) {
      e.preventDefault();
      const id = +sel.dataset.sel;
      S.sel = id;
      go('denah');
      return setTimeout(() => selectDev(id, true), 60);
    }
    const b = e.target.closest('[data-akses]');
    if (!b) return;
    const row = b.closest('.akses-row');
    const a = row && aksesList.find(x => x.id === +row.dataset.id);
    switch (b.dataset.akses) {
      case 'baru': return bukaAkses(null);
      case 'muat-log': return muatAktivitas();
      case 'ubah': return bukaAkses(a);
      case 'salin': return copy(aksesLink(a));
      case 'qr': {
        const q = row.querySelector('.akses-qr');
        q.hidden = !q.hidden;
        if (!q.hidden) q.innerHTML = qrSvg(aksesLink(a));
        return;
      }
      case 'token':
        if (!confirm(`Buat link baru untuk "${a.nama}"? Link lama langsung tidak berlaku.`)) return;
        try {
          await api(API, { action: 'akses_token_baru', id: a.id });
          toast('Link baru dibuat');
          muatAkses();
        } catch (err) {
          toast(err.message, true);
        }
        return;
      case 'hapus':
        if (!confirm(`Hapus akses "${a.nama}"? Link-nya langsung tidak berlaku. Riwayat aktivitasnya tetap tersimpan.`)) return;
        try {
          await api(API, { action: 'akses_delete', id: a.id });
          toast('Akses dihapus');
          muatAkses();
        } catch (err) {
          toast(err.message, true);
        }
    }
  });

  function qrSvg(text) {
    if (typeof qrcode !== 'function') return '';
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }

  // Password admin event: buat / ganti.
  $('#proyek-pane').addEventListener('submit', async e => {
    if (e.target.id !== 'form-pw-event') return;
    e.preventDefault();
    const pw = e.target.elements.password.value;
    try {
      const res = await enqueue(() => api(API, { action: 'proyek_password', id: S.proyek.id, password: pw, lama: e.target.elements.lama ? e.target.elements.lama.value : '' }));
      S.proyek = res.proyek;
      renderProyek();
      prompt('Password admin event tersimpan. Salin  berikan ke PIC event (tidak bisa dilihat lagi):', pw);
    } catch (err) {
      setSaveState('error');
      toast(err.message, true);
    }
  });

  $('#proyek-pane').addEventListener('submit', async e => {
    if (e.target.id !== 'form-catatan') return;
    e.preventDefault();
    const f = e.target;
    const p = S.proyek;
    try {
      const res = await enqueue(() => api(API, {
        action: 'proyek_save', id: p.id, nama: p.nama, venue: p.venue, tanggal_mulai: p.tanggal_mulai, tanggal_selesai: p.tanggal_selesai,
        catatan: f.elements.catatan.value, slack_kabel: f.elements.slack_kabel.value,
      }));
      S.proyek = res.proyek;
      refreshModel();
      toast('Tersimpan');
    } catch (err) {
      setSaveState('error');
      toast(err.message, true);
    }
  });

  $('#proyek-pane').addEventListener('change', async e => {
    if (e.target.id !== 'denah-file' || !e.target.files[0]) return;
    const s = $('#denah-sesuaikan');
    try {
      const res = await uploadDenah(S.proyek.id, e.target.files[0], s ? s.checked : false);
      S.proyek = res.proyek;
      S.list = res.perangkat;
      refreshModel();
      peta.fit();
      toast('Denah tersimpan');
    } catch (err) {
      toast(err.message, true);
      e.target.value = '';
    }
  });

  $('#proyek-pane').addEventListener('click', async e => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const p = S.proyek;
    const run = async (body, msg) => {
      try {
        const res = await enqueue(() => api(API, body));
        if (res.proyek) S.proyek = res.proyek;
        refreshModel();
        if (msg) toast(msg);
        return res;
      } catch (err) {
        setSaveState('error');
        toast(err.message, true);
      }
    };
    switch (b.dataset.p) {
      case 'grup':
        e.preventDefault();
        return pilihPjGrup(b.dataset.g);
      case 'lihat-dev': {
        e.preventDefault();
        const id = +b.dataset.id;
        S.sel = id;
        go('denah');
        setTimeout(() => selectDev(id, true), 60);
        return;
      }
      case 'edit': return openProyekDialog(p);
      case 'copy': return copy(b.dataset.link);
      case 'kode-baru':
        if (confirm('Buat link baru? Link lama tidak bisa dipakai lagi.')) await run({ action: 'kode_baru', id: p.id }, 'Link baru dibuat');
        return;
      case 'skala-reset':
        if (confirm('Hapus kalibrasi skala?')) await run({ action: 'proyek_skala', id: p.id, skala: null }, 'Kalibrasi dihapus');
        return;
      case 'denah-del':
        if (confirm('Hapus gambar denah? Posisi perangkat tetap tersimpan.')) await run({ action: 'denah_hapus', id: p.id }, 'Denah dihapus');
        return;
      case 'dup': {
        const res = await run({ action: 'proyek_duplicate', id: p.id });
        if (res) {
          toast('Event diduplikat');
          location.hash = `#/p/${res.proyek.id}/proyek`;
        }
        return;
      }
      case 'del':
        if (await hapusEvent(p.id, p.nama, S.list.length)) {
          S.proyek = null;
          location.hash = '#/';
        }
        return;
      case 'pw-hapus':
        if (!confirm(`Hapus password admin event "${p.nama}"? Admin event yang sedang login langsung keluar.`)) return;
        await run({ action: 'proyek_password', id: p.id, password: '' }, 'Password admin event dihapus');
        return renderProyek();
      case 'backup':
        return NP.Backup.buat([p.id], 'netplan-' + slug(p.nama), false).catch(err => toast(err.message, true));
      case 'del-all':
        return hapusSemuaPerangkat();
    }
  });

  /** Konfirmasi tindakan berbahaya: pengguna harus mengetik nama event. */
  function konfirmasiNama(nama, pesan) {
    const v = prompt(`${pesan}\n\nTindakan ini tidak bisa dibatalkan. Ketik nama event untuk melanjutkan:\n${nama}`);
    if (v == null) return false;
    if (v.trim().toLowerCase() !== nama.trim().toLowerCase()) {
      toast('Nama event tidak cocok — tidak ada yang dihapus', true);
      return false;
    }
    return true;
  }

  /** Hapus event beserta denah & semua perangkatnya. true bila berhasil. */
  async function hapusEvent(id, nama, jumlah) {
    if (!konfirmasiNama(nama, `Hapus event "${nama}" beserta denah dan ${jumlah} perangkatnya?`)) return false;
    try {
      await api(API, { action: 'proyek_delete', id });
      toast('Event dihapus');
      return true;
    } catch (err) {
      toast(err.message, true);
      return false;
    }
  }

  /** Kosongkan event: semua perangkat dihapus, event/denah/skala tetap. */
  async function hapusSemuaPerangkat() {
    const p = S.proyek;
    if (!S.list.length) return toast('Event ini belum punya perangkat');
    if (!konfirmasiNama(p.nama, `Hapus SEMUA ${S.list.length} perangkat di event "${p.nama}"?\nEvent, denah, dan skala tetap tersimpan.`)) return;
    try {
      const res = await enqueue(() => api(API, { action: 'perangkat_hapus_semua', id: p.id }));
      S.proyek = res.proyek;
      S.list = res.perangkat;
      S.sel = null;
      S.parentCtx = null;
      refreshModel();
      toast(`${res.jumlah} perangkat dihapus`);
    } catch (err) {
      setSaveState('error');
      toast(err.message, true);
    }
  }

  // ======================================================================== cetak

  /**
   * SVG statis denah untuk laporan cetak (ukuran titik relatif terhadap area yang ditampilkan).
   * opts.vb = [x, y, w, h] untuk potongan denah; opts.focus = id perangkat yang disorot; opts.cls = kelas SVG.
   */
  function staticMap(opts) {
    opts = opts || {};
    const m = S.model;
    // Laporan gabungan beberapa layer: titik warna layer di kiri bawah tiap perangkat.
    const lpPeta = kolomLapisan(true);
    // Lantai yang digambar: opts.lantai, lantai perangkat fokus, atau lantai yang tampil di peta.
    const fd = opts.focus != null && m.byId.get(opts.focus);
    const lid = opts.lantai || (fd ? m.lantaiOf(fd) : S.lantai || 'F1');
    const { W, H, img } = ukuranLantai(lid);
    const vb = opts.vb || [0, 0, W, H];
    const u = Math.max(vb[2], vb[3]) / 1100 * (opts.vb ? 2.2 : 1);
    const r = 9 * u;
    let h = `<svg viewBox="${vb.join(' ')}" xmlns="http://www.w3.org/2000/svg" class="${opts.cls || 'print-map'}" preserveAspectRatio="xMidYMid ${opts.vb ? 'slice' : 'meet'}">`;
    if (opts.vb) h += `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fff"/>`;
    h += img ? `<rect width="${W}" height="${H}" fill="#fff"/><image href="${esc(img)}" width="${W}" height="${H}" opacity="${peta.opacity}"/>` : `<rect width="${W}" height="${H}" fill="#fff" stroke="#ccc"/>`;
    // opts.filter(d): hanya perangkat ini yang digambar; opts.redup(d): digambar samar (konteks). opts.pwr: garis listrik.
    const diLantai = d => !multiLantai() || m.lantaiOf(d) === lid;
    const lolos = d => !opts.filter || opts.filter(d);
    const utama = d => diLantai(d) && lolos(d);
    const samar = d => diLantai(d) && !lolos(d) && !!opts.redup && opts.redup(d);
    const tampil = d => utama(d) || samar(d);
    if (opts.pwr) {
      for (const d of m.list) {
        const L = m.listrikOf(d);
        if (!L || !tampil(d) || !tampil(L)) continue;
        h += `<line x1="${d.x}" y1="${d.y}" x2="${L.x}" y2="${L.y}" stroke="#fff" stroke-width="${5 * u}" opacity=".85"/>
          <line x1="${d.x}" y1="${d.y}" x2="${L.x}" y2="${L.y}" stroke="#ca8a04" stroke-width="${2.6 * u}" stroke-dasharray="${2 * u} ${5 * u}" stroke-linecap="round"/>`;
      }
    }
    for (const d of m.list) {
      if (!utama(d)) continue;
      const rr = d.jenis === 'ap' && m.apRadiusPx(d);
      const sk = d.jenis === 'ap' && NP.sektor(d);
      const covAttr = `fill="${TYPES.ap.color}" fill-opacity="${sk ? '.14' : '.08'}" stroke="${TYPES.ap.color}" stroke-opacity=".45" stroke-width="${u}"`;
      if (rr) h += sk ? `<path d="${NP.wedgePath(d.x, d.y, rr, sk.arah, sk.lebar)}" ${covAttr}/>` : `<circle cx="${d.x}" cy="${d.y}" r="${rr}" ${covAttr}/>`;
    }
    for (const d of m.list) {
      const p = m.parentOf(d);
      const riser = p && multiLantai() && m.bedaLantai(d, p);
      if (!p || NP.kabelTertanam(d) || !utama(d) || !(riser ? lolos(p) : utama(p))) continue;
      const md = MEDIA[d.media] || MEDIA.utp;
      const kl = m.koneksiLink(d);
      const color = kl === 'online' ? md.color || '#0369a1' : KONEKSI[kl].color;
      const dash = kl === 'offline' ? '1 7' : kl === 'gangguan' ? '10 5' : md.dash;
      const pts = m.routePts(d).map(q => q.x + ',' + q.y).join(' ');
      h += `<polyline points="${pts}" fill="none" stroke-linejoin="round" stroke-linecap="round" stroke="#fff" stroke-width="${6.5 * u}" opacity=".9"/>
        <polyline points="${pts}" fill="none" stroke-linejoin="round" stroke-linecap="round" stroke="${color}" stroke-width="${3.6 * u}" stroke-dasharray="${dash ? dash.split(' ').map(x => x * u).join(' ') : ''}"/>`;
      if (riser) {
        // Kabel ke lantai lain: penanda ⇅ di titik riser + nama uplink & lantainya.
        const e = m.routePts(d).slice(-1)[0];
        h += `<g transform="translate(${e.x},${e.y})"><circle r="${7 * u}" fill="#7c3aed" stroke="#fff" stroke-width="${1.5 * u}"/>
          <path d="M-2.5 4.5V-4.5M-5 -2L-2.5 -4.5L0 -2M2.5 -4.5V4.5M0 2L2.5 4.5L5 2" transform="scale(${u})" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
          <text text-anchor="middle" y="${-10 * u}" font-size="${8 * u}" font-weight="700" fill="#5b21b6" stroke="#fff" stroke-width="${3 * u}" paint-order="stroke" font-family="Arial">${esc(p.nama)} · ${esc(m.lantaiById(m.lantaiOf(p)).nama)}</text></g>`;
      }
    }
    for (const d of m.list) {
      if (!tampil(d)) continue;
      const t = NP.tampil(d);
      const K = KONEKSI[m.koneksi(d)];
      const b = r * 0.8;
      const bolt = NP.isListrik(d) ? `<path d="M${1.8 * u} ${-8.5 * u} L${-5 * u} ${1.2 * u} H${-0.6 * u} L${-1.8 * u} ${8.5 * u} L${5 * u} ${-1.2 * u} H${0.6 * u} Z" fill="#fff"/>` : '';
      h += `<g transform="translate(${d.x},${d.y})"${samar(d) ? ' opacity=".35"' : ''}>
        ${t.ikon ? `<rect x="${-(r + 2.5 * u)}" y="${-(r + 2.5 * u)}" width="${(r + 2.5 * u) * 2}" height="${(r + 2.5 * u) * 2}" rx="${5 * u}" fill="#fff" stroke="${(STATUS[d.status] || STATUS.rencana).color}" stroke-width="${2 * u}"/>
        <rect x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" rx="${3.5 * u}" fill="${t.color}"/>
        <g transform="translate(${-r * 0.75},${-r * 0.75})">${NP.ikonSvg(t.ikon, r * 1.5)}</g>`
        : `<circle r="${r + 2.5 * u}" fill="#fff" stroke="${(STATUS[d.status] || STATUS.rencana).color}" stroke-width="${2 * u}"/>
        ${d.jenis === 'ap' && NP.sektor(d) ? (s => `<path d="${NP.wedgePath(0, 0, r * 2.2, s.arah, s.lebar)}" fill="${TYPES.ap.color}" fill-opacity=".35"/>`)(NP.sektor(d)) : ''}
        <circle r="${r}" fill="${t.color}"/>
        ${bolt || `<text text-anchor="middle" dy=".35em" font-size="${(t.short.length > 2 ? 6.5 : 8) * u}" font-weight="700" fill="#fff" font-family="Arial">${esc(t.short)}</text>`}`}
        ${lpPeta.length ? `<circle cx="${-b}" cy="${b}" r="${4.2 * u}" fill="${esc(m.lapisanById(m.lapisanOf(d)).warna)}" stroke="#fff" stroke-width="${1.2 * u}"/>` : ''}
        ${NP.nonJaringan(d) || opts.tanpaInternet ? '' : `<circle cx="${b}" cy="${-b}" r="${4.5 * u}" fill="${K.color}" stroke="#fff" stroke-width="${1.2 * u}"/>
        <text x="${b}" y="${-b}" dy=".36em" text-anchor="middle" font-size="${6.5 * u}" font-weight="800" fill="#fff" font-family="Arial">${K.icon}</text>`}
        <text text-anchor="middle" y="${r + 11 * u}" font-size="${9 * u}" font-weight="700" fill="#111" stroke="#fff" stroke-width="${3 * u}" paint-order="stroke" font-family="Arial">${esc(d.nama)}</text>
      </g>`;
    }
    // Label & panah lantai ini (bila ditampilkan di peta): kotak berwarna + panah ke titik / perangkat.
    if (peta.layers.anotasi && !opts.tanpaLabel) {
      const fs = 11 * u, pad = 6 * u, lh = fs * 1.3;
      for (const a of anotList().filter(x => (x.lantai || 'F1') === lid)) {
        const Wn = NP.ANOT_WARNA[a.warna] || NP.ANOT_WARNA.hijau;
        const baris = String(a.teks || 'Label').split('\n').slice(0, 12);
        const w = Math.max(...baris.map(t => t.length)) * fs * 0.56 + pad * 2.5, bh = baris.length * lh + pad * 1.4;
        const dv = a.ke != null && m.byId.get(a.ke);
        if (a.panah !== false) {
          // Sama dengan peta: keluar dari tengah sisi kotak yang menghadap ujung, garis berhenti di pangkal kepala panah.
          const ux = dv ? dv.x : a.tx, uy = dv ? dv.y : a.ty;
          const ddx = ux - a.x, ddy = uy - a.y;
          const datar = Math.abs(ddx) / (w / 2) > Math.abs(ddy) / (bh / 2);
          const bx = datar ? a.x + Math.sign(ddx) * w / 2 : a.x, by = datar ? a.y : a.y + Math.sign(ddy) * bh / 2;
          let dx = ux - bx, dy = uy - by, len = Math.hypot(dx, dy) || 1;
          const ex = ux - (dv ? dx / len * (r + 4 * u) : 0), ey = uy - (dv ? dy / len * (r + 4 * u) : 0);
          dx = ex - bx; dy = ey - by; len = Math.hypot(dx, dy) || 1;
          const nx = dx / len, ny = dy / len, k = 9 * u;
          if (!(Math.abs(ddx) <= w / 2 && Math.abs(ddy) <= bh / 2) && len > k + 4 * u) {
            const lx = ex - nx * k * 0.85, ly = ey - ny * k * 0.85;
            h += `<line x1="${bx}" y1="${by}" x2="${lx}" y2="${ly}" stroke="#fff" stroke-width="${4.5 * u}" stroke-linecap="round"/>
              <line x1="${bx}" y1="${by}" x2="${lx}" y2="${ly}" stroke="${Wn.tepi}" stroke-width="${2.2 * u}" stroke-linecap="round"/>
              <path d="M${ex} ${ey}L${ex - nx * k - ny * k * 0.55} ${ey - ny * k + nx * k * 0.55}L${ex - nx * k + ny * k * 0.55} ${ey - ny * k - nx * k * 0.55}Z" fill="${Wn.tepi}"/>`;
          }
        }
        // Teks di tengah kotak: rata tengah, baris pertama digeser agar blok teks terpusat vertikal.
        const y0 = a.y - (baris.length - 1) * lh / 2 + fs * 0.36;
        h += `<rect x="${a.x - w / 2}" y="${a.y - bh / 2}" width="${w}" height="${bh}" rx="${4 * u}" fill="${Wn.bg}" stroke="${Wn.tepi}" stroke-width="${1.2 * u}"/>
          <text x="${a.x}" y="${y0}" text-anchor="middle" font-size="${fs}" font-weight="600" font-family="Arial" fill="${Wn.fg}">${baris.map((t, i) => `<tspan x="${a.x}" dy="${i ? lh : 0}">${esc(t)}</tspan>`).join('')}</text>`;
      }
    }
    const f = opts.focus != null && m.byId.get(opts.focus);
    if (f) {
      h += `<circle cx="${f.x}" cy="${f.y}" r="${r + 9 * u}" fill="none" stroke="#dc2626" stroke-width="${3 * u}"/>
        <circle cx="${f.x}" cy="${f.y}" r="${r + 15 * u}" fill="none" stroke="#dc2626" stroke-width="${1.2 * u}" stroke-dasharray="${4 * u} ${3 * u}"/>`;
    }
    return h + '</svg>';
  }

  /** Potongan denah 4:3 di sekitar titik d; frac = lebar potongan relatif sisi terpanjang denah (bawaan 0,3). */
  /**
   * Denah laporan: satu blok .pr-map per lantai yang berisi perangkat (judul = nama lantai); satu lantai = satu denah
   * seperti biasa. opts diteruskan ke staticMap, cls = kelas tambahan blok.
   */
  function petaLaporan(opts, cls) {
    const m = S.model;
    const blok = (isi, judul) => `<div class="pr-map${cls ? ' ' + cls : ''}">${judul ? `<div class="pr-lt">${judul}</div>` : ''}${isi}</div>`;
    if (!multiLantai()) return blok(staticMap(opts));
    const pakai = m.lantaiList().filter(L => m.list.some(d => m.lantaiOf(d) === L.id));
    return (pakai.length ? pakai : [lantaiAktif()]).slice().reverse().map(L => {
      const n = m.list.filter(d => m.lantaiOf(d) === L.id && (!opts || !opts.filter || opts.filter(d))).length;
      return blok(staticMap(Object.assign({}, opts, { lantai: L.id })), `<b>${esc(L.nama)}</b> · ${n} perangkat`);
    }).join('');
  }

  /** Ukuran & URL gambar denah satu lantai (tanpa gambar: kanvas bawaan 2000 × 1250 seperti peta). */
  function ukuranLantai(lid) {
    const L = S.model.lantaiById(lid || 'F1');
    const img = denahUrl(L.id);
    return { W: img && L.denah_w ? L.denah_w : 2000, H: img && L.denah_h ? L.denah_h : 1250, img, L };
  }

  function cropAround(d, frac) {
    const { W, H } = ukuranLantai(S.model.lantaiOf(d));
    let w = Math.max(W, H) * (frac || 0.3);
    let h = w * 0.75;
    if (w > W) { w = W; h = w * 0.75; }
    if (h > H) { h = H; w = h / 0.75; }
    const x = Math.max(0, Math.min(W - w, d.x - w / 2));
    const y = Math.max(0, Math.min(H - h, d.y - h / 2));
    return [x, y, w, h].map(v => Math.round(v * 10) / 10);
  }

  // ------------------------------------------------------------------------ dialog cetak

  const dlgPrint = $('#dlg-print');
  const formPrint = $('#form-print');

  $('#btn-print').addEventListener('click', () => {
    const nAp = S.list.filter(d => d.jenis === 'ap').length;
    const nBr = S.list.filter(d => d.jenis === 'bridge').length;
    $('#opt-bridge').hidden = !nBr;
    $('#print-info').textContent = `${nAp} access point${nBr ? ` · ${nBr} wireless bridge` : ''} · ${S.list.length} perangkat total` +
      (S.lihat ? ' · password disamarkan di link lihat-saja' : '');
    if (!nAp && !nBr) formPrint.elements.jenis.value = 'lengkap';
    // Layer jaringan: bawaan = layer yang sedang aktif di peta.
    $('#print-lapisan').hidden = !multiLapisan();
    if (multiLapisan()) {
      formPrint.elements.lapisan.innerHTML = '<option value="semua">Semua layer (laporan gabungan)</option>' +
        S.model.lapisanList().map(l => `<option value="${esc(l.id)}">${esc(l.nama)}</option>`).join('');
      formPrint.elements.lapisan.value = S.lapisan;
    }
    syncPrintOpts();
    dlgPrint.showModal();
  });
  formPrint.addEventListener('change', syncPrintOpts);
  /** Penjelasan lengkap jenis laporan terpilih (kartu hanya berisi ringkasan). */
  const DETAIL_CETAK = {
    ap: 'Satu kartu per access point: lokasi, IP/VLAN, uplink & port, SSID, password, channel, catatan, dan checklist pemasangan. Acuan teknisi saat setting AP.',
    lengkap: 'Denah bertitik (per lantai), tabel semua perangkat, kebutuhan perangkat, estimasi kabel, dan hasil pemeriksaan desain.',
    support: 'Denah khusus titik listrik & peralatan support beserta jalurnya, rekap daya per titik (MCB, terpakai, sisa), perangkat tanpa titik pemasok, dan daftar peralatan support.',
    port: 'Per switch & router: panel port berwarna, isi tiap port (uplink/WAN, antar switch, AP, titik LAN, endpoint, …), port kosong, media & status kabel, VLAN trunk/access, dan perangkat tanpa nomor port.',
    foto: 'Cetak: 1–3 foto bukti per perangkat dengan GPS & waktu, ringkasan kelengkapan foto, dan daftar yang belum difoto. PowerPoint: jumlah perangkat & tarikan LAN, penempatan perangkat di denah, dan satu slide foto per titik.',
  };
  function syncPrintOpts() {
    const j = formPrint.elements.jenis.value;
    $('#ap-opts').hidden = j !== 'ap';
    $('#btn-ap-csv').hidden = j !== 'ap';
    $('#btn-foto-pptx').hidden = j !== 'foto';
    $('#foto-opts').hidden = j !== 'foto';
    $('#btn-port-csv').hidden = j !== 'port';
    $('#print-detail').textContent = DETAIL_CETAK[j] || '';
    // Panel pengaturan hanya tampil bila ada isinya (pilihan layer / opsi jenis ini).
    $('#print-set').hidden = $('#print-lapisan').hidden && j !== 'ap' && j !== 'foto';
  }
  formPrint.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlgPrint.close()));

  function apOpts() {
    const f = formPrint.elements;
    return { password: f.password.checked && !S.lihat, peta: f.peta.checked && !!S.proyek.denah_v, bridge: f.bridge.checked };
  }

  formPrint.addEventListener('submit', e => {
    e.preventDefault();
    denganLapisan(() => cetakSesuaiJenis());
  });
  function cetakSesuaiJenis() {
    const jenis = formPrint.elements.jenis.value;
    if (jenis === 'ap') {
      if (!apList(apOpts()).length) return toast('Belum ada access point di event ini', true);
      dlgPrint.close();
      return printApSheet(apOpts());
    } else if (jenis === 'support') {
      if (!S.model.list.some(NP.nonJaringan)) return toast('Belum ada titik listrik / peralatan support di event ini', true);
      dlgPrint.close();
      return cetakLaporanSupport();
    } else if (jenis === 'port') {
      if (!S.model.list.some(d => d.jenis === 'switch' || d.jenis === 'router')) return toast('Belum ada switch / router di event ini', true);
      dlgPrint.close();
      return cetakLaporanPort();
    } else if (jenis === 'foto') {
      if (!S.foto.length) return toast('Belum ada foto bukti. Ambil foto dari panel perangkat (tab Info) lewat ponsel.', true);
      dlgPrint.close();
      return cetakLaporanFoto();
    } else {
      dlgPrint.close();
      return printReport();
    }
  }

  $('#btn-foto-pptx').addEventListener('click', () => denganLapisan(() => unduhPptFoto()));
  $('#btn-port-csv').addEventListener('click', () => denganLapisan(() => csvLaporanPort()));

  $('#btn-ap-csv').addEventListener('click', () => denganLapisan(() => {
    const o = apOpts();
    const list = apList(o);
    if (!list.length) return toast('Belum ada access point di event ini', true);
    const lpCsv = kolomLapisan(true).length > 0;
    const rows = [[...(lpCsv ? ['Layer'] : []), 'Nama', 'Jenis', 'Nama alat', 'Status', 'Internet', 'IP', 'VLAN', 'Gateway', 'Subnet', 'DNS', 'Uplink', 'Port di uplink',
      'Port lokal', 'PoE uplink', 'Media', 'Kabel (m)', 'SSID', 'Keamanan', 'Password', 'SSID tambahan', 'Band', 'Channel', 'Lebar kanal',
      'TX power', 'Target user', 'Radius (m)', 'Controller', 'Pemasangan', 'Limit (Mbps)', 'Bandwidth maks. (Mbps)', 'PIC', 'Keterangan konfigurasi']];
    for (const d of list) {
      const a = d.atribut || {};
      const n = netInfo(d);
      const k = S.model.kabelM(d);
      rows.push([...(lpCsv ? [S.model.lapisanById(S.model.lapisanOf(d)).nama] : []), d.nama, TYPES[d.jenis].label, d.model, (STATUS[d.status] || STATUS.rencana).label, KONEKSI[S.model.koneksi(d)].label,
        d.ip, d.vlan, n.gw, n.subnet, n.dns, n.up ? n.up.nama : '', d.port_uplink, d.port_lokal, n.poe, d.media ? MEDIA[d.media].label : '',
        k == null ? '' : Math.round(k), a.ssid, a.keamanan, o.password ? a.password : (a.password ? '••••' : ''), a.ssid_lain, a.band,
        a.channel || a.frekuensi, a.lebar_kanal, a.tx_power, a.maks_user, a.radius_m, a.controller, a.mounting,
        d.bandwidth_mbps == null ? '' : d.bandwidth_mbps, S.model.bwEfektif(d).mbps == null ? '' : S.model.bwEfektif(d).mbps, d.pic, d.catatan]);
    }
    downloadCsv(rows, `sheet-ap-${slug(S.proyek.nama)}.csv`);
  }));

  // ------------------------------------------------------------------------ sheet konfigurasi AP

  /** AP (dan bridge bila dipilih), urut nama alami. */
  /**
   * Jalankan pembuat laporan untuk layer yang dipilih di dialog cetak: S.model sementara hanya berisi perangkat layer
   * itu (denah, tabel, pemeriksaan, foto, PowerPoint ikut tersaring); "semua" = laporan gabungan semua layer.
   */
  async function denganLapisan(fn, lidPaksa) {
    const sel = formPrint.elements.lapisan;
    const lid = lidPaksa || (sel && !$('#print-lapisan').hidden ? sel.value : 'semua');
    if (!multiLapisan() || lid === 'semua') {
      S.labelLapisan = '';
      return fn();
    }
    const asli = S.model;
    S.model = NP.Model.create(S.proyek, S.list.filter(d => asli.lapisanOf(d) === lid), S.katalog);
    S.labelLapisan = asli.lapisanById(lid).nama;
    try {
      return await fn();
    } finally {
      S.model = asli;
      S.labelLapisan = '';
    }
  }

  function apList(o) {
    // Gabungan beberapa layer: dikelompokkan per layer dulu.
    const lp = kolomLapisan(true);
    const idx = d => (lp.length ? lp.findIndex(l => l.id === S.model.lapisanOf(d)) : 0);
    return S.model.list.filter(d => d.jenis === 'ap' || (o.bridge && d.jenis === 'bridge'))
      .sort((a, b) => idx(a) - idx(b) || (a.jenis === b.jenis ? 0 : a.jenis === 'ap' ? -1 : 1) || a.nama.localeCompare(b.nama, 'id', { numeric: true }));
  }

  /** Info jaringan dari jalur uplink: router terdekat (gateway, subnet, DNS, DHCP), perangkat uplink & PoE-nya. */
  function netInfo(d) {
    const m = S.model;
    const router = m.path(d).slice(1).find(n => n.jenis === 'router') || null;
    const ra = (router && router.atribut) || {};
    const up = m.parentOf(d);
    const ua = (up && up.atribut) || {};
    return {
      router,
      gw: router && router.ip ? router.ip.replace(/\/\d+$/, '') : '',
      subnet: ra.subnet_lan || '',
      dns: ra.dns || '',
      dhcp: ra.dhcp || '',
      up,
      poe: up && up.jenis === 'switch' ? (ua.poe || '') : '',
      wan: m.wanOf(d),
    };
  }

  function printApSheet(o) {
    const m = S.model;
    const p = S.proyek;
    const list = apList(o);
    const aps = list.filter(d => d.jenis === 'ap');
    const tgl = p.tanggal_mulai ? fmtDate(p.tanggal_mulai) + (p.tanggal_selesai && p.tanggal_selesai !== p.tanggal_mulai ? ' – ' + fmtDate(p.tanggal_selesai) : '') : '';
    const v = x => (x == null || x === '' ? '<span class="blank"></span>' : esc(x));
    const pw = x => (!x ? '<span class="blank"></span>' : o.password ? `<span class="mono">${esc(x)}</span>` : '••••••••');

    // Ringkasan SSID
    const ssid = new Map();
    for (const d of aps) {
      const a = d.atribut || {};
      const key = a.ssid || '(SSID belum diisi)';
      if (!ssid.has(key)) ssid.set(key, { keamanan: new Set(), password: new Set(), vlan: new Set(), band: new Set(), ap: [] });
      const s = ssid.get(key);
      if (a.keamanan) s.keamanan.add(a.keamanan);
      if (a.password) s.password.add(a.password);
      if (d.vlan) s.vlan.add(d.vlan);
      if (a.band) s.band.add(a.band);
      s.ap.push(d.nama);
    }
    const join = set => esc([...set].join(', ')) || '—';
    const ssidTable = aps.length ? `<h2>Ringkasan SSID</h2>
      <table class="pr-table"><thead><tr><th>SSID</th><th>Keamanan</th><th>Password</th><th>VLAN</th><th>Band</th><th>AP</th></tr></thead><tbody>
      ${[...ssid].map(([k, s]) => `<tr><td><b>${esc(k)}</b></td><td>${join(s.keamanan)}</td><td>${s.password.size ? (o.password ? `<span class="mono">${join(s.password)}</span>` : '••••••••') : '—'}</td>
        <td>${join(s.vlan)}</td><td>${join(s.band)}</td><td>${s.ap.length}: ${esc(s.ap.join(', '))}</td></tr>`).join('')}</tbody></table>` : '';

    // Rencana channel & alamat
    const planTable = `<h2>Rencana channel &amp; alamat</h2>
      <table class="pr-table plan"><thead><tr><th>Perangkat</th><th>Nama alat</th><th>IP</th><th>VLAN</th><th>Uplink : port</th><th>SSID</th><th>Band</th><th>Ch</th><th>Lebar</th><th>TX</th><th>Status</th></tr></thead><tbody>
      ${list.map(d => {
        const a = d.atribut || {};
        const up = m.parentOf(d);
        return `<tr><td><b>${esc(d.nama)}</b>${d.jenis === 'bridge' ? ' <span class="muted">(bridge)</span>' : ''}${lapisanLabel(d)}</td><td>${esc(d.model)}</td><td class="mono">${esc(d.ip)}</td><td>${esc(d.vlan)}</td>
          <td>${up ? esc(up.nama) + (d.port_uplink ? ' : ' + esc(d.port_uplink) : '') : '—'}</td><td>${esc(a.ssid)}</td><td>${esc(a.band)}</td>
          <td><b>${esc(a.channel || a.frekuensi)}</b></td><td>${esc(a.lebar_kanal)}</td><td>${esc(a.tx_power)}</td><td>${esc((STATUS[d.status] || STATUS.rencana).label)}</td></tr>`;
      }).join('')}</tbody></table>`;

    // Satu kartu per perangkat
    const cards = list.map((d, i) => {
      const t = TYPES[d.jenis];
      const a = d.atribut || {};
      const n = netInfo(d);
      const k = m.kabelM(d);
      const bw = m.bwEfektif(d);
      const kv = (label, val, cls) => `<tr${cls ? ` class="${cls}"` : ''}><th>${esc(label)}</th><td>${val}</td></tr>`;
      // Isian khusus jenis, selain SSID & password yang sudah ditampilkan besar di atas.
      const khusus = t.fields.filter(f => f.k !== 'ssid' && f.k !== 'password')
        .map(f => `<div><small>${esc(f.label)}</small><span>${v(a[f.k])}</span></div>`).join('');
      return `<section class="ap-card">
        <header class="ap-head">
          <i style="background:${t.color}">${esc(t.short)}</i>
          <div class="grow"><h3>${esc(d.nama)}</h3><span>${esc(t.label)}${d.model ? ' · ' + esc(d.model) : ''}${lapisanLabel(d)}</span></div>
          <div class="ap-meta"><span>${esc((STATUS[d.status] || STATUS.rencana).label)}</span>${konBadge(m.koneksi(d))}<span class="muted">${i + 1} / ${list.length}</span></div>
        </header>
        <div class="ap-key">
          <div><small>SSID</small><b>${v(a.ssid)}</b></div>
          <div><small>Password</small><b>${pw(a.password)}</b></div>
          <div><small>${d.jenis === 'ap' ? 'Channel' + (a.band ? ' · ' + esc(a.band) : '') : 'Frekuensi'}</small><b>${v(d.jenis === 'ap' ? a.channel : a.frekuensi)}</b></div>
          <div><small>IP</small><b class="mono">${v(d.ip)}</b></div>
        </div>
        <div class="ap-body${o.peta ? '' : ' no-map'}">
          ${o.peta ? `<div class="ap-map">${staticMap({ vb: cropAround(d), focus: d.id, cls: 'crop-map' })}<p class="muted">Lokasi ${esc(d.nama)}${a.mounting ? ' · ' + esc(a.mounting) : ''}</p></div>` : ''}
          <div class="ap-cols">
            <table class="kv-t"><caption>Jaringan</caption>
              ${kv('IP address', `<span class="mono">${v(d.ip)}</span>`)}
              ${kv('VLAN', v(d.vlan))}
              ${kv('Gateway', n.gw ? `<span class="mono">${esc(n.gw)}</span> <span class="muted">(${esc(n.router.nama)})</span>` : v(''))}
              ${kv('Subnet', v(n.subnet))}
              ${kv('DNS', v(n.dns))}
              ${kv('Sumber WAN', n.wan ? esc(n.wan.nama) + (n.wan.atribut.provider ? ' · ' + esc(n.wan.atribut.provider) : '') : '<b class="bad">belum terhubung</b>')}
            </table>
            <table class="kv-t"><caption>Uplink</caption>
              ${kv('Terhubung ke', n.up ? `<b>${esc(n.up.nama)}</b>${n.up.model ? ' · ' + esc(n.up.model) : ''}` : v(''))}
              ${kv('Port di uplink', v(d.port_uplink))}
              ${kv('Port di perangkat', v(d.port_lokal))}
              ${kv('Media / kabel', esc([d.media ? MEDIA[d.media].label : '', k != null ? '≈ ' + fmtM(k) : ''].filter(Boolean).join(' · ')) || v(''))}
              ${n.poe ? kv('PoE switch', esc(n.poe)) : ''}
              ${kv('Bandwidth', esc([d.bandwidth_mbps != null ? 'limit ' + fmtBw(d.bandwidth_mbps) : '', bw.mbps != null ? 'maks. ' + fmtBw(bw.mbps) : ''].filter(Boolean).join(' · ')) || '—')}
            </table>
          </div>
        </div>
        <div class="kv-g-wrap"><div class="cap">Setting ${esc(t.label)}</div><div class="kv-g">${khusus}</div></div>
        ${d.catatan ? `<div class="ap-note"><b>Keterangan konfigurasi</b><div class="pre">${esc(d.catatan)}</div></div>` : ''}
        <div class="ap-check">
          <div class="cl">${['Terpasang &amp; menyala', 'Firmware / adopsi controller', 'SSID &amp; password sesuai', 'Channel &amp; TX power sesuai', 'IP / VLAN sesuai', 'Label nama di perangkat'].map(x => `<span>☐ ${x}</span>`).join('')}
            <span>☐ Uji koneksi: ______ Mbps</span></div>
          <div class="sign"><span>Disetel oleh: ____________________</span><span>Tanggal / jam: ______________</span><span>Paraf: ________</span></div>
        </div>
      </section>`;
    }).join('');

    const pr = $('#print');
    pr.className = 'print ap-mode';
    pr.innerHTML = `
      <div class="pr-head"><h1>Sheet Konfigurasi Access Point</h1>
        <p><b>${esc(p.nama)}</b>${p.venue ? ' · ' + esc(p.venue) : ''}${tgl ? ' · ' + esc(tgl) : ''} · ${aps.length} AP${list.length > aps.length ? ` + ${list.length - aps.length} bridge` : ''} · dicetak ${esc(new Date().toLocaleString('id-ID'))}</p></div>
      ${o.peta ? petaLaporan(null, 'ov') : ''}
      ${ssidTable}
      ${planTable}
      ${!o.password ? '<p class="muted">Password disamarkan.</p>' : ''}
      <div class="ap-cards">${cards}</div>`;
    printWith('A4 portrait');
  }

  /** Atur ukuran halaman cetak lalu buka dialog cetak setelah gambar denah dimuat. */
  function printWith(size) {
    let st = document.getElementById('print-page');
    if (!st) {
      st = document.createElement('style');
      st.id = 'print-page';
      document.head.appendChild(st);
    }
    st.textContent = `@media print { @page { size: ${size}; margin: 10mm; } }`;
    // Tunggu semua gambar laporan (denah & foto) dimuat sebelum dialog cetak muncul; progress per gambar.
    const urls = [...new Set([...document.querySelectorAll('#print image')].map(x => x.getAttribute('href'))
      .concat([...document.querySelectorAll('#print img')].map(x => x.currentSrc || x.src)).filter(Boolean))];
    if (!urls.length) return setTimeout(() => window.print(), 50);
    progres.buka('Menyiapkan laporan', `Memuat gambar 0 dari ${urls.length}…`);
    progres.set(0);
    let n = 0;
    Promise.all(urls.map(u => new Promise(res => {
      const im = new Image();
      im.onload = im.onerror = () => {
        n++;
        progres.set(n / urls.length * 100, `Memuat gambar ${n} dari ${urls.length}…`);
        res();
      };
      im.src = u;
    }))).then(() => {
      progres.tutup();
      setTimeout(() => window.print(), 80);
    });
  }

  function printReport() {
    const m = S.model;
    const p = S.proyek;
    const tgl = p.tanggal_mulai ? fmtDate(p.tanggal_mulai) + (p.tanggal_selesai && p.tanggal_selesai !== p.tanggal_mulai ? ' – ' + fmtDate(p.tanggal_selesai) : '') : '';
    const checks = m.checks();
    const baris = d => {
      const t = TYPES[d.jenis] || TYPES.lainnya;
      const par = m.parentOf(d);
      const k = m.kabelM(d);
      return `<tr>
        <td><b>${esc(d.nama)}</b><br><span class="muted">${esc(jenisLabel(d))}${multiLantai() ? ' · ' + esc(namaLantai(d)) : ''}</span></td>
        <td>${esc(d.model)}</td>
        <td>${esc(d.ip)}${d.vlan ? '<br>VLAN ' + esc(d.vlan) : ''}</td>
        <td>${par ? esc(par.nama) + (multiLantai() && m.bedaLantai(d, par) ? ' (⇅ ' + esc(namaLantai(par)) + ')' : '') : '—'}${d.port_uplink ? ' : ' + esc(d.port_uplink) : ''}${d.port_lokal ? '<br>lokal ' + esc(d.port_lokal) : ''}</td>
        <td>${esc(d.media ? MEDIA[d.media].short : '')}${k != null ? '<br>≈ ' + esc(fmtM(k)) : ''}</td>
        <td>${esc(fmtBw(d.bandwidth_mbps))}</td>
        <td>${esc((STATUS[d.status] || STATUS.rencana).label)}<br>${konBadge(m.koneksi(d))}${d.pic ? '<br>' + esc(d.pic) : ''}</td>
        <td class="cfg">${esc(attrSummary(d, true))}${d.catatan ? `<div class="pre">${esc(d.catatan)}</div>` : ''}</td>
      </tr>`;
    };
    // Laporan gabungan beberapa layer: daftar dikelompokkan per layer (baris judul berwarna layer).
    const colsLp = kolomLapisan(true);
    const rows = colsLp.length
      ? colsLp.map(L => {
        const ds = NP.Model.sortDev(m.list.filter(d => m.lapisanOf(d) === L.id));
        return ds.length ? `<tr class="pr-grp"><td colspan="8" style="border-left:5px solid ${esc(L.warna)}"><b>Layer ${esc(L.nama)}</b> · ${ds.length} perangkat</td></tr>${ds.map(baris).join('')}` : '';
      }).join('')
      : NP.Model.sortDev(m.list).map(baris).join('');
    const bom = m.bom();
    const kb = m.kabel();
    $('#print').innerHTML = `
      <div class="pr-head"><h1>${esc(p.nama)}${S.labelLapisan ? ' — Layer ' + esc(S.labelLapisan) : ''}</h1><p>${esc([p.venue, tgl].filter(Boolean).join(' · '))} · ${m.list.length} perangkat · dicetak ${esc(new Date().toLocaleString('id-ID'))}</p></div>
      ${petaLaporan()}
      <div class="pr-legend">${TYPE_ORDER.filter(j => m.list.some(d => d.jenis === j)).map(j => `<span><i style="background:${TYPES[j].color}">${esc(TYPES[j].short)}</i>${esc(TYPES[j].label)}</span>`).join('')}
        ${lineLegend().map(x => `<span>${x.svg}${esc(x.label)}</span>`).join('')}
        ${kolomLapisan(true).map(L => `<span><i style="background:${esc(L.warna)};width:10px;height:10px"></i>Layer ${esc(L.nama)}</span>`).join('')}
        ${Object.keys(KONEKSI).map(k => `<span><i style="background:${KONEKSI[k].color}">${KONEKSI[k].icon}</i>${esc(KONEKSI[k].label)}</span>`).join('')}</div>
      ${p.catatan ? `<h2>Catatan</h2><div class="pre">${esc(p.catatan)}</div>` : ''}
      <h2>Daftar perangkat &amp; konfigurasi</h2>
      <table class="pr-table"><thead><tr><th>Perangkat</th><th>Nama alat</th><th>IP / VLAN</th><th>Uplink : port</th><th>Media / kabel</th><th>Bandwidth</th><th>Status / internet / PIC</th><th>Konfigurasi</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="pr-cols">
        <div><h2>Kebutuhan perangkat</h2>${bomTabel(bom, kolomLapisan(true), true)}
          ${Object.keys(kb.tot).length ? `<h2>Estimasi kabel</h2>${kabelTabel(kb, kolomLapisan(true), true)}` : ''}</div>
        <div><h2>Pemeriksaan desain</h2>${checks.length ? `<ul>${checks.map(c => `<li class="lv-${c.level}">${esc(c.msg)}</li>`).join('')}</ul>` : '<p>Tidak ada masalah terdeteksi.</p>'}</div>
      </div>`;
    $('#print').className = 'print';
    printWith('A4 landscape');
  }

  boot();
})();
