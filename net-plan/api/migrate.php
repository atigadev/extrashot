<?php
/**
 * Jalankan migrasi database Net Plan dari terminal / langkah deploy cPanel:
 *
 *   php net-plan/api/migrate.php
 *
 * Tidak wajib: migrasi juga berjalan otomatis pada request pertama setelah deploy (lihat np_migrasi_otomatis di db.php).
 * Skrip ini berguna agar struktur database sudah mutakhir tepat saat deploy, dan menampilkan error bila gagal.
 * Idempoten — aman dijalankan berulang kali.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404); // hanya untuk terminal, tidak bisa dibuka dari browser
    exit;
}
require __DIR__ . '/db.php';

$pdo = db(); // menjalankan migrasi otomatis bila versi database tertinggal
$versi = $pdo->query("SELECT v FROM np_meta WHERE k = 'schema'")->fetchColumn();
$tabel = $pdo->query("SHOW TABLES LIKE 'np\\_%'")->fetchAll(PDO::FETCH_COLUMN);
fwrite(STDOUT, 'Net Plan: struktur database versi ' . $versi . ' (kode ' . NP_SCHEMA . '), tabel: ' . implode(', ', $tabel) . PHP_EOL);
exit((int) $versi === NP_SCHEMA ? 0 : 1);
