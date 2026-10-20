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

    /** Jarak lurus ke uplink (meter) atau null bila skala belum dikalibrasi. */
    function jarakM(d) {
      const p = parentOf(d);
      if (!p || !proyek.skala) return null;
      return distPx(d, p) * proyek.skala;
    }

    /** Titik-titik jalur kabel ke uplink (koordinat denah): [perangkat, ...lekukan, uplink]. */
    function routePts(d) {
      const p = parentOf(d);
      if (!p) return [];
      return [{ x: d.x, y: d.y }, ...bends(d, p), { x: p.x, y: p.y }];
    }

    /** Titik lekukan saja. Wireless selalu lurus (sinyal tidak mengikuti dinding). */
    function bends(d, p) {
      const j = d.jalur;
      if (!j || d.media === 'wireless') return [];
      if (j.m === 'h') return [{ x: p.x, y: d.y }];
      if (j.m === 'v') return [{ x: d.x, y: p.y }];
      if (j.m === 'bebas' && Array.isArray(j.p)) return j.p.map(pt => ({ x: pt[0], y: pt[1] }));
      return [];
    }

    function polyLen(pts) {
      let s = 0;
      for (let i = 1; i < pts.length; i++) s += distPx(pts[i - 1], pts[i]);
      return s;
    }

    /** Panjang jalur kabel (meter, tanpa tambahan) atau null bila skala belum dikalibrasi. */
    function jalurM(d) {
      if (!parentOf(d) || !proyek.skala) return null;
      return polyLen(routePts(d)) * proyek.skala;
    }

    /** Estimasi panjang kabel ke uplink = panjang jalur + tambahan (naik-turun, sisa). Wireless: null. */
    function kabelM(d) {
      const j = jalurM(d);
      if (j == null || d.media === 'wireless') return null;
      return j * (1 + (proyek.slack_kabel || 0) / 100);
    }

    /** Bandwidth efektif = nilai terkecil di sepanjang jalur ke WAN (bottleneck). */
    function bwEfektif(d) {
      let min = null;
      let at = null;
      for (const n of path(d)) {
        if (n.bandwidth_mbps != null && (min == null || n.bandwidth_mbps < min)) {
          min = n.bandwidth_mbps;
          at = n;
        }
      }
      return { mbps: min, at };
    }

    function wanOf(d) {
      const p = path(d);
      const root = p[p.length - 1];
      return root && root.jenis === 'isp' ? root : null;
    }

    /** 'online' | 'gangguan' | 'offline' — lihat NP.KONEKSI. Disimpan sementara per model. */
    const koneksiMemo = new Map();
    function koneksi(d) {
      if (!koneksiMemo.has(d.id)) {
        const p = path(d);
        const root = p[p.length - 1];
        koneksiMemo.set(d.id, !root || root.jenis !== 'isp' ? 'offline'
          : p.some(n => n.status === 'bermasalah') ? 'gangguan' : 'online');
      }
      return koneksiMemo.get(d.id);
    }

    /** Status koneksi yang dibawa garis dari perangkat ke uplinknya = status uplink tersebut. */
    function koneksiLink(d) {
      const p = parentOf(d);
      return p ? koneksi(p) : 'offline';
    }

    function roots() {
      return sortDev(list.filter(d => !parentOf(d)));
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
      return r > 0 && proyek.skala ? r / proyek.skala : null;
    }

    /** Daftar masalah desain. level: err | warn | info. */
    function checks() {
      const out = [];
      const add = (level, d, msg) => out.push({ level, ids: [].concat(d || []).map(x => x.id), msg });

      // IP ganda
      const ipMap = new Map();
      for (const d of list) {
        const ip = (d.ip || '').trim().replace(/\/\d+$/, '');
        if (!ip || /dhcp|dinamis/i.test(ip)) continue;
        if (!ipMap.has(ip)) ipMap.set(ip, []);
        ipMap.get(ip).push(d);
      }
      for (const [ip, ds] of ipMap) {
        if (ds.length > 1) add('err', ds, `IP ${ip} dipakai ${ds.length} perangkat: ${ds.map(d => d.nama).join(', ')}`);
      }

      for (const d of list) {
        const t = TYPES[d.jenis] || TYPES.lainnya;
        const p = parentOf(d);
        const a = d.atribut || {};
        if (!p && d.jenis !== 'isp') {
          add(list.length > 1 ? 'warn' : 'info', d, `${d.nama}: belum punya uplink (tidak tersambung ke sumber WAN)`);
        } else if (p && !wanOf(d)) {
          add('warn', d, `${d.nama}: jalur uplink tidak berujung di Sumber WAN/ISP`);
        }
        if (d.status === 'bermasalah') add('err', d, `${d.nama}: berstatus bermasalah`);

        // Kabel UTP terlalu panjang
        const k = kabelM(d);
        if (k != null && (d.media === 'utp' || d.media === '') && k > UTP_MAX_M) {
          add('warn', d, `${d.nama}: estimasi kabel UTP ${fmtM(k)} ke ${p.nama} melebihi ${UTP_MAX_M} m — pakai fiber, wireless bridge, atau switch perantara`);
        }

        // Bottleneck: alokasi anak lebih besar dari induknya
        if (p && d.bandwidth_mbps != null && p.bandwidth_mbps != null && d.bandwidth_mbps > p.bandwidth_mbps && d.jenis !== 'isp') {
          add('info', d, `${d.nama}: bandwidth ${fmtBw(d.bandwidth_mbps)} lebih besar dari uplink ${p.nama} (${fmtBw(p.bandwidth_mbps)})`);
        }

        // Oversubscription di induk
        const ch = kids(d.id);
        if (d.bandwidth_mbps != null && ch.length) {
          const sum = ch.reduce((s, c) => s + (c.bandwidth_mbps || 0), 0);
          if (sum > d.bandwidth_mbps) {
            const ratio = Math.round(sum / d.bandwidth_mbps * 10) / 10;
            add(ratio > 4 ? 'warn' : 'info', d, `${d.nama}: total alokasi perangkat di bawahnya ${fmtBw(sum)} dari ${fmtBw(d.bandwidth_mbps)} (oversubscribe ${ratio.toLocaleString('id-ID')}×)`);
          }
        }

        // Port switch
        const nPort = parseInt(a.jumlah_port, 10);
        if (d.jenis === 'switch' && nPort > 0 && ch.length + (p ? 1 : 0) > nPort) {
          add('err', d, `${d.nama}: ${ch.length + (p ? 1 : 0)} koneksi (termasuk uplink) melebihi ${nPort} port`);
        }
        // Titik LAN: jumlah port = jumlah perangkat (laptop, printer, ...) yang bisa dicolok langsung.
        if (d.jenis === 'lan' && nPort > 0 && ch.length > nPort) {
          add('warn', [d].concat(ch), `${d.nama}: ${ch.length} endpoint tersambung, titik LAN hanya ${nPort} port — tambah kabel/port atau switch kecil`);
        }
        const portMap = new Map();
        for (const c of ch) {
          const port = (c.port_uplink || '').trim().toLowerCase();
          if (!port) continue;
          if (!portMap.has(port)) portMap.set(port, []);
          portMap.get(port).push(c);
        }
        for (const [port, cs] of portMap) {
          if (cs.length > 1) add('err', cs, `${d.nama} port ${port} dipakai ${cs.length} perangkat: ${cs.map(c => c.nama).join(', ')}`);
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
          if (String(A.atribut.channel).trim() !== String(B.atribut.channel).trim()) continue;
          const ra = apRadiusPx(A), rb = apRadiusPx(B);
          if (ra == null || rb == null) continue;
          // Sektoral: dianggap bertumpuk hanya bila salah satu AP memancar ke arah AP lainnya (omni selalu).
          if (distPx(A, B) < (ra + rb) * 0.8 && (mengarah(A, B) || mengarah(B, A))) {
            add('warn', [A, B], `${A.nama} & ${B.nama}: channel sama (${A.atribut.channel}) dengan cakupan bertumpuk — potensi interferensi co-channel`);
          }
        }
      }

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
            jumlah: 0, nama: [], katalog: k, stok: k ? k.stok : null });
        }
        const r = m.get(key);
        r.jumlah++;
        r.nama.push(d.nama);
      }
      return [...m.values()].sort((a, b) => TYPE_ORDER.indexOf(a.jenis) - TYPE_ORDER.indexOf(b.jenis) || a.model.localeCompare(b.model));
    }

    /** Total estimasi kabel per media + jumlah link yang belum bisa dihitung. */
    function kabel() {
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
        tot[key] = tot[key] || { m: 0, n: 0 };
        tot[key].m += k;
        tot[key].n++;
      }
      return { tot, tanpaSkala };
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

    return { proyek, list, byId, kat, spec, kids, parentOf, path, descendants, distPx, jarakM, routePts, jalurM, kabelM, bwEfektif, wanOf, koneksi, koneksiLink, roots, apRadiusPx, checks, bom, kabel, ssids };
  }

  /** Urutan tampilan: jenis (WAN → router → switch → ...), lalu nama alami (AP-2 sebelum AP-10). */
  function sortDev(arr) {
    return arr.slice().sort((a, b) => TYPE_ORDER.indexOf(a.jenis) - TYPE_ORDER.indexOf(b.jenis) ||
      a.nama.localeCompare(b.nama, 'id', { numeric: true }));
  }

  NP.Model = { create, sortDev, UTP_MAX_M };
})();
