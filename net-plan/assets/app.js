/* Aplikasi Net Plan: daftar event, editor denah, daftar perangkat, topologi, pengaturan proyek, cetak. */
(function () {
  'use strict';
  const { TYPES, TYPE_ORDER, STATUS, MEDIA, KONEKSI, api, esc, toast, copy, downloadBlob, downloadCsv, fmtBw, fmtM, fmtDate, slug } = NP;
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
    peta.setData(S.model, denahUrl());
    peta.select(S.sel);
    if (S.tab === 'denah') {
      if (opts.keepPanel) renderPanelInfo();
      else renderPanel();
    } else {
      renderTab();
    }
    updateHint();
  }

  function denahUrl() {
    const p = S.proyek;
    if (!p || !p.denah_v) return null;
    if (S.tim) return `api/denah.php?t=${encodeURIComponent(S.tim)}&v=${p.denah_v}`;
    return S.lihat
      ? `api/denah.php?k=${encodeURIComponent(S.lihat)}&v=${p.denah_v}`
      : `api/denah.php?id=${p.id}&v=${p.denah_v}`;
  }

  async function loadProyek(id) {
    const res = S.tim
      ? await api('api/tim.php?t=' + encodeURIComponent(S.tim))
      : S.lihat
        ? await api('api/lihat.php?k=' + encodeURIComponent(S.lihat))
        : await api(API + '?action=get&id=' + id);
    if (res.akses) S.akses = res.akses;
    const changed = !S.proyek || S.proyek.id !== res.proyek.id;
    S.proyek = res.proyek;
    S.list = res.perangkat;
    S.loadedAt = Date.now();
    NP.setEndpointTipe(res.endpoint_tipe);
    if (S.lihat) {
      S.katalog = res.katalog || [];
    } else if (changed || S.katalogBasi || !S.katalog.length) {
      await muatKatalog();
    }
    if (changed) {
      S.sel = null;
      S.parentCtx = null;
      resetRiwayat();
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
    const tab = ['denah', 'daftar', 'topologi', 'proyek'].includes(m[2]) ? m[2] : 'denah';
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
      const res = await api(API, body);
      const file = !editing && f.elements.denah.files[0];
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

  async function uploadDenah(id, file, sesuaikan) {
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
      ${S.tim && S.akses ? `<span class="badge">${esc(S.akses.nama)} · ${S.akses.peran === 'status' ? 'update status' : 'lihat saja'}</span>` : S.lihat ? '<span class="badge">Lihat saja</span>' : ''}`;
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
    else if (S.tab === 'proyek') renderProyek();
  }

  // ------------------------------------------------------------------------ peta

  const peta = NP.Peta($('#map'), {
    onSelect(id) {
      selectDev(id, false);
    },
    onPlace(jenis, x, y) {
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
    onRoute(id, jalur, awal) {
      const d = S.model.byId.get(id);
      if (d && awal !== undefined) d.jalur = awal;
      saveDev(id, { jalur }, { keepPanel: true }).catch(() => {});
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
    S.sel = id;
    const d = id != null && S.model.byId.get(id);
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
    if (pilih && pilih.jenis === 'lan') return { lan: pilih, cara: 'dipilih' };
    let best = null;
    for (const d of S.list) {
      if (d.jenis !== 'lan') continue;
      const jarak = Math.hypot(d.x - x, d.y - y);
      if (!best || jarak < best.jarak) best = { lan: d, jarak };
    }
    return best ? { lan: best.lan, cara: 'terdekat' } : null;
  }

  /** Port terkecil yang belum dipakai perangkat lain di uplink tersebut (1, 2, 3, ...). */
  function portKosong(parentId) {
    const pakai = new Set(S.model.kids(parentId).map(c => parseInt(c.port_uplink, 10)).filter(n => n > 0));
    let n = 1;
    while (pakai.has(n)) n++;
    return String(n);
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
      form.elements.warna.value = '#0f766e';
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
      : lanEp ? lanEp.lan.id : (jenis !== 'isp' && parent ? parent.id : null);
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
      media: jenis === 'isp' ? '' : 'utp',
      status: 'rencana',
      // Endpoint baru memakai tipe yang dipilih di pemilih tipe (Laptop, Printer, ...).
      atribut: ep ? { tipe_endpoint: String(ep.id) } : {},
      port_uplink: jenis === 'endpoint' && uplinkId != null ? portKosong(uplinkId) : '',
    }, base || {}, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    try {
      const res = await enqueue(() => api(API, body));
      S.list.push(res.perangkat);
      S.sel = res.perangkat.id;
      refreshModel();
      peta.flash(res.perangkat.id);
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
    // Router yang sudah punya uplink dihubungkan ke Sumber WAN lain = tambah WAN (multi-WAN), bukan ganti uplink.
    if (c.jenis === 'router' && p.jenis === 'isp' && c.uplink_id != null && c.uplink_id !== parentId) {
      if (S.model.wanLain(c).some(w => w.dev.id === parentId)) return toast(`${p.nama} sudah menjadi WAN ${c.nama}`);
      simpanWan(c, [...wanList(c), { id: parentId, port: '' }], S.model.wanMode(c))
        .then(() => toast(`${p.nama} ditambahkan sebagai WAN${S.model.wanLain(c).length + 1} untuk ${c.nama} (atur mode di tab Koneksi)`));
      return;
    }
    if (S.model.descendants(childId).has(parentId)) {
      toast(`${p.nama} berada di bawah ${c.nama} — tidak bisa jadi uplinknya (loop)`, true);
      return;
    }
    const patch = { uplink_id: parentId };
    if (!c.media) patch.media = 'utp';
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
    ];
    let h = tools.map(x => `<button type="button" class="tool${x.edit ? ' edit-only' : ''}" data-tool="${x.t}" title="${x.label} (${x.key})">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="currentColor">${x.icon}</svg><span>${x.label.split(' ')[0]}</span></button>`).join('');
    h += '<div class="tb-sep edit-only">Tambah</div>';
    h += TYPE_ORDER.map((j, i) => {
      const t = TYPES[j];
      return `<button type="button" class="tool add edit-only" data-tool="tambah:${j}" title="Tambah ${t.label} (${i + 1})">
        <i style="background:${t.color}"${j === 'endpoint' ? ' class="sq"' : ''}>${j === 'endpoint' ? NP.ikonSvg('pc', 15) : esc(t.short)}</i><span>${esc(t.label.split(/[ /(]/)[0])}</span></button>`;
    }).join('');
    $('#toolbar').innerHTML = h;
    setTool('pilih');
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
      const adaLan = S.list.some(d => d.jenis === 'lan');
      h = `Klik di denah untuk menaruh <b>${esc(t.label)}</b>` +
        (ep ? (par && par.jenis === 'lan' ? ` · tersambung ke <b>${esc(par.nama)}</b> <span class="muted">(pilih titik LAN lain untuk mengganti)</span>`
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

  document.addEventListener('keydown', e => {
    if (S.tab !== 'denah' || $('#editor').hidden || document.querySelector('dialog[open]')) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const k = e.key.toLowerCase();
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
    else if (k === 'k' && S.sel != null && S.canEdit) kunciPerangkat([S.sel], !NP.terkunci(S.model.byId.get(S.sel)));
    else if (k === 'v') setTool('pilih');
    else if (k === 'l' && S.canEdit) setTool('hubung');
    else if (k === 'm') setTool('ukur');
    else if (k === 'f') peta.fit();
    else if (k === '+' || k === '=') peta.zoomBy(1.4);
    else if (k === '-') peta.zoomBy(1 / 1.4);
    else if (/^[1-9]$/.test(k) && S.canEdit) setTool('tambah:' + TYPE_ORDER[+k - 1]);
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
    if (e.altKey && !mod && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      return go(['denah', 'daftar', 'topologi', 'proyek'][+e.key - 1]);
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
      { t: S.lihat ? 'Buka Info event' : 'Buka Proyek (info, denah, akses tim)', k: 'proyek info event akses tim link', fn: () => go('proyek') },
      { t: 'Cetak laporan / sheet AP', k: 'cetak print laporan sheet ap pdf', fn: () => $('#btn-print').click() },
      { t: 'Seluruh denah (zoom pas)', k: 'fit zoom seluruh denah', fn: () => { go('denah'); setTimeout(() => peta.fit(), 80); } },
      { t: 'Pintasan keyboard', k: 'bantuan help shortcut pintasan keyboard', fn: () => $('#dlg-pintasan').showModal() },
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
      ['#list-jenis', '#list-status', '#list-koneksi'].forEach(s => { $(s).value = ''; });
      go('daftar');
      setTimeout(renderDaftar, 60);
      return;
    }
    hiddenTypes.delete(it.dev.jenis);
    peta.setHidden(new Set(hiddenTypes));
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
    const d = S.sel != null && S.model.byId.get(S.sel);
    panel.innerHTML = d ? panelDev(d) : panelRingkasan();
    $('#sheet-title').textContent = d ? d.nama : 'Ringkasan · ' + S.model.list.length + ' perangkat';
    if (d) {
      renderPanelInfo();
      terapkanPnTab();
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

  function panelRingkasan() {
    const m = S.model;
    const p = S.proyek;
    const counts = {};
    m.list.forEach(d => { counts[d.jenis] = (counts[d.jenis] || 0) + 1; });
    const checks = m.checks();
    const nErr = checks.filter(c => c.level === 'err').length;
    const nWarn = checks.filter(c => c.level === 'warn').length;
    const st = {};
    m.list.forEach(d => { st[d.status] = (st[d.status] || 0) + 1; });
    const kon = { online: [], gangguan: [], offline: [] };
    m.list.forEach(d => kon[m.koneksi(d)].push(d));
    return `
      <div class="pn-sec">
        <h3>${esc(p.nama)}</h3>
        ${S.tim && S.akses ? `<div class="tim-info"><b>${esc(S.akses.nama)}</b>${aksesRingkas(S.akses)}${progresTim()}</div>` : ''}
        <p class="muted small">${m.list.length} perangkat${p.skala ? ` · skala 1 px = ${fmtM(p.skala).replace(' m', '')} m` : ''}</p>
        ${!p.denah_v && S.canEdit ? '<p class="note">Belum ada denah. Upload di tab <a href="#" data-go="proyek">Proyek</a>.</p>' : ''}
        ${!p.skala ? `<p class="note">Skala belum dikalibrasi — panjang kabel &amp; cakupan AP belum bisa dihitung. Pakai alat <a href="#" data-tool-go="ukur">Ukur</a> pada garis skala denah (mis. "7000 cm").</p>` : ''}
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
          ${Object.keys(STATUS).map(k => `<span class="lg-item"><i class="ring" style="border-color:${STATUS[k].color}"></i>${STATUS[k].label}<b>${st[k] || 0}</b></span>`).join('')}
        </div>
      </div>
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
    const p = S.proyek;
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
      const res = await enqueue(() => api(API, { action: 'proyek_skala', id: S.proyek.id, skala: meter / px }));
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
      input = `<input type="${f.type === 'number' ? 'number' : 'text'}" ${f.type === 'number' ? 'step="any" min="0"' : ''} id="${id}" data-f="${f.k}"${f.attr ? ' data-attr="1"' : ''} value="${esc(v)}" placeholder="${esc(f.ph || '')}"${dis}>`;
    }
    return `<label class="field${f.wide ? ' wide' : ''}"><span>${esc(f.label)}</span>${input}</label>`;
  }

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
        <div class="inline"><select data-kat${dis}><option value="">${items.length ? '— isi manual —' : '— katalog kategori ini kosong —'}</option>${items.map(opt).join('')}</select>
          <a class="btn small" href="#/katalog" title="Kelola katalog perangkat">Katalog</a></div>
        ${k ? `<div class="kat-info"><small>${esc(ringkas || 'Spesifikasi belum diisi di katalog')}</small>
          <button type="button" class="small" data-act="kat-terapkan" title="Timpa isian perangkat dengan konfigurasi standar katalog">Terapkan konfigurasi standar</button></div>` : ''}
      </div>`;
  }

  /** Pilih / lepas alat katalog. Isian yang masih kosong otomatis diisi konfigurasi standar. */
  function pilihKatalog(d, katId) {
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
    const cands = NP.Model.sortDev(S.list.filter(x => !excl.has(x.id)));
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
        <button type="button" role="tab" data-pt="koneksi">Koneksi</button>
        <button type="button" role="tab" data-pt="jenis">${esc(tabJenis(d))}</button>
        <button type="button" role="tab" data-pt="grup">Group<span class="pt-n" hidden></span></button>
      </nav>
      </div>
      <div data-pp="info">
        <div id="pn-info"></div>
        <div id="pn-tim"></div>
        ${!S.lihat || S.tim ? '<div class="pn-sec" id="pn-riwayat"><h4>Riwayat status &amp; catatan</h4><p class="muted small">Memuat…</p></div>' : ''}
      </div>
      <form id="dev-form" autocomplete="off" onsubmit="return false">
        <div class="pn-sec" data-pp="identitas">
          <div class="fgrid">
            ${fieldHtml({ k: 'nama', label: 'Nama / label *' }, d.nama, dis)}
            <label class="field"><span>Jenis</span><select data-f="jenis"${dis}>${TYPE_ORDER.map(j => `<option value="${j}"${j === d.jenis ? ' selected' : ''}>${esc(TYPES[j].label)}</option>`).join('')}</select></label>
            ${katalogField(d, dis)}
            ${fieldHtml({ k: 'model', label: d.katalog_id != null ? 'Nama alat (dari katalog, bisa disesuaikan)' : 'Nama alat (merek/tipe)', ph: 'mis. MikroTik hAP ax², TP-Link EAP650', wide: true }, d.model, dis)}
            <label class="field"><span>Status</span><select data-f="status"${dis}>${Object.keys(STATUS).map(k => `<option value="${k}"${k === d.status ? ' selected' : ''}>${STATUS[k].label}</option>`).join('')}</select></label>
            ${fieldHtml({ k: 'pic', label: 'PIC / teknisi' }, d.pic, dis)}
          </div>
        </div>
        <div class="pn-sec" data-pp="koneksi">
          <div class="fgrid">
            <label class="field wide"><span>Uplink (sumber koneksi)</span>
              <div class="inline"><select data-f="uplink_id"${dis}>${uplinkOptions(d)}</select>
              ${S.canEdit ? '<button type="button" class="small" data-act="pick" title="Pilih uplink dengan klik di denah">Pilih di denah</button>' : ''}
              ${S.canEdit && d.uplink_id != null ? '<button type="button" class="small danger" data-act="unlink" title="Hapus koneksi ke uplink">Putuskan</button>' : ''}</div></label>
            ${fieldHtml({ k: 'port_uplink', label: 'Port di uplink', ph: 'mis. ether3 / port 5' }, d.port_uplink, dis)}
            ${fieldHtml({ k: 'port_lokal', label: 'Port di perangkat ini', ph: 'mis. ether1 / WAN' }, d.port_lokal, dis)}
            <label class="field"><span>Media ke uplink</span><select data-f="media"${dis}>${Object.keys(MEDIA).map(k => `<option value="${k}"${k === d.media ? ' selected' : ''}>${esc(MEDIA[k].label)}</option>`).join('')}</select></label>
            ${fieldHtml({ k: 'bandwidth_mbps', label: t.bwLabel, type: 'number' }, d.bandwidth_mbps, dis)}
            <div class="wide" id="pn-route"></div>
            ${d.jenis === 'router' || S.model.wanLain(d).length ? `<div class="wide" id="pn-wan">${wanEditor(d)}</div>` : ''}
            ${fieldHtml({ k: 'ip', label: 'IP address', ph: 'mis. 10.10.0.11/22 · DHCP' }, d.ip, dis)}
            ${fieldHtml({ k: 'vlan', label: 'VLAN', ph: 'mis. 10 (tamu)' }, d.vlan, dis)}
          </div>
        </div>
        <div data-pp="jenis">
          ${t.fields.length ? `<div class="pn-sec">
            <h4>Pengaturan ${esc(t.label)}</h4>
            <div class="fgrid">${t.fields.map(f => fieldHtml(Object.assign({ attr: true }, f), a[f.k], dis)).join('')}</div>
          </div>` : ''}
          <div class="pn-sec">
            <h4>Keterangan konfigurasi</h4>
            <textarea data-f="catatan" rows="8" class="mono" placeholder="Catatan setting, mis.&#10;- ether1 → WAN Indihome (PPPoE: user@telkom.net)&#10;- bridge-lan: ether2-5, VLAN 10/20&#10;- /ip dhcp-server ... lease 30m&#10;- AP mode: access point, controller 10.10.0.5"${dis}>${esc(d.catatan)}</textarea>
          </div>
        </div>
      </form>
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
    if (daftar.length) atr.wan_lain = JSON.stringify(daftar.map(w => ({ id: w.id, port: w.port || '' })));
    else delete atr.wan_lain;
    if (mode) atr.wan_mode = mode;
    if (!daftar.length) delete atr.wan_mode;
    return saveDev(d.id, { atribut: atr }).catch(() => {});
  }
  const wanList = d => S.model.wanLain(d).map(w => ({ id: w.dev.id, port: w.port }));

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
      h += baris(i + 2, w.dev, `<input type="text" class="wan-port" data-wan-port="${w.dev.id}" value="${esc(w.port)}" placeholder="port, mis. ether2" aria-label="Port WAN${i + 2}"${dis}>` +
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
    $$('.pn-tabs [data-pt]', body).forEach(b => {
      const on = b.dataset.pt === pnTab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    $$('[data-pp]', body).forEach(p => { p.hidden = p.dataset.pp !== pnTab; });
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
    if (bw.mbps != null) {
      h += `<div class="kv"><span>Bandwidth maks.</span><b>${fmtBw(bw.mbps)}${bw.gabung ? ` <span class="muted">(gabungan ${bw.gabung} WAN)</span>` : bw.at && bw.at.id !== d.id ? ` <span class="muted">(dibatasi ${esc(bw.at.nama)})</span>` : ''}</b></div>`;
    }
    if (m.parentOf(d)) {
      const berbelok = m.routePts(d).length > 2;
      h += `<div class="kv"><span>${d.media === 'wireless' ? 'Jarak link' : 'Kabel ke uplink'}</span><b>${jarak == null
        ? '<span class="muted">kalibrasi skala dulu</span>'
        : d.media === 'wireless' ? fmtM(jarak) : `≈ ${fmtM(kabel)} <span class="muted">(${berbelok ? 'jalur' : 'lurus'} ${fmtM(m.jalurM(d))} + ${S.proyek.slack_kabel}%)</span>`}</b></div>`;
    }
    if (kids.length) {
      h += `<div class="kv col"><span>Terhubung ke sini (${kids.length})${sumKids ? ' · total alokasi ' + fmtBw(sumKids) : ''}</span><div class="path wrap">${kids.map(c => S.canEdit ? `<span class="chip-x">${chip(c)}<button type="button" data-unlink="${c.id}" title="Hapus koneksi ${esc(c.nama)} ke sini" aria-label="Putuskan ${esc(c.nama)}">✕</button></span>` : chip(c)).join('')}</div></div>`;
    }
    if (issues.length) {
      h += `<ul class="issues">${issues.map(c => `<li class="lv-${c.level}">${esc(c.msg)}</li>`).join('')}</ul>`;
    }
    h += '</div>';
    box.innerHTML = h;
    renderRoute(d);
    renderTimBox(d);
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
    const pn = $('.pn-tabs .pt-n');
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

  /** Apakah perangkat termasuk tugas tim (kategori diizinkan; kosong = semua). */
  function tugasTim(d) {
    const a = S.akses;
    return !!a && a.peran === 'status' && (!a.jenis_boleh.length || a.jenis_boleh.includes(d.jenis));
  }

  /** Kotak update status + catatan lapangan untuk link tim (hanya status yang diizinkan PM). */
  function renderTimBox(d) {
    const box = $('#pn-tim');
    if (!box || !S.tim || !S.akses) return;
    if (box.querySelector('textarea[data-dirty]')) return; // catatan sedang diketik
    if (S.akses.peran !== 'status') {
      box.innerHTML = '';
      return;
    }
    if (!tugasTim(d)) {
      box.innerHTML = `<div class="pn-sec"><p class="note">${esc(d.nama)} di luar tugas <b>${esc(S.akses.nama)}</b> — hanya bisa dilihat.</p></div>`;
      return;
    }
    box.innerHTML = `<div class="pn-sec tim-box">
        <h4>Update status · ${esc(S.akses.nama)}</h4>
        <div class="st-pilih">${S.akses.status_boleh.map(k => `<button type="button" class="st-btn st-${k}${d.status === k ? ' on' : ''}" data-tim-status="${k}">${esc(STATUS[k].label)}</button>`).join('')}</div>
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
        ${ubah ? `<div><span class="st st-${esc(l.status_lama)}">${esc((STATUS[l.status_lama] || {}).label || l.status_lama || '—')}</span> → <span class="st st-${esc(l.status_baru)}">${esc((STATUS[l.status_baru] || {}).label || l.status_baru)}</span></div>` : ''}
        ${l.catatan ? `<div class="log-cat">${esc(l.catatan)}</div>` : ''}
      </li>`;
    }).join('')}</ul>` : '';
  }

  $('#panel').addEventListener('click', e => {
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
      peta.setHidden(new Set(hiddenTypes));
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
      if (v !== '' && !d.media) patch.media = 'utp';
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
    const full = k === 'jenis' || k === 'tipe_endpoint' || (k !== 'nama' && !!patch.nama);
    saveDev(d.id, patch, { keepPanel: !full }).catch(() => {});
  });

  // ------------------------------------------------------------------------ daftar perangkat

  function buildFilters() {
    $('#list-jenis').innerHTML += TYPE_ORDER.map(j => `<option value="${j}">${esc(TYPES[j].label)}</option>`).join('');
    $('#list-status').innerHTML += Object.keys(STATUS).map(k => `<option value="${k}">${STATUS[k].label}</option>`).join('');
    $('#list-koneksi').innerHTML += Object.keys(KONEKSI).map(k => `<option value="${k}">${KONEKSI[k].short}</option>`).join('');
  }
  ['#list-q', '#list-jenis', '#list-status', '#list-koneksi'].forEach(s => $(s).addEventListener('input', renderDaftar));

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
    { k: 'status', label: 'Status', v: d => Object.keys(STATUS).indexOf(d.status) },
    { k: 'pic', label: 'PIC', v: d => d.pic },
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
    return S.list.filter(d => (!j || d.jenis === j) && (!s || d.status === s) && (!kn || S.model.koneksi(d) === kn) &&
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
        ${td('Nama', `<span class="dotlbl"><i style="background:${NP.tampil(d).color}"></i><b>${esc(d.nama)}</b>${NP.terkunci(d) ? '<span class="lock-i" title="Posisi terkunci">🔒</span>' : ''}</span>`, 'c-nama')}
        ${td('Jenis', esc(jenisLabel(d)), 'c-jenis')}
        ${td('Nama alat', esc(d.model))}
        ${td('IP', esc(d.ip), 'mono')}
        ${td('VLAN', esc(d.vlan))}
        ${td('Uplink', p ? esc(p.nama) + (d.port_uplink ? ` <span class="muted">(${esc(d.port_uplink)})</span>` : '') : '<span class="muted">—</span>')}
        ${td('Group', d.uplink_id != null ? esc(grupNama(d.uplink_id, d.jenis)) : '')}
        ${td('Internet', konBadge(S.model.koneksi(d)))}
        ${td('Media', esc(d.media ? (MEDIA[d.media].short || d.media) : ''))}
        ${td('Bandwidth', esc(fmtBw(d.bandwidth_mbps)), 'num')}
        ${td('Kabel', esc(kabelShow(d)), 'num')}
        ${td('Status', `<span class="st st-${d.status}">${esc((STATUS[d.status] || STATUS.rencana).label)}</span>`, 'c-status')}
        ${td('PIC', esc(d.pic))}
        <td data-label="Konfigurasi" class="cfg${extra ? '' : ' empty'}" title="${esc(extra)}">${esc(extra)}</td>
      </tr>`;
    }).join('');
    $('#dev-table').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${COLS.length + 2}" class="muted center">Tidak ada perangkat${S.list.length ? ' yang cocok' : ' — tambahkan dari tab Denah'}.</td></tr>`}</tbody>`;
    sembunyikanKolomKosong(rows.length);
    const adaFilter = ['#list-q', '#list-jenis', '#list-status', '#list-koneksi'].some(s => $(s).value);
    $('#list-reset').hidden = !adaFilter;
    $('#list-count').textContent = adaFilter ? `${rows.length} dari ${S.list.length} perangkat` : `${S.list.length} perangkat`;
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
    ['#list-q', '#list-jenis', '#list-status', '#list-koneksi'].forEach(s => { $(s).value = ''; });
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
    return !!(S.tim && S.akses && S.akses.peran === 'status');
  }

  /** Pilihan status di bar aksi: admin semua status, tim hanya status yang diizinkan PM. */
  function isiPilihanStatus() {
    const boleh = S.canEdit ? Object.keys(STATUS) : bolehStatus() ? S.akses.status_boleh : [];
    $('#bulk-status').innerHTML = '<option value="">Ubah status…</option>' +
      boleh.map(k => `<option value="${k}">→ ${esc(STATUS[k].label)}</option>`).join('');
  }

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
    const rows = [['Nama', 'Jenis', 'Nama alat', 'IP', 'VLAN', 'Uplink', 'Group', 'Port uplink', 'Port lokal', 'Media', 'Bandwidth (Mbps)',
      'Bandwidth maks. (Mbps)', 'Sumber WAN', 'Internet', 'Kabel (m)', 'Status', 'PIC', 'Isian khusus', 'Keterangan konfigurasi']];
    for (const d of NP.Model.sortDev(filteredList())) {
      const p = S.model.parentOf(d);
      const w = S.model.wanOf(d);
      const k = S.model.kabelM(d);
      rows.push([d.nama, jenisLabel(d), d.model, d.ip, d.vlan, p ? p.nama : '', p ? grupNama(p.id, d.jenis) : '', d.port_uplink, d.port_lokal,
        d.media ? MEDIA[d.media].label : '', d.bandwidth_mbps == null ? '' : d.bandwidth_mbps, S.model.bwEfektif(d).mbps == null ? '' : S.model.bwEfektif(d).mbps,
        w ? w.nama : '', KONEKSI[S.model.koneksi(d)].label, k == null ? '' : Math.round(k), (STATUS[d.status] || STATUS.rencana).label, d.pic, attrSummary(d, false), d.catatan]);
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
        pakaiWan.length ? 'WAN tambahan untuk ' + pakaiWan.map(x => x.nama).join(', ') : ''].filter(Boolean);
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
            ${lv ? `<span class="lv ${lv}">${lv === 'err' ? 'masalah' : lv === 'warn' ? 'peringatan' : 'catatan'}</span>` : ''}
          </div>
          ${meta.length ? `<div class="tmeta">${meta.map(esc).join(' · ')}</div>` : ''}
          ${ringkas ? `<div class="tmeta">${ringkas}</div>` : ''}
        </div>` + (tutup ? '' : kids.map(c => node(c, depth + 1)).join(''));
    }
    muatTreeTutup();
    const roots = m.roots();
    $('#tree').innerHTML = roots.length ? roots.map(r => node(r, 0)).join('') : '<p class="muted">Belum ada perangkat.</p>';
    $('#topo-count').textContent = `${m.list.length} perangkat · ${roots.length} akar`;

    $('#checks').innerHTML = checks.length
      ? `<ul class="issues">${checks.map(c => `<li class="lv-${c.level}">${esc(c.msg)} ${c.ids.slice(0, 1).map(id => `<a href="#" data-sel="${id}">lihat</a>`).join('')}</li>`).join('')}</ul>`
      : '<p class="ok-text">✓ Tidak ada masalah terdeteksi.</p>';

    const wans = m.list.filter(d => d.jenis === 'isp');
    const totalWan = wans.reduce((s, d) => s + (d.bandwidth_mbps || 0), 0);
    $('#wan-sum').innerHTML = wans.length ? `<table class="mini">${wans.map(w => {
      const n = m.descendants(w.id).size;
      const pakai = m.pemakaiWan(w.id);
      return `<tr><td>${chip(w)}</td><td>${esc([w.atribut.provider, w.atribut.jenis_koneksi].filter(Boolean).join(' · '))}</td><td class="num">${esc(fmtBw(w.bandwidth_mbps))}</td><td class="num muted">${n ? n + ' perangkat' : ''}${pakai.length ? `${n ? '<br>' : ''}WAN tambahan ${esc(pakai.map(x => x.nama).join(', '))}` : n ? '' : '0 perangkat'}</td></tr>`;
    }).join('')}${wans.length > 1 ? `<tr class="tot"><td colspan="2">Total kapasitas</td><td class="num">${esc(fmtBw(totalWan))}</td><td></td></tr>` : ''}</table>` : '<p class="muted">Belum ada Sumber WAN/ISP.</p>';

    const ss = m.ssids();
    $('#ssid-sum').innerHTML = ss.length ? `<table class="mini"><tr><th>SSID</th><th>Keamanan</th><th>VLAN</th><th class="num">AP</th></tr>${ss.map(s =>
      `<tr><td><b>${esc(s.ssid)}</b></td><td>${esc([...s.keamanan].join(', '))}</td><td>${esc([...s.vlan].join(', '))}</td><td class="num">${s.ap.length}</td></tr>`).join('')}</table>` : '<p class="muted">Belum ada AP dengan SSID.</p>';

    const bom = m.bom();
    // Stok: hanya untuk alat dari katalog; merah bila kebutuhan event melebihi stok.
    const stokCell = b => b.stok == null ? '<span class="muted">—</span>'
      : b.jumlah > b.stok ? `<b class="bad">${b.stok} (kurang ${b.jumlah - b.stok})</b>` : String(b.stok);
    $('#bom').innerHTML = bom.length ? `<table class="mini"><tr><th>Jenis</th><th>Nama alat</th><th class="num">Jumlah</th><th class="num">Stok</th></tr>${bom.map(b =>
      `<tr><td>${esc((TYPES[b.jenis] || TYPES.lainnya).label)}</td><td>${b.model ? esc(b.model) : '<span class="muted">(belum diisi)</span>'}${b.katalog ? ' <span class="tag-kat" title="Dari katalog">katalog</span>' : ''}</td><td class="num"><b>${b.jumlah}</b></td><td class="num">${stokCell(b)}</td></tr>`).join('')}</table>` : '<p class="muted">—</p>';

    const kb = m.kabel();
    const keys = Object.keys(kb.tot);
    $('#kabel-sum').innerHTML = (keys.length ? `<table class="mini"><tr><th>Media</th><th class="num">Link</th><th class="num">Total</th></tr>${keys.map(k =>
      `<tr><td>${esc(MEDIA[k] ? MEDIA[k].label : k)}</td><td class="num">${kb.tot[k].n}</td><td class="num"><b>≈ ${esc(fmtM(kb.tot[k].m))}</b></td></tr>`).join('')}</table>
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

  // ------------------------------------------------------------------------ proyek / info

  function renderProyek() {
    const p = S.proyek;
    const base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    const link = base + 'index.html?lihat=' + p.kode_lihat;
    const tgl = p.tanggal_mulai ? fmtDate(p.tanggal_mulai) + (p.tanggal_selesai && p.tanggal_selesai !== p.tanggal_mulai ? ' – ' + fmtDate(p.tanggal_selesai) : '') : '—';
    if (S.lihat) {
      $('#proyek-pane').innerHTML = `<div class="card"><h2>${esc(p.nama)}</h2>
        <div class="kv"><span>Venue</span><b>${esc(p.venue || '—')}</b></div>
        <div class="kv"><span>Tanggal</span><b>${esc(tgl)}</b></div>
        ${p.catatan ? `<h4>Catatan</h4><div class="pre">${esc(p.catatan)}</div>` : ''}
        <p class="muted small">${S.tim ? 'Halaman tim.' : 'Halaman lihat-saja.'} ${S.akses && S.akses.lihat_password ? '' : 'Password disamarkan. '}Data diperbarui otomatis tiap 30 detik.</p></div>
        ${S.tim && S.akses ? `<div class="card"><h2>Akses Anda</h2>${aksesRingkas(S.akses)}${progresTim()}</div>
        <div class="card" id="card-aktivitas"><h2>Aktivitas tim</h2><p class="muted small">Memuat…</p></div>` : ''}`;
      if (S.tim) muatAktivitas();
      return;
    }
    $('#proyek-pane').innerHTML = `
      <div class="card">
        <h2>Info event <span class="spacer"></span><button type="button" class="small" data-p="edit">Ubah</button></h2>
        <div class="kv"><span>Nama</span><b>${esc(p.nama)}</b></div>
        <div class="kv"><span>Venue</span><b>${esc(p.venue || '—')}</b></div>
        <div class="kv"><span>Tanggal</span><b>${esc(tgl)}</b></div>
        <form id="form-catatan" autocomplete="off">
          <label class="field"><span>Catatan umum jaringan (topologi, kontak, jadwal setting)</span>
            <textarea name="catatan" rows="6" maxlength="5000" placeholder="mis. Loading barang H-1 jam 14.00, PIC venue Pak Budi 08xx, ISP aktif H-2...">${esc(p.catatan || '')}</textarea></label>
          <label class="field"><span>Tambahan panjang kabel dari jarak lurus (%)</span>
            <input type="number" name="slack_kabel" min="0" max="300" value="${p.slack_kabel}" style="max-width:120px"></label>
          <button type="submit" class="primary">Simpan</button>
        </form>
      </div>
      <div class="card">
        <h2>Denah venue</h2>
        ${p.denah_v ? `<img class="denah-prev" src="${esc(denahUrl())}" alt="Denah"><p class="muted small">${p.denah_w} × ${p.denah_h} piksel</p>` : '<p class="muted">Belum ada denah.</p>'}
        <label class="field"><span>${p.denah_v ? 'Ganti' : 'Upload'} gambar denah (PNG/JPG/WEBP, maks. 30 MB)</span>
          <input type="file" id="denah-file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
        ${p.denah_v ? `<label class="check"><input type="checkbox" id="denah-sesuaikan" checked>
          <span>Denah baru = venue yang sama (hanya resolusi/versi berbeda)<small>Posisi perangkat & skala diskalakan mengikuti ukuran gambar baru. Hapus centang bila denahnya berbeda — skala perlu dikalibrasi ulang.</small></span></label>
          <button type="button" class="small danger" data-p="denah-del">Hapus denah</button>` : ''}
        <p class="muted small">Denah PDF/CAD: ekspor/screenshot menjadi PNG dulu. Resolusi lebih tinggi = lebih tajam saat di-zoom.</p>
      </div>
      <div class="card">
        <h2>Skala denah</h2>
        <p>${p.skala ? `1 piksel denah = <b>${(p.skala * 100).toLocaleString('id-ID', { maximumFractionDigits: 3 })} cm</b>. Lebar denah ≈ <b>${esc(fmtM(p.skala * (p.denah_w || 2000)))}</b>.` : 'Belum dikalibrasi.'}</p>
        <p class="muted small">Kalibrasi di tab Denah: alat <b>Ukur</b> → klik dua ujung garis skala → isi jarak sebenarnya → <b>Set skala</b>.</p>
        ${p.skala ? '<button type="button" class="small" data-p="skala-reset">Hapus kalibrasi</button>' : ''}
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
      </div>
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
      <div class="card" id="card-akses"><h2>Akses tim</h2><p class="muted small">Memuat…</p></div>
      <div class="card" id="card-aktivitas"><h2>Aktivitas tim</h2><p class="muted small">Memuat…</p></div>
      <div class="card">
        <h2>Aksi</h2>
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
      </div>`;
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
      <span class="tag-peran ${a.peran}">${a.peran === 'status' ? 'Update status' : 'Lihat saja'}</span>
      ${a.peran === 'status' ? a.status_boleh.map(k => `<span class="st st-${k}">${esc(STATUS[k].label)}</span>`).join('') : ''}
      <span class="muted small">· ${esc(jenis)}${a.lihat_password ? ' · boleh lihat password' : ''}</span>
    </div>`;
  }

  /** Progres tugas tim (perangkat di kategori tugasnya) per status. */
  function progresTim() {
    const a = S.akses;
    const ds = S.list.filter(d => !a.jenis_boleh.length || a.jenis_boleh.includes(d.jenis));
    if (!ds.length) return '';
    const n = {};
    ds.forEach(d => { n[d.status] = (n[d.status] || 0) + 1; });
    const selesai = (n.terpasang || 0) + (n.diuji || 0);
    return `<h4>Progres tugas (${ds.length} perangkat)</h4>
      <div class="progres"><i style="width:${Math.round(selesai / ds.length * 100)}%"></i></div>
      <div class="akses-izin">${Object.keys(STATUS).map(k => `<span class="st st-${k}">${esc(STATUS[k].label)} ${n[k] || 0}</span>`).join('')}</div>`;
  }

  async function muatAkses() {
    const card = $('#card-akses');
    if (!card || !S.proyek) return;
    try {
      aksesList = (await api(`${API}?action=akses_list&id=${S.proyek.id}`)).akses;
    } catch (e) {
      card.innerHTML = `<h2>Akses tim</h2><p class="err-text">${esc(e.message)}</p>`;
      return;
    }
    card.innerHTML = `<h2>Akses tim <span class="spacer"></span><button type="button" class="small primary" data-akses="baru">+ Tambah akses</button></h2>
      <p class="muted small">Link khusus per tim/anggota tanpa password admin. Tim <b>update status</b> hanya bisa mengubah status yang Anda izinkan, pada kategori tugasnya, dan setiap perubahan tercatat di <i>Aktivitas tim</i>.</p>
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
  $('#akses-status-list').innerHTML = Object.keys(STATUS).map(k =>
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
    $('#akses-status').hidden = $('#form-akses').elements.peran.value !== 'status';
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
    const { W, H } = peta.size();
    const vb = opts.vb || [0, 0, W, H];
    const u = Math.max(vb[2], vb[3]) / 1100 * (opts.vb ? 2.2 : 1);
    const r = 9 * u;
    const img = denahUrl();
    let h = `<svg viewBox="${vb.join(' ')}" xmlns="http://www.w3.org/2000/svg" class="${opts.cls || 'print-map'}" preserveAspectRatio="xMidYMid ${opts.vb ? 'slice' : 'meet'}">`;
    if (opts.vb) h += `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fff"/>`;
    h += img ? `<rect width="${W}" height="${H}" fill="#fff"/><image href="${esc(img)}" width="${W}" height="${H}" opacity="${peta.opacity}"/>` : `<rect width="${W}" height="${H}" fill="#fff" stroke="#ccc"/>`;
    for (const d of m.list) {
      const rr = d.jenis === 'ap' && m.apRadiusPx(d);
      const sk = d.jenis === 'ap' && NP.sektor(d);
      const covAttr = `fill="${TYPES.ap.color}" fill-opacity="${sk ? '.14' : '.08'}" stroke="${TYPES.ap.color}" stroke-opacity=".45" stroke-width="${u}"`;
      if (rr) h += sk ? `<path d="${NP.wedgePath(d.x, d.y, rr, sk.arah, sk.lebar)}" ${covAttr}/>` : `<circle cx="${d.x}" cy="${d.y}" r="${rr}" ${covAttr}/>`;
    }
    for (const d of m.list) {
      const p = m.parentOf(d);
      if (!p) continue;
      const md = MEDIA[d.media] || MEDIA.utp;
      const kl = m.koneksiLink(d);
      const color = kl === 'online' ? md.color || '#0369a1' : KONEKSI[kl].color;
      const dash = kl === 'offline' ? '1 7' : kl === 'gangguan' ? '10 5' : md.dash;
      const pts = m.routePts(d).map(q => q.x + ',' + q.y).join(' ');
      h += `<polyline points="${pts}" fill="none" stroke-linejoin="round" stroke-linecap="round" stroke="#fff" stroke-width="${6.5 * u}" opacity=".9"/>
        <polyline points="${pts}" fill="none" stroke-linejoin="round" stroke-linecap="round" stroke="${color}" stroke-width="${3.6 * u}" stroke-dasharray="${dash ? dash.split(' ').map(x => x * u).join(' ') : ''}"/>`;
    }
    for (const d of m.list) {
      const t = NP.tampil(d);
      const K = KONEKSI[m.koneksi(d)];
      const b = r * 0.8;
      h += `<g transform="translate(${d.x},${d.y})">
        ${t.ikon ? `<rect x="${-(r + 2.5 * u)}" y="${-(r + 2.5 * u)}" width="${(r + 2.5 * u) * 2}" height="${(r + 2.5 * u) * 2}" rx="${5 * u}" fill="#fff" stroke="${(STATUS[d.status] || STATUS.rencana).color}" stroke-width="${2 * u}"/>
        <rect x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" rx="${3.5 * u}" fill="${t.color}"/>
        <g transform="translate(${-r * 0.75},${-r * 0.75})">${NP.ikonSvg(t.ikon, r * 1.5)}</g>`
        : `<circle r="${r + 2.5 * u}" fill="#fff" stroke="${(STATUS[d.status] || STATUS.rencana).color}" stroke-width="${2 * u}"/>
        ${d.jenis === 'ap' && NP.sektor(d) ? (s => `<path d="${NP.wedgePath(0, 0, r * 2.2, s.arah, s.lebar)}" fill="${TYPES.ap.color}" fill-opacity=".35"/>`)(NP.sektor(d)) : ''}
        <circle r="${r}" fill="${t.color}"/>
        <text text-anchor="middle" dy=".35em" font-size="${(t.short.length > 2 ? 6.5 : 8) * u}" font-weight="700" fill="#fff" font-family="Arial">${esc(t.short)}</text>`}
        <circle cx="${b}" cy="${-b}" r="${4.5 * u}" fill="${K.color}" stroke="#fff" stroke-width="${1.2 * u}"/>
        <text x="${b}" y="${-b}" dy=".36em" text-anchor="middle" font-size="${6.5 * u}" font-weight="800" fill="#fff" font-family="Arial">${K.icon}</text>
        <text text-anchor="middle" y="${r + 11 * u}" font-size="${9 * u}" font-weight="700" fill="#111" stroke="#fff" stroke-width="${3 * u}" paint-order="stroke" font-family="Arial">${esc(d.nama)}</text>
      </g>`;
    }
    const f = opts.focus != null && m.byId.get(opts.focus);
    if (f) {
      h += `<circle cx="${f.x}" cy="${f.y}" r="${r + 9 * u}" fill="none" stroke="#dc2626" stroke-width="${3 * u}"/>
        <circle cx="${f.x}" cy="${f.y}" r="${r + 15 * u}" fill="none" stroke="#dc2626" stroke-width="${1.2 * u}" stroke-dasharray="${4 * u} ${3 * u}"/>`;
    }
    return h + '</svg>';
  }

  /** Potongan denah di sekitar perangkat (rasio 4:3), tetap di dalam batas denah. */
  function cropAround(d) {
    const { W, H } = peta.size();
    let w = Math.max(W, H) * 0.3;
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
    syncPrintOpts();
    dlgPrint.showModal();
  });
  formPrint.addEventListener('change', syncPrintOpts);
  function syncPrintOpts() {
    const ap = formPrint.elements.jenis.value === 'ap';
    $('#ap-opts').hidden = !ap;
    $('#btn-ap-csv').hidden = !ap;
  }
  $('#form-print [data-close]').addEventListener('click', () => dlgPrint.close());

  function apOpts() {
    const f = formPrint.elements;
    return { password: f.password.checked && !S.lihat, peta: f.peta.checked && !!S.proyek.denah_v, bridge: f.bridge.checked };
  }

  formPrint.addEventListener('submit', e => {
    e.preventDefault();
    const jenis = formPrint.elements.jenis.value;
    if (jenis === 'ap') {
      if (!apList(apOpts()).length) return toast('Belum ada access point di event ini', true);
      dlgPrint.close();
      printApSheet(apOpts());
    } else {
      dlgPrint.close();
      printReport();
    }
  });

  $('#btn-ap-csv').addEventListener('click', () => {
    const o = apOpts();
    const list = apList(o);
    if (!list.length) return toast('Belum ada access point di event ini', true);
    const rows = [['Nama', 'Jenis', 'Nama alat', 'Status', 'Internet', 'IP', 'VLAN', 'Gateway', 'Subnet', 'DNS', 'Uplink', 'Port di uplink',
      'Port lokal', 'PoE uplink', 'Media', 'Kabel (m)', 'SSID', 'Keamanan', 'Password', 'SSID tambahan', 'Band', 'Channel', 'Lebar kanal',
      'TX power', 'Target user', 'Radius (m)', 'Controller', 'Pemasangan', 'Limit (Mbps)', 'Bandwidth maks. (Mbps)', 'PIC', 'Keterangan konfigurasi']];
    for (const d of list) {
      const a = d.atribut || {};
      const n = netInfo(d);
      const k = S.model.kabelM(d);
      rows.push([d.nama, TYPES[d.jenis].label, d.model, (STATUS[d.status] || STATUS.rencana).label, KONEKSI[S.model.koneksi(d)].label,
        d.ip, d.vlan, n.gw, n.subnet, n.dns, n.up ? n.up.nama : '', d.port_uplink, d.port_lokal, n.poe, d.media ? MEDIA[d.media].label : '',
        k == null ? '' : Math.round(k), a.ssid, a.keamanan, o.password ? a.password : (a.password ? '••••' : ''), a.ssid_lain, a.band,
        a.channel || a.frekuensi, a.lebar_kanal, a.tx_power, a.maks_user, a.radius_m, a.controller, a.mounting,
        d.bandwidth_mbps == null ? '' : d.bandwidth_mbps, S.model.bwEfektif(d).mbps == null ? '' : S.model.bwEfektif(d).mbps, d.pic, d.catatan]);
    }
    downloadCsv(rows, `sheet-ap-${slug(S.proyek.nama)}.csv`);
  });

  // ------------------------------------------------------------------------ sheet konfigurasi AP

  /** AP (dan bridge bila dipilih), urut nama alami. */
  function apList(o) {
    return S.list.filter(d => d.jenis === 'ap' || (o.bridge && d.jenis === 'bridge'))
      .sort((a, b) => (a.jenis === b.jenis ? 0 : a.jenis === 'ap' ? -1 : 1) || a.nama.localeCompare(b.nama, 'id', { numeric: true }));
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
        return `<tr><td><b>${esc(d.nama)}</b>${d.jenis === 'bridge' ? ' <span class="muted">(bridge)</span>' : ''}</td><td>${esc(d.model)}</td><td class="mono">${esc(d.ip)}</td><td>${esc(d.vlan)}</td>
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
          <div class="grow"><h3>${esc(d.nama)}</h3><span>${esc(t.label)}${d.model ? ' · ' + esc(d.model) : ''}</span></div>
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
      ${o.peta ? `<div class="pr-map ov">${staticMap()}</div>` : ''}
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
    const imgEl = $('#print image');
    const doPrint = () => setTimeout(() => window.print(), 50);
    if (!imgEl) return doPrint();
    // Pastikan gambar denah sudah dimuat sebelum dialog cetak muncul.
    const pre = new Image();
    pre.onload = pre.onerror = doPrint;
    pre.src = imgEl.getAttribute('href');
  }

  function printReport() {
    const m = S.model;
    const p = S.proyek;
    const tgl = p.tanggal_mulai ? fmtDate(p.tanggal_mulai) + (p.tanggal_selesai && p.tanggal_selesai !== p.tanggal_mulai ? ' – ' + fmtDate(p.tanggal_selesai) : '') : '';
    const checks = m.checks();
    const rows = NP.Model.sortDev(m.list).map(d => {
      const t = TYPES[d.jenis] || TYPES.lainnya;
      const par = m.parentOf(d);
      const k = m.kabelM(d);
      return `<tr>
        <td><b>${esc(d.nama)}</b><br><span class="muted">${esc(jenisLabel(d))}</span></td>
        <td>${esc(d.model)}</td>
        <td>${esc(d.ip)}${d.vlan ? '<br>VLAN ' + esc(d.vlan) : ''}</td>
        <td>${par ? esc(par.nama) : '—'}${d.port_uplink ? ' : ' + esc(d.port_uplink) : ''}${d.port_lokal ? '<br>lokal ' + esc(d.port_lokal) : ''}</td>
        <td>${esc(d.media ? MEDIA[d.media].short : '')}${k != null ? '<br>≈ ' + esc(fmtM(k)) : ''}</td>
        <td>${esc(fmtBw(d.bandwidth_mbps))}</td>
        <td>${esc((STATUS[d.status] || STATUS.rencana).label)}<br>${konBadge(m.koneksi(d))}${d.pic ? '<br>' + esc(d.pic) : ''}</td>
        <td class="cfg">${esc(attrSummary(d, true))}${d.catatan ? `<div class="pre">${esc(d.catatan)}</div>` : ''}</td>
      </tr>`;
    }).join('');
    const bom = m.bom();
    const kb = m.kabel();
    $('#print').innerHTML = `
      <div class="pr-head"><h1>${esc(p.nama)}</h1><p>${esc([p.venue, tgl].filter(Boolean).join(' · '))} · ${m.list.length} perangkat · dicetak ${esc(new Date().toLocaleString('id-ID'))}</p></div>
      <div class="pr-map">${staticMap()}</div>
      <div class="pr-legend">${TYPE_ORDER.filter(j => m.list.some(d => d.jenis === j)).map(j => `<span><i style="background:${TYPES[j].color}">${esc(TYPES[j].short)}</i>${esc(TYPES[j].label)}</span>`).join('')}
        ${lineLegend().map(x => `<span>${x.svg}${esc(x.label)}</span>`).join('')}
        ${Object.keys(KONEKSI).map(k => `<span><i style="background:${KONEKSI[k].color}">${KONEKSI[k].icon}</i>${esc(KONEKSI[k].label)}</span>`).join('')}</div>
      ${p.catatan ? `<h2>Catatan</h2><div class="pre">${esc(p.catatan)}</div>` : ''}
      <h2>Daftar perangkat &amp; konfigurasi</h2>
      <table class="pr-table"><thead><tr><th>Perangkat</th><th>Nama alat</th><th>IP / VLAN</th><th>Uplink : port</th><th>Media / kabel</th><th>Bandwidth</th><th>Status / internet / PIC</th><th>Konfigurasi</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="pr-cols">
        <div><h2>Kebutuhan perangkat</h2><table class="pr-table"><tr><th>Jenis</th><th>Nama alat</th><th>Jml</th><th>Stok</th></tr>${bom.map(b => `<tr><td>${esc(TYPES[b.jenis].label)}</td><td>${esc(b.model || '(belum diisi)')}</td><td>${b.jumlah}</td><td>${b.stok == null ? '—' : b.stok + (b.jumlah > b.stok ? ' (kurang ' + (b.jumlah - b.stok) + ')' : '')}</td></tr>`).join('')}</table>
          ${Object.keys(kb.tot).length ? `<h2>Estimasi kabel</h2><table class="pr-table">${Object.keys(kb.tot).map(k => `<tr><td>${esc(MEDIA[k].label)}</td><td>${kb.tot[k].n} link</td><td>≈ ${esc(fmtM(kb.tot[k].m))}</td></tr>`).join('')}</table>` : ''}</div>
        <div><h2>Pemeriksaan desain</h2>${checks.length ? `<ul>${checks.map(c => `<li class="lv-${c.level}">${esc(c.msg)}</li>`).join('')}</ul>` : '<p>Tidak ada masalah terdeteksi.</p>'}</div>
      </div>`;
    $('#print').className = 'print';
    printWith('A4 landscape');
  }

  boot();
})();
