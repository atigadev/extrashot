/* Helper bersama & definisi jenis perangkat Net Plan. */
(function () {
  'use strict';

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
        { k: 'radius_m', label: 'Radius cakupan (m)', type: 'number', ph: 'untuk lingkaran di denah' },
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
      label: 'Titik LAN', short: 'LAN', prefix: 'LAN', color: '#d97706',
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
    lainnya: {
      label: 'Perangkat lain', short: '•', prefix: 'DEV', color: '#64748b',
      bwLabel: 'Bandwidth (Mbps)',
      fields: [
        { k: 'fungsi', label: 'Fungsi', ph: 'mis. printer, mesin EDC, UPS' },
      ],
    },
  };
  const TYPE_ORDER = ['isp', 'router', 'switch', 'bridge', 'ap', 'lan', 'server', 'cctv', 'lainnya'];

  const STATUS = {
    rencana: { label: 'Rencana', color: '#94a3b8' },
    terpasang: { label: 'Terpasang', color: '#2563eb' },
    diuji: { label: 'Sudah diuji', color: '#16a34a' },
    bermasalah: { label: 'Bermasalah', color: '#dc2626' },
  };

  const MEDIA = {
    '': { label: '—' },
    utp: { label: 'UTP (kabel LAN)', short: 'UTP', color: '#475569', dash: '' },
    fiber: { label: 'Fiber optik', short: 'FO', color: '#ea580c', dash: '' },
    wireless: { label: 'Wireless', short: 'WL', color: '#0891b2', dash: '6 5' },
    lainnya: { label: 'Lainnya', short: '?', color: '#64748b', dash: '2 4' },
  };

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
  function toast(msg, isErr) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), isErr ? 4500 : 2200);
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

  window.NP = { TYPES, TYPE_ORDER, STATUS, MEDIA, api, esc, toast, copy, downloadBlob, downloadCsv, fmtBw, fmtM, fmtDate, slug };
})();
