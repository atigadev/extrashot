/* Helper bersama halaman Live Vote. */
(function () {
  'use strict';

  const BAR_COLORS = ['#5b3df5', '#f04f6b', '#11a683', '#f59e0b', '#2f80ed', '#c047e0', '#0fb5c9', '#ef7d22', '#7a8a1e', '#e0479e'];

  /** Panggil API; lempar Error berisi pesan server bila gagal. */
  async function api(url, body) {
    const opt = { credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined) {
      opt.method = 'POST';
      opt.headers = { 'Content-Type': 'application/json', 'X-LV': '1' };
      opt.body = JSON.stringify(body);
    }
    let res, data;
    try {
      res = await fetch(url, opt);
      data = await res.json();
    } catch (e) {
      const err = new Error('Tidak bisa terhubung ke server');
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
    toastTimer = setTimeout(() => el.classList.remove('show'), isErr ? 4000 : 2200);
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

  /** QR code sebagai SVG (vendor/qrcode.min.js, offline). */
  function qrSvg(text, dark, light) {
    if (typeof qrcode !== 'function') return '';
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges">` +
      `<rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="${light || '#fff'}"/>` +
      `<path d="${path}" fill="${dark || '#000'}"/></svg>`;
  }

  /** URL folder aplikasi (tempat index.html/vote.html/layar.html berada). */
  function baseUrl() {
    return location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  }

  function voteUrl(kode, token) {
    return baseUrl() + 'vote.html?k=' + encodeURIComponent(kode) + (token ? '&t=' + encodeURIComponent(token) : '');
  }

  /** Bar hasil sederhana (admin & pemilih). */
  function renderBars(el, hasil, mine) {
    const total = hasil.total || 0;
    const sig = hasil.pilihan.map(p => p.id + ':' + p.label).join('|') + '#' + mine;
    // Struktur sama dengan sebelumnya: cukup perbarui angka & lebar agar bar beranimasi mulus.
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = hasil.pilihan.map((p, i) => `<div class="bar-row${p.id === mine ? ' mine' : ''}">
          <div class="bar-head"><span>${esc(p.label)}</span><b></b></div>
          <div class="bar-track"><div class="bar-fill" style="background:${BAR_COLORS[i % BAR_COLORS.length]}"></div></div>
        </div>`).join('');
    }
    const rows = el.querySelectorAll('.bar-row');
    requestAnimationFrame(() => hasil.pilihan.forEach((p, i) => {
      const pct = total ? Math.round(p.jumlah * 1000 / total) / 10 : 0;
      rows[i].querySelector('b').textContent = p.jumlah + ' · ' + pct + '%';
      rows[i].querySelector('.bar-fill').style.width = pct + '%';
    }));
  }

  window.LV = { api, esc, toast, copy, qrSvg, baseUrl, voteUrl, renderBars, BAR_COLORS };
})();
