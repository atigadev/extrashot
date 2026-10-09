<?php
/**
 * Data layar hasil (dibaca berkala oleh layar.html).
 *
 * GET ?k=KODE_LAYAR -> judul, pertanyaan, status, kode voting, perolehan tiap pilihan
 *
 * Memakai kode layar (rahasia, berbeda dari kode voting) agar pemilih tidak bisa mengintip hasil
 * bila admin tidak mengizinkannya.
 */
require __DIR__ . '/db.php';

$kode = preg_replace('/[^a-f0-9]/', '', isset($_GET['k']) ? (string) $_GET['k'] : '');
$st = db()->prepare('SELECT id, judul, pertanyaan, kode, mode, status FROM lv_sesi WHERE kode_layar = ?');
$st->execute([$kode]);
$sesi = $st->fetch();
if ($kode === '' || !$sesi) {
    json_error('Layar hasil tidak ditemukan. Periksa link dari halaman admin.', 404);
}

$out = [
    'ok' => true,
    'sesi' => [
        'judul' => $sesi['judul'],
        'pertanyaan' => $sesi['pertanyaan'],
        'kode' => $sesi['kode'],
        'mode' => $sesi['mode'],
        'status' => $sesi['status'],
    ],
] + tally((int) $sesi['id']);

if ($sesi['mode'] === 'undangan') {
    $st = db()->prepare('SELECT COUNT(*) FROM lv_pemilih WHERE sesi_id = ?');
    $st->execute([(int) $sesi['id']]);
    $out['terdaftar'] = (int) $st->fetchColumn();
}
json_out($out);
