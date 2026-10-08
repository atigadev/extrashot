<?php
/** Menampilkan logo toko/ekspedisi dari database: ?type=toko|ekspedisi&id=... */
require __DIR__ . '/db.php';

$type = isset($_GET['type']) ? $_GET['type'] : '';
$id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
if (!in_array($type, ['toko', 'ekspedisi'], true) || !$id) {
    http_response_code(404);
    exit;
}
$stmt = db()->prepare("SELECT logo, logo_mime FROM `$type` WHERE id = ?");
$stmt->execute([$id]);
$row = $stmt->fetch();
if (!$row || $row['logo'] === null) {
    http_response_code(404);
    exit;
}
header('Content-Type: ' . $row['logo_mime']);
header('Content-Length: ' . strlen($row['logo']));
header('Cache-Control: public, max-age=31536000, immutable');
header('X-Content-Type-Options: nosniff');
// SVG yang dibuka langsung tidak boleh menjalankan skrip.
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:");
echo $row['logo'];
