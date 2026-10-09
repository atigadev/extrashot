<?php
/**
 * API pemilih (publik).
 *
 * GET  ?k=KODE[&t=TOKEN]                              -> data sesi, pilihan, status sudah memilih
 * POST {"k":"KODE","t":"TOKEN?","pilihan_id":N,"nama":"?","vk":"?"}
 *
 * Satu pemilih = satu suara per sesi, dijamin UNIQUE (sesi_id, voter_key) di database:
 *  - mode undangan: voter_key dari token link pribadi (tiap link hanya bisa dipakai sekali);
 *  - mode terbuka : voter_key dari cookie acak perangkat (juga disalin ke localStorage sebagai cadangan "vk").
 */
require __DIR__ . '/db.php';

const VOTER_COOKIE = 'lv_v';

$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'POST') {
    $req = json_body();
} elseif ($method === 'GET') {
    $req = $_GET;
} else {
    json_error('Metode tidak didukung', 405);
}

$kode = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', isset($req['k']) ? (string) $req['k'] : ''));
if ($kode === '') {
    json_error('Masukkan kode voting', 400, ['reason' => 'no_code']);
}
$st = db()->prepare('SELECT * FROM lv_sesi WHERE kode = ?');
$st->execute([$kode]);
$sesi = $st->fetch();
if (!$sesi) {
    json_error('Kode voting tidak ditemukan', 404, ['reason' => 'not_found']);
}
$sesiId = (int) $sesi['id'];

// Tentukan identitas pemilih.
$pemilih = null;
if ($sesi['mode'] === 'undangan') {
    $token = preg_replace('/[^a-f0-9]/', '', isset($req['t']) ? (string) $req['t'] : '');
    $st = db()->prepare('SELECT id, nama FROM lv_pemilih WHERE sesi_id = ? AND token = ?');
    $st->execute([$sesiId, $token]);
    $pemilih = $st->fetch();
    if (!$pemilih) {
        json_error('Voting ini khusus pemilih terdaftar. Gunakan link undangan pribadi Anda.', 403, ['reason' => 'need_invite']);
    }
    $voterKey = 'u:' . $pemilih['id'];
} else {
    $voterKey = 'c:' . voter_cookie(isset($req['vk']) ? (string) $req['vk'] : '');
}

$st = db()->prepare('SELECT pilihan_id FROM lv_suara WHERE sesi_id = ? AND voter_key = ?');
$st->execute([$sesiId, $voterKey]);
$pilihanSaya = $st->fetchColumn();

if ($method === 'POST') {
    if ($pilihanSaya !== false) {
        json_error('Anda sudah memberikan suara pada sesi ini', 409, ['reason' => 'voted']);
    }
    if ($sesi['status'] !== 'dibuka') {
        json_error($sesi['status'] === 'ditutup' ? 'Voting sudah ditutup' : 'Voting belum dibuka', 409, ['reason' => 'closed']);
    }
    $pilihanId = isset($req['pilihan_id']) ? (int) $req['pilihan_id'] : 0;
    $st = db()->prepare('SELECT id FROM lv_pilihan WHERE id = ? AND sesi_id = ?');
    $st->execute([$pilihanId, $sesiId]);
    if (!$st->fetchColumn()) {
        json_error('Pilihan tidak valid');
    }
    if ($pemilih) {
        $nama = $pemilih['nama'];
    } else {
        $nama = str_field($req, 'nama', 150, (bool) $sesi['minta_nama'], 'Nama');
    }
    try {
        db()->prepare('INSERT INTO lv_suara (sesi_id, pilihan_id, voter_key, pemilih_id, nama, ip) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$sesiId, $pilihanId, $voterKey, $pemilih ? (int) $pemilih['id'] : null, $nama !== '' ? $nama : null,
                substr((string) $_SERVER['REMOTE_ADDR'], 0, 45)]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') { // dua klik/tab bersamaan: kunci unik menolak suara kedua
            json_error('Anda sudah memberikan suara pada sesi ini', 409, ['reason' => 'voted']);
        }
        throw $e;
    }
    $pilihanSaya = $pilihanId;
}

$sudah = $pilihanSaya !== false;
$out = [
    'ok' => true,
    'sesi' => [
        'kode' => $sesi['kode'],
        'judul' => $sesi['judul'],
        'pertanyaan' => $sesi['pertanyaan'],
        'mode' => $sesi['mode'],
        'status' => $sesi['status'],
        'minta_nama' => (int) $sesi['minta_nama'],
    ],
    'pemilih' => $pemilih ? $pemilih['nama'] : null,
    'sudah' => $sudah,
    'pilihan_saya' => $sudah ? (int) $pilihanSaya : null,
    'vk' => $pemilih ? null : substr($voterKey, 2),
];
$hasil = tally($sesiId);
$out['pilihan'] = array_map(function ($p) {
    return ['id' => $p['id'], 'label' => $p['label']];
}, $hasil['pilihan']);
if ($sesi['hasil_pemilih'] && ($sudah || $sesi['status'] === 'ditutup')) {
    $out['hasil'] = $hasil;
}
json_out($out);

/** Ambil/buat kunci pemilih perangkat ini; cadangan dari localStorage dipakai bila cookie hilang. */
function voter_cookie($backup)
{
    $key = isset($_COOKIE[VOTER_COOKIE]) ? (string) $_COOKIE[VOTER_COOKIE] : '';
    if (!preg_match('/^[a-f0-9]{32}$/', $key)) {
        $key = preg_match('/^[a-f0-9]{32}$/', $backup) ? $backup : rand_hex(16);
    }
    setcookie(VOTER_COOKIE, $key, [
        'expires' => time() + 400 * 86400,
        'path' => app_path(),
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    return $key;
}
