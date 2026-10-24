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
const NP_JENIS = ['isp', 'router', 'switch', 'ap', 'bridge', 'lan', 'server', 'cctv', 'endpoint', 'lainnya', 'listrik', 'support'];
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
/** Status penarikan kabel ke uplink (atribut "kabel"; kosong = belum). Sama dengan NP.KABEL di assets/common.js. */
const NP_KABEL = ['belum', 'ditarik', 'terminasi', 'dites', 'bermasalah'];
/** Isian atribut yang disembunyikan dari link lihat-saja. */
const NP_RAHASIA = ['password', 'pass_admin'];
/** Versi struktur tabel; naikkan setiap np_install_schema() berubah -> migrasi otomatis jalan setelah deploy. */
const NP_SCHEMA = 9;
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
    return sesi_valid();
}

/**
 * Peran sesi admin:
 * - admin utama  : $_SESSION['np_admin'] = 1 -> semua event.
 * - admin event  : $_SESSION['np_proyek'] = [id => sidik hash password] -> hanya event tersebut. Sidik dicek tiap
 *                  request, jadi bila password event diganti/dihapus, sesi lama otomatis tidak berlaku.
 * Hasil disimpan di $GLOBALS['NP_PERAN'] ('super' | 'event' | '') dan $GLOBALS['NP_PROYEK'] (id event admin event).
 */
function sesi_valid()
{
    $GLOBALS['NP_PERAN'] = '';
    $GLOBALS['NP_PROYEK'] = [];
    if (!empty($_SESSION['np_admin'])) {
        // Password admin utama diganti -> versi berubah -> sesi dengan password lama gugur.
        $v = isset($_SESSION['np_admin_v']) ? (string) $_SESSION['np_admin_v'] : '0';
        if (!hash_equals(meta_get('admin_versi', '0'), $v)) {
            unset($_SESSION['np_admin'], $_SESSION['np_admin_v']);
            return false;
        }
        $GLOBALS['NP_PERAN'] = 'super';
        return true;
    }
    $sesi = isset($_SESSION['np_proyek']) && is_array($_SESSION['np_proyek']) ? $_SESSION['np_proyek'] : [];
    if (!$sesi) {
        return false;
    }
    $ids = array_map('intval', array_keys($sesi));
    $in = implode(',', array_fill(0, count($ids), '?'));
    $st = db()->prepare("SELECT id, admin_hash FROM np_proyek WHERE id IN ($in) AND admin_hash IS NOT NULL");
    $st->execute($ids);
    $valid = [];
    foreach ($st->fetchAll() as $r) {
        if (hash_equals((string) $sesi[(int) $r['id']], sidik_password($r['admin_hash']))) {
            $valid[(int) $r['id']] = $sesi[(int) $r['id']];
        }
    }
    if (count($valid) !== count($sesi)) {
        $_SESSION['np_proyek'] = $valid; // buang event yang passwordnya sudah berubah / dihapus
    }
    if (!$valid) {
        return false;
    }
    $GLOBALS['NP_PERAN'] = 'event';
    $GLOBALS['NP_PROYEK'] = array_keys($valid);
    return true;
}

/** Nilai np_meta (pengaturan aplikasi: versi skema, password admin utama, ...). */
function meta_get($k, $bawaan = '')
{
    $st = db()->prepare('SELECT v FROM np_meta WHERE k = ?');
    $st->execute([$k]);
    $v = $st->fetchColumn();
    return $v === false ? $bawaan : (string) $v;
}

function meta_set($k, $v)
{
    if ($v === null) {
        db()->prepare('DELETE FROM np_meta WHERE k = ?')->execute([$k]);
        return;
    }
    db()->prepare('INSERT INTO np_meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)')->execute([$k, (string) $v]);
}

/**
 * Cocokkan password admin utama. Urutan: password yang diganti dari aplikasi (np_meta.admin_hash) ->
 * NP_ADMIN_PASS di config.local.php -> "admin" hanya dari localhost bila belum ada keduanya.
 */
function cek_password_super($password)
{
    $dbHash = meta_get('admin_hash');
    if ($dbHash !== '') {
        return password_verify($password, $dbHash);
    }
    if (defined('NP_ADMIN_PASS') && NP_ADMIN_PASS !== '') {
        $hash = NP_ADMIN_PASS;
        return strpos($hash, '$2y$') === 0 || strpos($hash, '$argon2') === 0
            ? password_verify($password, $hash)
            : hash_equals($hash, $password);
    }
    $local = isset($_SERVER['REMOTE_ADDR']) && in_array($_SERVER['REMOTE_ADDR'], ['127.0.0.1', '::1'], true);
    return $local && hash_equals('admin', $password);
}

/** Sidik pendek dari hash password (bukan password-nya) untuk mendeteksi password yang diganti. */
function sidik_password($hash)
{
    return substr(hash('sha256', (string) $hash), 0, 32);
}

function is_super()
{
    return isset($GLOBALS['NP_PERAN']) && $GLOBALS['NP_PERAN'] === 'super';
}

/** Admin utama boleh semua event; admin event hanya event miliknya. */
function boleh_proyek($proyekId)
{
    return is_super() || in_array((int) $proyekId, isset($GLOBALS['NP_PROYEK']) ? $GLOBALS['NP_PROYEK'] : [], true);
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
    np_tambah_kolom('np_proyek', 'admin_hash', 'VARCHAR(255) NULL AFTER kode_lihat');
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
    // Password admin event: hanya status "sudah diatur", hash-nya tidak pernah dikirim ke browser.
    $r['ada_password'] = !empty($r['admin_hash']);
    unset($r['denah_file'], $r['admin_hash']);
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
        // Konfigurasi MikroTik (atribut "mt", JSON): password PPPoE per WAN ikut disamarkan.
        if (!empty($atr['mt'])) {
            $mt = json_decode((string) $atr['mt'], true);
            if (is_array($mt) && isset($mt['wan']) && is_array($mt['wan'])) {
                foreach ($mt['wan'] as $wid => $w) {
                    if (is_array($w) && isset($w['pass']) && $w['pass'] !== '') {
                        $mt['wan'][$wid]['pass'] = '••••••';
                    }
                }
                $atr['mt'] = json_encode($mt, JSON_UNESCAPED_UNICODE);
            }
        }
    }
    $r['atribut'] = (object) $atr;
    $jalur = isset($r['jalur']) ? json_decode((string) $r['jalur'], true) : null;
    $r['jalur'] = is_array($jalur) ? $jalur : null;
    return $r;
}

/** Data lengkap satu proyek: info + semua perangkat. */
/** Catat aktivitas (perubahan status / catatan lapangan). $aksesId null = admin. */
function tulis_log($proyekId, $perangkat, $aksesId, $oleh, $lama, $baru, $catatan)
{
    db()->prepare('INSERT INTO np_log (proyek_id, perangkat_id, perangkat_nama, akses_id, oleh, status_lama, status_baru, catatan)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$proyekId, $perangkat ? (int) $perangkat['id'] : null, $perangkat ? $perangkat['nama'] : '', $aksesId, $oleh,
            (string) $lama, (string) $baru, $catatan === '' ? null : $catatan]);
}

/**
 * Ubah status penarikan kabel banyak perangkat (kabel ke uplinknya) + catat di riwayat ("kabel:lama" -> "kabel:baru").
 * $filter(row) -> false untuk melewati perangkat (mis. di luar tugas tim). Hasil: [baris perangkat yang diproses, jumlah dilewati].
 */
function ubah_kabel_massal($proyekId, $ids, $baru, $aksesId, $oleh, $catatan, $filter = null)
{
    if (!in_array($baru, NP_KABEL, true)) {
        json_error('Status kabel tidak dikenal');
    }
    $pdo = db();
    $in = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT * FROM np_perangkat WHERE proyek_id = ? AND id IN ($in)");
    $st->execute(array_merge([$proyekId], $ids));
    $pdo->beginTransaction();
    $upd = $pdo->prepare('UPDATE np_perangkat SET atribut = ? WHERE id = ?');
    $hasil = [];
    $dilewati = 0;
    foreach ($st->fetchAll() as $d) {
        // Hanya perangkat yang punya kabel ke uplink (bukan wireless).
        if ($d['uplink_id'] === null || $d['media'] === 'wireless' || ($filter && !$filter($d))) {
            $dilewati++;
            continue;
        }
        $atr = json_decode((string) $d['atribut'], true);
        $atr = is_array($atr) ? $atr : [];
        $lama = isset($atr['kabel']) && in_array($atr['kabel'], NP_KABEL, true) ? $atr['kabel'] : 'belum';
        if ($lama !== $baru) {
            if ($baru === 'belum') {
                unset($atr['kabel']);
            } else {
                $atr['kabel'] = $baru;
            }
            $d['atribut'] = atribut_json_db($atr);
            $upd->execute([$d['atribut'], $d['id']]);
            tulis_log($proyekId, $d, $aksesId, $oleh, 'kabel:' . $lama, 'kabel:' . $baru, $catatan);
        }
        $hasil[] = $d;
    }
    $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$proyekId]);
    $pdo->commit();
    return [$hasil, $dilewati];
}

/**
 * Status kabel sambungan tambahan satu perangkat (WAN tambahan router / uplink kedua switch): field "kabel" pada
 * entri $ke di atribut $kunci (wan_lain | uplink_lain). Dicatat di riwayat dengan nama tujuannya.
 */
function ubah_kabel_lain($proyekId, $id, $kunci, $ke, $baru, $aksesId, $oleh, $catatan, $filter = null)
{
    if (!in_array($baru, NP_KABEL, true)) {
        json_error('Status kabel tidak dikenal');
    }
    if (!in_array($kunci, ['wan_lain', 'uplink_lain'], true)) {
        json_error('Sambungan tidak dikenal');
    }
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ? AND proyek_id = ?');
    $st->execute([(int) $id, $proyekId]);
    $d = $st->fetch();
    if (!$d) {
        json_error('Perangkat tidak ditemukan (mungkin sudah dihapus)', 404);
    }
    if ($filter && !$filter($d)) {
        return [[], 1];
    }
    $atr = json_decode((string) $d['atribut'], true);
    $atr = is_array($atr) ? $atr : [];
    $daftar = isset($atr[$kunci]) ? json_decode((string) $atr[$kunci], true) : null;
    $lama = null;
    foreach (is_array($daftar) ? $daftar : [] as $i => $w) {
        if (is_array($w) && isset($w['id']) && (int) $w['id'] === (int) $ke) {
            $lama = isset($w['kabel']) && in_array($w['kabel'], NP_KABEL, true) ? $w['kabel'] : 'belum';
            if ($baru === 'belum') {
                unset($daftar[$i]['kabel']);
            } else {
                $daftar[$i]['kabel'] = $baru;
            }
        }
    }
    if ($lama === null) {
        json_error('Sambungan tidak ditemukan (mungkin sudah dilepas)', 404);
    }
    if ($lama !== $baru) {
        $atr[$kunci] = json_encode(array_values($daftar), JSON_UNESCAPED_UNICODE);
        $d['atribut'] = atribut_json_db($atr);
        $pdo->prepare('UPDATE np_perangkat SET atribut = ? WHERE id = ?')->execute([$d['atribut'], $d['id']]);
        $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$proyekId]);
        $st = $pdo->prepare('SELECT nama FROM np_perangkat WHERE id = ?');
        $st->execute([(int) $ke]);
        $tujuan = (string) $st->fetchColumn();
        $label = ($kunci === 'wan_lain' ? 'WAN tambahan' : 'Uplink kedua') . ($tujuan !== '' ? ' ke ' . $tujuan : '');
        tulis_log($proyekId, $d, $aksesId, $oleh, 'kabel:' . $lama, 'kabel:' . $baru, trim($label . ($catatan !== '' ? ' — ' . $catatan : '')));
    }
    return [[$d], 0];
}

/** Atribut yang sudah tervalidasi (dari database) kembali ke JSON. */
function atribut_json_db($atr)
{
    return json_encode((object) $atr, JSON_UNESCAPED_UNICODE);
}

/** Riwayat aktivitas event (terbaru dulu), opsional untuk satu perangkat. */
function log_list($proyekId, $perangkatId = null, $limit = 100)
{
    $sql = 'SELECT id, perangkat_id, perangkat_nama, akses_id, oleh, status_lama, status_baru, catatan, created_at FROM np_log WHERE proyek_id = ?';
    $args = [$proyekId];
    if ($perangkatId) {
        $sql .= ' AND perangkat_id = ?';
        $args[] = $perangkatId;
    }
    $st = db()->prepare($sql . ' ORDER BY id DESC LIMIT ' . max(1, min(500, (int) $limit)));
    $st->execute($args);
    $out = [];
    foreach ($st->fetchAll() as $r) {
        $r['id'] = (int) $r['id'];
        $r['perangkat_id'] = $r['perangkat_id'] === null ? null : (int) $r['perangkat_id'];
        $r['akses_id'] = $r['akses_id'] === null ? null : (int) $r['akses_id'];
        $r['catatan'] = (string) $r['catatan'];
        $out[] = $r;
    }
    return $out;
}

function akses_row($r)
{
    foreach (['id', 'proyek_id', 'lihat_password', 'aktif'] as $k) {
        $r[$k] = (int) $r[$k];
    }
    foreach (['status_boleh', 'jenis_boleh'] as $k) {
        $v = json_decode((string) $r[$k], true);
        $r[$k] = is_array($v) ? array_values($v) : [];
    }
    return $r;
}

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
    return ['proyek' => proyek_row($proyek), 'perangkat' => $list, 'katalog' => $katalog, 'endpoint_tipe' => endpoint_tipe_list(),
        'foto' => foto_list($proyek['id'])];
}

// ------------------------------------------------------------------------------------------- foto bukti pemasangan

/** Batas foto bukti per perangkat. */
const NP_FOTO_MAKS = 3;

function foto_row($r)
{
    foreach (['id', 'proyek_id', 'perangkat_id', 'w', 'h', 'akses_id'] as $k) {
        $r[$k] = $r[$k] === null ? null : (int) $r[$k];
    }
    foreach (['lat', 'lng', 'akurasi_m'] as $k) {
        $r[$k] = $r[$k] === null ? null : (float) $r[$k];
    }
    unset($r['file']); // gambar dibaca lewat api/foto.php?id=N
    return $r;
}

/** Foto bukti satu event, urut per perangkat lalu waktu ambil. */
function foto_list($proyekId)
{
    try {
        $st = db()->prepare('SELECT * FROM np_foto WHERE proyek_id = ? ORDER BY perangkat_id, id');
        $st->execute([$proyekId]);
    } catch (PDOException $e) {
        return []; // tabel belum dibuat (migrasi belum jalan)
    }
    return array_map('foto_row', $st->fetchAll());
}

function hapus_file_foto($file)
{
    if ($file && preg_match('/^foto_[a-f0-9]+\.jpg$/', $file) && is_file(NP_UPLOAD_DIR . '/' . $file)) {
        @unlink(NP_UPLOAD_DIR . '/' . $file);
    }
}

/** Hapus semua file foto satu event (dipanggil sebelum event dihapus; baris ikut terhapus oleh foreign key). */
function hapus_foto_proyek($proyekId)
{
    try {
        $st = db()->prepare('SELECT file FROM np_foto WHERE proyek_id = ?');
        $st->execute([$proyekId]);
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $f) {
            hapus_file_foto($f);
        }
    } catch (PDOException $e) {
        // tabel belum ada: tidak ada foto
    }
}

/**
 * Simpan foto bukti (multipart: file "foto", lat, lng, akurasi, waktu "Y-m-d H:i:s") untuk perangkat $d.
 * Gambar harus JPEG (sudah diperkecil & diberi cap di browser). Maks. NP_FOTO_MAKS per perangkat.
 */
function simpan_foto($d, $req, $oleh, $aksesId)
{
    $f = isset($_FILES['foto']) ? $_FILES['foto'] : null;
    if (!$f || is_array($f['error']) || $f['error'] !== UPLOAD_ERR_OK) {
        json_error($f && !is_array($f['error']) && in_array($f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
            ? 'Foto terlalu besar untuk server' : 'Foto gagal diunggah, coba lagi', 400);
    }
    if ($f['size'] > 8 * 1024 * 1024) {
        json_error('Foto maksimal 8 MB', 413);
    }
    $info = @getimagesize($f['tmp_name']);
    if (!$info || $info[2] !== IMAGETYPE_JPEG || $info[0] < 50 || $info[1] < 50 || $info[0] > 6000 || $info[1] > 6000) {
        json_error('Format foto tidak dikenali (harus JPEG)');
    }
    $num = function ($k, $min, $max) use ($req) {
        if (!isset($req[$k]) || $req[$k] === '' || !is_numeric($req[$k])) {
            return null;
        }
        $v = (float) $req[$k];
        return $v >= $min && $v <= $max ? $v : null;
    };
    $lat = $num('lat', -90, 90);
    $lng = $num('lng', -180, 180);
    if ($lat === null || $lng === null) {
        $lat = $lng = null;
    }
    $akurasi = $lat === null ? null : $num('akurasi', 0, 100000);
    $waktu = isset($req['waktu']) && preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', (string) $req['waktu']) ? (string) $req['waktu'] : date('Y-m-d H:i:s');

    $pdo = db();
    $pdo->beginTransaction();
    // Kunci baris perangkat: dua unggahan bersamaan tidak bisa melewati batas foto.
    $st = $pdo->prepare('SELECT id FROM np_perangkat WHERE id = ? FOR UPDATE');
    $st->execute([$d['id']]);
    $st = $pdo->prepare('SELECT COUNT(*) FROM np_foto WHERE perangkat_id = ?');
    $st->execute([$d['id']]);
    if ((int) $st->fetchColumn() >= NP_FOTO_MAKS) {
        $pdo->rollBack();
        json_error($d['nama'] . ' sudah punya ' . NP_FOTO_MAKS . ' foto. Hapus salah satu untuk mengganti.');
    }
    if (!is_dir(NP_UPLOAD_DIR)) {
        mkdir(NP_UPLOAD_DIR, 0755, true);
    }
    $name = 'foto_' . rand_hex(12) . '.jpg';
    if (!move_uploaded_file($f['tmp_name'], NP_UPLOAD_DIR . '/' . $name)) {
        $pdo->rollBack();
        json_error('Tidak bisa menyimpan foto di folder uploads/', 500);
    }
    $pdo->prepare('INSERT INTO np_foto (proyek_id, perangkat_id, file, w, h, lat, lng, akurasi_m, diambil_at, akses_id, oleh)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$d['proyek_id'], $d['id'], $name, $info[0], $info[1], $lat, $lng, $akurasi, $waktu, $aksesId, $oleh]);
    $pdo->commit();
    return foto_list((int) $d['proyek_id']);
}

/** Hapus satu foto ($aksesId != null: tim hanya boleh menghapus foto yang diambilnya sendiri). */
function hapus_foto($proyekId, $fotoId, $aksesId = null)
{
    $st = db()->prepare('SELECT * FROM np_foto WHERE id = ? AND proyek_id = ?');
    $st->execute([$fotoId, $proyekId]);
    $r = $st->fetch();
    if (!$r) {
        json_error('Foto tidak ditemukan (mungkin sudah dihapus)', 404);
    }
    if ($aksesId !== null && (int) $r['akses_id'] !== (int) $aksesId) {
        json_error('Foto ini diambil oleh ' . ($r['oleh'] ?: 'admin') . ' — hanya bisa dihapus olehnya atau admin', 403);
    }
    db()->prepare('DELETE FROM np_foto WHERE id = ?')->execute([$fotoId]);
    hapus_file_foto($r['file']);
    return foto_list((int) $proyekId);
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
