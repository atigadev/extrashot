/*
 * Katalog perangkat: daftar alat standar (berlaku untuk semua event) per kategori, berisi spesifikasi
 * (port, PoE, daya, ...), stok, dan konfigurasi standar yang diisikan ke perangkat saat alat dipilih di denah.
 */
(function () {
  'use strict';
  const { TYPES, TYPE_ORDER, specFields, specSummary, poeKelas, api, esc, toast, downloadCsv, fmtBw } = NP;
  const API = 'api/admin.php';
  const $ = (s, root) => (root || document).querySelector(s);

  const K = { list: [], filter: '', q: '', onChange: null };

  const label = k => [k.merek, k.model].filter(Boolean).join(' ');

  async function load(proyekId) {
    const res = await api(API + '?action=katalog_list' + (proyekId ? '&proyek_id=' + proyekId : ''));
    K.list = res.katalog;
    K.list.forEach(terapkanStokGudang);
    return K.list;
  }

  // ------------------------------------------------------------------------ halaman daftar

  async function show(onChange) {
    K.onChange = onChange || K.onChange;
    $('#kat-list').innerHTML = '<p class="muted">Memuat…</p>';
    try {
      await load();
    } catch (e) {
      $('#kat-list').innerHTML = `<p class="err-text">${esc(e.message)}</p>`;
      throw e;
    }
    render();
  }

  function konfSummary(k) {
    const t = TYPES[k.jenis] || TYPES.lainnya;
    const c = k.konfigurasi || {};
    const nilai = f => (f.type === 'endpoint' ? ((NP.ET.find(x => String(x.id) === String(c[f.k])) || {}).nama || '?') : c[f.k]);
    const parts = t.fields.filter(f => c[f.k]).map(f => `${f.label}: ${f.secret ? '••••' : nilai(f)}`);
    if (k.bandwidth_mbps != null) parts.push(`${t.bwLabel.replace(/ \(Mbps\)/, '')}: ${fmtBw(k.bandwidth_mbps)}`);
    return parts.join(' · ');
  }

  /** Bar stok gudang berwarna (dipakai · tersedia · servis · rusak) + ringkasan teks. */
  function barGudang(g) {
    if (!g || !g.total) return '<div class="kat-gudang kosong">📦 <span>Belum ada unit di gudang</span></div>';
    const seg = [['dipakai', '#2563eb'], ['tersedia', '#16a34a'], ['servis', '#d97706'], ['rusak', '#dc2626']]
      .filter(([k]) => g[k]).map(([k, c]) => `<i style="flex:${g[k]};background:${c}" title="${g[k]} ${k}"></i>`).join('');
    return `<div class="kat-gudang"><div class="kg-bar">${seg}</div><span>${esc(ringkasGudang(g))}</span></div>`;
  }

  function render() {
    // Ringkasan seluruh katalog & gudang.
    const sum = { alat: K.list.length, unit: 0, tersedia: 0, dipakai: 0, servis: 0 };
    K.list.forEach(k => { const g = k.gudang; if (g) { sum.unit += g.total; sum.tersedia += g.tersedia; sum.dipakai += g.dipakai; sum.servis += g.servis + g.rusak; } });
    $('#kat-stat').innerHTML = K.list.length ? [['Alat di katalog', sum.alat, ''], ['Unit di gudang', sum.unit, ''], ['Tersedia', sum.tersedia, 'ok'],
      ['Dipakai di event', sum.dipakai, 'pakai'], ['Servis / rusak', sum.servis, sum.servis ? 'warn' : '']]
      .map(([l, n, c]) => `<div class="ks${c ? ' ' + c : ''}"><b>${n}</b><span>${l}</span></div>`).join('') : '';

    const counts = {};
    K.list.forEach(k => { counts[k.jenis] = (counts[k.jenis] || 0) + 1; });
    // Chip hanya untuk kategori yang ada isinya (plus kategori yang sedang dipilih).
    $('#kat-chips').innerHTML = [['', 'Semua', K.list.length]].concat(TYPE_ORDER.filter(j => counts[j] || K.filter === j).map(j => [j, TYPES[j].label, counts[j] || 0]))
      .map(([j, l, n]) => `<button type="button" class="chip-f${K.filter === j ? ' on' : ''}" data-f="${j}">${j ? `<i style="background:${TYPES[j].color}"></i>` : ''}${esc(l)} <b>${n}</b></button>`).join('');

    if (!K.list.length) {
      $('#kat-list').innerHTML = `<div class="empty-big"><b>Katalog masih kosong.</b><br>
        Tambahkan alat yang Anda pakai (router, switch, AP, …) beserta spesifikasi & konfigurasi standarnya,<br>atau mulai dari template standar lalu sesuaikan merek/tipe & angkanya.
        <div class="btn-row" style="justify-content:center;margin-top:14px"><button type="button" class="primary super-only" data-act="new">+ Tambah alat</button>
        <button type="button" class="super-only" data-act="template">Isi template standar</button></div></div>`;
      return;
    }
    const q = K.q.trim().toLowerCase();
    const rows = K.list.filter(k => (!K.filter || k.jenis === K.filter) &&
      (!q || [k.merek, k.model, k.keterangan, specSummary(k.spesifikasi), konfSummary(k)].join(' ').toLowerCase().includes(q)));
    if (!rows.length) {
      $('#kat-list').innerHTML = '<p class="muted center">Tidak ada alat yang cocok.</p>';
      return;
    }
    // Tabel per kategori (urut TYPE_ORDER); di layar sempit tabel bisa digeser ke samping.
    $('#kat-list').innerHTML = TYPE_ORDER.filter(j => rows.some(k => k.jenis === j)).map(j => {
      const t = TYPES[j];
      const isi = rows.filter(k => k.jenis === j).sort((a, b) => label(a).localeCompare(label(b)));
      return `<section class="kat-sec">
        <h2><i style="background:${t.color}">${esc(t.short)}</i>${esc(t.label)} <span class="muted">${isi.length}</span></h2>
        <div class="kat-tbl-wrap"><table class="kat-tbl">
          <thead><tr><th class="c-alat">Alat (merek / tipe)</th><th class="c-spec">Spesifikasi</th><th class="c-konf">Konfigurasi standar</th>
            <th class="c-stok num">Stok</th><th class="c-gud">Gudang</th><th class="c-pakai num">Dipakai</th><th class="c-aksi"><span class="sr">Aksi</span></th></tr></thead>
          <tbody>${isi.map(k => {
            const konf = konfSummary(k);
            return `<tr class="kat-row" data-id="${k.id}">
              <td class="c-alat"><b>${esc(label(k))}</b>${k.keterangan ? `<small class="muted">${esc(k.keterangan)}</small>` : ''}</td>
              <td class="c-spec">${esc(specSummary(k.spesifikasi)) || '<span class="muted">—</span>'}</td>
              <td class="c-konf">${konf ? `<span class="kat-konf" title="${esc(konf)}">${esc(konf)}</span>` : '<span class="muted">—</span>'}</td>
              <td class="c-stok num"><span class="stok${k.stok === 0 ? ' habis' : ''}" title="${k.gudang ? 'Stok dari unit di gudang (unit rusak tidak dihitung)' : 'Stok diisi manual'}">${k.stok != null ? k.stok : '—'}</span></td>
              <td class="c-gud">${barGudang(k.gudang)}</td>
              <td class="c-pakai num" title="Jumlah titik yang memakai alat ini di semua event">${k.dipakai}</td>
              <td class="c-aksi"><div class="kat-aksi-row">
                <button type="button" class="small primary" data-act="gudang">📦 Gudang${k.gudang ? ' · ' + k.gudang.total : ''}</button>
                <button type="button" class="icon super-only" data-act="edit" title="Ubah alat" aria-label="Ubah ${esc(label(k))}">✎</button>
                <button type="button" class="icon super-only" data-act="dup" title="Duplikat alat" aria-label="Duplikat ${esc(label(k))}">⧉</button>
                <button type="button" class="icon danger super-only" data-act="del" title="Hapus alat" aria-label="Hapus ${esc(label(k))}">🗑</button></div></td>
            </tr>`;
          }).join('')}</tbody></table></div>
      </section>`;
    }).join('');
  }

  $('#kat-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    K.filter = b.dataset.f;
    render();
  });
  $('#kat-q').addEventListener('input', e => {
    K.q = e.target.value;
    render();
  });
  $('#kat-new').addEventListener('click', () => openEditor({ jenis: K.filter || 'switch' }));
  $('#kat-csv').addEventListener('click', () => {
    if (!K.list.length) return toast('Katalog masih kosong', true);
    const rows = [['Kategori', 'Merek', 'Tipe / model', 'Stok', 'Dipakai', 'Spesifikasi', 'Konfigurasi standar', 'Template konfigurasi', 'Keterangan']];
    K.list.forEach(k => rows.push([TYPES[k.jenis].label, k.merek, k.model, k.stok == null ? '' : k.stok, k.dipakai,
      specSummary(k.spesifikasi), konfSummary(k), k.catatan_konfig, k.keterangan]));
    downloadCsv(rows, 'katalog-perangkat.csv');
  });

  $('#kat-list').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const card = b.closest('[data-id]');
    const k = card && K.list.find(x => x.id === +card.dataset.id);
    switch (b.dataset.act) {
      case 'new': return openEditor({ jenis: K.filter || 'switch' });
      case 'template': return isiTemplate();
      case 'edit': return openEditor(k);
      case 'gudang': return bukaGudang(k);
      case 'dup': return openEditor(Object.assign({}, k, { id: null, model: k.model + ' (salinan)' }));
      case 'del':
        if (!confirm(`Hapus "${label(k)}" dari katalog?` + (k.dipakai ? `\n\n${k.dipakai} perangkat di event yang memakainya tetap ada (nama alat & konfigurasinya tidak berubah), hanya dilepas dari katalog.` : ''))) return;
        try {
          await api(API, { action: 'katalog_delete', id: k.id });
          K.list = K.list.filter(x => x.id !== k.id);
          render();
          changed();
          toast('Dihapus dari katalog');
        } catch (err) {
          toast(err.message, true);
        }
    }
  });

  function changed() {
    if (K.onChange) K.onChange(K.list);
  }

  // ------------------------------------------------------------------------ dialog tambah / ubah

  const dlg = $('#dlg-kat');
  const form = $('#form-kat');
  let editId = null;
  $('#kat-jenis').innerHTML = TYPE_ORDER.map(j => `<option value="${j}">${esc(TYPES[j].label)}</option>`).join('');

  function inputHtml(f, val, group) {
    const v = val == null ? '' : val;
    let input;
    if (f.type === 'endpoint') {
      input = `<select data-g="${group}" data-k="${f.k}"><option value="">—</option>${NP.ET.map(t =>
        `<option value="${t.id}"${String(t.id) === String(v) ? ' selected' : ''}>${esc(t.nama)}</option>`).join('')}</select>`;
    } else if (f.type === 'select') {
      const opts = f.options.includes(v) ? f.options : f.options.concat([v]);
      input = `<select data-g="${group}" data-k="${f.k}">${opts.map(o => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(o || '—')}</option>`).join('')}</select>`;
    } else {
      input = `<input type="${f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text'}"${f.type === 'number' ? ' step="any" min="0"' : ''} data-g="${group}" data-k="${f.k}" value="${esc(v)}" placeholder="${esc(f.ph || '')}"${f.type === 'password' ? ' autocomplete="new-password"' : ''}>`;
    }
    return `<label class="field"><span>${esc(f.label)}</span>${input}</label>`;
  }

  /** Isian spesifikasi & konfigurasi sesuai kategori; nilai yang sudah diketik dipertahankan saat kategori diganti. */
  function renderFields(jenis, spec, konf, bw) {
    const t = TYPES[jenis] || TYPES.lainnya;
    $('#kat-spec').innerHTML = specFields(jenis).map(f => inputHtml(f, spec[f.k], 's')).join('');
    $('#kat-konf').innerHTML = t.fields.map(f => inputHtml(f, konf[f.k], 'c')).join('') +
      inputHtml({ k: 'bandwidth_mbps', label: t.bwLabel, type: 'number' }, bw, 'b');
  }

  function collect(group) {
    const out = {};
    form.querySelectorAll(`[data-g="${group}"]`).forEach(el => {
      if (el.value.trim() !== '') out[el.dataset.k] = el.value.trim();
    });
    return out;
  }

  // ------------------------------------------------------------------------ tipe siap pakai (isi cepat)

  /**
   * Tipe umum per kategori untuk mengisi cepat spesifikasi & konfigurasi alat baru (merek/tipe tetap diisi sendiri).
   * Angka contoh praktik umum — sesuaikan dengan datasheet.
   */
  const TIPE = {
    switch: [
      { nama: 'Unmanaged 8 port', s: { port_lan: '8', kecepatan_port: '1 Gbps', poe_out: 'Tidak', daya_w: '5', pemasangan: 'Desktop' },
        c: { managed: 'Unmanaged', kecepatan: '1 Gbps', poe: 'Tidak' }, cat: '- Plug & play, tanpa VLAN\n- Hanya untuk ujung jaringan (booth / meja), bukan uplink antar switch' },
      { nama: 'Unmanaged PoE 8 port', s: { port_lan: '8', kecepatan_port: '1 Gbps', poe_out: '802.3af (PoE)', poe_port: '4', poe_budget_w: '65', pemasangan: 'Desktop' },
        c: { managed: 'Unmanaged', kecepatan: '1 Gbps', poe: 'PoE (af)', budget_poe: '65' }, cat: '- Cek total daya AP/CCTV ≤ budget PoE\n- Tanpa VLAN: hanya satu jaringan' },
      { nama: 'Smart PoE+ 8 port + 2 SFP', s: { port_lan: '8', kecepatan_port: '1 Gbps', port_sfp: '2', poe_out: '802.3at (PoE+)', poe_port: '8', poe_budget_w: '120', pemasangan: 'Desktop' },
        c: { managed: 'Smart / web managed', kecepatan: '1 Gbps', poe: 'PoE+ (at)', budget_poe: '120' }, cat: '- Port uplink: trunk VLAN event\n- Port AP: VLAN manajemen untagged + VLAN SSID tagged\n- Aktifkan loop prevention' },
      { nama: 'Smart PoE+ 16 port + 2 SFP', s: { port_lan: '16', kecepatan_port: '1 Gbps', port_sfp: '2', poe_out: '802.3at (PoE+)', poe_port: '16', poe_budget_w: '250', pemasangan: 'Rack 19"' },
        c: { managed: 'Smart / web managed', kecepatan: '1 Gbps', poe: 'PoE+ (at)', budget_poe: '250' }, cat: '- Uplink lewat SFP bila jarak > 90 m (fiber)\n- Aktifkan loop prevention / STP' },
      { nama: 'Managed L2 24 port + 4 SFP', s: { port_lan: '24', kecepatan_port: '1 Gbps', port_sfp: '4', poe_out: 'Tidak', pemasangan: 'Rack 19"' },
        c: { managed: 'Managed L2', kecepatan: '1 Gbps', poe: 'Tidak' }, cat: '- RSTP aktif, port edge untuk booth\n- Port booth: access VLAN tenant\n- IP manajemen di VLAN manajemen, ganti password admin' },
      { nama: 'Managed L2 PoE+ 24 port + 4 SFP', s: { port_lan: '24', kecepatan_port: '1 Gbps', port_sfp: '4', poe_out: '802.3at (PoE+)', poe_port: '24', poe_budget_w: '370', pemasangan: 'Rack 19"' },
        c: { managed: 'Managed L2', kecepatan: '1 Gbps', poe: 'PoE+ (at)', budget_poe: '370' }, cat: '- RSTP aktif\n- Port AP: trunk VLAN SSID\n- Pantau budget PoE saat semua AP menyala' },
      { nama: 'Managed L2 48 port + 4 SFP+', s: { port_lan: '48', kecepatan_port: '1 Gbps', port_sfp: '4', poe_out: 'Tidak', pemasangan: 'Rack 19"' },
        c: { managed: 'Managed L2', kecepatan: '10 Gbps (SFP+)', poe: 'Tidak' }, cat: '- Uplink 10G lewat SFP+ ke core\n- RSTP / loop protection aktif' },
      { nama: 'Multi-gig 2.5G PoE++ 8 port', s: { port_lan: '8', kecepatan_port: '2.5 Gbps', port_sfp: '2', poe_out: '802.3bt (PoE++)', poe_port: '8', poe_budget_w: '240', pemasangan: 'Desktop' },
        c: { managed: 'Managed L2', kecepatan: '2.5 Gbps', poe: 'PoE++ (bt)', budget_poe: '240' }, cat: '- Untuk AP WiFi 6E / 7 (port 2.5G)\n- Uplink 10G lewat SFP+' },
      { nama: 'Core / agregasi L3 24 SFP+', s: { port_lan: '4', kecepatan_port: '10 Gbps', port_sfp: '24', poe_out: 'Tidak', pemasangan: 'Rack 19"' },
        c: { managed: 'Managed L3', kecepatan: '10 Gbps (SFP+)', poe: 'Tidak' }, cat: '- Pusat semua uplink fiber dari switch hall\n- Inter-VLAN routing bila tidak di router\n- LACP ke router / server' },
      { nama: 'Outdoor / industrial PoE 8 port', s: { port_lan: '8', kecepatan_port: '1 Gbps', port_sfp: '2', poe_out: '802.3at (PoE+)', poe_port: '8', poe_budget_w: '120', pemasangan: 'Outdoor (IP65+)' },
        c: { managed: 'Smart / web managed', kecepatan: '1 Gbps', poe: 'PoE+ (at)', budget_poe: '120' }, cat: '- Box tahan air / panel outdoor, grounding\n- Uplink fiber bila jauh dari rak' },
    ],
  };

  /** Tombol tipe siap pakai (hanya alat baru & kategori yang punya daftar tipe). */
  function renderTipe(jenis) {
    const box = $('#kat-tipe');
    const daftar = !editId && TIPE[jenis];
    box.hidden = !daftar;
    if (!daftar) return;
    box.innerHTML = `<span>Tipe ${esc((TYPES[jenis] || TYPES.lainnya).label.toLowerCase())} siap pakai <small class="muted">— klik untuk mengisi spesifikasi &amp; konfigurasi standar</small></span>
      <div class="kat-tipe-list">${daftar.map((t, i) => `<button type="button" class="chip-f" data-tipe="${i}">${esc(t.nama)}</button>`).join('')}</div>`;
  }
  $('#kat-tipe').addEventListener('click', e => {
    const b = e.target.closest('[data-tipe]');
    if (!b) return;
    const f = form.elements;
    const t = TIPE[f.jenis.value][+b.dataset.tipe];
    // Nama tipe dipakai sebagai tipe/model bila masih kosong (atau masih nama tipe lain); merek tetap diisi sendiri.
    const namaTipe = TIPE[f.jenis.value].map(x => x.nama);
    if (!f.model.value.trim() || namaTipe.includes(f.model.value.trim())) f.model.value = t.nama;
    renderFields(f.jenis.value, Object.assign({}, t.s), Object.assign({}, t.c), collect('b').bandwidth_mbps);
    if (!f.catatan_konfig.value.trim() || TIPE[f.jenis.value].some(x => x.cat === f.catatan_konfig.value.trim())) f.catatan_konfig.value = t.cat;
    form.querySelectorAll('[data-tipe]').forEach(x => x.classList.toggle('on', x === b));
    f.merek.focus();
  });

  let simpanCb = null; // dipanggil sekali setelah alat tersimpan (mis. dari panel perangkat: langsung dipakai)

  /** Buka dialog tambah / ubah alat; onSaved(katalog) = opsional, dipanggil setelah tersimpan. */
  function openEditor(k, onSaved) {
    simpanCb = onSaved || null;
    k = k || {};
    editId = k.id || null;
    form.reset();
    $('#dlg-kat-title').textContent = editId ? 'Ubah alat' : 'Tambah alat';
    const f = form.elements;
    f.jenis.value = k.jenis || 'switch';
    f.merek.value = k.merek || '';
    f.model.value = k.model || '';
    f.stok.value = k.stok == null ? '' : k.stok;
    f.catatan_konfig.value = k.catatan_konfig || '';
    f.keterangan.value = k.keterangan || '';
    renderFields(f.jenis.value, Object.assign({}, k.spesifikasi), Object.assign({}, k.konfigurasi), k.bandwidth_mbps);
    renderTipe(f.jenis.value);
    dlg.showModal();
    (editId ? f.model : f.merek).focus();
  }

  $('#kat-jenis').addEventListener('change', () => {
    const b = collect('b');
    renderFields(form.elements.jenis.value, collect('s'), collect('c'), b.bandwidth_mbps);
    renderTipe(form.elements.jenis.value);
  });
  $('#form-kat [data-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { setTimeout(() => { simpanCb = null; }, 0); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = form.elements;
    const btn = form.querySelector('[type=submit]');
    const body = {
      action: 'katalog_save', id: editId, jenis: f.jenis.value, merek: f.merek.value, model: f.model.value, stok: f.stok.value,
      spesifikasi: collect('s'), konfigurasi: collect('c'), bandwidth_mbps: collect('b').bandwidth_mbps || '',
      catatan_konfig: f.catatan_konfig.value, keterangan: f.keterangan.value,
    };
    btn.disabled = true;
    try {
      const res = await api(API, body);
      const old = K.list.find(x => x.id === res.katalog.id);
      if (old) Object.assign(old, res.katalog);
      else K.list.push(Object.assign(res.katalog, { dipakai: 0, dipakai_event: 0 }));
      const cb = simpanCb;
      simpanCb = null;
      dlg.close();
      // Halaman katalog bisa belum pernah dibuka (dibuka dari panel perangkat): render daftar hanya bila ada.
      if ($('#kat-list') && !$('#katalog-page').hidden) render();
      changed();
      toast('Katalog tersimpan');
      if (cb) cb(old || res.katalog);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // ------------------------------------------------------------------------ template standar

  /**
   * Titik awal katalog: alat generik dengan konfigurasi standar praktik umum jaringan event.
   * Angka spesifikasi hanya contoh — ganti merek/tipe & sesuaikan dengan datasheet alat Anda.
   */
  const TEMPLATE = [
    { jenis: 'router', merek: 'Template', model: 'Router gateway event', spesifikasi: { port_lan: '5', kecepatan_port: '1 Gbps', port_sfp: '1', poe_in: 'Adaptor DC', pemasangan: 'Rack 19"' },
      konfigurasi: { mode_wan: 'Load balance (PCC/ECMP)', lease: '30m', dns: '1.1.1.1, 8.8.8.8', hotspot: 'Ya (hotspot router)', qos: 'Limit per user 5M/2M' },
      catatan_konfig: '- Ganti password admin default, matikan service yang tidak dipakai (telnet, ftp, api)\n- DHCP lease pendek (30 menit) karena klien event berganti cepat\n- NTP & zona waktu Asia/Jakarta\n- Backup konfigurasi sebelum dan sesudah event' },
    { jenis: 'switch', merek: 'Template', model: 'Switch PoE+ 8 port', spesifikasi: { port_lan: '8', kecepatan_port: '1 Gbps', port_sfp: '2', poe_out: '802.3at (PoE+)', poe_port: '8', poe_budget_w: '120', pemasangan: 'Desktop' },
      konfigurasi: { managed: 'Smart / web managed', vlan_trunk: 'Port uplink: trunk VLAN 10,20,30' },
      catatan_konfig: '- Port uplink: trunk (tagged) semua VLAN event\n- Port AP: VLAN manajemen untagged, VLAN SSID tagged\n- Aktifkan loop prevention / STP' },
    { jenis: 'switch', merek: 'Template', model: 'Switch 24 port non-PoE', spesifikasi: { port_lan: '24', kecepatan_port: '1 Gbps', port_sfp: '2', poe_out: 'Tidak', pemasangan: 'Rack 19"' },
      konfigurasi: { managed: 'Managed L2', vlan_trunk: 'SFP1 uplink trunk' }, catatan_konfig: '- Aktifkan STP/RSTP\n- Port booth: access VLAN tenant' },
    { jenis: 'ap', merek: 'Template', model: 'AP indoor WiFi 6 dual band', spesifikasi: { port_lan: '1', kecepatan_port: '1 Gbps', poe_in: '802.3at (PoE+)', daya_w: '15', standar_wifi: 'WiFi 6 (802.11ax)', band: '2.4 + 5 GHz', maks_client: '100', pemasangan: 'Ceiling / wall' },
      konfigurasi: { keamanan: 'WPA2-PSK', band: '2.4 + 5 GHz', lebar_kanal: '40 MHz', tx_power: 'Medium', maks_user: '60' },
      catatan_konfig: '- 2.4 GHz: lebar kanal 20 MHz, channel 1/6/11 saja\n- 5 GHz: 40 MHz, channel non-DFS bila memungkinkan\n- Band steering ON, client isolation ON untuk SSID tamu\n- Minimum RSSI -75 dBm, airtime fairness ON' },
    { jenis: 'bridge', merek: 'Template', model: 'Wireless bridge 5 GHz', spesifikasi: { port_lan: '1', poe_in: 'Passive 24V', band: '5 GHz', jarak_maks_m: '1000', pemasangan: 'Outdoor (IP65+)' },
      konfigurasi: { peran: 'AP / Base', frekuensi: '5 GHz / 40 MHz' }, catatan_konfig: '- Mode bridge (L2), pasangkan dengan unit Station\n- Arahkan hingga sinyal ≤ -60 dBm, catat azimuth' },
    { jenis: 'lan', merek: 'Template', model: 'Titik LAN booth', spesifikasi: { port_lan: '1' }, konfigurasi: { mode_ip: 'DHCP', jumlah_port: '1' }, catatan_konfig: '- Label kabel di kedua ujung dengan nama titik' },
    { jenis: 'cctv', merek: 'Template', model: 'Kamera IP PoE', spesifikasi: { port_lan: '1', poe_in: '802.3af (PoE)', daya_w: '6' }, konfigurasi: { poe: 'PoE' } },
  ];

  async function isiTemplate() {
    if (!confirm(`Tambahkan ${TEMPLATE.length} template standar ke katalog?\nGanti merek/tipe & sesuaikan angkanya dengan datasheet alat Anda.`)) return;
    try {
      for (const t of TEMPLATE) {
        const res = await api(API, Object.assign({ action: 'katalog_save' }, t));
        K.list.push(Object.assign(res.katalog, { dipakai: 0, dipakai_event: 0 }));
      }
      render();
      changed();
      toast('Template standar ditambahkan');
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ------------------------------------------------------------------------ penerapan ke perangkat

  /**
   * Perubahan yang diterapkan ke perangkat saat memilih alat katalog.
   * timpa=false: hanya mengisi isian yang masih kosong; timpa=true: konfigurasi standar menimpa isian perangkat.
   */
  function patchUntuk(d, k, timpa) {
    const atr = Object.assign({}, d.atribut);
    const set = (key, val) => {
      if (val == null || val === '') return;
      if (timpa || !atr[key]) atr[key] = String(val);
    };
    Object.keys(k.konfigurasi || {}).forEach(key => set(key, k.konfigurasi[key]));
    const s = k.spesifikasi || {};
    if (d.jenis === 'switch') {
      const n = (+s.port_lan || 0) + (+s.port_sfp || 0);
      if (n) set('jumlah_port', n);
      const pk = poeKelas(s.poe_out);
      if (pk != null) set('poe', { 0: 'Tidak', 1: 'PoE (af)', 2: 'PoE+ (at)', 3: 'PoE++ (bt)', p24: 'Passive PoE', p48: 'Passive PoE' }[pk]);
      if (s.poe_budget_w) set('budget_poe', s.poe_budget_w);
      set('kecepatan', { '100 Mbps': '100 Mbps', '1 Gbps': '1 Gbps', '2.5 Gbps': '2.5 Gbps', '10 Gbps': '10 Gbps (SFP+)' }[s.kecepatan_port]);
    }
    if (d.jenis === 'cctv') {
      const pk = poeKelas(s.poe_in);
      if (pk != null) set('poe', pk === 0 ? 'Adaptor' : 'PoE');
    }
    if (d.jenis === 'ap') {
      set('band', s.band);
      // Pola antena dari spesifikasi alat: omni / sektoral + lebar sektor (beamwidth).
      set('pola_antena', s.pola_antena);
      if (/^sektor/i.test(s.pola_antena || '')) set('lebar_sektor', s.lebar_beam);
    }
    if (NP.titikLan(d.jenis) && s.port_lan) set('jumlah_port', s.port_lan);
    const patch = { katalog_id: k.id, model: label(k), atribut: atr };
    if (k.bandwidth_mbps != null && (timpa || d.bandwidth_mbps == null)) patch.bandwidth_mbps = k.bandwidth_mbps;
    if (k.catatan_konfig && (timpa || !d.catatan)) patch.catatan = k.catatan_konfig;
    return patch;
  }

  // ------------------------------------------------------------------------ gudang: unit fisik per alat

  const superAdmin = () => !document.body.classList.contains('peran-event');
  const ukuran = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
  const waktu = s => { const t = s ? new Date(String(s).replace(' ', 'T')) : null; return t && !isNaN(t) ? t.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
  /** Status unit: tersedia di gudang / dipakai (event · titik) / servis / rusak. */
  function statusUnit(u) {
    if (u.perangkat_id) return `<span class="us-st dipakai" title="${esc(u.proyek_nama || '')}">Dipakai · ${esc(u.perangkat_nama || '')}<small>${esc(u.proyek_nama || '')}</small></span>`;
    const kd = NP.UNIT_KONDISI[u.kondisi] || NP.UNIT_KONDISI.baik;
    return u.kondisi === 'baik' ? '<span class="us-st ada">Tersedia</span>' : `<span class="us-st" style="--c:${kd.color}">${esc(kd.label)}</span>`;
  }
  /** Ringkasan stok gudang satu alat, mis. "12 unit · 5 tersedia · 6 dipakai · 1 servis". */
  function ringkasGudang(g) {
    if (!g || !g.total) return '';
    return [`${g.total} unit`, `${g.tersedia} tersedia`, g.dipakai ? `${g.dipakai} dipakai` : '', g.servis ? `${g.servis} servis` : '', g.rusak ? `${g.rusak} rusak` : ''].filter(Boolean).join(' · ');
  }

  function dialog(id, cls) {
    let d = document.getElementById(id);
    if (!d) {
      d = document.createElement('dialog');
      d.id = id;
      d.className = 'dlg ' + cls;
      document.body.appendChild(d);
    }
    return d;
  }

  const G = { k: null, units: [], q: '', onChange: null };

  /** Dialog gudang satu alat katalog: daftar unit, tambah (satu / massal), ubah, hapus. onChange(units) opsional. */
  async function bukaGudang(k, onChange) {
    G.k = k;
    G.q = '';
    G.onChange = onChange || null;
    const d = dialog('dlg-gudang', 'dlg-wide dlg-gudang');
    d.innerHTML = '<p class="muted">Memuat…</p>';
    if (!d.open) d.showModal();
    try {
      G.units = (await api(API + '?action=unit_list&katalog_id=' + k.id)).unit;
    } catch (e) {
      d.innerHTML = `<p class="err-text">${esc(e.message)}</p><div class="btn-row end"><button type="button" data-g-tutup>Tutup</button></div>`;
      return;
    }
    renderGudang();
  }

  function renderGudang() {
    const d = dialog('dlg-gudang', 'dlg-wide dlg-gudang');
    const k = G.k;
    const ed = superAdmin();
    const q = G.q.trim().toLowerCase();
    const rows = G.units.filter(u => !q || [u.sn, u.mac, u.firmware, u.aset, u.lokasi, u.perangkat_nama, u.proyek_nama].join(' ').toLowerCase().includes(q));
    const g = { total: G.units.length, tersedia: G.units.filter(u => !u.perangkat_id && u.kondisi === 'baik').length, dipakai: G.units.filter(u => u.perangkat_id).length,
      servis: G.units.filter(u => !u.perangkat_id && u.kondisi === 'servis').length, rusak: G.units.filter(u => !u.perangkat_id && u.kondisi === 'rusak').length };
    const t = TYPES[k.jenis] || TYPES.lainnya;
    d.innerHTML = `<div class="g-head"><i style="background:${t.color}">${esc(t.short)}</i><div><h2>Gudang · ${esc(label(k))}</h2>
        <p class="muted small">${esc(t.label)} · ${esc(ringkasGudang(g) || 'belum ada unit')} — unit fisik alat ini; dipasang ke titik di event lewat tab 📦 Unit panel perangkat.</p></div>
        <button type="button" class="icon" data-g-tutup aria-label="Tutup">✕</button></div>
      <div class="g-tools"><input type="search" data-g-q placeholder="Cari SN, MAC, aset, lokasi, event…" value="${esc(G.q)}">
        ${ed ? '<button type="button" class="primary small" data-g-baru>＋ Tambah unit</button><button type="button" class="small" data-g-massal>Tambah massal</button>' : ''}</div>
      <div class="g-isi">${G.units.length ? `<table class="mini us-tbl"><tr><th>SN</th><th>MAC</th><th>Firmware</th><th>No. aset</th><th>Lokasi</th><th>Status</th><th>File</th><th></th></tr>
        ${rows.map(u => `<tr data-u="${u.id}"><td class="mono">${esc(u.sn) || '—'}</td><td class="mono">${esc(u.mac) || '—'}</td><td>${esc(u.firmware) || '—'}</td>
          <td>${esc(u.aset) || '—'}</td><td>${esc(u.lokasi) || '—'}</td><td>${statusUnit(u)}</td><td>${u.berkas.length ? '📄 ' + u.berkas.length : '—'}</td>
          <td class="g-aksi"><button type="button" class="small" data-g-ubah>${ed ? 'Ubah' : 'Lihat'}</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Tidak ada unit yang cocok.</td></tr>'}</table>`
        : `<div class="empty-big"><b>Belum ada unit di gudang.</b><br>Catat setiap unit fisik alat ini (SN, MAC, firmware, no. aset) agar bisa dipasang ke titik di event dan dilacak pemakaiannya.</div>`}</div>
      <div class="btn-row end"><button type="button" data-g-tutup>Tutup</button></div>`;
  }

  document.addEventListener('click', async e => {
    const d = e.target.closest('#dlg-gudang');
    if (!d) return;
    if (e.target.closest('[data-g-tutup]')) return d.close();
    if (e.target.closest('[data-g-baru]')) return bukaUnit({ katalog_id: G.k.id, kondisi: 'baik', berkas: [] }, G.k, simpanGudang);
    if (e.target.closest('[data-g-massal]')) return bukaMassal();
    const tr = e.target.closest('[data-g-ubah]') && e.target.closest('[data-u]');
    if (tr) bukaUnit(G.units.find(u => u.id === +tr.dataset.u), G.k, simpanGudang);
  });
  document.addEventListener('input', e => {
    if (!e.target.matches('#dlg-gudang [data-g-q]')) return;
    G.q = e.target.value;
    const pos = e.target.selectionStart;
    renderGudang();
    const i = document.querySelector('#dlg-gudang [data-g-q]');
    i.focus();
    i.setSelectionRange(pos, pos);
  });

  /** Unit tersimpan / dihapus dari editor: perbarui daftar gudang & stok katalog. */
  function simpanGudang(u, hapus) {
    const i = G.units.findIndex(x => x.id === (u && u.id));
    if (hapus) G.units = G.units.filter(x => x.id !== u.id);
    else if (i >= 0) G.units[i] = u;
    else G.units.push(u);
    perbaruiStok(G.k.id, G.units);
    if (document.getElementById('dlg-gudang') && document.getElementById('dlg-gudang').open) renderGudang();
    if (G.onChange) G.onChange(G.units);
  }

  /** Stok katalog mengikuti unit gudang (unit rusak tidak dihitung). */
  function perbaruiStok(katId, units) {
    const k = K.list.find(x => x.id === katId);
    if (!k) return;
    const g = { total: units.length, tersedia: 0, dipakai: 0, servis: 0, rusak: 0 };
    units.forEach(u => { if (u.perangkat_id) g.dipakai++; else g[u.kondisi === 'servis' ? 'servis' : u.kondisi === 'rusak' ? 'rusak' : 'tersedia']++; });
    k.gudang = g.total ? g : null;
    terapkanStokGudang(k);
    if ($('#kat-list') && !$('#katalog-page').hidden) render();
    changed();
  }
  /** Alat yang punya daftar unit: stok = jumlah unit yang tidak rusak (isian stok manual diabaikan). */
  function terapkanStokGudang(k) {
    if (k.gudang && k.gudang.total) k.stok = k.gudang.total - k.gudang.rusak;
  }

  /** Editor satu unit: data, kondisi, catatan konfigurasi & file. onSaved(unit, hapus) dipanggil setelah berubah. */
  function bukaUnit(u, k, onSaved) {
    const d = dialog('dlg-unit-ed', 'dlg-unit-ed');
    const baru = !u.id;
    // Admin event: hanya unit yang sedang dipakai di eventnya (server menolak yang lain); tanpa hapus unit.
    const ed = superAdmin() || !!u.perangkat_id;
    const dis = ed ? '' : ' disabled';
    const kd = u.kondisi || 'baik';
    d.innerHTML = `<form autocomplete="off" data-ue>
      <h2>${baru ? 'Tambah unit' : 'Unit ' + esc(u.sn || u.aset || '#' + u.id)} <small class="muted">${esc(label(k))}</small></h2>
      ${baru ? '' : `<p class="small" style="margin:-4px 0 10px">${statusUnit(u)}</p>`}
      <div class="fgrid3">${NP.UNIT_FIELDS.map(f => `<label class="field"><span>${esc(f.label)}</span>${f.type === 'password'
        ? `<div class="inline"><input type="password" name="${f.k}" value="${esc(u[f.k] || '')}" autocomplete="new-password"${dis}><button type="button" class="small" data-ue-lihat title="Tampilkan">👁</button></div>`
        : `<input type="text" name="${f.k}" value="${esc(u[f.k] || '')}" placeholder="${esc(f.ph || '')}"${dis}>`}</label>`).join('')}
        <label class="field"><span>Kondisi</span><select name="kondisi"${dis}>${Object.keys(NP.UNIT_KONDISI).map(x => `<option value="${x}"${x === kd ? ' selected' : ''}>${esc(NP.UNIT_KONDISI[x].label)}</option>`).join('')}</select></label></div>
      <label class="field"><span>Catatan konfigurasi unit <small class="muted">(yang dipakai unit ini: SSID/VLAN khusus, channel dikunci, perubahan dari standar)</small></span>
        <textarea name="catatan" rows="4" class="mono"${dis}>${esc(u.catatan || '')}</textarea></label>
      ${baru ? '<p class="muted small">File konfigurasi / backup bisa diunggah setelah unit disimpan.</p>' : `<div class="ue-file">
        <h3 class="sec-title">File konfigurasi / backup <small class="muted">${u.berkas.length}/10 · maks. 10 MB per file</small></h3>
        ${u.berkas.length ? `<ul class="berkas-list">${u.berkas.map(b => `<li><a href="api/berkas.php?id=${b.id}" download>📄 <b>${esc(b.nama)}</b></a>
          <small class="muted">${esc(ukuran(b.ukuran))} · ${esc(waktu(b.created_at))}${b.oleh ? ' · ' + esc(b.oleh) : ''}</small>
          ${ed ? `<button type="button" class="icon" data-ue-fhapus="${b.id}" aria-label="Hapus ${esc(b.nama)}">✕</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted small">Belum ada file.</p>'}
        ${ed && u.berkas.length < 10 ? `<label class="btn small"><input type="file" data-ue-file hidden accept=".cfg,.conf,.config,.rsc,.backup,.bak,.txt,.json,.xml,.ini,.yaml,.yml,.csv,.log,.bin,.img,.dat,.tar,.tgz,.gz,.zip,.7z,.pdf">⬆ Unggah file konfigurasi</label>` : ''}
      </div>`}
      <div class="btn-row end">
        ${!baru && superAdmin() ? '<button type="button" class="danger" data-ue-hapus>Hapus unit</button><span class="spacer"></span>' : ''}
        <button type="button" data-ue-batal>${ed ? 'Batal' : 'Tutup'}</button>
        ${ed ? '<button type="submit" class="primary">Simpan</button>' : ''}
      </div></form>`;
    d._u = u;
    d._k = k;
    d._cb = onSaved;
    if (!d.open) d.showModal();
    const first = d.querySelector('input[name=sn]');
    if (first && ed) first.focus();
  }

  async function kirimUnit(d, extra) {
    const f = d.querySelector('[data-ue]');
    const body = Object.assign({ action: 'unit_save', id: d._u.id || null, katalog_id: d._k.id }, extra);
    [...f.elements].forEach(el => { if (el.name) body[el.name] = el.value; });
    const res = await api(API, body);
    return res.unit;
  }

  document.addEventListener('submit', async e => {
    const f = e.target.closest('#dlg-unit-ed [data-ue]');
    if (!f) return;
    e.preventDefault();
    const d = f.closest('dialog');
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const u = await kirimUnit(d);
      d.close();
      toast('Unit tersimpan');
      if (d._cb) d._cb(u);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
  document.addEventListener('click', async e => {
    const d = e.target.closest('#dlg-unit-ed');
    if (!d) return;
    if (e.target.closest('[data-ue-batal]')) return d.close();
    const lihat = e.target.closest('[data-ue-lihat]');
    if (lihat) {
      const i = lihat.previousElementSibling;
      i.type = i.type === 'password' ? 'text' : 'password';
      return;
    }
    if (e.target.closest('[data-ue-hapus]')) {
      const u = d._u;
      if (!confirm(`Hapus unit ${u.sn || u.aset || '#' + u.id} dari gudang?${u.perangkat_id ? `\nUnit ini sedang dipakai ${u.perangkat_nama} (${u.proyek_nama}) — titik itu menjadi tanpa unit.` : ''}${u.berkas.length ? `\n${u.berkas.length} file konfigurasinya ikut terhapus.` : ''}`)) return;
      try {
        await api(API, { action: 'unit_delete', id: u.id });
        d.close();
        toast('Unit dihapus dari gudang');
        if (d._cb) d._cb(u, true);
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    const fh = e.target.closest('[data-ue-fhapus]');
    if (fh) {
      const b = d._u.berkas.find(x => x.id === +fh.dataset.ueFhapus);
      if (!b || !confirm(`Hapus file "${b.nama}"?`)) return;
      try {
        const u = (await api(API, { action: 'berkas_hapus', id: b.id })).unit;
        if (d._cb) d._cb(u);
        bukaUnit(u, d._k, d._cb);
      } catch (err) {
        toast(err.message, true);
      }
    }
  });
  document.addEventListener('change', async e => {
    const inp = e.target.closest('#dlg-unit-ed [data-ue-file]');
    if (!inp || !inp.files[0]) return;
    const d = inp.closest('dialog');
    const fd = new FormData();
    fd.append('action', 'berkas_upload');
    fd.append('id', d._u.id);
    fd.append('berkas', inp.files[0]);
    toast('Mengunggah file…');
    try {
      const u = (await api(API, fd)).unit;
      toast('File tersimpan');
      if (d._cb) d._cb(u);
      bukaUnit(u, d._k, d._cb);
    } catch (err) {
      toast(err.message, true);
      inp.value = '';
    }
  });

  /** Tambah massal: tempel daftar (satu unit per baris: SN, MAC, no. aset — dipisah koma / tab / titik koma). */
  function bukaMassal() {
    const d = dialog('dlg-unit-ed', 'dlg-unit-ed');
    d.innerHTML = `<form data-um>
      <h2>Tambah unit massal <small class="muted">${esc(label(G.k))}</small></h2>
      <p class="muted small">Satu unit per baris: <b>SN, MAC, no. aset</b> (kolom MAC & aset boleh kosong; pemisah koma, tab, atau titik koma — bisa ditempel langsung dari Excel / packing list). SN / MAC yang sudah ada di gudang dilewati.</p>
      <textarea name="baris" rows="10" class="mono" placeholder="G1PD4A001, 30:0D:9E:AA:BB:01, BSI-AP-0031&#10;G1PD4A002, 30:0D:9E:AA:BB:02, BSI-AP-0032"></textarea>
      <div class="fgrid3"><label class="field"><span>Firmware (semua unit)</span><input type="text" name="firmware"></label>
        <label class="field"><span>Lokasi di gudang (semua unit)</span><input type="text" name="lokasi" placeholder="mis. Rak B2"></label></div>
      <div class="btn-row end"><button type="button" data-um-batal>Batal</button><button type="submit" class="primary">Tambahkan</button></div></form>`;
    if (!d.open) d.showModal();
    d.querySelector('textarea').focus();
  }
  document.addEventListener('click', e => {
    if (e.target.closest('#dlg-unit-ed [data-um-batal]')) e.target.closest('dialog').close();
  });
  document.addEventListener('submit', async e => {
    const f = e.target.closest('#dlg-unit-ed [data-um]');
    if (!f) return;
    e.preventDefault();
    const fw = f.elements.firmware.value.trim(), lok = f.elements.lokasi.value.trim();
    const baris = f.elements.baris.value.split(/\r?\n/).map(l => l.split(/\t|;|,/).map(s => s.trim())).filter(c => c.some(Boolean))
      .map(c => ({ sn: c[0] || '', mac: c[1] || '', aset: c[2] || '', firmware: fw, lokasi: lok }));
    if (!baris.length) return toast('Isi minimal satu baris', true);
    try {
      const res = await api(API, { action: 'unit_massal', katalog_id: G.k.id, baris });
      f.closest('dialog').close();
      G.units = res.unit;
      perbaruiStok(G.k.id, G.units);
      renderGudang();
      if (G.onChange) G.onChange(G.units);
      toast(`${res.jumlah} unit ditambahkan${res.dilewati.length ? ` · ${res.dilewati.length} dilewati (sudah ada): ${res.dilewati.slice(0, 3).join('; ')}` : ''}`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  NP.Katalog = { load, show, render, openEditor, patchUntuk, label, konfSummary, bukaGudang, bukaUnit, statusUnit, ringkasGudang, get list() { return K.list; } };
})();
