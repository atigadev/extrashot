-- Skema database untuk fitur Label Pengiriman.
-- Jalankan: mysql -uroot extradata < database/extradata.sql

CREATE DATABASE IF NOT EXISTS extradata CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE extradata;

-- Toko / marketplace: logo tampil di kiri atas label, data pengirim dipakai sebagai "Dari".
CREATE TABLE IF NOT EXISTS toko (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama             VARCHAR(100) NOT NULL,
  logo             MEDIUMBLOB NULL,
  logo_mime        VARCHAR(50) NULL,
  pengirim_nama    VARCHAR(150) NULL,
  pengirim_alamat  TEXT NULL,
  pengirim_telepon VARCHAR(30) NULL,
  aktif            TINYINT(1) NOT NULL DEFAULT 1,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_toko_nama (nama)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ekspedisi / kurir: logo tampil di bawah nomor invoice.
CREATE TABLE IF NOT EXISTS ekspedisi (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama            VARCHAR(100) NOT NULL,
  logo            MEDIUMBLOB NULL,
  logo_mime       VARCHAR(50) NULL,
  layanan_default VARCHAR(50) NULL,
  aktif           TINYINT(1) NOT NULL DEFAULT 1,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ekspedisi_nama (nama)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Label pengiriman yang dibuat.
CREATE TABLE IF NOT EXISTS pengiriman (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  toko_id            INT UNSIGNED NULL,
  ekspedisi_id       INT UNSIGNED NULL,
  layanan            VARCHAR(50) NULL,
  no_invoice         VARCHAR(100) NULL,
  kode_barcode       VARCHAR(100) NOT NULL,
  keterangan_barcode VARCHAR(150) NULL,
  berat_kg           DECIMAL(10,2) NOT NULL DEFAULT 0,
  ongkir             DECIMAL(14,2) NOT NULL DEFAULT 0,
  metode_bayar       ENUM('non_tunai','cod') NOT NULL DEFAULT 'non_tunai',
  nilai_cod          DECIMAL(14,2) NOT NULL DEFAULT 0,
  catatan            VARCHAR(255) NULL,
  penerima_nama      VARCHAR(150) NOT NULL,
  penerima_alamat    TEXT NULL,
  penerima_telepon   VARCHAR(30) NULL,
  pengirim_nama      VARCHAR(150) NULL,
  pengirim_alamat    TEXT NULL,
  pengirim_telepon   VARCHAR(30) NULL,
  samarkan_telepon   TINYINT(1) NOT NULL DEFAULT 1,
  dicetak_at         DATETIME NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pengiriman_invoice (no_invoice),
  KEY idx_pengiriman_barcode (kode_barcode),
  KEY idx_pengiriman_created (created_at),
  CONSTRAINT fk_pengiriman_toko FOREIGN KEY (toko_id) REFERENCES toko (id) ON DELETE SET NULL,
  CONSTRAINT fk_pengiriman_ekspedisi FOREIGN KEY (ekspedisi_id) REFERENCES ekspedisi (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daftar produk di tiap label.
CREATE TABLE IF NOT EXISTS pengiriman_item (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pengiriman_id INT UNSIGNED NOT NULL,
  urutan        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  produk        VARCHAR(255) NOT NULL,
  sku           VARCHAR(100) NULL,
  jumlah        INT NOT NULL DEFAULT 1,
  satuan        VARCHAR(20) NOT NULL DEFAULT 'pcs',
  PRIMARY KEY (id),
  KEY idx_item_pengiriman (pengiriman_id),
  CONSTRAINT fk_item_pengiriman FOREIGN KEY (pengiriman_id) REFERENCES pengiriman (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
