-- Skema database aplikasi Net Plan (perencanaan titik jaringan event).
-- Tabel dibuat otomatis saat admin pertama kali login. File ini disediakan bila ingin
-- mengimpor manual lewat phpMyAdmin / mysql:  mysql -uroot extradata < net-plan/database/netplan.sql
-- Sengaja tanpa CREATE DATABASE / USE agar bisa diimpor di hosting (cPanel) yang nama databasenya berawalan.

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
  kode_lihat      VARCHAR(32)  NOT NULL,             -- kode link lihat-saja untuk teknisi lapangan
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
  jenis           VARCHAR(20)  NOT NULL,             -- isp, router, switch, ap, bridge, lan, server, cctv, lainnya
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
  x              DOUBLE NOT NULL DEFAULT 0,         -- posisi di denah (piksel gambar)
  y               DOUBLE NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_np_perangkat_proyek (proyek_id),
  KEY idx_np_perangkat_uplink (uplink_id),
  CONSTRAINT fk_np_perangkat_proyek FOREIGN KEY (proyek_id) REFERENCES np_proyek (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Kolom yang ditambahkan pada versi berikutnya ditambahkan otomatis oleh api/admin.php (install_schema).
