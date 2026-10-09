<?php
/**
 * Penyimpanan konfigurasi cetak label (bernama) di server.
 *
 * GET                                   -> {"ok":true,"profiles":{"nama":{"saved_at":"...","settings":{...}}}}
 * POST {"action":"save","name":"...","settings":{...}}
 * POST {"action":"delete","name":"..."}
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$dir  = __DIR__ . '/../data';
$file = $dir . '/konfigurasi.json';

function reply($data, $code = 200)
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function readProfiles($file)
{
    if (!is_file($file)) {
        return [];
    }
    $json = json_decode((string) file_get_contents($file), true);
    return is_array($json) ? $json : [];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $profiles = readProfiles($file);
    reply(['ok' => true, 'profiles' => (object) $profiles]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    reply(['ok' => false, 'error' => 'Metode tidak didukung'], 405);
}

$raw = file_get_contents('php://input');
if (strlen($raw) > 2 * 1024 * 1024) {
    reply(['ok' => false, 'error' => 'Data terlalu besar'], 413);
}
$req  = json_decode($raw, true);
$name = isset($req['name']) ? trim((string) $req['name']) : '';
if (!is_array($req) || $name === '' || mb_strlen($name) > 80) {
    reply(['ok' => false, 'error' => 'Nama konfigurasi tidak valid (1-80 karakter)'], 400);
}

if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
    reply(['ok' => false, 'error' => 'Folder data tidak bisa dibuat'], 500);
}

// Baca-ubah-tulis dalam satu kunci agar dua penyimpanan bersamaan tidak saling menimpa.
$fp = fopen($file, 'c+');
if (!$fp || !flock($fp, LOCK_EX)) {
    reply(['ok' => false, 'error' => 'File konfigurasi tidak bisa dibuka'], 500);
}
$profiles = json_decode((string) stream_get_contents($fp), true);
if (!is_array($profiles)) {
    $profiles = [];
}

$action = isset($req['action']) ? $req['action'] : '';
if ($action === 'save') {
    if (!isset($req['settings']) || !is_array($req['settings'])) {
        flock($fp, LOCK_UN);
        reply(['ok' => false, 'error' => 'Isi konfigurasi kosong'], 400);
    }
    $profiles[$name] = ['saved_at' => date('Y-m-d H:i:s'), 'settings' => $req['settings']];
} elseif ($action === 'delete') {
    unset($profiles[$name]);
} else {
    flock($fp, LOCK_UN);
    reply(['ok' => false, 'error' => 'Aksi tidak dikenal'], 400);
}

ksort($profiles, SORT_NATURAL | SORT_FLAG_CASE);
ftruncate($fp, 0);
rewind($fp);
fwrite($fp, json_encode((object) $profiles, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

reply(['ok' => true, 'profiles' => (object) $profiles]);
