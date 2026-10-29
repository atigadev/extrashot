<?php
/**
 * API admin Net Plan (wajib login).
 *
 * GET  ?action=me                          -> {"ok":true,"login":bool}
 * POST {"action":"login","password":"..."}
 * POST {"action":"logout"}
 * GET  ?action=list                        -> daftar proyek + jumlah perangkat
 * GET  ?action=get&id=N                    -> {proyek, perangkat:[...]}
 * POST {"action":"proyek_save", id?, nama, venue, tanggal_mulai, tanggal_selesai, catatan, slack_kabel}
 * POST {"action":"proyek_skala","id":N,"skala":meter_per_piksel|null}
 * POST {"action":"proyek_password","id":N,"password":"...","lama":"..."} -> password admin event ("" = hapus, admin utama saja; admin event wajib "lama")
 * POST {"action":"admin_password","lama":"...","baru":"..."} -> ganti password admin utama (disimpan di np_meta)
 * POST {"action":"proyek_delete","id":N}
 * POST {"action":"proyek_duplicate","id":N}
 * POST {"action":"kode_baru","id":N}       -> buat ulang kode link lihat-saja (link lama tidak berlaku)
 * POST multipart action=denah_upload, id=N, denah=<file>, sesuaikan=1|0
 * POST {"action":"denah_hapus","id":N}
 * POST {"action":"proyek_lapisan","id":N,"lapisan":[{id:"L1",nama,warna}]}  -> layer jaringan event
 * POST {"action":"lapisan_impor","id":N,"sumber_id":M,"lapisan":[...],"lapisan_id":"L2"} -> salin perangkat event M jadi layer L2
 * POST {"action":"lantai_save","id":N,"lantai":[{id:"F1",nama,tinggi},..]}  -> daftar lantai (bawah -> atas)
 * POST multipart action=lantai_denah, id=N, lantai_id=F2, denah=<file>, sesuaikan=1|0 -> denah lantai
 * POST {"action":"lantai_skala","id":N,"lantai_id":"F2","skala":0.05} -> skala denah lantai
 * POST {"action":"anotasi_save","id":N,"anotasi":[{id:"A1",teks,warna,x,y,tx,ty,ke,lantai,panah}]} -> label & panah denah
 * GET  ?action=unit_list&katalog_id=N -> unit gudang satu alat (stok, dipakai di event mana, file konfigurasi)
 * POST {"action":"unit_save","id":N|null,"katalog_id":N,sn,mac,firmware,aset,ip_mgmt,user_admin,pass_admin,kondisi,lokasi,catatan}
 * POST {"action":"unit_massal","katalog_id":N,"baris":[{sn,mac,aset,firmware,lokasi}]} / {"action":"unit_delete","id":N}
 * POST {"action":"unit_pasang","perangkat_id":N,"unit_id":M} / {"action":"unit_lepas","perangkat_id":N}
 * POST multipart action=berkas_upload, id=unit, berkas=<file> / {"action":"berkas_hapus","id":N} -> file konfigurasi unit
 * POST multipart action=foto_upload, id=N (perangkat), foto=<jpeg>, lat, lng, akurasi, waktu -> {foto:[...]} (maks. 3 per perangkat)
 * POST {"action":"foto_hapus","id":N (foto),"proyek_id":N} -> {foto:[...]}
 * POST {"action":"perangkat_verif","id":N,"hasil":"sesuai"|"tidak"|"","catatan":"..."} -> hasil pengecekan penempatan
 * POST {"action":"perangkat_save", id? | proyek_id, ...isian}  -> isian yang dikirim saja yang diubah
 * POST {"action":"perangkat_delete","ids":[N,...]}
 * POST {"action":"perangkat_rename","items":[{"id":N,"nama":"..."},...]}  -> ganti nama massal (penamaan group)
 * POST {"action":"perangkat_kabel","ids":[N,...],"kabel":"ditarik"} -> status penarikan kabel (+ riwayat)
 * POST {"action":"perangkat_kunci","ids":[N,...],"kunci":true} -> kunci / buka kunci posisi titik
 * POST {"action":"perangkat_status_massal","ids":[N,...],"status":"terpasang","catatan":"..."} -> ubah status massal + riwayat
 * GET  ?action=katalog_list[&proyek_id=N]  -> katalog perangkat + jumlah pemakaian (semua event / event N)
 * POST {"action":"katalog_save", id?, jenis, merek, model, stok, spesifikasi:{}, konfigurasi:{}, bandwidth_mbps, catatan_konfig, keterangan}
 * POST {"action":"katalog_delete","id":N}   -> perangkat yang memakainya dilepas dari katalog (data tetap)
 * GET  ?action=endpoint_tipe_list           -> tipe endpoint (laptop, PC, printer, ...) + jumlah pemakaian
 * POST {"action":"endpoint_tipe_save", id?, nama, singkatan, ikon, warna, prefix}
 * POST {"action":"endpoint_tipe_delete","id":N}  -> ditolak bila masih dipakai perangkat
 * GET  ?action=akses_list&id=N               -> akses tim event N (link bertoken)
 * POST {"action":"akses_save", id? | proyek_id, nama, peran:"lihat"|"status", status_boleh:[], jenis_boleh:[], lihat_password, aktif}
 * POST {"action":"akses_token_baru","id":N}  -> link lama tidak berlaku
 * POST {"action":"akses_delete","id":N}
 * GET  ?action=log_list&id=N[&perangkat_id=M] -> riwayat perubahan status & catatan lapangan
 * POST {"action":"perangkat_hapus_semua","id":N}  -> hapus semua perangkat event (event & denah tetap)
 * POST {"action":"perangkat_import","proyek_id":N,"perangkat":[...]} -> tambah perangkat dari file ekspor JSON
 *
 * Setiap POST wajib membawa header "X-NP: 1" (pengaman CSRF: browser tidak bisa mengirim header ini lintas situs
 * tanpa izin CORS).
 */
require __DIR__ . '/db.php';

$loggedIn = start_admin_session();

$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'POST') {
    if (!isset($_SERVER['HTTP_X_NP']) || $_SERVER['HTTP_X_NP'] !== '1') {
        json_error('Permintaan ditolak', 403);
    }
    $isMultipart = isset($_SERVER['CONTENT_TYPE']) && stripos($_SERVER['CONTENT_TYPE'], 'multipart/form-data') === 0;
    $req = $isMultipart ? $_POST : json_body();
    $action = isset($req['action']) ? (string) $req['action'] : '';
    if ($isMultipart && $action === '' && empty($_FILES)) {
        json_error('File terlalu besar (batas server ' . ini_get('post_max_size') . ')', 413);
    }
} elseif ($method === 'GET') {
    $req = $_GET;
    $action = isset($_GET['action']) ? (string) $_GET['action'] : '';
} else {
    json_error('Metode tidak didukung', 405);
}

if ($action === 'me') {
    json_out(['ok' => true, 'login' => $loggedIn, 'peran' => $GLOBALS['NP_PERAN'], 'proyek' => $GLOBALS['NP_PROYEK']]);
}

if ($action === 'login' && $method === 'POST') {
    login(isset($req['password']) ? (string) $req['password'] : '');
}

if ($action === 'logout' && $method === 'POST') {
    $_SESSION = [];
    session_destroy();
    json_out(['ok' => true]);
}

if (!$loggedIn) {
    json_error('Silakan login terlebih dahulu', 401, ['login' => false]);
}
// Sesi PHP hanya dibaca setelah ini, jadi lepaskan kuncinya agar request admin lain tidak antre.
session_write_close();

$pdo = db();
$id = isset($req['id']) && !is_array($req['id']) ? (int) $req['id'] : 0;
if (!is_super()) {
    izin_admin_event($method . ' ' . $action, $req, $id);
}

switch ($method . ' ' . $action) {
    case 'GET list':
        $rows = $pdo->query('SELECT p.*, (SELECT COUNT(*) FROM np_perangkat d WHERE d.proyek_id = p.id) AS jumlah
            FROM np_proyek p ORDER BY p.updated_at DESC, p.id DESC')->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            if (!boleh_proyek($r['id'])) {
                continue; // admin event hanya melihat event miliknya
            }
            $jumlah = (int) $r['jumlah'];
            unset($r['jumlah'], $r['catatan']);
            $out[] = proyek_row($r) + ['jumlah' => $jumlah];
        }
        json_out(['ok' => true, 'proyek' => $out]);

    case 'GET get':
        json_out(['ok' => true] + proyek_lengkap(find_proyek($id)));

    case 'POST proyek_save':
        $data = [
            'nama' => str_field($req, 'nama', 150, true, 'Nama event'),
            'venue' => str_field($req, 'venue', 200),
            'tanggal_mulai' => date_field($req, 'tanggal_mulai'),
            'tanggal_selesai' => date_field($req, 'tanggal_selesai'),
            'catatan' => text_field($req, 'catatan', 5000, 'Catatan'),
            'slack_kabel' => isset($req['slack_kabel']) ? max(0, min(300, (int) $req['slack_kabel'])) : 20,
        ];
        if ($id) {
            find_proyek($id);
            $st = $pdo->prepare('UPDATE np_proyek SET nama = ?, venue = ?, tanggal_mulai = ?, tanggal_selesai = ?,
                catatan = ?, slack_kabel = ? WHERE id = ?');
            $st->execute(array_merge(array_values($data), [$id]));
        } else {
            // Event baru langsung dibuatkan password admin event (opsional; bisa diatur nanti di tab Proyek).
            $data['admin_hash'] = hash_password_event(isset($req['password']) ? $req['password'] : '');
            $st = $pdo->prepare('INSERT INTO np_proyek (nama, venue, tanggal_mulai, tanggal_selesai, catatan, slack_kabel, admin_hash, kode_lihat)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $st->execute(array_merge(array_values($data), [rand_hex(12)]));
            $id = (int) $pdo->lastInsertId();
        }
        json_out(['ok' => true, 'proyek' => proyek_row(find_proyek($id))]);

    case 'POST admin_password':
        // Ganti password admin utama (hanya admin utama; aksi ini tidak ada di daftar izin admin event).
        if (!cek_password_super(isset($req['lama']) ? (string) $req['lama'] : '')) {
            usleep(800000);
            json_error('Password lama salah', 403);
        }
        $baru = isset($req['baru']) ? (string) $req['baru'] : '';
        if (strlen($baru) < 8 || strlen($baru) > 72) {
            json_error('Password baru 8–72 karakter');
        }
        if (cek_password_super($baru)) {
            json_error('Password baru sama dengan password lama');
        }
        meta_set('admin_hash', password_hash($baru, PASSWORD_DEFAULT));
        $versi = rand_hex(8);
        meta_set('admin_versi', $versi); // sesi admin utama lain dengan password lama gugur
        session_start();
        $_SESSION['np_admin_v'] = $versi; // sesi ini tetap login
        session_write_close();
        json_out(['ok' => true]);

    case 'POST proyek_password':
        // Atur / ganti password admin event; kosong = hapus (hanya admin utama, dicek di izin_admin_event).
        $pr = find_proyek($id);
        if (!is_super() && !password_verify(isset($req['lama']) ? (string) $req['lama'] : '', (string) $pr['admin_hash'])) {
            usleep(800000);
            json_error('Password lama salah', 403); // admin event wajib membuktikan password lamanya
        }
        $hashBaru = hash_password_event(isset($req['password']) ? $req['password'] : '');
        $pdo->prepare('UPDATE np_proyek SET admin_hash = ? WHERE id = ?')->execute([$hashBaru, $id]);
        if (!is_super() && $hashBaru) {
            // Admin event mengganti password sendiri: tetap login (sesi lain dengan password lama otomatis gugur).
            session_start();
            $_SESSION['np_proyek'][$id] = sidik_password($hashBaru);
            session_write_close();
        }
        json_out(['ok' => true, 'proyek' => proyek_row(find_proyek($id))]);

    case 'POST proyek_skala':
        find_proyek($id);
        $skala = isset($req['skala']) && $req['skala'] !== null && $req['skala'] !== '' ? (float) $req['skala'] : null;
        if ($skala !== null && !($skala > 0 && $skala < 1000)) {
            json_error('Skala tidak valid');
        }
        $pdo->prepare('UPDATE np_proyek SET skala = ? WHERE id = ?')->execute([$skala, $id]);
        json_out(['ok' => true, 'proyek' => proyek_row(find_proyek($id))]);

    case 'POST kode_baru':
        find_proyek($id);
        $pdo->prepare('UPDATE np_proyek SET kode_lihat = ? WHERE id = ?')->execute([rand_hex(12), $id]);
        json_out(['ok' => true, 'proyek' => proyek_row(find_proyek($id))]);

    case 'POST proyek_delete':
        $p = find_proyek($id);
        hapus_foto_proyek($id);
        $pdo->prepare('DELETE FROM np_proyek WHERE id = ?')->execute([$id]);
        hapus_file_denah($p['denah_file']);
        hapus_denah_lantai($p['lantai']);
        json_out(['ok' => true]);

    case 'POST proyek_duplicate':
        json_out(['ok' => true, 'proyek' => proyek_row(duplikat_proyek(find_proyek($id)))]);

    case 'POST denah_upload':
        json_out(['ok' => true] + proyek_lengkap(upload_denah(find_proyek($id), !empty($req['sesuaikan']))));

    case 'POST denah_hapus':
        $p = find_proyek($id);
        $pdo->prepare('UPDATE np_proyek SET denah_file = NULL WHERE id = ?')->execute([$id]);
        hapus_file_denah($p['denah_file']);
        json_out(['ok' => true, 'proyek' => proyek_row(find_proyek($id))]);

    case 'POST perangkat_verif':
        // Hasil pengecekan penempatan oleh admin (isi / ubah / hapus hasil checker).
        $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ?');
        $st->execute([$id]);
        $d = $st->fetch();
        if (!$d) {
            json_error('Perangkat tidak ditemukan (mungkin sudah dihapus)', 404);
        }
        $row = set_verif($d, isset($req['hasil']) ? (string) $req['hasil'] : '', text_field($req, 'catatan', 2000, 'Catatan'), 'Admin', null, isset($req['waktu']) ? (string) $req['waktu'] : '');
        json_out(['ok' => true, 'perangkat' => perangkat_row($row)]);

    case 'POST foto_upload':
        // Foto bukti pemasangan (multipart: id = perangkat, foto, lat, lng, akurasi, waktu).
        $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ?');
        $st->execute([$id]);
        $d = $st->fetch();
        if (!$d) {
            json_error('Perangkat tidak ditemukan (mungkin sudah dihapus)', 404);
        }
        json_out(['ok' => true, 'foto' => simpan_foto($d, $req, 'Admin', null)]);

    case 'POST foto_hapus':
        json_out(['ok' => true, 'foto' => hapus_foto(isset($req['proyek_id']) ? (int) $req['proyek_id'] : 0, $id)]);

    // ---- Gudang: unit fisik per alat katalog. Admin event hanya bisa membaca stok, memasang/melepas unit di eventnya,
    // dan mengubah unit yang sedang dipakai eventnya (lihat izin_admin_event).
    case 'GET unit_list':
        find_katalog(isset($req['katalog_id']) ? (int) $req['katalog_id'] : 0);
        json_out(['ok' => true, 'unit' => unit_list(['katalog' => (int) $req['katalog_id']], !is_super())]);

    case 'POST unit_save':
        $u = $id ? find_unit($id) : null;
        $katId = $u ? (int) $u['katalog_id'] : (int) (isset($req['katalog_id']) ? $req['katalog_id'] : 0);
        find_katalog($katId);
        $v = unit_isian($req, $u);
        unit_cek_unik($v, $id);
        if ($u) {
            $pdo->prepare('UPDATE np_unit SET sn = ?, mac = ?, firmware = ?, aset = ?, ip_mgmt = ?, user_admin = ?, pass_admin = ?, kondisi = ?,
                lokasi = ?, catatan = ? WHERE id = ?')->execute([$v['sn'], $v['mac'], $v['firmware'], $v['aset'], $v['ip_mgmt'], $v['user_admin'],
                $v['pass_admin'], $v['kondisi'], $v['lokasi'], $v['catatan'], $id]);
        } else {
            $pdo->prepare('INSERT INTO np_unit (katalog_id, sn, mac, firmware, aset, ip_mgmt, user_admin, pass_admin, kondisi, lokasi, catatan)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute([$katId, $v['sn'], $v['mac'], $v['firmware'], $v['aset'], $v['ip_mgmt'],
                $v['user_admin'], $v['pass_admin'], $v['kondisi'], $v['lokasi'], $v['catatan']]);
            $id = (int) $pdo->lastInsertId();
        }
        json_out(['ok' => true, 'unit' => unit_list(['id' => $id])[0]]);

    case 'POST unit_massal':
        // Tambah banyak unit sekaligus (mis. tempel daftar SN / MAC dari packing list). Baris dobel dilewati.
        $katId = (int) (isset($req['katalog_id']) ? $req['katalog_id'] : 0);
        find_katalog($katId);
        $baris = isset($req['baris']) && is_array($req['baris']) ? array_slice($req['baris'], 0, 500) : [];
        $masuk = 0;
        $lewat = [];
        $ins = $pdo->prepare('INSERT INTO np_unit (katalog_id, sn, mac, firmware, aset, lokasi) VALUES (?, ?, ?, ?, ?, ?)');
        foreach ($baris as $b) {
            $v = unit_isian(is_array($b) ? $b : [], null);
            if ($v['sn'] === '' && $v['mac'] === '' && $v['aset'] === '') {
                continue;
            }
            $dobel = unit_dobel($v, 0);
            if ($dobel) {
                $lewat[] = $dobel;
                continue;
            }
            $ins->execute([$katId, $v['sn'], $v['mac'], $v['firmware'], $v['aset'], $v['lokasi']]);
            $masuk++;
        }
        json_out(['ok' => true, 'jumlah' => $masuk, 'dilewati' => $lewat, 'unit' => unit_list(['katalog' => $katId])]);

    case 'POST unit_delete':
        find_unit($id);
        hapus_berkas_unit([$id]);
        $pdo->prepare('DELETE FROM np_unit WHERE id = ?')->execute([$id]);
        json_out(['ok' => true]);

    case 'POST unit_pasang':
        // Pasang unit gudang ke perangkat event (satu unit = satu titik; unit lama perangkat itu kembali ke gudang).
        $pid = (int) (isset($req['perangkat_id']) ? $req['perangkat_id'] : 0);
        $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ?');
        $st->execute([$pid]);
        $d = $st->fetch();
        if (!$d) {
            json_error('Perangkat tidak ditemukan (mungkin sudah dihapus)', 404);
        }
        $u = find_unit(isset($req['unit_id']) ? (int) $req['unit_id'] : 0);
        if ((int) $u['katalog_id'] !== (int) $d['katalog_id']) {
            json_error('Unit ini dari alat katalog lain — pilih alat katalog yang sama di tab Identitas dulu');
        }
        if ($u['perangkat_id'] !== null && (int) $u['perangkat_id'] !== $pid) {
            json_error('Unit ini sedang dipakai perangkat lain — lepas dulu di sana');
        }
        if ($u['kondisi'] === 'rusak') {
            json_error('Unit ini berstatus rusak — tidak bisa dipasang');
        }
        $pdo->beginTransaction();
        $pdo->prepare('UPDATE np_unit SET perangkat_id = NULL WHERE perangkat_id = ?')->execute([$pid]);
        $pdo->prepare('UPDATE np_unit SET perangkat_id = ? WHERE id = ?')->execute([$pid, $u['id']]);
        $pdo->commit();
        json_out(['ok' => true, 'unit' => unit_list(['proyek' => (int) $d['proyek_id']])]);

    case 'POST unit_lepas':
        $pid = (int) (isset($req['perangkat_id']) ? $req['perangkat_id'] : 0);
        $st = $pdo->prepare('SELECT proyek_id FROM np_perangkat WHERE id = ?');
        $st->execute([$pid]);
        $proyekId = (int) $st->fetchColumn();
        $pdo->prepare('UPDATE np_unit SET perangkat_id = NULL WHERE perangkat_id = ?')->execute([$pid]);
        json_out(['ok' => true, 'unit' => unit_list(['proyek' => $proyekId])]);

    case 'POST berkas_upload':
        // File konfigurasi / backup milik unit (multipart: id = unit, berkas).
        $u = find_unit($id);
        simpan_berkas($u, is_super() ? 'Admin' : 'Admin event');
        json_out(['ok' => true, 'unit' => unit_list(['id' => $id])[0]]);

    case 'POST berkas_hapus':
        $unitId = hapus_berkas($id);
        json_out(['ok' => true, 'unit' => unit_list(['id' => $unitId])[0]]);

    case 'POST perangkat_save':
        $simpan = simpan_perangkat($req);
        // Unit gudang hanya cocok untuk alat katalog yang sama: ganti / lepas alat katalog = unit kembali ke gudang.
        try {
            $pdo->prepare('UPDATE np_unit SET perangkat_id = NULL WHERE perangkat_id = ? AND katalog_id <> ?')
                ->execute([$simpan['id'], (int) $simpan['katalog_id']]);
        } catch (PDOException $e) {
            // tabel gudang belum ada
        }
        json_out(['ok' => true, 'perangkat' => $simpan]);

    case 'POST perangkat_delete':
        $ids = isset($req['ids']) && is_array($req['ids']) ? array_values(array_unique(array_map('intval', $req['ids']))) : [];
        if (!$ids || count($ids) > 1000) {
            json_error('Tidak ada perangkat yang dipilih');
        }
        $in = implode(',', array_fill(0, count($ids), '?'));
        $pdo->beginTransaction();
        // Perangkat yang tadinya terhubung ke perangkat terhapus menjadi tanpa uplink.
        $pdo->prepare("UPDATE np_perangkat SET uplink_id = NULL WHERE uplink_id IN ($in)")->execute($ids);
        $pdo->prepare("DELETE FROM np_perangkat WHERE id IN ($in)")->execute($ids);
        $pdo->commit();
        json_out(['ok' => true]);

    case 'GET katalog_list':
        // Semua katalog + jumlah pemakaian (semua event & event tertentu bila proyek_id diberikan).
        $pid = isset($req['proyek_id']) ? (int) $req['proyek_id'] : 0;
        $st = $pdo->prepare('SELECT k.*,
                (SELECT COUNT(*) FROM np_perangkat d WHERE d.katalog_id = k.id) AS dipakai,
                (SELECT COUNT(*) FROM np_perangkat d WHERE d.katalog_id = k.id AND d.proyek_id = ?) AS dipakai_event
            FROM np_katalog k ORDER BY k.jenis, k.merek, k.model');
        $st->execute([$pid]);
        $out = [];
        $gudang = unit_ringkas(); // stok unit fisik per alat (null = alat belum punya daftar unit)
        foreach ($st->fetchAll() as $r) {
            $pakai = (int) $r['dipakai'];
            $pakaiEvent = (int) $r['dipakai_event'];
            unset($r['dipakai'], $r['dipakai_event']);
            $out[] = katalog_row($r) + ['dipakai' => $pakai, 'dipakai_event' => $pakaiEvent,
                'gudang' => isset($gudang[(int) $r['id']]) ? $gudang[(int) $r['id']] : null];
        }
        json_out(['ok' => true, 'katalog' => $out]);

    case 'POST katalog_save':
        $jenis = isset($req['jenis']) ? (string) $req['jenis'] : '';
        if (!in_array($jenis, NP_JENIS, true)) {
            json_error('Kategori tidak dikenal');
        }
        $stok = isset($req['stok']) && $req['stok'] !== '' && $req['stok'] !== null ? $req['stok'] : null;
        if ($stok !== null && (!is_numeric($stok) || $stok < 0 || $stok > 100000)) {
            json_error('Stok harus angka 0–100000');
        }
        $bw = isset($req['bandwidth_mbps']) && $req['bandwidth_mbps'] !== '' && $req['bandwidth_mbps'] !== null ? $req['bandwidth_mbps'] : null;
        if ($bw !== null && (!is_numeric($bw) || $bw < 0 || $bw >= 100000000)) {
            json_error('Bandwidth harus angka (Mbps)');
        }
        $data = [
            'jenis' => $jenis,
            'merek' => str_field($req, 'merek', 80, false, 'Merek'),
            'model' => str_field($req, 'model', 120, true, 'Tipe / model'),
            'stok' => $stok === null ? null : (int) $stok,
            'spesifikasi' => atribut_json(isset($req['spesifikasi']) ? $req['spesifikasi'] : []),
            'konfigurasi' => atribut_json(isset($req['konfigurasi']) ? $req['konfigurasi'] : []),
            'bandwidth_mbps' => $bw === null ? null : round((float) $bw, 2),
            'catatan_konfig' => text_field($req, 'catatan_konfig', 20000, 'Template konfigurasi'),
            'keterangan' => text_field($req, 'keterangan', 5000, 'Keterangan'),
        ];
        if ($id) {
            find_katalog($id);
            $cols = implode(', ', array_map(function ($k) { return "$k = ?"; }, array_keys($data)));
            $pdo->prepare("UPDATE np_katalog SET $cols WHERE id = ?")->execute(array_merge(array_values($data), [$id]));
        } else {
            $cols = implode(', ', array_keys($data));
            $qs = implode(', ', array_fill(0, count($data), '?'));
            $pdo->prepare("INSERT INTO np_katalog ($cols) VALUES ($qs)")->execute(array_values($data));
            $id = (int) $pdo->lastInsertId();
        }
        json_out(['ok' => true, 'katalog' => katalog_row(find_katalog($id))]);

    case 'POST katalog_delete':
        find_katalog($id);
        $pdo->beginTransaction();
        // Unit gudang alat ini ikut terhapus (baris lewat foreign key; file konfigurasinya dihapus di sini).
        $st = $pdo->prepare('SELECT id FROM np_unit WHERE katalog_id = ?');
        try {
            $st->execute([$id]);
            hapus_berkas_unit($st->fetchAll(PDO::FETCH_COLUMN));
        } catch (PDOException $e) {
            // tabel gudang belum ada
        }
        // Perangkat di event tetap ada (nama alat & konfigurasi tidak berubah), hanya lepas dari katalog.
        $pdo->prepare('UPDATE np_perangkat SET katalog_id = NULL WHERE katalog_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM np_katalog WHERE id = ?')->execute([$id]);
        $pdo->commit();
        json_out(['ok' => true]);

    case 'GET endpoint_tipe_list':
        $list = endpoint_tipe_list();
        foreach ($list as &$t) {
            $t['dipakai'] = endpoint_dipakai($t['id']);
        }
        json_out(['ok' => true, 'endpoint_tipe' => $list]);

    case 'POST endpoint_tipe_save':
        $nama = str_field($req, 'nama', 60, true, 'Nama tipe');
        $singkat = strtoupper(str_field($req, 'singkatan', 4, true, 'Singkatan'));
        $warna = isset($req['warna']) ? strtolower(trim((string) $req['warna'])) : '';
        $prefix = strtoupper(str_field($req, 'prefix', 12, false, 'Prefix nama'));
        $ikon = isset($req['ikon']) && in_array($req['ikon'], NP_IKON, true) ? $req['ikon'] : 'umum';
        if ($prefix === '') {
            $prefix = $singkat;
        }
        if (!preg_match('/^[A-Z0-9]{1,4}$/', $singkat)) {
            json_error('Singkatan 1–4 huruf/angka');
        }
        if (!preg_match('/^#[0-9a-f]{6}$/', $warna)) {
            json_error('Warna tidak valid');
        }
        if (!preg_match('/^[A-Z0-9][A-Z0-9-]{0,11}$/', $prefix)) {
            json_error('Prefix nama hanya huruf, angka, dan tanda -');
        }
        $st = $pdo->prepare('SELECT id FROM np_endpoint_tipe WHERE nama = ? AND id <> ?');
        $st->execute([$nama, $id]);
        if ($st->fetch()) {
            json_error('Tipe "' . $nama . '" sudah ada');
        }
        if ($id) {
            $pdo->prepare('UPDATE np_endpoint_tipe SET nama = ?, singkatan = ?, ikon = ?, warna = ?, prefix = ? WHERE id = ?')
                ->execute([$nama, $singkat, $ikon, $warna, $prefix, $id]);
        } else {
            $urut = (int) $pdo->query('SELECT COALESCE(MAX(urutan), 0) + 1 FROM np_endpoint_tipe')->fetchColumn();
            $pdo->prepare('INSERT INTO np_endpoint_tipe (nama, singkatan, ikon, warna, prefix, urutan) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$nama, $singkat, $ikon, $warna, $prefix, $urut]);
        }
        json_out(['ok' => true, 'endpoint_tipe' => endpoint_tipe_list()]);

    case 'POST endpoint_tipe_delete':
        $n = endpoint_dipakai($id);
        if ($n) {
            json_error("Tipe ini masih dipakai $n perangkat. Ganti tipe perangkat tersebut dulu.");
        }
        $pdo->prepare('DELETE FROM np_endpoint_tipe WHERE id = ?')->execute([$id]);
        json_out(['ok' => true, 'endpoint_tipe' => endpoint_tipe_list()]);

    case 'POST perangkat_status_massal':
        // Ubah status banyak perangkat sekaligus; setiap perubahan dicatat di riwayat.
        $ids = isset($req['ids']) && is_array($req['ids']) ? array_values(array_unique(array_map('intval', $req['ids']))) : [];
        $status = isset($req['status']) ? (string) $req['status'] : '';
        if (!$ids || count($ids) > 1000) {
            json_error('Tidak ada perangkat yang dipilih');
        }
        if (!in_array($status, NP_STATUS, true)) {
            json_error('Status tidak dikenal');
        }
        $catatan = text_field($req, 'catatan', 2000, 'Catatan');
        $in = implode(',', array_fill(0, count($ids), '?'));
        $st = $pdo->prepare("SELECT id, proyek_id, nama, status FROM np_perangkat WHERE id IN ($in)");
        $st->execute($ids);
        $pdo->beginTransaction();
        $upd = $pdo->prepare('UPDATE np_perangkat SET status = ? WHERE id = ?');
        $n = 0;
        $proyekIds = [];
        foreach ($st->fetchAll() as $d) {
            if ($d['status'] === $status) {
                continue;
            }
            $upd->execute([$status, $d['id']]);
            tulis_log((int) $d['proyek_id'], $d, null, 'Admin', $d['status'], $status, $catatan);
            $proyekIds[(int) $d['proyek_id']] = true;
            $n++;
        }
        foreach (array_keys($proyekIds) as $pid) {
            $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$pid]);
        }
        $pdo->commit();
        json_out(['ok' => true, 'jumlah' => $n]);

    case 'POST perangkat_kabel':
        // Status penarikan kabel ke uplink (satu / banyak perangkat), tercatat di riwayat.
        $ids = isset($req['ids']) && is_array($req['ids']) ? array_values(array_unique(array_map('intval', $req['ids']))) : [];
        if (!$ids || count($ids) > 2000) {
            json_error('Tidak ada perangkat yang dipilih');
        }
        $st = $pdo->prepare('SELECT proyek_id FROM np_perangkat WHERE id = ?');
        $st->execute([$ids[0]]);
        $pid = (int) $st->fetchColumn();
        if (!empty($req['ke'])) {
            // Sambungan tambahan (WAN tambahan / uplink kedua) satu perangkat.
            list($hasil, $dilewati) = ubah_kabel_lain($pid, $ids[0], isset($req['kunci']) ? (string) $req['kunci'] : '', (int) $req['ke'],
                isset($req['kabel']) ? (string) $req['kabel'] : '', null, 'Admin', text_field($req, 'catatan', 2000, 'Catatan'));
            json_out(['ok' => true, 'perangkat' => array_map('perangkat_row', $hasil), 'dilewati' => $dilewati]);
        }
        list($hasil, $dilewati) = ubah_kabel_massal($pid, $ids, isset($req['kabel']) ? (string) $req['kabel'] : '', null, 'Admin',
            text_field($req, 'catatan', 2000, 'Catatan'));
        json_out(['ok' => true, 'perangkat' => array_map('perangkat_row', $hasil), 'dilewati' => $dilewati]);

    case 'POST perangkat_kunci':
        // Kunci / buka kunci posisi banyak perangkat sekaligus (atribut "kunci" = "1"): titik tidak bisa digeser.
        $ids = isset($req['ids']) && is_array($req['ids']) ? array_values(array_unique(array_map('intval', $req['ids']))) : [];
        if (!$ids || count($ids) > 2000) {
            json_error('Tidak ada perangkat yang dipilih');
        }
        $kunci = !empty($req['kunci']);
        $in = implode(',', array_fill(0, count($ids), '?'));
        $st = $pdo->prepare("SELECT id, proyek_id, atribut FROM np_perangkat WHERE id IN ($in)");
        $st->execute($ids);
        $pdo->beginTransaction();
        $upd = $pdo->prepare('UPDATE np_perangkat SET atribut = ? WHERE id = ?');
        $n = 0;
        $proyekIds = [];
        foreach ($st->fetchAll() as $d) {
            $atr = json_decode((string) $d['atribut'], true);
            $atr = is_array($atr) ? $atr : [];
            if ($kunci === (isset($atr['kunci']) && $atr['kunci'] === '1')) {
                continue;
            }
            if ($kunci) {
                $atr['kunci'] = '1';
            } else {
                unset($atr['kunci']);
            }
            $upd->execute([atribut_json($atr), $d['id']]);
            $proyekIds[(int) $d['proyek_id']] = true;
            $n++;
        }
        foreach (array_keys($proyekIds) as $pid) {
            $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$pid]);
        }
        $pdo->commit();
        json_out(['ok' => true, 'jumlah' => $n]);

    case 'GET akses_list':
        $p = find_proyek($id);
        $st = $pdo->prepare('SELECT * FROM np_akses WHERE proyek_id = ? ORDER BY id');
        $st->execute([$p['id']]);
        json_out(['ok' => true, 'akses' => array_map('akses_row', $st->fetchAll())]);

    case 'POST akses_save':
        $pid = isset($req['proyek_id']) ? (int) $req['proyek_id'] : 0;
        if (!$id) {
            find_proyek($pid);
        }
        $peran = isset($req['peran']) && in_array($req['peran'], ['lihat', 'status', 'cek'], true) ? $req['peran'] : 'lihat';
        $statusBoleh = array_values(array_intersect(NP_STATUS, isset($req['status_boleh']) && is_array($req['status_boleh']) ? $req['status_boleh'] : []));
        $jenisBoleh = array_values(array_intersect(NP_JENIS, isset($req['jenis_boleh']) && is_array($req['jenis_boleh']) ? $req['jenis_boleh'] : []));
        if ($peran === 'status' && !$statusBoleh) {
            json_error('Pilih minimal satu status yang boleh diubah tim ini');
        }
        $data = [
            'nama' => str_field($req, 'nama', 100, true, 'Nama tim'),
            'peran' => $peran,
            'status_boleh' => json_encode($peran === 'status' ? $statusBoleh : []),
            'jenis_boleh' => json_encode($jenisBoleh),
            'lihat_password' => !empty($req['lihat_password']) ? 1 : 0,
            'aktif' => !isset($req['aktif']) || !empty($req['aktif']) ? 1 : 0,
        ];
        if ($id) {
            $cols = implode(', ', array_map(function ($k) { return "$k = ?"; }, array_keys($data)));
            $st = $pdo->prepare("UPDATE np_akses SET $cols WHERE id = ?");
            $st->execute(array_merge(array_values($data), [$id]));
        } else {
            $data['proyek_id'] = $pid;
            $data['token'] = rand_hex(16);
            $cols = implode(', ', array_keys($data));
            $qs = implode(', ', array_fill(0, count($data), '?'));
            $pdo->prepare("INSERT INTO np_akses ($cols) VALUES ($qs)")->execute(array_values($data));
            $id = (int) $pdo->lastInsertId();
        }
        json_out(['ok' => true, 'akses' => akses_row(find_akses($id))]);

    case 'POST akses_token_baru':
        find_akses($id);
        $pdo->prepare('UPDATE np_akses SET token = ? WHERE id = ?')->execute([rand_hex(16), $id]);
        json_out(['ok' => true, 'akses' => akses_row(find_akses($id))]);

    case 'POST akses_delete':
        find_akses($id);
        $pdo->prepare('DELETE FROM np_akses WHERE id = ?')->execute([$id]);
        json_out(['ok' => true]);

    case 'GET log_list':
        // Riwayat event, atau satu perangkat bila perangkat_id diberikan.
        $p = find_proyek($id);
        $pid = isset($req['perangkat_id']) ? (int) $req['perangkat_id'] : 0;
        json_out(['ok' => true, 'log' => log_list($p['id'], $pid ?: null, $pid ? 50 : 150)]);

    case 'POST perangkat_rename':
        // Ganti nama banyak perangkat sekaligus (penamaan per group). items: [{id, nama}, ...]
        $items = isset($req['items']) && is_array($req['items']) ? $req['items'] : [];
        if (!$items || count($items) > 2000) {
            json_error('Tidak ada perangkat yang diganti namanya');
        }
        $pdo->beginTransaction();
        $upd = $pdo->prepare('UPDATE np_perangkat SET nama = ? WHERE id = ?');
        $st = $pdo->prepare('SELECT proyek_id FROM np_perangkat WHERE id = ?');
        $proyek = [];
        foreach ($items as $it) {
            $did = is_array($it) && isset($it['id']) ? (int) $it['id'] : 0;
            $st->execute([$did]);
            $pid = $st->fetchColumn();
            if (!$pid) {
                $pdo->rollBack();
                json_error('Perangkat tidak ditemukan (mungkin sudah dihapus)', 404);
            }
            $upd->execute([str_field($it, 'nama', 100, true, 'Nama perangkat'), $did]);
            $proyek[(int) $pid] = true;
        }
        foreach (array_keys($proyek) as $pid) {
            $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$pid]);
        }
        $pdo->commit();
        json_out(['ok' => true, 'jumlah' => count($items)]);

    case 'POST perangkat_hapus_semua':
        find_proyek($id);
        $st = $pdo->prepare('DELETE FROM np_perangkat WHERE proyek_id = ?');
        $st->execute([$id]);
        $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$id]);
        json_out(['ok' => true, 'jumlah' => $st->rowCount()] + proyek_lengkap(find_proyek($id)));

    case 'POST proyek_lapisan':
        // Daftar layer jaringan event (beberapa jaringan terpisah dalam satu denah).
        find_proyek($id);
        $pdo->prepare('UPDATE np_proyek SET lapisan = ? WHERE id = ?')->execute([lapisan_json(isset($req['lapisan']) ? $req['lapisan'] : []), $id]);
        json_out(['ok' => true, 'proyek' => proyek_row(find_proyek($id))]);

    case 'POST lantai_save':
        // Daftar lantai (urutan bawah -> atas, nama, tinggi lantai m). Data denah tiap lantai dipertahankan; lantai yang
        // dihapus harus kosong (perangkatnya dipindah dulu) dan file denahnya ikut dihapus. F1 = denah utama, selalu ada.
        $p = find_proyek($id);
        $lama = [];
        foreach (lantai_baca($p['lantai']) as $l) {
            $lama[$l['id']] = $l;
        }
        $baru = [];
        $ids = [];
        foreach (isset($req['lantai']) && is_array($req['lantai']) ? array_slice($req['lantai'], 0, 30) : [] as $l) {
            $lid = is_array($l) && isset($l['id']) ? (string) $l['id'] : '';
            if (!preg_match('/^F\d{1,3}$/', $lid) || isset($ids[$lid])) {
                json_error('ID lantai tidak valid');
            }
            $ids[$lid] = true;
            $e = isset($lama[$lid]) ? $lama[$lid] : ['denah_file' => null, 'denah_w' => null, 'denah_h' => null, 'skala' => null];
            $e['id'] = $lid;
            $e['nama'] = str_field($l, 'nama', 60, true, 'Nama lantai');
            $e['tinggi'] = isset($l['tinggi']) && is_numeric($l['tinggi']) ? max(0, min(50, (float) $l['tinggi'])) : 4.0;
            $baru[] = $e;
        }
        if (!isset($ids['F1'])) {
            array_unshift($baru, ['id' => 'F1', 'nama' => 'Lantai 1', 'tinggi' => 4.0, 'denah_file' => null, 'denah_w' => null, 'denah_h' => null, 'skala' => null]);
        }
        foreach ($lama as $lid => $l) {
            if ($lid === 'F1' || isset($ids[$lid])) {
                continue;
            }
            $st = $pdo->prepare('SELECT COUNT(*) FROM np_perangkat WHERE proyek_id = ? AND ' . sql_lantai($lid));
            $st->execute([$p['id']]);
            if ((int) $st->fetchColumn()) {
                json_error('Lantai "' . $l['nama'] . '" masih berisi perangkat — pindahkan perangkatnya dulu');
            }
        }
        $pdo->prepare('UPDATE np_proyek SET lantai = ? WHERE id = ?')->execute([count($baru) > 1 ? json_encode($baru, JSON_UNESCAPED_UNICODE) : null, $p['id']]);
        foreach ($lama as $lid => $l) {
            if (!isset($ids[$lid])) {
                hapus_denah_lantai(json_encode([$l]));
            }
        }
        json_out(['ok' => true, 'proyek' => proyek_row(find_proyek($p['id']))]);

    case 'POST lantai_denah':
        // Gambar denah lantai selain F1 (multipart: id, lantai_id, denah, sesuaikan). sesuaikan: posisi perangkat di
        // lantai itu & skalanya mengikuti ukuran gambar baru; tanpa sesuaikan skala lantai dikosongkan (kalibrasi ulang).
        $p = find_proyek($id);
        $lid = isset($req['lantai_id']) ? (string) $req['lantai_id'] : '';
        $daftar = lantai_baca($p['lantai']);
        $i = array_search($lid, array_column($daftar, 'id'), true);
        if ($lid === 'F1' || $i === false) {
            json_error('Lantai tidak dikenal');
        }
        list($name, $w, $h) = terima_gambar_denah();
        $l = $daftar[$i];
        $pdo->beginTransaction();
        $skala = $l['skala'];
        if (!empty($req['sesuaikan']) && $l['denah_w'] && $l['denah_h'] && ($l['denah_w'] !== $w || $l['denah_h'] !== $h)) {
            $fx = $w / $l['denah_w'];
            $fy = $h / $l['denah_h'];
            $pdo->prepare('UPDATE np_perangkat SET x = x * ?, y = y * ? WHERE proyek_id = ? AND ' . sql_lantai($lid))->execute([$fx, $fy, $p['id']]);
            $st = $pdo->prepare("SELECT id, jalur FROM np_perangkat WHERE proyek_id = ? AND jalur LIKE '%\"bebas\"%' AND " . sql_lantai($lid));
            $st->execute([$p['id']]);
            $upd = $pdo->prepare('UPDATE np_perangkat SET jalur = ? WHERE id = ?');
            foreach ($st->fetchAll() as $r) {
                $upd->execute([jalur_json(json_decode($r['jalur'], true), $fx, $fy), $r['id']]);
            }
            if ($skala !== null) {
                $skala = $skala * $l['denah_w'] / $w;
            }
        } elseif (empty($req['sesuaikan'])) {
            $skala = null;
        }
        $fileLama = $l['denah_file'];
        $daftar[$i] = array_merge($l, ['denah_file' => $name, 'denah_w' => $w, 'denah_h' => $h, 'skala' => $skala]);
        $pdo->prepare('UPDATE np_proyek SET lantai = ? WHERE id = ?')->execute([json_encode($daftar, JSON_UNESCAPED_UNICODE), $p['id']]);
        $pdo->commit();
        if ($fileLama) {
            hapus_denah_lantai(json_encode([['id' => $lid, 'denah_file' => $fileLama]]));
        }
        json_out(['ok' => true] + proyek_lengkap(find_proyek($p['id'])));

    case 'POST lantai_skala':
        // Skala (m per piksel) denah lantai selain F1; null = hapus kalibrasi.
        $p = find_proyek($id);
        $lid = isset($req['lantai_id']) ? (string) $req['lantai_id'] : '';
        $daftar = lantai_baca($p['lantai']);
        $i = array_search($lid, array_column($daftar, 'id'), true);
        if ($lid === 'F1' || $i === false) {
            json_error('Lantai tidak dikenal');
        }
        $sk = isset($req['skala']) && $req['skala'] !== null && $req['skala'] !== '' ? (float) $req['skala'] : null;
        if ($sk !== null && ($sk <= 0 || $sk >= 1000)) {
            json_error('Skala tidak wajar');
        }
        $daftar[$i]['skala'] = $sk;
        $pdo->prepare('UPDATE np_proyek SET lantai = ? WHERE id = ?')->execute([json_encode($daftar, JSON_UNESCAPED_UNICODE), $p['id']]);
        json_out(['ok' => true, 'proyek' => proyek_row(find_proyek($p['id']))]);

    case 'POST anotasi_save':
        // Label & panah di denah (daftar lengkap menggantikan yang lama).
        $p = find_proyek($id);
        $json = anotasi_json(isset($req['anotasi']) ? $req['anotasi'] : []);
        $pdo->prepare('UPDATE np_proyek SET anotasi = ? WHERE id = ?')->execute([$json, $p['id']]);
        json_out(['ok' => true]);

    case 'POST lapisan_impor':
        // Salin semua perangkat event lain (sumber_id) ke event ini sebagai layer lapisan_id. Posisi & jalur kabel
        // diskalakan mengikuti ukuran denah; foto bukti ikut disalin (file baru). Event sumber tidak diubah.
        $p = find_proyek($id);
        $src = find_proyek(isset($req['sumber_id']) ? (int) $req['sumber_id'] : 0);
        if ((int) $src['id'] === (int) $p['id']) {
            json_error('Pilih event lain sebagai sumber layer');
        }
        $lapisan = lapisan_json(isset($req['lapisan']) ? $req['lapisan'] : []);
        $lid = isset($req['lapisan_id']) ? (string) $req['lapisan_id'] : '';
        if (!$lapisan || !in_array($lid, array_column(json_decode($lapisan, true), 'id'), true)) {
            json_error('Layer tujuan tidak dikenal');
        }
        // Lantai: perangkat di lantai sumber yang id-nya juga ada di event ini tetap di lantai itu; selain itu masuk
        // lantai tujuan (lantai_id, default F1). Posisi diskalakan dari ukuran denah lantai asal ke lantai tujuan.
        $lantaiTuju = array_merge(['F1'], array_column(lantai_baca($p['lantai']), 'id'));
        $ltDefault = isset($req['lantai_id']) && in_array((string) $req['lantai_id'], $lantaiTuju, true) ? (string) $req['lantai_id'] : 'F1';
        $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE proyek_id = ? ORDER BY id');
        $st->execute([$src['id']]);
        $list = [];
        foreach ($st->fetchAll() as $r) {
            $atr = json_decode((string) $r['atribut'], true);
            $atr = is_array($atr) ? $atr : [];
            $atr['lapisan'] = $lid;
            $ltAsal = isset($atr['lantai']) && is_string($atr['lantai']) ? $atr['lantai'] : 'F1';
            $lt = in_array($ltAsal, $lantaiTuju, true) ? $ltAsal : $ltDefault;
            if ($lt === 'F1') {
                unset($atr['lantai']);
            } else {
                $atr['lantai'] = $lt;
            }
            list($sw, $sh) = dimensi_lantai($src, $ltAsal);
            list($tw, $th) = dimensi_lantai($p, $lt);
            $fx = $tw && $sw ? $tw / $sw : 1;
            $fy = $th && $sh ? $th / $sh : 1;
            // Jalur kabel sambungan tambahan (WAN tambahan / uplink kedua) ikut diskalakan.
            foreach (['wan_lain', 'uplink_lain'] as $k) {
                $arr = isset($atr[$k]) ? json_decode((string) $atr[$k], true) : null;
                if (is_array($arr)) {
                    foreach ($arr as &$w) {
                        if (is_array($w) && isset($w['jalur'])) {
                            $w['jalur'] = jalur_json($w['jalur'], $fx, $fy);
                        }
                    }
                    unset($w);
                    $atr[$k] = json_encode($arr, JSON_UNESCAPED_UNICODE);
                }
            }
            $r['atribut'] = $atr;
            $r['jalur'] = jalur_json(json_decode((string) $r['jalur'], true), $fx, $fy);
            $r['x'] = $r['x'] * $fx;
            $r['y'] = $r['y'] * $fy;
            $list[] = $r;
        }
        if (!$list) {
            json_error('Event sumber belum punya perangkat');
        }
        $peta = [];
        $n = salin_perangkat((int) $p['id'], $list, false, $peta);
        $pdo->prepare('UPDATE np_proyek SET lapisan = ? WHERE id = ?')->execute([$lapisan, $p['id']]);
        // Foto bukti: salin file & baris (file tetap milik masing-masing event; hapus event tidak saling memengaruhi).
        try {
            $st = $pdo->prepare('SELECT * FROM np_foto WHERE proyek_id = ?');
            $st->execute([$src['id']]);
            $insF = $pdo->prepare('INSERT INTO np_foto (proyek_id, perangkat_id, file, w, h, lat, lng, akurasi_m, diambil_at, akses_id, oleh)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)');
            foreach ($st->fetchAll() as $f) {
                if (!isset($peta[(int) $f['perangkat_id']]) || !is_file(NP_UPLOAD_DIR . '/' . $f['file'])) {
                    continue;
                }
                $baru = 'foto_' . rand_hex(12) . '.jpg';
                if (@copy(NP_UPLOAD_DIR . '/' . $f['file'], NP_UPLOAD_DIR . '/' . $baru)) {
                    $insF->execute([$p['id'], $peta[(int) $f['perangkat_id']], $baru, $f['w'], $f['h'], $f['lat'], $f['lng'],
                        $f['akurasi_m'], $f['diambil_at'], $f['oleh']]);
                }
            }
        } catch (PDOException $e) {
            // tabel foto belum ada: perangkat tetap tersalin
        }
        json_out(['ok' => true, 'jumlah' => $n] + proyek_lengkap(find_proyek((int) $p['id'])));

    case 'POST perangkat_import':
        $p = find_proyek(isset($req['proyek_id']) ? (int) $req['proyek_id'] : 0);
        $list = isset($req['perangkat']) && is_array($req['perangkat']) ? $req['perangkat'] : [];
        if (!$list || count($list) > 2000) {
            json_error('File tidak berisi daftar perangkat');
        }
        $petaImpor = [];
        $n = salin_perangkat((int) $p['id'], $list, false, $petaImpor);
        json_out(['ok' => true, 'jumlah' => $n, 'peta_id' => (object) $petaImpor] + proyek_lengkap(find_proyek((int) $p['id'])));

    case 'POST perangkat_pulihkan':
        // Batalkan hapus (Ctrl+Z): perangkat kembali dengan id semula, lalu perangkat lain yang tadinya terhubung
        // ke situ disambungkan lagi.
        $pid = (int) find_proyek(isset($req['proyek_id']) ? (int) $req['proyek_id'] : 0)['id'];
        $list = isset($req['perangkat']) && is_array($req['perangkat']) ? $req['perangkat'] : [];
        if (!$list || count($list) > 2000) {
            json_error('Tidak ada perangkat untuk dikembalikan');
        }
        salin_perangkat($pid, $list, true);
        $sambung = isset($req['sambung']) && is_array($req['sambung']) ? $req['sambung'] : [];
        $upd = $pdo->prepare('UPDATE np_perangkat a JOIN np_perangkat b ON b.id = ? AND b.proyek_id = a.proyek_id
            SET a.uplink_id = b.id WHERE a.id = ? AND a.proyek_id = ? AND a.uplink_id IS NULL');
        foreach (array_slice($sambung, 0, 5000) as $s) {
            if (is_array($s) && isset($s['id'], $s['uplink_id'])) {
                $upd->execute([(int) $s['uplink_id'], (int) $s['id'], $pid]);
            }
        }
        json_out(['ok' => true] + proyek_lengkap(find_proyek($pid)));
}

json_error('Aksi tidak dikenal', 404);

// ---------------------------------------------------------------------------

/**
 * Login: password admin utama (NP_ADMIN_PASS, atau "admin" dari localhost bila belum diatur) -> semua event;
 * password admin event -> hanya event yang passwordnya cocok.
 */
function login($password)
{
    $local = in_array($_SERVER['REMOTE_ADDR'], ['127.0.0.1', '::1'], true);
    db(); // struktur tabel dibuat/diperbarui otomatis di db() (lihat np_migrasi_otomatis)
    $superDiatur = meta_get('admin_hash') !== '' || (defined('NP_ADMIN_PASS') && NP_ADMIN_PASS !== '');
    $super = cek_password_super($password);
    session_regenerate_id(true);
    $_SESSION = [];
    if ($super) {
        $_SESSION['np_admin'] = 1;
        $_SESSION['np_admin_v'] = meta_get('admin_versi', '0');
        json_out(['ok' => true, 'login' => true, 'peran' => 'super']);
    }
    // Password admin event (bisa cocok dengan lebih dari satu event).
    $cocok = [];
    if ($password !== '') {
        foreach (db()->query('SELECT id, admin_hash FROM np_proyek WHERE admin_hash IS NOT NULL')->fetchAll() as $r) {
            if (password_verify($password, $r['admin_hash'])) {
                $cocok[(int) $r['id']] = sidik_password($r['admin_hash']);
            }
        }
    }
    if ($cocok) {
        $_SESSION['np_proyek'] = $cocok;
        json_out(['ok' => true, 'login' => true, 'peran' => 'event', 'proyek' => array_keys($cocok)]);
    }
    usleep(800000); // perlambat tebak-tebakan password
    if (!$superDiatur && !$local) {
        json_error('Password salah. (Password admin utama belum diatur: isi NP_ADMIN_PASS di api/config.local.php.)', 401);
    }
    json_error('Password salah', 401);
}

/** Validasi & simpan password admin event; '' = hapus. Hasil: hash atau null. */
function hash_password_event($password)
{
    $password = (string) $password;
    if ($password === '') {
        return null;
    }
    if (strlen($password) < 8) {
        json_error('Password admin event minimal 8 karakter');
    }
    if (strlen($password) > 72) {
        json_error('Password admin event maksimal 72 karakter');
    }
    return password_hash($password, PASSWORD_DEFAULT);
}

/**
 * Batas akses admin event (bukan admin utama): DEFAULT TOLAK. Hanya aksi di daftar ini yang boleh, dan setiap aksi
 * dipastikan hanya menyentuh event miliknya. Aksi yang tidak terdaftar (buat/hapus/duplikat event, ubah katalog &
 * tipe endpoint bersama) ditolak.
 */
function izin_admin_event($aksi, $req, $id)
{
    $pdo = db();
    $tolak = function ($pesan = null) {
        json_error($pesan ?: 'Akses ditolak: aksi ini hanya untuk admin utama', 403);
    };
    $cekProyek = function ($pid) use ($tolak) {
        if (!$pid || !boleh_proyek($pid)) {
            $tolak('Akses ditolak: event ini bukan milik login Anda');
        }
    };
    $proyekPerangkat = function ($ids) use ($pdo, $cekProyek, $tolak) {
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) $ids))));
        if (!$ids) {
            $tolak('Tidak ada perangkat yang dipilih');
        }
        $in = implode(',', array_fill(0, count($ids), '?'));
        $st = $pdo->prepare("SELECT DISTINCT proyek_id FROM np_perangkat WHERE id IN ($in)");
        $st->execute($ids);
        $pids = $st->fetchAll(PDO::FETCH_COLUMN);
        if (!$pids) {
            json_error('Perangkat tidak ditemukan (mungkin sudah dihapus)', 404);
        }
        foreach ($pids as $pid) {
            $cekProyek((int) $pid);
        }
    };
    $proyekAkses = function ($aksesId) use ($pdo, $cekProyek) {
        $st = $pdo->prepare('SELECT proyek_id FROM np_akses WHERE id = ?');
        $st->execute([(int) $aksesId]);
        $cekProyek((int) $st->fetchColumn());
    };

    switch ($aksi) {
        case 'GET list':
        case 'GET katalog_list':
        case 'GET endpoint_tipe_list':
        case 'GET unit_list':
            return; // daftar event difilter di aksinya; katalog, tipe endpoint & stok gudang hanya dibaca (password tersamar)
        case 'POST unit_pasang':
        case 'POST unit_lepas':
            return $proyekPerangkat([isset($req['perangkat_id']) ? (int) $req['perangkat_id'] : 0]);
        case 'POST unit_save':
        case 'POST berkas_upload':
        case 'POST berkas_hapus':
            // Hanya unit yang sedang dipakai di event milik login ini (mis. update firmware / backup di venue).
            $unitId = $id;
            if ($aksi === 'POST berkas_hapus') {
                $st = $pdo->prepare('SELECT unit_id FROM np_berkas WHERE id = ?');
                $st->execute([$id]);
                $unitId = (int) $st->fetchColumn();
            }
            if (!$unitId) {
                $tolak('Akses ditolak: menambah unit ke gudang hanya untuk admin utama');
            }
            $st = $pdo->prepare('SELECT d.proyek_id FROM np_unit u JOIN np_perangkat d ON d.id = u.perangkat_id WHERE u.id = ?');
            $st->execute([$unitId]);
            return $cekProyek((int) $st->fetchColumn());
        case 'GET get':
        case 'GET akses_list':
        case 'GET log_list':
        case 'POST proyek_skala':
        case 'POST kode_baru':
        case 'POST denah_upload':
        case 'POST denah_hapus':
        case 'POST proyek_lapisan':
        case 'POST lantai_save':
        case 'POST lantai_denah':
        case 'POST lantai_skala':
        case 'POST anotasi_save':
        case 'POST perangkat_hapus_semua':
            return $cekProyek($id);
        case 'POST lapisan_impor':
            $cekProyek(isset($req['sumber_id']) ? (int) $req['sumber_id'] : 0); // sumber juga harus event milik login ini
            return $cekProyek($id);
        case 'POST proyek_save':
            if (!$id) {
                $tolak('Akses ditolak: membuat event baru hanya untuk admin utama');
            }
            return $cekProyek($id);
        case 'POST proyek_password':
            $cekProyek($id);
            if ((string) (isset($req['password']) ? $req['password'] : '') === '') {
                $tolak('Akses ditolak: menghapus password admin event hanya untuk admin utama');
            }
            return;
        case 'POST perangkat_save':
            if ($id) {
                return $proyekPerangkat([$id]);
            }
            return $cekProyek(isset($req['proyek_id']) ? (int) $req['proyek_id'] : 0);
        case 'POST foto_upload':
        case 'POST perangkat_verif':
            return $proyekPerangkat([$id]);
        case 'POST foto_hapus':
        case 'POST perangkat_import':
        case 'POST perangkat_pulihkan':
            return $cekProyek(isset($req['proyek_id']) ? (int) $req['proyek_id'] : 0);
        case 'POST perangkat_delete':
        case 'POST perangkat_status_massal':
        case 'POST perangkat_kunci':
        case 'POST perangkat_kabel':
            return $proyekPerangkat(isset($req['ids']) && is_array($req['ids']) ? $req['ids'] : []);
        case 'POST perangkat_rename':
            $items = isset($req['items']) && is_array($req['items']) ? $req['items'] : [];
            return $proyekPerangkat(array_map(function ($it) { return is_array($it) && isset($it['id']) ? $it['id'] : 0; }, $items));
        case 'POST akses_save':
            if ($id) {
                return $proyekAkses($id);
            }
            return $cekProyek(isset($req['proyek_id']) ? (int) $req['proyek_id'] : 0);
        case 'POST akses_token_baru':
        case 'POST akses_delete':
            return $proyekAkses($id);
    }
    $tolak();
}

function find_proyek($id)
{
    $st = db()->prepare('SELECT * FROM np_proyek WHERE id = ?');
    $st->execute([$id]);
    $p = $st->fetch();
    if (!$p) {
        json_error('Proyek tidak ditemukan', 404);
    }
    return $p;
}

/** Jumlah perangkat (semua event) yang memakai tipe endpoint ini; id disimpan di atribut JSON "tipe_endpoint". */
function endpoint_dipakai($tipeId)
{
    $st = db()->prepare("SELECT COUNT(*) FROM np_perangkat WHERE jenis = 'endpoint' AND atribut LIKE ?");
    $st->execute(['%"tipe_endpoint":"' . (int) $tipeId . '"%']);
    return (int) $st->fetchColumn();
}

function find_akses($id)
{
    $st = db()->prepare('SELECT * FROM np_akses WHERE id = ?');
    $st->execute([$id]);
    $a = $st->fetch();
    if (!$a) {
        json_error('Akses tim tidak ditemukan', 404);
    }
    return $a;
}

function find_katalog($id)
{
    $st = db()->prepare('SELECT * FROM np_katalog WHERE id = ?');
    $st->execute([$id]);
    $k = $st->fetch();
    if (!$k) {
        json_error('Item katalog tidak ditemukan', 404);
    }
    return $k;
}

/** Id katalog yang benar-benar ada, atau null. */
function katalog_id_valid($v)
{
    if ($v === null || $v === '' || !is_numeric($v)) {
        return null;
    }
    $st = db()->prepare('SELECT id FROM np_katalog WHERE id = ?');
    $st->execute([(int) $v]);
    return $st->fetchColumn() ? (int) $v : null;
}

function date_field($arr, $key)
{
    $v = isset($arr[$key]) ? trim((string) $arr[$key]) : '';
    if ($v === '') {
        return null;
    }
    $d = DateTime::createFromFormat('!Y-m-d', $v);
    if (!$d || $d->format('Y-m-d') !== $v) {
        json_error('Format tanggal tidak valid');
    }
    return $v;
}

function hapus_file_denah($file)
{
    if ($file && preg_match('/^denah_[a-f0-9]+\.(png|jpg|webp|gif)$/', $file) && is_file(NP_UPLOAD_DIR . '/' . $file)) {
        @unlink(NP_UPLOAD_DIR . '/' . $file);
    }
}

/** Syarat SQL: perangkat di lantai $id (bukan F1). Lantai utama: konstanta SQL_LANTAI_UTAMA di db.php. */
function sql_lantai($id)
{
    return 'atribut LIKE ' . db()->quote('%"lantai":"' . $id . '"%');
}

/** Ukuran gambar denah [w, h] satu lantai event (F1 = kolom denah_* proyek). */
function dimensi_lantai($p, $lid)
{
    foreach ($lid === 'F1' ? [] : lantai_baca($p['lantai']) as $l) {
        if ($l['id'] === $lid) {
            return [(int) $l['denah_w'], (int) $l['denah_h']];
        }
    }
    return [(int) $p['denah_w'], (int) $p['denah_h']];
}

/** Terima & simpan file gambar denah dari $_FILES["denah"] (PNG/JPG/WEBP/GIF, maks. 30 MB) -> [nama file, lebar, tinggi]. */
function terima_gambar_denah()
{
    $f = isset($_FILES['denah']) ? $_FILES['denah'] : null;
    if (!$f || is_array($f['error'])) {
        json_error('Pilih file gambar denah');
    }
    if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE) {
        json_error('File terlalu besar (batas server ' . ini_get('upload_max_filesize') . ')', 413);
    }
    if ($f['error'] !== UPLOAD_ERR_OK) {
        json_error('Upload gagal (kode ' . $f['error'] . ')');
    }
    if ($f['size'] > 30 * 1024 * 1024) {
        json_error('File maksimal 30 MB', 413);
    }
    $info = @getimagesize($f['tmp_name']);
    $ext = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'];
    if (!$info || !isset($ext[$info[2]])) {
        json_error('Format denah harus PDF, PNG, JPG, WEBP, atau GIF. File CAD (DWG): ekspor dulu ke PDF.');
    }
    list($w, $h) = $info;
    if ($w < 50 || $h < 50 || $w > 20000 || $h > 20000) {
        json_error('Ukuran gambar tidak wajar (' . $w . '×' . $h . ' piksel)');
    }
    if (!is_dir(NP_UPLOAD_DIR)) {
        mkdir(NP_UPLOAD_DIR, 0755, true);
    }
    $name = 'denah_' . rand_hex(10) . '.' . $ext[$info[2]];
    if (!move_uploaded_file($f['tmp_name'], NP_UPLOAD_DIR . '/' . $name)) {
        json_error('Tidak bisa menyimpan file di folder uploads/', 500);
    }
    return [$name, $w, $h];
}

/** Simpan gambar denah baru. $sesuaikan: geser posisi perangkat & skala mengikuti ukuran gambar baru. */
function upload_denah($p, $sesuaikan)
{
    list($name, $w, $h) = terima_gambar_denah();

    $pdo = db();
    $pdo->beginTransaction();
    $oldW = (int) $p['denah_w'];
    $oldH = (int) $p['denah_h'];
    $skala = $p['skala'] === null ? null : (float) $p['skala'];
    if ($sesuaikan && $oldW > 0 && $oldH > 0 && ($oldW !== $w || $oldH !== $h)) {
        $fx = $w / $oldW;
        $fy = $h / $oldH;
        $pdo->prepare('UPDATE np_perangkat SET x = x * ?, y = y * ? WHERE proyek_id = ? AND ' . SQL_LANTAI_UTAMA)
            ->execute([$fx, $fy, $p['id']]);
        // Titik lekukan jalur kabel ikut diskalakan.
        $st = $pdo->prepare("SELECT id, jalur FROM np_perangkat WHERE proyek_id = ? AND jalur LIKE '%\"bebas\"%' AND " . SQL_LANTAI_UTAMA);
        $st->execute([$p['id']]);
        $upd = $pdo->prepare('UPDATE np_perangkat SET jalur = ? WHERE id = ?');
        foreach ($st->fetchAll() as $r) {
            $upd->execute([jalur_json(json_decode($r['jalur'], true), $fx, $fy), $r['id']]);
        }
        if ($skala !== null) {
            $skala = $skala * $oldW / $w;
        }
    } elseif (!$sesuaikan) {
        $skala = null; // denah berbeda: kalibrasi lama tidak berlaku
    }
    $pdo->prepare('UPDATE np_proyek SET denah_file = ?, denah_w = ?, denah_h = ?, skala = ? WHERE id = ?')
        ->execute([$name, $w, $h, $skala, $p['id']]);
    $pdo->commit();
    hapus_file_denah($p['denah_file']);
    return find_proyek($p['id']);
}

/** Validasi & simpan satu perangkat. Untuk perangkat lama, hanya isian yang dikirim yang diubah. */
function simpan_perangkat($req)
{
    $pdo = db();
    $id = isset($req['id']) ? (int) $req['id'] : 0;
    if ($id) {
        $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ?');
        $st->execute([$id]);
        $cur = $st->fetch();
        if (!$cur) {
            json_error('Perangkat tidak ditemukan (mungkin sudah dihapus)', 404);
        }
        $proyekId = (int) $cur['proyek_id'];
    } else {
        $proyekId = (int) find_proyek(isset($req['proyek_id']) ? (int) $req['proyek_id'] : 0)['id'];
        $cur = null;
    }

    $set = [];
    $has = function ($k) use ($req, $cur) {
        return array_key_exists($k, $req) || $cur === null;
    };
    if ($has('jenis')) {
        $jenis = isset($req['jenis']) ? (string) $req['jenis'] : '';
        if (!in_array($jenis, NP_JENIS, true)) {
            json_error('Jenis perangkat tidak dikenal');
        }
        $set['jenis'] = $jenis;
    }
    if ($has('nama')) {
        $set['nama'] = str_field($req, 'nama', 100, true, 'Nama perangkat');
    }
    foreach (['model' => [150, 'Merek/tipe'], 'ip' => [64, 'IP'], 'vlan' => [50, 'VLAN'],
        'port_uplink' => [50, 'Port uplink'], 'port_lokal' => [50, 'Port lokal'], 'pic' => [100, 'PIC']] as $k => $def) {
        if ($has($k)) {
            $set[$k] = str_field($req, $k, $def[0], false, $def[1]);
        }
    }
    if ($has('media')) {
        $m = isset($req['media']) ? (string) $req['media'] : '';
        $set['media'] = in_array($m, NP_MEDIA, true) ? $m : '';
    }
    if ($has('status')) {
        $s = isset($req['status']) ? (string) $req['status'] : 'rencana';
        $set['status'] = in_array($s, NP_STATUS, true) ? $s : 'rencana';
    }
    if ($has('bandwidth_mbps')) {
        $b = isset($req['bandwidth_mbps']) ? $req['bandwidth_mbps'] : null;
        if ($b === null || $b === '') {
            $set['bandwidth_mbps'] = null;
        } elseif (is_numeric($b) && $b >= 0 && $b < 100000000) {
            $set['bandwidth_mbps'] = round((float) $b, 2);
        } else {
            json_error('Bandwidth harus angka (Mbps)');
        }
    }
    if ($has('catatan')) {
        $set['catatan'] = text_field($req, 'catatan', 20000, 'Keterangan konfigurasi');
    }
    if ($has('atribut')) {
        $set['atribut'] = atribut_json(isset($req['atribut']) ? $req['atribut'] : []);
    }
    if ($has('jalur')) {
        $set['jalur'] = jalur_json(isset($req['jalur']) ? $req['jalur'] : null);
    }
    if ($has('katalog_id')) {
        $kid = isset($req['katalog_id']) ? $req['katalog_id'] : null;
        $set['katalog_id'] = katalog_id_valid($kid);
        if ($kid !== null && $kid !== '' && $set['katalog_id'] === null) {
            json_error('Item katalog tidak ditemukan');
        }
    }
    foreach (['x', 'y'] as $k) {
        if ($has($k)) {
            $v = isset($req[$k]) && is_numeric($req[$k]) ? (float) $req[$k] : 0;
            $set[$k] = max(-100000, min(100000, $v));
        }
    }
    if ($has('uplink_id')) {
        $up = isset($req['uplink_id']) && $req['uplink_id'] !== '' && $req['uplink_id'] !== null ? (int) $req['uplink_id'] : null;
        // Titik listrik bukan perangkat jaringan: tidak punya uplink.
        $jenisNow = isset($set['jenis']) ? $set['jenis'] : ($cur ? $cur['jenis'] : '');
        if (in_array($jenisNow, ['listrik', 'support'], true)) {
            $up = null;
        }
        if ($up !== null) {
            cek_uplink($proyekId, $id, $up);
        }
        $set['uplink_id'] = $up;
    }

    if ($cur) {
        if ($set) {
            $cols = implode(', ', array_map(function ($k) { return "$k = ?"; }, array_keys($set)));
            $pdo->prepare("UPDATE np_perangkat SET $cols WHERE id = ?")->execute(array_merge(array_values($set), [$id]));
            $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$proyekId]);
            // Perubahan status oleh admin ikut tercatat di riwayat (sama seperti perubahan oleh tim).
            if (isset($set['status']) && $set['status'] !== $cur['status']) {
                tulis_log($proyekId, ['id' => $id, 'nama' => isset($set['nama']) ? $set['nama'] : $cur['nama']], null, 'Admin',
                    $cur['status'], $set['status'], '');
            }
        }
    } else {
        $set['proyek_id'] = $proyekId;
        $cols = implode(', ', array_keys($set));
        $qs = implode(', ', array_fill(0, count($set), '?'));
        $pdo->prepare("INSERT INTO np_perangkat ($cols) VALUES ($qs)")->execute(array_values($set));
        $id = (int) $pdo->lastInsertId();
        $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$proyekId]);
    }
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ?');
    $st->execute([$id]);
    return perangkat_row($st->fetch());
}

/** Uplink harus satu proyek, bukan dirinya sendiri, dan tidak membentuk loop. */
function cek_uplink($proyekId, $selfId, $uplinkId)
{
    if ($selfId && $uplinkId === $selfId) {
        json_error('Perangkat tidak bisa menjadi uplink dirinya sendiri');
    }
    $st = db()->prepare('SELECT id, uplink_id FROM np_perangkat WHERE proyek_id = ?');
    $st->execute([$proyekId]);
    $parent = [];
    foreach ($st->fetchAll() as $r) {
        $parent[(int) $r['id']] = $r['uplink_id'] === null ? null : (int) $r['uplink_id'];
    }
    if (!array_key_exists($uplinkId, $parent)) {
        json_error('Perangkat uplink tidak ditemukan di proyek ini');
    }
    $st = db()->prepare('SELECT jenis FROM np_perangkat WHERE id = ?');
    $st->execute([$uplinkId]);
    if (in_array($st->fetchColumn(), ['listrik', 'support'], true)) {
        json_error('Titik listrik & peralatan support bukan perangkat jaringan — tidak bisa menjadi uplink');
    }
    $cur = $uplinkId;
    $guard = 0;
    while ($cur !== null && $guard++ < 5000) {
        if ($selfId && $cur === $selfId) {
            json_error('Tidak bisa: uplink tersebut berada di bawah perangkat ini (membentuk loop)');
        }
        $cur = isset($parent[$cur]) ? $parent[$cur] : null;
    }
}


/**
 * Isian unit gudang dari request (dipangkas & dibatasi panjangnya). $lama = baris unit saat ini: password yang tidak
 * diubah (tidak dikirim / tersamar "••••••") dipertahankan.
 */
function unit_isian($req, $lama)
{
    $teks = function ($k, $max) use ($req) {
        return mb_substr(trim(isset($req[$k]) ? (string) $req[$k] : ''), 0, $max);
    };
    $pass = isset($req['pass_admin']) ? (string) $req['pass_admin'] : null;
    $kondisi = isset($req['kondisi']) && in_array($req['kondisi'], NP_UNIT_KONDISI, true) ? $req['kondisi'] : ($lama ? $lama['kondisi'] : 'baik');
    return [
        'sn' => $teks('sn', 80), 'mac' => strtoupper($teks('mac', 40)), 'firmware' => $teks('firmware', 80), 'aset' => $teks('aset', 80),
        'ip_mgmt' => $teks('ip_mgmt', 80), 'user_admin' => $teks('user_admin', 80),
        'pass_admin' => $pass === null || $pass === '••••••' ? ($lama ? $lama['pass_admin'] : '') : mb_substr($pass, 0, 160),
        'kondisi' => $kondisi, 'lokasi' => $teks('lokasi', 120),
        'catatan' => mb_substr(isset($req['catatan']) ? (string) $req['catatan'] : '', 0, 4000),
    ];
}

/** Unit lain yang SN / MAC-nya sama dengan $v (di seluruh gudang): pesan, atau '' bila tidak ada. */
function unit_dobel($v, $kecuali)
{
    $pdo = db();
    if ($v['sn'] !== '') {
        $st = $pdo->prepare('SELECT k.merek, k.model FROM np_unit u JOIN np_katalog k ON k.id = u.katalog_id WHERE UPPER(u.sn) = UPPER(?) AND u.id <> ? LIMIT 1');
        $st->execute([$v['sn'], (int) $kecuali]);
        if ($r = $st->fetch()) {
            return 'SN ' . $v['sn'] . ' sudah tercatat di ' . trim($r['merek'] . ' ' . $r['model']);
        }
    }
    $mac = preg_replace('/[^0-9a-f]/', '', strtolower($v['mac']));
    if ($mac !== '') {
        $st = $pdo->prepare("SELECT k.merek, k.model FROM np_unit u JOIN np_katalog k ON k.id = u.katalog_id
            WHERE LOWER(REPLACE(REPLACE(REPLACE(REPLACE(u.mac, ':', ''), '-', ''), '.', ''), ' ', '')) = ? AND u.id <> ? LIMIT 1");
        $st->execute([$mac, (int) $kecuali]);
        if ($r = $st->fetch()) {
            return 'MAC ' . $v['mac'] . ' sudah tercatat di ' . trim($r['merek'] . ' ' . $r['model']);
        }
    }
    return '';
}

/** Tolak simpan bila SN / MAC sudah dipakai unit lain (satu unit fisik hanya dicatat sekali). */
function unit_cek_unik($v, $kecuali)
{
    $dobel = unit_dobel($v, $kecuali);
    if ($dobel) {
        json_error($dobel . ' — satu unit fisik hanya dicatat sekali');
    }
}

/**
 * Label & panah denah -> JSON tervalidasi atau NULL (kosong). Tiap label {id: "A1".., teks (maks. 500), warna,
 * x, y (posisi kotak), tx, ty (ujung panah), ke (id perangkat yang ditunjuk | null), lantai ("F1".. | ""),
 * panah (false = tanpa panah), kunci (true = posisi tidak bisa digeser)}; maks. 500 label.
 */
function anotasi_json($arr)
{
    $out = [];
    $ids = [];
    foreach (is_array($arr) ? array_slice($arr, 0, 500) : [] as $a) {
        $id = is_array($a) && isset($a['id']) ? (string) $a['id'] : '';
        if (!preg_match('/^A\d{1,6}$/', $id) || isset($ids[$id])) {
            continue;
        }
        $ids[$id] = true;
        $teks = mb_substr(trim(isset($a['teks']) ? (string) $a['teks'] : ''), 0, 500);
        $num = function ($k) use ($a) {
            return isset($a[$k]) && is_numeric($a[$k]) ? round(max(-50000, min(50000, (float) $a[$k])), 1) : 0;
        };
        $out[] = [
            'id' => $id,
            'teks' => $teks,
            'warna' => isset($a['warna']) && in_array($a['warna'], NP_ANOT_WARNA, true) ? $a['warna'] : 'hijau',
            'x' => $num('x'), 'y' => $num('y'), 'tx' => $num('tx'), 'ty' => $num('ty'),
            'ke' => isset($a['ke']) && is_numeric($a['ke']) && (int) $a['ke'] > 0 ? (int) $a['ke'] : null,
            'lantai' => isset($a['lantai']) && preg_match('/^F\d{1,3}$/', (string) $a['lantai']) ? (string) $a['lantai'] : '',
            'panah' => !isset($a['panah']) || $a['panah'] !== false,
            'kunci' => !empty($a['kunci']),
        ];
    }
    return $out ? json_encode($out, JSON_UNESCAPED_UNICODE) : null;
}

/**
 * Daftar layer jaringan -> JSON tervalidasi atau NULL (kosong = satu jaringan). Tiap layer {id: "L1".., nama, warna #rrggbb};
 * maks. 12 layer, id unik, nama wajib.
 */
function lapisan_json($arr)
{
    if (!is_array($arr) || !$arr) {
        return null;
    }
    if (count($arr) > 12) {
        json_error('Maksimal 12 layer jaringan per event');
    }
    $out = [];
    $ids = [];
    foreach ($arr as $l) {
        $lid = is_array($l) && isset($l['id']) ? (string) $l['id'] : '';
        if (!preg_match('/^L\d{1,3}$/', $lid) || isset($ids[$lid])) {
            json_error('ID layer tidak valid');
        }
        $ids[$lid] = true;
        $nama = str_field($l, 'nama', 60, true, 'Nama layer');
        $warna = isset($l['warna']) && preg_match('/^#[0-9a-fA-F]{6}$/', (string) $l['warna']) ? strtolower($l['warna']) : '#2563eb';
        $out[] = ['id' => $lid, 'nama' => $nama, 'warna' => $warna];
    }
    return json_encode($out, JSON_UNESCAPED_UNICODE);
}

function atribut_json($atr)
{
    if (!is_array($atr)) {
        return '{}';
    }
    $out = [];
    foreach ($atr as $k => $v) {
        if (count($out) >= 60 || !preg_match('/^[a-z0-9_]{1,40}$/', (string) $k) || is_array($v) || $v === null) {
            continue;
        }
        $v = trim((string) $v);
        if ($v === '') {
            continue;
        }
        // Daftar sambungan tambahan (JSON berisi port, status kabel & lekukan jalur) boleh lebih panjang.
        $maks = in_array($k, ['wan_lain', 'uplink_lain', 'ceklis', 'ceklis_x', 'mt', 'verif', 'vlan_port'], true) ? 20000 : 1000;
        if (mb_strlen($v) > $maks) {
            json_error('Isian "' . $k . '" maksimal ' . $maks . ' karakter');
        }
        $out[$k] = $v;
    }
    return json_encode((object) $out, JSON_UNESCAPED_UNICODE);
}

/**
 * Bentuk jalur kabel ke uplink -> JSON atau NULL (lurus).
 * {"m":"h"|"v"} = siku otomatis; {"m":"bebas","p":[[x,y],...]} = titik lekukan (koordinat denah), maks. 60 titik.
 */
function jalur_json($j, $fx = 1, $fy = 1)
{
    if (!is_array($j) || !isset($j['m']) || !in_array($j['m'], NP_JALUR, true)) {
        return null;
    }
    $out = ['m' => $j['m']];
    if ($j['m'] === 'bebas') {
        $pts = [];
        foreach (isset($j['p']) && is_array($j['p']) ? $j['p'] : [] as $pt) {
            if (count($pts) >= 60) {
                break;
            }
            if (is_array($pt) && isset($pt[0], $pt[1]) && is_numeric($pt[0]) && is_numeric($pt[1])) {
                $pts[] = [
                    round(max(-100000, min(100000, $pt[0] * $fx)), 1),
                    round(max(-100000, min(100000, $pt[1] * $fy)), 1),
                ];
            }
        }
        $out['p'] = $pts;
    }
    return json_encode($out);
}

/** Tambahkan daftar perangkat (dari ekspor/duplikat) ke proyek; relasi uplink dipetakan ke id baru. $petaId: id lama -> baru. */
function salin_perangkat($proyekId, $list, $idSemula = false, &$petaId = null)
{
    $pdo = db();
    $pdo->beginTransaction();
    $map = [];
    $uplinks = [];
    $ins = $pdo->prepare('INSERT INTO np_perangkat (id, proyek_id, jenis, nama, model, ip, vlan, port_uplink, port_lokal, media,
        bandwidth_mbps, status, pic, catatan, atribut, jalur, katalog_id, x, y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $ada = $pdo->prepare('SELECT 1 FROM np_perangkat WHERE id = ?');
    foreach ($list as $d) {
        if (!is_array($d)) {
            continue;
        }
        $jenis = isset($d['jenis']) && in_array($d['jenis'], NP_JENIS, true) ? $d['jenis'] : 'lainnya';
        $bw = isset($d['bandwidth_mbps']) && is_numeric($d['bandwidth_mbps']) ? (float) $d['bandwidth_mbps'] : null;
        // Pemulihan (batalkan hapus): pakai id semula bila id itu belum dipakai lagi; selain itu id baru.
        $idPakai = null;
        if ($idSemula && isset($d['id']) && (int) $d['id'] > 0) {
            $ada->execute([(int) $d['id']]);
            $idPakai = $ada->fetchColumn() ? null : (int) $d['id'];
        }
        $ins->execute([
            $idPakai, $proyekId, $jenis,
            str_field($d, 'nama', 100, true, 'Nama perangkat'),
            str_field($d, 'model', 150), str_field($d, 'ip', 64), str_field($d, 'vlan', 50),
            str_field($d, 'port_uplink', 50), str_field($d, 'port_lokal', 50),
            isset($d['media']) && in_array($d['media'], NP_MEDIA, true) ? $d['media'] : '',
            $bw,
            isset($d['status']) && in_array($d['status'], NP_STATUS, true) ? $d['status'] : 'rencana',
            str_field($d, 'pic', 100),
            text_field($d, 'catatan', 20000),
            atribut_json(isset($d['atribut']) ? $d['atribut'] : []),
            jalur_json(isset($d['jalur']) ? $d['jalur'] : null),
            katalog_id_valid(isset($d['katalog_id']) ? $d['katalog_id'] : null),
            isset($d['x']) && is_numeric($d['x']) ? (float) $d['x'] : 0,
            isset($d['y']) && is_numeric($d['y']) ? (float) $d['y'] : 0,
        ]);
        $newId = (int) $pdo->lastInsertId();
        if (isset($d['id'])) {
            $map[(int) $d['id']] = $newId;
            if (isset($d['uplink_id']) && $d['uplink_id'] !== null) {
                $uplinks[$newId] = (int) $d['uplink_id'];
            }
        }
    }
    $upd = $pdo->prepare('UPDATE np_perangkat SET uplink_id = ? WHERE id = ?');
    $updLuar = $pdo->prepare('UPDATE np_perangkat a JOIN np_perangkat b ON b.id = ? AND b.proyek_id = a.proyek_id
        SET a.uplink_id = b.id WHERE a.id = ?');
    foreach ($uplinks as $newId => $oldUp) {
        if (isset($map[$oldUp])) {
            $upd->execute([$map[$oldUp], $newId]);
        } elseif ($idSemula) {
            // Uplink-nya perangkat yang tidak ikut dihapus: sambungkan lagi bila masih ada di event yang sama.
            $updLuar->execute([$oldUp, $newId]);
        }
    }
    // Sambungan tambahan (wan_lain = WAN tambahan router, uplink_lain = uplink kedua switch): id tujuan ikut dipetakan
    // ke id baru (salin event, impor, buka backup). Saat pemulihan (id semula), id yang tidak ikut dipulihkan tetap
    // dipakai bila perangkatnya masih ada. Isian lain per sambungan (port, media, status kabel) dipertahankan.
    $atrUpd = $pdo->prepare('UPDATE np_perangkat SET atribut = ? WHERE id = ?');
    $modeKey = ['wan_lain' => 'wan_mode', 'uplink_lain' => 'uplink_mode'];
    foreach ($list as $d) {
        if (!is_array($d) || !isset($d['id'], $map[(int) $d['id']], $d['atribut']) || !is_array($d['atribut'])) {
            continue;
        }
        $atr = $d['atribut'];
        $ubah = false;
        foreach ($modeKey as $kunci => $mode) {
            if (empty($atr[$kunci])) {
                continue;
            }
            $ubah = true;
            $wl = json_decode((string) $atr[$kunci], true);
            $baru = [];
            foreach (is_array($wl) ? $wl : [] as $w) {
                $wid = is_array($w) && isset($w['id']) ? (int) $w['id'] : 0;
                if (isset($map[$wid])) {
                    $baru[] = ['id' => $map[$wid]] + $w;
                } elseif ($idSemula && $wid) {
                    $baru[] = $w;
                }
            }
            if ($baru) {
                $atr[$kunci] = json_encode(array_map(function ($w) { return array_merge($w, ['id' => (int) $w['id']]); }, $baru), JSON_UNESCAPED_UNICODE);
            } else {
                unset($atr[$kunci], $atr[$mode]);
            }
        }
        // Konfigurasi MikroTik router: pengaturan WAN disimpan per id Sumber WAN.
        if (!empty($atr['mt'])) {
            $mt = json_decode((string) $atr['mt'], true);
            if (is_array($mt) && !empty($mt['wan']) && is_array($mt['wan'])) {
                $wanBaru = [];
                foreach ($mt['wan'] as $wid => $w) {
                    if (isset($map[(int) $wid])) {
                        $wanBaru[(string) $map[(int) $wid]] = $w;
                    } elseif ($idSemula) {
                        $wanBaru[(string) $wid] = $w;
                    }
                }
                $mt['wan'] = (object) $wanBaru;
                $atr['mt'] = json_encode($mt, JSON_UNESCAPED_UNICODE);
                $ubah = true;
            }
        }
        // Titik listrik pemasok (atribut listrik_id) juga menunjuk id perangkat lain.
        if (!empty($atr['listrik_id'])) {
            $lid = (int) $atr['listrik_id'];
            $ubah = true;
            if (isset($map[$lid])) {
                $atr['listrik_id'] = (string) $map[$lid];
            } elseif (!$idSemula) {
                unset($atr['listrik_id']);
            }
        }
        if ($ubah) {
            $atrUpd->execute([atribut_json($atr), $map[(int) $d['id']]]);
        }
    }
    $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$proyekId]);
    $pdo->commit();
    $petaId = $map; // id lama -> id baru (mis. untuk menyalin foto bukti)
    return count($map) ?: count($list);
}

function duplikat_proyek($p)
{
    $pdo = db();
    $file = null;
    if ($p['denah_file'] && is_file(NP_UPLOAD_DIR . '/' . $p['denah_file'])) {
        $file = 'denah_' . rand_hex(10) . '.' . pathinfo($p['denah_file'], PATHINFO_EXTENSION);
        if (!copy(NP_UPLOAD_DIR . '/' . $p['denah_file'], NP_UPLOAD_DIR . '/' . $file)) {
            json_error('Tidak bisa menyalin file denah', 500);
        }
    }
    // Denah lantai tambahan juga disalin jadi file baru (menghapus salah satu event tidak memengaruhi yang lain).
    $lantai = lantai_baca(isset($p['lantai']) ? $p['lantai'] : null);
    foreach ($lantai as &$l) {
        $asal = $l['denah_file'];
        $l['denah_file'] = null;
        if ($asal && is_file(NP_UPLOAD_DIR . '/' . $asal)) {
            $baru = 'denah_' . rand_hex(10) . '.' . pathinfo($asal, PATHINFO_EXTENSION);
            if (copy(NP_UPLOAD_DIR . '/' . $asal, NP_UPLOAD_DIR . '/' . $baru)) {
                $l['denah_file'] = $baru;
            }
        }
    }
    unset($l);
    $nama = mb_substr($p['nama'], 0, 138) . ' (salinan)';
    $pdo->prepare('INSERT INTO np_proyek (nama, venue, tanggal_mulai, tanggal_selesai, catatan, denah_file, denah_w, denah_h,
            skala, slack_kabel, lapisan, lantai, kode_lihat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$nama, $p['venue'], $p['tanggal_mulai'], $p['tanggal_selesai'], $p['catatan'], $file,
            $p['denah_w'], $p['denah_h'], $p['skala'], $p['slack_kabel'], isset($p['lapisan']) ? $p['lapisan'] : null,
            count($lantai) > 1 ? json_encode($lantai, JSON_UNESCAPED_UNICODE) : null, rand_hex(12)]);
    $newId = (int) $pdo->lastInsertId();
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE proyek_id = ? ORDER BY id');
    $st->execute([$p['id']]);
    $rows = $st->fetchAll();
    $peta = []; // id perangkat lama -> baru (untuk panah label)
    if ($rows) {
        $list = array_map(function ($r) {
            $r['atribut'] = json_decode((string) $r['atribut'], true);
            $r['jalur'] = json_decode((string) $r['jalur'], true);
            return $r;
        }, $rows);
        salin_perangkat($newId, $list, false, $peta);
    }
    // Label & panah ikut disalin; panah yang menunjuk perangkat dipetakan ke perangkat salinannya.
    $anot = json_decode((string) (isset($p['anotasi']) ? $p['anotasi'] : ''), true);
    if (is_array($anot) && $anot) {
        foreach ($anot as &$a) {
            $a['ke'] = !empty($a['ke']) && isset($peta[(int) $a['ke']]) ? $peta[(int) $a['ke']] : null;
        }
        unset($a);
        $pdo->prepare('UPDATE np_proyek SET anotasi = ? WHERE id = ?')->execute([anotasi_json($anot), $newId]);
    }
    return find_proyek($newId);
}
