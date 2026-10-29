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
      label: 'Endpoint (klien)', short: 'EP', prefix: 'EP', color: '#ea580c',
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
    // Port LAN gedung: outlet LAN di dinding/lantai yang sudah tertanam & tersambung ke ruang server venue (jaringan
    // existing). Kabel uplink-nya tidak digambar & tidak dihitung (tertanam). Tanpa uplink = sumber jaringan gedung.
    lan_gedung: {
      label: 'Port LAN gedung', short: 'WP', prefix: 'WP', color: '#92400e', parent: true, tertanam: true,
      bwLabel: 'Kapasitas / limit (Mbps)',
      fields: [
        { k: 'kode_port', label: 'Kode / label port', ph: 'mis. B2-15 pada faceplate' },
        { k: 'ruang_server', label: 'Tersambung ke', ph: 'mis. Ruang server lt.1, rak IDF-2 port 24' },
        { k: 'jumlah_port', label: 'Jumlah port di outlet', type: 'number' },
        { k: 'mode_ip', label: 'Mode IP', type: 'select', options: ['', 'DHCP', 'Statis', 'DHCP reserved'] },
        { k: 'peruntukan', label: 'Peruntukan', ph: 'mis. Booth BSI, kasir, registrasi' },
        { k: 'pic_venue', label: 'PIC IT venue', ph: 'nama & nomor' },
      ],
    },
    // Titik listrik: berdiri sendiri (bukan perangkat jaringan, tanpa uplink). Perangkat jaringan bisa memilih titik
    // listrik pemasoknya -> beban (watt) dihitung terhadap kapasitas.
    listrik: {
      label: 'Titik listrik', short: '⚡', prefix: 'PWR', color: '#ca8a04', listrik: true, grup: 'support', tb: 'Listrik',
      bwLabel: '',
      fields: [
        // MCB = isian utama: daya yang bisa dipakai dihitung otomatis (tegangan × arus, 3 fase × √3).
        { k: 'arus_a', label: 'MCB (A) *', type: 'number', ph: 'pilih / ketik, mis. 16', list: [2, 4, 6, 10, 16, 20, 25, 32, 40, 50, 63] },
        { k: 'fase', label: 'Fase', type: 'select', options: ['1 fase', '3 fase'] },
        { k: 'tegangan_v', label: 'Tegangan (V)', type: 'number', ph: '220 (1 fase) / 380 (3 fase)' },
        { k: 'sumber_listrik', label: 'Sumber', type: 'select', options: ['', 'PLN venue', 'Panel booth', 'Genset', 'UPS', 'Lainnya'] },
        { k: 'soket', label: 'Jumlah stop kontak', type: 'number', ph: 'mis. 4' },
        { k: 'kapasitas_w', label: 'Kapasitas manual (W)', type: 'number', ph: 'kosong = dari MCB' },
        { k: 'lokasi_panel', label: 'Panel / MCB asal', ph: 'mis. Panel Hall A, MCB 12', wide: true },
      ],
    },
    // Peralatan support (bukan jaringan): UPS, genset, terminal, rak, monitor, sound, lampu, AC, ... Bisa memakai
    // titik listrik (konsumsi daya ikut dihitung) tetapi tanpa uplink jaringan.
    support: {
      label: 'Peralatan support', short: 'SUP', prefix: 'SUP', color: '#7c2d12', grup: 'support', tb: 'Support',
      bwLabel: '',
      fields: [
        { k: 'kategori_support', label: 'Kategori', type: 'select', options: ['', 'UPS', 'Genset', 'Terminal / stop kontak', 'Kabel roll', 'Rak / meja', 'Monitor / TV', 'Sound system', 'Lampu', 'AC / kipas', 'Printer label / kasir', 'Lainnya'] },
        { k: 'jumlah', label: 'Jumlah unit', type: 'number', ph: '1' },
        { k: 'kapasitas_support', label: 'Kapasitas / ukuran', ph: 'mis. UPS 1200 VA, genset 5 kVA, roll 25 m' },
        { k: 'pemilik', label: 'Pemilik / vendor', ph: 'mis. inventaris kantor, sewa vendor X' },
      ],
    },
    // Furniture (meja, kursi, sofa, panggung, ...): tata letak venue, tanpa koneksi & listrik. Ukuran (cm) + rotasi
    // digambar sebagai denah tapak berskala bila skala denah sudah dikalibrasi.
    furniture: {
      label: 'Furniture', short: 'FUR', prefix: 'FUR', color: '#a21caf', grup: 'furniture', tb: 'Furniture',
      bwLabel: '',
      fields: [
        { k: 'tipe_furniture', label: 'Jenis furniture', type: 'select', options: ['', 'Meja', 'Kursi', 'Meja + kursi (set)', 'Sofa', 'Lemari / loker', 'Rak display', 'Panggung', 'Podium', 'Partisi / sekat', 'Backdrop', 'Karpet', 'Tanaman', 'Lainnya'] },
        { k: 'jumlah', label: 'Jumlah unit', type: 'number', ph: '1' },
        { k: 'panjang_cm', label: 'Panjang per unit (cm)', type: 'number', ph: 'kosong = ukuran umum' },
        { k: 'lebar_cm', label: 'Lebar per unit (cm)', type: 'number', ph: 'kosong = ukuran umum' },
        { k: 'rotasi', label: 'Rotasi (°)', type: 'number', ph: '0 – 359', list: [0, 45, 90, 135, 180, 225, 270, 315] },
        { k: 'per_baris', label: 'Susunan: unit per baris', type: 'number', ph: 'mis. 7 (meja / kursi berjajar)' },
        { k: 'bahan', label: 'Warna / bahan', ph: 'mis. putih, kayu jati, cover hitam' },
        { k: 'pemilik', label: 'Pemilik / vendor', ph: 'mis. venue, sewa vendor X', wide: true },
      ],
    },
  };
  // lan_gedung di akhir kelompok jaringan agar pintasan tambah perangkat 1–9 (WAN … Endpoint) tidak bergeser.
  const TYPE_ORDER = ['isp', 'router', 'switch', 'bridge', 'ap', 'lan', 'server', 'cctv', 'endpoint', 'lainnya', 'lan_gedung', 'listrik', 'support', 'furniture'];

  /** Kelompok perangkat: 'jaringan' (default), 'support' (titik listrik & peralatan support) atau 'furniture'. */
  const grupJenis = j => (TYPES[j] || {}).grup || 'jaringan';
  const GRUP = { jaringan: 'Perangkat jaringan', support: 'Support & listrik', furniture: 'Furniture' };
  const GRUP_ORDER = ['jaringan', 'support', 'furniture'];
  /** Ukuran bawaan per jenis furniture (cm, panjang × lebar) bila belum diisi. */
  const FURN_UKURAN = {
    Meja: [120, 60], Kursi: [50, 50], 'Meja + kursi (set)': [120, 150], Sofa: [200, 85], 'Lemari / loker': [100, 50],
    'Rak display': [120, 40], Panggung: [600, 300], Podium: [60, 50], 'Partisi / sekat': [100, 8], Backdrop: [300, 25],
    Karpet: [200, 300], Tanaman: [50, 50],
  };
  /** Jenis furniture yang bisa disusun berjajar (jumlah unit × per baris). */
  const FURN_JAJAR = ['Meja', 'Kursi', 'Meja + kursi (set)', 'Sofa', 'Rak display', 'Lemari / loker'];

  /**
   * Simbol denah 2D (tampak atas, gaya floorplan) satu titik furniture, dalam koordinat denah (piksel gambar) dengan
   * pusat (0,0) dan menghadap ke bawah sebelum diputar. skala = m/piksel (null: dianggap 2 cm/piksel).
   * Unit lebih dari satu disusun berjajar (per_baris per baris). sw = tebal garis (dunia) bila tidak non-scaling.
   * Hasil {svg, w, h, rot}: w × h = ukuran seluruh susunan.
   */
  function furnSimbol(d, skala, o) {
    o = o || {};
    const a = d.atribut || {};
    const tp = a.tipe_furniture || '';
    const def = FURN_UKURAN[tp] || [60, 60];
    const px = cm => cm / 100 / (skala || 0.02);
    const uw = px(+a.panjang_cm > 0 ? +a.panjang_cm : def[0]), uh = px(+a.lebar_cm > 0 ? +a.lebar_cm : def[1]);
    const n = FURN_JAJAR.includes(tp) ? Math.max(1, Math.min(500, parseInt(a.jumlah, 10) || 1)) : 1;
    const kol = Math.max(1, Math.min(n, parseInt(a.per_baris, 10) || Math.min(n, 10)));
    const bar = Math.ceil(n / kol);
    const gx = tp === 'Kursi' ? uw * 0.25 : tp === 'Meja + kursi (set)' ? uw * 0.3 : uw * 0.05;
    const gy = tp === 'Kursi' ? uh * 0.35 : uh * 0.25;
    const W = kol * uw + (kol - 1) * gx, H = bar * uh + (bar - 1) * gy;
    const st = `stroke="${o.stroke || '#a21caf'}" stroke-width="${o.sw || 1.3}"${o.sw ? '' : ' vector-effect="non-scaling-stroke"'}`;
    const isi = o.fill || '#fdf4ff';
    const R = (x, y, w, h, ext) => `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(0.1, w).toFixed(2)}" height="${Math.max(0.1, h).toFixed(2)}" ${ext || ''} ${st}/>`;
    const L = (x1, y1, x2, y2, ext) => `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" ${ext || ''} ${st}/>`;
    // Kursi menghadap ke bawah (sandaran di atas); flip = menghadap ke atas.
    const kursi = (cx, cy, w, h, flip) => {
      const s = flip ? -1 : 1;
      const y = v => cy + s * v;
      const atas = (v, t) => Math.min(y(v), y(v + t));
      return R(cx - w / 2, atas(-h / 2, h * 0.2), w, h * 0.2, `rx="${(h * 0.06).toFixed(2)}" fill="${isi}"`) +
        R(cx - w / 2 + w * 0.13, atas(-h / 2 + h * 0.24, h * 0.72), w * 0.74, h * 0.72, `rx="${(w * 0.14).toFixed(2)}" fill="${isi}"`) +
        R(cx - w / 2, atas(-h / 2 + h * 0.2, h * 0.66), w * 0.1, h * 0.66, `rx="${(w * 0.04).toFixed(2)}" fill="${isi}"`) +
        R(cx + w / 2 - w * 0.1, atas(-h / 2 + h * 0.2, h * 0.66), w * 0.1, h * 0.66, `rx="${(w * 0.04).toFixed(2)}" fill="${isi}"`);
    };
    const satu = (cx, cy, w, h) => {
      const x0 = cx - w / 2, y0 = cy - h / 2;
      switch (tp) {
        case 'Kursi': return kursi(cx, cy, w, h);
        case 'Meja + kursi (set)': {
          const th = h * 0.42, cs = Math.min(h * 0.29, w * 0.9);
          const k = Math.max(1, Math.floor(w / (cs * 1.25)));
          let s = R(x0, cy - th / 2, w, th, `fill="${isi}"`);
          for (let i = 0; i < k; i++) {
            const kx = x0 + (w / k) * (i + 0.5);
            s += kursi(kx, y0 + cs / 2, cs * 0.9, cs) + kursi(kx, y0 + h - cs / 2, cs * 0.9, cs, true);
          }
          return s;
        }
        case 'Sofa': {
          const k = Math.max(1, Math.round((w * 0.76) / (h * 0.8)));
          let s = R(x0, y0, w, h, `rx="${(h * 0.1).toFixed(2)}" fill="${isi}"`) + R(x0, y0, w, h * 0.25, `rx="${(h * 0.08).toFixed(2)}" fill="${isi}"`) +
            R(x0, y0, w * 0.12, h, `rx="${(h * 0.08).toFixed(2)}" fill="${isi}"`) + R(x0 + w * 0.88, y0, w * 0.12, h, `rx="${(h * 0.08).toFixed(2)}" fill="${isi}"`);
          for (let i = 1; i < k; i++) s += L(x0 + w * 0.12 + (w * 0.76 / k) * i, y0 + h * 0.25, x0 + w * 0.12 + (w * 0.76 / k) * i, y0 + h);
          return s;
        }
        case 'Lemari / loker':
          return R(x0, y0, w, h, `fill="${isi}"`) + L(x0, y0, x0 + w, y0 + h) + L(x0 + w, y0, x0, y0 + h);
        case 'Rak display':
          return R(x0, y0, w, h, `fill="${isi}"`) + L(x0, y0 + h / 3, x0 + w, y0 + h / 3) + L(x0, y0 + h * 2 / 3, x0 + w, y0 + h * 2 / 3);
        case 'Panggung': {
          const fs = Math.min(h * 0.16, w * 0.09);
          let s = R(x0, y0, w, h, `fill="${isi}"`) + R(x0 + w * 0.04, y0 + h * 0.06, w * 0.92, h * 0.88, 'fill="none" stroke-dasharray="4 3"');
          s += `<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" dy=".35em" text-anchor="middle" font-size="${fs.toFixed(2)}" font-family="Arial" font-weight="700" fill="${o.stroke || '#a21caf'}" letter-spacing="${(fs * 0.15).toFixed(2)}">PANGGUNG</text>`;
          return s;
        }
        case 'Podium':
          return R(x0, y0, w, h, `rx="${(w * 0.08).toFixed(2)}" fill="${isi}"`) + R(x0 + w * 0.15, y0 + h * 0.1, w * 0.7, h * 0.35, `fill="none"`) +
            `<circle cx="${cx.toFixed(2)}" cy="${(y0 + h * 0.72).toFixed(2)}" r="${(Math.min(w, h) * 0.08).toFixed(2)}" fill="${o.stroke || '#a21caf'}"/>`;
        case 'Partisi / sekat':
        case 'Backdrop':
          return R(x0, y0, w, h, `fill="${o.stroke || '#a21caf'}" fill-opacity=".55"`);
        case 'Karpet':
          return R(x0, y0, w, h, `fill="${isi}" fill-opacity=".6"`) + R(x0 + w * 0.06, y0 + h * 0.06, w * 0.88, h * 0.88, 'fill="none" stroke-dasharray="3 3"');
        case 'Tanaman': {
          const r = Math.min(w, h) / 2;
          let s = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${isi}" ${st}/>`;
          for (let i = 0; i < 6; i++) {
            const t = i * Math.PI / 3, lx = cx + Math.sin(t) * r * 0.5, ly = cy - Math.cos(t) * r * 0.5;
            s += `<ellipse cx="${lx.toFixed(2)}" cy="${ly.toFixed(2)}" rx="${(r * 0.22).toFixed(2)}" ry="${(r * 0.42).toFixed(2)}" transform="rotate(${i * 60} ${lx.toFixed(2)} ${ly.toFixed(2)})" fill="none" ${st}/>`;
          }
          return s;
        }
        case 'Meja': return R(x0, y0, w, h, `fill="${isi}"`);
        default: return R(x0, y0, w, h, `fill="${isi}"`) + L(x0, y0, x0 + w, y0 + h);
      }
    };
    let svg = '';
    for (let i = 0; i < n; i++) {
      const c = i % kol, b = Math.floor(i / kol);
      svg += satu(-W / 2 + uw / 2 + c * (uw + gx), -H / 2 + uh / 2 + b * (uh + gy), uw, uh);
    }
    return { svg, w: W, h: H, rot: (+a.rotasi || 0) % 360 };
  }

  /** Singkatan di titik denah per jenis furniture. */
  const FURN_SINGKAT = { Meja: 'MJ', Kursi: 'KS', 'Meja + kursi (set)': 'MK', Sofa: 'SF', 'Lemari / loker': 'LM', 'Rak display': 'RK', Panggung: 'PG', Podium: 'PD', 'Partisi / sekat': 'PT', Backdrop: 'BD', Karpet: 'KP', Tanaman: 'TN' };

  /**
   * Daya dari MCB (W): tegangan × arus; 3 fase = √3 × V × A (tegangan default 220 V / 380 V untuk 3 fase).
   * Hasil {w, v, a, tiga} atau null bila MCB belum diisi.
   */
  function dayaMcb(atr) {
    const a = parseFloat(atr && atr.arus_a);
    if (!(a > 0)) return null;
    const tiga = atr.fase === '3 fase';
    const v = parseFloat(atr.tegangan_v) > 0 ? parseFloat(atr.tegangan_v) : tiga ? 380 : 220;
    return { w: v * a * (tiga ? Math.sqrt(3) : 1), v, a, tiga };
  }

  // ---- Ceklis pekerjaan per perangkat: penarikan kabel, penempatan, konfigurasi.
  // Item "link" tersinkron dengan data lain (status kabel / status pemasangan) sehingga tidak dicatat dua kali;
  // item lain disimpan di atribut "ceklis" (JSON {key: {t: waktu, o: oleh}}). Item tambahan: atribut "ceklis_x".
  const CEKLIS_GRUP = {
    kabel: { label: 'Penarikan kabel', icon: '🔌' },
    pasang: { label: 'Penempatan', icon: '📦' },
    konfig: { label: 'Konfigurasi', icon: '⚙' },
    lain: { label: 'Tambahan', icon: '＋' },
  };
  const KONFIG = {
    isp: [['modem', 'Modem/ONT aktif, login dicatat'], ['speedtest', 'Speedtest WAN sesuai paket']],
    router: [['wan', 'WAN / PPPoE / IP publik'], ['dhcp', 'LAN, DHCP & DNS'], ['nat', 'NAT & firewall'], ['qos', 'Limit bandwidth / QoS'],
      ['vlan', 'VLAN / hotspot'], ['backup', 'Backup konfigurasi & ganti password admin']],
    switch: [['vlan', 'VLAN & trunk'], ['stp', 'STP/RSTP / loop protection'], ['poe', 'PoE port aktif'], ['mgmt', 'IP manajemen & password admin'],
      ['label_port', 'Label port']],
    ap: [['ssid', 'SSID & password'], ['channel', 'Channel & tx power'], ['vlan', 'VLAN / controller'], ['firmware', 'Firmware terbaru'],
      ['sinyal', 'Uji sinyal & speedtest']],
    bridge: [['mode', 'Mode AP/station & SSID'], ['align', 'Alignment antena'], ['link', 'Uji link (RSSI/CCQ, throughput)']],
    lan: [['tes_port', 'Uji koneksi port (link up)']],
    lan_gedung: [['aktif', 'Port aktif dari ruang server (link up)'], ['ip', 'IP / DHCP & internet dari jaringan gedung'], ['label', 'Kode port dicatat / dilabel']],
    server: [['os', 'OS & layanan berjalan'], ['ip', 'IP statis & akses remote']],
    cctv: [['stream', 'Stream / rekaman ke NVR'], ['sudut', 'Sudut & fokus kamera']],
    endpoint: [['ip', 'IP / DHCP didapat'], ['internet', 'Uji koneksi internet']],
    lainnya: [['fungsi', 'Uji fungsi']],
    support: [['fungsi', 'Uji fungsi']],
    listrik: [['mcb', 'MCB & tegangan dicek'], ['beban', 'Uji beban / colokan']],
    furniture: [['posisi', 'Posisi & arah sesuai denah'], ['kondisi', 'Kondisi baik & bersih']],
  };

  /** Item ceklis perangkat: [{key, grup, label, link?}] — link: 'kabel:<status>' | 'status:<status>'. */
  function ceklisItems(d) {
    const out = [];
    const t = TYPES[d.jenis] || TYPES.lainnya;
    if (perluKabel(d)) {
      out.push({ key: 'kabel_tarik', grup: 'kabel', label: 'Kabel ditarik', link: 'kabel:ditarik' });
      out.push({ key: 'kabel_terminasi', grup: 'kabel', label: 'Terminasi / konektor', link: 'kabel:terminasi' });
      out.push({ key: 'kabel_tes', grup: 'kabel', label: 'Kabel dites OK', link: 'kabel:dites' });
    }
    out.push({ key: 'tempat', grup: 'pasang', label: t.listrik ? 'Panel / colokan siap' : 'Alat ditempatkan di lokasi', link: 'status:terpasang' });
    if (!t.listrik && t.grup !== 'furniture' && (d.atribut || {}).listrik !== 'baterai') out.push({ key: 'listrik', grup: 'pasang', label: (d.atribut || {}).listrik === 'poe' ? 'Daya PoE menyala' : 'Listrik tersambung' });
    out.push({ key: 'label', grup: 'pasang', label: 'Label nama ditempel' });
    (KONFIG[d.jenis] || KONFIG.lainnya).forEach(([k, l]) => out.push({ key: 'k_' + k, grup: 'konfig', label: l }));
    out.push({ key: 'uji', grup: 'konfig', label: 'Uji akhir (sudah diuji)', link: 'status:diuji' });
    let x = [];
    try { x = JSON.parse((d.atribut || {}).ceklis_x || '[]'); } catch (e) { x = []; }
    (Array.isArray(x) ? x : []).forEach((l, i) => { if (l) out.push({ key: 'x' + (i + 1), grup: 'lain', label: String(l) }); });
    return out;
  }

  /** Data centang tersimpan: {key: {t, o}}. */
  function ceklisData(d) {
    try {
      const v = JSON.parse((d.atribut || {}).ceklis || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch (e) { return {}; }
  }

  const URUT_KABEL = ['belum', 'ditarik', 'terminasi', 'dites'];
  const URUT_STATUS = ['rencana', 'terpasang', 'diuji'];
  /** Item sudah dicentang? Item tersinkron dibaca dari status kabel / status pemasangan. */
  function ceklisSelesai(d, it, data) {
    if (it.link) {
      const [jenis, st] = it.link.split(':');
      if (jenis === 'kabel') return URUT_KABEL.indexOf(kabelSt(d)) >= URUT_KABEL.indexOf(st);
      return URUT_STATUS.indexOf(d.status) >= URUT_STATUS.indexOf(st);
    }
    return !!(data || ceklisData(d))[it.key];
  }

  /** Progres ceklis perangkat: {items, selesai, total, pct, per: {grup: {selesai, total}}}. */
  function ceklisProgres(d) {
    const items = ceklisItems(d);
    const data = ceklisData(d);
    const per = {};
    let selesai = 0;
    items.forEach(it => {
      it.ok = ceklisSelesai(d, it, data);
      it.info = data[it.key] || null;
      per[it.grup] = per[it.grup] || { selesai: 0, total: 0 };
      per[it.grup].total++;
      if (it.ok) { per[it.grup].selesai++; selesai++; }
    });
    return { items, selesai, total: items.length, pct: items.length ? Math.round(selesai / items.length * 100) : 0, per };
  }

  /** Bukan perangkat jaringan (tanpa uplink, status internet & kabel jaringan): titik listrik, support, furniture. */
  const nonJaringan = d => !!d && grupJenis(d.jenis) !== 'jaringan';
  /** Furniture: tanpa koneksi apa pun (jaringan maupun listrik). */
  const isFurniture = d => !!d && grupJenis(d.jenis) === 'furniture';
  /** Titik listrik (sumber daya dengan MCB). */
  const isListrik = d => !!d && !!(TYPES[d.jenis] || {}).listrik;

  /** Sumber listrik perangkat jaringan di lokasi penempatannya (atribut "listrik"). */
  const LISTRIK = {
    '': { label: 'Belum dicek', short: '?', color: '#94a3b8' },
    ada: { label: 'Stop kontak tersedia', short: 'Ada', color: '#16a34a' },
    perlu: { label: 'Perlu tarik listrik', short: 'Perlu tarik', color: '#dc2626' },
    poe: { label: 'PoE dari uplink', short: 'PoE', color: '#2563eb' },
    baterai: { label: 'Baterai / tanpa listrik', short: 'Baterai', color: '#64748b' },
  };

  const STATUS = {
    rencana: { label: 'Rencana', color: '#94a3b8' },
    terpasang: { label: 'Terpasang', color: '#2563eb' },
    diuji: { label: 'Sudah diuji', color: '#16a34a' },
    bermasalah: { label: 'Bermasalah', color: '#dc2626' },
    usulan: { label: 'Usulan baru', color: '#9333ea' }, // alat baru dari installer, menunggu keputusan admin
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
  /**
   * Gudang: data unit fisik per alat katalog (np_unit). Katalog = seri (kategori + merek + tipe); unit = barang fisik
   * di gudang yang dipasang ke titik di venue. pass_admin disamarkan untuk link lihat-saja / admin event.
   */
  const UNIT_FIELDS = [
    { k: 'sn', label: 'Nomor seri (SN)', ph: 'mis. G1PD4A0012345' },
    { k: 'mac', label: 'MAC address', ph: 'mis. 30:0D:9E:AA:BB:01' },
    { k: 'firmware', label: 'Firmware terpasang', ph: 'mis. 11.9(6)B1 / RouterOS 7.16' },
    { k: 'aset', label: 'No. aset / inventaris', ph: 'mis. BSI-AP-0031' },
    { k: 'ip_mgmt', label: 'IP manajemen', ph: 'mis. 10.10.99.23' },
    { k: 'user_admin', label: 'User admin' },
    { k: 'pass_admin', label: 'Password admin', type: 'password' },
    { k: 'lokasi', label: 'Lokasi di gudang', ph: 'mis. Rak B2 / box AP-03' },
  ];
  const UNIT_KONDISI = {
    baik: { label: 'Baik', color: '#16a34a' },
    servis: { label: 'Servis', color: '#d97706' },
    rusak: { label: 'Rusak', color: '#dc2626' },
  };
  const macNorm = s => String(s || '').toLowerCase().replace(/[^0-9a-f]/g, '');

  /** Warna label anotasi denah: kotak (bg), teks (fg), garis tepi (tepi). Kunci sama dengan NP_ANOT_WARNA di api. */
  const ANOT_WARNA = {
    hijau: { label: 'Hijau', bg: '#16a34a', fg: '#ffffff', tepi: '#15803d' },
    biru: { label: 'Biru', bg: '#2563eb', fg: '#ffffff', tepi: '#1d4ed8' },
    kuning: { label: 'Kuning', bg: '#facc15', fg: '#1f2937', tepi: '#ca8a04' },
    merah: { label: 'Merah', bg: '#dc2626', fg: '#ffffff', tepi: '#b91c1c' },
    ungu: { label: 'Ungu', bg: '#7c3aed', fg: '#ffffff', tepi: '#6d28d9' },
    abu: { label: 'Abu', bg: '#f8fafc', fg: '#1f2937', tepi: '#94a3b8' },
  };
  /** Perangkat yang butuh kabel ke uplink: punya uplink & bukan wireless. */
  /** Kabel uplink perangkat tertanam di gedung (Port LAN gedung): tidak digambar, tidak dihitung, tanpa status kabel. */
  const kabelTertanam = d => !!d && !!(TYPES[d.jenis] || {}).tertanam;
  /** Titik LAN pasif tempat endpoint dicolok: titik LAN tarikan event atau port LAN gedung. */
  const titikLan = j => j === 'lan' || j === 'lan_gedung';
  const perluKabel = d => !!d && d.uplink_id != null && d.media !== 'wireless' && !kabelTertanam(d);
  const kabelSt = d => (d && d.atribut && KABEL[d.atribut.kabel] ? d.atribut.kabel : 'belum');

  /** Hasil pengecekan penempatan oleh checker (atribut "verif" JSON {h, c, t, o}). */
  const VERIF = {
    sesuai: { label: 'Sesuai plan', short: 'Sesuai', color: '#2563eb', icon: '✓' },
    tidak: { label: 'Tidak sesuai plan', short: 'Tidak sesuai', color: '#dc2626', icon: '!' },
  };
  /** {h: 'sesuai'|'tidak', c: catatan, t: waktu, o: oleh} atau null bila belum dicek. */
  function verifOf(d) {
    const raw = d && d.atribut && d.atribut.verif;
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      return v && VERIF[v.h] ? v : null;
    } catch (e) {
      return null;
    }
  }

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
    if (d.jenis === 'furniture') {
      const tp = (d.atribut || {}).tipe_furniture;
      return { color: t.color, short: FURN_SINGKAT[tp] || t.short, label: tp || t.label, prefix: t.prefix };
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
    }
    // Dialog modal terbuka: toast ditaruh di dalamnya agar tidak tertutup lapisan modal.
    const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
    if (el.parentNode !== host) host.appendChild(el);
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


  /**
   * Progress proses panjang (PowerPoint, persiapan cetak, backup): dialog modal kecil berisi judul, bar & keterangan.
   * buka(judul) -> set(persen 0–100 | null = tak tentu, teks) -> tutup(). Tidak bisa ditutup dengan Esc selama berjalan.
   */
  const progres = (() => {
    let el = null;
    const pastikan = () => {
      if (el) return el;
      el = document.createElement('dialog');
      el.className = 'dlg dlg-progres';
      el.setAttribute('aria-live', 'polite');
      el.innerHTML = '<div class="pg-judul"></div><div class="pg-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div><div class="pg-info"><span class="pg-teks"></span><b class="pg-pct"></b></div>';
      el.addEventListener('cancel', e => e.preventDefault());
      document.body.appendChild(el);
      return el;
    };
    return {
      buka(judul, teks) {
        const d = pastikan();
        d.querySelector('.pg-judul').textContent = judul;
        this.set(null, teks || '');
        if (!d.open) d.showModal();
      },
      set(pct, teks) {
        const d = pastikan();
        const bar = d.querySelector('.pg-bar');
        const tentu = pct != null && isFinite(pct);
        const v = tentu ? Math.max(0, Math.min(100, pct)) : 0;
        bar.classList.toggle('tak-tentu', !tentu);
        bar.firstChild.style.width = tentu ? v + '%' : '';
        if (tentu) bar.setAttribute('aria-valuenow', Math.round(v)); else bar.removeAttribute('aria-valuenow');
        d.querySelector('.pg-pct').textContent = tentu ? Math.round(v) + '%' : '';
        if (teks != null) d.querySelector('.pg-teks').textContent = teks;
      },
      tutup() {
        if (!el || !el.open) return;
        const t = el.querySelector('.toast');
        el.close();
        // Toast yang muncul selama progress ikut dipindah keluar agar tetap terlihat.
        if (t) ([...document.querySelectorAll('dialog[open]')].pop() || document.body).appendChild(t);
      },
      /** Beri kesempatan browser menggambar ulang (dipakai di antara langkah berat yang sinkron). */
      jeda: () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))),
    };
  })();
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

  window.NP = { TYPES, TYPE_ORDER, GRUP_ORDER, isFurniture, furnSimbol, FURN_UKURAN, VERIF, verifOf, CEKLIS_GRUP, ceklisItems, ceklisData, ceklisProgres, grupJenis, GRUP, nonJaringan, isListrik, LISTRIK, dayaMcb, STATUS, MEDIA, KONEKSI, KABEL, ANOT_WARNA, UNIT_FIELDS, UNIT_KONDISI, macNorm, perluKabel, kabelTertanam, titikLan, kabelSt, SPEC, specFields, specSummary, poeKelas, sektor, polar, wedgePath, ET, setEndpointTipe, tipeEp, tampil, terkunci, IKON, ikonSvg, api, esc, toast, progres, copy, downloadBlob, downloadCsv, fmtBw, fmtM, fmtDate, slug };
})();
