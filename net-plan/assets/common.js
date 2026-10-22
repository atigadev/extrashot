/* Helper bersama & definisi jenis perangkat Net Plan. */
(function () {
  'use strict';

  /** Pola pancaran antena AP/bridge: omni = lingkaran, sektoral = kipas sesuai arah & lebar sektor. */
  const POLA_OPT = ['', 'Omni (360°)', 'Sektoral'];

  /**
   * Jenis perangkat. fields = isian khusus jenis (disimpan di kolom atribut JSON).
   * secret: true -> disamarkan di link lihat-saja (lihat NP_RAHASIA di api/db.php).
   * parent: true -> lazim menjadi uplink perangkat lain.
   */
  const TYPES = {
    isp: {
      label: 'Sumber WAN / ISP', short: 'WAN', prefix: 'WAN', color: '#e11d48', parent: true,
      bwLabel: 'Kapasitas WAN (Mbps)',
      fields: [
        { k: 'provider', label: 'Provider', ph: 'mis. Indihome, Biznet, Telkomsel' },
        { k: 'jenis_koneksi', label: 'Jenis koneksi', type: 'select', options: ['', 'Fiber broadband', 'Dedicated / Metro-E', 'Astinet', '4G/5G modem', 'Starlink / satelit', 'Radio (BTS)', 'Lainnya'] },
        { k: 'upload_mbps', label: 'Upload (Mbps)', type: 'number', ph: 'bila tidak simetris' },
        { k: 'id_layanan', label: 'ID layanan / CID', ph: 'nomor internet / circuit ID' },
        { k: 'ip_publik', label: 'IP publik', ph: 'mis. 203.0.113.10/29 atau dinamis' },
        { k: 'gateway', label: 'Gateway ISP' },
        { k: 'perangkat_isp', label: 'Perangkat ISP', ph: 'mis. ONT ZTE F670L (bridge)' },
        { k: 'kontak_noc', label: 'Kontak NOC / teknisi', ph: 'nama & nomor' },
      ],
    },
    router: {
      label: 'Router / Gateway', short: 'R', prefix: 'RTR', color: '#7c3aed', parent: true,
      bwLabel: 'Throughput / limit (Mbps)',
      fields: [
        { k: 'mode_wan', label: 'Mode WAN', type: 'select', options: ['', 'Single WAN', 'Load balance (PCC/ECMP)', 'Failover', 'Bonding'] },
        { k: 'subnet_lan', label: 'Subnet LAN', ph: 'mis. 10.10.0.0/22' },
        { k: 'dhcp', label: 'DHCP pool', ph: 'mis. 10.10.1.10 – 10.10.3.250' },
        { k: 'lease', label: 'DHCP lease', ph: 'mis. 30m (event ramai: pendek)' },
        { k: 'dns', label: 'DNS', ph: 'mis. 1.1.1.1, 8.8.8.8' },
        { k: 'hotspot', label: 'Hotspot / captive portal', type: 'select', options: ['', 'Tidak', 'Ya (hotspot router)', 'Ya (controller/cloud)'] },
        { k: 'qos', label: 'QoS / limit per user', ph: 'mis. simple queue 5M/2M per IP' },
        { k: 'user_admin', label: 'User admin' },
        { k: 'pass_admin', label: 'Password admin', type: 'password', secret: true },
      ],
    },
    switch: {
      label: 'Switch', short: 'SW', prefix: 'SW', color: '#2563eb', parent: true,
      bwLabel: 'Kapasitas uplink (Mbps)',
      fields: [
        { k: 'jumlah_port', label: 'Jumlah port', type: 'number' },
        { k: 'poe', label: 'PoE', type: 'select', options: ['', 'Tidak', 'PoE (af)', 'PoE+ (at)', 'PoE++ (bt)', 'Passive PoE'] },
        { k: 'budget_poe', label: 'Budget PoE (W)', type: 'number' },
        { k: 'managed', label: 'Tipe', type: 'select', options: ['', 'Unmanaged', 'Smart / web managed', 'Managed L2', 'Managed L3'] },
        { k: 'kecepatan', label: 'Kecepatan port', type: 'select', options: ['', '100 Mbps', '1 Gbps', '2.5 Gbps', '10 Gbps (SFP+)'] },
        { k: 'vlan_trunk', label: 'VLAN trunk / tagged', ph: 'mis. port 1 trunk: 10,20,30' },
        { k: 'lokasi_rak', label: 'Lokasi / rak', ph: 'mis. meja FOH, rak panggung' },
      ],
    },
    ap: {
      label: 'Access Point (WiFi)', short: 'AP', prefix: 'AP', color: '#059669',
      bwLabel: 'Limit bandwidth (Mbps)',
      fields: [
        { k: 'ssid', label: 'SSID', ph: 'mis. EVENT-FREE' },
        { k: 'keamanan', label: 'Keamanan', type: 'select', options: ['', 'Open', 'Open + captive portal', 'WPA2-PSK', 'WPA2/WPA3-PSK', 'WPA3-SAE', 'WPA2-Enterprise'] },
        { k: 'password', label: 'Password WiFi', type: 'password', secret: true },
        { k: 'ssid_lain', label: 'SSID tambahan', ph: 'mis. PANITIA (VLAN 20), MEDIA (VLAN 30)' },
        { k: 'band', label: 'Band', type: 'select', options: ['', '2.4 GHz', '5 GHz', '2.4 + 5 GHz', '6 GHz', 'Tri-band'] },
        { k: 'channel', label: 'Channel', ph: 'mis. 1 / 36' },
        { k: 'lebar_kanal', label: 'Lebar kanal', type: 'select', options: ['', '20 MHz', '40 MHz', '80 MHz', '160 MHz'] },
        { k: 'tx_power', label: 'TX power', ph: 'mis. 17 dBm / medium' },
        { k: 'maks_user', label: 'Target user', type: 'number', ph: 'klien bersamaan' },
        { k: 'radius_m', label: 'Radius / jangkauan (m)', type: 'number', ph: 'untuk ilustrasi cakupan di denah' },
        { k: 'pola_antena', label: 'Pola pancaran', type: 'select', options: POLA_OPT },
        { k: 'arah_deg', label: 'Arah sektor (°)', type: 'number', ph: '0 = atas, searah jarum jam' },
        { k: 'lebar_sektor', label: 'Lebar sektor (°)', type: 'number', ph: 'mis. 60, 90, 120' },
        { k: 'mounting', label: 'Pemasangan', ph: 'mis. tiang 3 m, plafon, tripod' },
        { k: 'controller', label: 'Controller', ph: 'mis. Omada OC200, UniFi cloud, standalone' },
      ],
    },
    bridge: {
      label: 'Wireless bridge (PtP/PtMP)', short: 'PtP', prefix: 'PTP', color: '#0891b2', parent: true,
      bwLabel: 'Kapasitas link (Mbps)',
      fields: [
        { k: 'peran', label: 'Peran', type: 'select', options: ['', 'AP / Base', 'Station / Client'] },
        { k: 'pasangan', label: 'Pasangan link', ph: 'nama perangkat di sisi lain' },
        { k: 'frekuensi', label: 'Frekuensi / channel', ph: 'mis. 5745 MHz / 40 MHz' },
        { k: 'ssid', label: 'SSID link' },
        { k: 'password', label: 'Password link', type: 'password', secret: true },
        { k: 'jarak_m', label: 'Jarak link (m)', type: 'number' },
        { k: 'arah', label: 'Arah / azimuth', ph: 'mis. 120° ke gedung B' },
        { k: 'sinyal', label: 'Sinyal target', ph: 'mis. -55 dBm' },
      ],
    },
    lan: {
      label: 'Titik LAN', short: 'LAN', prefix: 'LAN', color: '#d97706', parent: true, // endpoint terhubung ke titik LAN
      bwLabel: 'Limit bandwidth (Mbps)',
      fields: [
        { k: 'peruntukan', label: 'Peruntukan', ph: 'mis. Booth Vespa, kasir, LED panggung' },
        { k: 'jumlah_port', label: 'Jumlah port / kabel', type: 'number' },
        { k: 'mode_ip', label: 'Mode IP', type: 'select', options: ['', 'DHCP', 'Statis', 'DHCP reserved'] },
        { k: 'kontak', label: 'Kontak pengguna', ph: 'nama & nomor tenant' },
      ],
    },
    server: {
      label: 'Server / NVR / Controller', short: 'SRV', prefix: 'SRV', color: '#475569',
      bwLabel: 'Bandwidth (Mbps)',
      fields: [
        { k: 'fungsi', label: 'Fungsi', ph: 'mis. controller WiFi, NVR, streaming, registrasi' },
        { k: 'os', label: 'OS / software' },
        { k: 'layanan', label: 'Layanan / port', ph: 'mis. 8043/tcp, RTSP 554' },
      ],
    },
    cctv: {
      label: 'CCTV / kamera / streaming', short: 'CAM', prefix: 'CAM', color: '#be185d',
      bwLabel: 'Bitrate (Mbps)',
      fields: [
        { k: 'resolusi', label: 'Resolusi', ph: 'mis. 4MP / 1080p60' },
        { k: 'poe', label: 'Daya', type: 'select', options: ['', 'PoE', 'Adaptor'] },
        { k: 'tujuan', label: 'Tujuan stream', ph: 'mis. NVR SRV-01, YouTube Live' },
      ],
    },
    endpoint: {
      label: 'Endpoint (klien)', short: 'EP', prefix: 'EP', color: '#0f766e',
      bwLabel: 'Limit bandwidth (Mbps)',
      // Tipe (laptop, PC, printer, pinpad, ...) diambil dari daftar tipe endpoint yang bisa diubah pengguna.
      fields: [
        { k: 'tipe_endpoint', label: 'Tipe endpoint', type: 'endpoint' },
        { k: 'hostname', label: 'Hostname' },
        { k: 'mac', label: 'MAC address', ph: 'mis. AA:BB:CC:DD:EE:FF' },
        { k: 'mode_ip', label: 'Mode IP', type: 'select', options: ['', 'DHCP', 'Statis', 'DHCP reserved'] },
        { k: 'os', label: 'OS / firmware' },
        { k: 'pengguna', label: 'Pengguna / unit', ph: 'mis. Kasir booth A, Registrasi' },
        { k: 'aset', label: 'No. aset / SN' },
      ],
    },
    lainnya: {
      label: 'Perangkat lain', short: '•', prefix: 'DEV', color: '#64748b',
      bwLabel: 'Bandwidth (Mbps)',
      fields: [
        { k: 'fungsi', label: 'Fungsi', ph: 'mis. printer, mesin EDC, UPS' },
      ],
    },
  };
  const TYPE_ORDER = ['isp', 'router', 'switch', 'bridge', 'ap', 'lan', 'server', 'cctv', 'endpoint', 'lainnya'];

  const STATUS = {
    rencana: { label: 'Rencana', color: '#94a3b8' },
    terpasang: { label: 'Terpasang', color: '#2563eb' },
    diuji: { label: 'Sudah diuji', color: '#16a34a' },
    bermasalah: { label: 'Bermasalah', color: '#dc2626' },
  };

  /** Status penarikan kabel ke uplink (atribut "kabel"; kosong = belum). Sama dengan NP_KABEL di api/db.php. */
  // Palet progresif yang tidak bentrok dengan warna jenis perangkat / media / status internet:
  // abu (belum) → kuning (ditarik) → biru langit (terminasi) → hijau (dites), merah mawar = bermasalah.
  // Ikon progres (○ ◑ ◕ ✓ ⚠) membuat status tetap terbaca tanpa mengandalkan warna saja.
  const KABEL = {
    belum: { label: 'Belum ditarik', short: 'Belum', color: '#94a3b8', icon: '○', step: 0 },
    ditarik: { label: 'Sudah ditarik', short: 'Ditarik', color: '#d97706', icon: '◑', step: 1, aksi: 'Tandai sudah ditarik' },
    terminasi: { label: 'Terminasi / konektor', short: 'Terminasi', color: '#0284c7', icon: '◕', step: 2, aksi: 'Tandai terminasi selesai' },
    dites: { label: 'Sudah dites OK', short: 'Dites OK', color: '#16a34a', icon: '✓', step: 3, aksi: 'Tandai sudah dites OK' },
    bermasalah: { label: 'Kabel bermasalah', short: 'Bermasalah', color: '#e11d48', icon: '⚠', step: -1 },
  };
  /** Perangkat yang butuh kabel ke uplink: punya uplink & bukan wireless. */
  const perluKabel = d => !!d && d.uplink_id != null && d.media !== 'wireless';
  const kabelSt = d => (d && d.atribut && KABEL[d.atribut.kabel] ? d.atribut.kabel : 'belum');

  const MEDIA = {
    '': { label: '—' },
    utp: { label: 'UTP (kabel LAN)', short: 'UTP', color: '#0369a1', dash: '' },
    fiber: { label: 'Fiber optik', short: 'FO', color: '#ea580c', dash: '' },
    wireless: { label: 'Wireless', short: 'WL', color: '#0d9488', dash: '9 6' },
    lainnya: { label: 'Lainnya', short: '?', color: '#64748b', dash: '2 5' },
  };

  /**
   * Status koneksi internet perangkat (dihitung dari jalur uplink, lihat Model.koneksi):
   * online = jalur sampai ke Sumber WAN; gangguan = ada perangkat "bermasalah" di jalurnya; offline = tidak sampai WAN.
   */
  const KONEKSI = {
    online: { label: 'Terhubung internet', short: 'Terhubung', color: '#16a34a', icon: '✓' },
    gangguan: { label: 'Ada gangguan di jalur', short: 'Gangguan', color: '#d97706', icon: '!' },
    offline: { label: 'Belum terhubung internet', short: 'Belum terhubung', color: '#dc2626', icon: '✕' },
  };

  /**
   * Isian spesifikasi katalog perangkat. untuk = kategori yang memakai isian ini (kosong = semua).
   * Nilai PoE memakai standar IEEE (af/at/bt) atau passive; dipakai pemeriksaan PoE & budget daya.
   */
  const POE_OPT = ['', 'Tidak', '802.3af (PoE)', '802.3at (PoE+)', '802.3bt (PoE++)', 'Passive 24V', 'Passive 48V'];
  const SPEC = [
    { k: 'port_lan', label: 'Port Ethernet', type: 'number', ph: 'jumlah port RJ45' },
    { k: 'kecepatan_port', label: 'Kecepatan port', type: 'select', options: ['', '100 Mbps', '1 Gbps', '2.5 Gbps', '10 Gbps'] },
    { k: 'port_sfp', label: 'Port SFP/SFP+', type: 'number', untuk: ['isp', 'router', 'switch', 'server'] },
    { k: 'poe_in', label: 'Daya masuk (PoE in)', type: 'select', options: POE_OPT.concat(['Adaptor DC']), untuk: ['router', 'switch', 'ap', 'bridge', 'cctv', 'lainnya'] },
    { k: 'poe_out', label: 'PoE out', type: 'select', options: POE_OPT, untuk: ['router', 'switch'] },
    { k: 'poe_port', label: 'Jumlah port PoE out', type: 'number', untuk: ['router', 'switch'] },
    { k: 'poe_budget_w', label: 'Budget PoE (W)', type: 'number', untuk: ['router', 'switch'] },
    { k: 'daya_w', label: 'Konsumsi daya maks. (W)', type: 'number' },
    { k: 'throughput_mbps', label: 'Throughput (Mbps)', type: 'number', untuk: ['isp', 'router', 'switch', 'ap', 'bridge'] },
    { k: 'standar_wifi', label: 'Standar WiFi', type: 'select', options: ['', 'WiFi 4 (802.11n)', 'WiFi 5 (802.11ac)', 'WiFi 6 (802.11ax)', 'WiFi 6E', 'WiFi 7 (802.11be)'], untuk: ['ap', 'bridge', 'router'] },
    { k: 'band', label: 'Band', type: 'select', options: ['', '2.4 GHz', '5 GHz', '2.4 + 5 GHz', '6 GHz', 'Tri-band', '60 GHz'], untuk: ['ap', 'bridge', 'router'] },
    { k: 'maks_client', label: 'Klien maks.', type: 'number', untuk: ['ap', 'router'] },
    { k: 'antena', label: 'Antena / gain', ph: 'mis. 2×2 MIMO, 16 dBi sektor', untuk: ['ap', 'bridge'] },
    { k: 'pola_antena', label: 'Pola pancaran', type: 'select', options: POLA_OPT, untuk: ['ap', 'bridge'] },
    { k: 'lebar_beam', label: 'Beamwidth horizontal (°)', type: 'number', ph: 'sektoral, mis. 90', untuk: ['ap', 'bridge'] },
    { k: 'jarak_maks_m', label: 'Jangkauan link maks. (m)', type: 'number', untuk: ['bridge'] },
    { k: 'pemasangan', label: 'Bentuk / pemasangan', type: 'select', options: ['', 'Indoor', 'Outdoor (IP65+)', 'Rack 19"', 'Desktop', 'Ceiling / wall'] },
    { k: 'os', label: 'OS / firmware', ph: 'mis. RouterOS 7, Omada, UniFi', untuk: ['router', 'switch', 'ap', 'bridge', 'server'] },
  ];
  const specFields = jenis => SPEC.filter(f => !f.untuk || f.untuk.includes(jenis));

  /** Ringkasan spesifikasi singkat, mis. "8× 1 Gbps + 2 SFP · PoE+ out 8 port 120 W · maks. 15 W". */
  function specSummary(spec) {
    const s = spec || {};
    const out = [];
    if (s.port_lan || s.port_sfp) {
      out.push([s.port_lan ? s.port_lan + '×' + (s.kecepatan_port ? ' ' + s.kecepatan_port : ' port') : '', s.port_sfp ? s.port_sfp + ' SFP' : ''].filter(Boolean).join(' + '));
    }
    if (s.poe_out && s.poe_out !== 'Tidak') out.push(`PoE out ${s.poe_out.replace(/^802\.3\w+ /, '').replace(/[()]/g, '')}${s.poe_port ? ' ' + s.poe_port + ' port' : ''}${s.poe_budget_w ? ' ' + s.poe_budget_w + ' W' : ''}`);
    if (s.poe_in && s.poe_in !== 'Tidak') out.push('daya: ' + s.poe_in);
    if (s.standar_wifi) out.push(s.standar_wifi.replace(/ \(.*\)/, ''));
    if (s.band) out.push(s.band);
    if (/^sektor/i.test(s.pola_antena || '')) out.push('sektoral' + (s.lebar_beam ? ' ' + s.lebar_beam + '°' : ''));
    else if (s.pola_antena) out.push('omni');
    if (s.throughput_mbps) out.push(fmtBw(s.throughput_mbps));
    if (s.maks_client) out.push(s.maks_client + ' klien');
    if (s.daya_w) out.push('maks. ' + s.daya_w + ' W');
    if (s.pemasangan) out.push(s.pemasangan);
    return out.join(' · ');
  }

  /**
   * Pola pancaran perangkat: null bila omni/tidak diisi, atau {arah, lebar} untuk sektoral.
   * Arah dalam derajat: 0 = atas denah, searah jarum jam. Lebar bawaan 90°.
   */
  function sektor(d) {
    const a = (d && d.atribut) || {};
    if (!/^sektor/i.test(a.pola_antena || '')) return null;
    const lebar = Math.max(5, Math.min(359, parseFloat(a.lebar_sektor) || 90));
    const arah = ((parseFloat(a.arah_deg) || 0) % 360 + 360) % 360;
    return { arah, lebar };
  }

  /** Titik di arah (derajat, 0 = atas, searah jarum jam) sejauh r dari (cx, cy). */
  function polar(cx, cy, r, deg) {
    const t = deg * Math.PI / 180;
    return { x: cx + r * Math.sin(t), y: cy - r * Math.cos(t) };
  }

  /** Path SVG kipas/sektor berpusat di (cx, cy). */
  function wedgePath(cx, cy, r, arah, lebar) {
    const a = polar(cx, cy, r, arah - lebar / 2);
    const b = polar(cx, cy, r, arah + lebar / 2);
    const f = n => n.toFixed(1);
    return `M${f(cx)} ${f(cy)}L${f(a.x)} ${f(a.y)}A${f(r)} ${f(r)} 0 ${lebar > 180 ? 1 : 0} 1 ${f(b.x)} ${f(b.y)}Z`;
  }

  /**
   * Ikon endpoint (garis putih, viewBox 24×24). Kunci sama dengan NP_IKON di api/db.php.
   */
  const IKON = {
    laptop: { label: 'Laptop', d: '<rect x="5" y="5" width="14" height="10" rx="1"/><path d="M2.5 19h19l-2-3.5h-15z"/>' },
    pc: { label: 'Komputer / monitor', d: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/>' },
    server: { label: 'Server', d: '<rect x="4" y="3" width="16" height="7.5" rx="1.5"/><rect x="4" y="13.5" width="16" height="7.5" rx="1.5"/><path d="M8 6.8h.01M8 17.3h.01M12 6.8h4M12 17.3h4"/>' },
    printer: { label: 'Printer', d: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/>' },
    pinpad: { label: 'Pinpad / EDC', d: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M9 5.5h6v3H9z"/><path d="M9 12h.01M12 12h.01M15 12h.01M9 15h.01M12 15h.01M15 15h.01M9 18h.01M12 18h.01M15 18h.01"/>' },
    scanner: { label: 'Scanner', d: '<path d="M3 8V4h4M21 8V4h-4M3 16v4h4M21 16v4h-4"/><path d="M7 8v8M10 8v8M13 8v8M16.5 8v8"/>' },
    tablet: { label: 'Tablet / kiosk', d: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/>' },
    telepon: { label: 'Telepon VoIP', d: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>' },
    tv: { label: 'TV / display', d: '<rect x="2" y="4" width="20" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/>' },
    absensi: { label: 'Mesin absensi', d: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 6h6v4H9zM12 13a3 3 0 0 0-3 3v2M15 18v-2a3 3 0 0 0-1.5-2.6"/>' },
    kamera: { label: 'Kamera', d: '<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>' },
    umum: { label: 'Perangkat umum', d: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9z"/>' },
  };

  /** SVG ikon endpoint; size dalam px, color = warna garis. */
  function ikonSvg(key, size, color) {
    const i = IKON[key] || IKON.umum;
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color || '#fff'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${i.d}</svg>`;
  }

  /** Daftar tipe endpoint dari server (diisi app.js): [{id, nama, singkatan, ikon, warna, prefix}]. */
  const ET = [];
  function setEndpointTipe(list) {
    ET.length = 0;
    (list || []).forEach(t => ET.push(t));
  }

  /** Tipe endpoint perangkat, atau null. */
  function tipeEp(d) {
    if (!d || d.jenis !== 'endpoint') return null;
    const id = parseInt(d.atribut && d.atribut.tipe_endpoint, 10);
    return ET.find(t => t.id === id) || null;
  }

  /** Tampilan titik perangkat {color, short, label}: endpoint memakai warna & singkatan tipenya. */
  function tampil(d) {
    const t = TYPES[d.jenis] || TYPES.lainnya;
    const e = tipeEp(d);
    // Endpoint: kotak berikon (tipe tanpa data -> ikon umum); perangkat infrastruktur: lingkaran berteks.
    if (d.jenis === 'endpoint') {
      return e ? { color: e.warna, short: e.singkatan, label: e.nama, prefix: e.prefix, ikon: e.ikon || 'umum' }
        : { color: t.color, short: t.short, label: t.label, prefix: t.prefix, ikon: 'umum' };
    }
    return { color: t.color, short: t.short, label: t.label, prefix: t.prefix };
  }

  /** Posisi titik dikunci (tidak bisa digeser di denah). */
  const terkunci = d => !!d && !!d.atribut && d.atribut.kunci === '1';

  /** Kelas PoE: 0 = tidak ada, 1 af, 2 at, 3 bt, 'p24'/'p48' passive, null = tidak diketahui. */
  function poeKelas(v) {
    if (!v) return null;
    const s = String(v);
    if (/tidak|adaptor/i.test(s)) return 0;
    if (/bt|\+\+/i.test(s)) return 3;
    if (/at|\+/i.test(s)) return 2;
    if (/af|^poe$/i.test(s)) return 1;
    if (/passive/i.test(s)) return /48/.test(s) ? 'p48' : 'p24';
    return null;
  }

  /** Panggil API; lempar Error berisi pesan server bila gagal. body: objek (JSON) atau FormData. */
  async function api(url, body) {
    const opt = { credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined) {
      opt.method = 'POST';
      opt.headers = { 'X-NP': '1' };
      if (body instanceof FormData) {
        opt.body = body;
      } else {
        opt.headers['Content-Type'] = 'application/json';
        opt.body = JSON.stringify(body);
      }
    }
    let res, data;
    try {
      res = await fetch(url, opt);
      data = await res.json();
    } catch (e) {
      const err = new Error(res && res.status === 413 ? 'File terlalu besar untuk server' : 'Tidak bisa terhubung ke server');
      err.network = true;
      throw err;
    }
    if (!data.ok) {
      const err = new Error(data.error || 'Terjadi kesalahan');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let toastTimer;
  /** Notifikasi singkat. action = {label, fn} menambahkan tombol (mis. "Batalkan") dan memperpanjang tampilnya. */
  function toast(msg, isErr, action) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.classList.toggle('has-action', !!action);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.addEventListener('click', () => {
        el.classList.remove('show');
        action.fn();
      }, { once: true });
      el.appendChild(b);
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 7000 : isErr ? 4500 : 2200);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // http (bukan https) di HP: clipboard API tidak tersedia, pakai cara lama.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Disalin ke clipboard');
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function downloadCsv(rows, filename) {
    const csv = rows.map(r => r.map(v => {
      const s = String(v == null ? '' : v);
      return /[";,\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';')).join('\r\n');
    // BOM + pemisah ";" agar langsung rapi saat dibuka di Excel versi Indonesia.
    downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), filename);
  }

  /** 1500 -> "1,5 Gbps", 50 -> "50 Mbps". */
  function fmtBw(mbps) {
    if (mbps == null || mbps === '' || isNaN(mbps)) return '';
    const n = Number(mbps);
    if (n >= 1000) return (Math.round(n / 100) / 10).toLocaleString('id-ID') + ' Gbps';
    return (Math.round(n * 100) / 100).toLocaleString('id-ID') + ' Mbps';
  }

  function fmtM(m) {
    if (m == null || isNaN(m)) return '';
    return (m >= 100 ? Math.round(m) : Math.round(m * 10) / 10).toLocaleString('id-ID') + ' m';
  }

  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s + 'T00:00:00');
    return isNaN(d) ? s : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function slug(s) {
    return String(s || 'netplan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'netplan';
  }

  window.NP = { TYPES, TYPE_ORDER, STATUS, MEDIA, KONEKSI, KABEL, perluKabel, kabelSt, SPEC, specFields, specSummary, poeKelas, sektor, polar, wedgePath, ET, setEndpointTipe, tipeEp, tampil, terkunci, IKON, ikonSvg, api, esc, toast, copy, downloadBlob, downloadCsv, fmtBw, fmtM, fmtDate, slug };
})();
