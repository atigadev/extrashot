<?php
/**
 * Salin file ini menjadi config.local.php (tidak ikut ke Git) lalu sesuaikan.
 * Tanpa file ini, aplikasi memakai database XAMPP standar dan admin hanya bisa login dari localhost
 * dengan password "admin".
 */
define('DB_HOST', 'localhost');
define('DB_NAME', 'userhosting_extradata');
define('DB_USER', 'userhosting_namauser');
define('DB_PASS', 'password-database');

// Password halaman admin Live Vote. Boleh teks biasa atau hash dari password_hash('...', PASSWORD_DEFAULT).
define('LV_ADMIN_PASS', 'ganti-dengan-password-kuat');
