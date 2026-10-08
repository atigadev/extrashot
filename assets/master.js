/* Halaman master toko & ekspedisi. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var data = { toko: [], ekspedisi: [] };
  var editing = null; // { type, row }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function api(url, opt) {
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { throw new Error('Respon server tidak valid (HTTP ' + r.status + ')'); });
    }).then(function (j) {
      if (!j.ok) throw new Error(j.error || 'Gagal');
      return j;
    });
  }

  function load(type) {
    return api('api/master.php?type=' + type).then(function (j) {
      data[type] = j.data;
      render(type);
    }).catch(function (e) {
      section(type).querySelector('.master-list').innerHTML = '<p class="error">' + esc(e.message) + '</p>';
    });
  }

  function section(type) { return document.querySelector('.master[data-type="' + type + '"]'); }

  function render(type) {
    var list = section(type).querySelector('.master-list');
    if (!data[type].length) {
      list.innerHTML = '<p class="empty">Belum ada data.</p>';
      return;
    }
    list.innerHTML = data[type].map(function (r) {
      var sub = type === 'toko'
        ? esc([r.pengirim_nama, r.pengirim_telepon].filter(Boolean).join(' · ')) + (r.pengirim_alamat ? '<br>' + esc(r.pengirim_alamat) : '')
        : (r.layanan_default ? 'Layanan: ' + esc(r.layanan_default) : '');
      return '<div class="master-item' + (r.aktif ? '' : ' inactive') + '">' +
        '<div class="logo-box sm">' + (r.logo_url ? '<img src="' + esc(r.logo_url) + '" alt="">' : '<span>—</span>') + '</div>' +
        '<div class="master-info"><b>' + esc(r.nama) + '</b>' + (r.aktif ? '' : ' <em>(nonaktif)</em>') +
        '<div class="hint">' + sub + '</div></div>' +
        '<div class="master-act"><button type="button" data-edit="' + r.id + '">Ubah</button>' +
        '<button type="button" class="danger" data-del="' + r.id + '">Hapus</button></div></div>';
    }).join('');
  }

  function openForm(type, row) {
    editing = { type: type, row: row || null };
    var f = $('frm');
    f.reset();
    $('frm-error').textContent = '';
    $('dlg-title').textContent = (row ? 'Ubah ' : 'Tambah ') + type;
    f.querySelector('.only-toko').hidden = type !== 'toko';
    f.querySelector('.only-ekspedisi').hidden = type !== 'ekspedisi';
    ['id', 'nama', 'pengirim_nama', 'pengirim_alamat', 'pengirim_telepon', 'layanan_default'].forEach(function (k) {
      f.elements[k].value = row && row[k] != null ? row[k] : '';
    });
    f.elements.aktif.checked = row ? !!row.aktif : true;
    showLogo(row && row.logo_url);
    $('lbl-hapus-logo').hidden = !(row && row.logo_url);
    $('dlg').showModal();
    f.elements.nama.focus();
  }

  function showLogo(url) {
    $('logo-preview').hidden = !url;
    $('logo-empty').hidden = !!url;
    if (url) $('logo-preview').src = url;
    else $('logo-preview').removeAttribute('src');
  }

  document.addEventListener('click', function (e) {
    var sec = e.target.closest('.master');
    if (!sec) return;
    var type = sec.getAttribute('data-type');
    if (e.target.classList.contains('btn-add')) openForm(type);
    var id = e.target.getAttribute('data-edit');
    if (id) openForm(type, data[type].filter(function (r) { return r.id === +id; })[0]);
    id = e.target.getAttribute('data-del');
    if (id) {
      var row = data[type].filter(function (r) { return r.id === +id; })[0];
      if (!confirm('Hapus ' + type + ' "' + row.nama + '"?\nLabel pengiriman yang memakai data ini tetap ada, tetapi tanpa ' + type + '.')) return;
      var fd = new FormData();
      fd.append('id', id);
      api('api/master.php?type=' + type + '&action=delete', { method: 'POST', body: fd })
        .then(function () { load(type); })
        .catch(function (err) { alert(err.message); });
    }
  });

  $('inp-logo').addEventListener('change', function () {
    var file = this.files[0];
    if (!file) { showLogo(editing && editing.row && editing.row.logo_url); return; }
    if (file.size > 1024 * 1024) {
      $('frm-error').textContent = 'Ukuran logo maksimal 1 MB.';
      this.value = '';
      return;
    }
    showLogo(URL.createObjectURL(file));
  });

  $('btn-cancel').addEventListener('click', function () { $('dlg').close(); });

  $('frm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = this, type = editing.type;
    var fd = new FormData(f);
    if (!f.elements.aktif.checked) fd.set('aktif', '0');
    $('btn-save').disabled = true;
    api('api/master.php?type=' + type, { method: 'POST', body: fd })
      .then(function () { $('dlg').close(); return load(type); })
      .catch(function (err) { $('frm-error').textContent = err.message; })
      .then(function () { $('btn-save').disabled = false; });
  });

  load('toko');
  load('ekspedisi');
})();
