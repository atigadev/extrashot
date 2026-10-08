<?php
/**
 * Koneksi database & helper JSON untuk API.
 * Kredensial bawaan = XAMPP standar. Untuk server lain, salin db.local.example.php menjadi
 * db.local.php lalu isi kredensialnya (file itu tidak ikut ke Git).
 */
if (is_file(__DIR__ . '/db.local.php')) {
    require __DIR__ . '/db.local.php';
}
defined('DB_HOST') || define('DB_HOST', '127.0.0.1');
defined('DB_NAME') || define('DB_NAME', 'extradata');
defined('DB_USER') || define('DB_USER', 'root');
defined('DB_PASS') || define('DB_PASS', '');

define('LOGO_MAX_BYTES', 1024 * 1024);

function db()
{
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
            DB_USER,
            DB_PASS,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
    }
    return $pdo;
}

function json_out($data, $code = 200)
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error($msg, $code = 400)
{
    json_out(['ok' => false, 'error' => $msg], $code);
}

function json_body()
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function str_or_null($v, $max = 255)
{
    $v = trim((string) $v);
    return $v === '' ? null : mb_substr($v, 0, $max);
}

/** Validasi file logo yang diunggah; mengembalikan [isi, mime] atau null bila tidak ada file. */
function uploaded_logo($field = 'logo')
{
    if (empty($_FILES[$field]) || $_FILES[$field]['error'] === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    $f = $_FILES[$field];
    if ($f['error'] !== UPLOAD_ERR_OK) {
        json_error('Upload logo gagal (kode ' . $f['error'] . ')');
    }
    if ($f['size'] > LOGO_MAX_BYTES) {
        json_error('Ukuran logo maksimal 1 MB');
    }
    $data = file_get_contents($f['tmp_name']);
    $allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
    $mime = (new finfo(FILEINFO_MIME_TYPE))->buffer($data);
    if ($mime === 'text/xml' || $mime === 'image/svg' || ($mime === 'text/plain' && stripos($data, '<svg') !== false)) {
        $mime = 'image/svg+xml';
    }
    if (!in_array($mime, $allowed, true)) {
        json_error('Format logo harus PNG, JPG, GIF, WEBP, atau SVG');
    }
    return [$data, $mime];
}

set_exception_handler(function ($e) {
    if ($e instanceof PDOException) {
        $msg = $e->getCode() === '23000' ? 'Data sudah ada atau masih dipakai' : 'Kesalahan database: ' . $e->getMessage();
        json_error($msg, 500);
    }
    json_error($e->getMessage(), 500);
});
