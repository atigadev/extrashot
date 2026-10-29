<?php
/**
 * Unduh file konfigurasi / backup milik unit gudang. Folder uploads/ tertutup dari browser, jadi file hanya bisa diambil
 * lewat sini, dan hanya oleh admin (file konfigurasi bisa berisi password — tidak tersedia di link lihat-saja / tim).
 *
 * GET ?id=N  -> wajib login admin (admin event: hanya unit yang sedang dipakai event miliknya)
 */
require __DIR__ . '/db.php';

$pdo = db();
$id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
if (!start_admin_session()) {
    json_error('Silakan login terlebih dahulu', 401);
}
session_write_close();
$st = $pdo->prepare('SELECT b.file, b.nama, d.proyek_id FROM np_berkas b JOIN np_unit u ON u.id = b.unit_id LEFT JOIN np_perangkat d ON d.id = u.perangkat_id WHERE b.id = ?');
$st->execute([$id]);
$f = $st->fetch();
if (!$f) {
    json_error('File tidak ditemukan', 404);
}
if (!is_super() && ($f['proyek_id'] === null || !boleh_proyek((int) $f['proyek_id']))) {
    json_error('Akses ditolak', 403);
}
$path = NP_UPLOAD_DIR . '/' . $f['file'];
if (!preg_match('/^berkas_[a-f0-9]+\.bin$/', $f['file']) || !is_file($path)) {
    json_error('File tidak ditemukan', 404);
}

// Selalu diunduh sebagai lampiran (tidak pernah ditampilkan / dijalankan di browser).
$nama = str_replace(['"', "\r", "\n"], '', (string) $f['nama']);
header_remove('Cache-Control');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
header('Content-Type: application/octet-stream');
header('Content-Length: ' . filesize($path));
header('Content-Disposition: attachment; filename="' . preg_replace('/[^\x20-\x7e]/', '_', $nama) . '"; filename*=UTF-8\'\'' . rawurlencode($nama));
readfile($path);
