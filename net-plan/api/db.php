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
const NP_JENIS = ['isp', 'router', 'switch', 'ap', 'bridge', 'lan', 'server', 'cctv', 'endpoint', 'lainnya'];
/** Tipe endpoint bawaan: [nama, singkatan, warna, prefix nama, ikon]. Bisa diubah / ditambah di aplikasi. */
const NP_ENDPOINT_BAWAAN = [
    ['Laptop', 'LPT', '#0d9488', 'LPT', 'laptop'],
    ['Komputer / PC', 'PC', '#4f46e5', 'PC', 'pc'],
    ['Server', 'SVR', '#334155', 'SVR', 'server'],
    ['Printer network', 'PRN', '#a16207', 'PRN', 'printer'],
    ['Pinpad / EDC', 'EDC', '#9333ea', 'EDC', 'pinpad'],
    ['Scanner', 'SCN', '#0369a1', 'SCN', 'scanner'],
];
/** Ikon endpoint yang tersedia (sama dengan NP.IKON di assets/common.js). */
const NP_IKON = ['laptop', 'pc', 'server', 'printer', 'pinpad', 'scanner', 'tablet', 'telepon', 'tv', 'absensi', 'kamera', 'umum'];
const NP_MEDIA = ['', 'utp', 'fiber', 'wireless', 'lainnya'];
const NP_STATUS = ['rencana', 'terpasang', 'diuji', 'bermasalah'];
/** Isian atribut yang disembunyikan dari link lihat-saja. */
const NP_RAHASIA = ['password', 'pass_admin'];
/** Versi struktur tabel; naikkan setiap np_install_schema() berubah -> migrasi otomatis jalan setelah deploy. */
const NP_SCHEMA = 6;
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
        np_migrasi_otomatis($pdo);
    }
    return $pdo;
}

/**
 * Migrasi otomatis: versi struktur tersimpan di np_meta.schema. Bila kode baru (NP_SCHEMA) lebih tinggi — mis. setelah
 * deploy dari GitHub ke cPanel — request pertama (admin maupun link lihat-saja) menjalankan np_install_schema().
 * GET_LOCK memastikan hanya satu request yang memigrasi; request lain menunggu lalu memakai hasilnya.
 * Biaya per request saat sudah mutakhir: satu SELECT kecil.
 */
function np_migrasi_otomatis($pdo)
{
    $versi = function () use ($pdo) {
        try {
            return (int) $pdo->query("SELECT v FROM np_meta WHERE k = 'schema'")->fetchColumn();
        } catch (PDOException $e) {
            return 0; // np_meta belum ada: instalasi baru atau versi sebelum migrasi otomatis
        }
    };
    if ($versi() >= NP_SCHEMA) {
        return;
    }
    $kunci = (int) $pdo->query("SELECT GET_LOCK('np_migrasi', 30)")->fetchColumn();
    try {
        if ($versi() < NP_SCHEMA) { // cek ulang: request lain mungkin baru saja selesai memigrasi
            np_install_schema();
            $pdo->prepare("INSERT INTO np_meta (k, v) VALUES ('schema', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)")
                ->execute([(string) NP_SCHEMA]);
        }
    } catch (PDOException $e) {
        error_log('[net-plan] migrasi gagal: ' . $e->getMessage());
        json_error('Pembaruan struktur database gagal (' . $e->getMessage() . '). Pastikan user database punya hak CREATE, ALTER, INDEX.', 500);
    } finally {
        if ($kunci) {
            $pdo->query("SELECT RELEASE_LOCK('np_migrasi')");
        }
    }
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

/**
 * Buat / perbarui struktur tabel Net Plan. Idempoten: aman dijalankan berulang kali dan bersamaan.
 * - Tabel baru: CREATE TABLE IF NOT EXISTS (database/netplan.sql, definisi terbaru).
 * - Tabel dari versi lama: kolom/index yang belum ada ditambahkan; error "sudah ada" dari request lain yang
 *   menjalankan migrasi pada saat yang sama diabaikan.
 * Tidak pernah menghapus atau mengubah data. Kolom baru di versi berikutnya: tambahkan di netplan.sql DAN di sini.
 */
function np_install_schema()
{
    $pdo = db();
    $epBaru = !$pdo->query("SHOW TABLES LIKE 'np_endpoint_tipe'")->fetch();
    $sql = (string) file_get_contents(dirname(__DIR__) . '/database/netplan.sql');
    $sql = preg_replace('/--[^\n]*/', '', $sql);
    foreach (preg_split('/;\s*(\r?\n|$)/', $sql) as $stmt) {
        if (trim($stmt) !== '') {
            $pdo->exec($stmt);
        }
    }
    np_tambah_kolom('np_perangkat', 'jalur', 'TEXT NULL AFTER atribut');
    np_tambah_kolom('np_perangkat', 'katalog_id', 'INT UNSIGNED NULL AFTER jalur');
    np_tambah_index('np_perangkat', 'idx_np_perangkat_katalog', 'katalog_id');
    // Tipe endpoint bawaan: hanya saat tabelnya baru dibuat (tipe yang sengaja dihapus tidak muncul lagi).
    // INSERT IGNORE + UNIQUE(nama) -> tidak dobel walau dua request menjalankan migrasi bersamaan.
    np_tambah_kolom('np_endpoint_tipe', 'ikon', "VARCHAR(20) NOT NULL DEFAULT '' AFTER singkatan");
    if ($epBaru) {
        $ins = $pdo->prepare('INSERT IGNORE INTO np_endpoint_tipe (nama, singkatan, ikon, warna, prefix, urutan) VALUES (?, ?, ?, ?, ?, ?)');
        foreach (NP_ENDPOINT_BAWAAN as $i => $t) {
            $ins->execute([$t[0], $t[1], $t[4], $t[2], $t[3], $i + 1]);
        }
    }
    // Tipe bawaan dari versi tanpa ikon: isi ikonnya (hanya yang masih kosong, aman diulang).
    $upd = $pdo->prepare("UPDATE np_endpoint_tipe SET ikon = ? WHERE nama = ? AND ikon = ''");
    foreach (NP_ENDPOINT_BAWAAN as $t) {
        $upd->execute([$t[4], $t[0]]);
    }
}

function endpoint_tipe_list()
{
    try {
        $rows = db()->query('SELECT id, nama, singkatan, ikon, warna, prefix, urutan FROM np_endpoint_tipe ORDER BY urutan, nama')->fetchAll();
    } catch (PDOException $e) {
        return []; // tabel belum dibuat (belum ada login admin sejak update)
    }
    foreach ($rows as &$r) {
        $r['id'] = (int) $r['id'];
        $r['urutan'] = (int) $r['urutan'];
    }
    return $rows;
}

function np_tambah_kolom($tabel, $kolom, $definisi)
{
    // information_schema (bukan SHOW ... LIKE ?): placeholder tidak didukung pada SHOW dengan prepared statement asli.
    $st = db()->prepare('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $st->execute([$tabel, $kolom]);
    if ($st->fetch()) {
        return;
    }
    try {
        db()->exec("ALTER TABLE `$tabel` ADD COLUMN `$kolom` $definisi");
    } catch (PDOException $e) {
        // 1060 Duplicate column: request lain baru saja menambahkannya.
        if (!isset($e->errorInfo[1]) || (int) $e->errorInfo[1] !== 1060) {
            throw $e;
        }
    }
}

function np_tambah_index($tabel, $nama, $kolom)
{
    $st = db()->prepare('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?');
    $st->execute([$tabel, $nama]);
    if ($st->fetch()) {
        return;
    }
    try {
        db()->exec("ALTER TABLE `$tabel` ADD INDEX `$nama` (`$kolom`)");
    } catch (PDOException $e) {
        // 1061 Duplicate key name: request lain baru saja menambahkannya.
        if (!isset($e->errorInfo[1]) || (int) $e->errorInfo[1] !== 1061) {
            throw $e;
        }
    }
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
    $r['katalog_id'] = isset($r['katalog_id']) && $r['katalog_id'] !== null ? (int) $r['katalog_id'] : null;
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
    $katIds = [];
    foreach ($st->fetchAll() as $r) {
        $d = perangkat_row($r, $sembunyikanRahasia);
        $list[] = $d;
        if ($d['katalog_id']) {
            $katIds[$d['katalog_id']] = true;
        }
    }
    // Katalog yang dipakai event ini (untuk spesifikasi di link lihat-saja & pemeriksaan PoE/stok).
    $katalog = [];
    if ($katIds) {
        try {
            $in = implode(',', array_fill(0, count($katIds), '?'));
            $st = db()->prepare("SELECT * FROM np_katalog WHERE id IN ($in)");
            $st->execute(array_keys($katIds));
            foreach ($st->fetchAll() as $k) {
                $katalog[] = katalog_row($k, $sembunyikanRahasia);
            }
        } catch (PDOException $e) {
            // Tabel katalog belum dibuat (belum ada login admin sejak update): tampilkan tanpa katalog.
        }
    }
    return ['proyek' => proyek_row($proyek), 'perangkat' => $list, 'katalog' => $katalog, 'endpoint_tipe' => endpoint_tipe_list()];
}

function katalog_row($r, $sembunyikanRahasia = false)
{
    $r['id'] = (int) $r['id'];
    $r['stok'] = $r['stok'] === null ? null : (int) $r['stok'];
    $r['bandwidth_mbps'] = $r['bandwidth_mbps'] === null ? null : (float) $r['bandwidth_mbps'];
    foreach (['spesifikasi', 'konfigurasi'] as $k) {
        $v = json_decode((string) $r[$k], true);
        $r[$k] = is_array($v) ? $v : [];
    }
    if ($sembunyikanRahasia) {
        foreach (NP_RAHASIA as $k) {
            if (isset($r['konfigurasi'][$k]) && $r['konfigurasi'][$k] !== '') {
                $r['konfigurasi'][$k] = '••••••';
            }
        }
    }
    $r['spesifikasi'] = (object) $r['spesifikasi'];
    $r['konfigurasi'] = (object) $r['konfigurasi'];
    $r['catatan_konfig'] = (string) $r['catatan_konfig'];
    $r['keterangan'] = (string) $r['keterangan'];
    return $r;
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
