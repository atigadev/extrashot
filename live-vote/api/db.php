<?php
/**
 * Koneksi database & helper bersama API Live Vote.
 * Kredensial bawaan = XAMPP standar. Untuk server lain, salin config.local.example.php menjadi
 * config.local.php lalu isi kredensialnya (file itu tidak ikut ke Git).
 */
if (is_file(__DIR__ . '/config.local.php')) {
    require __DIR__ . '/config.local.php';
}
defined('DB_HOST') || define('DB_HOST', '127.0.0.1');
defined('DB_NAME') || define('DB_NAME', 'extradata');
defined('DB_USER') || define('DB_USER', 'root');
defined('DB_PASS') || define('DB_PASS', '');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

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
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error($msg, $code = 400, $extra = [])
{
    json_out(['ok' => false, 'error' => $msg] + $extra, $code);
}

/** Body JSON dari request POST. */
function json_body()
{
    $raw = file_get_contents('php://input');
    if (strlen($raw) > 512 * 1024) {
        json_error('Data terlalu besar', 413);
    }
    $req = json_decode($raw, true);
    return is_array($req) ? $req : [];
}

function str_field($arr, $key, $max, $required = false, $label = null)
{
    $v = isset($arr[$key]) ? trim(preg_replace('/\s+/u', ' ', (string) $arr[$key])) : '';
    if ($required && $v === '') {
        json_error(($label ?: $key) . ' wajib diisi');
    }
    if (mb_strlen($v) > $max) {
        json_error(($label ?: $key) . ' maksimal ' . $max . ' karakter');
    }
    return $v;
}

/** Token acak heksadesimal. */
function rand_hex($bytes)
{
    return bin2hex(random_bytes($bytes));
}

/** Kode pendek mudah diketik (tanpa huruf/angka yang mirip: 0 O 1 I L). */
function rand_code($len = 6)
{
    $chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    $out = '';
    for ($i = 0; $i < $len; $i++) {
        $out .= $chars[random_int(0, strlen($chars) - 1)];
    }
    return $out;
}

/** Path folder aplikasi di URL, mis. "/extra.saturegis/live-vote/" — dipakai untuk path cookie. */
function app_path()
{
    $dir = str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME'])));
    return rtrim($dir, '/') . '/';
}

function is_https()
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
}

/** Jumlah suara per pilihan untuk satu sesi. */
function tally($sesiId)
{
    $st = db()->prepare('SELECT p.id, p.label, COUNT(s.id) AS jumlah
        FROM lv_pilihan p LEFT JOIN lv_suara s ON s.pilihan_id = p.id
        WHERE p.sesi_id = ? GROUP BY p.id, p.label, p.urutan ORDER BY p.urutan, p.id');
    $st->execute([$sesiId]);
    $rows = $st->fetchAll();
    $total = 0;
    foreach ($rows as &$r) {
        $r['id'] = (int) $r['id'];
        $r['jumlah'] = (int) $r['jumlah'];
        $total += $r['jumlah'];
    }
    return ['pilihan' => $rows, 'total' => $total];
}

set_exception_handler(function ($e) {
    if ($e instanceof PDOException) {
        $code = $e->getCode();
        if ($code === '42S02') {
            json_error('Tabel Live Vote belum ada. Login ke halaman admin sekali untuk membuatnya otomatis.', 500);
        }
        if ($code === 2002 || $code === 1045 || $code === 1049 || $code === '2002' || $code === '1045' || $code === '1049') {
            json_error('Tidak bisa terhubung ke database. Periksa api/config.local.php.', 500);
        }
    }
    error_log('[live-vote] ' . $e);
    json_error('Terjadi kesalahan server', 500);
});
