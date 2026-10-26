/* Analisis topologi: jalur ke WAN, bandwidth efektif, estimasi kabel, pemeriksaan desain, kebutuhan perangkat. */
(function () {
  'use strict';
  const { TYPES, TYPE_ORDER, fmtBw, fmtM, poeKelas, sektor } = NP;

  /** Batas panjang kabel UTP tembaga (standar 100 m, sisakan untuk patch cord). */
  const UTP_MAX_M = 90;

  function create(proyek, list, katalog) {
    const katById = new Map((katalog || []).map(k => [k.id, k]));
    /** Item katalog perangkat (atau null bila diisi manual). */
    const kat = d => (d && d.katalog_id != null && katById.get(d.katalog_id)) || null;
    const spec = d => { const k = kat(d); return (k && k.spesifikasi) || {}; };
    const byId = new Map(list.map(d => [d.id, d]));
    const children = new Map();
    for (const d of list) {
      if (d.uplink_id != null && byId.has(d.uplink_id)) {
        if (!children.has(d.uplink_id)) children.set(d.uplink_id, []);
        children.get(d.uplink_id).push(d);
      }
    }
    const kids = id => children.get(id) || [];
    const parentOf = d => (d.uplink_id != null ? byId.get(d.uplink_id) : null) || null;

    /** [perangkat, induk, ..., akar]. */
    function path(d) {
      const out = [];
      const seen = new Set();
      while (d && !seen.has(d.id)) {
        seen.add(d.id);
        out.push(d);
        d = parentOf(d);
      }
      return out;
    }

    function descendants(id) {
      const out = new Set();
      const stack = [id];
      while (stack.length) {
        for (const c of kids(stack.pop())) {
          if (!out.has(c.id)) {
            out.add(c.id);
            stack.push(c.id);
          }
        }
      }
      return out;
    }

    function distPx(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    // ---- Lantai: satu gedung bisa punya beberapa denah (proyek.lantai [{id, nama, tinggi, denah_w, denah_h, skala,
    // denah_v}], urut bawah -> atas). F1 = denah utama (gambar & skala di kolom proyek). Perangkat memilih lantai di
    // atribut "lantai" (kosong = F1). Kabel antar lantai (riser): jalur di lantai asal sampai lekukan terakhir (titik
    // shaft) + selisih ketinggian lantai; posisi denah antar lantai tidak dibandingkan.
    const lantaiMemo = { v: null };
    function lantaiList() {
      if (lantaiMemo.v) return lantaiMemo.v;
      const def = Array.isArray(proyek && proyek.lantai) ? proyek.lantai.filter(l => l && /^F\d+$/.test(l.id)) : [];
      if (!def.some(l => l.id === 'F1')) def.unshift({ id: 'F1', nama: 'Lantai 1', tinggi: 4 });
      let elev = 0;
      const out = def.map(l => {
        const utama = l.id === 'F1';
        const r = { id: l.id, nama: l.nama || 'Lantai ' + l.id.slice(1), tinggi: +l.tinggi >= 0 ? +l.tinggi : 4, elev,
          denah_w: utama ? proyek.denah_w : l.denah_w, denah_h: utama ? proyek.denah_h : l.denah_h,
          skala: utama ? proyek.skala : l.skala, denah_v: utama ? proyek.denah_v : l.denah_v, utama };
        elev += r.tinggi;
        return r;
      });
      return (lantaiMemo.v = out);
    }
    const multiLantai = () => lantaiList().length > 1;
    /** Id lantai perangkat (kosong / tidak dikenal = F1). */
    function lantaiOf(d) {
      const id = d && d.atribut && d.atribut.lantai;
      return id && lantaiList().some(l => l.id === id) ? id : 'F1';
    }
    function lantaiById(id) {
      return lantaiList().find(l => l.id === id) || lantaiList().find(l => l.id === 'F1');
    }
    /** Skala (m/piksel) denah lantai perangkat. */
    const skalaOf = d => lantaiById(lantaiOf(d)).skala || null;
    const beda = (a, b) => lantaiOf(a) !== lantaiOf(b);
    /** Selisih ketinggian (m) lantai dua perangkat. */
    const naikM = (a, b) => Math.abs(lantaiById(lantaiOf(a)).elev - lantaiById(lantaiOf(b)).elev);

    /**
     * Posisi perangkat b dipindah ke denah lantai a (denah antar lantai dianggap sejajar; ukuran gambar berbeda
     * diskalakan). Dipakai sebagai titik riser/shaft: kabel antar lantai naik/turun tepat di bawah/atas uplink.
     */
    function proyeksi(b, a) {
      if (!beda(a, b)) return { x: b.x, y: b.y };
      const La = lantaiById(lantaiOf(a)), Lb = lantaiById(lantaiOf(b));
      const fx = La.denah_w && Lb.denah_w ? La.denah_w / Lb.denah_w : 1;
      const fy = La.denah_h && Lb.denah_h ? La.denah_h / Lb.denah_h : 1;
      return { x: b.x * fx, y: b.y * fy, riser: true };
    }

    /**
     * Panjang (m) jalur dari a lewat lekukan ke b. Beda lantai: jalur mendatar di lantai a sampai titik riser
     * (proyeksi b) + selisih ketinggian lantai. null bila skala denah lantai a belum dikalibrasi.
     */
    function panjangM(a, lek, b) {
      const sk = skalaOf(a);
      const datar = polyLen([a, ...lek, proyeksi(b, a)]);
      if (!sk) return beda(a, b) && datar < 1 ? naikM(a, b) : null;
      return datar * sk + (beda(a, b) ? naikM(a, b) : 0);
    }

    /** Jarak lurus ke uplink (meter) atau null bila skala belum dikalibrasi (beda lantai: termasuk selisih tinggi). */
    function jarakM(d) {
      const p = parentOf(d);
      if (!p) return null;
      const sk = skalaOf(d);
      const datar = distPx(d, proyeksi(p, d));
      if (!sk) return beda(d, p) && datar < 1 ? naikM(d, p) : null;
      return beda(d, p) ? Math.hypot(datar * sk, naikM(d, p)) : datar * sk;
    }

    /**
     * Titik-titik jalur kabel ke uplink (koordinat denah lantai perangkat): [perangkat, ...lekukan, uplink]. Uplink di
     * lantai lain: titik akhir = titik riser (proyeksi uplink, ditandai riser: true).
     */
    function routePts(d) {
      const p = parentOf(d);
      if (!p) return [];
      return [{ x: d.x, y: d.y }, ...bends(d, p), proyeksi(p, d)];
    }

    /** Titik lekukan saja. Wireless selalu lurus (sinyal tidak mengikuti dinding). */
    function bends(d, p) {
      if (d.media === 'wireless') return [];
      return bendsJalur(d.jalur, d, proyeksi(p, d));
    }

    /** Lekukan dari data jalur {m: 'h'|'v'|'bebas', p: [[x,y], ...]} antara titik a dan b. */
    function bendsJalur(j, a, b) {
      if (!j) return [];
      if (j.m === 'h') return [{ x: b.x, y: a.y }];
      if (j.m === 'v') return [{ x: a.x, y: b.y }];
      if (j.m === 'bebas' && Array.isArray(j.p)) {
        return j.p.map(pt => ({ x: +pt[0], y: +pt[1] })).filter(q => isFinite(q.x) && isFinite(q.y));
      }
      return [];
    }

    function polyLen(pts) {
      let s = 0;
      for (let i = 1; i < pts.length; i++) s += distPx(pts[i - 1], pts[i]);
      return s;
    }

    /** Panjang jalur kabel (meter, tanpa tambahan) atau null bila skala belum dikalibrasi. */
    function jalurM(d) {
      const p = parentOf(d);
      return p ? panjangM(d, bends(d, p), p) : null;
    }

    /** Estimasi panjang kabel ke uplink = panjang jalur + tambahan (naik-turun, sisa). Wireless: null. */
    function kabelM(d) {
      const j = jalurM(d);
      if (j == null || d.media === 'wireless') return null;
      return j * (1 + (proyek.slack_kabel || 0) / 100);
    }

    // ---- Multi-WAN: router dengan WAN tambahan (atribut wan_lain = JSON [{id, port}], wan_mode = failover|loadbalance).
    // WAN utama tetap lewat uplink biasa; WAN tambahan adalah sambungan langsung ke Sumber WAN/ISP lain.

    /** WAN tambahan perangkat: [{dev, port}] — hanya Sumber WAN/ISP yang masih ada, tanpa duplikat & tanpa uplink utama. */
    function wanLain(d) {
      const raw = d && d.atribut && d.atribut.wan_lain;
      if (!raw) return [];
      let arr;
      try { arr = JSON.parse(raw); } catch (e) { return []; }
      if (!Array.isArray(arr)) return [];
      const seen = new Set([d.id, d.uplink_id]);
      const out = [];
      for (const w of arr) {
        const dev = w && byId.get(+w.id);
        if (!dev || dev.jenis !== 'isp' || seen.has(dev.id)) continue;
        seen.add(dev.id);
        out.push({ dev, port: String(w.port || '') });
      }
      return out;
    }
    const wanMode = d => (d && d.atribut && d.atribut.wan_mode === 'loadbalance' ? 'loadbalance' : 'failover');

    // ---- Uplink tambahan switch (atribut uplink_lain = JSON [{id, port, media, kabel}], uplink_mode = redundan|lacp):
    // kabel kedua ke router/switch lain (redundan, STP/RSTP) atau ke uplink yang sama (LACP, bandwidth digabung).
    const JENIS_UPLINK2 = ['switch'];
    const TARGET_UPLINK2 = ['router', 'switch'];
    function uplinkLain(d) {
      const raw = d && JENIS_UPLINK2.includes(d.jenis) && d.atribut && d.atribut.uplink_lain;
      if (!raw) return [];
      let arr;
      try { arr = JSON.parse(raw); } catch (e) { return []; }
      if (!Array.isArray(arr)) return [];
      const bawah = descendants(d.id); // uplink ke perangkat di bawahnya = loop
      const seen = new Set([d.id]);
      const out = [];
      for (const w of arr) {
        const dev = w && byId.get(+w.id);
        if (!dev || !TARGET_UPLINK2.includes(dev.jenis) || seen.has(dev.id) || bawah.has(dev.id)) continue;
        seen.add(dev.id);
        out.push({ dev, port: String(w.port || ''), media: w.media === 'fiber' ? 'fiber' : 'utp', kabel: NP.KABEL[w.kabel] ? w.kabel : 'belum', jalur: w.jalur || null });
      }
      return out;
    }
    const uplinkMode = d => (d && d.atribut && d.atribut.uplink_mode === 'lacp' ? 'lacp' : 'redundan');

    /**
     * Semua sambungan tambahan perangkat (WAN tambahan router + uplink tambahan switch), seragam untuk peta, kabel &
     * progres: {dev, port, media, kabel, kunci: 'wan_lain'|'uplink_lain', no}. no = nomor tampilan (2, 3, ...).
     */
    function linkLain(d) {
      const wan = parseLain(d, 'wan_lain');
      return [
        ...wanLain(d).map((w, i) => {
          const r = wan.get(w.dev.id) || {};
          return { dev: w.dev, port: w.port, media: 'utp', kabel: r.kabel || 'belum', jalur: r.jalur || null, kunci: 'wan_lain', no: i + 2 };
        }),
        ...uplinkLain(d).map((w, i) => ({ dev: w.dev, port: w.port, media: w.media, kabel: w.kabel, jalur: w.jalur, kunci: 'uplink_lain', no: i + 2 })),
      ];
    }
    function parseLain(d, kunci) {
      const m = new Map();
      try {
        const arr = JSON.parse((d.atribut && d.atribut[kunci]) || '[]');
        if (Array.isArray(arr)) arr.forEach(w => { if (w && w.id) m.set(+w.id, { kabel: NP.KABEL[w.kabel] ? w.kabel : 'belum', jalur: w.jalur || null }); });
      } catch (e) { /* abaikan */ }
      return m;
    }

    /** Titik jalur kabel sambungan tambahan: [perangkat, ...lekukan, tujuan]. */
    function routePtsLain(d, w) {
      const ujung = proyeksi(w.dev, d);
      return [{ x: d.x, y: d.y }, ...bendsJalur(w.jalur, d, ujung), ujung];
    }

    /**
     * Bandwidth efektif = bottleneck di sepanjang jalur ke WAN. Di router multi-WAN, kapasitas dari atas = gabungan
     * semua WAN (load balance) atau WAN terbesar (failover).
     */
    const bwMemo = new Map();
    function bwEfektif(d, _jejak) {
      if (bwMemo.has(d.id)) return bwMemo.get(d.id);
      const jejak = _jejak || new Set();
      if (jejak.has(d.id)) return { mbps: null, at: null };
      jejak.add(d.id);
      const p = parentOf(d);
      const cabang = [];
      if (p) cabang.push(bwEfektif(p, jejak));
      const lain = [...wanLain(d), ...uplinkLain(d)];
      for (const w of lain) cabang.push(bwEfektif(w.dev, jejak));
      let up = { mbps: null, at: null };
      if (cabang.length === 1) up = cabang[0];
      else if (cabang.length > 1) {
        const ada = cabang.filter(b => b.mbps != null);
        if (ada.length) {
          up = wanMode(d) === 'loadbalance' || (uplinkLain(d).length && uplinkMode(d) === 'lacp')
            ? { mbps: ada.reduce((s, b) => s + b.mbps, 0), at: d, gabung: cabang.length }
            : ada.reduce((a, b) => (b.mbps > a.mbps ? b : a));
        }
      }
      const r = d.bandwidth_mbps != null && (up.mbps == null || d.bandwidth_mbps < up.mbps) ? { mbps: d.bandwidth_mbps, at: d } : up;
      jejak.delete(d.id);
      if (!_jejak) bwMemo.set(d.id, r);
      return r;
    }

    /** Sumber WAN utama (akar jalur uplink) atau null. */
    function wanOf(d) {
      const p = path(d);
      const root = p[p.length - 1];
      return root && root.jenis === 'isp' ? root : null;
    }

    /** Semua Sumber WAN yang melayani perangkat ini: [{dev, utama, via, port}] (via = router multi-WAN). */
    function wans(d) {
      const out = [];
      const ids = new Set();
      const utama = wanOf(d);
      if (utama) {
        out.push({ dev: utama, utama: true, via: null, port: '' });
        ids.add(utama.id);
      }
      for (const n of path(d)) {
        for (const w of wanLain(n)) {
          if (ids.has(w.dev.id)) continue;
          ids.add(w.dev.id);
          out.push({ dev: w.dev, utama: false, via: n, port: w.port });
        }
      }
      return out;
    }

    /** Router yang memakai Sumber WAN ini sebagai WAN tambahan. */
    function pemakaiWan(ispId) {
      return list.filter(d => wanLain(d).some(w => w.dev.id === ispId));
    }

    /**
     * 'online' | 'gangguan' | 'offline' — lihat NP.KONEKSI. Multi-WAN: online bila salah satu WAN masih baik
     * (redundansi), gangguan bila semua WAN yang tersambung bermasalah.
     */
    const koneksiMemo = new Map();
    function koneksi(d, _jejak) {
      if (koneksiMemo.has(d.id)) return koneksiMemo.get(d.id);
      const jejak = _jejak || new Set();
      if (jejak.has(d.id)) return 'offline';
      jejak.add(d.id);
      const p = parentOf(d);
      const opsi = [p ? koneksi(p, jejak) : d.jenis === 'isp' ? 'online' : 'offline'];
      for (const w of [...wanLain(d), ...uplinkLain(d)]) opsi.push(koneksi(w.dev, jejak));
      let r = opsi.includes('online') ? 'online' : opsi.includes('gangguan') ? 'gangguan' : 'offline';
      if (r !== 'offline' && d.status === 'bermasalah') r = 'gangguan';
      jejak.delete(d.id);
      if (!_jejak) koneksiMemo.set(d.id, r);
      return r;
    }

    /** Panjang kabel ke WAN tambahan (garis lurus + tambahan) atau null bila skala belum dikalibrasi. */
    function kabelWanM(d, isp) {
      // Ikuti bentuk jalur sambungan tambahan bila sudah dibentuk; selain itu garis lurus.
      const w = linkLain(d).find(x => x.dev.id === isp.id);
      const m = panjangM(d, w ? bendsJalur(w.jalur, d, proyeksi(w.dev, d)) : [], isp);
      return m == null ? null : m * (1 + (proyek.slack_kabel || 0) / 100);
    }

    /** Status koneksi yang dibawa garis dari perangkat ke uplinknya = status uplink tersebut. */
    function koneksiLink(d) {
      const p = parentOf(d);
      return p ? koneksi(p) : 'offline';
    }

    // ---- Port switch/router: jumlah port dari isian "Jumlah port" atau katalog (Port Ethernet + SFP). Nama port perangkat
    // anak (port_uplink) dibaca angka terakhirnya: "ether5" / "5" / "ge-0/0/5" = port 5, "sfp2" = SFP 2.

    /** Kunci port dari teks: 'e5' (ethernet 5), 's2' (SFP 2) atau null bila tidak terbaca. */
    function kunciPort(teks) {
      const t = String(teks || '').trim().toLowerCase();
      if (!t) return null;
      const sfp = t.match(/sfp\+?\s*-?(\d+)\s*$/);
      if (sfp) return 's' + +sfp[1];
      const n = t.match(/(\d+)\s*$/);
      return n ? 'e' + +n[1] : null;
    }

    /**
     * Jumlah port ethernet: isian "Jumlah port", untuk router juga isian Sistem di tab Router (mt.jumlah_port), lalu
     * katalog. Router tanpa isian = 5 port (sama dengan bawaan script MikroTik). Selain router tanpa isian = 0.
     */
    function jumlahPort(P) {
      const a = P.atribut || {};
      let n = parseInt(a.jumlah_port, 10);
      if (!n && P.jenis === 'router') {
        try { n = parseInt((JSON.parse(a.mt || '{}') || {}).jumlah_port, 10); } catch (e) { n = 0; }
      }
      return n || parseInt(spec(P).port_lan, 10) || (P.jenis === 'router' ? 5 : 0);
    }

    /**
     * Port WAN router: [{dev (Sumber WAN), port, utama, lewat, otomatis}]. Sumber port: isian topologi (port di perangkat
     * ini untuk WAN utama, port WAN tambahan), lalu isian lama mt.wan[id].iface. Kosong = port pertama yang tidak dipakai
     * perangkat anak (ether1, ether2, ...), sehingga peta port, isi-otomatis port anak, dan script MikroTik sama.
     */
    function portWan(R) {
      if (!R || R.jenis !== 'router') return [];
      let mtWan = {};
      try { mtWan = (JSON.parse((R.atribut || {}).mt || '{}') || {}).wan || {}; } catch (e) { mtWan = {}; }
      const lama = id => String((mtWan[id] || {}).iface || '').trim();
      const out = [];
      const p = parentOf(R);
      const w1 = p && (p.jenis === 'isp' ? p : wanOf(R));
      // Sumber WAN tidak punya port: "port di uplink" router yang langsung ke ISP berarti port router itu sendiri.
      const portIsp = p && p.jenis === 'isp' ? String(R.port_uplink || '').trim() : '';
      if (w1) out.push({ dev: w1, port: String(R.port_lokal || '').trim() || portIsp || lama(w1.id), utama: true, lewat: p.jenis === 'isp' ? null : p });
      wanLain(R).forEach(w => out.push({ dev: w.dev, port: w.port.trim() || lama(w.dev.id), utama: false, lewat: null }));
      const pakai = new Set(kids(R.id).map(c => kunciPort(c.port_uplink)).filter(Boolean));
      out.forEach(w => { const k = kunciPort(w.port); if (k) pakai.add(k); });
      let n = 1;
      return out.map(w => {
        if (w.port) return Object.assign(w, { otomatis: false });
        while (pakai.has('e' + n)) n++;
        pakai.add('e' + n);
        return Object.assign(w, { port: 'ether' + n, otomatis: true });
      });
    }

    /**
     * Peta port perangkat P: {eth, sfp, ports:[{key, label, sfp, isi:[{dev, peran}]}], lain:[{dev, peran, teks}],
     * tanpa:[anak tanpa port], prefix}. peran: 'anak' | 'uplink' (port P ke uplinknya) | 'up2' (uplink kedua P).
     */
    function portMap(P) {
      const sp = spec(P);
      const eth = jumlahPort(P);
      const sfp = parseInt(sp.port_sfp, 10) || 0;
      const ports = [];
      for (let i = 1; i <= eth; i++) ports.push({ key: 'e' + i, label: String(i), sfp: false, isi: [] });
      for (let i = 1; i <= sfp; i++) ports.push({ key: 's' + i, label: 'SFP' + i, sfp: true, isi: [] });
      const byKey = new Map(ports.map(p => [p.key, p]));
      const lain = [];
      const tanpa = [];
      const pasang = (teks, dev, peran, otomatis) => {
        const k = kunciPort(teks);
        if (k && byKey.has(k)) byKey.get(k).isi.push({ dev, peran, otomatis: !!otomatis });
        else if (!otomatis) lain.push({ dev, peran, teks: String(teks) });
      };
      for (const c of sortDev(kids(P.id))) {
        if (c.port_uplink && c.port_uplink.trim()) pasang(c.port_uplink, c, 'anak');
        else tanpa.push(c);
      }
      const up = parentOf(P);
      const pw = portWan(P);
      if (pw.length) {
        // Router: port WAN (isian atau otomatis) dicadangkan, agar port anak & script MikroTik tidak bergeser.
        for (const w of pw) pasang(w.port, w.utama ? up : w.dev, w.utama ? 'uplink' : 'wan', w.otomatis);
      } else if (up && P.port_lokal && P.port_lokal.trim()) pasang(P.port_lokal, up, 'uplink');
      for (const w of uplinkLain(P)) if (w.port) pasang(w.port, w.dev, 'up2');
      // Awalan nama port yang sudah dipakai (mis. "ether"), agar port baru ditulis dengan gaya yang sama.
      const pre = kids(P.id).map(c => (String(c.port_uplink || '').trim().match(/^([a-z][a-z\-/ ]*?)\s*\d+$/i) || [])[1]).filter(Boolean);
      const prefix = pre.length ? pre.sort((x, y) => pre.filter(v => v === y).length - pre.filter(v => v === x).length)[0] : P.jenis === 'router' ? 'ether' : '';
      return { eth, sfp, ports, lain, tanpa, prefix, terpakai: ports.filter(p => p.isi.length).length };
    }

    // ---- VLAN mengikuti topologi. Sumber: daftar VLAN router (atribut mt.vlan) = gateway & DHCP. Kebutuhan VLAN
    // perangkat: isian VLAN ("10", "10,20", "10 (tamu)") + SSID tambahan AP ("PANITIA (VLAN 20)"). Kabel uplink tiap
    // perangkat diturunkan otomatis: TRUNK (tagged) untuk switch/router/bridge/AP atau bila lewat > 1 VLAN, ACCESS
    // (untagged) untuk perangkat ujung dengan satu VLAN, NATIVE bila tanpa VLAN. Bisa ditimpa per perangkat
    // (atribut vlan_mode = trunk | access, vlan_izin = daftar VLAN trunk).

    const angkaVlan = s => [...String(s || '').matchAll(/\d+/g)].map(x => +x[0]).filter(v => v >= 1 && v <= 4094);

    /** VLAN yang didefinisikan di router: Map id -> {id, nama, ip, router}. */
    const vlanDefMemo = { v: null };
    function vlanDef() {
      if (vlanDefMemo.v) return vlanDefMemo.v;
      const out = new Map();
      for (const d of list) {
        if (d.jenis !== 'router') continue;
        let mt = {};
        try { mt = JSON.parse((d.atribut || {}).mt || '{}') || {}; } catch (e) { mt = {}; }
        (Array.isArray(mt.vlan) ? mt.vlan : []).forEach(v => {
          const id = parseInt(v && v.id, 10);
          if (id >= 2 && id <= 4094 && !out.has(id)) out.set(id, { id, nama: v.nama || '', ip: v.ip || '', router: d });
        });
      }
      return (vlanDefMemo.v = out);
    }

    /**
     * VLAN port switch yang belum tersambung perangkat (atribut vlan_port = JSON {kunci port: {mode, izin}}, mis.
     * {"e5": {"mode": "access", "izin": "20"}}). Port tersambung memakai vlan_mode/vlan_izin perangkat di port itu.
     */
    function vlanPortSw(P) {
      let o = {};
      try { o = JSON.parse((P && P.atribut && P.atribut.vlan_port) || '{}') || {}; } catch (e) { o = {}; }
      return o;
    }
    /** Konfigurasi VLAN port kosong switch (format sama dengan linkVlan). */
    function vlanPortKosong(P, key) {
      const c = vlanPortSw(P)[key] || {};
      const izin = urutNum(new Set(angkaVlan(c.izin).filter(v => v > 1)));
      if (c.mode === 'access' && izin.length) return { mode: 'access', tagged: [], untagged: izin[0], butuh: [], auto: false };
      if (c.mode === 'trunk' && izin.length) return { mode: 'trunk', tagged: izin, untagged: null, butuh: [], auto: false };
      return { mode: 'native', tagged: [], untagged: null, butuh: [], auto: !c.mode };
    }

    /** VLAN yang dipakai perangkat itu sendiri (bukan turunannya). VLAN 1 = native, tidak dihitung. */
    function vlanDev(d) {
      const a = d.atribut || {};
      const s = new Set(angkaVlan(d.vlan).filter(v => v !== 1));
      // Switch: VLAN port kosong yang sudah diatur (access / trunk) ikut dibawa trunk uplink switch ini.
      if (d.jenis === 'switch' && a.vlan_port) {
        const o = vlanPortSw(d);
        Object.keys(o).forEach(k => {
          const lv = vlanPortKosong(d, k);
          (lv.mode === 'access' ? [lv.untagged] : lv.tagged).forEach(v => s.add(v));
        });
      }
      // Port uplink diatur manual sebagai access VLAN n: perangkat ini memang memakai VLAN n.
      if (a.vlan_mode === 'access') angkaVlan(a.vlan_izin).filter(v => v > 1).slice(0, 1).forEach(v => s.add(v));
      // Port uplink diatur manual sebagai trunk VLAN tertentu: VLAN itu juga harus dibawa kabel-kabel di atasnya.
      if (a.vlan_mode === 'trunk') angkaVlan(a.vlan_izin).filter(v => v > 1).forEach(v => s.add(v));
      if (d.jenis === 'ap' || d.jenis === 'bridge') {
        for (const x of String(a.ssid_lain || '').matchAll(/vlan\s*:?\s*(\d+)/gi)) if (+x[1] > 1) s.add(+x[1]);
      }
      return s;
    }

    /** VLAN yang harus lewat kabel uplink d: VLAN d sendiri + semua perangkat di bawahnya. */
    const butuhMemo = new Map();
    function vlanButuh(d) {
      if (butuhMemo.has(d.id)) return butuhMemo.get(d.id);
      const s = new Set(vlanDev(d));
      butuhMemo.set(d.id, s); // jaga dari siklus
      for (const c of kids(d.id)) vlanButuh(c).forEach(v => s.add(v));
      return s;
    }

    const INFRA = ['router', 'switch', 'bridge', 'isp'];
    const urutNum = s => [...s].sort((x, y) => x - y);

    /**
     * Konfigurasi VLAN kabel uplink d (sisi port di uplink): {mode: 'trunk'|'access'|'native', tagged: [id], untagged:
     * id|null, butuh: [id], auto: bool}. Trunk tetap membawa LAN native (untagged) untuk manajemen.
     */
    function linkVlan(d) {
      const a = d.atribut || {};
      // VLAN berakhir di router (gateway): kabel router ke WAN / router induk tidak membawa VLAN LAN.
      if (d.jenis === 'router' || d.jenis === 'isp') return { mode: 'native', tagged: [], untagged: null, butuh: [], auto: true, ujungVlan: true };
      const butuh = urutNum(vlanButuh(d));
      const izin = urutNum(new Set(angkaVlan(a.vlan_izin).filter(v => v > 1)));
      if (a.vlan_mode === 'native') return { mode: 'native', tagged: [], untagged: null, butuh, auto: false };
      if (a.vlan_mode === 'trunk') return { mode: 'trunk', tagged: izin.length ? izin : butuh, untagged: null, butuh, auto: false };
      if (a.vlan_mode === 'access') {
        const v = izin[0] || urutNum(vlanDev(d))[0] || butuh[0] || null;
        return { mode: v ? 'access' : 'native', tagged: [], untagged: v, butuh, auto: false };
      }
      if (!butuh.length) return { mode: 'native', tagged: [], untagged: null, butuh, auto: true };
      const ujung = !INFRA.includes(d.jenis) && d.jenis !== 'ap';
      if (ujung && butuh.length === 1) return { mode: 'access', tagged: [], untagged: butuh[0], butuh, auto: true };
      return { mode: 'trunk', tagged: butuh, untagged: null, butuh, auto: true };
    }

    /** Ringkasan VLAN untuk tampilan: per VLAN -> {def, perangkat[]} + VLAN yang dipakai tetapi belum didefinisikan. */
    function vlanRingkas() {
      const def = vlanDef();
      const pakai = new Map();
      for (const d of list) vlanDev(d).forEach(v => { if (!pakai.has(v)) pakai.set(v, []); pakai.get(v).push(d); });
      const ids = urutNum(new Set([...def.keys(), ...pakai.keys()]));
      return ids.map(id => ({ id, def: def.get(id) || null, perangkat: pakai.get(id) || [] }));
    }

    /** Pemeriksaan konfigurasi VLAN: VLAN tak terdefinisi, terputus di jalur, switch unmanaged, titik LAN multi-VLAN. */
    function cekVlan(add) {
      const def = vlanDef();
      // Satu peringatan per kabel per VLAN (bukan per perangkat), berisi perangkat yang terdampak.
      const putus = new Map();
      const belumAda = new Map();
      for (const d of list) {
        const own = vlanDev(d);
        String(d.vlan || '').split(/[,;/\s]+/).filter(Boolean).forEach(t => {
          const n = parseInt(t, 10);
          if (/^\d+$/.test(t) && (n < 1 || n > 4094)) add('err', d, `${d.nama}: VLAN ${t} tidak valid (1–4094)`);
        });
        own.forEach(v => {
          if (!def.has(v)) {
            if (!belumAda.has(v)) belumAda.set(v, []);
            belumAda.get(v).push(d);
          }
        });
        // Jalur ke router: setiap kabel di atas d harus membawa VLAN d.
        if (own.size) {
          let c = d;
          let guard = 0;
          while (c && c.jenis !== 'router' && parentOf(c) && guard++ < 200) {
            const p = parentOf(c);
            const lv = linkVlan(c);
            const lewat = lv.mode === 'trunk' ? lv.tagged : lv.mode === 'access' ? [lv.untagged] : [];
            own.forEach(v => {
              if (lewat.includes(v)) return;
              const k = v + ':' + c.id;
              if (!putus.has(k)) putus.set(k, { v, c, p, lv, devs: [] });
              putus.get(k).devs.push(d);
            });
            c = p;
          }
        }
      }
      for (const [v, ds] of belumAda) {
        add('err', ds, `VLAN ${v} belum dibuat di router (tidak ada gateway/DHCP) — dipakai ${ds.slice(0, 4).map(d => d.nama).join(', ')}${ds.length > 4 ? ` +${ds.length - 4}` : ''}. Tambahkan di tab Router → VLAN`, ds);
      }
      for (const x of putus.values()) {
        const sebab = x.lv.mode === 'access' ? 'port access VLAN ' + x.lv.untagged : x.lv.mode === 'trunk' ? 'trunk tidak mengizinkan VLAN ' + x.v : 'port tanpa VLAN';
        const nama = x.devs.slice(0, 4).map(d => d.nama).join(', ') + (x.devs.length > 4 ? ` +${x.devs.length - 4}` : '');
        add('err', [x.c].concat(x.devs), `VLAN ${x.v} terputus di kabel ${x.c.nama} → ${x.p.nama} (${sebab}) — terdampak: ${nama}`, [x.c]);
      }
      for (const d of list) {
        const p = parentOf(d);
        if (!p) continue;
        const lv = linkVlan(d);
        // Access hanya untuk perangkat ujung: perangkat di bawahnya butuh VLAN lain -> terputus.
        if (lv.mode === 'access' && lv.butuh.some(v => v !== lv.untagged)) {
          add('err', d, `${d.nama}: port uplink access VLAN ${lv.untagged}, padahal perangkat di bawahnya butuh VLAN ${lv.butuh.filter(v => v !== lv.untagged).join(', ')} — jadikan trunk`, [d]);
        }
        // Switch unmanaged tidak bisa memasang VLAN per port.
        const sw = p.jenis === 'switch' && /unmanaged/i.test((p.atribut || {}).managed || '');
        if (sw && lv.mode === 'access') add('err', [p, d], `${p.nama} unmanaged: tidak bisa membuat port access VLAN ${lv.untagged} untuk ${d.nama} — pakai switch managed`);
        if (sw && lv.mode === 'trunk' && kids(p.id).some(x => linkVlan(x).mode !== 'trunk' && vlanButuh(x).size)) {
          add('warn', p, `${p.nama} unmanaged meneruskan VLAN tanpa pemisahan port — cek kebutuhan VLAN di bawahnya`);
        }
        // Titik LAN dinding (pasif) hanya bisa membawa satu VLAN untagged.
        if (d.jenis === 'lan' && lv.butuh.length > 1) add('warn', d, `${d.nama}: endpoint di titik LAN ini memakai ${lv.butuh.length} VLAN (${lv.butuh.join(', ')}) — titik LAN pasif hanya satu VLAN; pasang switch kecil managed`);
        if (lv.mode === 'trunk' && !lv.auto && lv.butuh.some(v => !lv.tagged.includes(v))) {
          add('warn', d, `${d.nama}: trunk manual tidak membawa VLAN ${lv.butuh.filter(v => !lv.tagged.includes(v)).join(', ')} yang dibutuhkan perangkat di bawahnya`);
        }
      }
    }

    /**
     * Aturan koneksi per kategori (jaringan): perangkat ujung tidak meneruskan jaringan, Sumber WAN di puncak dan
     * diterima router, media wireless butuh radio (AP / wireless bridge), titik LAN ditarik dari switch/router, fiber
     * butuh port SFP. Peringatan dikelompokkan per uplink agar tidak membanjiri daftar.
     */
    const UJUNG = ['endpoint', 'cctv', 'server'];
    const RADIO = ['ap', 'bridge'];
    function cekKoneksi(add) {
      const lbl = d => (TYPES[d.jenis] || TYPES.lainnya).label;
      const nm = ds => ds.slice(0, 4).map(x => x.nama).join(', ') + (ds.length > 4 ? ` +${ds.length - 4}` : '');
      for (const P of list) {
        if (NP.nonJaringan(P)) continue;
        const ch = kids(P.id).filter(c => !NP.nonJaringan(c));
        if (!ch.length) continue;
        if (UJUNG.includes(P.jenis)) {
          add('err', [P].concat(ch), `${P.nama} (${lbl(P)}) perangkat ujung — tidak bisa menjadi uplink ${nm(ch)}. Sambungkan ke switch / AP`);
          continue;
        }
        if (P.jenis === 'isp') {
          const tanpaRouter = ch.filter(c => !['router', 'bridge'].includes(c.jenis));
          if (tanpaRouter.length) add('warn', [P].concat(tanpaRouter), `${nm(tanpaRouter)} tersambung langsung ke ${P.nama} tanpa router — tidak ada NAT, DHCP, dan firewall. Pasang router di antaranya`);
        }
        // Media wireless hanya ke perangkat yang punya radio.
        const wlSalah = ch.filter(c => c.media === 'wireless');
        if (wlSalah.length && !RADIO.includes(P.jenis)) {
          add('err', [P].concat(wlSalah), `${nm(wlSalah)}: media wireless ke ${P.nama} (${lbl(P)}) yang tidak punya radio — pakai kabel, atau sambungkan ke AP / wireless bridge`);
        }
        if (P.jenis === 'ap') {
          // AP umumnya hanya punya port uplink; klien kabel perlu switch.
          const kabel = ch.filter(c => c.media && c.media !== 'wireless' && !['ap', 'switch'].includes(c.jenis));
          if (kabel.length) add('warn', [P].concat(kabel), `${P.nama}: ${kabel.length} perangkat tersambung kabel (${nm(kabel)}) — klien AP seharusnya wireless; ubah media, atau sambungkan ke switch bila memang kabel`);
          const infra = ch.filter(c => ['router', 'lan'].includes(c.jenis));
          if (infra.length) add('warn', [P].concat(infra), `${nm(infra)} di bawah AP ${P.nama} — ${infra.map(lbl).join(' / ')} seharusnya dari switch/router`);
        }
        if (P.jenis === 'lan') {
          const salah = ch.filter(c => ['router', 'lan'].includes(c.jenis));
          if (salah.length) add('warn', [P].concat(salah), `${nm(salah)} di bawah titik LAN ${P.nama} — titik LAN pasif hanya untuk perangkat ujung / AP / switch kecil`);
        }
        if (P.jenis === 'bridge') {
          const pasangan = ch.filter(c => c.jenis === 'bridge' && c.media && c.media !== 'wireless');
          if (pasangan.length) add('info', [P].concat(pasangan), `${P.nama} → ${nm(pasangan)}: link antar wireless bridge biasanya media wireless`);
        }
      }
      for (const d of list) {
        const p = parentOf(d);
        if (!p || NP.nonJaringan(d)) continue;
        if (d.jenis === 'isp') add('warn', [d, p], `${d.nama}: Sumber WAN seharusnya di puncak jalur — sekarang ber-uplink ke ${p.nama}`);
        // Satu kabel = satu jaringan: uplink ke perangkat di layer lain biasanya salah pilih titik.
        if (lapisanList().length > 1 && lapisanOf(d) !== lapisanOf(p)) {
          add('warn', [d, p], `${d.nama} (${lapisanById(lapisanOf(d)).nama}) ber-uplink ke ${p.nama} di layer lain (${lapisanById(lapisanOf(p)).nama}) — pastikan memang satu jaringan, atau pindahkan ke layer yang sama`);
        }
        if (d.jenis === 'lan' && !['switch', 'router', 'bridge', 'lan'].includes(p.jenis) && !UJUNG.includes(p.jenis)) {
          add('warn', [d, p], `${d.nama}: titik LAN seharusnya ditarik dari switch / router (sekarang dari ${p.nama})`);
        }
        if (['switch', 'router', 'lan'].includes(d.jenis) && d.media === 'wireless' && RADIO.includes(p.jenis)) {
          add('err', [d, p], `${d.nama}: ${lbl(d)} tidak punya radio — sambungkan dengan kabel ke ${p.nama}${p.jenis === 'ap' ? ', atau pakai wireless bridge' : ''}`);
        }
        // Fiber butuh port SFP di kedua sisi (bila jumlah port diketahui).
        if (d.media === 'fiber') {
          [p, d].filter(x => ['switch', 'router'].includes(x.jenis)).forEach(x => {
            const pm = portMap(x);
            if (pm.eth && !pm.sfp) add('warn', [d, p], `${d.nama} ↔ ${p.nama}: kabel fiber, tetapi ${x.nama} tidak punya port SFP — siapkan media converter / modul SFP`);
          });
        }
      }
    }

    /**
     * Konfigurasi perangkat inti: router (IP LAN, mode multi-WAN, limit bandwidth, VLAN tak terpakai), Sumber WAN
     * (bandwidth), switch yang membawa VLAN (tipe managed).
     */
    const adaIp = s => /\d{1,3}(\.\d{1,3}){3}/.test(String(s || ''));
    function cekKonfig(add) {
      const def = vlanDef();
      const dipakai = new Set();
      list.forEach(d => vlanDev(d).forEach(v => dipakai.add(v)));
      for (const d of list) {
        const a = d.atribut || {};
        if (d.jenis === 'router') {
          let mt = {};
          try { mt = JSON.parse(a.mt || '{}') || {}; } catch (e) { mt = {}; }
          if (!adaIp(mt.lan_ip) && !adaIp(d.ip) && !adaIp(a.subnet_lan)) {
            add('err', d, `${d.nama}: IP LAN / subnet belum diisi — gateway & DHCP untuk klien tidak bisa dibuat. Isi IP router, mis. 10.10.0.1/22`);
          }
          const bebas = (Array.isArray(mt.vlan) ? mt.vlan : []).map(v => parseInt(v && v.id, 10)).filter(v => v > 1 && !dipakai.has(v));
          if (bebas.length) add('info', d, `${d.nama}: VLAN ${bebas.join(', ')} dibuat di router tetapi belum dipakai perangkat mana pun — isi kolom VLAN perangkat / SSID AP`);
        }
        // Hasil checker penempatan: tidak sesuai plan.
        const vf = NP.verifOf(d);
        if (vf && vf.h === 'tidak') add('warn', d, `${d.nama}: penempatan TIDAK sesuai plan (dicek ${vf.o || 'checker'} ${vf.t || ''})${vf.c ? ' — ' + vf.c : ''}`);
        if (d.jenis === 'isp' && !d.bandwidth_mbps && pemakaiWan(d.id).length + kids(d.id).length) {
          add('info', d, `${d.nama}: bandwidth ISP belum diisi — bottleneck & pembagian bandwidth tidak bisa dihitung`);
        }
        if (d.jenis === 'switch' && !String(a.managed || '').trim() && def.size) {
          const lv = parentOf(d) ? linkVlan(d) : null;
          const bawaVlan = (lv && lv.mode !== 'native') || kids(d.id).some(c => linkVlan(c).mode !== 'native');
          if (bawaVlan) add('warn', d, `${d.nama}: membawa VLAN, tetapi tipe switch belum diisi — trunk/access VLAN butuh switch managed (isi Tipe di tab Switch)`);
        }
      }
    }

    // ---- Layer jaringan: beberapa jaringan terpisah (sumber WAN & tarikan berbeda) dalam satu denah. Definisi di
    // proyek.lapisan [{id, nama, warna}]; perangkat memilih layer di atribut "lapisan" (kosong = layer pertama).
    // Tanpa definisi = satu layer bawaan. Id layer yang dipakai perangkat tetapi belum didefinisikan ikut muncul.
    const lapisanMemo = { v: null };
    function lapisanList() {
      if (lapisanMemo.v) return lapisanMemo.v;
      const def = Array.isArray(proyek && proyek.lapisan) && proyek.lapisan.length ? proyek.lapisan.slice()
        : [{ id: 'L1', nama: (proyek && proyek.nama) || 'Jaringan utama', warna: '#2563eb' }];
      const ada = new Set(def.map(l => l.id));
      for (const d of list) {
        const lid = d.atribut && d.atribut.lapisan;
        if (lid && !ada.has(lid)) {
          ada.add(lid);
          def.push({ id: lid, nama: 'Layer ' + lid.slice(1), warna: '#64748b' });
        }
      }
      return (lapisanMemo.v = def);
    }
    /** Id layer perangkat (kosong = layer pertama). */
    function lapisanOf(d) {
      return (d && d.atribut && d.atribut.lapisan) || lapisanList()[0].id;
    }
    function lapisanById(id) {
      return lapisanList().find(l => l.id === id) || lapisanList()[0];
    }

    /** Akar pohon topologi jaringan (titik listrik tidak termasuk jaringan). */
    function roots() {
      return sortDev(list.filter(d => !parentOf(d) && !NP.nonJaringan(d)));
    }

    // ---- Daya listrik: perangkat memilih titik listrik pemasok (atribut listrik_id) dan konsumsi daya (atribut daya_w,
    // atau spesifikasi katalog daya_w). Titik listrik: dari MCB (arus × tegangan), atau kapasitas manual.

    /** Konsumsi daya perangkat (W) atau null bila belum diketahui. */
    function dayaW(d) {
      // Peralatan support: isian = daya per unit, dikalikan jumlah unit.
      const n = NP.nonJaringan(d) && parseInt(d.atribut && d.atribut.jumlah, 10) > 1 ? parseInt(d.atribut.jumlah, 10) : 1;
      const v = parseFloat(d.atribut && d.atribut.daya_w);
      if (v > 0) return v * n;
      const s = parseFloat(spec(d).daya_w);
      return s > 0 ? s * n : null;
    }

    /** Kapasitas titik listrik (W): isian kapasitas manual, atau dari MCB (lihat NP.dayaMcb). */
    function kapasitasW(L) {
      const a = L.atribut || {};
      const k = parseFloat(a.kapasitas_w);
      if (k > 0) return k;
      const mcb = NP.dayaMcb(a);
      return mcb ? mcb.w : null;
    }

    /** Titik listrik pemasok perangkat (bila dipilih & masih ada). */
    function listrikOf(d) {
      const id = d.atribut && +d.atribut.listrik_id;
      const L = id ? byId.get(id) : null;
      return L && NP.isListrik(L) && !['poe', 'baterai'].includes(d.atribut.listrik) ? L : null;
    }

    /** Beban tiap titik listrik: {L, devs, watt, kap, pct, tanpaDaya, soket}. */
    function bebanListrik() {
      return sortDev(list.filter(NP.isListrik)).map(L => {
        const devs = list.filter(d => listrikOf(d) === L);
        const watt = devs.reduce((s, d) => s + (dayaW(d) || 0), 0);
        const kap = kapasitasW(L);
        return { L, devs, watt, kap, pct: kap ? Math.round(watt / kap * 100) : null,
          tanpaDaya: devs.filter(d => dayaW(d) == null).length, soket: parseInt(L.atribut && L.atribut.soket, 10) || null };
      });
    }

    /** Ringkasan kebutuhan listrik perangkat jaringan menurut sumbernya (atribut listrik). */
    function ringkasListrik() {
      const per = {};
      Object.keys(NP.LISTRIK).forEach(k => { per[k] = []; });
      for (const d of list) {
        if (NP.isListrik(d) || d.jenis === 'isp') continue;
        const k = NP.LISTRIK[(d.atribut || {}).listrik] ? d.atribut.listrik : '';
        per[k].push(d);
      }
      const total = list.filter(d => !NP.isListrik(d)).reduce((s, d) => s + (dayaW(d) || 0), 0);
      return { per, total };
    }

    /** Apakah pancaran A mengarah ke B: omni selalu; sektoral bila B ada dalam lebar sektor (+20° toleransi). */
    function mengarah(A, B) {
      const sk = sektor(A);
      if (!sk) return true;
      const deg = (Math.atan2(B.x - A.x, -(B.y - A.y)) * 180 / Math.PI + 360) % 360;
      const beda = Math.abs(((deg - sk.arah) % 360 + 540) % 360 - 180);
      return beda <= sk.lebar / 2 + 20;
    }

    function apRadiusPx(d) {
      const r = parseFloat(d.atribut && d.atribut.radius_m);
      const sk = skalaOf(d);
      return r > 0 && sk ? r / sk : null;
    }

    /** Daftar masalah desain. level: err | warn | info. */
    function checks() {
      const out = [];
      // links = id perangkat anak yang kabel uplink-nya bermasalah (digambar merah di denah). Kosong = diturunkan otomatis.
      const add = (level, d, msg, links) => out.push({ level, ids: [].concat(d || []).map(x => x.id), msg, links: links ? [].concat(links).map(x => x.id) : null });

      // IP ganda (per layer jaringan: jaringan terpisah boleh memakai IP yang sama).
      const ipMap = new Map();
      const multiLp = lapisanList().length > 1;
      for (const d of list) {
        const ip = (d.ip || '').trim().replace(/\/\d+$/, '');
        if (!ip || /dhcp|dinamis/i.test(ip)) continue;
        const kunci = multiLp ? lapisanOf(d) + '|' + ip : ip;
        if (!ipMap.has(kunci)) ipMap.set(kunci, []);
        ipMap.get(kunci).push(d);
      }
      for (const [kunci, ds] of ipMap) {
        const ip = kunci.replace(/^L\d+\|/, '');
        if (ds.length > 1) add('err', ds, `IP ${ip} dipakai ${ds.length} perangkat${multiLp ? ' di layer ' + lapisanById(lapisanOf(ds[0])).nama : ''}: ${ds.map(d => d.nama).join(', ')}`, []);
      }

      for (const d of list) {
        const t = TYPES[d.jenis] || TYPES.lainnya;
        const p = parentOf(d);
        const a = d.atribut || {};
        if (!p && d.jenis !== 'isp' && !NP.nonJaringan(d)) {
          add(list.length > 1 ? 'warn' : 'info', d, `${d.nama}: belum punya uplink (tidak tersambung ke sumber WAN)`);
        } else if (p && !wans(d).length) {
          add('warn', d, `${d.nama}: jalur uplink tidak berujung di Sumber WAN/ISP`);
        }
        // Multi-WAN: pemberitahuan bila WAN utama tidak sampai ke ISP (hanya WAN tambahan yang aktif).
        if (wanLain(d).length && p && !wanOf(d)) {
          add('info', d, `${d.nama}: WAN utama (uplink ${p.nama}) tidak berujung di Sumber WAN — hanya WAN tambahan yang aktif`);
        }
        // Uplink kedua switch: redundan butuh STP/RSTP (tanpa itu = loop broadcast); LACP butuh konfigurasi di kedua sisi.
        const up2 = uplinkLain(d);
        if (up2.length) {
          if (uplinkMode(d) === 'lacp') {
            const beda = up2.filter(w => w.dev.id !== d.uplink_id);
            add('info', d, `${d.nama}: LACP ${up2.length + (p ? 1 : 0)} kabel — aktifkan link aggregation (802.3ad) di ${d.nama} & ${[p, ...up2.map(w => w.dev)].filter(Boolean).map(x => x.nama).filter((v, i, a) => a.indexOf(v) === i).join(', ')}` +
              (beda.length ? '. LACP ke switch berbeda butuh stacking/MLAG' : ''));
          } else {
            add('info', d, `${d.nama}: ${up2.length + (p ? 1 : 0)} uplink redundan — pastikan STP/RSTP aktif di semua switch terkait agar tidak terjadi loop`);
          }
          up2.filter(w => w.kabel === 'bermasalah').forEach(w => add('err', d, `${d.nama}: kabel uplink ke ${w.dev.nama} bermasalah`));
        }
        if (!p && wanLain(d).length && d.jenis !== 'isp') {
          add('info', d, `${d.nama}: hanya punya WAN tambahan — jadikan salah satunya uplink (WAN utama) agar pohon topologi rapi`);
        }
        if (d.status === 'bermasalah') add('err', d, `${d.nama}: berstatus bermasalah`);
        if (p && NP.perluKabel(d) && NP.kabelSt(d) === 'bermasalah') add('err', d, `${d.nama}: kabel ke ${p.nama} bermasalah`, [d]);
        // Alat sudah diuji tetapi kabelnya belum ditarik: data lapangan tidak konsisten.
        if (p && NP.perluKabel(d) && d.status === 'diuji' && NP.kabelSt(d) === 'belum') add('info', d, `${d.nama}: sudah diuji tetapi status kabel ke ${p.nama} masih "belum ditarik"`);

        // Kabel UTP terlalu panjang
        const k = kabelM(d);
        if (k != null && (d.media === 'utp' || d.media === '') && k > UTP_MAX_M) {
          add('warn', d, `${d.nama}: estimasi kabel UTP ${fmtM(k)} ke ${p.nama} melebihi ${UTP_MAX_M} m — pakai fiber, wireless bridge, atau switch perantara`);
        }

        // Bottleneck: alokasi anak lebih besar dari induknya
        // Bandwidth kosong / 0 = belum diisi (bukan 0 Mbps), tidak dibandingkan.
        if (p && d.bandwidth_mbps > 0 && p.bandwidth_mbps > 0 && d.bandwidth_mbps > p.bandwidth_mbps && d.jenis !== 'isp') {
          add('info', d, `${d.nama}: bandwidth ${fmtBw(d.bandwidth_mbps)} lebih besar dari uplink ${p.nama} (${fmtBw(p.bandwidth_mbps)})`);
        }

        // Oversubscription di induk
        const ch = kids(d.id);
        if (d.bandwidth_mbps > 0 && ch.length) {
          const sum = ch.reduce((s, c) => s + (c.bandwidth_mbps || 0), 0);
          if (sum > d.bandwidth_mbps) {
            const ratio = Math.round(sum / d.bandwidth_mbps * 10) / 10;
            add(ratio > 4 ? 'warn' : 'info', d, `${d.nama}: total alokasi perangkat di bawahnya ${fmtBw(sum)} dari ${fmtBw(d.bandwidth_mbps)} (oversubscribe ${ratio.toLocaleString('id-ID')}×)`);
          }
        }

        // Port switch
        const nPort = parseInt(a.jumlah_port, 10);
        // Port terpakai = anak + uplink + uplink tambahan sendiri + switch lain yang memakai switch ini sebagai uplink kedua.
        const ekstra = d.jenis === 'switch' ? uplinkLain(d).length + list.filter(x => x !== d && uplinkLain(x).some(w => w.dev.id === d.id)).length : 0;
        if (d.jenis === 'switch' && nPort > 0 && ch.length + (p ? 1 : 0) + ekstra > nPort) {
          add('err', d, `${d.nama}: ${ch.length + (p ? 1 : 0) + ekstra} koneksi (termasuk uplink) melebihi ${nPort} port`);
        }
        // Titik LAN: jumlah port = jumlah perangkat (laptop, printer, ...) yang bisa dicolok langsung.
        if (d.jenis === 'lan' && nPort > 0 && ch.length > nPort) {
          add('warn', [d].concat(ch), `${d.nama}: ${ch.length} endpoint tersambung, titik LAN hanya ${nPort} port — tambah kabel/port atau switch kecil`);
        }
        // Port: satu port dipakai lebih dari satu perangkat ("ether5" = "5"), atau nomor port di luar jumlah port.
        if (ch.length || parentOf(d)) {
          const pm = portMap(d);
          for (const pt of pm.ports) {
            if (pt.isi.length > 1) add('err', [d].concat(pt.isi.map(x => x.dev)), `${d.nama} port ${pt.label} dipakai ${pt.isi.length} perangkat: ${pt.isi.map(x => x.dev.nama).join(', ')}`);
          }
          const sama = new Map();
          for (const x of pm.lain) {
            const k = kunciPort(x.teks) || x.teks.trim().toLowerCase();
            if (pm.ports.length && kunciPort(x.teks)) {
              add('warn', [d, x.dev], `${d.nama}: port "${x.teks}" (${x.dev.nama}) tidak ada — ${d.nama} punya ${pm.eth} port${pm.sfp ? ' + ' + pm.sfp + ' SFP' : ''}`);
            }
            if (!sama.has(k)) sama.set(k, []);
            sama.get(k).push(x.dev);
          }
          for (const [k, ds] of sama) if (ds.length > 1 && !pm.ports.length) add('err', ds, `${d.nama} port ${k} dipakai ${ds.length} perangkat: ${ds.map(x => x.nama).join(', ')}`);
        }

        if (d.jenis === 'ap' && !a.ssid) add('info', d, `${d.nama}: SSID belum diisi`);
        if (d.jenis === 'ap' && a.keamanan && a.keamanan !== 'Open' && !/captive/i.test(a.keamanan) && !/Enterprise/.test(a.keamanan) && !a.password) {
          add('info', d, `${d.nama}: keamanan ${a.keamanan} tetapi password belum diisi`);
        }
      }

      // PoE: kebutuhan daya perangkat (katalog) vs yang disediakan uplink (katalog PoE out / isian PoE switch).
      const poeNama = k => ({ 1: '802.3af (PoE)', 2: '802.3at (PoE+)', 3: '802.3bt (PoE++)', p24: 'passive 24V', p48: 'passive 48V' }[k] || '');
      for (const d of list) {
        const p = parentOf(d);
        const need = poeKelas(spec(d).poe_in);
        if (!p || !need || d.media === 'wireless' || d.media === 'fiber') continue;
        const give = poeKelas(spec(p).poe_out) != null ? poeKelas(spec(p).poe_out) : poeKelas(p.atribut && p.atribut.poe);
        if (give == null) continue;
        if (give === 0) {
          add('warn', [d, p], `${d.nama}: butuh daya ${poeNama(need)}, tetapi ${p.nama} tidak menyediakan PoE — siapkan injector/adaptor`);
        } else if (typeof need === 'string' || typeof give === 'string') {
          if (need !== give) add('warn', [d, p], `${d.nama}: butuh ${poeNama(need)}, ${p.nama} menyediakan ${poeNama(give)} — tidak cocok, siapkan injector`);
        } else if (give < need) {
          add('warn', [d, p], `${d.nama}: butuh ${poeNama(need)}, ${p.nama} hanya ${poeNama(give)} — daya bisa kurang`);
        }
      }
      // Budget PoE switch/router: total konsumsi perangkat ber-PoE di bawahnya.
      for (const p of list) {
        const budget = parseFloat(spec(p).poe_budget_w) || parseFloat(p.atribut && p.atribut.budget_poe);
        if (!budget) continue;
        const pakai = kids(p.id).filter(c => poeKelas(spec(c).poe_in) && c.media !== 'wireless' && c.media !== 'fiber');
        const watt = pakai.reduce((s, c) => s + (parseFloat(spec(c).daya_w) || 0), 0);
        if (!watt) continue;
        const pct = Math.round(watt / budget * 100);
        if (watt > budget) add('err', [p].concat(pakai), `${p.nama}: total daya PoE ${Math.round(watt)} W melebihi budget ${budget} W (${pct}%)`);
        else if (pct >= 80) add('info', p, `${p.nama}: daya PoE terpakai ${Math.round(watt)} dari ${budget} W (${pct}%) — sisakan cadangan`);
      }
      cekKoneksi(add);
      cekKonfig(add);
      cekVlan(add);

      // Listrik: beban titik listrik vs kapasitas & jumlah stop kontak; perangkat yang masih perlu ditarikkan listrik.
      const w = x => Math.round(x).toLocaleString('id-ID') + ' W';
      for (const b of bebanListrik()) {
        if (b.kap && b.watt > b.kap) add('err', [b.L].concat(b.devs), `${b.L.nama}: beban ${w(b.watt)} melebihi kapasitas ${w(b.kap)} (${b.pct}%)`);
        else if (b.kap && b.pct >= 80) add('warn', b.L, `${b.L.nama}: beban ${w(b.watt)} dari ${w(b.kap)} (${b.pct}%) — sisakan cadangan`);
        if (b.soket && b.devs.length > b.soket) add('warn', [b.L].concat(b.devs), `${b.L.nama}: ${b.devs.length} perangkat, stop kontak hanya ${b.soket} — siapkan terminal/colokan tambahan`);
        if (b.tanpaDaya) add('info', b.L, `${b.L.nama}: ${b.tanpaDaya} perangkat belum diisi konsumsi dayanya — beban belum lengkap`);
      }
      for (const d of list) {
        if (d.atribut && d.atribut.listrik === 'perlu') add('info', d, `${d.nama}: belum ada stop kontak di lokasi — perlu tarik listrik${listrikOf(d) ? ' dari ' + listrikOf(d).nama : ''}`);
      }

      // Stok katalog vs kebutuhan event ini.
      const perKat = new Map();
      for (const d of list) {
        const k = kat(d);
        if (!k) continue;
        if (!perKat.has(k.id)) perKat.set(k.id, []);
        perKat.get(k.id).push(d);
      }
      for (const [kid, ds] of perKat) {
        const k = katById.get(kid);
        if (k.stok != null && ds.length > k.stok) {
          add('warn', ds, `${[k.merek, k.model].filter(Boolean).join(' ')}: dibutuhkan ${ds.length} unit, stok ${k.stok} (kurang ${ds.length - k.stok})`);
        }
      }

      // Co-channel AP yang cakupannya bertumpuk
      const aps = list.filter(d => d.jenis === 'ap' && d.atribut && d.atribut.channel);
      for (let i = 0; i < aps.length; i++) {
        for (let j = i + 1; j < aps.length; j++) {
          const A = aps[i], B = aps[j];
          if (String(A.atribut.channel).trim() !== String(B.atribut.channel).trim() || beda(A, B)) continue;
          const ra = apRadiusPx(A), rb = apRadiusPx(B);
          if (ra == null || rb == null) continue;
          // Sektoral: dianggap bertumpuk hanya bila salah satu AP memancar ke arah AP lainnya (omni selalu).
          if (distPx(A, B) < (ra + rb) * 0.8 && (mengarah(A, B) || mengarah(B, A))) {
            add('warn', [A, B], `${A.nama} & ${B.nama}: channel sama (${A.atribut.channel}) dengan cakupan bertumpuk — potensi interferensi co-channel`);
          }
        }
      }

      // Kabel yang ikut salah: perangkat di daftar yang uplink-nya juga ada di daftar (mis. port dobel, media salah).
      out.forEach(c => {
        if (c.links) return;
        const ids = new Set(c.ids);
        c.links = c.ids.filter(id => { const d = byId.get(id); return d && d.uplink_id != null && ids.has(d.uplink_id); });
      });

      const rank = { err: 0, warn: 1, info: 2 };
      return out.sort((x, y) => rank[x.level] - rank[y.level]);
    }

    /** Kebutuhan perangkat (bill of materials) per jenis + merek/tipe. */
    function bom() {
      const m = new Map();
      for (const d of list) {
        // Dari katalog: dikelompokkan per item katalog (beserta stok); manual: per nama alat.
        const k = kat(d);
        // Endpoint tanpa katalog dikelompokkan per tipe (Laptop, Printer, ...) + nama alat.
        const e = NP.tipeEp(d);
        const key = k ? 'k' + k.id : [d.jenis, e ? e.id : '', (d.model || '').trim().toLowerCase()].join('|');
        if (!m.has(key)) {
          const model = (d.model || '').trim();
          m.set(key, { jenis: d.jenis, model: k ? [k.merek, k.model].filter(Boolean).join(' ') : e ? e.nama + (model ? ' · ' + model : '') : model,
            jumlah: 0, nama: [], katalog: k, stok: k ? k.stok : null, lp: {} });
        }
        const r = m.get(key);
        r.jumlah++;
        const lid = lapisanOf(d); // rincian per layer jaringan
        r.lp[lid] = (r.lp[lid] || 0) + 1;
        r.nama.push(d.nama);
      }
      return [...m.values()].sort((a, b) => TYPE_ORDER.indexOf(a.jenis) - TYPE_ORDER.indexOf(b.jenis) || a.model.localeCompare(b.model));
    }

    /** Total estimasi kabel per media + jumlah link yang belum bisa dihitung. */
    function kabel() {
      // Rincian per layer jaringan: lp[id] = {m, n}.
      const tambahLp = (t, d, k) => {
        const lid = lapisanOf(d);
        t.lp[lid] = t.lp[lid] || { m: 0, n: 0 };
        t.lp[lid].m += k;
        t.lp[lid].n++;
      };
      const tot = {};
      let tanpaSkala = 0;
      for (const d of list) {
        if (!parentOf(d) || d.media === 'wireless') continue;
        const k = kabelM(d);
        if (k == null) {
          tanpaSkala++;
          continue;
        }
        const key = d.media || 'utp';
        tot[key] = tot[key] || { m: 0, n: 0, lp: {} };
        tot[key].m += k;
        tot[key].n++;
        tambahLp(tot[key], d, k);
      }
      // Kabel sambungan tambahan (WAN tambahan / uplink kedua): garis lurus + tambahan, media per sambungan.
      for (const d of list) {
        for (const w of linkLain(d)) {
          const k = kabelWanM(d, w.dev);
          if (k == null) {
            tanpaSkala++;
            continue;
          }
          tot[w.media] = tot[w.media] || { m: 0, n: 0, lp: {} };
          tot[w.media].m += k;
          tot[w.media].n++;
          tambahLp(tot[w.media], d, k);
        }
      }
      return { tot, tanpaSkala };
    }

    /**
     * Progres penarikan kabel (kabel ke uplink, tanpa wireless): jumlah link & meter per status, persen selesai.
     * "Selesai" = sudah ditarik / terminasi / dites; meter dihitung bila skala sudah dikalibrasi.
     */
    function progresKabel() {
      const per = {};
      Object.keys(NP.KABEL).forEach(k => { per[k] = { n: 0, m: 0, ids: [] }; });
      let total = 0, totalM = 0, selesai = 0, selesaiM = 0;
      for (const d of list) {
        if (!NP.perluKabel(d) || !parentOf(d)) continue;
        const st = NP.kabelSt(d);
        const k = kabelM(d) || 0;
        per[st].n++;
        per[st].m += k;
        per[st].ids.push(d.id);
        total++;
        totalM += k;
        if (st === 'ditarik' || st === 'terminasi' || st === 'dites') {
          selesai++;
          selesaiM += k;
        }
      }
      // Sambungan tambahan (WAN tambahan router, uplink kedua switch) juga kabel yang harus ditarik.
      for (const d of list) {
        for (const w of linkLain(d)) {
          const k = kabelWanM(d, w.dev) || 0;
          per[w.kabel].n++;
          per[w.kabel].m += k;
          per[w.kabel].ids.push(d.id);
          total++;
          totalM += k;
          if (w.kabel === 'ditarik' || w.kabel === 'terminasi' || w.kabel === 'dites') {
            selesai++;
            selesaiM += k;
          }
        }
      }
      return { per, total, totalM, selesai, selesaiM, pct: total ? Math.round(selesai / total * 100) : 0 };
    }

    /** Ringkasan SSID: SSID -> {keamanan, vlan, ap[]}. */
    function ssids() {
      const m = new Map();
      for (const d of list) {
        if (d.jenis !== 'ap' || !d.atribut || !d.atribut.ssid) continue;
        const k = d.atribut.ssid;
        if (!m.has(k)) m.set(k, { ssid: k, keamanan: new Set(), vlan: new Set(), ap: [] });
        const r = m.get(k);
        if (d.atribut.keamanan) r.keamanan.add(d.atribut.keamanan);
        if (d.vlan) r.vlan.add(d.vlan);
        r.ap.push(d);
      }
      return [...m.values()];
    }

    return { proyek, list, byId, kat, spec, kids, parentOf, path, descendants, distPx, jarakM, routePts, jalurM, kabelM, bwEfektif, wanOf, wans, wanLain, wanMode, uplinkLain, uplinkMode, linkLain, routePtsLain, pemakaiWan, kabelWanM, koneksi, koneksiLink, roots, apRadiusPx, checks, bom, kabel, progresKabel, ssids, portMap, portWan, jumlahPort, kunciPort, lapisanList, lapisanOf, lapisanById, lantaiList, multiLantai, lantaiOf, lantaiById, skalaOf, naikM, proyeksi, bedaLantai: beda, vlanDef, vlanDev, vlanButuh, linkVlan, vlanRingkas, vlanPortSw, vlanPortKosong, dayaW, kapasitasW, listrikOf, bebanListrik, ringkasListrik };
  }

  /** Urutan tampilan: jenis (WAN → router → switch → ...), lalu nama alami (AP-2 sebelum AP-10). */
  function sortDev(arr) {
    return arr.slice().sort((a, b) => TYPE_ORDER.indexOf(a.jenis) - TYPE_ORDER.indexOf(b.jenis) ||
      a.nama.localeCompare(b.nama, 'id', { numeric: true }));
  }

  /**
   * Salinan atribut dengan bentuk jalur sambungan tambahan (entri id=ke di atribut[kunci]) diganti. jalur null = lurus.
   * Dipakai peta (pratinjau saat menarik lekukan) dan app (menyimpan).
   */
  function atributJalurLain(atr, kunci, ke, jalur) {
    const out = Object.assign({}, atr);
    let arr;
    try { arr = JSON.parse(out[kunci] || '[]'); } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    out[kunci] = JSON.stringify(arr.map(w => {
      if (!w || +w.id !== +ke) return w;
      const n = Object.assign({}, w);
      if (jalur) n.jalur = jalur;
      else delete n.jalur;
      return n;
    }));
    return out;
  }

  NP.Model = { create, sortDev, atributJalurLain, UTP_MAX_M };
})();
