# extrashot
Aplikasi Pendukung Saturegis

Kumpulan alat cetak berbasis web (PHP + JavaScript) yang berjalan di XAMPP.

| Menu | File | Fungsi |
|---|---|---|
| Label dari Excel | `index.html` | Cetak label TJ No. 100–129 dari data Excel/CSV. Ukuran label dibaca dari `Ukuran_Label_TJ_No100-129.xlsx`. |
| Label Pengiriman | `pengiriman.html` | Buat & cetak label pengiriman (barcode Code128, Non Tunai/COD), riwayat tersimpan di database. |
| Toko & Ekspedisi | `master.html` | Master data toko & ekspedisi beserta logonya. |
| Cetak Foto | `foto.html` | Cetak foto / pas foto ukuran standar (2x3 s.d. 8RS), crop, border, ganti background, tanda potong (bleed + crop marks). |
| Crop Massal | `crop.html` | Crop banyak foto dari folder/subfolder berdasarkan deteksi wajah, keluaran mm/piksel, unduh ZIP. |

Halaman **Cetak Foto** dan **Crop Massal** memproses foto sepenuhnya di browser: foto tidak diunggah ke server dan tidak disimpan di database.

## Kebutuhan

- XAMPP (PHP 7.4+ dengan ekstensi `pdo_mysql`, MariaDB/MySQL, Apache)
- Browser modern (Chrome/Edge terbaru disarankan)

Semua library pihak ketiga sudah ada di folder `vendor/` sehingga aplikasi bisa dipakai tanpa internet:

| Library | Lisensi | Dipakai untuk |
|---|---|---|
| SheetJS (`vendor/xlsx.full.min.js`) | Apache-2.0 | Membaca Excel |
| JsBarcode (`vendor/JsBarcode.all.min.js`) | MIT | Barcode label pengiriman |
| JSZip (`vendor/jszip.min.js`) | MIT | ZIP hasil Crop Massal |
| MediaPipe Tasks Vision (`vendor/mediapipe/`) | Apache-2.0 | Deteksi wajah & penghapusan background |

## Instalasi

1. Clone ke folder `htdocs` XAMPP:
   ```bash
   cd C:/xampp/htdocs
   git clone https://github.com/atigadev/extrashot.git extra.saturegis
   ```
2. Buat database dan tabelnya (dibutuhkan oleh Label Pengiriman dan Toko & Ekspedisi):
   ```bash
   C:/xampp/mysql/bin/mysql.exe -uroot -e "CREATE DATABASE IF NOT EXISTS extradata CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
   C:/xampp/mysql/bin/mysql.exe -uroot extradata < database/extradata.sql
   ```
   atau impor `database/extradata.sql` lewat phpMyAdmin.
3. Kredensial database bawaan adalah XAMPP standar (`root` tanpa password). Bila berbeda, salin
   `api/db.local.example.php` menjadi `api/db.local.php` dan isi kredensialnya. File ini tidak ikut ke Git.
4. Jalankan Apache & MySQL dari XAMPP Control Panel, lalu buka `http://localhost/extra.saturegis/`.

> Buka lewat `http://localhost/...`, bukan dengan klik ganda file HTML (`file://`), karena file ukuran
> label, model deteksi wajah, dan API database hanya bisa dimuat melalui web server.

## Struktur folder

```
api/          API PHP (koneksi DB, master toko/ekspedisi, label pengiriman, logo, konfigurasi tersimpan)
assets/       JavaScript & CSS tiap halaman
data/         Data runtime (konfigurasi tersimpan) — dibuat otomatis, tidak ikut ke Git
database/     Skema database (extradata.sql)
vendor/       Library pihak ketiga & model MediaPipe
```

Folder `data/` dan `database/` dilindungi `.htaccess` sehingga tidak bisa dibuka langsung dari browser.

## Alur kerja Git

Mengambil perubahan terbaru:
```bash
git pull
```

Menyimpan & mengirim perubahan:
```bash
git status                      # lihat file yang berubah
git add .                       # tandai semua perubahan
git commit -m "Jelaskan perubahan"
git push                        # kirim ke GitHub
```

Untuk fitur yang lebih besar, sebaiknya kerjakan di branch terpisah:
```bash
git checkout -b fitur-baru
# ... ubah file, commit ...
git push -u origin fitur-baru   # lalu buat Pull Request di GitHub
```
