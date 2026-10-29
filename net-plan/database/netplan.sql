-- Skema database aplikasi Net Plan (perencanaan titik jaringan event).
-- Tabel dibuat otomatis saat admin pertama kali login. File ini disediakan bila ingin
-- mengimpor manual lewat phpMyAdmin / mysql:  mysql -uroot extradata < net-plan/database/netplan.sql
-- Sengaja tanpa CREATE DATABASE / USE agar bisa diimpor di hosting (cPanel) yang nama databasenya berawalan.

-- Info aplikasi, mis. versi struktur tabel (k = 'schema'). Dipakai migrasi otomatis setelah deploy.
CREATE TABLE IF NOT EXISTS np_meta (
  k               VARCHAR(40)  NOT NULL,
  v               VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Satu proyek = satu event/venue beserta denahnya.
CREATE TABLE IF NOT EXISTS np_proyek (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama            VARCHAR(150) NOT NULL,
  venue           VARCHAR(200) NOT NULL DEFAULT '',
  tanggal_mulai   DATE NULL,
  tanggal_selesai DATE NULL,
  catatan         TEXT NULL,
  denah_file      VARCHAR(80)  NULL,                 -- nama file di folder uploads/
  denah_w         INT UNSIGNED NULL,                 -- ukuran gambar denah (piksel)
  denah_h         INT UNSIGNED NULL,
  skala           DOUBLE NULL,                       -- meter per piksel denah (hasil kalibrasi)
  slack_kabel     SMALLINT UNSIGNED NOT NULL DEFAULT 20, -- tambahan panjang kabel (%) dari jarak lurus
  lapisan         TEXT NULL,                         -- JSON layer jaringan: [{"id":"L1","nama":"EXPO LINE","warna":"#2563eb"}, ...]
  lantai          TEXT NULL,                         -- JSON lantai: [{"id":"F2","nama":"Lantai 2","tinggi":4,"denah_file":..,"denah_w":..,"denah_h":..,"skala":..}] (F1 = denah utama)
  anotasi         MEDIUMTEXT NULL,                   -- JSON label & panah di denah: [{"id":"A1","teks":..,"warna":"hijau","x":..,"y":..,"tx":..,"ty":..,"ke":id|null,"lantai":"F1"}]
  kode_lihat      VARCHAR(32)  NOT NULL,             -- kode link lihat-saja untuk teknisi lapangan
  admin_hash      VARCHAR(255) NULL,                 -- password admin event (bcrypt); NULL = hanya admin utama
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_np_proyek_kode (kode_lihat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Satu baris = satu titik perangkat di denah (ISP, router, switch, AP, titik LAN, dst).
-- uplink_id menunjuk perangkat induk (sumber koneksi), sehingga jalur ke WAN bisa ditelusuri.
CREATE TABLE IF NOT EXISTS np_perangkat (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  proyek_id       INT UNSIGNED NOT NULL,
  jenis           VARCHAR(20)  NOT NULL,             -- isp, router, switch, ap, bridge, lan, server, cctv, endpoint, lainnya, listrik
  nama            VARCHAR(100) NOT NULL,             -- label di denah, mis. AP-01
  model           VARCHAR(150) NOT NULL DEFAULT '',  -- merek/tipe alat
  ip              VARCHAR(64)  NOT NULL DEFAULT '',
  vlan            VARCHAR(50)  NOT NULL DEFAULT '',
  uplink_id       INT UNSIGNED NULL,                 -- perangkat induk (dicek aplikasi: satu proyek, tanpa loop)
  port_uplink     VARCHAR(50)  NOT NULL DEFAULT '',  -- port di perangkat induk
  port_lokal      VARCHAR(50)  NOT NULL DEFAULT '',  -- port di perangkat ini
  media           VARCHAR(20)  NOT NULL DEFAULT '',  -- utp, fiber, wireless, lainnya
  bandwidth_mbps  DECIMAL(10,2) NULL,                -- kapasitas (ISP) / alokasi atau limit (lainnya)
  status          VARCHAR(20)  NOT NULL DEFAULT 'rencana', -- rencana, terpasang, diuji, bermasalah
  pic             VARCHAR(100) NOT NULL DEFAULT '',
  catatan         TEXT NULL,                         -- keterangan konfigurasi
  atribut         TEXT NULL,                         -- JSON: isian khusus per jenis (SSID, channel, provider, ...)
  jalur           TEXT NULL,                         -- JSON bentuk kabel ke uplink: {"m":"h|v|bebas","p":[[x,y],...]}; NULL = lurus
  katalog_id      INT UNSIGNED NULL,                 -- alat dari np_katalog (NULL = diisi manual)
  x              DOUBLE NOT NULL DEFAULT 0,         -- posisi di denah (piksel gambar)
  y               DOUBLE NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_np_perangkat_proyek (proyek_id),
  KEY idx_np_perangkat_uplink (uplink_id),
  KEY idx_np_perangkat_katalog (katalog_id),
  CONSTRAINT fk_np_perangkat_proyek FOREIGN KEY (proyek_id) REFERENCES np_proyek (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Tabel yang sudah ada dari versi lama tidak diubah oleh CREATE di atas: kolom/index baru ditambahkan oleh
-- np_install_schema() di api/db.php (idempoten). Kolom baru: tambahkan di CREATE DAN di fungsi tersebut.

-- Akses tim per event (link bertoken, tanpa password). peran: lihat | status.
-- status_boleh / jenis_boleh: JSON array; jenis kosong = semua kategori.
CREATE TABLE IF NOT EXISTS np_akses (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  proyek_id       INT UNSIGNED NOT NULL,
  nama            VARCHAR(100) NOT NULL,             -- nama tim / anggota, mis. "Tim WiFi"
  token           VARCHAR(32)  NOT NULL,
  peran           VARCHAR(20)  NOT NULL DEFAULT 'lihat',
  status_boleh    TEXT NULL,                         -- status yang boleh diset tim, mis. ["terpasang","bermasalah"]
  jenis_boleh     TEXT NULL,                         -- kategori perangkat tugas tim, mis. ["ap","switch"]
  lihat_password  TINYINT(1) NOT NULL DEFAULT 0,     -- boleh melihat password WiFi/admin
  aktif           TINYINT(1) NOT NULL DEFAULT 1,
  terakhir_dipakai DATETIME NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_np_akses_token (token),
  KEY idx_np_akses_proyek (proyek_id),
  CONSTRAINT fk_np_akses_proyek FOREIGN KEY (proyek_id) REFERENCES np_proyek (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Riwayat aktivitas: perubahan status & catatan lapangan (oleh admin atau tim).
CREATE TABLE IF NOT EXISTS np_log (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  proyek_id       INT UNSIGNED NOT NULL,
  perangkat_id    INT UNSIGNED NULL,
  perangkat_nama  VARCHAR(100) NOT NULL DEFAULT '',  -- disimpan agar riwayat tetap terbaca bila perangkat dihapus
  akses_id        INT UNSIGNED NULL,                 -- NULL = admin
  oleh            VARCHAR(100) NOT NULL DEFAULT '',
  status_lama     VARCHAR(20)  NOT NULL DEFAULT '',
  status_baru     VARCHAR(20)  NOT NULL DEFAULT '',
  catatan         TEXT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_np_log_proyek (proyek_id, id),
  KEY idx_np_log_perangkat (perangkat_id),
  CONSTRAINT fk_np_log_proyek FOREIGN KEY (proyek_id) REFERENCES np_proyek (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tipe endpoint (laptop, PC, printer, pinpad, ...) yang bisa diubah & ditambah pengguna. Perangkat berjenis "endpoint"
-- menyimpan id tipenya di atribut "tipe_endpoint". Tipe bawaan diisi np_install_schema() saat tabel baru dibuat.
CREATE TABLE IF NOT EXISTS np_endpoint_tipe (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama            VARCHAR(60)  NOT NULL,
  singkatan       VARCHAR(4)   NOT NULL,             -- teks di titik denah, mis. LPT
  ikon            VARCHAR(20)  NOT NULL DEFAULT '',  -- ikon di titik denah: laptop, pc, printer, scanner, pinpad, server, ...
  warna           VARCHAR(7)   NOT NULL DEFAULT '#ea580c',
  prefix          VARCHAR(12)  NOT NULL,             -- awalan nama otomatis, mis. LPT -> LPT-01
  urutan          SMALLINT     NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_np_endpoint_tipe_nama (nama)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Katalog perangkat (berlaku untuk semua event): alat yang dimiliki/dipakai beserta spesifikasi & konfigurasi standar.
CREATE TABLE IF NOT EXISTS np_katalog (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  jenis           VARCHAR(20)  NOT NULL,             -- kategori, sama dengan np_perangkat.jenis
  merek           VARCHAR(80)  NOT NULL DEFAULT '',
  model           VARCHAR(120) NOT NULL,             -- tipe/seri, mis. RB5009UG+S+IN
  stok            INT UNSIGNED NULL,                 -- jumlah unit tersedia (NULL = tidak dicatat)
  spesifikasi     TEXT NULL,                         -- JSON: port, PoE, daya, throughput, standar WiFi, ...
  konfigurasi     TEXT NULL,                         -- JSON: nilai standar isian khusus jenis (SSID, keamanan, ...)
  bandwidth_mbps  DECIMAL(10,2) NULL,                -- nilai bandwidth standar
  catatan_konfig  TEXT NULL,                         -- template keterangan konfigurasi
  keterangan      TEXT NULL,                         -- catatan katalog (lokasi gudang, aksesoris, ...)
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_np_katalog_jenis (jenis)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Foto bukti pemasangan perangkat (1-3 per perangkat), diambil dari kamera ponsel. Gambar sudah diberi cap
-- (judul event, nama perangkat, koordinat, waktu) di browser; file di uploads/ (foto_<hex>.jpg), dibaca lewat api/foto.php.
-- perangkat_id tanpa foreign key: foto tetap ada saat perangkat dihapus lalu dipulihkan (Ctrl+Z).
CREATE TABLE IF NOT EXISTS np_foto (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  proyek_id       INT UNSIGNED NOT NULL,
  perangkat_id    INT UNSIGNED NOT NULL,
  file            VARCHAR(60)  NOT NULL,
  w               SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  h               SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  lat             DECIMAL(10,7) NULL,                -- koordinat lokasi saat foto diambil (GPS ponsel)
  lng             DECIMAL(10,7) NULL,
  akurasi_m       DECIMAL(8,1)  NULL,                -- akurasi GPS (meter)
  diambil_at      DATETIME NULL,                     -- waktu foto menurut ponsel
  akses_id        INT UNSIGNED NULL,                 -- NULL = admin
  oleh            VARCHAR(100) NOT NULL DEFAULT '',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_np_foto_proyek (proyek_id),
  KEY idx_np_foto_perangkat (perangkat_id),
  CONSTRAINT fk_np_foto_proyek FOREIGN KEY (proyek_id) REFERENCES np_proyek (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gudang: unit fisik per alat katalog (kategori + merek + tipe). Data unit (SN, MAC, firmware, akses, file konfigurasi)
-- tersimpan di sini, bukan di event. perangkat_id = unit sedang dipakai titik itu di event (NULL = tersedia di gudang);
-- otomatis lepas (NULL) bila perangkatnya / eventnya dihapus.
CREATE TABLE IF NOT EXISTS np_unit (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  katalog_id      INT UNSIGNED NOT NULL,
  sn              VARCHAR(80)  NOT NULL DEFAULT '',  -- nomor seri
  mac             VARCHAR(40)  NOT NULL DEFAULT '',
  firmware        VARCHAR(80)  NOT NULL DEFAULT '',
  aset            VARCHAR(80)  NOT NULL DEFAULT '',  -- no. aset / inventaris
  ip_mgmt         VARCHAR(80)  NOT NULL DEFAULT '',  -- IP manajemen
  user_admin      VARCHAR(80)  NOT NULL DEFAULT '',
  pass_admin      VARCHAR(160) NOT NULL DEFAULT '',
  kondisi         VARCHAR(10)  NOT NULL DEFAULT 'baik', -- baik | servis | rusak
  lokasi          VARCHAR(120) NOT NULL DEFAULT '',  -- lokasi di gudang / rak / box
  catatan         TEXT NULL,                         -- konfigurasi khusus unit ini
  perangkat_id    INT UNSIGNED NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_np_unit_perangkat (perangkat_id),
  KEY idx_np_unit_katalog (katalog_id),
  CONSTRAINT fk_np_unit_katalog FOREIGN KEY (katalog_id) REFERENCES np_katalog (id) ON DELETE CASCADE,
  CONSTRAINT fk_np_unit_perangkat FOREIGN KEY (perangkat_id) REFERENCES np_perangkat (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- File konfigurasi / backup milik unit gudang (.cfg/.rsc/.backup/...): di uploads/, dibaca lewat api/berkas.php.
CREATE TABLE IF NOT EXISTS np_berkas (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  unit_id         INT UNSIGNED NOT NULL,
  file            VARCHAR(60)  NOT NULL,             -- nama simpan: berkas_<hex>.bin
  nama            VARCHAR(160) NOT NULL,             -- nama file asli (untuk unduh)
  ukuran          INT UNSIGNED NOT NULL DEFAULT 0,
  oleh            VARCHAR(100) NOT NULL DEFAULT '',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_np_berkas_unit (unit_id),
  CONSTRAINT fk_np_berkas_unit FOREIGN KEY (unit_id) REFERENCES np_unit (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
