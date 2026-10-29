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

  function render() {
    const counts = {};
    K.list.forEach(k => { counts[k.jenis] = (counts[k.jenis] || 0) + 1; });
    $('#kat-chips').innerHTML = [['', 'Semua', K.list.length]].concat(TYPE_ORDER.map(j => [j, TYPES[j].label, counts[j] || 0]))
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
    $('#kat-list').innerHTML = TYPE_ORDER.filter(j => rows.some(k => k.jenis === j)).map(j => {
      const t = TYPES[j];
      return `<section class="kat-sec">
        <h2><i style="background:${t.color}">${esc(t.short)}</i>${esc(t.label)} <span class="muted">${rows.filter(k => k.jenis === j).length}</span></h2>
        <div class="kat-grid">${rows.filter(k => k.jenis === j).map(k => `
          <article class="kat-card" data-id="${k.id}">
            <div class="kat-top">
              <div class="grow"><b>${esc(label(k))}</b>${k.keterangan ? `<small class="muted">${esc(k.keterangan)}</small>` : ''}</div>
              <span class="stok" title="Jumlah unit tersedia">${k.stok != null ? `stok ${k.stok}` : 'stok —'}</span>
            </div>
            <div class="kat-spec">${esc(specSummary(k.spesifikasi)) || '<span class="muted">Spesifikasi belum diisi</span>'}</div>
            ${konfSummary(k) ? `<div class="kat-konf"><span>Standar:</span> ${esc(konfSummary(k))}</div>` : ''}
            <div class="kat-foot">
              <span class="muted small">Dipakai ${k.dipakai} perangkat di semua event</span>
              <span class="spacer"></span>
              <button type="button" class="small super-only" data-act="edit">Ubah</button>
              <button type="button" class="small super-only" data-act="dup">Duplikat</button>
              <button type="button" class="small danger super-only" data-act="del">Hapus</button>
            </div>
          </article>`).join('')}</div>
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

  NP.Katalog = { load, show, render, openEditor, patchUntuk, label, konfSummary, get list() { return K.list; } };
})();
