/* Halaman admin Live Vote: kelola sesi, pilihan, pemilih, dan pantau hasil. */
(function () {
  'use strict';
  const { api, esc, toast, copy, qrSvg, baseUrl, voteUrl, renderBars } = window.LV;
  const API = 'api/admin.php';
  const STATUS_LABEL = { draf: 'Draf', dibuka: 'Sedang dibuka', ditutup: 'Ditutup' };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const listEl = $('#list');
  const mainEl = $('#main');

  let sessions = [];
  let current = null;   // detail sesi yang sedang dibuka
  let pollTimer = null;

  // ---------- Login ----------
  function showLogin() {
    stopPoll();
    $('#login').hidden = false;
    $('#login-pass').focus();
  }

  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#login-err');
    err.hidden = true;
    try {
      await api(API, { action: 'login', password: $('#login-pass').value });
      $('#login').hidden = true;
      $('#login-pass').value = '';
      await loadList();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    await api(API, { action: 'logout' }).catch(() => {});
    current = null;
    mainEl.innerHTML = '<p class="placeholder">Anda sudah keluar.</p>';
    listEl.innerHTML = '';
    showLogin();
  });

  /** Jalankan aksi admin; tangani sesi login habis & tampilkan pesan error. */
  async function run(fn) {
    try {
      return await fn();
    } catch (ex) {
      if (ex.status === 401) showLogin();
      else toast(ex.message, true);
      throw ex;
    }
  }

  // ---------- Daftar sesi ----------
  async function loadList() {
    const res = await run(() => api(API + '?action=list'));
    sessions = res.data;
    renderList();
  }

  function renderList() {
    if (!sessions.length) {
      listEl.innerHTML = '<p class="empty">Belum ada sesi.<br>Klik <b>+ Sesi baru</b>.</p>';
      return;
    }
    listEl.innerHTML = sessions.map(s => `
      <button type="button" class="sesi-item${current && current.id === s.id ? ' active' : ''}" data-id="${s.id}">
        <span class="t">${esc(s.judul)}</span>
        <span class="m"><span class="badge ${s.status}">${STATUS_LABEL[s.status]}</span>
          <span class="mono">${esc(s.kode)}</span> · ${s.total} suara</span>
      </button>`).join('');
  }

  listEl.addEventListener('click', e => {
    const b = e.target.closest('.sesi-item');
    if (b) openSesi(+b.dataset.id);
  });

  function updateListItem(d) {
    const s = sessions.find(x => x.id === d.id);
    if (s) {
      Object.assign(s, { judul: d.judul, status: d.status, total: d.total, kode: d.kode });
      renderList();
    }
  }

  // ---------- Detail sesi ----------
  async function openSesi(id) {
    stopPoll();
    const res = await run(() => api(API + '?action=get&id=' + id));
    current = res.data;
    renderDetail();
    renderList();
    startPoll();
  }

  function stopPoll() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(async () => {
      if (!current || document.hidden) return;
      try {
        const res = await api(API + '?action=get&id=' + current.id);
        if (current && res.data.id === current.id) {
          current = res.data;
          updateDetail();
        }
      } catch (ex) {
        if (ex.status === 401) showLogin();
      }
    }, 2500);
  }

  function layarUrl(d) {
    return baseUrl() + 'layar.html?k=' + d.kode_layar;
  }

  function renderDetail() {
    const d = current;
    const isInv = d.mode === 'undangan';
    mainEl.innerHTML = `
      <div class="detail-head">
        <div class="grow">
          <h2>${esc(d.judul)}</h2>
          <p>${esc(d.pertanyaan)}</p>
        </div>
        <div class="btn-row" id="status-actions"></div>
      </div>

      <div class="grid2">
        <section class="card">
          <h2>Bagikan</h2>
          ${isInv ? `
            <p class="muted" style="margin-top:0">Mode <b>link undangan</b>: kirim link pribadi dari daftar pemilih di bawah.
              Link umum tidak bisa dipakai untuk memilih.</p>` : `
            <div class="share">
              <div class="qr">${qrSvg(voteUrl(d.kode))}</div>
              <div>
                <div class="muted" style="font-size:13px">Kode voting</div>
                <div class="kode-big">${esc(d.kode)}</div>
                <div class="muted" style="font-size:13px;margin-top:4px">Pindai QR atau buka link di bawah.</div>
              </div>
            </div>
            <span class="link-label" style="margin-top:14px">Link voting (untuk peserta)</span>
            <div class="link-box">
              <input type="text" readonly value="${esc(voteUrl(d.kode))}">
              <button type="button" data-copy="${esc(voteUrl(d.kode))}">Salin</button>
              <a class="btn" href="${esc(voteUrl(d.kode))}" target="_blank" rel="noopener">Buka</a>
            </div>`}
          <span class="link-label" style="margin-top:14px">Link layar hasil (untuk proyektor — jangan dibagikan ke peserta)</span>
          <div class="link-box">
            <input type="text" readonly value="${esc(layarUrl(d))}">
            <button type="button" data-copy="${esc(layarUrl(d))}">Salin</button>
            <a class="btn primary" href="${esc(layarUrl(d))}" target="_blank" rel="noopener">Buka layar</a>
          </div>
        </section>

        <section class="card">
          <h2>Hasil live <span class="spacer"></span>
            <button type="button" class="small" id="btn-csv">Unduh CSV</button>
            <button type="button" class="small danger" id="btn-reset">Reset suara</button>
          </h2>
          <div class="total-line"><b id="total">0</b><span class="muted" id="total-note">suara masuk</span></div>
          <div class="bars" id="bars"></div>
        </section>
      </div>

      ${isInv ? `
      <section class="card" style="margin-top:16px">
        <h2>Daftar pemilih <span class="muted" id="inv-progress" style="font-weight:400"></span>
          <span class="spacer"></span>
          <button type="button" class="small" id="btn-copy-all">Salin semua link</button>
          <button type="button" class="small" id="btn-inv-csv">Unduh CSV</button>
        </h2>
        <label class="field">
          <span>Tambah pemilih — satu nama per baris (bisa tempel dari Excel)</span>
          <textarea id="inv-names" rows="3" placeholder="Budi Santoso&#10;Siti Aminah&#10;..."></textarea>
        </label>
        <div class="btn-row" style="margin-bottom:12px"><button type="button" class="primary small" id="btn-inv-add">Buat link</button></div>
        <div class="voters-wrap">
          <table class="voters">
            <thead><tr><th>#</th><th>Nama</th><th>Status</th><th></th></tr></thead>
            <tbody id="inv-body"></tbody>
          </table>
        </div>
      </section>` : ''}
    `;
    updateDetail();
  }

  /** Perbarui bagian yang berubah saat polling (tanpa mengganggu isian textarea). */
  function updateDetail() {
    const d = current;
    const acts = $('#status-actions');
    const st = `<span class="badge ${d.status}">${STATUS_LABEL[d.status]}</span>`;
    const key = d.status;
    if (acts.dataset.key !== key) {
      acts.dataset.key = key;
      acts.innerHTML = st +
        (d.status === 'dibuka'
          ? '<button type="button" class="warn" data-status="ditutup">Tutup voting</button>'
          : `<button type="button" class="ok" data-status="dibuka">${d.status === 'ditutup' ? 'Buka lagi' : 'Buka voting'}</button>`) +
        '<button type="button" id="btn-edit">Ubah</button>' +
        '<button type="button" id="btn-dup">Duplikat</button>' +
        '<button type="button" class="danger" id="btn-del">Hapus</button>';
    }

    $('#total').textContent = d.total;
    const inv = d.mode === 'undangan';
    const sudah = d.pemilih.filter(p => p.memilih_at).length;
    $('#total-note').textContent = inv ? `suara masuk dari ${d.pemilih.length} pemilih terdaftar` : 'suara masuk';
    renderBars($('#bars'), d);
    updateListItem(d);

    if (inv) {
      $('#inv-progress').textContent = `— ${sudah} dari ${d.pemilih.length} sudah memilih`;
      const body = $('#inv-body');
      const sig = d.pemilih.map(p => p.id + (p.memilih_at ? 'v' : '')).join(',');
      if (body.dataset.sig !== sig) {
        body.dataset.sig = sig;
        body.innerHTML = d.pemilih.length ? d.pemilih.map((p, i) => `
          <tr>
            <td class="muted">${i + 1}</td>
            <td>${esc(p.nama)}</td>
            <td>${p.memilih_at ? '<span class="badge dibuka" style="animation:none">Sudah memilih</span>' : '<span class="badge">Belum</span>'}</td>
            <td>
              <button type="button" class="small" data-copy="${esc(voteUrl(d.kode, p.token))}">Salin link</button>
              ${p.memilih_at ? '' : `<button type="button" class="small danger" data-del-voter="${p.id}" title="Hapus pemilih">✕</button>`}
            </td>
          </tr>`).join('') : '<tr><td colspan="4" class="muted">Belum ada pemilih. Tambahkan nama di atas.</td></tr>';
      }
    }
  }

  mainEl.addEventListener('click', async e => {
    const t = e.target.closest('button, a');
    if (!t || !current) return;
    const d = current;

    if (t.dataset.copy) return copy(t.dataset.copy);

    if (t.dataset.status) {
      const next = t.dataset.status;
      if (next === 'ditutup' && !confirm('Tutup voting? Pemilih tidak bisa memilih lagi.')) return;
      const res = await run(() => api(API, { action: 'status', id: d.id, status: next }));
      current = res.data;
      updateDetail();
      toast(next === 'dibuka' ? 'Voting dibuka' : 'Voting ditutup');
      return;
    }

    switch (t.id) {
      case 'btn-edit':
        return showForm(d);
      case 'btn-dup': {
        const res = await run(() => api(API, { action: 'duplicate', id: d.id }));
        await loadList();
        toast('Sesi diduplikat');
        return openSesi(res.data.id);
      }
      case 'btn-del':
        if (!confirm(`Hapus sesi "${d.judul}" beserta semua suaranya? Tindakan ini tidak bisa dibatalkan.`)) return;
        await run(() => api(API, { action: 'delete', id: d.id }));
        current = null;
        stopPoll();
        mainEl.innerHTML = '<p class="placeholder">Sesi dihapus.</p>';
        toast('Sesi dihapus');
        return loadList();
      case 'btn-reset': {
        if (!d.total) return toast('Belum ada suara');
        if (!confirm(`Hapus ${d.total} suara yang sudah masuk? Semua pemilih bisa memilih lagi.`)) return;
        const res = await run(() => api(API, { action: 'reset', id: d.id }));
        current = res.data;
        updateDetail();
        return toast('Suara direset');
      }
      case 'btn-csv': {
        const res = await run(() => api(API + '?action=suara&id=' + d.id));
        const rows = [['Pilihan', 'Jumlah suara', 'Persen']].concat(d.pilihan.map(p =>
          [p.label, p.jumlah, d.total ? (p.jumlah * 100 / d.total).toFixed(1) + '%' : '0%']));
        rows.push([], ['Waktu', 'Nama', 'Pilihan', 'IP']);
        res.data.forEach(v => rows.push([v.waktu, v.nama || '', v.pilihan, v.ip || '']));
        return downloadCsv(rows, `hasil-${d.kode}.csv`);
      }
      case 'btn-inv-add': {
        const names = $('#inv-names').value.split(/\r?\n/).map(s => s.split('\t')[0].trim()).filter(Boolean);
        if (!names.length) return toast('Isi minimal satu nama', true);
        const res = await run(() => api(API, { action: 'pemilih_add', id: d.id, nama: names }));
        $('#inv-names').value = '';
        current = res.data;
        updateDetail();
        return toast(names.length + ' link pemilih dibuat');
      }
      case 'btn-copy-all':
        if (!d.pemilih.length) return toast('Belum ada pemilih');
        return copy(d.pemilih.map(p => `${p.nama}\t${voteUrl(d.kode, p.token)}`).join('\n'));
      case 'btn-inv-csv':
        return downloadCsv([['Nama', 'Link voting', 'Status', 'Waktu memilih']].concat(d.pemilih.map(p =>
          [p.nama, voteUrl(d.kode, p.token), p.memilih_at ? 'Sudah memilih' : 'Belum', p.memilih_at || ''])), `pemilih-${d.kode}.csv`);
    }

    if (t.dataset.delVoter) {
      if (!confirm('Hapus pemilih ini? Link pribadinya tidak bisa dipakai lagi.')) return;
      const res = await run(() => api(API, { action: 'pemilih_delete', id: d.id, pemilih_id: +t.dataset.delVoter }));
      current = res.data;
      updateDetail();
    }
  });

  function downloadCsv(rows, filename) {
    const csv = rows.map(r => r.map(v => {
      const s = String(v == null ? '' : v);
      return /[";,\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';')).join('\r\n');
    // BOM + pemisah ";" agar langsung rapi saat dibuka di Excel versi Indonesia.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Form buat / ubah sesi ----------
  $('#btn-new').addEventListener('click', () => showForm(null));

  function showForm(d) {
    stopPoll();
    mainEl.innerHTML = '';
    mainEl.appendChild($('#tpl-form').content.cloneNode(true));
    const f = $('#sesi-form');
    const optList = $('#opt-list');
    $('#form-title').textContent = d ? 'Ubah sesi' : 'Sesi baru';

    if (d) {
      f.judul.value = d.judul;
      f.pertanyaan.value = d.pertanyaan;
      f.mode.value = d.mode;
      f.minta_nama.checked = !!d.minta_nama;
      f.hasil_pemilih.checked = !!d.hasil_pemilih;
      d.pilihan.forEach(p => addOpt(p.label, p.id));
    } else {
      addOpt('');
      addOpt('');
    }
    syncMode();
    f.judul.focus();

    function addOpt(label, id) {
      const row = document.createElement('div');
      row.className = 'opt-item';
      if (id) row.dataset.id = id;
      row.innerHTML = `<span class="num"></span>
        <input type="text" maxlength="200" placeholder="Teks pilihan" value="${esc(label)}">
        <button type="button" data-mv="-1" title="Naik">↑</button>
        <button type="button" data-mv="1" title="Turun">↓</button>
        <button type="button" class="danger" data-rm title="Hapus">✕</button>`;
      optList.appendChild(row);
      renumber();
      return row;
    }

    function renumber() {
      optList.querySelectorAll('.num').forEach((n, i) => { n.textContent = (i + 1) + '.'; });
    }

    function syncMode() {
      $('#row-nama').hidden = f.mode.value === 'undangan';
    }

    f.addEventListener('change', e => { if (e.target.name === 'mode') syncMode(); });

    optList.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const row = b.closest('.opt-item');
      if (b.hasAttribute('data-rm')) {
        row.remove();
      } else if (b.dataset.mv === '-1' && row.previousElementSibling) {
        optList.insertBefore(row, row.previousElementSibling);
      } else if (b.dataset.mv === '1' && row.nextElementSibling) {
        optList.insertBefore(row.nextElementSibling, row);
      }
      renumber();
    });

    // Enter di kotak pilihan terakhir = tambah pilihan baru.
    optList.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        const row = e.target.closest('.opt-item');
        const next = row.nextElementSibling ? row.nextElementSibling.querySelector('input') : addOpt('').querySelector('input');
        next.focus();
      }
    });

    $('#opt-add').addEventListener('click', () => addOpt('').querySelector('input').focus());

    $('#opt-paste').addEventListener('click', () => {
      const text = prompt('Tempel daftar pilihan, pisahkan dengan baris baru atau tanda ";"');
      if (!text) return;
      // Isi kotak kosong lebih dulu, sisanya ditambahkan.
      const items = text.split(/\r?\n|;/).map(s => s.trim()).filter(Boolean);
      const empty = [...optList.querySelectorAll('input')].filter(i => !i.value.trim());
      items.forEach(label => {
        const inp = empty.shift();
        if (inp) inp.value = label; else addOpt(label);
      });
    });

    $('#form-cancel').addEventListener('click', () => {
      if (d) openSesi(d.id);
      else mainEl.innerHTML = '<p class="placeholder">Pilih sesi di kiri, atau buat <b>Sesi baru</b>.</p>';
    });

    f.addEventListener('submit', async e => {
      e.preventDefault();
      const pilihan = [...optList.querySelectorAll('.opt-item')]
        .map(r => ({ id: +r.dataset.id || 0, label: r.querySelector('input').value.trim() }))
        .filter(p => p.label);
      if (pilihan.length < 2) return toast('Isi minimal 2 pilihan', true);
      const body = {
        action: 'save',
        id: d ? d.id : 0,
        judul: f.judul.value,
        pertanyaan: f.pertanyaan.value,
        mode: f.mode.value,
        minta_nama: f.minta_nama.checked,
        hasil_pemilih: f.hasil_pemilih.checked,
        pilihan,
      };
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const res = await run(() => api(API, body));
        toast('Sesi disimpan');
        await loadList();
        await openSesi(res.data.id);
      } catch (ex) {
        btn.disabled = false;
      }
    });
  }

  // ---------- Mulai ----------
  (async function init() {
    try {
      const me = await api(API + '?action=me');
      if (!me.login) return showLogin();
      await loadList();
      if (sessions.length) openSesi(sessions[0].id);
    } catch (ex) {
      mainEl.innerHTML = `<p class="placeholder" style="color:var(--danger)">${esc(ex.message)}</p>`;
    }
  })();
})();
