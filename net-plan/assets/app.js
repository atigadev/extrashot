/* Aplikasi Net Plan: daftar event, editor denah, daftar perangkat, topologi, pengaturan proyek, cetak. */
(function () {
  'use strict';
  const { TYPES, TYPE_ORDER, STATUS, MEDIA, KONEKSI, api, esc, toast, copy, downloadBlob, downloadCsv, fmtBw, fmtM, fmtDate, slug } = NP;
  const API = 'api/admin.php';
  const $ = (s, root) => (root || document).querySelector(s);
  const $$ = (s, root) => [...(root || document).querySelectorAll(s)];

  const lihatKode = new URLSearchParams(location.search).get('lihat');
  const S = {
    lihat: lihatKode,
    canEdit: !lihatKode,
    proyek: null,
    list: [],
    model: null,
    tab: 'denah',
    sel: null,
    parentCtx: null, // perangkat induk bawaan saat menaruh perangkat baru
    sort: { k: 'jenis', dir: 1 },
    loadedAt: 0,
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

  /** Simpan sebagian isian perangkat (optimistis: tampilan diperbarui dulu). */
  function saveDev(id, patch, opts) {
    opts = opts || {};
    const d = S.model.byId.get(id);
    if (!d) return Promise.resolve();
    Object.assign(d, patch);
    refreshModel(opts);
    pendingById.set(id, (pendingById.get(id) || 0) + 1);
    return enqueue(() => api(API, Object.assign({ action: 'perangkat_save', id }, patch)))
      .then(res => {
        const n = pendingById.get(id) - 1;
        pendingById.set(id, n);
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
    S.model = NP.Model.create(S.proyek, S.list);
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
    return S.lihat
      ? `api/denah.php?k=${encodeURIComponent(S.lihat)}&v=${p.denah_v}`
      : `api/denah.php?id=${p.id}&v=${p.denah_v}`;
  }

  async function loadProyek(id) {
    const res = S.lihat
      ? await api('api/lihat.php?k=' + encodeURIComponent(S.lihat))
      : await api(API + '?action=get&id=' + id);
    const changed = !S.proyek || S.proyek.id !== res.proyek.id;
    S.proyek = res.proyek;
    S.list = res.perangkat;
    S.loadedAt = Date.now();
    if (changed) {
      S.sel = null;
      S.parentCtx = null;
    }
    return changed;
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
      showEditor();
      return;
    }
    $('#btn-logout').hidden = false;
    try {
      const me = await api(API + '?action=me');
      if (!me.login) return showLogin();
    } catch (e) {
      toast(e.message, true);
      return;
    }
    route();
  }

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
      await api(API, { action: 'login', password: $('#login-pass').value });
      $('#login').hidden = true;
      $('#login-pass').value = '';
      route();
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

  async function showHome() {
    $('#editor').hidden = true;
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
      <a class="proj-card" href="#/p/${p.id}">
        <div class="thumb">${p.denah_v ? `<img src="api/denah.php?id=${p.id}&v=${p.denah_v}" alt="" loading="lazy">` : '<span>Belum ada denah</span>'}</div>
        <div class="info">
          <b>${esc(p.nama)}</b>
          <span class="muted">${esc(p.venue || '—')}</span>
          <span class="meta">${p.tanggal_mulai ? esc(fmtDate(p.tanggal_mulai)) + (p.tanggal_selesai && p.tanggal_selesai !== p.tanggal_mulai ? ' – ' + esc(fmtDate(p.tanggal_selesai)) : '') + ' · ' : ''}${p.jumlah} perangkat</span>
        </div>
      </a>`).join('');
  }

  $('#btn-new').addEventListener('click', () => openProyekDialog(null));

  let editingProyek = false;
  function openProyekDialog(p) {
    editingProyek = !!p;
    const dlg = $('#dlg-proyek');
    const f = $('#form-proyek');
    f.reset();
    $('#dlg-proyek-title').textContent = p ? 'Ubah event' : 'Event baru';
    $$('.new-only', f).forEach(e => { e.hidden = !!p; });
    if (p) ['nama', 'venue', 'tanggal_mulai', 'tanggal_selesai'].forEach(k => { f.elements[k].value = p[k] || ''; });
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
    }
    btn.disabled = true;
    try {
      const res = await api(API, body);
      const file = !editing && f.elements.denah.files[0];
      if (file) await uploadDenah(res.proyek.id, file, false);
      $('#dlg-proyek').close();
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
      ${S.lihat ? '<span class="badge">Lihat saja</span>' : ''}`;
    document.title = p.nama + ' — Net Plan';
  }

  // ======================================================================== editor

  function showEditor() {
    $('#home').hidden = true;
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
    onMove(id, x, y) {
      saveDev(id, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }, { keepPanel: true }).catch(() => {});
    },
    onLink(childId, parentId) {
      linkDev(childId, parentId);
    },
    onRoute(id, jalur) {
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
  function nextName(jenis) {
    const pre = (TYPES[jenis] || TYPES.lainnya).prefix;
    let max = 0;
    const re = new RegExp('^' + pre + '-?(\\d+)$', 'i');
    for (const d of S.list) {
      const m = d.nama.match(re);
      if (m) max = Math.max(max, +m[1]);
    }
    return pre + '-' + String(max + 1).padStart(2, '0');
  }

  async function addDev(jenis, x, y, base) {
    const parent = S.parentCtx != null && S.model.byId.get(S.parentCtx);
    const body = Object.assign({
      action: 'perangkat_save',
      proyek_id: S.proyek.id,
      jenis,
      nama: nextName(jenis),
      uplink_id: jenis !== 'isp' && parent ? parent.id : null,
      media: jenis === 'isp' ? '' : 'utp',
      status: 'rencana',
    }, base || {}, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    try {
      const res = await enqueue(() => api(API, body));
      S.list.push(res.perangkat);
      S.sel = res.perangkat.id;
      refreshModel();
      peta.flash(res.perangkat.id);
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
    if (S.model.descendants(childId).has(parentId)) {
      toast(`${p.nama} berada di bawah ${c.nama} — tidak bisa jadi uplinknya (loop)`, true);
      return;
    }
    const patch = { uplink_id: parentId };
    if (!c.media) patch.media = 'utp';
    saveDev(childId, patch).then(() => toast(`${c.nama} → uplink ${p.nama}`)).catch(() => {});
  }

  async function deleteDev(ids) {
    ids = [].concat(ids);
    const names = ids.map(id => S.model.byId.get(id)).filter(Boolean).map(d => d.nama);
    const anak = ids.reduce((n, id) => n + S.model.kids(id).filter(c => !ids.includes(c.id)).length, 0);
    if (!confirm(`Hapus ${names.join(', ')}?` + (anak ? `\n\n${anak} perangkat yang terhubung ke sini akan menjadi tanpa uplink.` : ''))) return;
    try {
      await enqueue(() => api(API, { action: 'perangkat_delete', ids }));
      S.list = S.list.filter(d => !ids.includes(d.id));
      S.list.forEach(d => { if (ids.includes(d.uplink_id)) d.uplink_id = null; });
      if (ids.includes(S.sel)) S.sel = null;
      refreshModel();
      toast('Dihapus');
    } catch (e) {
      setSaveState('error');
      toast(e.message, true);
    }
  }

  function duplicateDev(id) {
    const d = S.model.byId.get(id);
    const base = {};
    ['model', 'vlan', 'media', 'bandwidth_mbps', 'pic', 'catatan', 'uplink_id'].forEach(k => { base[k] = d[k]; });
    base.atribut = Object.assign({}, d.atribut);
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
        <i style="background:${t.color}">${esc(t.short)}</i><span>${esc(t.label.split(/[ /(]/)[0])}</span></button>`;
    }).join('');
    $('#toolbar').innerHTML = h;
    setTool('pilih');
  }

  function setTool(tool) {
    peta.setTool(tool);
    $$('#toolbar .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    if (S.model) renderPanel();
    updateHint();
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
      const t = TYPES[tool.slice(7)];
      const par = S.parentCtx != null && S.model && S.model.byId.get(S.parentCtx);
      h = `Klik di denah untuk menaruh <b>${esc(t.label)}</b>` +
        (tool !== 'tambah:isp' ? (par ? ` · uplink otomatis: <b>${esc(par.nama)}</b> <span class="muted">(pilih perangkat lain untuk mengganti)</span>` : ' · <span class="muted">pilih router/switch dulu agar uplink terisi otomatis</span>') : '') +
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
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (peta.tool !== 'pilih') setTool('pilih');
      else if (S.sel != null) selectDev(null);
    } else if (k === 'v') setTool('pilih');
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
    if (d) renderPanelInfo();
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

  // Kontrol lapisan: di layar kecil dilipat ke tombol ☰.
  $('#btn-layers').addEventListener('click', () => {
    const open = $('#map-layers').classList.toggle('open');
    $('#btn-layers').setAttribute('aria-expanded', open);
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

  /** Chip perangkat yang bisa diklik untuk memilihnya di denah. */
  function chipDev(x) {
    return `<button type="button" class="chip" data-sel="${x.id}"><i style="background:${(TYPES[x.jenis] || TYPES.lainnya).color}"></i>${esc(x.nama)}</button>`;
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
        <p class="muted small">${m.list.length} perangkat${p.skala ? ` · skala 1 px = ${fmtM(p.skala).replace(' m', '')} m` : ''}</p>
        ${!p.denah_v && S.canEdit ? '<p class="note">Belum ada denah. Upload di tab <a href="#" data-go="proyek">Proyek</a>.</p>' : ''}
        ${!p.skala ? `<p class="note">Skala belum dikalibrasi — panjang kabel &amp; cakupan AP belum bisa dihitung. Pakai alat <a href="#" data-tool-go="ukur">Ukur</a> pada garis skala denah (mis. "7000 cm").</p>` : ''}
      </div>
      <div class="pn-sec">
        <h4>Jenis perangkat <span class="muted small">klik untuk sembunyikan</span></h4>
        <div class="legend">
          ${TYPE_ORDER.map(j => `<button type="button" class="lg-item${hiddenTypes.has(j) ? ' off' : ''}" data-hide="${j}">
            <i style="background:${TYPES[j].color}">${esc(TYPES[j].short)}</i>${esc(TYPES[j].label)}<b>${counts[j] || 0}</b></button>`).join('')}
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
    if (f.type === 'select') {
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
      <div class="pn-head">
        <i class="glyph" style="background:${t.color}">${esc(t.short)}</i>
        <div class="grow"><h3 id="pn-nama">${esc(d.nama)}</h3><span class="muted small">${esc(t.label)}${d.model ? ' · ' + esc(d.model) : ''}</span></div>
        <button type="button" class="icon" data-act="close" title="Tutup (Esc)">✕</button>
      </div>
      <div class="pn-actions">
        <button type="button" class="small" data-act="center">Pusatkan</button>
        ${S.canEdit ? `<button type="button" class="small" data-act="dup">Duplikat</button>
        <button type="button" class="small danger" data-act="del">Hapus</button>` : ''}
      </div>
      <div id="pn-info"></div>
      <form id="dev-form" autocomplete="off" onsubmit="return false">
        <div class="pn-sec">
          <h4>Identitas</h4>
          <div class="fgrid">
            ${fieldHtml({ k: 'nama', label: 'Nama / label *' }, d.nama, dis)}
            <label class="field"><span>Jenis</span><select data-f="jenis"${dis}>${TYPE_ORDER.map(j => `<option value="${j}"${j === d.jenis ? ' selected' : ''}>${esc(TYPES[j].label)}</option>`).join('')}</select></label>
            ${fieldHtml({ k: 'model', label: 'Nama alat (merek/tipe)', ph: 'mis. MikroTik hAP ax², TP-Link EAP650', wide: true }, d.model, dis)}
            <label class="field"><span>Status</span><select data-f="status"${dis}>${Object.keys(STATUS).map(k => `<option value="${k}"${k === d.status ? ' selected' : ''}>${STATUS[k].label}</option>`).join('')}</select></label>
            ${fieldHtml({ k: 'pic', label: 'PIC / teknisi' }, d.pic, dis)}
          </div>
        </div>
        <div class="pn-sec">
          <h4>Koneksi</h4>
          <div class="fgrid">
            <label class="field wide"><span>Uplink (sumber koneksi)</span>
              <div class="inline"><select data-f="uplink_id"${dis}>${uplinkOptions(d)}</select>
              ${S.canEdit ? '<button type="button" class="small" data-act="pick" title="Pilih uplink dengan klik di denah">Pilih di denah</button>' : ''}</div></label>
            ${fieldHtml({ k: 'port_uplink', label: 'Port di uplink', ph: 'mis. ether3 / port 5' }, d.port_uplink, dis)}
            ${fieldHtml({ k: 'port_lokal', label: 'Port di perangkat ini', ph: 'mis. ether1 / WAN' }, d.port_lokal, dis)}
            <label class="field"><span>Media ke uplink</span><select data-f="media"${dis}>${Object.keys(MEDIA).map(k => `<option value="${k}"${k === d.media ? ' selected' : ''}>${esc(MEDIA[k].label)}</option>`).join('')}</select></label>
            ${fieldHtml({ k: 'bandwidth_mbps', label: t.bwLabel, type: 'number' }, d.bandwidth_mbps, dis)}
            <div class="wide" id="pn-route"></div>
            ${fieldHtml({ k: 'ip', label: 'IP address', ph: 'mis. 10.10.0.11/22 · DHCP' }, d.ip, dis)}
            ${fieldHtml({ k: 'vlan', label: 'VLAN', ph: 'mis. 10 (tamu)' }, d.vlan, dis)}
          </div>
        </div>
        ${t.fields.length ? `<div class="pn-sec">
          <h4>${esc(t.label)}</h4>
          <div class="fgrid">${t.fields.map(f => fieldHtml(Object.assign({ attr: true }, f), a[f.k], dis)).join('')}</div>
        </div>` : ''}
        <div class="pn-sec">
          <h4>Keterangan konfigurasi</h4>
          <textarea data-f="catatan" rows="8" class="mono" placeholder="Catatan setting, mis.&#10;- ether1 → WAN Indihome (PPPoE: user@telkom.net)&#10;- bridge-lan: ether2-5, VLAN 10/20&#10;- /ip dhcp-server ... lease 30m&#10;- AP mode: access point, controller 10.10.0.5"${dis}>${esc(d.catatan)}</textarea>
          ${S.canEdit ? '<p class="muted small">Tersimpan otomatis saat pindah isian.</p>' : ''}
        </div>
      </form>`;
  }

  /** Bagian info (jalur WAN, bandwidth, kabel, anak, peringatan) — diperbarui tanpa mengganggu form. */
  function renderPanelInfo() {
    const box = $('#pn-info');
    const d = S.sel != null && S.model.byId.get(S.sel);
    if (!box || !d) {
      if (!box && S.tab === 'denah' && peta.tool !== 'ukur') renderPanel();
      return;
    }
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
    const chip = x => `<button type="button" class="chip" data-sel="${x.id}"><i style="background:${(TYPES[x.jenis] || TYPES.lainnya).color}"></i>${esc(x.nama)}</button>`;

    const kon = m.koneksi(d);
    let h = `<div class="pn-sec info"><div class="kv"><span>Internet</span><b>${konBadge(kon)}${kon === 'gangguan'
      ? ` <span class="muted">(${esc(path.filter(n => n.status === 'bermasalah').map(n => n.nama).join(', '))} bermasalah)</span>` : ''}</b></div>`;
    if (d.jenis === 'isp' && !m.parentOf(d)) {
      h += `<div class="kv"><span>Sumber WAN</span><b>${esc(d.atribut.provider || d.nama)}${d.bandwidth_mbps != null ? ' · ' + fmtBw(d.bandwidth_mbps) : ''}</b></div>`;
    } else {
      h += `<div class="kv col"><span>Jalur ke internet</span><div class="path">${path.map(chip).join('<span class="arr">→</span>')}${wan ? '' : '<span class="lv warn">tanpa sumber WAN</span>'}</div></div>`;
      if (wan) h += `<div class="kv"><span>WAN</span><b>${esc([wan.atribut.provider, wan.atribut.jenis_koneksi].filter(Boolean).join(' · ') || wan.nama)}${wan.bandwidth_mbps != null ? ' · ' + fmtBw(wan.bandwidth_mbps) : ''}</b></div>`;
    }
    if (bw.mbps != null) {
      h += `<div class="kv"><span>Bandwidth maks.</span><b>${fmtBw(bw.mbps)}${bw.at && bw.at.id !== d.id ? ` <span class="muted">(dibatasi ${esc(bw.at.nama)})</span>` : ''}</b></div>`;
    }
    if (m.parentOf(d)) {
      const berbelok = m.routePts(d).length > 2;
      h += `<div class="kv"><span>${d.media === 'wireless' ? 'Jarak link' : 'Kabel ke uplink'}</span><b>${jarak == null
        ? '<span class="muted">kalibrasi skala dulu</span>'
        : d.media === 'wireless' ? fmtM(jarak) : `≈ ${fmtM(kabel)} <span class="muted">(${berbelok ? 'jalur' : 'lurus'} ${fmtM(m.jalurM(d))} + ${S.proyek.slack_kabel}%)</span>`}</b></div>`;
    }
    if (kids.length) {
      h += `<div class="kv col"><span>Terhubung ke sini (${kids.length})${sumKids ? ' · total alokasi ' + fmtBw(sumKids) : ''}</span><div class="path wrap">${kids.map(chip).join('')}</div></div>`;
    }
    if (issues.length) {
      h += `<ul class="issues">${issues.map(c => `<li class="lv-${c.level}">${esc(c.msg)}</li>`).join('')}</ul>`;
    }
    h += '</div>';
    box.innerHTML = h;
    renderRoute(d);
  }

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
      case 'del': return deleteDev(id);
      case 'pick': return setTool('hubung');
    }
  });

  // Simpan otomatis tiap isian berubah.
  $('#panel').addEventListener('change', e => {
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
    }
    // Ganti jenis atau uplink -> isian/opsi lain ikut berubah, gambar ulang panel.
    const full = k === 'jenis';
    saveDev(d.id, patch, { keepPanel: !full }).catch(() => {});
  });

  // ------------------------------------------------------------------------ daftar perangkat

  function buildFilters() {
    $('#list-jenis').innerHTML += TYPE_ORDER.map(j => `<option value="${j}">${esc(TYPES[j].label)}</option>`).join('');
    $('#list-status').innerHTML += Object.keys(STATUS).map(k => `<option value="${k}">${STATUS[k].label}</option>`).join('');
  }
  ['#list-q', '#list-jenis', '#list-status'].forEach(s => $(s).addEventListener('input', renderDaftar));

  /** Ringkasan isian khusus jenis, mis. "SSID: EVENT · Ch: 36 · 5 GHz". */
  function attrSummary(d, hideSecret) {
    const t = TYPES[d.jenis] || TYPES.lainnya;
    const a = d.atribut || {};
    return t.fields.filter(f => a[f.k]).map(f => `${f.label}: ${f.secret && hideSecret ? '••••' : a[f.k]}`).join(' · ');
  }

  const COLS = [
    { k: 'nama', label: 'Nama', v: d => d.nama },
    { k: 'jenis', label: 'Jenis', v: d => TYPE_ORDER.indexOf(d.jenis), show: d => (TYPES[d.jenis] || TYPES.lainnya).label },
    { k: 'model', label: 'Nama alat', v: d => d.model },
    { k: 'ip', label: 'IP', v: d => d.ip.split('.').map(x => x.padStart(3, '0')).join('.') , show: d => d.ip },
    { k: 'vlan', label: 'VLAN', v: d => d.vlan },
    { k: 'uplink', label: 'Uplink', v: d => { const p = S.model.parentOf(d); return p ? p.nama : ''; } },
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
    return S.list.filter(d => (!j || d.jenis === j) && (!s || d.status === s) &&
      (!q || [d.nama, d.model, d.ip, d.vlan, d.pic, d.catatan, d.port_uplink, d.port_lokal, ...Object.values(d.atribut || {})].join(' ').toLowerCase().includes(q)));
  }

  function renderDaftar() {
    const col = COLS.find(c => c.k === S.sort.k) || COLS[1];
    const rows = filteredList().sort((a, b) => {
      const x = col.v(a), y = col.v(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'id', { numeric: true });
      return (c || a.nama.localeCompare(b.nama, 'id', { numeric: true })) * S.sort.dir;
    });
    const head = COLS.map(c => `<th data-sort="${c.k}" class="${c.k === S.sort.k ? (S.sort.dir > 0 ? 'asc' : 'desc') : ''}">${c.label}</th>`).join('') + '<th>Konfigurasi</th>';
    const body = rows.map(d => {
      const t = TYPES[d.jenis] || TYPES.lainnya;
      const p = S.model.parentOf(d);
      const extra = [attrSummary(d, true), d.catatan].filter(Boolean).join(' — ');
      // data-label dipakai tampilan kartu di HP; sel kosong disembunyikan di sana.
      const td = (label, html, cls) => `<td data-label="${label}" class="${cls || ''}${html ? '' : ' empty'}">${html}</td>`;
      return `<tr data-id="${d.id}">
        ${td('Nama', `<span class="dotlbl"><i style="background:${t.color}"></i><b>${esc(d.nama)}</b></span>`, 'c-nama')}
        ${td('Jenis', esc(t.label), 'c-jenis')}
        ${td('Nama alat', esc(d.model))}
        ${td('IP', esc(d.ip), 'mono')}
        ${td('VLAN', esc(d.vlan))}
        ${td('Uplink', p ? esc(p.nama) + (d.port_uplink ? ` <span class="muted">(${esc(d.port_uplink)})</span>` : '') : '<span class="muted">—</span>')}
        ${td('Internet', konBadge(S.model.koneksi(d)))}
        ${td('Media', esc(d.media ? (MEDIA[d.media].short || d.media) : ''))}
        ${td('Bandwidth', esc(fmtBw(d.bandwidth_mbps)), 'num')}
        ${td('Kabel', esc(kabelShow(d)), 'num')}
        ${td('Status', `<span class="st st-${d.status}">${esc((STATUS[d.status] || STATUS.rencana).label)}</span>`, 'c-status')}
        ${td('PIC', esc(d.pic))}
        <td data-label="Konfigurasi" class="cfg${extra ? '' : ' empty'}" title="${esc(extra)}">${esc(extra)}</td>
      </tr>`;
    }).join('');
    $('#dev-table').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${COLS.length + 1}" class="muted center">Tidak ada perangkat${S.list.length ? ' yang cocok' : ' — tambahkan dari tab Denah'}.</td></tr>`}</tbody>`;
  }

  $('#dev-table').addEventListener('click', e => {
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

  $('#btn-csv').addEventListener('click', () => {
    const rows = [['Nama', 'Jenis', 'Nama alat', 'IP', 'VLAN', 'Uplink', 'Port uplink', 'Port lokal', 'Media', 'Bandwidth (Mbps)',
      'Bandwidth maks. (Mbps)', 'Sumber WAN', 'Internet', 'Kabel (m)', 'Status', 'PIC', 'Isian khusus', 'Keterangan konfigurasi']];
    for (const d of NP.Model.sortDev(filteredList())) {
      const p = S.model.parentOf(d);
      const w = S.model.wanOf(d);
      const k = S.model.kabelM(d);
      rows.push([d.nama, (TYPES[d.jenis] || TYPES.lainnya).label, d.model, d.ip, d.vlan, p ? p.nama : '', d.port_uplink, d.port_lokal,
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
    const perangkat = list.map(d => Object.assign({}, d, {
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
    const chip = d => `<a href="#" class="dev-link" data-sel="${d.id}"><i style="background:${(TYPES[d.jenis] || TYPES.lainnya).color}">${esc((TYPES[d.jenis] || TYPES.lainnya).short)}</i>${esc(d.nama)}</a>`;
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
      const meta = [d.model, d.ip, d.vlan ? 'VLAN ' + d.vlan : '', a.ssid ? 'SSID ' + a.ssid : '', a.channel ? 'ch ' + a.channel : '', fmtBw(d.bandwidth_mbps)].filter(Boolean);
      const port = [d.port_lokal, d.port_uplink].filter(Boolean).join(' ↔ ');
      const lv = issuesBy.get(d.id);
      const kids = NP.Model.sortDev(m.kids(d.id));
      return `<div class="tnode" style="--d:${depth}">
          <div class="trow">
            ${chip(d)}
            <span class="muted small">${esc(t.label)}</span>
            ${port ? `<span class="port" title="Port lokal ↔ port di uplink">${esc(port)}${d.media ? ' · ' + esc(MEDIA[d.media].short || d.media) : ''}</span>` : d.media && depth ? `<span class="port">${esc(MEDIA[d.media].short || d.media)}</span>` : ''}
            <span class="st st-${d.status}">${esc((STATUS[d.status] || STATUS.rencana).label)}</span>
            ${konBadge(m.koneksi(d))}
            ${lv ? `<span class="lv ${lv}">${lv === 'err' ? 'masalah' : lv === 'warn' ? 'peringatan' : 'catatan'}</span>` : ''}
          </div>
          ${meta.length ? `<div class="tmeta">${meta.map(esc).join(' · ')}</div>` : ''}
        </div>` + kids.map(c => node(c, depth + 1)).join('');
    }
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
      return `<tr><td>${chip(w)}</td><td>${esc([w.atribut.provider, w.atribut.jenis_koneksi].filter(Boolean).join(' · '))}</td><td class="num">${esc(fmtBw(w.bandwidth_mbps))}</td><td class="num muted">${n} perangkat</td></tr>`;
    }).join('')}${wans.length > 1 ? `<tr class="tot"><td colspan="2">Total kapasitas</td><td class="num">${esc(fmtBw(totalWan))}</td><td></td></tr>` : ''}</table>` : '<p class="muted">Belum ada Sumber WAN/ISP.</p>';

    const ss = m.ssids();
    $('#ssid-sum').innerHTML = ss.length ? `<table class="mini"><tr><th>SSID</th><th>Keamanan</th><th>VLAN</th><th class="num">AP</th></tr>${ss.map(s =>
      `<tr><td><b>${esc(s.ssid)}</b></td><td>${esc([...s.keamanan].join(', '))}</td><td>${esc([...s.vlan].join(', '))}</td><td class="num">${s.ap.length}</td></tr>`).join('')}</table>` : '<p class="muted">Belum ada AP dengan SSID.</p>';

    const bom = m.bom();
    $('#bom').innerHTML = bom.length ? `<table class="mini"><tr><th>Jenis</th><th>Nama alat</th><th class="num">Jumlah</th></tr>${bom.map(b =>
      `<tr><td>${esc((TYPES[b.jenis] || TYPES.lainnya).label)}</td><td>${b.model ? esc(b.model) : '<span class="muted">(belum diisi)</span>'}</td><td class="num"><b>${b.jumlah}</b></td></tr>`).join('')}</table>` : '<p class="muted">—</p>';

    const kb = m.kabel();
    const keys = Object.keys(kb.tot);
    $('#kabel-sum').innerHTML = (keys.length ? `<table class="mini"><tr><th>Media</th><th class="num">Link</th><th class="num">Total</th></tr>${keys.map(k =>
      `<tr><td>${esc(MEDIA[k] ? MEDIA[k].label : k)}</td><td class="num">${kb.tot[k].n}</td><td class="num"><b>≈ ${esc(fmtM(kb.tot[k].m))}</b></td></tr>`).join('')}</table>
      <p class="muted small">Jarak lurus antartitik + ${S.proyek.slack_kabel}% (belokan, naik-turun, sisa). Tambahkan patch cord di rak.</p>` : '') +
      (kb.tanpaSkala ? `<p class="muted small">${kb.tanpaSkala} link belum bisa dihitung — kalibrasi skala denah dengan alat Ukur.</p>` : '') +
      (!keys.length && !kb.tanpaSkala ? '<p class="muted">Belum ada link kabel.</p>' : '');
  }

  $('[data-pane="topologi"]').addEventListener('click', e => {
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
        <p class="muted small">Halaman lihat-saja. Password disamarkan. Data diperbarui otomatis tiap 30 detik.</p></div>`;
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
      <div class="card">
        <h2>Aksi</h2>
        <div class="btn-row">
          <button type="button" data-p="dup">Duplikat event</button>
          <button type="button" class="danger" data-p="del">Hapus event</button>
        </div>
        <p class="muted small">Duplikat menyalin denah, skala, dan semua perangkat — cocok untuk event berulang di venue yang sama.</p>
      </div>`;
  }

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
        if (!confirm(`Hapus event "${p.nama}" beserta denah dan ${S.list.length} perangkatnya? Tidak bisa dibatalkan.`)) return;
        try {
          await api(API, { action: 'proyek_delete', id: p.id });
          S.proyek = null;
          location.hash = '#/';
          toast('Event dihapus');
        } catch (err) {
          toast(err.message, true);
        }
    }
  });

  // ======================================================================== cetak

  $('#btn-print').addEventListener('click', printReport);

  /** SVG statis seluruh denah untuk laporan cetak (ukuran titik relatif terhadap denah). */
  function staticMap() {
    const m = S.model;
    const { W, H } = peta.size();
    const u = Math.max(W, H) / 1100;
    const r = 9 * u;
    const img = denahUrl();
    let h = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="print-map">`;
    h += img ? `<rect width="${W}" height="${H}" fill="#fff"/><image href="${esc(img)}" width="${W}" height="${H}" opacity="${peta.opacity}"/>` : `<rect width="${W}" height="${H}" fill="#fff" stroke="#ccc"/>`;
    for (const d of m.list) {
      const rr = d.jenis === 'ap' && m.apRadiusPx(d);
      if (rr) h += `<circle cx="${d.x}" cy="${d.y}" r="${rr}" fill="${TYPES.ap.color}" fill-opacity=".08" stroke="${TYPES.ap.color}" stroke-opacity=".4" stroke-width="${u}"/>`;
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
      const t = TYPES[d.jenis] || TYPES.lainnya;
      const K = KONEKSI[m.koneksi(d)];
      const b = r * 0.8;
      h += `<g transform="translate(${d.x},${d.y})">
        <circle r="${r + 2.5 * u}" fill="#fff" stroke="${(STATUS[d.status] || STATUS.rencana).color}" stroke-width="${2 * u}"/>
        <circle r="${r}" fill="${t.color}"/>
        <text text-anchor="middle" dy=".35em" font-size="${(t.short.length > 2 ? 6.5 : 8) * u}" font-weight="700" fill="#fff" font-family="Arial">${esc(t.short)}</text>
        <circle cx="${b}" cy="${-b}" r="${4.5 * u}" fill="${K.color}" stroke="#fff" stroke-width="${1.2 * u}"/>
        <text x="${b}" y="${-b}" dy=".36em" text-anchor="middle" font-size="${6.5 * u}" font-weight="800" fill="#fff" font-family="Arial">${K.icon}</text>
        <text text-anchor="middle" y="${r + 11 * u}" font-size="${9 * u}" font-weight="700" fill="#111" stroke="#fff" stroke-width="${3 * u}" paint-order="stroke" font-family="Arial">${esc(d.nama)}</text>
      </g>`;
    }
    return h + '</svg>';
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
        <td><b>${esc(d.nama)}</b><br><span class="muted">${esc(t.label)}</span></td>
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
        <div><h2>Kebutuhan perangkat</h2><table class="pr-table"><tr><th>Jenis</th><th>Nama alat</th><th>Jml</th></tr>${bom.map(b => `<tr><td>${esc(TYPES[b.jenis].label)}</td><td>${esc(b.model || '(belum diisi)')}</td><td>${b.jumlah}</td></tr>`).join('')}</table>
          ${Object.keys(kb.tot).length ? `<h2>Estimasi kabel</h2><table class="pr-table">${Object.keys(kb.tot).map(k => `<tr><td>${esc(MEDIA[k].label)}</td><td>${kb.tot[k].n} link</td><td>≈ ${esc(fmtM(kb.tot[k].m))}</td></tr>`).join('')}</table>` : ''}</div>
        <div><h2>Pemeriksaan desain</h2>${checks.length ? `<ul>${checks.map(c => `<li class="lv-${c.level}">${esc(c.msg)}</li>`).join('')}</ul>` : '<p>Tidak ada masalah terdeteksi.</p>'}</div>
      </div>`;
    const imgEl = $('#print image');
    const doPrint = () => setTimeout(() => window.print(), 50);
    if (!imgEl) return doPrint();
    // Pastikan gambar denah sudah dimuat sebelum dialog cetak muncul.
    const pre = new Image();
    pre.onload = pre.onerror = doPrint;
    pre.src = imgEl.getAttribute('href');
  }

  boot();
})();
