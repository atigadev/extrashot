<?php
/**
 * Pemulihan bila password admin utama yang diganti dari aplikasi terlupa. Jalankan lewat SSH / Terminal cPanel:
 *
 *   php net-plan/api/reset-admin.php
 *
 * Menghapus password admin utama yang tersimpan di database, sehingga login kembali memakai NP_ADMIN_PASS di
 * api/config.local.php (atau "admin" dari localhost bila belum diatur). Semua sesi admin utama ikut keluar.
 * Password admin event & data tidak berubah. Tidak bisa dibuka dari browser.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/db.php';

meta_set('admin_hash', null);
meta_set('admin_versi', rand_hex(8));
fwrite(STDOUT, 'Password admin utama direset. Login sekarang memakai '
    . (defined('NP_ADMIN_PASS') && NP_ADMIN_PASS !== '' ? 'NP_ADMIN_PASS di api/config.local.php' : '"admin" (hanya dari localhost)')
    . '. Segera ganti lagi lewat tombol "Ganti password".' . PHP_EOL);
