<?php
/**
 * API admin Net Plan (wajib login).
 *
 * GET  ?action=me                          -> {"ok":true,"login":bool}
 * POST {"action":"login","password":"..."}
 * POST {"action":"logout"}
 * GET  ?action=list                        -> daftar proyek + jumlah perangkat
 * GET  ?action=get&id=N                    -> {proyek, perangkat:[...]}
 * POST {"action":"proyek_save", id?, nama, venue, tanggal_mulai, tanggal_selesai, catatan, slack_kabel}
 * POST {"action":"proyek_skala","id":N,"skala":meter_per_piksel|null}
 * POST {"action":"proyek_delete","id":N}
 * POST {"action":"proyek_duplicate","id":N}
 * POST {"action":"kode_baru","id":N}       -> buat ulang kode link lihat-saja (link lama tidak berlaku)
 * POST multipart action=denah_upload, id=N, denah=<file>, sesuaikan=1|0
 * POST {"action":"denah_hapus","id":N}
 * POST {"action":"perangkat_save", id? | proyek_id, ...isian}  -> isian yang dikirim saja yang diubah
 * POST {"action":"perangkat_delete","ids":[N,...]}
 * POST {"action":"perangkat_import","proyek_id":N,"perangkat":[...]} -> tambah perangkat dari file ekspor JSON
 *
 * Setiap POST wajib membawa header "X-NP: 1" (pengaman CSRF: browser tidak bisa mengirim header ini lintas situs
 * tanpa izin CORS).
 */
require __DIR__ . '/db.php';

$loggedIn = start_admin_session();

$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'POST') {
    if (!isset($_SERVER['HTTP_X_NP']) || $_SERVER['HTTP_X_NP'] !== '1') {
        json_error('Permintaan ditolak', 403);
    }
    $isMultipart = isset($_SERVER['CONTENT_TYPE']) && stripos($_SERVER['CONTENT_TYPE'], 'multipart/form-data') === 0;
    $req = $isMultipart ? $_POST : json_body();
    $action = isset($req['action']) ? (string) $req['action'] : '';
    if ($isMultipart && $action === '' && empty($_FILES)) {
        json_error('File terlalu besar (batas server ' . ini_get('post_max_size') . ')', 413);
    }
} elseif ($method === 'GET') {
    $req = $_GET;
    $action = isset($_GET['action']) ? (string) $_GET['action'] : '';
} else {
    json_error('Metode tidak didukung', 405);
}

if ($action === 'me') {
    json_out(['ok' => true, 'login' => $loggedIn]);
}

if ($action === 'login' && $method === 'POST') {
    login(isset($req['password']) ? (string) $req['password'] : '');
}

if ($action === 'logout' && $method === 'POST') {
    $_SESSION = [];
    session_destroy();
    json_out(['ok' => true]);
}

if (!$loggedIn) {
    json_error('Silakan login terlebih dahulu', 401, ['login' => false]);
}
// Sesi yang login sebelum aplikasi diperbarui: perbarui struktur tabel sekali.
if (!isset($_SESSION['np_schema']) || $_SESSION['np_schema'] < NP_SCHEMA) {
    install_schema();
}
// Sesi PHP hanya dibaca setelah ini, jadi lepaskan kuncinya agar request admin lain tidak antre.
session_write_close();

$pdo = db();
$id = isset($req['id']) && !is_array($req['id']) ? (int) $req['id'] : 0;

switch ($method . ' ' . $action) {
    case 'GET list':
        $rows = $pdo->query('SELECT p.*, (SELECT COUNT(*) FROM np_perangkat d WHERE d.proyek_id = p.id) AS jumlah
            FROM np_proyek p ORDER BY p.updated_at DESC, p.id DESC')->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $jumlah = (int) $r['jumlah'];
            unset($r['jumlah'], $r['catatan']);
            $out[] = proyek_row($r) + ['jumlah' => $jumlah];
        }
        json_out(['ok' => true, 'proyek' => $out]);

    case 'GET get':
        json_out(['ok' => true] + proyek_lengkap(find_proyek($id)));

    case 'POST proyek_save':
        $data = [
            'nama' => str_field($req, 'nama', 150, true, 'Nama event'),
            'venue' => str_field($req, 'venue', 200),
            'tanggal_mulai' => date_field($req, 'tanggal_mulai'),
            'tanggal_selesai' => date_field($req, 'tanggal_selesai'),
            'catatan' => text_field($req, 'catatan', 5000, 'Catatan'),
            'slack_kabel' => isset($req['slack_kabel']) ? max(0, min(300, (int) $req['slack_kabel'])) : 20,
        ];
        if ($id) {
            find_proyek($id);
            $st = $pdo->prepare('UPDATE np_proyek SET nama = ?, venue = ?, tanggal_mulai = ?, tanggal_selesai = ?,
                catatan = ?, slack_kabel = ? WHERE id = ?');
            $st->execute(array_merge(array_values($data), [$id]));
        } else {
            $st = $pdo->prepare('INSERT INTO np_proyek (nama, venue, tanggal_mulai, tanggal_selesai, catatan, slack_kabel, kode_lihat)
                VALUES (?, ?, ?, ?, ?, ?, ?)');
            $st->execute(array_merge(array_values($data), [rand_hex(12)]));
            $id = (int) $pdo->lastInsertId();
        }
        json_out(['ok' => true, 'proyek' => proyek_row(find_proyek($id))]);

    case 'POST proyek_skala':
        find_proyek($id);
        $skala = isset($req['skala']) && $req['skala'] !== null && $req['skala'] !== '' ? (float) $req['skala'] : null;
        if ($skala !== null && !($skala > 0 && $skala < 1000)) {
            json_error('Skala tidak valid');
        }
        $pdo->prepare('UPDATE np_proyek SET skala = ? WHERE id = ?')->execute([$skala, $id]);
        json_out(['ok' => true, 'proyek' => proyek_row(find_proyek($id))]);

    case 'POST kode_baru':
        find_proyek($id);
        $pdo->prepare('UPDATE np_proyek SET kode_lihat = ? WHERE id = ?')->execute([rand_hex(12), $id]);
        json_out(['ok' => true, 'proyek' => proyek_row(find_proyek($id))]);

    case 'POST proyek_delete':
        $p = find_proyek($id);
        $pdo->prepare('DELETE FROM np_proyek WHERE id = ?')->execute([$id]);
        hapus_file_denah($p['denah_file']);
        json_out(['ok' => true]);

    case 'POST proyek_duplicate':
        json_out(['ok' => true, 'proyek' => proyek_row(duplikat_proyek(find_proyek($id)))]);

    case 'POST denah_upload':
        json_out(['ok' => true] + proyek_lengkap(upload_denah(find_proyek($id), !empty($req['sesuaikan']))));

    case 'POST denah_hapus':
        $p = find_proyek($id);
        $pdo->prepare('UPDATE np_proyek SET denah_file = NULL WHERE id = ?')->execute([$id]);
        hapus_file_denah($p['denah_file']);
        json_out(['ok' => true, 'proyek' => proyek_row(find_proyek($id))]);

    case 'POST perangkat_save':
        json_out(['ok' => true, 'perangkat' => simpan_perangkat($req)]);

    case 'POST perangkat_delete':
        $ids = isset($req['ids']) && is_array($req['ids']) ? array_values(array_unique(array_map('intval', $req['ids']))) : [];
        if (!$ids || count($ids) > 1000) {
            json_error('Tidak ada perangkat yang dipilih');
        }
        $in = implode(',', array_fill(0, count($ids), '?'));
        $pdo->beginTransaction();
        // Perangkat yang tadinya terhubung ke perangkat terhapus menjadi tanpa uplink.
        $pdo->prepare("UPDATE np_perangkat SET uplink_id = NULL WHERE uplink_id IN ($in)")->execute($ids);
        $pdo->prepare("DELETE FROM np_perangkat WHERE id IN ($in)")->execute($ids);
        $pdo->commit();
        json_out(['ok' => true]);

    case 'POST perangkat_import':
        $p = find_proyek(isset($req['proyek_id']) ? (int) $req['proyek_id'] : 0);
        $list = isset($req['perangkat']) && is_array($req['perangkat']) ? $req['perangkat'] : [];
        if (!$list || count($list) > 2000) {
            json_error('File tidak berisi daftar perangkat');
        }
        $n = salin_perangkat((int) $p['id'], $list);
        json_out(['ok' => true, 'jumlah' => $n] + proyek_lengkap(find_proyek((int) $p['id'])));
}

json_error('Aksi tidak dikenal', 404);

// ---------------------------------------------------------------------------

function login($password)
{
    if (defined('NP_ADMIN_PASS') && NP_ADMIN_PASS !== '') {
        $hash = NP_ADMIN_PASS;
        $ok = strpos($hash, '$2y$') === 0 || strpos($hash, '$argon2') === 0
            ? password_verify($password, $hash)
            : hash_equals($hash, $password);
    } else {
        // Belum dikonfigurasi: hanya izinkan password bawaan dari komputer sendiri (XAMPP).
        $local = in_array($_SERVER['REMOTE_ADDR'], ['127.0.0.1', '::1'], true);
        if (!$local) {
            json_error('Password admin belum diatur. Isi NP_ADMIN_PASS di api/config.local.php.', 403);
        }
        $ok = hash_equals('admin', $password);
    }
    if (!$ok) {
        usleep(800000); // perlambat tebak-tebakan password
        json_error('Password salah', 401);
    }
    install_schema();
    session_regenerate_id(true);
    $_SESSION['np_admin'] = 1;
    json_out(['ok' => true, 'login' => true]);
}

function install_schema()
{
    $sql = (string) file_get_contents(__DIR__ . '/../database/netplan.sql');
    $sql = preg_replace('/--[^\n]*/', '', $sql);
    foreach (preg_split('/;\s*(\r?\n|$)/', $sql) as $stmt) {
        if (trim($stmt) !== '') {
            db()->exec($stmt);
        }
    }
    // Tabel dari versi lama: tambahkan kolom baru (cara ini jalan di MySQL maupun MariaDB).
    $cols = db()->query('SHOW COLUMNS FROM np_perangkat')->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('jalur', $cols, true)) {
        db()->exec('ALTER TABLE np_perangkat ADD COLUMN jalur TEXT NULL AFTER atribut');
    }
    $_SESSION['np_schema'] = NP_SCHEMA;
}

function find_proyek($id)
{
    $st = db()->prepare('SELECT * FROM np_proyek WHERE id = ?');
    $st->execute([$id]);
    $p = $st->fetch();
    if (!$p) {
        json_error('Proyek tidak ditemukan', 404);
    }
    return $p;
}

function date_field($arr, $key)
{
    $v = isset($arr[$key]) ? trim((string) $arr[$key]) : '';
    if ($v === '') {
        return null;
    }
    $d = DateTime::createFromFormat('!Y-m-d', $v);
    if (!$d || $d->format('Y-m-d') !== $v) {
        json_error('Format tanggal tidak valid');
    }
    return $v;
}

function hapus_file_denah($file)
{
    if ($file && preg_match('/^denah_[a-f0-9]+\.(png|jpg|webp|gif)$/', $file) && is_file(NP_UPLOAD_DIR . '/' . $file)) {
        @unlink(NP_UPLOAD_DIR . '/' . $file);
    }
}

/** Simpan gambar denah baru. $sesuaikan: geser posisi perangkat & skala mengikuti ukuran gambar baru. */
function upload_denah($p, $sesuaikan)
{
    $f = isset($_FILES['denah']) ? $_FILES['denah'] : null;
    if (!$f || is_array($f['error'])) {
        json_error('Pilih file gambar denah');
    }
    if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE) {
        json_error('File terlalu besar (batas server ' . ini_get('upload_max_filesize') . ')', 413);
    }
    if ($f['error'] !== UPLOAD_ERR_OK) {
        json_error('Upload gagal (kode ' . $f['error'] . ')');
    }
    if ($f['size'] > 30 * 1024 * 1024) {
        json_error('File maksimal 30 MB', 413);
    }
    $info = @getimagesize($f['tmp_name']);
    $ext = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'];
    if (!$info || !isset($ext[$info[2]])) {
        json_error('Format denah harus PNG, JPG, WEBP, atau GIF. File PDF/CAD: ekspor dulu menjadi gambar.');
    }
    list($w, $h) = $info;
    if ($w < 50 || $h < 50 || $w > 20000 || $h > 20000) {
        json_error('Ukuran gambar tidak wajar (' . $w . '×' . $h . ' piksel)');
    }
    if (!is_dir(NP_UPLOAD_DIR)) {
        mkdir(NP_UPLOAD_DIR, 0755, true);
    }
    $name = 'denah_' . rand_hex(10) . '.' . $ext[$info[2]];
    if (!move_uploaded_file($f['tmp_name'], NP_UPLOAD_DIR . '/' . $name)) {
        json_error('Tidak bisa menyimpan file di folder uploads/', 500);
    }

    $pdo = db();
    $pdo->beginTransaction();
    $oldW = (int) $p['denah_w'];
    $oldH = (int) $p['denah_h'];
    $skala = $p['skala'] === null ? null : (float) $p['skala'];
    if ($sesuaikan && $oldW > 0 && $oldH > 0 && ($oldW !== $w || $oldH !== $h)) {
        $fx = $w / $oldW;
        $fy = $h / $oldH;
        $pdo->prepare('UPDATE np_perangkat SET x = x * ?, y = y * ? WHERE proyek_id = ?')
            ->execute([$fx, $fy, $p['id']]);
        // Titik lekukan jalur kabel ikut diskalakan.
        $st = $pdo->prepare("SELECT id, jalur FROM np_perangkat WHERE proyek_id = ? AND jalur LIKE '%\"bebas\"%'");
        $st->execute([$p['id']]);
        $upd = $pdo->prepare('UPDATE np_perangkat SET jalur = ? WHERE id = ?');
        foreach ($st->fetchAll() as $r) {
            $upd->execute([jalur_json(json_decode($r['jalur'], true), $fx, $fy), $r['id']]);
        }
        if ($skala !== null) {
            $skala = $skala * $oldW / $w;
        }
    } elseif (!$sesuaikan) {
        $skala = null; // denah berbeda: kalibrasi lama tidak berlaku
    }
    $pdo->prepare('UPDATE np_proyek SET denah_file = ?, denah_w = ?, denah_h = ?, skala = ? WHERE id = ?')
        ->execute([$name, $w, $h, $skala, $p['id']]);
    $pdo->commit();
    hapus_file_denah($p['denah_file']);
    return find_proyek($p['id']);
}

/** Validasi & simpan satu perangkat. Untuk perangkat lama, hanya isian yang dikirim yang diubah. */
function simpan_perangkat($req)
{
    $pdo = db();
    $id = isset($req['id']) ? (int) $req['id'] : 0;
    if ($id) {
        $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ?');
        $st->execute([$id]);
        $cur = $st->fetch();
        if (!$cur) {
            json_error('Perangkat tidak ditemukan (mungkin sudah dihapus)', 404);
        }
        $proyekId = (int) $cur['proyek_id'];
    } else {
        $proyekId = (int) find_proyek(isset($req['proyek_id']) ? (int) $req['proyek_id'] : 0)['id'];
        $cur = null;
    }

    $set = [];
    $has = function ($k) use ($req, $cur) {
        return array_key_exists($k, $req) || $cur === null;
    };
    if ($has('jenis')) {
        $jenis = isset($req['jenis']) ? (string) $req['jenis'] : '';
        if (!in_array($jenis, NP_JENIS, true)) {
            json_error('Jenis perangkat tidak dikenal');
        }
        $set['jenis'] = $jenis;
    }
    if ($has('nama')) {
        $set['nama'] = str_field($req, 'nama', 100, true, 'Nama perangkat');
    }
    foreach (['model' => [150, 'Merek/tipe'], 'ip' => [64, 'IP'], 'vlan' => [50, 'VLAN'],
        'port_uplink' => [50, 'Port uplink'], 'port_lokal' => [50, 'Port lokal'], 'pic' => [100, 'PIC']] as $k => $def) {
        if ($has($k)) {
            $set[$k] = str_field($req, $k, $def[0], false, $def[1]);
        }
    }
    if ($has('media')) {
        $m = isset($req['media']) ? (string) $req['media'] : '';
        $set['media'] = in_array($m, NP_MEDIA, true) ? $m : '';
    }
    if ($has('status')) {
        $s = isset($req['status']) ? (string) $req['status'] : 'rencana';
        $set['status'] = in_array($s, NP_STATUS, true) ? $s : 'rencana';
    }
    if ($has('bandwidth_mbps')) {
        $b = isset($req['bandwidth_mbps']) ? $req['bandwidth_mbps'] : null;
        if ($b === null || $b === '') {
            $set['bandwidth_mbps'] = null;
        } elseif (is_numeric($b) && $b >= 0 && $b < 100000000) {
            $set['bandwidth_mbps'] = round((float) $b, 2);
        } else {
            json_error('Bandwidth harus angka (Mbps)');
        }
    }
    if ($has('catatan')) {
        $set['catatan'] = text_field($req, 'catatan', 20000, 'Keterangan konfigurasi');
    }
    if ($has('atribut')) {
        $set['atribut'] = atribut_json(isset($req['atribut']) ? $req['atribut'] : []);
    }
    if ($has('jalur')) {
        $set['jalur'] = jalur_json(isset($req['jalur']) ? $req['jalur'] : null);
    }
    foreach (['x', 'y'] as $k) {
        if ($has($k)) {
            $v = isset($req[$k]) && is_numeric($req[$k]) ? (float) $req[$k] : 0;
            $set[$k] = max(-100000, min(100000, $v));
        }
    }
    if ($has('uplink_id')) {
        $up = isset($req['uplink_id']) && $req['uplink_id'] !== '' && $req['uplink_id'] !== null ? (int) $req['uplink_id'] : null;
        if ($up !== null) {
            cek_uplink($proyekId, $id, $up);
        }
        $set['uplink_id'] = $up;
    }

    if ($cur) {
        if ($set) {
            $cols = implode(', ', array_map(function ($k) { return "$k = ?"; }, array_keys($set)));
            $pdo->prepare("UPDATE np_perangkat SET $cols WHERE id = ?")->execute(array_merge(array_values($set), [$id]));
            $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$proyekId]);
        }
    } else {
        $set['proyek_id'] = $proyekId;
        $cols = implode(', ', array_keys($set));
        $qs = implode(', ', array_fill(0, count($set), '?'));
        $pdo->prepare("INSERT INTO np_perangkat ($cols) VALUES ($qs)")->execute(array_values($set));
        $id = (int) $pdo->lastInsertId();
        $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$proyekId]);
    }
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE id = ?');
    $st->execute([$id]);
    return perangkat_row($st->fetch());
}

/** Uplink harus satu proyek, bukan dirinya sendiri, dan tidak membentuk loop. */
function cek_uplink($proyekId, $selfId, $uplinkId)
{
    if ($selfId && $uplinkId === $selfId) {
        json_error('Perangkat tidak bisa menjadi uplink dirinya sendiri');
    }
    $st = db()->prepare('SELECT id, uplink_id FROM np_perangkat WHERE proyek_id = ?');
    $st->execute([$proyekId]);
    $parent = [];
    foreach ($st->fetchAll() as $r) {
        $parent[(int) $r['id']] = $r['uplink_id'] === null ? null : (int) $r['uplink_id'];
    }
    if (!array_key_exists($uplinkId, $parent)) {
        json_error('Perangkat uplink tidak ditemukan di proyek ini');
    }
    $cur = $uplinkId;
    $guard = 0;
    while ($cur !== null && $guard++ < 5000) {
        if ($selfId && $cur === $selfId) {
            json_error('Tidak bisa: uplink tersebut berada di bawah perangkat ini (membentuk loop)');
        }
        $cur = isset($parent[$cur]) ? $parent[$cur] : null;
    }
}

function atribut_json($atr)
{
    if (!is_array($atr)) {
        return '{}';
    }
    $out = [];
    foreach ($atr as $k => $v) {
        if (count($out) >= 60 || !preg_match('/^[a-z0-9_]{1,40}$/', (string) $k) || is_array($v) || $v === null) {
            continue;
        }
        $v = trim((string) $v);
        if ($v === '') {
            continue;
        }
        if (mb_strlen($v) > 1000) {
            json_error('Isian "' . $k . '" maksimal 1000 karakter');
        }
        $out[$k] = $v;
    }
    return json_encode((object) $out, JSON_UNESCAPED_UNICODE);
}

/**
 * Bentuk jalur kabel ke uplink -> JSON atau NULL (lurus).
 * {"m":"h"|"v"} = siku otomatis; {"m":"bebas","p":[[x,y],...]} = titik lekukan (koordinat denah), maks. 60 titik.
 */
function jalur_json($j, $fx = 1, $fy = 1)
{
    if (!is_array($j) || !isset($j['m']) || !in_array($j['m'], NP_JALUR, true)) {
        return null;
    }
    $out = ['m' => $j['m']];
    if ($j['m'] === 'bebas') {
        $pts = [];
        foreach (isset($j['p']) && is_array($j['p']) ? $j['p'] : [] as $pt) {
            if (count($pts) >= 60) {
                break;
            }
            if (is_array($pt) && isset($pt[0], $pt[1]) && is_numeric($pt[0]) && is_numeric($pt[1])) {
                $pts[] = [
                    round(max(-100000, min(100000, $pt[0] * $fx)), 1),
                    round(max(-100000, min(100000, $pt[1] * $fy)), 1),
                ];
            }
        }
        $out['p'] = $pts;
    }
    return json_encode($out);
}

/** Tambahkan daftar perangkat (dari ekspor/duplikat) ke proyek; relasi uplink dipetakan ke id baru. */
function salin_perangkat($proyekId, $list)
{
    $pdo = db();
    $pdo->beginTransaction();
    $map = [];
    $uplinks = [];
    $ins = $pdo->prepare('INSERT INTO np_perangkat (proyek_id, jenis, nama, model, ip, vlan, port_uplink, port_lokal, media,
        bandwidth_mbps, status, pic, catatan, atribut, jalur, x, y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    foreach ($list as $d) {
        if (!is_array($d)) {
            continue;
        }
        $jenis = isset($d['jenis']) && in_array($d['jenis'], NP_JENIS, true) ? $d['jenis'] : 'lainnya';
        $bw = isset($d['bandwidth_mbps']) && is_numeric($d['bandwidth_mbps']) ? (float) $d['bandwidth_mbps'] : null;
        $ins->execute([
            $proyekId, $jenis,
            str_field($d, 'nama', 100, true, 'Nama perangkat'),
            str_field($d, 'model', 150), str_field($d, 'ip', 64), str_field($d, 'vlan', 50),
            str_field($d, 'port_uplink', 50), str_field($d, 'port_lokal', 50),
            isset($d['media']) && in_array($d['media'], NP_MEDIA, true) ? $d['media'] : '',
            $bw,
            isset($d['status']) && in_array($d['status'], NP_STATUS, true) ? $d['status'] : 'rencana',
            str_field($d, 'pic', 100),
            text_field($d, 'catatan', 20000),
            atribut_json(isset($d['atribut']) ? $d['atribut'] : []),
            jalur_json(isset($d['jalur']) ? $d['jalur'] : null),
            isset($d['x']) && is_numeric($d['x']) ? (float) $d['x'] : 0,
            isset($d['y']) && is_numeric($d['y']) ? (float) $d['y'] : 0,
        ]);
        $newId = (int) $pdo->lastInsertId();
        if (isset($d['id'])) {
            $map[(int) $d['id']] = $newId;
            if (isset($d['uplink_id']) && $d['uplink_id'] !== null) {
                $uplinks[$newId] = (int) $d['uplink_id'];
            }
        }
    }
    $upd = $pdo->prepare('UPDATE np_perangkat SET uplink_id = ? WHERE id = ?');
    foreach ($uplinks as $newId => $oldUp) {
        if (isset($map[$oldUp])) {
            $upd->execute([$map[$oldUp], $newId]);
        }
    }
    $pdo->prepare('UPDATE np_proyek SET updated_at = NOW() WHERE id = ?')->execute([$proyekId]);
    $pdo->commit();
    return count($map) ?: count($list);
}

function duplikat_proyek($p)
{
    $pdo = db();
    $file = null;
    if ($p['denah_file'] && is_file(NP_UPLOAD_DIR . '/' . $p['denah_file'])) {
        $file = 'denah_' . rand_hex(10) . '.' . pathinfo($p['denah_file'], PATHINFO_EXTENSION);
        if (!copy(NP_UPLOAD_DIR . '/' . $p['denah_file'], NP_UPLOAD_DIR . '/' . $file)) {
            json_error('Tidak bisa menyalin file denah', 500);
        }
    }
    $nama = mb_substr($p['nama'], 0, 138) . ' (salinan)';
    $pdo->prepare('INSERT INTO np_proyek (nama, venue, tanggal_mulai, tanggal_selesai, catatan, denah_file, denah_w, denah_h,
            skala, slack_kabel, kode_lihat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$nama, $p['venue'], $p['tanggal_mulai'], $p['tanggal_selesai'], $p['catatan'], $file,
            $p['denah_w'], $p['denah_h'], $p['skala'], $p['slack_kabel'], rand_hex(12)]);
    $newId = (int) $pdo->lastInsertId();
    $st = $pdo->prepare('SELECT * FROM np_perangkat WHERE proyek_id = ? ORDER BY id');
    $st->execute([$p['id']]);
    $rows = $st->fetchAll();
    if ($rows) {
        $list = array_map(function ($r) {
            $r['atribut'] = json_decode((string) $r['atribut'], true);
            $r['jalur'] = json_decode((string) $r['jalur'], true);
            return $r;
        }, $rows);
        salin_perangkat($newId, $list);
    }
    return find_proyek($newId);
}
