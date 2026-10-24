<?php
/**
 * Foto bukti pemasangan. Folder uploads/ tertutup dari browser, jadi foto hanya bisa diambil lewat sini.
 *
 * GET ?id=N            -> wajib login admin (admin event: hanya event miliknya)
 * GET ?id=N&k=KODE     -> link lihat-saja event foto tersebut
 * GET ?id=N&t=TOKEN    -> link akses tim event foto tersebut
 */
require __DIR__ . '/db.php';

$pdo = db();
$id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
$st = $pdo->prepare('SELECT f.file, f.proyek_id, p.kode_lihat FROM np_foto f JOIN np_proyek p ON p.id = f.proyek_id WHERE f.id = ?');
$st->execute([$id]);
$f = $st->fetch();
if (!$f) {
    json_error('Foto tidak ditemukan', 404);
}
if (isset($_GET['t'])) {
    $t = (string) $_GET['t'];
    $st = $pdo->prepare('SELECT 1 FROM np_akses WHERE token = ? AND aktif = 1 AND proyek_id = ?');
    $st->execute([$t, $f['proyek_id']]);
    if (!preg_match('/^[a-f0-9]{32}$/', $t) || !$st->fetch()) {
        json_error('Link tidak valid', 404);
    }
} elseif (isset($_GET['k'])) {
    $k = (string) $_GET['k'];
    if (!preg_match('/^[a-f0-9]{24}$/', $k) || !hash_equals((string) $f['kode_lihat'], $k)) {
        json_error('Link tidak valid', 404);
    }
} else {
    if (!start_admin_session()) {
        json_error('Silakan login terlebih dahulu', 401);
    }
    session_write_close();
    if (!boleh_proyek((int) $f['proyek_id'])) {
        json_error('Akses ditolak', 403);
    }
}
$path = NP_UPLOAD_DIR . '/' . $f['file'];
if (!preg_match('/^foto_[a-f0-9]+\.jpg$/', $f['file']) || !is_file($path)) {
    json_error('Foto tidak ditemukan', 404);
}

// Nama file unik per foto: aman di-cache lama oleh browser.
$etag = '"' . $f['file'] . '"';
header_remove('Cache-Control');
header('Cache-Control: private, max-age=31536000, immutable');
header('ETag: ' . $etag);
header('X-Content-Type-Options: nosniff');
if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && trim($_SERVER['HTTP_IF_NONE_MATCH']) === $etag) {
    http_response_code(304);
    exit;
}
header('Content-Type: image/jpeg');
header('Content-Length: ' . filesize($path));
if (isset($_GET['unduh'])) {
    header('Content-Disposition: attachment; filename="foto-' . $id . '.jpg"');
}
readfile($path);
