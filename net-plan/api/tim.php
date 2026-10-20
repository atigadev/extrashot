<?php
/**
 * API akses tim (link bertoken dari admin, tanpa login).
 *
 * GET  ?t=TOKEN                       -> {akses, proyek, perangkat, katalog, endpoint_tipe}
 * GET  ?t=TOKEN&action=log[&id=N]     -> riwayat event / perangkat N
 * POST {"t":TOKEN,"action":"status","id":N,"status":"terpasang","catatan":"..."}  (peran "status")
 * POST {"t":TOKEN,"action":"catatan","id":N,"catatan":"..."}                     (peran "status")
 *
 * Tim hanya boleh mengubah status yang diizinkan admin (status_boleh) pada kategori tugasnya (jenis_boleh; kosong = semua).
 * POST wajib header "X-NP: 1" (pengaman CSRF, sama seperti admin).
 */
require __DIR__ . '/db.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'POST') {
    if (!isset($_SERVER['HTTP_X_NP']) || $_SERVER['HTTP_X_NP'] !== '1') {
        json_error('Permintaan ditolak', 403);
    }
    $req = json_body();
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
    'nama' => $akses['nama'], 'peran' => $akses['peran'], 'status_boleh' => $akses['status_boleh'],
    'jenis_boleh' => $akses['jenis_boleh'], 'lihat_password' => $akses['lihat_password'],
];

if ($method === 'GET' && $action === '') {
    json_out(['ok' => true, 'akses' => $infoAkses] + proyek_lengkap($proyek, !$akses['lihat_password']));
}

if ($method === 'GET' && $action === 'log') {
    $pid = isset($req['id']) ? (int) $req['id'] : 0;
    json_out(['ok' => true, 'log' => log_list($proyek['id'], $pid ?: null, $pid ? 50 : 100)]);
}

if ($method === 'POST' && ($action === 'status' || $action === 'catatan')) {
    if ($akses['peran'] !== 'status') {
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

json_error('Aksi tidak dikenal', 404);
