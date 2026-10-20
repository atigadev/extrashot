<?php
/**
 * API lihat-saja (tanpa login) untuk teknisi lapangan.
 *
 * GET ?k=KODE_LIHAT -> {proyek, perangkat:[...]} ; password di atribut disamarkan.
 */
require __DIR__ . '/db.php';

$k = isset($_GET['k']) ? (string) $_GET['k'] : '';
if (!preg_match('/^[a-f0-9]{24}$/', $k)) {
    json_error('Link tidak valid', 404);
}
$st = db()->prepare('SELECT * FROM np_proyek WHERE kode_lihat = ?');
$st->execute([$k]);
$p = $st->fetch();
if (!$p) {
    json_error('Link tidak ditemukan atau sudah diganti oleh admin', 404);
}
json_out(['ok' => true] + proyek_lengkap($p, true));
