<?php
/**
 * API admin Live Vote (wajib login).
 *
 * GET  ?action=me                         -> {"ok":true,"login":bool}
 * POST {"action":"login","password":"..."}
 * POST {"action":"logout"}
 * GET  ?action=list                       -> daftar sesi + jumlah suara
 * GET  ?action=get&id=N                   -> detail sesi, pilihan + perolehan, pemilih (mode undangan)
 * GET  ?action=suara&id=N                 -> rincian setiap suara (waktu, nama, pilihan, ip)
 * POST {"action":"save", id?, judul, pertanyaan, mode, hasil_pemilih, minta_nama, pilihan:[{id?,label}]}
 * POST {"action":"status","id":N,"status":"draf|dibuka|ditutup"}
 * POST {"action":"reset","id":N}          -> hapus semua suara sesi
 * POST {"action":"duplicate","id":N}      -> salin sesi (tanpa suara)
 * POST {"action":"delete","id":N}
 * POST {"action":"pemilih_add","id":N,"nama":["...","..."]}
 * POST {"action":"pemilih_delete","id":N,"pemilih_id":M}
 *
 * Setiap POST wajib membawa header "X-LV: 1" (pengaman CSRF: browser tidak bisa mengirim header ini lintas situs
 * tanpa izin CORS).
 */
require __DIR__ . '/db.php';

session_name('lvadmin');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => app_path(),
    'secure' => is_https(),
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'POST') {
    if (!isset($_SERVER['HTTP_X_LV']) || $_SERVER['HTTP_X_LV'] !== '1') {
        json_error('Permintaan ditolak', 403);
    }
    $req = json_body();
    $action = isset($req['action']) ? (string) $req['action'] : '';
} elseif ($method === 'GET') {
    $req = $_GET;
    $action = isset($_GET['action']) ? (string) $_GET['action'] : '';
} else {
    json_error('Metode tidak didukung', 405);
}

$loggedIn = !empty($_SESSION['lv_admin']);

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
// Sesi PHP hanya dibaca setelah ini, jadi lepaskan kuncinya agar request admin lain tidak antre.
session_write_close();

$pdo = db();
$id = isset($req['id']) ? (int) $req['id'] : 0;

switch ($method . ' ' . $action) {
    case 'GET list':
        $rows = $pdo->query('SELECT s.id, s.judul, s.kode, s.mode, s.status, s.updated_at,
                (SELECT COUNT(*) FROM lv_suara v WHERE v.sesi_id = s.id) AS total
            FROM lv_sesi s ORDER BY s.id DESC')->fetchAll();
        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
            $r['total'] = (int) $r['total'];
        }
        json_out(['ok' => true, 'data' => $rows]);

    case 'GET get':
        json_out(['ok' => true, 'data' => sesi_detail($id)]);

    case 'GET suara': // rincian suara untuk diunduh sebagai CSV
        find_sesi($id);
        $st = $pdo->prepare('SELECT v.created_at AS waktu, v.nama, p.label AS pilihan, v.ip
            FROM lv_suara v JOIN lv_pilihan p ON p.id = v.pilihan_id WHERE v.sesi_id = ? ORDER BY v.id');
        $st->execute([$id]);
        json_out(['ok' => true, 'data' => $st->fetchAll()]);

    case 'POST save':
        save_sesi($req);

    case 'POST status':
        $status = isset($req['status']) ? (string) $req['status'] : '';
        if (!in_array($status, ['draf', 'dibuka', 'ditutup'], true)) {
            json_error('Status tidak dikenal');
        }
        find_sesi($id);
        $sql = 'UPDATE lv_sesi SET status = ?';
        if ($status === 'dibuka') {
            $sql .= ', dibuka_at = NOW(), ditutup_at = NULL';
        } elseif ($status === 'ditutup') {
            $sql .= ', ditutup_at = NOW()';
        }
        $pdo->prepare($sql . ' WHERE id = ?')->execute([$status, $id]);
        json_out(['ok' => true, 'data' => sesi_detail($id)]);

    case 'POST reset':
        find_sesi($id);
        $pdo->prepare('DELETE FROM lv_suara WHERE sesi_id = ?')->execute([$id]);
        $pdo->prepare('UPDATE lv_sesi SET updated_at = NOW() WHERE id = ?')->execute([$id]);
        json_out(['ok' => true, 'data' => sesi_detail($id)]);

    case 'POST duplicate':
        $s = find_sesi($id);
        $pdo->beginTransaction();
        $newId = insert_sesi($s['judul'] . ' (salinan)', $s['pertanyaan'], $s['mode'], $s['hasil_pemilih'], $s['minta_nama']);
        $pdo->prepare('INSERT INTO lv_pilihan (sesi_id, label, urutan) SELECT ?, label, urutan FROM lv_pilihan WHERE sesi_id = ?')
            ->execute([$newId, $id]);
        $pdo->commit();
        json_out(['ok' => true, 'data' => sesi_detail($newId)]);

    case 'POST delete':
        find_sesi($id);
        $pdo->prepare('DELETE FROM lv_sesi WHERE id = ?')->execute([$id]);
        json_out(['ok' => true]);

    case 'POST pemilih_add':
        $s = find_sesi($id);
        if ($s['mode'] !== 'undangan') {
            json_error('Daftar pemilih hanya untuk mode undangan');
        }
        $names = isset($req['nama']) && is_array($req['nama']) ? $req['nama'] : [];
        $clean = [];
        foreach ($names as $n) {
            $n = trim(preg_replace('/\s+/u', ' ', (string) $n));
            if ($n !== '') {
                $clean[] = mb_substr($n, 0, 150);
            }
        }
        if (!$clean) {
            json_error('Isi minimal satu nama pemilih');
        }
        if (count($clean) > 2000) {
            json_error('Maksimal 2000 nama sekali tambah');
        }
        $st = $pdo->prepare('INSERT INTO lv_pemilih (sesi_id, nama, token) VALUES (?, ?, ?)');
        $pdo->beginTransaction();
        foreach ($clean as $n) {
            $st->execute([$id, $n, rand_hex(12)]);
        }
        $pdo->commit();
        json_out(['ok' => true, 'data' => sesi_detail($id)]);

    case 'POST pemilih_delete':
        find_sesi($id);
        $pid = isset($req['pemilih_id']) ? (int) $req['pemilih_id'] : 0;
        $st = $pdo->prepare('SELECT COUNT(*) FROM lv_suara WHERE sesi_id = ? AND pemilih_id = ?');
        $st->execute([$id, $pid]);
        if ((int) $st->fetchColumn() > 0) {
            json_error('Pemilih ini sudah memilih; reset suara dulu bila ingin menghapusnya');
        }
        $pdo->prepare('DELETE FROM lv_pemilih WHERE id = ? AND sesi_id = ?')->execute([$pid, $id]);
        json_out(['ok' => true, 'data' => sesi_detail($id)]);
}

json_error('Aksi tidak dikenal');

// ---------------------------------------------------------------------------

function login($password)
{
    if (defined('LV_ADMIN_PASS') && LV_ADMIN_PASS !== '') {
        $hash = LV_ADMIN_PASS;
        $ok = strpos($hash, '$2y$') === 0 || strpos($hash, '$argon2') === 0
            ? password_verify($password, $hash)
            : hash_equals($hash, $password);
    } else {
        // Belum dikonfigurasi: hanya izinkan password bawaan dari komputer sendiri (XAMPP).
        $local = in_array($_SERVER['REMOTE_ADDR'], ['127.0.0.1', '::1'], true);
        if (!$local) {
            json_error('Password admin belum diatur. Isi LV_ADMIN_PASS di api/config.local.php.', 403);
        }
        $ok = hash_equals('admin', $password);
    }
    if (!$ok) {
        usleep(800000); // perlambat tebak-tebakan password
        json_error('Password salah', 401);
    }
    install_schema();
    session_regenerate_id(true);
    $_SESSION['lv_admin'] = 1;
    json_out(['ok' => true, 'login' => true]);
}

/** Buat tabel bila belum ada (aman dijalankan berulang). */
function install_schema()
{
    $sql = (string) file_get_contents(__DIR__ . '/../database/livevote.sql');
    $sql = preg_replace('/^\s*--.*$/m', '', $sql);
    $sql = preg_replace('/--[^\n]*/', '', $sql);
    foreach (preg_split('/;\s*(\r?\n|$)/', $sql) as $stmt) {
        if (trim($stmt) !== '') {
            db()->exec($stmt);
        }
    }
}

function find_sesi($id)
{
    $st = db()->prepare('SELECT * FROM lv_sesi WHERE id = ?');
    $st->execute([$id]);
    $s = $st->fetch();
    if (!$s) {
        json_error('Sesi tidak ditemukan', 404);
    }
    return $s;
}

function sesi_detail($id)
{
    $s = find_sesi($id);
    $out = [
        'id' => (int) $s['id'],
        'judul' => $s['judul'],
        'pertanyaan' => $s['pertanyaan'],
        'kode' => $s['kode'],
        'kode_layar' => $s['kode_layar'],
        'mode' => $s['mode'],
        'status' => $s['status'],
        'hasil_pemilih' => (int) $s['hasil_pemilih'],
        'minta_nama' => (int) $s['minta_nama'],
        'dibuka_at' => $s['dibuka_at'],
        'ditutup_at' => $s['ditutup_at'],
    ] + tally($id);

    $out['pemilih'] = [];
    if ($s['mode'] === 'undangan') {
        $st = db()->prepare('SELECT p.id, p.nama, p.token, v.created_at AS memilih_at
            FROM lv_pemilih p LEFT JOIN lv_suara v ON v.sesi_id = p.sesi_id AND v.pemilih_id = p.id
            WHERE p.sesi_id = ? ORDER BY p.id');
        $st->execute([$id]);
        foreach ($st->fetchAll() as $p) {
            $p['id'] = (int) $p['id'];
            $out['pemilih'][] = $p;
        }
    }
    return $out;
}

function insert_sesi($judul, $pertanyaan, $mode, $hasilPemilih, $mintaNama)
{
    $pdo = db();
    $st = $pdo->prepare('INSERT INTO lv_sesi (judul, pertanyaan, kode, kode_layar, mode, hasil_pemilih, minta_nama)
        VALUES (?, ?, ?, ?, ?, ?, ?)');
    // Ulangi bila kode acak kebetulan sudah dipakai sesi lain.
    for ($try = 0; ; $try++) {
        try {
            $st->execute([$judul, $pertanyaan, rand_code(6), rand_hex(12), $mode, $hasilPemilih ? 1 : 0, $mintaNama ? 1 : 0]);
            return (int) $pdo->lastInsertId();
        } catch (PDOException $e) {
            if ($e->getCode() !== '23000' || $try >= 5) {
                throw $e;
            }
        }
    }
}

function save_sesi($req)
{
    $pdo = db();
    $id = isset($req['id']) ? (int) $req['id'] : 0;
    $judul = str_field($req, 'judul', 150, true, 'Judul');
    $pertanyaan = str_field($req, 'pertanyaan', 500, true, 'Pertanyaan');
    $mode = isset($req['mode']) && $req['mode'] === 'undangan' ? 'undangan' : 'terbuka';
    $hasilPemilih = !empty($req['hasil_pemilih']);
    $mintaNama = !empty($req['minta_nama']);

    $pilihan = [];
    foreach (isset($req['pilihan']) && is_array($req['pilihan']) ? $req['pilihan'] : [] as $p) {
        $label = str_field(is_array($p) ? $p : [], 'label', 200, false, 'Pilihan');
        if ($label !== '') {
            $pilihan[] = ['id' => isset($p['id']) ? (int) $p['id'] : 0, 'label' => $label];
        }
    }
    if (count($pilihan) < 2) {
        json_error('Isi minimal 2 pilihan');
    }
    if (count($pilihan) > 50) {
        json_error('Maksimal 50 pilihan');
    }

    $pdo->beginTransaction();
    if ($id === 0) {
        $id = insert_sesi($judul, $pertanyaan, $mode, $hasilPemilih, $mintaNama);
    } else {
        $s = find_sesi($id);
        $st = $pdo->prepare('SELECT COUNT(*) FROM lv_suara WHERE sesi_id = ?');
        $st->execute([$id]);
        $adaSuara = (int) $st->fetchColumn() > 0;
        if ($adaSuara && $mode !== $s['mode']) {
            $pdo->rollBack();
            json_error('Mode tidak bisa diubah karena sudah ada suara masuk. Reset suara dulu.');
        }
        $pdo->prepare('UPDATE lv_sesi SET judul = ?, pertanyaan = ?, mode = ?, hasil_pemilih = ?, minta_nama = ?, updated_at = NOW()
            WHERE id = ?')->execute([$judul, $pertanyaan, $mode, $hasilPemilih ? 1 : 0, $mintaNama ? 1 : 0, $id]);
    }

    // Sinkronkan pilihan: ubah yang ada, tambah yang baru, hapus yang dibuang (bila belum punya suara).
    $st = $pdo->prepare('SELECT p.id, COUNT(s.id) AS jumlah FROM lv_pilihan p
        LEFT JOIN lv_suara s ON s.pilihan_id = p.id WHERE p.sesi_id = ? GROUP BY p.id');
    $st->execute([$id]);
    $lama = [];
    foreach ($st->fetchAll() as $r) {
        $lama[(int) $r['id']] = (int) $r['jumlah'];
    }
    $upd = $pdo->prepare('UPDATE lv_pilihan SET label = ?, urutan = ? WHERE id = ? AND sesi_id = ?');
    $ins = $pdo->prepare('INSERT INTO lv_pilihan (sesi_id, label, urutan) VALUES (?, ?, ?)');
    $dipakai = [];
    foreach ($pilihan as $i => $p) {
        if ($p['id'] && isset($lama[$p['id']])) {
            $upd->execute([$p['label'], $i, $p['id'], $id]);
            $dipakai[$p['id']] = true;
        } else {
            $ins->execute([$id, $p['label'], $i]);
        }
    }
    $del = $pdo->prepare('DELETE FROM lv_pilihan WHERE id = ? AND sesi_id = ?');
    foreach ($lama as $pid => $jumlah) {
        if (!isset($dipakai[$pid])) {
            if ($jumlah > 0) {
                $pdo->rollBack();
                json_error('Pilihan yang sudah mendapat suara tidak bisa dihapus. Reset suara dulu.');
            }
            $del->execute([$pid, $id]);
        }
    }
    $pdo->commit();
    json_out(['ok' => true, 'data' => sesi_detail($id)]);
}
