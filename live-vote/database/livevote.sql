-- Skema database aplikasi Live Vote.
-- Tabel dibuat otomatis saat admin pertama kali login. File ini disediakan bila ingin
-- mengimpor manual lewat phpMyAdmin / mysql:  mysql -uroot extradata < live-vote/database/livevote.sql
-- Sengaja tanpa CREATE DATABASE / USE agar bisa diimpor di hosting (cPanel) yang nama databasenya berawalan.

-- Satu sesi = satu pertanyaan beserta pilihannya.
CREATE TABLE IF NOT EXISTS lv_sesi (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  judul           VARCHAR(150) NOT NULL,
  pertanyaan      VARCHAR(500) NOT NULL,
  kode            VARCHAR(12)  NOT NULL,             -- kode/link untuk pemilih
  kode_layar      VARCHAR(32)  NOT NULL,             -- kode rahasia layar hasil
  mode            ENUM('terbuka','undangan') NOT NULL DEFAULT 'terbuka',
  status          ENUM('draf','dibuka','ditutup') NOT NULL DEFAULT 'draf',
  hasil_pemilih   TINYINT(1) NOT NULL DEFAULT 0,     -- pemilih boleh melihat hasil setelah memilih
  minta_nama      TINYINT(1) NOT NULL DEFAULT 0,     -- mode terbuka: pemilih wajib mengisi nama
  dibuka_at       DATETIME NULL,
  ditutup_at      DATETIME NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_lv_sesi_kode (kode),
  UNIQUE KEY uk_lv_sesi_kode_layar (kode_layar)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lv_pilihan (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sesi_id  INT UNSIGNED NOT NULL,
  label    VARCHAR(200) NOT NULL,
  urutan   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_lv_pilihan_sesi (sesi_id, urutan),
  CONSTRAINT fk_lv_pilihan_sesi FOREIGN KEY (sesi_id) REFERENCES lv_sesi (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daftar pemilih untuk mode "undangan": setiap orang mendapat link (token) sendiri.
CREATE TABLE IF NOT EXISTS lv_pemilih (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sesi_id    INT UNSIGNED NOT NULL,
  nama       VARCHAR(150) NOT NULL,
  token      VARCHAR(32)  NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_lv_pemilih_token (token),
  KEY ix_lv_pemilih_sesi (sesi_id),
  CONSTRAINT fk_lv_pemilih_sesi FOREIGN KEY (sesi_id) REFERENCES lv_sesi (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Suara. UNIQUE (sesi_id, voter_key) menjamin satu pemilih hanya bisa memilih sekali per sesi:
--   mode terbuka  -> voter_key = 'c:' + cookie acak perangkat
--   mode undangan -> voter_key = 'u:' + id pemilih
CREATE TABLE IF NOT EXISTS lv_suara (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sesi_id     INT UNSIGNED NOT NULL,
  pilihan_id  INT UNSIGNED NOT NULL,
  voter_key   VARCHAR(70)  NOT NULL,
  pemilih_id  INT UNSIGNED NULL,
  nama        VARCHAR(150) NULL,
  ip          VARCHAR(45)  NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_lv_suara_pemilih (sesi_id, voter_key),
  KEY ix_lv_suara_pilihan (pilihan_id),
  CONSTRAINT fk_lv_suara_sesi FOREIGN KEY (sesi_id) REFERENCES lv_sesi (id) ON DELETE CASCADE,
  CONSTRAINT fk_lv_suara_pilihan FOREIGN KEY (pilihan_id) REFERENCES lv_pilihan (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
