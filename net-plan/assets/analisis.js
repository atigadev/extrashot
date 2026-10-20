/* Analisis topologi: jalur ke WAN, bandwidth efektif, estimasi kabel, pemeriksaan desain, kebutuhan perangkat. */
(function () {
  'use strict';
  const { TYPES, TYPE_ORDER, fmtBw, fmtM } = NP;

  /** Batas panjang kabel UTP tembaga (standar 100 m, sisakan untuk patch cord). */
  const UTP_MAX_M = 90;

  function create(proyek, list) {
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

    function roots() {
      return sortDev(list.filter(d => !parentOf(d)));
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

      // Co-channel AP yang cakupannya bertumpuk
      const aps = list.filter(d => d.jenis === 'ap' && d.atribut && d.atribut.channel);
      for (let i = 0; i < aps.length; i++) {
        for (let j = i + 1; j < aps.length; j++) {
          const A = aps[i], B = aps[j];
          if (String(A.atribut.channel).trim() !== String(B.atribut.channel).trim()) continue;
          const ra = apRadiusPx(A), rb = apRadiusPx(B);
          if (ra == null || rb == null) continue;
          if (distPx(A, B) < (ra + rb) * 0.8) {
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
        const key = d.jenis + '\u0000' + (d.model || '').trim().toLowerCase();
        if (!m.has(key)) m.set(key, { jenis: d.jenis, model: (d.model || '').trim(), jumlah: 0, nama: [] });
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

    return { proyek, list, byId, kids, parentOf, path, descendants, distPx, jarakM, routePts, jalurM, kabelM, bwEfektif, wanOf, roots, apRadiusPx, checks, bom, kabel, ssids };
  }

  /** Urutan tampilan: jenis (WAN → router → switch → ...), lalu nama alami (AP-2 sebelum AP-10). */
  function sortDev(arr) {
    return arr.slice().sort((a, b) => TYPE_ORDER.indexOf(a.jenis) - TYPE_ORDER.indexOf(b.jenis) ||
      a.nama.localeCompare(b.nama, 'id', { numeric: true }));
  }

  NP.Model = { create, sortDev, UTP_MAX_M };
})();
