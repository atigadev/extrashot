/*
 * Generator script MikroTik RouterOS v7 (.rsc) untuk router / gateway event.
 *
 * Sumber data: isian router (IP, subnet LAN, pool DHCP, lease, DNS, user & password admin), Sumber WAN/ISP yang
 * tersambung (WAN utama lewat uplink + WAN tambahan / multi-WAN), dan konfigurasi khusus MikroTik di atribut router
 * "mt" (JSON): identitas, zona waktu, NTP, interface, tipe WAN (DHCP / PPPoE / statis), VLAN, firewall, layanan,
 * limit bandwidth (PCQ).
 *
 * Script ditujukan untuk router yang sudah di-reset tanpa konfigurasi bawaan:
 *   /system reset-configuration no-defaults=yes skip-backup=yes
 * lalu diimpor: /import file-name=NAMA.rsc  (atau ditempel di Terminal Winbox).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------- util IP

  /** "10.10.0.1/22" -> {ip, prefix, ipN, net, broadcast, mask} atau null. */
  function cidr(s) {
    const m = String(s || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/);
    if (!m) return null;
    const o = m.slice(1, 5).map(Number);
    if (o.some(x => x > 255)) return null;
    const prefix = m[5] == null ? null : +m[5];
    if (prefix != null && prefix > 32) return null;
    const ipN = ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
    const p = prefix == null ? 32 : prefix;
    const mask = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0;
    const net = (ipN & mask) >>> 0;
    const broadcast = (net | (~mask >>> 0)) >>> 0;
    return { ip: o.join('.'), prefix, ipN, net, broadcast, mask };
  }
  const ipStr = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  const ipValid = s => !!cidr(s) && !String(s).includes('/');

  /** "10.10.1.10 – 10.10.3.250" / "10.10.1.10-10.10.3.250" -> [a, b] (angka) atau null. */
  function rentang(s) {
    const m = String(s || '').match(/(\d{1,3}(?:\.\d{1,3}){3})\s*[-–—]\s*(\d{1,3}(?:\.\d{1,3}){3})/);
    if (!m) return null;
    const a = cidr(m[1]), b = cidr(m[2]);
    return a && b ? [a.ipN, b.ipN] : null;
  }

  /** Nama interface MikroTik: "1" -> ether1, "ether2" tetap, "sfp1" tetap, "pppoe-out1" tetap. */
  function iface(s, cadangan) {
    const t = String(s || '').trim();
    if (!t) return cadangan || '';
    if (/^\d+$/.test(t)) return 'ether' + t;
    const m = t.match(/^(?:port|eth|ether)\s*-?\s*(\d+)$/i);
    if (m) return 'ether' + m[1];
    return t.replace(/\s+/g, '');
  }

  /** Teks dalam tanda kutip RouterOS: \ " $ ? di-escape (agar aman diimpor maupun ditempel di terminal). */
  const q = s => '"' + String(s == null ? '' : s).replace(/[\\"$?]/g, c => '\\' + c) + '"';
  const nm = s => String(s || '').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
  const mb = v => (parseFloat(v) > 0 ? Math.round(parseFloat(v) * 1000) / 1000 + 'M' : '');

  // ---------------------------------------------------------------------- data

  const DEF = {
    tz: 'Asia/Jakarta',
    ntp: 'id.pool.ntp.org',
    firewall: true,
    layanan: true,
    matikan_admin: true,
    bw_aktif: false,
  };

  /** Konfigurasi MikroTik tersimpan di atribut router "mt" (JSON) + nilai bawaan. */
  function baca(d) {
    let mt = {};
    try { mt = JSON.parse((d.atribut || {}).mt || '{}') || {}; } catch (e) { mt = {}; }
    return Object.assign({}, DEF, mt, { wan: Object.assign({}, mt.wan || {}), vlan: Array.isArray(mt.vlan) ? mt.vlan : [], port: Object.assign({}, mt.port || {}) });
  }

  /** VLAN port router tanpa perangkat tercatat, dari isian manual {mode: trunk|access|native, izin: "10,20"}. */
  function portManual(p, vlanIds) {
    const izin = String((p && p.izin) || '').split(/[^\d]+/).map(x => parseInt(x, 10)).filter(v => v >= 2 && v <= 4094);
    const mode = p && p.mode;
    if (mode === 'native') return { mode: 'native', tagged: [], untagged: null, butuh: [], auto: false };
    if (mode === 'access') return izin[0] ? { mode: 'access', tagged: [], untagged: izin[0], butuh: [], auto: false } : { mode: 'native', tagged: [], untagged: null, butuh: [], auto: false };
    if (mode === 'trunk') return { mode: 'trunk', tagged: izin.length ? [...new Set(izin)].sort((a, b) => a - b) : vlanIds, untagged: null, butuh: [], auto: false };
    return { mode: 'trunk', tagged: vlanIds, untagged: null, butuh: [], auto: true };
  }

  /**
   * Rangkuman semua masukan untuk router d: sistem, daftar WAN, LAN, VLAN, bandwidth. Dipakai oleh generator,
   * validasi, dan form (nilai bawaan yang tampil sebagai placeholder).
   */
  function rangkum(d, m) {
    const a = d.atribut || {};
    const mt = baca(d);
    // WAN: utama = uplink router bila berujung di Sumber WAN; tambahan = multi-WAN (wan_lain).
    // Port WAN dari Model.portWan (sama dengan peta port): isian topologi, atau port pertama yang tidak dipakai anak.
    const wans = m.portWan(d).map(w => ({ isp: w.dev, port: w.port, lewat: w.lewat, otomatis: w.otomatis, utama: w.utama }));
    const pakaiPort = new Set();
    const wanList = wans.map((w, i) => {
      const cfg = mt.wan[w.isp.id] || {};
      const ia = w.isp.atribut || {};
      const ifc = iface(w.port, 'ether' + (i + 1));
      pakaiPort.add(ifc);
      const tipe = cfg.tipe || (ia.ip_publik && cidr(ia.ip_publik) && cidr(ia.ip_publik).prefix != null ? 'statis' : 'dhcp');
      return {
        no: i + 1, isp: w.isp, lewat: w.lewat || null, iface: ifc, otomatis: w.otomatis, utama: w.utama, tipe,
        user: cfg.user || '', pass: cfg.pass || '',
        ip: cfg.ip || (tipe === 'statis' ? ia.ip_publik || '' : ''), gw: cfg.gw || ia.gateway || '',
        nama: tipe === 'pppoe' ? 'pppoe-wan' + (i + 1) : ifc,
        down: w.isp.bandwidth_mbps || null, up: parseFloat(ia.upload_mbps) || w.isp.bandwidth_mbps || null,
        label: [w.isp.nama, ia.provider].filter(Boolean).join(' '),
      };
    });
    // LAN: IP router (isian IP) atau gateway pertama subnet LAN.
    const sub = cidr(a.subnet_lan);
    let lanIp = mt.lan_ip || '';
    if (!lanIp && d.ip && cidr(d.ip)) lanIp = cidr(d.ip).prefix != null ? d.ip.trim() : (sub ? d.ip.trim() + '/' + sub.prefix : d.ip.trim() + '/24');
    if (!lanIp && sub) lanIp = ipStr(sub.net + 1) + '/' + sub.prefix;
    const lc = cidr(lanIp);
    const nPort = m.jumlahPort(d);
    const lanIfaces = mt.lan_iface
      ? mt.lan_iface.split(/[\s,;]+/).map(x => iface(x)).filter(Boolean)
      : Array.from({ length: nPort }, (_, i) => 'ether' + (i + 1)).filter(x => !pakaiPort.has(x));
    let pool = rentang(a.dhcp);
    if (!pool && lc && lc.prefix != null && lc.prefix <= 30) {
      // Pool bawaan: dari IP setelah router (+9) sampai sebelum broadcast.
      pool = [Math.min(lc.net + 10, lc.broadcast - 1), lc.broadcast - 1];
    }
    // VLAN per port LAN router: perangkat yang tersambung di port itu menentukan trunk / access (lihat Model.linkVlan).
    // Port tanpa perangkat tercatat: atur manual di mt.port[iface] = {mode, izin}; kosong = trunk semua VLAN
    // (aman untuk switch/AP yang belum dipetakan).
    const vlanIds = (mt.vlan || []).map(v => parseInt(v && v.id, 10)).filter(v => v >= 2 && v <= 4094);
    const portVlan = lanIfaces.map(ifc => {
      const devs = m.kids(d.id).filter(c => c.port_uplink && iface(c.port_uplink) === ifc);
      const dev = devs[0] || null;
      const lv = dev ? m.linkVlan(dev) : portManual(mt.port[ifc], vlanIds);
      return { iface: ifc, dev, lv, ganda: devs.length > 1 };
    });
    const tanpaPort = m.kids(d.id).filter(c => !c.port_uplink && m.linkVlan(c).mode !== 'native');
    const totalDown = wanList.reduce((s, w) => s + (w.down || 0), 0);
    const totalUp = wanList.reduce((s, w) => s + (w.up || 0), 0);
    return {
      d, m, mt, identitas: mt.identitas || d.nama, wans: wanList, mode: m.wanMode(d), portVlan, tanpaPort, vlanIds,
      lan: { ip: lanIp, c: lc, ifaces: lanIfaces, pool, lease: (a.lease || '30m').replace(/\s+/g, ''), dns: a.dns || '1.1.1.1, 8.8.8.8', nPort },
      vlan: mt.vlan.filter(v => v && v.id),
      admin: { user: a.user_admin || '', pass: a.pass_admin || '' },
      bw: { aktif: !!mt.bw_aktif, down: mt.bw_down || '', up: mt.bw_up || '', totDown: mt.bw_tot_down || (totalDown || ''), totUp: mt.bw_tot_up || (totalUp || '') },
    };
  }

  // ---------------------------------------------------------------------- validasi

  /** Daftar {level: 'err'|'warn'|'info', msg}. Script tetap bisa dibuat, tetapi "err" sebaiknya diperbaiki dulu. */
  function validasi(r) {
    const out = [];
    const add = (level, msg) => out.push({ level, msg });
    if (!r.wans.length) add('err', 'Router belum tersambung ke Sumber WAN/ISP. Sambungkan uplink router ke titik WAN (atau tambah WAN di tab Koneksi).');
    const ifs = new Map();
    r.wans.forEach(w => {
      if (ifs.has(w.iface)) add('err', `Interface ${w.iface} dipakai dua WAN (${ifs.get(w.iface)} & WAN${w.no}). Atur port WAN di tab Router.`);
      ifs.set(w.iface, 'WAN' + w.no);
      if (w.otomatis) add('warn', `Port WAN${w.no} (${w.isp.nama}) belum diisi — sementara memakai ${w.iface} (port pertama yang kosong). Isi port agar sesuai pemasangan.`);
      if (r.lan.ifaces.includes(w.iface)) add('err', `${w.iface} dipakai sebagai WAN${w.no} sekaligus port LAN.`);
      r.m.kids(r.d.id).filter(c => c.port_uplink && iface(c.port_uplink) === w.iface)
        .forEach(c => add('err', `${c.nama} tersambung di ${w.iface}, padahal port itu WAN${w.no} (${w.isp.nama}). Pindahkan ke port LAN.`));
      if (w.tipe === 'pppoe' && (!w.user || !w.pass)) add('err', `WAN${w.no} (${w.label}): user / password PPPoE belum diisi.`);
      if (w.tipe === 'statis') {
        const c = cidr(w.ip);
        if (!c || c.prefix == null) add('err', `WAN${w.no}: IP statis harus berformat CIDR, mis. 203.0.113.10/29.`);
        if (!ipValid(w.gw)) add('err', `WAN${w.no}: gateway statis belum benar.`);
        else if (c && c.prefix != null && (cidr(w.gw).ipN & c.mask) >>> 0 !== c.net) add('warn', `WAN${w.no}: gateway ${w.gw} tidak satu subnet dengan ${w.ip}.`);
      }
      if (r.wans.length > 1 && r.mode === 'loadbalance' && w.tipe === 'dhcp' && !ipValid(w.gw)) {
        add('warn', `WAN${w.no} DHCP pada load balance (PCC): isi gateway ISP agar rute per WAN bisa dibuat, atau pakai IP statis.`);
      }
    });
    if (!r.lan.c || r.lan.c.prefix == null) add('err', 'IP LAN router belum benar. Isi IP router, mis. 10.10.0.1/22 (atau Subnet LAN di tab Router).');
    else if (r.lan.c.ipN === r.lan.c.net || r.lan.c.ipN === r.lan.c.broadcast) add('err', `IP LAN ${r.lan.ip} adalah alamat network/broadcast, pilih IP host.`);
    if (!r.lan.ifaces.length) add('err', 'Tidak ada port LAN. Isi daftar interface LAN.');
    const wanIfs = r.wans.map(w => w.iface);
    r.m.kids(r.d.id).filter(c => c.port_uplink && !wanIfs.includes(iface(c.port_uplink)) && !r.lan.ifaces.includes(iface(c.port_uplink)))
      .forEach(c => add('err', `${c.nama} tersambung di ${iface(c.port_uplink)}, tetapi port itu tidak masuk bridge LAN (${r.lan.ifaces.join(', ')}). Tambahkan di Port LAN atau pindahkan port.`));
    if (r.lan.c && r.lan.pool) {
      const [a, b] = r.lan.pool;
      if (a > b) add('err', 'Pool DHCP terbalik (awal lebih besar dari akhir).');
      if ((a & r.lan.c.mask) >>> 0 !== r.lan.c.net || (b & r.lan.c.mask) >>> 0 !== r.lan.c.net) add('err', `Pool DHCP ${ipStr(a)}–${ipStr(b)} di luar subnet LAN ${ipStr(r.lan.c.net)}/${r.lan.c.prefix}.`);
      if (r.lan.c.ipN >= a && r.lan.c.ipN <= b) add('err', 'IP router berada di dalam pool DHCP.');
      const n = b - a + 1;
      if (n < 50) add('info', `Pool DHCP hanya ${n} alamat. Untuk event ramai pakai subnet lebih besar (mis. /22) dan lease pendek.`);
    } else if (r.lan.c) {
      add('warn', 'Pool DHCP tidak terbaca; dipakai pool bawaan dari subnet LAN.');
    }
    const ids = new Set();
    r.vlan.forEach(v => {
      const id = parseInt(v.id, 10);
      if (!(id >= 2 && id <= 4094)) add('err', `VLAN "${v.nama || v.id}": ID harus 2–4094.`);
      if (ids.has(id)) add('err', `VLAN ${id} dobel.`);
      ids.add(id);
      const c = cidr(v.ip);
      if (!c || c.prefix == null) add('err', `VLAN ${v.id}: gateway harus CIDR, mis. 10.10.${id}.1/24.`);
      else if (r.lan.c && r.lan.c.prefix != null) {
        const a1 = c.net, b1 = c.broadcast, a2 = r.lan.c.net, b2 = r.lan.c.broadcast;
        if (a1 <= b2 && a2 <= b1) add('err', `Subnet VLAN ${v.id} bertumpuk dengan LAN.`);
      }
    });
    if (!r.admin.user || !r.admin.pass) add('warn', 'User / password admin belum diisi: script tidak membuat user admin baru (admin bawaan tetap dipakai).');
    else if (r.admin.pass.length < 8) add('warn', 'Password admin kurang dari 8 karakter.');
    if (r.bw.aktif && !(parseFloat(r.bw.down) > 0 && parseFloat(r.bw.up) > 0)) add('err', 'Limit per user aktif tetapi kecepatan download / upload per user belum diisi.');
    // VLAN per port: turunan dari topologi; kesalahan VLAN di jalur ikut ditampilkan di sini.
    if (r.vlan.length) {
      r.portVlan.forEach(p => {
        if (p.ganda) add('err', `Port ${p.iface} dipakai lebih dari satu perangkat — VLAN port tidak bisa ditentukan.`);
        if (p.lv.mode === 'access' && !r.vlanIds.includes(p.lv.untagged)) add('err', `Port ${p.iface}${p.dev ? ' (' + p.dev.nama + ')' : ''} access VLAN ${p.lv.untagged} yang belum dibuat di router.`);
        if (p.lv.mode === 'trunk') {
          const asing = p.lv.tagged.filter(v => !r.vlanIds.includes(v));
          if (asing.length) add('err', `Port ${p.iface}${p.dev ? ' (' + p.dev.nama + ')' : ''} butuh VLAN ${asing.join(', ')} yang belum dibuat di router.`);
        }
      });
      if (r.tanpaPort.length) add('warn', `Port di router belum diisi untuk ${r.tanpaPort.map(c => c.nama).join(', ')} — VLAN port-nya diperlakukan trunk semua VLAN. Isi "Port di uplink" agar trunk/access tepat.`);
    }
    if (r.wans.length > 1 && r.mode === 'loadbalance') add('info', 'Load balance memakai PCC (both-addresses-and-ports). Beberapa situs (bank, login) bisa meminta ulang login bila pindah WAN; pertimbangkan PCC src-address bila bermasalah.');
    return out;
  }

  // ---------------------------------------------------------------------- generator

  function buat(d, m, proyek) {
    const r = rangkum(d, m);
    const L = [];
    const tulis = (...xs) => xs.forEach(x => L.push(x));
    const bagian = judul => { L.push('', '# ' + '-'.repeat(70), '# ' + judul, '# ' + '-'.repeat(70)); };
    const lc = r.lan.c;
    const lanNet = lc && lc.prefix != null ? `${ipStr(lc.net)}/${lc.prefix}` : '';
    const subnets = [lanNet].concat(r.vlan.map(v => { const c = cidr(v.ip); return c && c.prefix != null ? `${ipStr(c.net)}/${c.prefix}` : ''; })).filter(Boolean);
    const now = new Date();
    tulis(
      `# Net Plan - konfigurasi ${r.identitas} (${proyek.nama})`,
      `# RouterOS v7 - dibuat ${now.toLocaleString('id-ID')}`,
      '#',
      '# Cara pakai (router baru / sudah di-reset):',
      '#   1. /system reset-configuration no-defaults=yes skip-backup=yes',
      '#   2. Login lewat MAC (Winbox > Neighbors), upload file ini ke Files.',
      `#   3. /import file-name=${nm(r.identitas)}.rsc verbose=yes`,
      '# Periksa bagian bertanda TODO sebelum dipakai.',
      ':log info "Net Plan: mulai konfigurasi"'
    );

    bagian('Sistem');
    tulis(`/system identity set name=${q(r.identitas)}`);
    if (r.mt.tz) tulis(`/system clock set time-zone-name=${r.mt.tz}`);
    if (r.mt.ntp) tulis('/system ntp client set enabled=yes', `/system ntp client servers add address=${r.mt.ntp}`);

    bagian('Interface list & bridge LAN');
    tulis('/interface list add name=WAN comment="Net Plan"', '/interface list add name=LAN comment="Net Plan"');
    tulis('/interface bridge add name=bridge-lan protocol-mode=rstp comment="LAN Net Plan"');
    r.lan.ifaces.forEach(i => tulis(`/interface bridge port add bridge=bridge-lan interface=${i}`));
    tulis('/interface list member add list=LAN interface=bridge-lan');

    bagian('WAN' + (r.wans.length > 1 ? ` (multi-WAN: ${r.mode === 'loadbalance' ? 'load balance PCC' : 'failover'})` : ''));
    if (!r.wans.length) tulis('# TODO: router belum tersambung ke Sumber WAN di Net Plan - tambahkan WAN secara manual.');
    const lb = r.wans.length > 1 && r.mode === 'loadbalance';
    r.wans.forEach(w => {
      const dist = lb ? 1 : w.no;
      tulis(`# WAN${w.no}: ${w.label || w.isp.nama}${w.lewat ? ' (lewat ' + w.lewat.nama + ')' : ''} - ${w.tipe.toUpperCase()} di ${w.iface}`);
      if (w.tipe === 'pppoe') {
        tulis(`/interface pppoe-client add name=${w.nama} interface=${w.iface} user=${q(w.user || 'TODO-user')} password=${q(w.pass || 'TODO-password')} add-default-route=yes default-route-distance=${dist} use-peer-dns=no disabled=no comment=${q('WAN' + w.no + ' ' + w.label)}`);
      } else if (w.tipe === 'statis') {
        tulis(`/ip address add address=${w.ip || '0.0.0.0/32'} interface=${w.iface} comment=${q('WAN' + w.no + ' ' + w.label)}`);
        tulis(`/ip route add dst-address=0.0.0.0/0 gateway=${w.gw || 'TODO-gateway'} distance=${dist} check-gateway=ping comment=${q('WAN' + w.no)}`);
      } else {
        tulis(`/ip dhcp-client add interface=${w.iface} add-default-route=yes default-route-distance=${dist} use-peer-dns=no comment=${q('WAN' + w.no + ' ' + w.label)}`);
      }
      tulis(`/interface list member add list=WAN interface=${w.nama}`);
    });

    if (lb) {
      bagian('Load balance PCC');
      const n = r.wans.length;
      r.wans.forEach(w => tulis(`/routing table add name=to-wan${w.no} fib`));
      r.wans.forEach(w => {
        tulis(`/ip firewall mangle add chain=prerouting in-interface=${w.nama} connection-mark=no-mark action=mark-connection new-connection-mark=wan${w.no}-conn passthrough=yes comment="NP: koneksi masuk WAN${w.no}"`);
      });
      r.wans.forEach((w, i) => {
        tulis(`/ip firewall mangle add chain=prerouting in-interface-list=LAN dst-address-type=!local connection-mark=no-mark per-connection-classifier=both-addresses-and-ports:${n}/${i} action=mark-connection new-connection-mark=wan${w.no}-conn passthrough=yes comment="NP: PCC WAN${w.no}"`);
      });
      r.wans.forEach(w => {
        tulis(`/ip firewall mangle add chain=prerouting in-interface-list=LAN connection-mark=wan${w.no}-conn action=mark-routing new-routing-mark=to-wan${w.no} passthrough=yes`);
        tulis(`/ip firewall mangle add chain=output connection-mark=wan${w.no}-conn action=mark-routing new-routing-mark=to-wan${w.no} passthrough=yes`);
      });
      r.wans.forEach(w => {
        const gw = w.tipe === 'pppoe' ? w.nama : (w.gw || 'TODO-gateway-WAN' + w.no);
        tulis(`/ip route add dst-address=0.0.0.0/0 gateway=${gw} routing-table=to-wan${w.no} check-gateway=ping comment="NP: rute WAN${w.no}"`);
      });
    }

    bagian('LAN, DHCP & DNS');
    tulis(`/ip address add address=${r.lan.ip || 'TODO-IP/24'} interface=bridge-lan comment="LAN"`);
    if (r.lan.pool) tulis(`/ip pool add name=pool-lan ranges=${ipStr(r.lan.pool[0])}-${ipStr(r.lan.pool[1])}`);
    tulis(`/ip dhcp-server add name=dhcp-lan interface=bridge-lan address-pool=pool-lan lease-time=${r.lan.lease}`);
    if (lc) tulis(`/ip dhcp-server network add address=${lanNet} gateway=${lc.ip} dns-server=${lc.ip}`);
    const dns = r.lan.dns.split(/[\s,;]+/).filter(ipValid).join(',') || '1.1.1.1,8.8.8.8';
    tulis(`/ip dns set servers=${dns} allow-remote-requests=yes`);

    if (r.vlan.length) {
      bagian('VLAN');
      r.vlan.forEach(v => {
        const c = cidr(v.ip);
        const n = `vlan${v.id}-${nm(v.nama || 'vlan')}`;
        tulis(`/interface vlan add name=${n} vlan-id=${v.id} interface=bridge-lan comment=${q(v.nama || '')}`);
        tulis(`/interface list member add list=LAN interface=${n}`);
        if (c && c.prefix != null) {
          tulis(`/ip address add address=${v.ip} interface=${n}`);
          if (v.dhcp !== false) {
            const a = Math.min(c.net + 10, c.broadcast - 1), b = c.broadcast - 1;
            tulis(`/ip pool add name=pool-vlan${v.id} ranges=${ipStr(a)}-${ipStr(b)}`);
            tulis(`/ip dhcp-server add name=dhcp-vlan${v.id} interface=${n} address-pool=pool-vlan${v.id} lease-time=${r.lan.lease}`);
            tulis(`/ip dhcp-server network add address=${ipStr(c.net)}/${c.prefix} gateway=${c.ip} dns-server=${c.ip}`);
          }
        }
      });
      // Bridge VLAN filtering: trunk = tagged, access = untagged + pvid, sesuai perangkat di tiap port (turunan topologi).
      bagian('Bridge VLAN filtering (trunk / access per port)');
      const access = r.portVlan.filter(p => p.lv.mode === 'access' && p.lv.untagged);
      r.portVlan.forEach(p => {
        const mode = p.lv.mode === 'trunk' ? 'trunk ' + p.lv.tagged.join(',') : p.lv.mode === 'access' ? 'access ' + p.lv.untagged : 'LAN tanpa VLAN';
        const ket = p.dev ? `${p.dev.nama}: ${mode}` : p.lv.auto ? 'tidak tercatat: trunk semua VLAN' : `manual: ${mode}`;
        tulis(`# ${p.iface} - ${ket}`);
      });
      access.forEach(p => tulis(`/interface bridge port set [find interface=${p.iface}] pvid=${p.lv.untagged} frame-types=admit-only-untagged-and-priority-tagged`));
      r.vlan.forEach(v => {
        const id = parseInt(v.id, 10);
        const tagged = ['bridge-lan'].concat(r.portVlan.filter(p => p.lv.mode === 'trunk' && p.lv.tagged.includes(id)).map(p => p.iface));
        const untagged = access.filter(p => p.lv.untagged === id).map(p => p.iface);
        tulis(`/interface bridge vlan add bridge=bridge-lan vlan-ids=${id} tagged=${tagged.join(',')}${untagged.length ? ' untagged=' + untagged.join(',') : ''}`);
      });
      tulis('# Aktifkan paling akhir: setelah ini hanya VLAN yang terdaftar yang diteruskan. Manajemen tetap lewat LAN untagged.');
      tulis('/interface bridge set bridge-lan vlan-filtering=yes');
    }

    bagian('NAT');
    tulis('/ip firewall nat add chain=srcnat out-interface-list=WAN action=masquerade comment="NP: internet untuk LAN"');

    if (r.mt.firewall) {
      bagian('Firewall dasar');
      tulis(
        '/ip firewall filter add chain=input action=accept connection-state=established,related,untracked comment="NP: koneksi yang sudah ada"',
        '/ip firewall filter add chain=input action=drop connection-state=invalid comment="NP: buang paket invalid"',
        '/ip firewall filter add chain=input action=accept protocol=icmp comment="NP: ping"',
        '/ip firewall filter add chain=input action=accept in-interface-list=LAN comment="NP: akses router dari LAN"',
        '/ip firewall filter add chain=input action=drop in-interface-list=!LAN comment="NP: tolak akses router dari luar"'
      );
      if (!r.bw.aktif) tulis('/ip firewall filter add chain=forward action=fasttrack-connection connection-state=established,related hw-offload=yes comment="NP: fasttrack"');
      tulis(
        '/ip firewall filter add chain=forward action=accept connection-state=established,related,untracked comment="NP: koneksi yang sudah ada"',
        '/ip firewall filter add chain=forward action=drop connection-state=invalid comment="NP: buang paket invalid"'
      );
      r.vlan.filter(v => v.isolasi).forEach(v => {
        const n = `vlan${v.id}-${nm(v.nama || 'vlan')}`;
        tulis(`/ip firewall filter add chain=forward action=drop in-interface=${n} out-interface-list=!WAN comment=${q('NP: VLAN ' + v.id + ' hanya ke internet')}`);
      });
      tulis('/ip firewall filter add chain=forward action=drop connection-state=new connection-nat-state=!dstnat in-interface-list=WAN comment="NP: tolak koneksi baru dari WAN"');
    }

    if (r.bw.aktif && subnets.length) {
      bagian('Limit bandwidth per user (PCQ)');
      tulis(
        `/queue type add name=pcq-down kind=pcq pcq-rate=${mb(r.bw.down)} pcq-classifier=dst-address`,
        `/queue type add name=pcq-up kind=pcq pcq-rate=${mb(r.bw.up)} pcq-classifier=src-address`,
        `/queue simple add name="NP limit per user" target=${subnets.join(',')} queue=pcq-up/pcq-down` +
          (parseFloat(r.bw.totUp) > 0 && parseFloat(r.bw.totDown) > 0 ? ` max-limit=${mb(r.bw.totUp)}/${mb(r.bw.totDown)}` : '') + ' comment="Net Plan"'
      );
    }

    if (r.mt.layanan) {
      bagian('Layanan & akses manajemen');
      tulis(
        // "\$" = tanda $ literal (tanpa escape, RouterOS membacanya sebagai variabel).
        '/ip service disable [find name~"^(telnet|ftp|www|api|api-ssl)\\$"]',
        subnets.length ? `/ip service set [find name~"^(winbox|ssh)\\$"] address=${subnets[0]}` : '# TODO: batasi winbox/ssh ke subnet LAN',
        '/tool mac-server set allowed-interface-list=LAN',
        '/tool mac-server mac-winbox set allowed-interface-list=LAN',
        '/ip neighbor discovery-settings set discover-interface-list=LAN'
      );
    }

    if (r.admin.user && r.admin.pass) {
      bagian('User admin');
      tulis(`/user add name=${q(r.admin.user)} group=full password=${q(r.admin.pass)} comment="Net Plan"`);
      if (r.mt.matikan_admin && r.admin.user !== 'admin') tulis('# User "admin" bawaan dinonaktifkan - pastikan login dengan user baru berhasil dulu.', '/user disable [find name="admin"]');
    }

    if (/hotspot router/i.test((d.atribut || {}).hotspot || '')) {
      bagian('Hotspot');
      tulis('# TODO: hotspot / captive portal belum dibuat otomatis. Jalankan wizard: /ip hotspot setup (interface bridge-lan atau VLAN tamu).');
    }

    tulis('', ':log info "Net Plan: konfigurasi selesai"');
    return L.join('\n') + '\n';
  }

  NP.Mikrotik = { buat, rangkum, validasi, baca, cidr, ipStr, iface, portManual, DEF };
})();
