<?php
/**
 * Gambar denah proyek. Folder uploads/ tertutup dari browser, jadi gambar hanya bisa diambil lewat sini.
 *
 * GET ?id=N        -> wajib login admin
 * GET ?k=KODE      -> link lihat-saja
 */
require __DIR__ . '/db.php';

$pdo = db();
if (isset($_GET['k'])) {
    $k = (string) $_GET['k'];
    if (!preg_match('/^[a-f0-9]{24}$/', $k)) {
        json_error('Link tidak valid', 404);
    }
    $st = $pdo->prepare('SELECT denah_file FROM np_proyek WHERE kode_lihat = ?');
    $st->execute([$k]);
} else {
    if (!start_admin_session()) {
        json_error('Silakan login terlebih dahulu', 401);
    }
    session_write_close();
    $st = $pdo->prepare('SELECT denah_file FROM np_proyek WHERE id = ?');
    $st->execute([isset($_GET['id']) ? (int) $_GET['id'] : 0]);
}
$file = $st->fetchColumn();
$path = $file ? NP_UPLOAD_DIR . '/' . $file : '';
if (!$file || !preg_match('/^denah_[a-f0-9]+\.(png|jpg|webp|gif)$/', $file, $m) || !is_file($path)) {
    json_error('Denah tidak ditemukan', 404);
}

// Nama file unik per upload, jadi aman di-cache lama oleh browser (URL memakai ?v=nama file).
$etag = '"' . $file . '"';
header_remove('Cache-Control');
header('Cache-Control: private, max-age=31536000, immutable');
header('ETag: ' . $etag);
if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && trim($_SERVER['HTTP_IF_NONE_MATCH']) === $etag) {
    http_response_code(304);
    exit;
}
$types = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif'];
header('Content-Type: ' . $types[$m[1]]);
header('Content-Length: ' . filesize($path));
readfile($path);
