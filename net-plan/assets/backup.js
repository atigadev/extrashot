/*
 * Backup & pulihkan event Net Plan ke/dari satu file (.netplan.json).
 *
 * Isi file: info event, gambar denah (base64), skala, semua perangkat (koneksi, port, jalur kabel, konfigurasi),
 * serta katalog & tipe endpoint yang dibutuhkan. Saat dipulihkan, setiap event dibuat sebagai event BARU
 * (data yang ada tidak ditimpa); katalog & tipe endpoint dicocokkan dengan yang sudah ada, atau dibuat bila belum ada.
 */
(function () {
  'use strict';
  const { api, toast, downloadBlob, slug } = NP;
  const API = 'api/admin.php';
  const FORMAT = 'net-plan-backup';
  const VERSI = 1;

  // ------------------------------------------------------------------------ buat backup

  function blobKeDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Gagal membaca gambar denah'));
      r.readAsDataURL(blob);
    });
  }

  /** Data satu event lengkap dengan gambar denah. */
  async function ambilEvent(id) {
    const res = await api(API + '?action=get&id=' + id);
    const p = res.proyek;
    let denah = null;
    if (p.denah_v) {
      const r = await fetch(`api/denah.php?id=${p.id}&v=${p.denah_v}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`Gambar denah "${p.nama}" tidak bisa diambil`);
      denah = await blobKeDataUrl(await r.blob());
    }
    return {
      proyek: {
        nama: p.nama, venue: p.venue, tanggal_mulai: p.tanggal_mulai, tanggal_selesai: p.tanggal_selesai, catatan: p.catatan,
        skala: p.skala, slack_kabel: p.slack_kabel, denah_w: p.denah_w, denah_h: p.denah_h,
      },
      denah,
      perangkat: res.perangkat.map(d => {
        const o = Object.assign({}, d);
        delete o.proyek_id; delete o.created_at; delete o.updated_at;
        return o;
      }),
      katalog: res.katalog || [],
      endpoint_tipe: res.endpoint_tipe || [],
    };
  }

  /**
   * Unduh file backup. ids = daftar id event; lengkap = true menyertakan seluruh katalog & tipe endpoint
   * (bukan hanya yang dipakai event tersebut).
   */
  async function buat(ids, namaFile, lengkap) {
    toast(`Menyiapkan backup ${ids.length} event…`);
    const acara = [];
    for (const id of ids) acara.push(await ambilEvent(id));
    // Katalog & tipe endpoint: gabungan yang dipakai, atau seluruhnya bila lengkap.
    let katalog, tipe;
    if (lengkap) {
      katalog = (await api(API + '?action=katalog_list')).katalog;
      tipe = (await api(API + '?action=endpoint_tipe_list')).endpoint_tipe;
    } else {
      const k = new Map(), t = new Map();
      acara.forEach(a => {
        a.katalog.forEach(x => k.set(x.id, x));
        a.endpoint_tipe.forEach(x => t.set(x.id, x));
      });
      katalog = [...k.values()];
      tipe = [...t.values()];
    }
    acara.forEach(a => { delete a.katalog; delete a.endpoint_tipe; });
    const data = {
      format: FORMAT, versi: VERSI, dibuat: new Date().toISOString(),
      katalog: katalog.map(k => {
        const o = Object.assign({}, k);
        delete o.created_at; delete o.updated_at; delete o.dipakai; delete o.dipakai_event;
        return o;
      }),
      endpoint_tipe: tipe.map(t => ({ id: t.id, nama: t.nama, singkatan: t.singkatan, ikon: t.ikon, warna: t.warna, prefix: t.prefix })),
      acara,
    };
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
    downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${namaFile}-${stamp}.netplan.json`);
    toast('Backup tersimpan');
  }

  // ------------------------------------------------------------------------ pulihkan

  /** Cocokkan tipe endpoint backup dengan yang ada (berdasarkan nama), buat bila belum ada. Hasil: Map idLama -> idBaru. */
  async function petaTipe(tipeBackup) {
    const map = new Map();
    if (!tipeBackup.length) return map;
    let ada = (await api(API + '?action=endpoint_tipe_list')).endpoint_tipe;
    for (const t of tipeBackup) {
      let cocok = ada.find(x => x.nama.toLowerCase() === String(t.nama).toLowerCase());
      if (!cocok) {
        ada = (await api(API, { action: 'endpoint_tipe_save', nama: t.nama, singkatan: t.singkatan, ikon: t.ikon, warna: t.warna, prefix: t.prefix })).endpoint_tipe;
        cocok = ada.find(x => x.nama.toLowerCase() === String(t.nama).toLowerCase());
      }
      if (cocok) map.set(String(t.id), String(cocok.id));
    }
    return map;
  }

  /** Cocokkan katalog backup (kategori + merek + tipe), buat bila belum ada. Hasil: Map idLama -> idBaru. */
  async function petaKatalog(katBackup) {
    const map = new Map();
    if (!katBackup.length) return map;
    const kunci = k => [k.jenis, (k.merek || '').trim().toLowerCase(), (k.model || '').trim().toLowerCase()].join('|');
    const ada = new Map((await api(API + '?action=katalog_list')).katalog.map(k => [kunci(k), k.id]));
    for (const k of katBackup) {
      let id = ada.get(kunci(k));
      if (!id) {
        const res = await api(API, {
          action: 'katalog_save', jenis: k.jenis, merek: k.merek, model: k.model, stok: k.stok, spesifikasi: k.spesifikasi,
          konfigurasi: k.konfigurasi, bandwidth_mbps: k.bandwidth_mbps, catatan_konfig: k.catatan_konfig, keterangan: k.keterangan,
        });
        id = res.katalog.id;
        ada.set(kunci(k), id);
      }
      map.set(k.id, id);
    }
    return map;
  }

  /** Ubah tipe endpoint di konfigurasi standar katalog sebelum katalog dibuat. */
  function remapKonfigKatalog(katalog, tipeMap) {
    return katalog.map(k => {
      const c = Object.assign({}, k.konfigurasi);
      if (c.tipe_endpoint != null && tipeMap.has(String(c.tipe_endpoint))) c.tipe_endpoint = tipeMap.get(String(c.tipe_endpoint));
      return Object.assign({}, k, { konfigurasi: c });
    });
  }

  async function dataUrlKeFile(dataUrl, nama) {
    const blob = await (await fetch(dataUrl)).blob();
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[blob.type] || 'png';
    return new File([blob], `${slug(nama)}.${ext}`, { type: blob.type });
  }

  /** Pulihkan satu event sebagai event baru. Bila gagal di tengah jalan, event yang baru dibuat dihapus lagi. */
  async function pulihkanEvent(a, tipeMap, katMap, namaTerpakai) {
    const p = a.proyek || {};
    let nama = String(p.nama || 'Event dipulihkan').slice(0, 138);
    if (namaTerpakai.has(nama.toLowerCase())) nama += ' (pulihan)';
    namaTerpakai.add(nama.toLowerCase());
    const baru = (await api(API, {
      action: 'proyek_save', nama, venue: p.venue || '', tanggal_mulai: p.tanggal_mulai || '', tanggal_selesai: p.tanggal_selesai || '',
      catatan: p.catatan || '', slack_kabel: p.slack_kabel == null ? 20 : p.slack_kabel,
    })).proyek;
    try {
      if (a.denah) {
        const fd = new FormData();
        fd.append('action', 'denah_upload');
        fd.append('id', baru.id);
        fd.append('sesuaikan', '0');
        fd.append('denah', await dataUrlKeFile(a.denah, nama));
        await api(API, fd);
      }
      if (p.skala) await api(API, { action: 'proyek_skala', id: baru.id, skala: p.skala });
      const perangkat = (a.perangkat || []).map(d => {
        const atr = Object.assign({}, d.atribut);
        if (atr.tipe_endpoint != null) atr.tipe_endpoint = tipeMap.get(String(atr.tipe_endpoint)) || '';
        return Object.assign({}, d, { atribut: atr, katalog_id: d.katalog_id != null ? katMap.get(d.katalog_id) || null : null });
      });
      if (perangkat.length) await api(API, { action: 'perangkat_import', proyek_id: baru.id, perangkat });
      return baru;
    } catch (e) {
      await api(API, { action: 'proyek_delete', id: baru.id }).catch(() => {});
      throw new Error(`Event "${nama}" gagal dipulihkan: ${e.message}`);
    }
  }

  /**
   * Pulihkan file backup. Mendukung file backup (format net-plan-backup) dan file "Ekspor JSON" lama
   * (format net-plan: perangkat saja, dibuat sebagai event baru tanpa denah). Hasil: daftar event baru.
   */
  async function pulihkan(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      throw new Error('File bukan backup Net Plan yang valid');
    }
    let acara, katalog = [], tipe = [];
    if (data && data.format === FORMAT && Array.isArray(data.acara)) {
      if (data.versi > VERSI) throw new Error('File backup dibuat oleh versi Net Plan yang lebih baru');
      acara = data.acara;
      katalog = data.katalog || [];
      tipe = data.endpoint_tipe || [];
    } else if (data && data.format === 'net-plan' && Array.isArray(data.perangkat)) {
      acara = [{ proyek: data.proyek || { nama: file.name.replace(/\.json$/i, '') }, denah: null, perangkat: data.perangkat.map(d => Object.assign({}, d, { katalog_id: null })) }];
    } else {
      throw new Error('File bukan backup Net Plan yang valid');
    }
    if (!acara.length) throw new Error('File backup tidak berisi event');

    toast(`Memulihkan ${acara.length} event…`);
    const tipeMap = await petaTipe(tipe);
    const katMap = await petaKatalog(remapKonfigKatalog(katalog, tipeMap));
    const namaTerpakai = new Set((await api(API + '?action=list')).proyek.map(p => p.nama.toLowerCase()));
    const hasil = [];
    for (const a of acara) hasil.push(await pulihkanEvent(a, tipeMap, katMap, namaTerpakai));
    return hasil;
  }

  NP.Backup = { buat, pulihkan, FORMAT };
})();
