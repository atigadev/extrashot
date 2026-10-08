<?php
/**
 * Master toko & ekspedisi.
 *
 * GET  ?type=toko|ekspedisi                 -> daftar (tanpa isi logo)
 * POST ?type=...  (multipart/form-data)     -> simpan; field: id (opsional), nama, ..., logo (file), hapus_logo=1
 * POST ?type=...&action=delete  id=...      -> hapus
 */
require __DIR__ . '/db.php';

$tables = [
    'toko' => ['pengirim_nama' => 150, 'pengirim_alamat' => 2000, 'pengirim_telepon' => 30],
    'ekspedisi' => ['layanan_default' => 50],
];
$type = isset($_GET['type']) ? $_GET['type'] : '';
if (!isset($tables[$type])) {
    json_error('Tipe tidak dikenal');
}
$fields = $tables[$type];
$pdo = db();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $cols = implode(', ', array_keys($fields));
    $rows = $pdo->query("SELECT id, nama, $cols, aktif, (logo IS NOT NULL) AS ada_logo,
        UNIX_TIMESTAMP(updated_at) AS versi FROM `$type` ORDER BY nama")->fetchAll();
    foreach ($rows as &$r) {
        $r['id'] = (int) $r['id'];
        $r['aktif'] = (int) $r['aktif'];
        $r['logo_url'] = $r['ada_logo'] ? 'api/logo.php?type=' . $type . '&id=' . $r['id'] . '&v=' . $r['versi'] : null;
        unset($r['ada_logo'], $r['versi']);
    }
    json_out(['ok' => true, 'data' => $rows]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metode tidak didukung', 405);
}

$id = isset($_POST['id']) ? (int) $_POST['id'] : 0;

if (isset($_GET['action']) && $_GET['action'] === 'delete') {
    if (!$id) {
        json_error('ID kosong');
    }
    $pdo->prepare("DELETE FROM `$type` WHERE id = ?")->execute([$id]);
    json_out(['ok' => true]);
}

$nama = str_or_null(isset($_POST['nama']) ? $_POST['nama'] : '', 100);
if ($nama === null) {
    json_error('Nama wajib diisi');
}
$values = ['nama' => $nama, 'aktif' => empty($_POST['aktif']) ? 0 : 1];
foreach ($fields as $f => $max) {
    $values[$f] = str_or_null(isset($_POST[$f]) ? $_POST[$f] : '', $max);
}
$logo = uploaded_logo();
if ($logo) {
    $values['logo'] = $logo[0];
    $values['logo_mime'] = $logo[1];
} elseif (!empty($_POST['hapus_logo'])) {
    $values['logo'] = null;
    $values['logo_mime'] = null;
}

$cols = array_keys($values);
if ($id) {
    $set = implode(', ', array_map(function ($c) { return "`$c` = :$c"; }, $cols));
    $stmt = $pdo->prepare("UPDATE `$type` SET $set WHERE id = :id");
    $values['id'] = $id;
} else {
    $stmt = $pdo->prepare("INSERT INTO `$type` (`" . implode('`, `', $cols) . "`) VALUES (:" . implode(', :', $cols) . ')');
}
foreach ($values as $k => $v) {
    $stmt->bindValue(':' . $k, $v, $k === 'logo' && $v !== null ? PDO::PARAM_LOB : ($v === null ? PDO::PARAM_NULL : PDO::PARAM_STR));
}
$stmt->execute();
json_out(['ok' => true, 'id' => $id ?: (int) $pdo->lastInsertId()]);
