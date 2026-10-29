<?php
/**
 * API akses tim (link bertoken dari admin, tanpa login).
 *
 * GET  ?t=TOKEN                       -> {akses, proyek, perangkat, katalog, endpoint_tipe}
 * GET  ?t=TOKEN&action=log[&id=N]     -> riwayat event / perangkat N
 * POST {"t":TOKEN,"action":"status","id":N,"status":"terpasang","catatan":"..."}  (peran "status")
 * POST {"t":TOKEN,"action":"catatan","id":N,"catatan":"..."}                     (peran "status" / "cek")
 * POST {"t":TOKEN,"action":"status_massal","ids":[N,...],"status":"diuji","catatan":"..."} (peran "status")
 * POST {"t":TOKEN,"action":"kabel","ids":[N,...],"kabel":"ditarik","catatan":"..."} (peran "status") -> status penarikan kabel
 * POST {"t":TOKEN,"action":"ceklis","id":N,"item":"k_ssid","cek":true,"label":"SSID & password"} (peran "status") -> ceklis pekerjaan
 * POST multipart t, action=foto, id=N, foto=<jpeg>, lat, lng, akurasi, waktu (peran "status" / "cek") -> foto bukti (maks. 3 per perangkat)
 * POST {"t":TOKEN,"action":"foto_hapus","id":N} (peran "status" / "cek") -> hapus foto yang diambil tim ini
 * POST {"t":TOKEN,"action":"verif","id":N,"hasil":"sesuai"|"tidak"|"","catatan":"..."} (peran "cek") -> hasil pengecekan penempatan
 * POST {"t":TOKEN,"action":"tambah","jenis":"ap","nama":"AP-12","x":..,"y":..,"lantai":"F2","model":"..","uplink_id":N,"catatan":".."}
 *      (peran "installer") -> usulan alat baru (status "usulan"); admin memutuskan bisa dipasang (-> rencana) atau ditolak
 * POST {"t":TOKEN,"action":"usulan_hapus","id":N} (peran "installer") -> tarik usulan sendiri yang belum diputuskan admin
 * GET  ?t=TOKEN&action=katalog | unit_list&katalog_id=N (peran "installer") -> katalog alat & stok gudang
 * POST {"t":TOKEN,"action":"simpan","id":N, nama, model, ip, vlan, port_*, media, uplink_id, katalog_id, atribut, ...}
 *      (peran "installer") -> ubah isian tab Identitas / Koneksi / jenis perangkat (status, posisi, layer, lantai: admin)
 * POST {"t":TOKEN,"action":"unit_pasang","perangkat_id":N,"unit_id":M} | unit_lepas | unit_save (peran "installer")
 *      -> pasang / lepas / ubah data unit gudang di titik tugasnya
 *
 * Peran: lihat (baca saja) | status (ubah status, kabel, ceklis, foto, catatan) | installer (hak "status" + mengusulkan
 * alat baru di denah) | cek (checker: pengecekan penempatan sesuai plan, foto bukti, catatan).
 * Perangkat berstatus "usulan" belum bisa diubah statusnya oleh tim sampai disetujui admin.
 *
 * Tim hanya boleh mengubah status yang diizinkan admin (status_boleh) pada kategori tugasnya (jenis_boleh; kosong = semua).
 * POST wajib header "X-NP: 1" (pengaman CSRF, sama seperti admin).
 */
require __DIR__ . '/db.php';
require __DIR__ . '/perangkat.inc.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'POST') {
    if (!isset($_SERVER['HTTP_X_NP']) || $_SERVER['HTTP_X_NP'] !== '1') {
        json_error('Permintaan ditolak', 403);
    }
    // Foto bukti dikirim multipart (file + koordinat); aksi lain JSON.
    $req = isset($_SERVER['CONTENT_TYPE']) && stripos($_SERVER['CONTENT_TYPE'], 'multipart/form-data') === 0 ? $_POST : json_body();
} elseif ($method === 'GET') {
    $req = $_GET;
} else {
    json_error('Metode tidak didukung', 405);
}

$token = isset($req['t']) ? (string) $req['t'] : '';
if (!preg_match('/^[a-f0-9]{32}$/', $token)) {
    json_error('Link tim tidak valid', 404);
}
$pdo = db();
$st = $pdo->prepare('SELECT * FROM np_akses WHERE token = ?');
$st->execute([$token]);
$akses = $st->fetch();
if (!$akses || !(int) $akses['aktif']) {
    json_error('Link tim tidak berlaku lagi. Minta link baru ke project manager.', 404);
}
$akses = akses_row($akses);
$pdo->prepare('UPDATE np_akses SET terakhir_dipakai = NOW() WHERE id = ?')->execute([$akses['id']]);

$st = $pdo->prepare('SELECT * FROM np_proyek WHERE id = ?');
$st->execute([$akses['proyek_id']]);
$proyek = $st->fetch();
if (!$proyek) {
    json_error('Event tidak ditemukan', 404);
}
$action = isset($req['action']) ? (string) $req['action'] : '';
$infoAkses = [
    'id' => (int) $akses['id'], 'nama' => $akses['nama'], 'peran' => $akses['peran'], 'status_boleh' => $akses['status_boleh'],
    'jenis_boleh' => $akses['jenis_boleh'], 'lihat_password' => $akses['lihat_password'],
];

// Installer = tim pemasang: semua hak "update status" + mengusulkan alat baru.
$bisaUbah = in_array($akses['peran'], ['status', 'installer'], true);

if ($method === 'GET' && $action === '') {
    json_out(['ok' => true, 'akses' => $infoAkses] + proyek_lengkap($proyek, !$akses['lihat_password']));
}

if ($method === 'GET' && $action === 'log') {
    $pid = isset($req['id']) ? (int) $req['id'] : 0;
    json_out(['ok' => true, 'log' => log_list($proyek['id'], $pid ?: null, $pid ? 50 : 100)]);
}

if ($method === 'POST' && $action === 'status_massal') {
    // Ubah status banyak perangkat: hanya status yang diizinkan, perangkat di luar tugas tim dilewati.
    if (!$bisaUbah) {
        json_error('Akses tim ini hanya untuk melihat', 403);
    }
    $ids = isset($req['ids']) && is_array($req['ids']) ? array_values(array_unique(array_map('intval', $req['ids']))) : [];
    $baru = isset($req['status']) ? (string) $req['status'] : '';
    if (!$ids || count($ids) > 1000) {
        json_error('Tidak ada perangkat yang dipilih');
    }
    if (!in_array($baru, $akses['status_boleh'], true)) {
        json_error('"' . $akses['nama'] . '" tidak diizinkan mengubah status menjadi "' . $baru . '"', 403);
    }
    $catatan = text_field($req, 'catatan', 2000, 'Catatan');
    $in = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT * FROM np_perangkat WHERE proyek_id = ? AND id IN ($in)");
    $st->execute(array_merge([$proyek['id']], $ids));
    $pdo->beginTransaction();
    $upd = $pdo->prepare('UPDATE np_perangkat SET status = ? WHERE id = ?');
    $hasil = [];
    $dilewati = 0;
    foreach ($st->fetchAll() as $d) {
        if (($akses['jenis_boleh'] && !in_array($d['jenis'], $akses['jenis_boleh'], true)) || $d['status'] === 'usulan') {
            $dilewati++;
            continue;
        }
        if ($d['status'] !== $baru) {
            $upd->execute([$baru, $d['id']]);
            tulis_log($proyek['id'], $d, $akses['id'], $akses['nama'], $d['status'], $baru, $catatan);
            $d['status'] = $baru;
        }
        $hasil[] = perangkat_row($d, !$akses['lihat_password']);
    }
    $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$proyek['id']]);
    $pdo->commit();
    json_out(['ok' => true, 'perangkat' => $hasil, 'dilewati' => $dilewati]);
}

if ($method === 'POST' && $action === 'verif') {
    // Checker: hasil pengecekan penempatan (sesuai / tidak sesuai plan) + catatan, kategori tugasnya.
    if ($akses['peran'] !== 'cek') {
        json_error('Hanya checker yang bisa mengisi hasil pengecekan', 403);
    }
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ? AND proyek_id = ?');
    $st->execute([isset($req['id']) ? (int) $req['id'] : 0, $proyek['id']]);
    $d = $st->fetch();
    if (!$d) {
        json_error('Perangkat tidak ditemukan (mungkin sudah dihapus)', 404);
    }
    if ($akses['jenis_boleh'] && !in_array($d['jenis'], $akses['jenis_boleh'], true)) {
        json_error($d['nama'] . ' di luar tugas "' . $akses['nama'] . '"', 403);
    }
    $row = set_verif($d, isset($req['hasil']) ? (string) $req['hasil'] : '', text_field($req, 'catatan', 2000, 'Catatan'), $akses['nama'], $akses['id'], isset($req['waktu']) ? (string) $req['waktu'] : '');
    json_out(['ok' => true, 'perangkat' => perangkat_row($row, !$akses['lihat_password'])]);
}

if ($method === 'POST' && ($action === 'foto' || $action === 'foto_hapus')) {
    // Foto bukti pemasangan: perangkat di kategori tugas tim; tim hanya menghapus foto yang diambilnya sendiri.
    if (!$bisaUbah && $akses['peran'] !== 'cek') {
        json_error('Akses tim ini hanya untuk melihat', 403);
    }
    if ($action === 'foto_hapus') {
        json_out(['ok' => true, 'foto' => hapus_foto((int) $proyek['id'], isset($req['id']) ? (int) $req['id'] : 0, $akses['id'])]);
    }
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ? AND proyek_id = ?');
    $st->execute([isset($req['id']) ? (int) $req['id'] : 0, $proyek['id']]);
    $d = $st->fetch();
    if (!$d) {
        json_error('Perangkat tidak ditemukan (mungkin sudah dihapus)', 404);
    }
    if ($akses['jenis_boleh'] && !in_array($d['jenis'], $akses['jenis_boleh'], true)) {
        json_error($d['nama'] . ' di luar tugas "' . $akses['nama'] . '"', 403);
    }
    json_out(['ok' => true, 'foto' => simpan_foto($d, $req, $akses['nama'], $akses['id'])]);
}

if ($method === 'POST' && $action === 'ceklis') {
    // Centang / batal centang satu item ceklis pekerjaan (item yang disimpan di atribut "ceklis"), kategori tugas tim.
    if (!$bisaUbah) {
        json_error('Akses tim ini hanya untuk melihat', 403);
    }
    $item = isset($req['item']) ? (string) $req['item'] : '';
    if (!preg_match('/^[a-z0-9_]{1,40}$/', $item)) {
        json_error('Item ceklis tidak dikenal');
    }
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ? AND proyek_id = ?');
    $st->execute([isset($req['id']) ? (int) $req['id'] : 0, $proyek['id']]);
    $d = $st->fetch();
    if (!$d) {
        json_error('Perangkat tidak ditemukan (mungkin sudah dihapus)', 404);
    }
    if ($akses['jenis_boleh'] && !in_array($d['jenis'], $akses['jenis_boleh'], true)) {
        json_error($d['nama'] . ' di luar tugas "' . $akses['nama'] . '"', 403);
    }
    $atr = json_decode((string) $d['atribut'], true);
    $atr = is_array($atr) ? $atr : [];
    $cek = isset($atr['ceklis']) ? json_decode((string) $atr['ceklis'], true) : [];
    $cek = is_array($cek) ? $cek : [];
    $nyala = !empty($req['cek']);
    if ($nyala) {
        $cek[$item] = ['t' => date('Y-m-d H:i'), 'o' => $akses['nama']];
    } else {
        unset($cek[$item]);
    }
    if ($cek) {
        $atr['ceklis'] = json_encode($cek, JSON_UNESCAPED_UNICODE);
    } else {
        unset($atr['ceklis']);
    }
    $pdo->prepare('UPDATE np_perangkat SET atribut = ? WHERE id = ?')->execute([atribut_json_db($atr), $d['id']]);
    $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$proyek['id']]);
    $label = isset($req['label']) ? mb_substr(trim((string) $req['label']), 0, 120) : $item;
    tulis_log($proyek['id'], $d, $akses['id'], $akses['nama'], '', '', 'Ceklis: ' . $label . ($nyala ? ' ✓' : ' (dibatalkan)'));
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ?');
    $st->execute([$d['id']]);
    json_out(['ok' => true, 'perangkat' => perangkat_row($st->fetch(), !$akses['lihat_password'])]);
}

if ($method === 'POST' && $action === 'kabel') {
    // Status penarikan kabel (satu / banyak perangkat): tim update status, hanya kategori tugasnya.
    if (!$bisaUbah) {
        json_error('Akses tim ini hanya untuk melihat', 403);
    }
    $ids = isset($req['ids']) && is_array($req['ids']) ? array_values(array_unique(array_map('intval', $req['ids']))) : [];
    if (!$ids || count($ids) > 2000) {
        json_error('Tidak ada perangkat yang dipilih');
    }
    $jenisBoleh = $akses['jenis_boleh'];
    $lihatPass = $akses['lihat_password'];
    if (!empty($req['ke'])) {
        // Sambungan tambahan (WAN tambahan / uplink kedua) satu perangkat.
        list($hasil, $dilewati) = ubah_kabel_lain($proyek['id'], $ids[0], isset($req['kunci']) ? (string) $req['kunci'] : '', (int) $req['ke'],
            isset($req['kabel']) ? (string) $req['kabel'] : '', $akses['id'], $akses['nama'], text_field($req, 'catatan', 2000, 'Catatan'),
            function ($d) use ($jenisBoleh) { return !$jenisBoleh || in_array($d['jenis'], $jenisBoleh, true); });
        json_out(['ok' => true, 'perangkat' => array_map(function ($d) use ($lihatPass) { return perangkat_row($d, !$lihatPass); }, $hasil),
            'dilewati' => $dilewati]);
    }
    list($hasil, $dilewati) = ubah_kabel_massal($proyek['id'], $ids, isset($req['kabel']) ? (string) $req['kabel'] : '', $akses['id'],
        $akses['nama'], text_field($req, 'catatan', 2000, 'Catatan'),
        function ($d) use ($jenisBoleh) { return !$jenisBoleh || in_array($d['jenis'], $jenisBoleh, true); });
    $lihatPass = $akses['lihat_password'];
    json_out(['ok' => true, 'perangkat' => array_map(function ($d) use ($lihatPass) { return perangkat_row($d, !$lihatPass); }, $hasil),
        'dilewati' => $dilewati]);
}

if ($method === 'POST' && ($action === 'status' || $action === 'catatan')) {
    if (!$bisaUbah && !($akses['peran'] === 'cek' && $action === 'catatan')) {
        json_error('Akses tim ini hanya untuk melihat', 403);
    }
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ? AND proyek_id = ?');
    $st->execute([isset($req['id']) ? (int) $req['id'] : 0, $proyek['id']]);
    $d = $st->fetch();
    if (!$d) {
        json_error('Perangkat tidak ditemukan (mungkin sudah dihapus)', 404);
    }
    if ($akses['jenis_boleh'] && !in_array($d['jenis'], $akses['jenis_boleh'], true)) {
        json_error($d['nama'] . ' di luar tugas "' . $akses['nama'] . '"', 403);
    }
    $catatan = text_field($req, 'catatan', 2000, 'Catatan');
    $baru = $d['status'];
    if ($action === 'status') {
        $baru = isset($req['status']) ? (string) $req['status'] : '';
        if (!in_array($baru, $akses['status_boleh'], true)) {
            json_error('"' . $akses['nama'] . '" tidak diizinkan mengubah status menjadi "' . $baru . '"', 403);
        }
        if ($d['status'] === 'usulan') {
            json_error($d['nama'] . ' masih usulan — tunggu keputusan admin sebelum mengubah statusnya', 409);
        }
        if ($baru !== $d['status']) {
            $pdo->prepare('UPDATE np_perangkat SET status = ? WHERE id = ?')->execute([$baru, $d['id']]);
            $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$proyek['id']]);
        }
    } elseif ($catatan === '') {
        json_error('Catatan masih kosong');
    }
    if ($baru !== $d['status'] || $catatan !== '') {
        tulis_log($proyek['id'], $d, $akses['id'], $akses['nama'], $d['status'], $baru, $catatan);
    }
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ?');
    $st->execute([$d['id']]);
    json_out(['ok' => true, 'perangkat' => perangkat_row($st->fetch(), !$akses['lihat_password'])]);
}

// ------------------------------------------------------------------ installer: ubah data perangkat & unit gudang

/** Perangkat tugas installer ini (event sama, kategori tugasnya), atau berhenti dengan galat. */
$perangkatTugas = function ($pid) use ($pdo, $akses, $proyek) {
    if ($akses['peran'] !== 'installer') {
        json_error('Hanya installer yang bisa mengubah data perangkat', 403);
    }
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ? AND proyek_id = ?');
    $st->execute([(int) $pid, $proyek['id']]);
    $d = $st->fetch();
    if (!$d) {
        json_error('Perangkat tidak ditemukan (mungkin sudah dihapus)', 404);
    }
    if ($akses['jenis_boleh'] && !in_array($d['jenis'], $akses['jenis_boleh'], true)) {
        json_error($d['nama'] . ' di luar tugas "' . $akses['nama'] . '"', 403);
    }
    return $d;
};
$unitEvent = function () use ($proyek, $akses) {
    return unit_list(['proyek' => (int) $proyek['id']], !$akses['lihat_password']);
};

if ($method === 'GET' && $action === 'katalog') {
    // Installer memilih alat katalog di tab Identitas: semua katalog (password tersamar bila tidak boleh lihat).
    if ($akses['peran'] !== 'installer') {
        json_error('Akses ditolak', 403);
    }
    $out = [];
    foreach ($pdo->query('SELECT * FROM np_katalog ORDER BY jenis, merek, model')->fetchAll() as $r) {
        $out[] = katalog_row($r, !$akses['lihat_password']);
    }
    json_out(['ok' => true, 'katalog' => $out]);
}

if ($method === 'GET' && $action === 'unit_list') {
    // Stok gudang satu alat katalog (untuk dipasang di titik tugas installer).
    if ($akses['peran'] !== 'installer') {
        json_error('Akses ditolak', 403);
    }
    json_out(['ok' => true, 'unit' => unit_list(['katalog' => isset($req['katalog_id']) ? (int) $req['katalog_id'] : 0], !$akses['lihat_password'])]);
}

if ($method === 'POST' && $action === 'simpan') {
    // Isian tab Identitas / Koneksi / jenis perangkat. Status, posisi, kunci, lantai, layer, ceklis, verifikasi & data
    // usulan tetap milik admin / aksi masing-masing; password tersamar tidak menimpa password asli.
    $d = $perangkatTugas(isset($req['id']) ? $req['id'] : 0);
    $isi = ['id' => (int) $d['id']];
    foreach (['nama', 'model', 'ip', 'vlan', 'port_uplink', 'port_lokal', 'media', 'bandwidth_mbps', 'catatan', 'pic', 'katalog_id', 'uplink_id', 'jalur'] as $k) {
        if (array_key_exists($k, $req)) {
            $isi[$k] = $req[$k];
        }
    }
    if (array_key_exists('jenis', $req) && $req['jenis'] !== $d['jenis']) {
        if ($req['jenis'] === 'lan_gedung' || ($akses['jenis_boleh'] && !in_array($req['jenis'], $akses['jenis_boleh'], true))) {
            json_error('Kategori ini di luar tugas "' . $akses['nama'] . '"', 403);
        }
        $isi['jenis'] = $req['jenis'];
    }
    if (isset($req['atribut']) && is_array($req['atribut'])) {
        $lama = json_decode((string) $d['atribut'], true);
        $lama = is_array($lama) ? $lama : [];
        $baru = $req['atribut'];
        $tetap = ['kunci', 'lantai', 'lapisan', 'kabel', 'ceklis', 'ceklis_x', 'verif', 'usulan_oleh', 'usulan_akses', 'usulan_waktu'];
        if (!$akses['lihat_password']) {
            $tetap[] = 'mt'; // konfigurasi MikroTik berisi password PPPoE
            foreach (NP_RAHASIA as $k) {
                if (isset($baru[$k]) && $baru[$k] === '••••••') {
                    $tetap[] = $k;
                }
            }
        }
        foreach ($tetap as $k) {
            unset($baru[$k]);
            if (isset($lama[$k])) {
                $baru[$k] = $lama[$k];
            }
        }
        $isi['atribut'] = $baru;
    }
    $simpan = simpan_perangkat($isi);
    // Ganti / lepas alat katalog = unit gudang lama kembali ke gudang (sama seperti admin).
    $pdo->prepare('UPDATE np_unit SET perangkat_id = NULL WHERE perangkat_id = ? AND NOT (katalog_id <=> ?)')
        ->execute([$d['id'], $simpan['katalog_id']]);
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ?');
    $st->execute([$d['id']]);
    json_out(['ok' => true, 'perangkat' => perangkat_row($st->fetch(), !$akses['lihat_password']), 'unit' => $unitEvent()]);
}

if ($method === 'POST' && ($action === 'unit_pasang' || $action === 'unit_lepas')) {
    $d = $perangkatTugas(isset($req['perangkat_id']) ? $req['perangkat_id'] : 0);
    if ($action === 'unit_pasang') {
        $u = find_unit(isset($req['unit_id']) ? (int) $req['unit_id'] : 0);
        if ((int) $u['katalog_id'] !== (int) $d['katalog_id']) {
            json_error('Unit ini dari alat katalog lain — pilih alat katalog yang sama di tab Identitas dulu');
        }
        if ($u['perangkat_id'] !== null && (int) $u['perangkat_id'] !== (int) $d['id']) {
            json_error('Unit ini sedang dipakai perangkat lain — lepas dulu di sana');
        }
        if ($u['kondisi'] === 'rusak') {
            json_error('Unit ini berstatus rusak — tidak bisa dipasang');
        }
    }
    $pdo->beginTransaction();
    $pdo->prepare('UPDATE np_unit SET perangkat_id = NULL WHERE perangkat_id = ?')->execute([$d['id']]);
    if ($action === 'unit_pasang') {
        $pdo->prepare('UPDATE np_unit SET perangkat_id = ? WHERE id = ?')->execute([$d['id'], $u['id']]);
    }
    $pdo->commit();
    json_out(['ok' => true, 'unit' => $unitEvent()]);
}

if ($method === 'POST' && $action === 'unit_save') {
    // Data unit yang sedang terpasang di titik tugas installer (SN, MAC, firmware, IP, catatan konfigurasi...).
    $u = find_unit(isset($req['id']) ? (int) $req['id'] : 0);
    if ($u['perangkat_id'] === null) {
        json_error('Unit ini tidak terpasang di event ini', 403);
    }
    $perangkatTugas($u['perangkat_id']);
    $v = unit_isian($req, $u);
    if (!$akses['lihat_password']) {
        $v['pass_admin'] = $u['pass_admin'];
    }
    unit_cek_unik($v, (int) $u['id']);
    $pdo->prepare('UPDATE np_unit SET sn = ?, mac = ?, firmware = ?, aset = ?, ip_mgmt = ?, user_admin = ?, pass_admin = ?, kondisi = ?,
        lokasi = ?, catatan = ? WHERE id = ?')->execute([$v['sn'], $v['mac'], $v['firmware'], $v['aset'], $v['ip_mgmt'], $v['user_admin'],
        $v['pass_admin'], $v['kondisi'], $v['lokasi'], $v['catatan'], $u['id']]);
    json_out(['ok' => true, 'unit' => unit_list(['id' => (int) $u['id']], !$akses['lihat_password'])[0]]);
}

if ($method === 'POST' && $action === 'tambah') {
    // Installer menemukan / membutuhkan alat yang belum ada di plan: dicatat sebagai usulan, admin yang memutuskan.
    if ($akses['peran'] !== 'installer') {
        json_error('Hanya installer yang bisa menambah alat', 403);
    }
    $jenis = isset($req['jenis']) ? (string) $req['jenis'] : '';
    if (!in_array($jenis, NP_JENIS, true) || $jenis === 'lan_gedung') {
        json_error('Jenis perangkat tidak dikenal');
    }
    if ($akses['jenis_boleh'] && !in_array($jenis, $akses['jenis_boleh'], true)) {
        json_error('Kategori ini di luar tugas "' . $akses['nama'] . '"', 403);
    }
    $st = $pdo->prepare("SELECT COUNT(*) FROM np_perangkat WHERE proyek_id = ? AND status = 'usulan'");
    $st->execute([$proyek['id']]);
    if ((int) $st->fetchColumn() >= 300) {
        json_error('Usulan alat baru terlalu banyak — minta admin memutuskan usulan yang ada dulu');
    }
    $atr = ['usulan_oleh' => $akses['nama'], 'usulan_akses' => (string) $akses['id'], 'usulan_waktu' => (string) $pdo->query('SELECT NOW()')->fetchColumn()];
    $lantai = isset($req['lantai']) ? (string) $req['lantai'] : '';
    if ($lantai !== '' && $lantai !== 'F1') {
        $ada = false;
        foreach (lantai_baca($proyek['lantai']) as $l) {
            $ada = $ada || $l['id'] === $lantai;
        }
        if (!$ada) {
            json_error('Lantai tidak ditemukan');
        }
        $atr['lantai'] = $lantai;
    }
    $up = isset($req['uplink_id']) && $req['uplink_id'] !== '' && $req['uplink_id'] !== null ? (int) $req['uplink_id'] : null;
    if ($up !== null && !in_array($jenis, ['listrik', 'support', 'furniture'], true)) {
        $st = $pdo->prepare('SELECT id FROM np_perangkat WHERE id = ? AND proyek_id = ?');
        $st->execute([$up, $proyek['id']]);
        if (!$st->fetch()) {
            json_error('Perangkat uplink tidak ditemukan');
        }
    } else {
        $up = null;
    }
    $nama = str_field($req, 'nama', 100, true, 'Nama perangkat');
    $model = str_field($req, 'model', 150, false, 'Merek/tipe');
    $catatan = text_field($req, 'catatan', 2000, 'Catatan');
    $koor = function ($k) use ($req) {
        return isset($req[$k]) && is_numeric($req[$k]) ? max(-100000, min(100000, (float) $req[$k])) : 0;
    };
    $pdo->prepare("INSERT INTO np_perangkat (proyek_id, jenis, nama, model, status, x, y, uplink_id, atribut) VALUES (?, ?, ?, ?, 'usulan', ?, ?, ?, ?)")
        ->execute([$proyek['id'], $jenis, $nama, $model, $koor('x'), $koor('y'), $up, atribut_json_db($atr)]);
    $id = (int) $pdo->lastInsertId();
    $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$proyek['id']]);
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ?');
    $st->execute([$id]);
    $d = $st->fetch();
    tulis_log($proyek['id'], $d, $akses['id'], $akses['nama'], '', 'usulan', $catatan !== '' ? $catatan : 'Usulan alat baru');
    json_out(['ok' => true, 'perangkat' => perangkat_row($d, !$akses['lihat_password'])]);
}

if ($method === 'POST' && $action === 'usulan_hapus') {
    // Installer menarik usulannya sendiri selama admin belum memutuskan.
    $st = $pdo->prepare("SELECT * FROM np_perangkat WHERE id = ? AND proyek_id = ? AND status = 'usulan'");
    $st->execute([isset($req['id']) ? (int) $req['id'] : 0, $proyek['id']]);
    $d = $st->fetch();
    $atr = $d ? json_decode((string) $d['atribut'], true) : null;
    if (!$d || !is_array($atr) || !isset($atr['usulan_akses']) || (int) $atr['usulan_akses'] !== (int) $akses['id']) {
        json_error('Usulan tidak ditemukan atau sudah diputuskan admin', 404);
    }
    $pdo->beginTransaction();
    $pdo->prepare('UPDATE np_perangkat SET uplink_id = NULL WHERE uplink_id = ?')->execute([$d['id']]);
    $pdo->prepare('DELETE FROM np_perangkat WHERE id = ?')->execute([$d['id']]);
    tulis_log($proyek['id'], $d, $akses['id'], $akses['nama'], 'usulan', '', 'Usulan ditarik');
    $pdo->commit();
    json_out(['ok' => true]);
}

json_error('Aksi tidak dikenal', 404);
