<?php
/**
 * Gambar denah proyek. Folder uploads/ tertutup dari browser, jadi gambar hanya bisa diambil lewat sini.
 *
 * GET ?id=N        -> wajib login admin (admin event: hanya event miliknya)
 * GET ?k=KODE      -> link lihat-saja
 * GET ?t=TOKEN     -> link akses tim
 * &lantai=F2       -> denah lantai lain (default: denah utama / F1)
 */
require __DIR__ . '/db.php';

$pdo = db();
if (isset($_GET['t'])) {
    // Link tim (akses aktif saja).
    $t = (string) $_GET['t'];
    if (!preg_match('/^[a-f0-9]{32}$/', $t)) {
        json_error('Link tidak valid', 404);
    }
    $st = $pdo->prepare('SELECT p.denah_file, p.lantai FROM np_akses a JOIN np_proyek p ON p.id = a.proyek_id WHERE a.token = ? AND a.aktif = 1');
    $st->execute([$t]);
} elseif (isset($_GET['k'])) {
    $k = (string) $_GET['k'];
    if (!preg_match('/^[a-f0-9]{24}$/', $k)) {
        json_error('Link tidak valid', 404);
    }
    $st = $pdo->prepare('SELECT denah_file, lantai FROM np_proyek WHERE kode_lihat = ?');
    $st->execute([$k]);
} else {
    if (!start_admin_session()) {
        json_error('Silakan login terlebih dahulu', 401);
    }
    session_write_close();
    $pid = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if (!boleh_proyek($pid)) {
        json_error('Akses ditolak', 403); // admin event hanya boleh denah event miliknya
    }
    $st = $pdo->prepare('SELECT denah_file, lantai FROM np_proyek WHERE id = ?');
    $st->execute([$pid]);
}
$row = $st->fetch();
$file = $row ? $row['denah_file'] : null;
$lid = isset($_GET['lantai']) ? (string) $_GET['lantai'] : 'F1';
if ($row && $lid !== 'F1') {
    $file = null;
    foreach (lantai_baca($row['lantai']) as $l) {
        if ($l['id'] === $lid) {
            $file = $l['denah_file'];
        }
    }
}
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
