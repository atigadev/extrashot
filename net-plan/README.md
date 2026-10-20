# Net Plan — Perencanaan Titik Jaringan Event

Upload denah venue, lalu taruh titik-titik jaringan (sumber WAN/ISP, router, switch, access point, wireless bridge,
titik LAN, server, CCTV) langsung di atas denah. Setiap titik menyimpan konfigurasinya sendiri: nama alat, uplink (dapat
koneksi dari mana), port, media, bandwidth, IP/VLAN, isian khusus per jenis (SSID, channel, provider, dst.), dan
keterangan konfigurasi bebas.

## Halaman

| Tab | Isi |
|---|---|
| **Denah** | Peta interaktif: tambah/geser titik, hubungkan ke uplink, ukur jarak & kalibrasi skala, lingkaran cakupan AP, panel konfigurasi per perangkat |
| **Daftar perangkat** | Tabel semua perangkat (cari, filter, urutkan), unduh CSV, ekspor/impor JSON |
| **Topologi & cek** | Pohon topologi dari WAN ke perangkat paling ujung, pemeriksaan desain, ringkasan WAN/SSID, kebutuhan perangkat (BOM), estimasi kabel |
| **Proyek** | Info event, upload/ganti denah, skala, link lihat-saja + QR, duplikat/hapus event |

Tombol **Cetak** menyediakan dua jenis laporan:

- **Sheet konfigurasi AP** (A4 tegak) adalah acuan teknisi saat setting AP. Halaman pertama berisi denah, ringkasan
  SSID, dan rencana channel & alamat. Setelah itu ada satu kartu per AP, dua kartu per halaman, berisi:
  - potongan denah lokasi;
  - SSID, password, channel, dan IP dalam ukuran besar;
  - gateway/subnet/DNS (diambil dari router di jalurnya);
  - switch, port, dan PoE uplink;
  - semua setting WiFi dan keterangan konfigurasi;
  - checklist pemasangan dan kolom paraf.

  Isian yang kosong dicetak sebagai garis untuk diisi tangan. Wireless bridge bisa ikut disertakan, dan password bisa
  disembunyikan. Tombol **Unduh CSV** menghasilkan data yang sama untuk Excel.
- **Laporan lengkap** (A4 mendatar) berisi denah bertitik, tabel konfigurasi semua perangkat, BOM, dan hasil
  pemeriksaan.

## Alur pakai

1. Buka `http://localhost/extra.saturegis/net-plan/` lalu login (XAMPP lokal: password `admin`).
2. **+ Event baru**: isi nama/venue/tanggal dan upload denah (PNG/JPG/WEBP; denah PDF/CAD diekspor dulu menjadi gambar).
3. **Kalibrasi skala**: alat **Ukur** (`M`), klik kedua ujung garis skala di denah (mis. "7000 cm"), isi `70` meter, lalu
   **Set skala denah**. Setelah itu panjang kabel, jarak link wireless, dan radius cakupan AP dihitung dalam meter.
4. Taruh **Sumber WAN** (`1`) dan **Router** (`2`), lalu hubungkan router ke WAN dengan alat **Hubungkan** (`L`): klik
   router, kemudian klik WAN.
5. Pilih switch, lalu pilih alat **AP** (`5`) dan klik beberapa kali di denah. Setiap AP otomatis memakai switch
   tersebut sebagai uplink.
6. Klik sebuah titik untuk mengisi konfigurasinya. Isian tersimpan otomatis saat pindah ke isian berikutnya.
7. Buka **Topologi & cek** untuk melihat hasil pemeriksaan, lalu bagikan link lihat-saja ke teknisi lapangan.

**Jalur kabel mengikuti gedung.** Pilih perangkat, lalu di panel *Koneksi* tentukan bentuk jalurnya:

- **Lurus**
- **Siku ┐ / Siku └**: bentuk L otomatis yang tetap siku saat perangkat digeser.
- **Ikuti gedung**: lekukan bebas.
  - Tarik bulatan kecil di tengah garis untuk menambah lekukan, lalu geser kotak lekukan untuk memindahkannya.
  - Klik ganda atau klik kanan kotak untuk menghapus lekukan.
  - Saat digeser, lekukan otomatis sejajar (siku) dengan titik di sebelahnya. Tahan `Alt` untuk menggeser bebas.

Panjang kabel dihitung mengikuti jalur ini. Link wireless selalu digambar lurus.

**Penamaan per group.** Perangkat sejenis yang terhubung ke uplink yang sama, misalnya semua titik LAN di bawah SW-05,
membentuk satu group.
- Pilih salah satu anggota (atau switch-nya), isi **Nama group** di panel Koneksi, misalnya `BOOTH-A`, lalu tekan Enter.
  Semua anggota langsung dinamai `BOOTH-A-01`, `BOOTH-A-02`, … urut nomor port di switch, lalu nomor lama. Klik
  **Batalkan** pada notifikasi untuk mengembalikan nama lama.
- Perangkat baru yang ditaruh atau disambungkan ke group itu otomatis mendapat nomor berikutnya.
- Tombol **Rapikan nama** di *Daftar perangkat* menomori ulang semua group tanpa celah, misalnya setelah ada anggota
  yang dihapus.
- Nama group disimpan di perangkat induknya. Kolom **Group** muncul di daftar perangkat dan CSV.

**Hapus koneksi.** Pilih perangkat, lalu klik tombol ✕ merah di garis kabelnya, atau tombol **Putuskan** di samping
pilihan Uplink. Perangkat di bawah switch/router juga bisa diputus lewat ✕ di daftar *Terhubung ke sini*. Port uplink
dan bentuk jalur ikut dikosongkan. Klik **Batalkan** pada notifikasi untuk memulihkan koneksinya.

**Kecerahan denah.** Slider *Denah* di pojok kiri bawah peta memudarkan gambar denah (10–100%) agar titik dan garis
lebih jelas. Pengaturan ini tersimpan per browser dan ikut dipakai saat mencetak.

Pintasan di Denah: `V` pilih/geser · `L` hubungkan · `M` ukur · `1`–`9` tambah perangkat · `Del` hapus ·
`F` seluruh denah · `Esc` batal. Scroll/pinch untuk zoom, geser latar untuk pan. Saat menghubungkan, Shift+klik
menghubungkan beberapa perangkat sekaligus.

## Logika jaringan

- **Jalur ke internet**: dari perangkat yang dipilih, uplink ditelusuri sampai ke Sumber WAN, misalnya
  `AP-05 → SW-01 → RTR-01 → WAN-01 (Indihome · 200 Mbps)`. Server menolak uplink yang membentuk loop.
- **Bandwidth maks.** = nilai terkecil di sepanjang jalur ke WAN, sehingga bottleneck-nya ikut terlihat.
- **Estimasi kabel** = panjang jalur kabel (lurus, siku, atau mengikuti lekukan) × (1 + tambahan %). Tambahan bawaannya
  20%, untuk naik-turun dan sisa kabel, dan bisa diubah di tab Proyek. Untuk media wireless, yang ditampilkan adalah
  jarak link.
- **Pemeriksaan desain**: IP ganda, port uplink yang dipakai dua perangkat, jumlah koneksi melebihi port switch, kabel UTP
  lebih dari 90 m, oversubscription (total alokasi perangkat di bawah > kapasitas induk), alokasi anak lebih besar dari
  induk, perangkat tanpa jalur ke WAN, AP dengan channel sama yang cakupannya bertumpuk (co-channel), AP tanpa
  SSID/password, dan perangkat berstatus bermasalah.

## Link lihat-saja

Setiap event punya link `index.html?lihat=KODE` (tersedia juga sebagai QR di tab Proyek) untuk teknisi lapangan. Link ini
bisa dibuka tanpa login, tetapi data tidak bisa diubah, password WiFi/admin disamarkan, dan isinya diperbarui otomatis
setiap 30 detik. Tombol **Ganti link** membuat kode baru dan link lama tidak berlaku lagi.

## Instalasi

Aplikasi ini memakai database yang sama dengan aplikasi lain (`extradata`), dengan tabel berawalan `np_`. Tabel **dibuat
otomatis** saat login pertama. Bisa juga diimpor manual dari `database/netplan.sql`.

- **XAMPP lokal**: tidak perlu konfigurasi. Password bawaan `admin` hanya berlaku bila halaman dibuka dari komputer itu
  sendiri (localhost).
- **Hosting / cPanel**: salin `api/config.local.example.php` menjadi `api/config.local.php`, lalu isi kredensial database
  dan `NP_ADMIN_PASS`. File ini tidak ikut ke Git. Folder `uploads/` harus bisa ditulis oleh PHP.

Gambar denah disimpan di `uploads/`. Folder ini tertutup dari browser, jadi gambar hanya disajikan lewat `api/denah.php`
setelah pengecekan login atau kode lihat. Batas ukuran upload mengikuti `upload_max_filesize`/`post_max_size` PHP
(XAMPP: 40M).

**Setiap kali file di `assets/` diubah, naikkan angka `?v=N` di `index.html`.** Tanpa itu, browser (terutama di HP)
bisa tetap memakai CSS/JS lama dari cache. `.htaccess` membuat `index.html` selalu dicek ulang ke server.

Aplikasi berjalan tanpa CDN. QR code dibuat oleh `vendor/qrcode.min.js` (qrcode-generator, MIT).

## Struktur

```
net-plan/
├── index.html
├── assets/   np.css, common.js (helper + definisi jenis perangkat), analisis.js (topologi & pemeriksaan),
│             peta.js (peta SVG), app.js (aplikasi)
├── api/      db.php, admin.php, lihat.php, denah.php, config.local.example.php
├── database/ netplan.sql (tertutup dari browser)
├── uploads/  gambar denah (tertutup dari browser, tidak ikut ke Git)
└── vendor/   qrcode.min.js
```

Untuk menambah jenis perangkat atau isian khusus, ubah `TYPES` di `assets/common.js`, lalu tambahkan jenisnya di
`NP_JENIS` (`api/db.php`).
