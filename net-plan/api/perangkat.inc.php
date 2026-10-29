<?php
/**
 * Validasi & penyimpanan perangkat / unit gudang yang dipakai bersama api/admin.php (admin) dan api/tim.php (installer).
 * Butuh db.php. find_proyek() (admin.php) hanya dipanggil simpan_perangkat() untuk perangkat baru — installer hanya mengubah.
 */
if (!function_exists('db')) { // file pustaka, bukan endpoint
    http_response_code(404);
    exit;
}

/** Id katalog yang benar-benar ada, atau null. */
function katalog_id_valid($v)
{
    if ($v === null || $v === '' || !is_numeric($v)) {
        return null;
    }
    $st = db()->prepare('SELECT id FROM np_katalog WHERE id = ?');
    $st->execute([(int) $v]);
    return $st->fetchColumn() ? (int) $v : null;
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
    if ($has('katalog_id')) {
        $kid = isset($req['katalog_id']) ? $req['katalog_id'] : null;
        $set['katalog_id'] = katalog_id_valid($kid);
        if ($kid !== null && $kid !== '' && $set['katalog_id'] === null) {
            json_error('Item katalog tidak ditemukan');
        }
    }
    foreach (['x', 'y'] as $k) {
        if ($has($k)) {
            $v = isset($req[$k]) && is_numeric($req[$k]) ? (float) $req[$k] : 0;
            $set[$k] = max(-100000, min(100000, $v));
        }
    }
    if ($has('uplink_id')) {
        $up = isset($req['uplink_id']) && $req['uplink_id'] !== '' && $req['uplink_id'] !== null ? (int) $req['uplink_id'] : null;
        // Titik listrik bukan perangkat jaringan: tidak punya uplink.
        $jenisNow = isset($set['jenis']) ? $set['jenis'] : ($cur ? $cur['jenis'] : '');
        if (in_array($jenisNow, ['listrik', 'support'], true)) {
            $up = null;
        }
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
            // Perubahan status oleh admin ikut tercatat di riwayat (sama seperti perubahan oleh tim).
            if (isset($set['status']) && $set['status'] !== $cur['status']) {
                tulis_log($proyekId, ['id' => $id, 'nama' => isset($set['nama']) ? $set['nama'] : $cur['nama']], null, 'Admin',
                    $cur['status'], $set['status'], '');
            }
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
    $st = db()->prepare('SELECT jenis FROM np_perangkat WHERE id = ?');
    $st->execute([$uplinkId]);
    if (in_array($st->fetchColumn(), ['listrik', 'support'], true)) {
        json_error('Titik listrik & peralatan support bukan perangkat jaringan — tidak bisa menjadi uplink');
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


/**
 * Isian unit gudang dari request (dipangkas & dibatasi panjangnya). $lama = baris unit saat ini: password yang tidak
 * diubah (tidak dikirim / tersamar "••••••") dipertahankan.
 */
function unit_isian($req, $lama)
{
    $teks = function ($k, $max) use ($req) {
        return mb_substr(trim(isset($req[$k]) ? (string) $req[$k] : ''), 0, $max);
    };
    $pass = isset($req['pass_admin']) ? (string) $req['pass_admin'] : null;
    $kondisi = isset($req['kondisi']) && in_array($req['kondisi'], NP_UNIT_KONDISI, true) ? $req['kondisi'] : ($lama ? $lama['kondisi'] : 'baik');
    return [
        'sn' => $teks('sn', 80), 'mac' => strtoupper($teks('mac', 40)), 'firmware' => $teks('firmware', 80), 'aset' => $teks('aset', 80),
        'ip_mgmt' => $teks('ip_mgmt', 80), 'user_admin' => $teks('user_admin', 80),
        'pass_admin' => $pass === null || $pass === '••••••' ? ($lama ? $lama['pass_admin'] : '') : mb_substr($pass, 0, 160),
        'kondisi' => $kondisi, 'lokasi' => $teks('lokasi', 120),
        'catatan' => mb_substr(isset($req['catatan']) ? (string) $req['catatan'] : '', 0, 4000),
    ];
}

/** Unit lain yang SN / MAC-nya sama dengan $v (di seluruh gudang): pesan, atau '' bila tidak ada. */
function unit_dobel($v, $kecuali)
{
    $pdo = db();
    if ($v['sn'] !== '') {
        $st = $pdo->prepare('SELECT k.merek, k.model FROM np_unit u JOIN np_katalog k ON k.id = u.katalog_id WHERE UPPER(u.sn) = UPPER(?) AND u.id <> ? LIMIT 1');
        $st->execute([$v['sn'], (int) $kecuali]);
        if ($r = $st->fetch()) {
            return 'SN ' . $v['sn'] . ' sudah tercatat di ' . trim($r['merek'] . ' ' . $r['model']);
        }
    }
    $mac = preg_replace('/[^0-9a-f]/', '', strtolower($v['mac']));
    if ($mac !== '') {
        $st = $pdo->prepare("SELECT k.merek, k.model FROM np_unit u JOIN np_katalog k ON k.id = u.katalog_id
            WHERE LOWER(REPLACE(REPLACE(REPLACE(REPLACE(u.mac, ':', ''), '-', ''), '.', ''), ' ', '')) = ? AND u.id <> ? LIMIT 1");
        $st->execute([$mac, (int) $kecuali]);
        if ($r = $st->fetch()) {
            return 'MAC ' . $v['mac'] . ' sudah tercatat di ' . trim($r['merek'] . ' ' . $r['model']);
        }
    }
    return '';
}

/** Tolak simpan bila SN / MAC sudah dipakai unit lain (satu unit fisik hanya dicatat sekali). */
function unit_cek_unik($v, $kecuali)
{
    $dobel = unit_dobel($v, $kecuali);
    if ($dobel) {
        json_error($dobel . ' — satu unit fisik hanya dicatat sekali');
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
        // Daftar sambungan tambahan (JSON berisi port, status kabel & lekukan jalur) boleh lebih panjang.
        $maks = in_array($k, ['wan_lain', 'uplink_lain', 'ceklis', 'ceklis_x', 'mt', 'verif', 'vlan_port'], true) ? 20000 : 1000;
        if (mb_strlen($v) > $maks) {
            json_error('Isian "' . $k . '" maksimal ' . $maks . ' karakter');
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
