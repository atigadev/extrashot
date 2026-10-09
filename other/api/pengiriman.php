<?php
/**
 * Label pengiriman.
 *
 * GET  ?q=...&limit=...          -> riwayat (ringkas)
 * GET  ?ids=1,2,3                -> detail lengkap (untuk edit / cetak)
 * POST {"action":"save","data":{...,"items":[...]}}
 * POST {"action":"delete","id":1}
 * POST {"action":"printed","ids":[1,2]}
 */
require __DIR__ . '/db.php';

$pdo = db();

function detail_rows(PDO $pdo, array $ids)
{
    $ids = array_values(array_filter(array_map('intval', $ids)));
    if (!$ids) {
        return [];
    }
    $in = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare("SELECT p.*,
            t.nama AS toko_nama, (t.logo IS NOT NULL) AS toko_ada_logo, UNIX_TIMESTAMP(t.updated_at) AS toko_versi,
            e.nama AS ekspedisi_nama, (e.logo IS NOT NULL) AS eks_ada_logo, UNIX_TIMESTAMP(e.updated_at) AS eks_versi
        FROM pengiriman p
        LEFT JOIN toko t ON t.id = p.toko_id
        LEFT JOIN ekspedisi e ON e.id = p.ekspedisi_id
        WHERE p.id IN ($in)");
    $stmt->execute($ids);
    $rows = [];
    foreach ($stmt->fetchAll() as $r) {
        $r['toko_logo_url'] = $r['toko_ada_logo'] ? 'api/logo.php?type=toko&id=' . $r['toko_id'] . '&v=' . $r['toko_versi'] : null;
        $r['ekspedisi_logo_url'] = $r['eks_ada_logo'] ? 'api/logo.php?type=ekspedisi&id=' . $r['ekspedisi_id'] . '&v=' . $r['eks_versi'] : null;
        unset($r['toko_ada_logo'], $r['toko_versi'], $r['eks_ada_logo'], $r['eks_versi']);
        $r['items'] = [];
        $rows[(int) $r['id']] = $r;
    }
    $stmt = $pdo->prepare("SELECT pengiriman_id, produk, sku, jumlah, satuan FROM pengiriman_item
        WHERE pengiriman_id IN ($in) ORDER BY pengiriman_id, urutan, id");
    $stmt->execute($ids);
    foreach ($stmt->fetchAll() as $it) {
        $pid = (int) $it['pengiriman_id'];
        unset($it['pengiriman_id']);
        $it['jumlah'] = (int) $it['jumlah'];
        $rows[$pid]['items'][] = $it;
    }
    // urutkan sesuai urutan id yang diminta
    $out = [];
    foreach ($ids as $id) {
        if (isset($rows[$id])) {
            $out[] = $rows[$id];
        }
    }
    return $out;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['ids'])) {
        json_out(['ok' => true, 'data' => detail_rows($pdo, explode(',', $_GET['ids']))]);
    }
    $q = trim(isset($_GET['q']) ? $_GET['q'] : '');
    $limit = max(1, min(500, isset($_GET['limit']) ? (int) $_GET['limit'] : 100));
    $where = '';
    $params = [];
    if ($q !== '') {
        $where = 'WHERE p.no_invoice LIKE :q OR p.kode_barcode LIKE :q OR p.penerima_nama LIKE :q OR p.penerima_telepon LIKE :q';
        $params[':q'] = '%' . $q . '%';
    }
    $stmt = $pdo->prepare("SELECT p.id, p.no_invoice, p.kode_barcode, p.penerima_nama, p.metode_bayar, p.dicetak_at, p.created_at,
            t.nama AS toko_nama, e.nama AS ekspedisi_nama, p.layanan,
            (SELECT COUNT(*) FROM pengiriman_item i WHERE i.pengiriman_id = p.id) AS jumlah_item
        FROM pengiriman p
        LEFT JOIN toko t ON t.id = p.toko_id
        LEFT JOIN ekspedisi e ON e.id = p.ekspedisi_id
        $where ORDER BY p.id DESC LIMIT $limit");
    $stmt->execute($params);
    json_out(['ok' => true, 'data' => $stmt->fetchAll()]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metode tidak didukung', 405);
}

$req = json_body();
$action = isset($req['action']) ? $req['action'] : '';

if ($action === 'delete') {
    $pdo->prepare('DELETE FROM pengiriman WHERE id = ?')->execute([(int) (isset($req['id']) ? $req['id'] : 0)]);
    json_out(['ok' => true]);
}

if ($action === 'printed') {
    $ids = array_values(array_filter(array_map('intval', isset($req['ids']) ? (array) $req['ids'] : [])));
    if ($ids) {
        $in = implode(',', array_fill(0, count($ids), '?'));
        $pdo->prepare("UPDATE pengiriman SET dicetak_at = NOW() WHERE id IN ($in)")->execute($ids);
    }
    json_out(['ok' => true]);
}

if ($action !== 'save') {
    json_error('Aksi tidak dikenal');
}

$d = isset($req['data']) && is_array($req['data']) ? $req['data'] : [];
$g = function ($k, $max = 255) use ($d) { return str_or_null(isset($d[$k]) ? $d[$k] : '', $max); };
$n = function ($k) use ($d) { return isset($d[$k]) && is_numeric($d[$k]) ? (float) $d[$k] : 0; };

$row = [
    'toko_id' => !empty($d['toko_id']) ? (int) $d['toko_id'] : null,
    'ekspedisi_id' => !empty($d['ekspedisi_id']) ? (int) $d['ekspedisi_id'] : null,
    'layanan' => $g('layanan', 50),
    'no_invoice' => $g('no_invoice', 100),
    'kode_barcode' => $g('kode_barcode', 100),
    'keterangan_barcode' => $g('keterangan_barcode', 150),
    'berat_kg' => $n('berat_kg'),
    'ongkir' => $n('ongkir'),
    'metode_bayar' => (isset($d['metode_bayar']) && $d['metode_bayar'] === 'cod') ? 'cod' : 'non_tunai',
    'nilai_cod' => $n('nilai_cod'),
    'catatan' => $g('catatan', 255),
    'penerima_nama' => $g('penerima_nama', 150),
    'penerima_alamat' => $g('penerima_alamat', 2000),
    'penerima_telepon' => $g('penerima_telepon', 30),
    'pengirim_nama' => $g('pengirim_nama', 150),
    'pengirim_alamat' => $g('pengirim_alamat', 2000),
    'pengirim_telepon' => $g('pengirim_telepon', 30),
    'samarkan_telepon' => empty($d['samarkan_telepon']) ? 0 : 1,
];
if ($row['kode_barcode'] === null) {
    json_error('Kode barcode / resi wajib diisi');
}
if ($row['penerima_nama'] === null) {
    json_error('Nama penerima wajib diisi');
}

$items = [];
foreach (isset($d['items']) && is_array($d['items']) ? $d['items'] : [] as $it) {
    $produk = str_or_null(isset($it['produk']) ? $it['produk'] : '', 255);
    if ($produk === null) {
        continue;
    }
    $items[] = [
        'produk' => $produk,
        'sku' => str_or_null(isset($it['sku']) ? $it['sku'] : '', 100),
        'jumlah' => max(0, (int) (isset($it['jumlah']) ? $it['jumlah'] : 1)),
        'satuan' => str_or_null(isset($it['satuan']) ? $it['satuan'] : '', 20) ?: 'pcs',
    ];
}

$id = !empty($d['id']) ? (int) $d['id'] : 0;
$pdo->beginTransaction();
$cols = array_keys($row);
if ($id) {
    $set = implode(', ', array_map(function ($c) { return "`$c` = :$c"; }, $cols));
    $stmt = $pdo->prepare("UPDATE pengiriman SET $set WHERE id = :id");
    $stmt->execute($row + ['id' => $id]);
    if (!$stmt->rowCount() && !$pdo->query('SELECT 1 FROM pengiriman WHERE id = ' . $id)->fetch()) {
        $pdo->rollBack();
        json_error('Label tidak ditemukan', 404);
    }
    $pdo->prepare('DELETE FROM pengiriman_item WHERE pengiriman_id = ?')->execute([$id]);
} else {
    $stmt = $pdo->prepare('INSERT INTO pengiriman (`' . implode('`, `', $cols) . '`) VALUES (:' . implode(', :', $cols) . ')');
    $stmt->execute($row);
    $id = (int) $pdo->lastInsertId();
}
$ins = $pdo->prepare('INSERT INTO pengiriman_item (pengiriman_id, urutan, produk, sku, jumlah, satuan) VALUES (?, ?, ?, ?, ?, ?)');
foreach ($items as $i => $it) {
    $ins->execute([$id, $i, $it['produk'], $it['sku'], $it['jumlah'], $it['satuan']]);
}
$pdo->commit();

json_out(['ok' => true, 'id' => $id]);
