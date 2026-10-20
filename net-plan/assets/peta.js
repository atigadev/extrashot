/*
 * Peta denah interaktif (SVG): gambar denah + titik perangkat + garis uplink.
 * Koordinat perangkat = piksel gambar denah ("dunia"). Gambar & lingkaran cakupan ikut diskalakan,
 * sedangkan titik/garis/label digambar dalam koordinat layar agar ukurannya tetap saat zoom.
 *
 * Alat: 'pilih' (klik/geser titik, geser latar = pan), 'hubung' (klik perangkat lalu klik uplinknya),
 *       'ukur' (dua klik = jarak; dipakai juga untuk kalibrasi skala), 'tambah:<jenis>' (klik = taruh perangkat).
 */
(function () {
  'use strict';
  const { TYPES, STATUS, MEDIA, KONEKSI, esc, fmtM } = NP;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const DEFAULT_W = 2000;
  const DEFAULT_H = 1250;
  // Layar sentuh: titik & pegangan lebih besar agar mudah diketuk.
  const COARSE = matchMedia('(pointer: coarse)').matches;
  const R = COARSE ? 15 : 12; // jari-jari titik (px layar)
  const MID_R = COARSE ? 9 : 5; // pegangan tengah ruas jalur kabel
  const WP = COARSE ? 20 : 12; // sisi kotak lekukan
  const BADGE = COARSE ? 6.5 : 5.5; // jari-jari lencana status internet

  function Peta(svg, cb) {
    svg.innerHTML = `
      <defs>
        <pattern id="np-grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M50 0H0V50" fill="none" stroke="#d6dbe4" stroke-width="1"/>
        </pattern>
      </defs>
      <g class="world"><g class="bg"></g><g class="cov"></g></g>
      <g class="links"></g>
      <g class="nodes"></g>
      <g class="handles"></g>
      <g class="tool"></g>`;
    const gWorld = svg.querySelector('.world');
    const gBg = svg.querySelector('.bg');
    const gCov = svg.querySelector('.cov');
    const gLinks = svg.querySelector('.links');
    const gNodes = svg.querySelector('.nodes');
    const gTool = svg.querySelector('.tool');
    const gHandles = svg.querySelector('.handles');

    const st = {
      model: null, W: DEFAULT_W, H: DEFAULT_H, img: null,
      z: 1, tx: 0, ty: 0, fitted: false,
      tool: 'pilih', sel: null, canEdit: true,
      layers: { label: true, garis: true, jarak: false, cakupan: true, internet: true },
      hidden: new Set(), // jenis yang disembunyikan
      measure: [], linkSrc: null, cursor: null, flash: null,
      userView: false, // pengguna sudah zoom/pan sendiri
      inset: 0, // tinggi panel bawah yang menutupi peta (px)
      opacity: 1, // opasitas gambar denah (di atas latar putih -> makin pudar = makin terang)
    };
    const nodeEls = new Map();
    const linkEls = new Map();

    // ------------------------------------------------------------------ data & gambar

    function setData(model, imgUrl) {
      const p = model.proyek;
      const W = p.denah_w && imgUrl ? p.denah_w : DEFAULT_W;
      const H = p.denah_h && imgUrl ? p.denah_h : DEFAULT_H;
      const sizeChanged = W !== st.W || H !== st.H || imgUrl !== st.img || !st.model || st.model.proyek.id !== p.id;
      st.model = model;
      st.W = W;
      st.H = H;
      if (imgUrl !== st.img || !gBg.firstChild) {
        st.img = imgUrl;
        gBg.innerHTML = imgUrl
          ? `<rect width="${W}" height="${H}" fill="#fff"/><image class="denah-img" href="${esc(imgUrl)}" width="${W}" height="${H}" preserveAspectRatio="none" opacity="${st.opacity}"/>`
          : `<rect width="${W}" height="${H}" fill="#fbfcfe"/><rect width="${W}" height="${H}" fill="url(#np-grid)"/>
             <text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="bg-hint">Belum ada denah — upload di tab Proyek, atau langsung taruh perangkat di kanvas ini</text>`;
      }
      if (st.sel != null && !model.byId.has(st.sel)) st.sel = null;
      if (st.linkSrc != null && !model.byId.has(st.linkSrc)) st.linkSrc = null;
      build();
      if (!st.fitted || sizeChanged) fit();
      else layout();
    }

    function build() {
      const m = st.model;
      gNodes.textContent = '';
      gLinks.textContent = '';
      nodeEls.clear();
      linkEls.clear();
      // Perangkat terpilih digambar paling akhir agar berada di atas.
      const ordered = m.list.slice().sort((a, b) => (a.id === st.sel) - (b.id === st.sel));
      for (const d of m.list) {
        const p = m.parentOf(d);
        if (!p) continue;
        const media = MEDIA[d.media] || MEDIA.utp;
        // Garis = tepi putih (kontras di atas denah) + garis berwarna media. Garis yang belum membawa internet
        // diberi kelas k-offline / k-gangguan (warna & pola diatur np.css).
        const g = el('g', { class: 'link k-' + m.koneksiLink(d), 'data-id': d.id });
        g.innerHTML = `<polyline class="hit"/><polyline class="case"/><polyline class="ln" stroke="${media.color || '#0369a1'}" stroke-dasharray="${media.dash || ''}"/>
          <text class="dist"></text>`;
        gLinks.appendChild(g);
        linkEls.set(d.id, g);
      }
      for (const d of ordered) {
        const t = TYPES[d.jenis] || TYPES.lainnya;
        const s = STATUS[d.status] || STATUS.rencana;
        const kon = m.koneksi(d);
        const k = KONEKSI[kon];
        const b = Math.round(R * 0.78); // posisi lencana status internet (kanan atas titik)
        const g = el('g', { class: 'node st-' + d.status + ' k-' + kon, 'data-id': d.id });
        g.innerHTML = `<circle class="halo" r="${R + 8}"/>
          <circle class="ring" r="${R + 3}" stroke="${s.color}"/>
          <circle class="dot" r="${R}" fill="${t.color}"/>
          <text class="glyph${t.short.length > 2 ? ' small' : ''}" dy="0.35em">${esc(t.short)}</text>
          <g class="net" transform="translate(${b},${-b})"><circle r="${BADGE}" fill="${k.color}"/><text dy="0.36em">${k.icon}</text></g>
          <text class="lbl" y="${R + 15}">${esc(d.nama)}</text>
          <title>${esc(d.nama)} — ${esc(t.label)}\n${esc(k.label)}${d.model ? '\n' + esc(d.model) : ''}${d.ip ? '\n' + esc(d.ip) : ''}</title>`;
        gNodes.appendChild(g);
        nodeEls.set(d.id, g);
      }
      buildCoverage();
      applyClasses();
    }

    function buildCoverage() {
      const m = st.model;
      gCov.textContent = '';
      if (!st.layers.cakupan || !m) return;
      for (const d of m.list) {
        if (d.jenis !== 'ap' || st.hidden.has(d.jenis)) continue;
        const r = m.apRadiusPx(d);
        if (!r) continue;
        gCov.appendChild(el('circle', { cx: d.x, cy: d.y, r, class: 'cov-c' + (d.id === st.sel ? ' sel' : ''), 'data-id': d.id }));
      }
    }

    /** Kelas tampilan: terpilih, jalur ke WAN, tersembunyi, layer. */
    function applyClasses() {
      const m = st.model;
      if (!m) return;
      const onPath = new Set();
      if (st.sel != null && m.byId.has(st.sel)) {
        for (const d of m.path(m.byId.get(st.sel))) onPath.add(d.id);
      }
      for (const [id, g] of nodeEls) {
        const d = m.byId.get(id);
        g.classList.toggle('sel', id === st.sel);
        g.classList.toggle('src', id === st.linkSrc);
        g.classList.toggle('on-path', onPath.has(id) && id !== st.sel);
        g.classList.toggle('flash', id === st.flash);
        g.style.display = st.hidden.has(d.jenis) ? 'none' : '';
      }
      for (const [id, g] of linkEls) {
        const d = m.byId.get(id);
        const p = m.parentOf(d);
        g.classList.toggle('on-path', onPath.has(id) && p && onPath.has(p.id));
        g.style.display = !st.layers.garis || st.hidden.has(d.jenis) || (p && st.hidden.has(p.jenis)) ? 'none' : '';
      }
      svg.classList.toggle('no-label', !st.layers.label);
      svg.classList.toggle('no-dist', !st.layers.jarak);
      svg.classList.toggle('no-net', !st.layers.internet);
      svg.dataset.tool = st.tool.split(':')[0];
      svg.classList.toggle('readonly', !st.canEdit);
      drawHandles();
    }

    // ------------------------------------------------------------------ posisi

    const sx = x => x * st.z + st.tx;
    const sy = y => y * st.z + st.ty;

    function layout() {
      gWorld.setAttribute('transform', `matrix(${st.z},0,0,${st.z},${st.tx},${st.ty})`);
      const m = st.model;
      if (!m) return;
      for (const [id, g] of nodeEls) {
        const d = m.byId.get(id);
        g.setAttribute('transform', `translate(${sx(d.x).toFixed(1)},${sy(d.y).toFixed(1)})`);
      }
      for (const [id, g] of linkEls) {
        const d = m.byId.get(id);
        const p = m.parentOf(d);
        if (!p) continue;
        const pts = m.routePts(d).map(q => ({ x: sx(q.x), y: sy(q.y) }));
        const attr = pts.map(q => q.x.toFixed(1) + ',' + q.y.toFixed(1)).join(' ');
        for (const ln of g.querySelectorAll('polyline')) ln.setAttribute('points', attr);
        const t = g.querySelector('.dist');
        const k = d.media === 'wireless' ? m.jarakM(d) : m.kabelM(d);
        t.textContent = k != null ? fmtM(k) : '';
        const mid = alongPolyline(pts, 0.5);
        t.setAttribute('x', mid.x);
        t.setAttribute('y', mid.y - 4);
      }
      drawHandles();
      drawTool();
    }

    /** Titik pada polyline di posisi fraksi f (0..1) dari panjang totalnya. */
    function alongPolyline(pts, f) {
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      let target = total * f;
      for (let i = 1; i < pts.length; i++) {
        const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        if (target <= seg || i === pts.length - 1) {
          const r = seg ? Math.min(1, target / seg) : 0;
          return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * r, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * r };
        }
        target -= seg;
      }
      return pts[0] || { x: 0, y: 0 };
    }

    /** Perangkat terpilih yang jalur kabelnya bisa dibentuk (punya uplink, bukan wireless). */
    function routeDev() {
      const m = st.model;
      if (!m || !st.canEdit || st.tool !== 'pilih' || st.sel == null || !st.layers.garis) return null;
      const d = m.byId.get(st.sel);
      return d && m.parentOf(d) && d.media !== 'wireless' && !st.hidden.has(d.jenis) ? d : null;
    }

    /** Pegangan jalur: kotak = lekukan (geser / klik ganda hapus), bulatan kecil = tengah ruas (tarik = lekukan baru). */
    function drawHandles() {
      const d = routeDev();
      if (!d) {
        gHandles.textContent = '';
        return;
      }
      const pts = st.model.routePts(d).map(q => ({ x: sx(q.x), y: sy(q.y) }));
      let h = '';
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (Math.hypot(b.x - a.x, b.y - a.y) < 28) continue;
        h += `<circle class="mid" data-seg="${i}" cx="${(a.x + b.x) / 2}" cy="${(a.y + b.y) / 2}" r="${MID_R}"><title>Tarik untuk membuat lekukan</title></circle>`;
      }
      for (let i = 1; i < pts.length - 1; i++) {
        h += `<rect class="wp" data-i="${i - 1}" x="${pts[i].x - WP / 2}" y="${pts[i].y - WP / 2}" width="${WP}" height="${WP}" rx="3"><title>Geser lekukan · klik ganda / klik kanan untuk menghapus</title></rect>`;
      }
      gHandles.innerHTML = h;
    }

    function drawTool() {
      let h = '';
      const m = st.model;
      if (st.tool === 'ukur' && st.measure.length) {
        const [a, b] = st.measure;
        const end = b || st.cursor;
        if (end) {
          const px = Math.hypot(end.x - a.x, end.y - a.y);
          const lbl = m && m.proyek.skala ? fmtM(px * m.proyek.skala) : Math.round(px) + ' px';
          h += `<line class="ms-line" x1="${sx(a.x)}" y1="${sy(a.y)}" x2="${sx(end.x)}" y2="${sy(end.y)}"/>
            <text class="ms-lbl" x="${(sx(a.x) + sx(end.x)) / 2}" y="${(sy(a.y) + sy(end.y)) / 2 - 8}">${esc(lbl)}</text>`;
        }
        for (const p of st.measure) h += `<circle class="ms-pt" cx="${sx(p.x)}" cy="${sy(p.y)}" r="5"/>`;
      }
      if (st.tool === 'hubung' && st.linkSrc != null && st.cursor && m && m.byId.has(st.linkSrc)) {
        const s = m.byId.get(st.linkSrc);
        h += `<line class="rubber" x1="${sx(s.x)}" y1="${sy(s.y)}" x2="${sx(st.cursor.x)}" y2="${sy(st.cursor.y)}"/>`;
      }
      if (st.tool.startsWith('tambah:') && st.cursor && !st.dragging) {
        const t = TYPES[st.tool.slice(7)] || TYPES.lainnya;
        h += `<g class="ghost" transform="translate(${sx(st.cursor.x)},${sy(st.cursor.y)})">
          <circle r="${R}" fill="${t.color}"/><text class="glyph${t.short.length > 2 ? ' small' : ''}" dy="0.35em">${esc(t.short)}</text></g>`;
      }
      gTool.innerHTML = h;
    }

    function fit() {
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const pad = 24;
      const h = Math.max(120, r.height - st.inset); // area di atas panel bawah
      st.z = Math.min((r.width - pad * 2) / st.W, (h - pad * 2) / st.H);
      st.tx = (r.width - st.W * st.z) / 2;
      st.ty = (h - st.H * st.z) / 2;
      st.fitted = true;
      st.userView = false;
      layout();
    }

    function minZ() {
      const r = svg.getBoundingClientRect();
      return Math.min(r.width / st.W, r.height / st.H) * 0.25;
    }

    function zoomAt(f, cx, cy) {
      const z = Math.max(minZ(), Math.min(12, st.z * f));
      f = z / st.z;
      st.tx = cx - (cx - st.tx) * f;
      st.ty = cy - (cy - st.ty) * f;
      st.z = z;
      st.userView = true;
      layout();
    }

    function zoomBy(f) {
      const r = svg.getBoundingClientRect();
      zoomAt(f, r.width / 2, r.height / 2);
    }

    function centerOn(id) {
      const d = st.model && st.model.byId.get(id);
      if (!d) return;
      const r = svg.getBoundingClientRect();
      if (st.z < 0.6) st.z = Math.min(1, st.z * 2.5);
      // Pusatkan di area yang tidak tertutup panel bawah (HP/tablet).
      st.tx = r.width / 2 - d.x * st.z;
      st.ty = Math.max(60, r.height - st.inset) / 2 - d.y * st.z;
      st.userView = true;
      layout();
    }

    /** Geser tampilan seperlunya agar titik tidak tertutup panel bawah / keluar layar (zoom tidak berubah). */
    function ensureVisible(id) {
      const d = st.model && st.model.byId.get(id);
      if (!d) return;
      const r = svg.getBoundingClientRect();
      const visH = Math.max(80, r.height - st.inset);
      const m = 40;
      const x = sx(d.x), y = sy(d.y);
      let moved = false;
      if (x < m || x > r.width - m) {
        st.tx += r.width / 2 - x;
        moved = true;
      }
      if (y < m || y > visH - m) {
        st.ty += visH / 2 - y;
        moved = true;
      }
      if (moved) {
        st.userView = true;
        layout();
      }
    }

    function flash(id) {
      st.flash = id;
      applyClasses();
      setTimeout(() => {
        if (st.flash === id) {
          st.flash = null;
          applyClasses();
        }
      }, 1600);
    }

    // ------------------------------------------------------------------ input

    const pointers = new Map();
    let gesture = null; // {type:'pan'|'drag'|'pinch', ...}

    function local(e) {
      const r = svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function toWorld(p) {
      return { x: (p.x - st.tx) / st.z, y: (p.y - st.ty) / st.z };
    }
    function nodeIdAt(e) {
      const g = e.target.closest && e.target.closest('.node, .link, .cov-c');
      return g ? { id: +g.dataset.id, kind: g.classList.contains('node') ? 'node' : 'link' } : null;
    }

    svg.addEventListener('pointerdown', e => {
      if (e.button === 2) return;
      svg.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        st.dragging = false;
        return;
      }
      const hit = nodeIdAt(e);
      const middle = e.button === 1;
      const handle = !middle && e.target.closest && e.target.closest('.wp, .mid');
      const rd = handle && routeDev();
      if (rd) {
        // Bentuk jalur kabel: geser lekukan, atau tarik titik tengah ruas untuk menambah lekukan baru.
        const orig = rd.jalur ? JSON.parse(JSON.stringify(rd.jalur)) : null;
        const pts = st.model.routePts(rd).slice(1, -1);
        let idx;
        if (handle.classList.contains('mid')) {
          const full = st.model.routePts(rd);
          const k = +handle.dataset.seg;
          idx = k;
          pts.splice(k, 0, { x: (full[k].x + full[k + 1].x) / 2, y: (full[k].y + full[k + 1].y) / 2 });
        } else {
          idx = +handle.dataset.i;
        }
        gesture = { type: 'route', id: rd.id, pts, idx, orig, start: p, moved: false, inserted: handle.classList.contains('mid') };
        return;
      }
      if (!middle && hit && hit.kind === 'node' && st.tool === 'pilih' && st.canEdit) {
        const d = st.model.byId.get(hit.id);
        gesture = { type: 'drag', id: hit.id, start: p, ox: d.x, oy: d.y, moved: false, hit };
      } else {
        gesture = { type: 'pan', start: p, tx: st.tx, ty: st.ty, moved: false, hit: middle ? null : hit, middle };
      }
    });

    svg.addEventListener('pointermove', e => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      st.cursor = toWorld(p);
      if (gesture && gesture.type === 'pinch' && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        st.tx += mid.x - gesture.mid.x;
        st.ty += mid.y - gesture.mid.y;
        zoomAt(dist / gesture.dist, mid.x, mid.y);
        gesture.dist = dist;
        gesture.mid = mid;
        return;
      }
      if (!gesture) {
        if (st.tool !== 'pilih') drawTool();
        return;
      }
      const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
      gesture.moved = true;
      if (gesture.type === 'pan') {
        st.userView = true;
        st.tx = gesture.tx + dx;
        st.ty = gesture.ty + dy;
        layout();
      } else if (gesture.type === 'drag') {
        const d = st.model.byId.get(gesture.id);
        d.x = clampX(gesture.ox + dx / st.z);
        d.y = clampY(gesture.oy + dy / st.z);
        st.dragging = true;
        svg.classList.add('dragging');
        layout();
        if (d.jenis === 'ap') buildCoverage();
      } else if (gesture.type === 'route') {
        const d = st.model.byId.get(gesture.id);
        const pts = gesture.pts;
        const w = toWorld(p);
        let x = clampX(w.x), y = clampY(w.y);
        if (!e.altKey) {
          // Snap: sejajar horizontal/vertikal dengan titik sebelum/sesudahnya -> sudut siku yang rapi.
          const full = [{ x: d.x, y: d.y }, ...pts, st.model.parentOf(d)];
          const tol = 10 / st.z;
          for (const n of [full[gesture.idx], full[gesture.idx + 2]]) {
            if (Math.abs(x - n.x) < tol) x = n.x;
            if (Math.abs(y - n.y) < tol) y = n.y;
          }
        }
        pts[gesture.idx] = { x, y };
        d.jalur = { m: 'bebas', p: pts.map(q => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10]) };
        st.dragging = true;
        svg.classList.add('dragging');
        layout();
      }
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (!gesture) return;
      const g = gesture;
      if (g.type === 'pinch') {
        if (pointers.size === 0) gesture = null;
        return;
      }
      gesture = null;
      st.dragging = false;
      svg.classList.remove('dragging');
      if (g.type === 'route') {
        const d = st.model.byId.get(g.id);
        if (g.moved && e.type !== 'pointercancel') {
          cb.onRoute(d.id, d.jalur);
        } else if (g.inserted || g.moved) {
          // Batal: kembalikan bentuk semula. (Klik biasa pada lekukan tidak menggambar ulang,
          // agar klik ganda untuk menghapusnya tetap mengenai elemen yang sama.)
          d.jalur = g.orig;
          layout();
        }
        return;
      }
      if (e.type === 'pointercancel') return;
      if (g.type === 'drag') {
        if (g.moved) {
          const d = st.model.byId.get(g.id);
          cb.onMove(d.id, d.x, d.y, g.ox, g.oy);
        } else {
          select(g.id, true);
        }
        return;
      }
      if (g.moved || g.middle) return;
      click(local(e), g.hit, e);
    }
    svg.addEventListener('pointerup', endPointer);
    svg.addEventListener('pointercancel', endPointer);
    svg.addEventListener('pointerleave', () => {
      if (!gesture) {
        st.cursor = null;
        drawTool();
      }
    });
    svg.addEventListener('contextmenu', e => {
      e.preventDefault();
      removeBend(e);
    });
    svg.addEventListener('dblclick', removeBend);

    /** Hapus satu lekukan (klik ganda / klik kanan pada kotak lekukan). */
    function removeBend(e) {
      const wp = e.target.closest && e.target.closest('.wp');
      const d = wp && routeDev();
      if (!d) return;
      const pts = st.model.routePts(d).slice(1, -1);
      pts.splice(+wp.dataset.i, 1);
      d.jalur = pts.length ? { m: 'bebas', p: pts.map(q => [q.x, q.y]) } : null;
      layout();
      cb.onRoute(d.id, d.jalur);
    }

    function click(p, hit, e) {
      const w = toWorld(p);
      const tool = st.tool;
      if (tool === 'pilih') {
        select(hit ? hit.id : null, true);
      } else if (tool === 'hubung') {
        if (!hit || hit.kind !== 'node') {
          st.linkSrc = null;
          applyClasses();
          drawTool();
          cb.onHint && cb.onHint();
          return;
        }
        if (st.linkSrc == null) {
          st.linkSrc = hit.id;
          select(hit.id, true);
        } else if (hit.id !== st.linkSrc) {
          const src = st.linkSrc;
          if (!e.shiftKey) st.linkSrc = null;
          cb.onLink(src, hit.id);
        }
        applyClasses();
        drawTool();
        cb.onHint && cb.onHint();
      } else if (tool === 'ukur') {
        let pt = w;
        if (hit && hit.kind === 'node') {
          const d = st.model.byId.get(hit.id);
          pt = { x: d.x, y: d.y };
        }
        st.measure = st.measure.length >= 2 ? [pt] : st.measure.concat([pt]);
        drawTool();
        cb.onMeasure && cb.onMeasure(st.measure.slice());
      } else if (tool.startsWith('tambah:')) {
        if (hit && hit.kind === 'node') {
          select(hit.id, true);
          return;
        }
        cb.onPlace(tool.slice(7), clampX(w.x), clampY(w.y));
      }
    }

    const clampX = x => Math.max(0, Math.min(st.W, x));
    const clampY = y => Math.max(0, Math.min(st.H, y));

    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const p = local(e);
      // Touchpad (ctrlKey = pinch) & mouse wheel.
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(f, p.x, p.y);
    }, { passive: false });

    // Ukuran berubah (rotasi layar, panel dibuka): bila pengguna belum zoom/pan, sesuaikan ulang ke seluruh denah;
    // bila sudah, pertahankan titik tengah tampilan.
    let lastSize = null;
    new ResizeObserver(() => {
      const r = svg.getBoundingClientRect();
      if (!st.fitted || !st.userView) fit();
      else {
        if (lastSize) {
          st.tx += (r.width - lastSize.w) / 2;
          st.ty += (r.height - lastSize.h) / 2;
        }
        layout();
      }
      lastSize = { w: r.width, h: r.height };
    }).observe(svg);

    // ------------------------------------------------------------------ API publik

    function select(id, fromUser) {
      st.sel = id;
      applyClasses();
      buildCoverage();
      if (fromUser) cb.onSelect(id);
    }

    function setTool(tool) {
      st.tool = tool;
      st.measure = [];
      if (tool !== 'hubung') st.linkSrc = null;
      else if (st.sel != null) st.linkSrc = st.sel;
      applyClasses();
      drawTool();
    }

    function setLayer(k, v) {
      st.layers[k] = v;
      buildCoverage();
      applyClasses();
      layout();
    }

    function setHidden(set) {
      st.hidden = set;
      buildCoverage();
      applyClasses();
    }

    return {
      setData, select, setTool, setLayer, setHidden, fit, zoomBy, centerOn, flash,
      setEditable(v) { st.canEdit = v; applyClasses(); },
      setOpacity(v) {
        st.opacity = v;
        const img = gBg.querySelector('.denah-img');
        if (img) img.setAttribute('opacity', v);
      },
      get opacity() { return st.opacity; },
      setInset(px) { st.inset = px || 0; },
      ensureVisible,
      get tool() { return st.tool; },
      get linkSrc() { return st.linkSrc; },
      get layers() { return st.layers; },
      get measure() { return st.measure; },
      clearMeasure() { st.measure = []; drawTool(); },
      refresh() { build(); layout(); },
      size() { return { W: st.W, H: st.H }; },
      viewCenter() {
        const r = svg.getBoundingClientRect();
        return { x: clampX((r.width / 2 - st.tx) / st.z), y: clampY((r.height / 2 - st.ty) / st.z) };
      },
    };
  }

  function el(name, attrs) {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  NP.Peta = Peta;
})();
