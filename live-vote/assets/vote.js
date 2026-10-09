/* Halaman pemilih: tampilkan pertanyaan, kirim satu suara, lalu tampilkan status/hasil. */
(function () {
  'use strict';
  const { api, esc, toast, renderBars } = window.LV;
  const API = 'api/vote.php';
  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  const kode = (params.get('k') || '').trim();
  const token = (params.get('t') || '').trim();

  // Cadangan kunci perangkat (mode link terbuka) bila cookie terhapus.
  function getVk() {
    try { return localStorage.getItem('lv_vk') || ''; } catch (e) { return ''; }
  }
  function setVk(vk) {
    try { if (vk) localStorage.setItem('lv_vk', vk); } catch (e) { /* mode privat */ }
  }

  let data = null;
  let pollTimer = null;
  let rendered = '';  // penanda tampilan saat ini agar polling tidak menghapus pilihan yang sedang dipilih

  function query() {
    return API + '?k=' + encodeURIComponent(kode) + '&t=' + encodeURIComponent(token) + '&vk=' + encodeURIComponent(getVk());
  }

  async function load() {
    try {
      data = await api(query());
      setVk(data.vk);
      document.title = data.sesi.judul + ' — Live Vote';
      render();
    } catch (ex) {
      if (ex.network && data) return; // koneksi putus sesaat: biarkan tampilan terakhir
      stopPoll();
      if (ex.data && ex.data.reason === 'not_found') return renderCodeForm(ex.message);
      showState('⚠️', 'Tidak bisa membuka voting', ex.message);
    }
  }

  function stopPoll() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function header() {
    return `<h1>${esc(data.sesi.judul)}</h1><h2>${esc(data.sesi.pertanyaan)}</h2>` +
      (data.pemilih ? `<div class="voter-name">Memilih sebagai <b>${esc(data.pemilih)}</b></div>` : '');
  }

  function showState(icon, title, text, extra) {
    rendered = 'state:' + title;
    app.innerHTML = (data ? header() : '') +
      `<div class="card state"><div class="icon">${icon}</div><h3>${esc(title)}</h3><p>${esc(text || '')}</p>${extra || ''}</div>`;
  }

  function render() {
    const s = data.sesi;

    if (data.sudah) {
      const mine = data.pilihan.find(p => p.id === data.pilihan_saya);
      const key = 'voted:' + (data.hasil ? 'h' : '');
      if (rendered !== key) {
        rendered = key;
        app.innerHTML = header() + `
          <div class="card state">
            <div class="icon">✅</div>
            <h3>Terima kasih, suara Anda tercatat</h3>
            <p>Pilihan Anda: <b>${esc(mine ? mine.label : '-')}</b></p>
            <p style="margin-top:6px">Setiap pemilih hanya bisa memilih satu kali pada sesi ini.</p>
          </div>
          ${data.hasil ? `<section class="card"><h2>Hasil sementara <span class="spacer"></span><span class="muted" id="v-total"></span></h2><div class="bars" id="v-bars"></div></section>` : ''}`;
      }
      if (data.hasil) {
        renderBars(document.getElementById('v-bars'), data.hasil, data.pilihan_saya);
        document.getElementById('v-total').textContent = data.hasil.total + ' suara';
      }
      // Pantau hasil hanya bila ditampilkan & voting masih berjalan.
      if (data.hasil && s.status === 'dibuka') ensurePoll(3000); else stopPoll();
      return;
    }

    if (s.status === 'draf') {
      showState('⏳', 'Voting belum dibuka', 'Halaman ini akan terbuka otomatis saat voting dimulai.');
      return ensurePoll(3000);
    }

    if (s.status === 'ditutup') {
      showState('🔒', 'Voting sudah ditutup', 'Terima kasih atas partisipasinya.',
        data.hasil ? '<div class="bars" id="v-bars" style="margin-top:18px;text-align:left"></div>' : '');
      if (data.hasil) renderBars(document.getElementById('v-bars'), data.hasil);
      return ensurePoll(5000); // admin bisa membuka lagi
    }

    // Dibuka & belum memilih: tampilkan formulir (sekali saja, agar pilihan tidak hilang saat polling).
    if (rendered === 'form') return;
    rendered = 'form';
    app.innerHTML = header() + `
      <form id="vote-form">
        <div class="choices" role="radiogroup">
          ${data.pilihan.map(p => `
            <label class="choice"><input type="radio" name="pilihan" value="${p.id}" required>
              <span class="mark"></span><span>${esc(p.label)}</span></label>`).join('')}
        </div>
        ${!data.pemilih && s.minta_nama ? `
          <label class="field"><span>Nama Anda</span>
            <input type="text" name="nama" maxlength="150" required autocomplete="name"></label>` : ''}
        <button type="submit" class="primary big">Kirim suara</button>
        <p class="muted" style="text-align:center;font-size:13px;margin-top:10px">Suara hanya bisa dikirim satu kali dan tidak bisa diubah.</p>
      </form>`;
    // Saat formulir terbuka, cukup pantau bila voting ditutup admin.
    ensurePoll(5000);

    document.getElementById('vote-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      const chosen = f.pilihan.value;
      if (!chosen) return toast('Pilih salah satu dulu', true);
      const label = data.pilihan.find(p => String(p.id) === chosen).label;
      if (!confirm(`Kirim suara untuk "${label}"?\nSuara tidak bisa diubah setelah dikirim.`)) return;
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Mengirim…';
      try {
        data = await api(API, { k: kode, t: token, vk: getVk(), pilihan_id: +chosen, nama: f.nama ? f.nama.value : '' });
        setVk(data.vk);
        render();
      } catch (ex) {
        btn.disabled = false;
        btn.textContent = 'Kirim suara';
        toast(ex.message, true);
        if (ex.data && (ex.data.reason === 'voted' || ex.data.reason === 'closed')) {
          rendered = '';
          load();
        }
      }
    });
  }

  let pollMs = 0;
  function ensurePoll(ms) {
    if (pollTimer && pollMs === ms) return;
    stopPoll();
    pollMs = ms;
    pollTimer = setInterval(() => { if (!document.hidden) load(); }, ms);
  }

  function renderCodeForm(err) {
    rendered = 'code';
    app.innerHTML = `
      <h2>Masukkan kode voting</h2>
      <form class="code-form" id="code-form">
        <input type="text" name="k" maxlength="12" required autocomplete="off" autocapitalize="characters" placeholder="ABC123" value="${esc(kode)}">
        <button type="submit" class="primary">Masuk</button>
      </form>
      ${err ? `<p style="color:var(--danger)">${esc(err)}</p>` : '<p class="muted">Kode ditampilkan di layar presentasi.</p>'}`;
    document.getElementById('code-form').addEventListener('submit', e => {
      e.preventDefault();
      location.search = '?k=' + encodeURIComponent(e.target.k.value.trim().toUpperCase());
    });
  }

  if (!kode) renderCodeForm(); else load();
})();
