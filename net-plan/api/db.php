<?php
/**
 * Koneksi database & helper bersama API Net Plan.
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

define('NP_UPLOAD_DIR', dirname(__DIR__) . '/uploads');

/** Jenis perangkat yang dikenal (sama dengan NP.TYPES di assets/common.js). */
const NP_JENIS = ['isp', 'router', 'switch', 'ap', 'bridge', 'lan', 'server', 'cctv', 'lainnya'];
const NP_MEDIA = ['', 'utp', 'fiber', 'wireless', 'lainnya'];
const NP_STATUS = ['rencana', 'terpasang', 'diuji', 'bermasalah'];
/** Isian atribut yang disembunyikan dari link lihat-saja. */
const NP_RAHASIA = ['password', 'pass_admin'];
/** Versi struktur tabel; naikkan bila install_schema() menambah kolom. */
const NP_SCHEMA = 2;
/** Bentuk jalur kabel: h = siku (horizontal dulu), v = siku (vertikal dulu), bebas = titik lekukan manual. */
const NP_JALUR = ['h', 'v', 'bebas'];

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
    header('Content-Type: application/json; charset=utf-8');
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
    if (strlen($raw) > 4 * 1024 * 1024) {
        json_error('Data terlalu besar', 413);
    }
    $req = json_decode($raw, true);
    return is_array($req) ? $req : [];
}

/** Teks satu baris (spasi dirapikan). */
function str_field($arr, $key, $max, $required = false, $label = null)
{
    $v = isset($arr[$key]) && !is_array($arr[$key]) ? trim(preg_replace('/\s+/u', ' ', (string) $arr[$key])) : '';
    if ($required && $v === '') {
        json_error(($label ?: $key) . ' wajib diisi');
    }
    if (mb_strlen($v) > $max) {
        json_error(($label ?: $key) . ' maksimal ' . $max . ' karakter');
    }
    return $v;
}

/** Teks banyak baris (baris baru dipertahankan, untuk catatan konfigurasi). */
function text_field($arr, $key, $max, $label = null)
{
    $v = isset($arr[$key]) && !is_array($arr[$key]) ? trim(str_replace("\r\n", "\n", (string) $arr[$key])) : '';
    if (mb_strlen($v) > $max) {
        json_error(($label ?: $key) . ' maksimal ' . $max . ' karakter');
    }
    return $v;
}

function rand_hex($bytes)
{
    return bin2hex(random_bytes($bytes));
}

/** Path folder aplikasi di URL, mis. "/extra.saturegis/net-plan/" — dipakai untuk path cookie. */
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

/** Mulai sesi admin (cookie khusus folder aplikasi). */
function start_admin_session()
{
    session_name('npadmin');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => app_path(),
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
    return !empty($_SESSION['np_admin']);
}

function proyek_row($r)
{
    foreach (['id', 'denah_w', 'denah_h', 'slack_kabel'] as $k) {
        $r[$k] = $r[$k] === null ? null : (int) $r[$k];
    }
    $r['skala'] = $r['skala'] === null ? null : (float) $r['skala'];
    // Versi denah (berubah tiap upload) untuk URL gambar; nama file aslinya tidak dikirim ke browser.
    $r['denah_v'] = $r['denah_file'] ? substr(md5($r['denah_file']), 0, 10) : null;
    unset($r['denah_file']);
    return $r;
}

function perangkat_row($r, $sembunyikanRahasia = false)
{
    $r['id'] = (int) $r['id'];
    $r['proyek_id'] = (int) $r['proyek_id'];
    $r['uplink_id'] = $r['uplink_id'] === null ? null : (int) $r['uplink_id'];
    $r['bandwidth_mbps'] = $r['bandwidth_mbps'] === null ? null : (float) $r['bandwidth_mbps'];
    $r['x'] = (float) $r['x'];
    $r['y'] = (float) $r['y'];
    $r['catatan'] = (string) $r['catatan'];
    $atr = json_decode((string) $r['atribut'], true);
    $atr = is_array($atr) ? $atr : [];
    if ($sembunyikanRahasia) {
        foreach (NP_RAHASIA as $k) {
            if (isset($atr[$k]) && $atr[$k] !== '') {
                $atr[$k] = '••••••';
            }
        }
    }
    $r['atribut'] = (object) $atr;
    $jalur = isset($r['jalur']) ? json_decode((string) $r['jalur'], true) : null;
    $r['jalur'] = is_array($jalur) ? $jalur : null;
    return $r;
}

/** Data lengkap satu proyek: info + semua perangkat. */
function proyek_lengkap($proyek, $sembunyikanRahasia = false)
{
    $st = db()->prepare('SELECT * FROM np_perangkat WHERE proyek_id = ? ORDER BY id');
    $st->execute([$proyek['id']]);
    $list = [];
    foreach ($st->fetchAll() as $r) {
        $list[] = perangkat_row($r, $sembunyikanRahasia);
    }
    return ['proyek' => proyek_row($proyek), 'perangkat' => $list];
}

set_exception_handler(function ($e) {
    if ($e instanceof PDOException) {
        $code = $e->getCode();
        if ($code === '42S02') {
            json_error('Tabel Net Plan belum ada. Login ke halaman admin sekali untuk membuatnya otomatis.', 500);
        }
        if (in_array((string) $code, ['2002', '1045', '1049'], true)) {
            json_error('Tidak bisa terhubung ke database. Periksa api/config.local.php.', 500);
        }
    }
    error_log('[net-plan] ' . $e);
    json_error('Terjadi kesalahan server', 500);
});
