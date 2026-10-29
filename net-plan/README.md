# Net Plan — Perencanaan Titik Jaringan Event

Upload denah venue, lalu taruh titik-titik jaringan (sumber WAN/ISP, router, switch, access point, wireless bridge,
titik LAN, server, CCTV) langsung di atas denah. Setiap titik menyimpan konfigurasinya sendiri: nama alat, uplink (dapat
koneksi dari mana), port, media, bandwidth, IP/VLAN, isian khusus per jenis (SSID, channel, provider, dst.), dan
keterangan konfigurasi bebas.

## Halaman

| Tab | Isi |
|---|---|
| **Denah** | Peta interaktif: tambah/geser titik, hubungkan ke uplink, ukur jarak & kalibrasi skala, lingkaran cakupan AP, panel konfigurasi per perangkat |
| **Daftar perangkat** | Tabel semua perangkat (cari, filter jenis/status/koneksi, urutkan), **pilih banyak** (centang, Shift+klik, pilih semua yang tampil) lalu **ubah status**, hapus, atau putuskan koneksi sekaligus (ubah status massal bisa dibatalkan, tercatat di riwayat; link tim hanya bisa ubah status yang diizinkan pada kategori tugasnya), unduh CSV, ekspor/impor JSON |
| **Topologi & cek** | Pohon topologi dari WAN ke perangkat paling ujung (cabang bisa dibuka/tutup: ▸ per cabang, *Buka semua*, *Tutup endpoint*, *Tutup semua*; tersimpan per event), pemeriksaan desain, ringkasan WAN/SSID, kebutuhan perangkat (BOM), estimasi kabel |
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

**Password admin event.** Saat membuat event baru, dialog langsung menyiapkan **password admin event** acak (bisa
diganti atau dikosongkan). Password ditampilkan sekali untuk disalin dan disimpan sebagai hash bcrypt. Login dengan
password itu menjadi **admin event**:
- Bisa mengelola penuh **event itu saja**: denah, perangkat, status, akses tim, backup event, hapus perangkat, dan
  mengganti password eventnya sendiri.
- Tidak bisa melihat event lain, membuat/menghapus/menduplikat event, mengubah katalog & tipe endpoint (hanya
  memakai), atau menghapus password.

Semua batasan dicek di server dengan pola *default tolak* (`izin_admin_event()` di `api/admin.php`). Password bisa
diatur atau diganti di tab Proyek → kartu *Admin event*. Begitu password diganti atau dihapus, sesi yang memakai
password lama otomatis berakhir. Admin utama tetap memakai `NP_ADMIN_PASS` dan bisa mengakses semua event.

**Ganti password login.** Tombol **Ganti password** di header (wajib mengisi password lama):
- Admin utama mengganti **password admin utama**. Password baru disimpan sebagai hash di database (`np_meta`) dan
  berlaku menggantikan `NP_ADMIN_PASS` di config maupun password bawaan `admin`.
- Admin event mengganti **password admin event**-nya.

Setelah diganti, login lain yang memakai password lama otomatis keluar, sedangkan sesi yang sedang dipakai tetap login.
Lupa password admin utama? Jalankan `php net-plan/api/reset-admin.php` lewat SSH: login kembali memakai
`NP_ADMIN_PASS` (atau `admin` dari localhost), lalu segera ganti lagi. Skrip ini tidak bisa dibuka dari browser.

**Akses tim** (tab Proyek → *Akses tim*) memberi project manager link khusus per tim/anggota, tanpa membagikan password
admin.
- **Lihat saja**: membaca denah, daftar, topologi, sheet AP, dan riwayat.
- **Update status**: hanya bisa mengubah status yang **dicentang PM** (mis. Tim Pasang: *Terpasang*; Tim QA: *Sudah diuji*
  dan *Bermasalah*), hanya pada **kategori tugasnya** (mis. Tim WiFi: AP saja), dan bisa menulis **catatan lapangan**.
  Batasan ini dicek juga di server (`api/tim.php`), bukan hanya disembunyikan di tampilan.
- Opsi per link: boleh melihat password WiFi/admin, dan aktif/nonaktif. **Ganti link** membuat link lama langsung tidak
  berlaku.
- Setiap perubahan status (oleh tim maupun admin) dan catatan lapangan **tercatat**: siapa, kapan, dari → ke. Riwayat
  tampil di panel perangkat dan di kartu *Aktivitas tim*.
- Tim melihat badge namanya, progres tugasnya per status, dan tombol status yang diizinkan di panel perangkat.

**Backup & buka kembali.** Satu file `.netplan.json` menyimpan event secara lengkap: info, gambar denah, skala, semua
perangkat beserta koneksi/port/jalur kabel/konfigurasi/nama group, serta katalog & tipe endpoint yang dipakai.
- **Backup event ini** ada di tab Proyek.
- **Backup semua** ada di halaman daftar event. Isinya semua event ditambah seluruh katalog & tipe endpoint.
- **Buka backup…** memulihkan isi file sebagai **event baru**, jadi data yang ada tidak pernah ditimpa. Nama yang sama
  diberi akhiran "(pulihan)". Katalog dan tipe endpoint dicocokkan dengan yang sudah ada, atau dibuat bila belum ada,
  sehingga file bisa dibuka di server lain.
- File *Ekspor JSON* lama (daftar perangkat saja) juga bisa dibuka lewat *Buka backup…*.

**Katalog perangkat** (tombol *Katalog perangkat* di halaman daftar event) adalah daftar alat standar yang berlaku untuk
semua event, dikelompokkan per kategori (router, switch, AP, bridge, titik LAN, dst.). Setiap alat berisi:
- merek/tipe dan **stok** unit;
- **spesifikasi**: port Ethernet & kecepatan, SFP, PoE in/out, jumlah port PoE, budget PoE, konsumsi daya, throughput,
  standar WiFi, band, klien maks., jangkauan, bentuk, OS;
- **konfigurasi standar**: isian khusus kategori, bandwidth, dan template keterangan konfigurasi.

Tombol *Isi template standar* menambahkan alat generik sebagai titik awal; ganti merek/tipe dan sesuaikan angkanya dengan
datasheet.

Di panel perangkat, pilih alat lewat **Pilih dari katalog**. Nama alat dan isian yang masih kosong langsung terisi
konfigurasi standar. Untuk switch, jumlah port, tipe PoE, dan budget PoE diturunkan dari spesifikasi. **Terapkan
konfigurasi standar** menimpa semua isian dengan nilai katalog.

Data katalog juga dipakai pemeriksaan desain:
- perangkat butuh PoE tetapi uplink tidak menyediakan PoE atau kelasnya kurang (af < at < bt, passive);
- total daya PoE melebihi budget switch (peringatan mulai 80%);
- kebutuhan unit di event melebihi stok.

Kolom stok juga muncul di *Kebutuhan perangkat* dan laporan cetak.

**Endpoint** adalah perangkat pengguna yang dicolok langsung ke titik LAN, misalnya laptop, PC, printer network,
scanner, atau pinpad/EDC.
- Pilih alat **Endpoint** di toolbar, lalu pilih tipenya di bar ikon yang muncul di atas denah. Tipe bawaan: Laptop,
  Komputer/PC, Server, Printer network, Pinpad/EDC, Scanner.
- Endpoint digambar sebagai **kotak berikon** (bukan lingkaran berteks) dengan warna tipenya. Nama otomatis memakai
  prefix tipe, misalnya `PRN-01` atau `LPT-01`.
- **Tersambung langsung ke titik LAN**: ke titik LAN yang sedang dipilih, atau ke titik LAN terdekat dari posisi klik.
  Nomor port LAN yang masih kosong diisi otomatis (1, 2, 3, …).
- Bila endpoint melebihi isian *Jumlah port* titik LAN, muncul peringatan di pemeriksaan desain.
- **Kelola tipe** (dari bar tipe, panel perangkat, atau halaman Katalog → *Tipe endpoint*) untuk menambah atau mengubah
  nama, ikon, singkatan, warna, dan prefix. Ikon yang tersedia: laptop, monitor PC, server, printer, pinpad, scanner,
  tablet, telepon VoIP, TV/display, mesin absensi, kamera, dan umum. Tipe yang masih dipakai tidak bisa dihapus.
- Isian endpoint: hostname, MAC, mode IP, OS, pengguna/unit, nomor aset.

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

**AP omni & sektoral.** Atur pola pancaran di isian *Pola pancaran* pada panel AP:
- **Omni (360°)** digambar sebagai lingkaran.
- **Sektoral** digambar sebagai kipas sesuai *Arah sektor* (0° = atas denah, searah jarum jam) dan *Lebar sektor*.

Panjang ilustrasi memakai *Radius / jangkauan (m)*, jadi skala denah harus sudah dikalibrasi. AP sektoral juga diberi
kipas kecil dan panah arah di titiknya, sehingga arahnya tetap terlihat walau skala belum dikalibrasi.

Pilih AP sektoral lalu geser **pegangan putar** (bulatan hijau) untuk memutar arahnya, dengan snap 5° (tahan `Alt`
untuk bebas). Pola pancaran dan beamwidth juga bisa disimpan di spesifikasi katalog, sehingga ikut terisi saat alat
dipilih. Pemeriksaan co-channel memperhitungkan arah: dua AP sektoral yang saling membelakangi tidak dianggap bertumpuk.

**Kecerahan denah.** Slider *Denah* di pojok kiri bawah peta memudarkan gambar denah (10–100%) agar titik dan garis
lebih jelas. Pengaturan ini tersimpan per browser dan ikut dipakai saat mencetak.

**Cari cepat & batalkan.** Tombol *Cari* (`Ctrl+K` atau `/`) mencari perangkat (nama, IP, SSID, merek) dan perintah
(pindah tab, tambah perangkat, cetak). `Enter` membuka perangkat di denah, `Shift+Enter` di Daftar. Hampir semua
perubahan bisa dibatalkan dengan `Ctrl+Z` dan diulang dengan `Ctrl+Y`, juga lewat tombol ↶ ↷ di bar tab. Ini mencakup
geser, sambung/putus, bentuk jalur, isian, nama group, status massal, tambah, dan hapus. Perangkat yang dihapus kembali
dengan id, koneksi, dan riwayat semula. Karena itu, menghapus satu perangkat tanpa sambungan tidak lagi meminta
konfirmasi. Riwayat berlaku per event selama halaman terbuka. *Hapus semua perangkat* tidak termasuk, jadi pakai backup.

**Panel perangkat bertab.** Panel kanan dibagi menjadi beberapa tab. Nama dan tombol Pusatkan/Duplikat/Hapus selalu
terlihat di atas tab.

| Tab | Isi |
|---|---|
| **Info** | Status internet, jalur ke WAN, kabel, perangkat yang terhubung, catatan desain, riwayat. Titik oranye/merah = ada peringatan atau masalah. |
| **Identitas** | Nama, jenis, katalog, nama alat, status, PIC |
| **Koneksi** | Uplink, port, media, bandwidth, bentuk jalur kabel, IP, VLAN |
| **[Jenis]** | Pengaturan khusus jenis perangkat (mis. *Switch*, *Access Point*, *Laptop*) dan keterangan konfigurasi |
| **Group** | Nama group perangkat ini, dan group perangkat yang terhubung ke sini. Angka di tab = jumlah group bernama. |

Tab terakhir diingat saat pindah perangkat, sehingga mengisi IP banyak perangkat cukup di tab Koneksi lalu tekan `Tab`
untuk perangkat berikutnya.

**Konfigurasi router & script MikroTik (RouterOS v7).** Konfigurasi router diisi **sekali** di tab **Router** (khusus
admin; link lihat-saja/tim tetap melihat ringkasan isian router). Isian yang dulu kembar (subnet LAN, pool, lease,
DNS, admin, mode WAN, QoS) kini satu tempat. Nilai lama tetap dipakai sebagai cadangan: *Subnet LAN* untuk IP LAN dan
catatan *QoS* lama ditampilkan di bagian Bandwidth. Tab **⚙ MikroTik** hanya berisi hasil: validasi, script `.rsc`,
salin / unduh, dan panduan memasang.

Sumber data script: konfigurasi router di atas + Sumber WAN yang tersambung (WAN utama lewat uplink + WAN tambahan /
multi-WAN, termasuk IP publik, gateway, dan bandwidth ISP).

Formulir di tab Router ada enam bagian:
1. **Sistem**: identitas, zona waktu, NTP, jumlah port ether.
2. **WAN**: per sumber pilih interface dan tipe DHCP / PPPoE (user & password) / IP statis (IP & gateway). Bila lebih
   dari satu WAN, mode **failover** (distance + check-gateway) atau **load balance PCC** (routing table + mangle per
   WAN).
3. **LAN & DHCP**: IP router (CIDR), port bridge LAN (otomatis semua port selain WAN), pool, lease, DNS.
4. **VLAN**: ID, nama, gateway, DHCP, isolasi (hanya ke internet). Bisa diambil otomatis dari VLAN perangkat.
5. **Keamanan & admin**: firewall dasar, kunci layanan (telnet/ftp/www/api mati; winbox/SSH hanya dari LAN), user
   admin baru, dan nonaktifkan `admin` bawaan.
6. **Bandwidth**: limit per user dengan PCQ (+ total). Bila aktif, fasttrack tidak dipakai.

Bagian *Hasil* menampilkan validasi (port WAN dobel / bentrok dengan LAN, IP & pool di luar subnet, kredensial PPPoE
kosong, VLAN dobel / bertumpuk, dll.), pratinjau script, tombol **⧉ Salin script** dan **⬇ Unduh .rsc**, serta panduan
memasang:
- `/system reset-configuration no-defaults=yes skip-backup=yes`
- upload file ke *Files* lewat Winbox (MAC)
- `/import file-name=RTR-01.rsc verbose=yes`

Karakter khusus di password (`"` `$` `?` `\`) di-escape otomatis. Hotspot belum dibuat otomatis (ditandai TODO).
Konfigurasi disimpan di atribut router `mt` (JSON, tanpa migrasi). Password PPPoE di dalamnya disamarkan di link
lihat-saja / tim, dan ID WAN di dalamnya dipetakan ulang saat duplikat event, impor, atau buka backup.

**VLAN trunk / access turunan.** VLAN yang dibuat di router menjadi turunan untuk perangkat di bawahnya. Setiap kabel
(port uplink) dihitung otomatis dari VLAN perangkat itu dan semua perangkat di bawahnya. Sumber VLAN perangkat adalah
isian *VLAN* dan SSID tambahan AP bertanda `(VLAN n)`.
- **Access** (untagged): perangkat ujung yang butuh tepat satu VLAN.
- **Trunk** (tagged): switch, AP, atau cabang yang butuh beberapa VLAN. LAN untagged tetap lewat.
- **Native**: tidak butuh VLAN.

VLAN berhenti di router (gateway). Kabel router ke WAN tidak membawa VLAN LAN.

**VLAN per port router.** Di tab *Router* → VLAN ada tabel semua port LAN (ether2, ether3, …). Tiap port bisa diatur
Otomatis, Trunk + VLAN diizinkan, Access + satu VLAN, atau LAN saja (tanpa VLAN). Hasilnya langsung tampil di tabel.
- Port yang tersambung ke perangkat menyimpan pilihannya di perangkat itu, jadi sama dengan kotak VLAN di tab Koneksi
  perangkat tersebut.
- Port kosong disimpan di `mt.port` router. Bila dibiarkan Otomatis, port kosong menjadi trunk semua VLAN.

**VLAN per port switch.** Dipakai untuk membagi trunk yang masuk di port uplink switch (mis. eth1) menjadi access /
trunk di port lainnya. Tabelnya ada di panel switch (tab *Info* → *Terhubung ke sini* → **VLAN per port**) dan tampil
bila event punya VLAN.
- Baris uplink (mis. eth1) hanya menampilkan trunk yang masuk; pengaturannya ada di tab *Koneksi* switch itu.
- Port yang tersambung perangkat menyimpan pilihannya di perangkat itu, sama seperti kotak VLAN di tab *Koneksi*.
- Port kosong disimpan di atribut switch `vlan_port` (JSON `{"e5":{"mode":"access","izin":"20"}}`). Bila belum
  diatur, port kosong = LAN saja.
- **Bagi cepat**: pilih *Port … s/d …* → Access / Trunk / LAN saja → VLAN → *Terapkan*. Contoh: port 3–8 access VLAN 20.
  Port uplink dilewati, dan bisa dibatalkan dengan Ctrl+Z.
- VLAN yang dipakai di port switch (termasuk port kosong dan trunk manual) otomatis ikut dibawa trunk uplink switch itu
  sampai ke router.
- Halaman *Port* menampilkan VLAN port kosong (mis. `A 20`).
- **Port yang diatur saat masih kosong lalu dicolok perangkat**: pengaturan port itu berlaku untuk kabel perangkat tersebut
  bila kotak VLAN perangkat masih *Otomatis* (ditandai "dari pengaturan port … di tabel VLAN per port …").
  - Contoh: port 2 SW-01 Access 101 + SW-06 (VLAN 102) di port 2 → error "VLAN 102 terputus" dan garis merah.
  - Bila perangkat juga punya pengaturan sendiri yang berbeda, yang dipakai pengaturan perangkat, ditambah peringatan
    "samakan". Mengubah port itu di tabel menghapus pengaturan port lama, jadi hanya ada satu sumber.
  - Perangkat tanpa isian port di switch yang punya VLAN per port mendapat peringatan, karena VLAN-nya tidak bisa dicek.

Mode per kabel bisa ditetapkan manual di tab *Koneksi* lewat kotak **VLAN di port …**: Otomatis / LAN saja / Trunk + daftar VLAN
yang diizinkan / Access + VLAN. Badge `T 10,20` / `A 20` tampil di pohon topologi dan di daftar *Terhubung* per port.
Kartu **VLAN** di Topologi merangkum VLAN, gateway, jumlah perangkat, dan masalahnya.

Peringatan VLAN, juga muncul di pemeriksaan desain:
- VLAN dipakai perangkat tetapi belum dibuat di router.
- ID VLAN tidak valid.
- VLAN terputus di suatu kabel, misalnya uplink switch dijadikan access padahal perangkat di bawahnya butuh VLAN lain.
- Trunk manual yang kurang VLAN.
- Switch unmanaged yang diminta membuat port access, atau dilewati trunk.
- Titik LAN pasif yang dipakai lebih dari satu VLAN.

Script MikroTik menambahkan bagian **Bridge VLAN filtering**. Port access mendapat `pvid` dan `frame-types`. Setiap VLAN
mendapat `/interface bridge vlan` dengan port trunk sebagai tagged dan port access sebagai untagged. Port tanpa
perangkat tercatat menjadi trunk semua VLAN. `vlan-filtering=yes` diaktifkan paling akhir. Validasi juga memeriksa port
yang dipakai dua perangkat dan VLAN port yang belum dibuat di router.

**Foto bukti pemasangan.** Setiap perangkat bisa punya 1–3 foto bukti, diambil langsung dari kamera ponsel di
tab *Info* lewat tombol **📷 Ambil foto n/3**. Tombol ini tersedia untuk admin, dan untuk link tim *update status*
pada kategori tugasnya.
- **Kamera & GPS**: kamera belakang terbuka langsung. Lokasi GPS dibaca bersamaan, jadi izinkan akses lokasi. Pembacaan
  lokasi butuh HTTPS.
- **Pengolahan di ponsel**: foto diperkecil (sisi terpanjang 1600 px) lalu diberi **cap** di bagian bawah: judul event,
  nama & jenis perangkat, koordinat ±akurasi, waktu, dan nama tim. Hasilnya JPEG tanpa EXIF asli.
- **Tanpa lokasi**: bila izin ditolak atau GPS gagal, foto tetap tersimpan dengan cap "Lokasi tidak tersedia" dan
  muncul peringatan.
- **Galeri** di panel menampilkan thumbnail, koordinat (klik untuk membuka Google Maps), waktu, dan pengambil foto.
  Klik thumbnail untuk membuka **penampil foto** (modal layar penuh, bukan halaman baru):
  - pindah foto dengan panah ‹ ›, tombol ← →, geser jari di ponsel, atau titik di bawah;
  - keterangan koordinat, waktu, dan pengambil;
  - tombol ⬇ unduh;
  - tutup dengan Esc, ✕, atau klik latar.
  - **zoom 100–600%** untuk melihat detail (SN, label port, kabel). Posisi foto dibatasi agar tidak lepas dari layar, dan
    zoom kembali ke 100% saat pindah foto:
    - **laptop**: scroll roda di titik kursor, seret untuk menggeser, klik 2× untuk perbesar / kembali, tombol − / 100% / +
      di atas, dan keyboard + − 0;
    - **ponsel**: cubit 2 jari, geser 1 jari saat diperbesar, ketuk 2× untuk perbesar / kembali. Usap kiri / kanan
      pindah foto bila tidak diperbesar.
  - Petunjuk singkat di bawah foto menyesuaikan perangkat (layar sentuh / mouse).
- **Hapus foto**: admin bisa menghapus semua foto; tim hanya foto yang diambilnya sendiri.
- **Penyimpanan**: tabel `np_foto` (migrasi otomatis, skema 9) dan file `uploads/foto_*.jpg`. File hanya disajikan lewat
  `api/foto.php`, dengan cek login admin, link tim, atau link lihat-saja event yang sama.
- **Validasi server**: batas 3 foto dikunci dengan transaksi, hanya JPEG, maks. 8 MB.
- **Hapus event** ikut menghapus file fotonya. Foto perangkat yang dihapus tetap disimpan agar ikut kembali saat Ctrl+Z.

**Checker penempatan.** Peran akses tim ketiga, selain *Lihat saja* dan *Update status*: **Checker penempatan**. Buat
di *Proyek → Akses tim*. Kategori tugasnya bisa dibatasi (mis. AP & switch saja). Checker membuka link di ponsel dan
untuk setiap titik melihat kotak **🔍 Pengecekan penempatan**:
- **Acuan plan**: potongan denah di sekitar titik, alat (jenis & model), uplink + port + media, posisi pasang
  (pemasangan / rak), arah, IP/VLAN, dan catatan plan.
- **Hasil**: tombol **✓ Sesuai plan** / **✕ Tidak sesuai**. Catatan wajib diisi bila tidak sesuai. Ada juga *Kirim
  catatan saja*.
- **Foto bukti** 1–3 kali di bawah kotak itu (fitur foto di atas).
- **Berikutnya belum dicek →** melompat ke titik tugas berikutnya. Header link menampilkan progres, mis. "checker ·
  12/40 dicek".

Checker **tidak bisa** mengubah status, kabel, ceklis, atau konfigurasi. Hasil pengecekan:
- disimpan di atribut `verif` beserta pengecek dan waktu (waktu lokal ponsel), dan tercatat di riwayat perangkat;
- tampil sebagai tanda di titik denah: ✓ biru = sesuai, ! merah = tidak sesuai;
- "tidak sesuai" masuk *Pemeriksaan desain* sebagai peringatan, lengkap dengan catatannya;
- ikut di Laporan foto pemasangan.

Admin melihat kotak yang sama, tanpa acuan plan, dan bisa mengisi, mengubah, atau menghapus hasil.

**Laporan foto pemasangan** (menu *Cetak*, A4 tegak) berisi:
- ringkasan: jumlah perangkat, yang sudah / belum difoto, total foto, dan foto tanpa koordinat;
- satu kartu per perangkat berfoto: status, uplink & port, IP, PIC, lalu foto utuh dengan capnya, waktu, pengambil,
  dan koordinat;
- tabel perangkat yang belum difoto.

**Halaman Port** (tab *Port*, `Alt+6`). Tempat merapikan data port sebelum mencetak. Isinya sama dengan laporan, tetapi
bisa diubah langsung:
- **Angka ringkas**: switch & router, port tercatat, terpakai (%), kosong, tanpa nomor port, port dobel / di luar
  jumlah, dan jumlah port belum diisi (kuning / merah bila perlu dirapikan).
- **Rekap**: klik baris untuk melompat ke perangkatnya. Kolom *Perlu dirapikan* menghitung masalahnya.
- **Per switch / router**:
  - *Jumlah port* bisa diisi langsung;
  - panel port berwarna (klik kotak = buka perangkat di denah);
  - nomor port tiap sambungan bisa diganti lewat pilihan port kosong, termasuk port uplink switch;
  - perangkat *tanpa nomor port*: pilih port satu per satu atau **Isi otomatis berurutan**;
  - port di luar jumlah port bisa dipindah ke port yang ada.
- **Bantuan**: filter cari dan **Hanya yang perlu dirapikan**. Semua perubahan bisa di-Ctrl+Z.
- **Cetak / PDF** dan **Unduh CSV** di kanan atas, mengikuti layer aktif.
- Warna panel port & judul berwarna ikut tercetak walau opsi "Background graphics" browser tidak dicentang.

**Laporan penggunaan port** (menu *Cetak*, A4 tegak, atau *Unduh CSV*). Untuk semua switch & router.
- **Rekap**: tiap perangkat dengan jumlah port, terpakai, kosong, dan jumlah per kategori sambungan (Uplink, WAN, Antar
  switch, Router, Access point, Wireless bridge, Titik LAN, Endpoint, CCTV, Server, Lainnya), plus jumlah perangkat
  tanpa nomor port.
- **Per perangkat**:
  - panel port seperti muka switch: kotak berwarna per kategori, putih = kosong, garis merah = port dobel;
  - tabel port: perangkat terhubung (uplink / uplink kedua / port otomatis), kategori (endpoint + tipenya), media &
    status kabel, VLAN trunk / access, IP;
  - daftar perangkat yang tersambung tanpa nomor port, port di luar jumlah port, dan switch lain yang memakainya
    sebagai uplink kedua.
- **CSV**: satu baris per port, termasuk port kosong, tanpa nomor, dan di luar jumlah port.
- **Layer**: mengikuti pilihan layer. Pada laporan gabungan, rekap dikelompokkan per layer dan tiap perangkat diberi
  label layer.
- Port yang belum diketahui jumlahnya ditandai "belum diisi". Isi *Jumlah port* di switch, atau di tab Router → Sistem.

**Dialog Cetak & unduh laporan.** Jenis laporan tampil sebagai kartu ringkas (2 kolom; 1 kolom di ponsel) dengan ikon,ringkasan, dan format (A4 tegak / mendatar, CSV, PowerPoint). Penjelasan lengkap jenis terpilih ada di bawah kartu.Pilihan layer & opsi jenis laporan ada di panel *Pengaturan*, dan tombol aksi ada di footer yang selalu terlihat.**Progress proses panjang.** Pembuatan PowerPoint (pustaka → denah → ringkasan → penempatan → slide foto per titik →simpan), persiapan cetak (memuat semua gambar denah & foto sebelum dialog print muncul), serta backup & pulihkanmenampilkan dialog progress berisi bar persen dan langkah yang sedang dikerjakan.
**Laporan PowerPoint (pemasangan perangkat).** Di dialog *Cetak → Laporan foto pemasangan* ada tombol **⬇ Unduh
PowerPoint**. File `.pptx` (16:9) dibuat langsung di browser, tanpa server tambahan. Isinya hanya **jumlah perangkat
dan tarikan LAN**, tanpa status pemasangan, progres foto, dan hasil pengecekan:
- **Opsi panjang kabel**: centang *PowerPoint: tampilkan panjang kabel LAN* di dialog Cetak (bawaan mati). Bila mati,
  semua angka meter disembunyikan (sampul, ringkasan, daftar titik, kotak Tarikan LAN); hanya jumlah yang tampil.
- **Sampul**: nama event, venue, tanggal, dan angka: total perangkat, jumlah tarikan LAN, dan (opsi) panjang kabel LAN
  (≈ m). Ada juga angka per layer.
- **Tarikan LAN** = kabel UTP titik ke uplink-nya, termasuk sambungan UTP tambahan. Kabel WAN ke Sumber WAN/ISP,
  fiber, dan wireless tidak dihitung. Panjang mengikuti estimasi kabel (jalur + tambahan %); kabel tanpa skala ditulis
  "belum terukur".
- **Ringkasan per jenis perangkat**: jumlah perangkat, tarikan LAN, dan panjang kabel LAN per jenis, ditambah baris
  total.
- **Daftar titik per jenis** (urut WAN → router → switch → AP → …): titik, alat (merek/model; endpoint: tipe), uplink /
  port, media, dan tarikan LAN (m). Jenis besar dibagi rata maks. 19 baris per slide; jenis kecil digabung selama muat.
- **Penempatan perangkat** (sebelum slide foto): denah pudar (opacity 20%) dengan titik berwarna per jenis + nama.
  - Slide pertama *Semua perangkat jaringan* (seluruh denah; nama endpoint tidak ditulis karena padat).
  - Lalu satu slide per kelompok: Router & Sumber WAN, Switch, Access Point, Endpoint (laptop, EDC, printer, …), dan
    Perangkat lain (titik LAN, server, CCTV, …). Slide kelompok di-zoom ke area perangkatnya.
  - Event multi-lantai: per lantai. Multi-layer: cincin titik berwarna layer + legenda layer.
- **Satu slide per titik berfoto**:
  - 1–3 foto bercap, utuh tanpa terpotong, disusun 1 besar / 2 / 3 kolom mengikuti rasio foto;
  - keterangan tiap foto: waktu, pengambil, dan koordinat yang bisa diklik ke Google Maps;
  - tabel **Spesifikasi & data titik** di bawah foto: alat, uplink & port, IP/VLAN, posisi pasang, spesifikasi
    katalog, dan isian jenis. Password dan setelan jaringan router tidak ikut;
  - kolom kanan: **potongan denah** dengan penanda lokasi titik, dan kotak **Tarikan LAN** (dari switch/port mana,
    ≈ meter).

Pustaka PptxGenJS 3.12.0 (MIT) ada di `vendor/pptxgenjs.bundle.js` dan hanya dimuat saat tombol diklik.

**Denah dari PDF.** Semua upload denah (event baru, kartu *Denah venue*, dan denah per lantai) menerima **PDF** selain
PNG/JPG/WEBP/GIF.
- PDF diubah menjadi gambar langsung di browser memakai pdf.js 3.11.174 (Apache-2.0, `vendor/pdf.min.js` +
  `vendor/pdf.worker.min.js`, dimuat hanya saat upload PDF). Server tetap menerima gambar biasa.
- PDF lebih dari 1 halaman: pilih nomor halaman yang dipakai.
- Resolusi: sisi terpanjang ±6000 px (maks. 100 MP), latar putih. Hasilnya PNG, atau JPEG bila PNG > 10 MB.
- Ada progress selama konversi. PDF ber-password ditolak dengan pesan yang jelas.
- Event baru: PDF dikonversi dulu sebelum event dibuat, jadi tidak ada event yang terlanjur dibuat bila PDF gagal
  dibaca atau dibatalkan.
- File CAD (DWG): ekspor dulu ke PDF.

**Salin SSID & password WiFi.** Di tab *Access Point* (juga *Wireless bridge*) dan tab *Info*, kotak WiFi punya
tombol **⧉ SSID**, **⧉ Password**, dan **⧉ SSID + password**. Nilai diambil langsung dari isian saat itu, jadi yang
baru diketik pun ikut. Format salin keduanya: `SSID: …` / `Password: …`. Di link lihat-saja / tim tanpa izin lihat
password, hanya SSID yang bisa disalin.

**Ceklis pekerjaan.** Setiap perangkat punya daftar pekerjaan dalam tiga kelompok:
- **🔌 Penarikan kabel**: kabel ditarik, terminasi, dites. Tersinkron dengan status kabel.
- **📦 Penempatan**: alat ditempatkan (tersinkron dengan status *Terpasang*), listrik/PoE tersambung, label ditempel.
- **⚙ Konfigurasi**: item per jenis. Contoh:
  - router: WAN/PPPoE, DHCP & DNS, NAT & firewall, QoS, VLAN/hotspot, backup & password
  - switch: VLAN & trunk, STP, PoE, IP manajemen, label port
  - AP: SSID, channel & power, VLAN/controller, firmware, uji sinyal
  - item terakhir *Uji akhir*: tersinkron dengan status *Sudah diuji*

Ceklis bisa ditambah item sendiri per perangkat. Centang item tersinkron langsung mengubah status kabel / pemasangan,
jadi tidak perlu dicatat dua kali. Item lain menyimpan siapa & kapan.

Tempat mengisi:
- **Panel perangkat → tab ✓ Ceklis** (dengan jumlah selesai).
- **Tab Ceklis** (`Alt+5`):
  - **Kartu ringkasan** (semua / kabel / penempatan / konfigurasi) sekaligus filter: klik untuk menampilkan kelompok itu
    saja.
  - **Matriks per jenis perangkat** (bagian bisa dilipat; bagian > 20 perangkat, mis. endpoint, terlipat awal): baris =
    perangkat, kolom = pekerjaan (dikelompokkan berwarna), klik kotak untuk mencentang. Kepala kolom menampilkan jumlah
    selesai dan tombol **✓ semua**, untuk mencentang satu pekerjaan di semua perangkat jenis itu (satu langkah Ctrl+Z).
  - **Di HP**: kartu per perangkat dengan tombol **Berikutnya: …** (satu ketuk mencentang pekerjaan berikutnya) dan
    daftar lengkap yang bisa dibuka.
  - Filter jenis, cari, *hanya yang belum selesai*, **Unduh CSV**, dan **Cetak ceklis** (lembar ☐/☑ per perangkat +
    paraf teknisi, mengikuti filter).

Link tim (update status) bisa mencentang ceklis perangkat dalam kategori tugasnya, dan tercatat di riwayat
("Ceklis: Firmware terbaru ✓"). Perubahan admin bisa di-Ctrl+Z.

**Status pemasangan bertahap.** Di tab *Identitas* (dan kotak update status link tim), status alat memakai langkah
yang sama dengan status kabel: *Rencana → Terpasang → Sudah diuji*, tombol satu klik *Tandai tahap berikutnya*, dan
*Bermasalah* terpisah. Tim hanya bisa memilih status yang diizinkan PM. Perubahan admin bisa di-Ctrl+Z.

**Port switch / router.** Di panel switch/router (tab *Info*, bagian *Terhubung ke sini*) tampil **peta port**.
Jumlah port diambil dari isian *Jumlah port* atau katalog (Port Ethernet + SFP). Untuk router, sumbernya *Jumlah port
ether* di tab Router → Sistem; tanpa isian, router dianggap 5 port (sama dengan script MikroTik). Uplink yang jumlah
port-nya belum diketahui tetap bisa diisi port anaknya dengan diketik. Isinya:
- Kotak port 1…N (+ SFP): terpakai berwarna perangkatnya, kosong abu-abu, port uplink bergaris tepi, port dobel
  merah bergaris. Klik kotak port untuk membuka perangkatnya.
- Setiap perangkat terhubung menampilkan label port-nya. Port yang tidak ada di switch ditandai merah.
- **Belum ada port**: pilih dari port kosong, atau *Isi otomatis berurutan*. Gaya nama port ikut yang sudah dipakai,
  mis. `ether7`, dan bisa di-Ctrl+Z.

Di sisi perangkat anak, kolom *Port di uplink* (tab Koneksi) menyarankan port kosong. Nama port dibaca dari angka
terakhirnya ("ether5" = "5" = "ge-0/0/5", "sfp2" = SFP 2). Pemeriksaan desain memberi tanda port dobel dan port di
luar jumlah port.

**Port WAN router.** Peta port, isi-otomatis port anak, dan script MikroTik memakai satu sumber, yaitu `Model.portWan`.
- **Sumber port**: *Port di perangkat ini* untuk WAN utama, dan port WAN tambahan di tab Koneksi.
- **Satu isian**: kolom *Port di router* pada tab Router menyimpan ke isian yang sama, jadi keduanya selalu sinkron.
- **Port belum diisi**: WAN memakai port pertama yang tidak dipakai perangkat anak (ether1, lalu berikutnya). Di peta
  port, port itu bergaris putus-putus dan ikut dicadangkan, sehingga port anak tidak bergeser ke port WAN.
- **Validasi MikroTik**:
  - port WAN belum diisi;
  - perangkat anak di port WAN;
  - perangkat anak di port yang tidak masuk bridge LAN.

Port perangkat baru yang dibuat dari uplink memakai port kosong pertama dari peta port, termasuk gaya `ether3`. Klien
AP / wireless bridge tidak diberi port.

**Media mengikuti uplink.** Saat menghubungkan atau mengganti uplink, media disesuaikan aturan jaringan:
- Klien di bawah AP menjadi wireless, dan port uplink-nya dikosongkan.
- Wireless bridge ke wireless bridge menjadi wireless.
- Media wireless ke perangkat tanpa radio menjadi UTP.
- Fiber dan lainnya tetap seperti pilihan pengguna.

**Perangkat jaringan vs support.** Perangkat dibagi dua kelompok:
- **Jaringan**: WAN, router, switch, AP, LAN, server, CCTV, endpoint, dan lainnya.
- **Support & listrik**: *Titik listrik* dan *Peralatan support*. Peralatan support berisi kategori UPS, genset,
  terminal/stop kontak, kabel roll, rak/meja, monitor/TV, sound, lampu, AC/kipas, dan lainnya, dengan jumlah unit,
  kapasitas/ukuran, dan pemilik/vendor.

Peralatan support tidak punya uplink jaringan dan hanya bisa dihubungkan ke titik listrik. Daya yang diisi adalah
**per unit**, dan bebannya dihitung × jumlah unit.

Cara melihat per kelompok:
- **Denah**: tombol *Semua / Jaringan / AP / Switch / ⚡ Support* di kiri atas peta menampilkan kelompok atau jenis itu
  saja (*AP* = access point saja, *Switch* = switch saja; juga lewat Cari/Ctrl+K). Tombol tambah di
  toolbar ikut menyesuaikan, dan pilihan ini tersimpan per browser.
- **Daftar**: filter jenis punya pilihan *Semua perangkat jaringan* / *Semua support & listrik*.
- **Tab *Support & listrik*** (`Alt+4`) berisi rekap khusus listrik:
  - ringkasan: jumlah titik listrik, total kapasitas MCB, terpakai, sisa, total konsumsi, perlu tarik listrik, dan
    perangkat yang belum punya titik pemasok;
  - rekap per titik listrik: MCB, kapasitas, aman 80%, terpakai, sisa, soket, dan daftar perangkat + daya;
  - daftar perangkat yang belum punya titik listrik pemasok;
  - daftar peralatan support;
  - **Unduh CSV rekap listrik**, **Cetak rekap listrik** (tabel saja, A4 tegak), dan **Cetak laporan support (denah)**.

**Cetak laporan support & listrik.** Tersedia di dialog *Cetak* (pilihan ketiga) atau dari tab Support & listrik.
Isinya:
- denah khusus titik listrik (⚡) dan peralatan support, dengan jalur listrik kuning ke titik pemasoknya;
- perangkat jaringan yang memakai atau butuh listrik, digambar samar sebagai konteks lokasi;
- rekap per titik listrik (MCB, kapasitas, aman 80%, terpakai, sisa, soket, perangkat + daya);
- daftar perangkat tanpa titik pemasok dan daftar peralatan support.

Ukurannya A4 mendatar, cocok dibawa tim listrik / vendor genset.

**Daya listrik & titik listrik.** Ada dua bagian.

*Jenis titik **Titik listrik*** (toolbar ⚡ *Listrik*) berdiri sendiri. Titik ini bukan perangkat jaringan: tanpa uplink,
tanpa status internet, dan tidak masuk pohon topologi. Isiannya:
- sumber (PLN venue / panel booth / genset / UPS)
- **MCB (A)** sebagai isian utama (pilih ukuran standar 2–63 A atau ketik): daya yang bisa dipakai langsung tampil,
  mis. MCB 16 A × 220 V = **3.520 W**, aman dipakai 80% = 2.816 W, beserta terpakai & sisa. 3 fase = √3 × 380 V × A.
  Tegangan bisa diubah; *kapasitas manual (W)* hanya bila ingin menimpa hasil hitungan MCB. Titik listrik baru
  langsung membuka isian MCB.
- fase, jumlah stop kontak, panel/MCB asal

*Menu **⚡ Listrik*** (opsional) ada di setiap perangkat jaringan dan peralatan support, sebagai tab sendiri di panel
perangkat:
- **Sumber listrik**: dipilih dari titik listrik yang sudah dibuat, diurutkan dari yang terdekat, beserta MCB-nya. Bisa
  juga dengan alat *Hubungkan*: perangkat → titik listrik. Setelah dipilih, tampil ringkasan titik itu (kapasitas,
  terpakai, sisa) dan tombol *Lepas*.
- **Listrik di lokasi**: stop kontak tersedia / perlu tarik listrik / PoE dari uplink / baterai.
- **Konsumsi daya (W)**: kosong = ambil dari spesifikasi katalog (`daya_w`).

Semua isian boleh dikosongkan. Di **Daftar perangkat**, centang beberapa perangkat lalu pilih **⚡ Titik listrik…**
untuk memasang (atau melepas) sumber listrik sekaligus; ini bisa di-Ctrl+Z sebagai satu langkah.

Beban tiap titik listrik dihitung otomatis (watt & % kapasitas, stop kontak terpakai). Hasilnya tampil di panel titik
listrik, kolom *Listrik* di Daftar, dan kartu **Kebutuhan listrik** di tab Topologi, termasuk daftar perangkat yang
perlu ditarikkan listrik. Pemeriksaan desain memberi tanda bila:
- beban melebihi kapasitas (≥ 80% = peringatan)
- stop kontak kurang
- watt perangkat belum diisi
- ada perangkat yang perlu tarik listrik

Lapisan denah *Jalur listrik* menampilkan garis kuning putus-putus dari perangkat ke titik listriknya (juga tampil saat
salah satunya dipilih). Data disimpan di atribut (`listrik`, `listrik_id`, `daya_w`, dll.), jadi tidak perlu migrasi
database. Datanya ikut dipetakan ulang saat duplikat event, impor, dan buka backup.

**Monitoring penarikan kabel.** Selain status alat, setiap kabel ke uplink (perangkat ber-uplink, bukan wireless)
punya status sendiri: *Belum ditarik → Sudah ditarik → Terminasi / konektor → Sudah dites OK*, atau *Kabel
bermasalah*. Warnanya progresif dan sengaja tidak memakai warna jenis perangkat atau status internet:
- ○ abu-abu = belum
- ◑ kuning = ditarik
- ◕ biru langit = terminasi
- ✓ hijau = dites
- ⚠ merah mawar = bermasalah

Setiap status juga punya ikon dan pola garis sendiri, jadi tetap terbaca tanpa mengandalkan warna.

Cara tercepat mengubah status: nyalakan lapisan **Progres kabel** di denah, lalu klik garis atau penanda bulat di
tengah kabel. Muncul pemilih bertahap:
- **Tandai tahap berikutnya** (satu klik, atau `Enter`)
- `1`–`4` untuk memilih tahap, `5` = bermasalah, `Esc` untuk menutup

Pemilih yang sama juga ada di:
- **Panel perangkat** (tab *Info* & *Koneksi*)
- **Daftar perangkat**: klik badge di kolom *Status kabel*. Ada juga filter status kabel, dan *Status kabel…* untuk
  perangkat yang dicentang.
- **Pohon topologi**: klik badge 🔌
- **Link tim** (peran update status): hanya untuk kategori tugas tim

Setiap perubahan masuk riwayat (siapa & kapan), dan perubahan admin bisa di-Ctrl+Z.

Pantau progresnya di:
- **Topologi → Progres penarikan kabel**: persen, jumlah link & meter per status, *lihat* untuk memfilter Daftar.
  Pohon topologi juga menampilkan badge 🔌 per kabel.
- **Panel ringkasan denah**: progres singkat.
- **Lapisan denah *Progres kabel***: garis diwarnai & berpola per status, dengan penanda ikon di tengah tiap kabel
  (klik untuk ubah). Selama lapisan ini aktif, pegangan bentuk jalur disembunyikan.

Pemeriksaan desain memberi tanda bila kabel bermasalah, atau alat sudah diuji padahal kabelnya masih "belum ditarik".
Data disimpan di atribut `kabel` (tanpa migrasi database). CSV ikut berisi kolom status kabel.

**Multi-WAN (router).** Router bisa tersambung ke lebih dari satu Sumber WAN/ISP. WAN utama tetap lewat Uplink biasa.
WAN tambahan diatur di tab **Koneksi** router, di bagian *WAN / sumber internet*:
- **Tambah WAN** memilih Sumber WAN/ISP lain, atau pakai alat *Hubungkan* dari router ke ISP kedua. Router yang sudah
  punya uplink otomatis mendapat WAN tambahan, bukan mengganti uplink.
- **Port** setiap WAN bisa diisi (mis. ether2).
- **Mode**: *Failover* (WAN berikutnya cadangan) atau *Load balance* (bandwidth digabung).

Dampaknya pada analisis:
- Status internet dianggap tersambung selama salah satu WAN masih baik. Perangkat di bawah router tetap hijau walau
  ISP utama bermasalah.
- Bandwidth maks. = WAN terbesar (failover) atau jumlah semua WAN (load balance).
- Di denah, WAN tambahan tampil sebagai garis toska putus-putus berlabel WAN2, WAN3. Kabelnya ikut estimasi kabel.
- Pohon topologi dan ringkasan Sumber WAN menyebut pemakaian WAN tambahan.
- Data disimpan di atribut router (`wan_lain`, `wan_mode`), jadi tidak perlu migrasi database. Ikut tersalin saat
  duplikat event, impor JSON, dan buka backup (id dipetakan ulang).

**Uplink kedua switch (redundan / LACP).** Switch bisa punya lebih dari satu uplink ke router/switch lain. Atur di tab
**Koneksi** switch, bagian *Uplink switch*, atau pakai alat *Hubungkan* dari switch yang sudah ber-uplink ke
router/switch lain: *OK* = tambah uplink kedua, *Batal* = ganti uplink utama. Setiap uplink kedua punya port, media
(UTP/fiber), dan status kabel sendiri.

Mode:
- **Redundan (STP/RSTP)**: satu jalur aktif, lainnya cadangan. Internet tetap tersambung selama salah satu uplink baik.
- **LACP (802.3ad)**: kabel digabung, bandwidth dijumlah. Memilih uplink yang sama dengan uplink utama otomatis
  menjadi LACP (kabel kedua ke switch yang sama).

Calon uplink kedua tidak menampilkan perangkat di bawah switch itu sendiri, agar tidak membentuk loop topologi.
Pemeriksaan desain mengingatkan:
- STP/RSTP untuk mode redundan
- konfigurasi link aggregation (dan stacking/MLAG bila LACP ke switch berbeda)
- port switch yang terpakai

Di denah tampil garis ungu putus-putus berlabel *UP2 · RSTP* / *UP2 · LACP* (oranye bila fiber). Kabelnya ikut
estimasi & progres kabel, dan statusnya bisa diklik di lapisan *Progres kabel*. Kabel WAN tambahan router juga kini
punya status kabel sendiri. Data disimpan di atribut switch (`uplink_lain`, `uplink_mode`), jadi tidak perlu migrasi.
Datanya ikut tersalin dan dipetakan ulang saat duplikat event, impor, dan buka backup.

**Kunci posisi.** Titik yang posisinya sudah pasti bisa dikunci agar tidak tergeser saat menata denah. Caranya lewat
tombol 🔓 *Kunci* di panel perangkat, tombol `K`, atau sekaligus di Daftar perangkat (centang lalu *🔒 Kunci posisi* /
*🔓 Buka kunci*). Bisa juga lewat Cari (Ctrl+K) dengan perintah *Kunci posisi semua perangkat*. Titik terkunci
bergembok kecil di denah dan bertanda 🔒 di Daftar. Titik itu tetap bisa dipilih, disambungkan, dan diubah isiannya,
hanya tidak bisa digeser (mouse maupun panah). Kunci tersimpan di atribut perangkat (ikut backup), jadi tidak perlu
migrasi database. Kunci bisa dibatalkan dengan Ctrl+Z.

**Label bertumpuk.** Label yang saling menimpa disembunyikan otomatis. Label perangkat jaringan diutamakan di atas
label endpoint, lalu label muncul lagi saat di-zoom atau saat kursor diarahkan.

**Daftar perangkat.** Kolom yang kosong di semua baris disembunyikan, dan bisa ditampilkan lagi lewat *Lainnya → Kolom
kosong*. Ekspor/impor JSON, *Rapikan nama group*, dan *Hapus semua* ada di menu *Lainnya*.

Pintasan di Denah:

| Tombol | Fungsi |
|---|---|
| `V` / `L` / `M` | Pilih/geser / hubungkan / ukur |
| `1`–`9` | Tambah perangkat |
| `Ctrl+D` | Duplikat perangkat |
| Panah | Geser perangkat (`Shift` = 10×) |
| `Tab` | Perangkat berikutnya |
| `U` | Lompat ke uplink |
| `Del` | Hapus |
| `F` | Seluruh denah |
| `P` | Sembunyikan / tampilkan panel kanan (desktop) |
| `K` | Kunci / buka kunci posisi perangkat terpilih |
| `Esc` | Batal |
| `Alt+1`–`7` | Pindah tab (Denah · Daftar · Topologi · Support · Ceklis · Port · Proyek) |
| `?` | Daftar semua pintasan (juga di menu akun) |

Scroll/pinch untuk zoom, geser latar untuk pan. Saat menghubungkan, Shift+klik menghubungkan beberapa perangkat
sekaligus.

**Tata letak denah** (dibuat agar area denah seluas mungkin):
- **Rel alat** di kiri hanya berisi ikon (56 px). Nama alat & pintasannya muncul sebagai tooltip saat kursor diarahkan.
  Semua alat muat di layar laptop 768 px.
- **Panel kanan**: seret tepi kirinya untuk mengubah lebar (280–560 px, disimpan per browser). Klik ganda tepinya untuk
  kembali ke lebar bawaan. Tombol panel / `P` menyembunyikannya.
- **Tampilan peta** (label, garis uplink, panjang kabel, cakupan AP, status internet, progres kabel, jalur listrik,
  kecerahan denah) ada di popover tombol **☰**, sehingga bawah denah tidak tertutup. Tutup dengan Esc atau klik di luar.
- **Filter peta** (Semua / Jaringan / AP / Switch / Support) dan **Layer** berada dalam satu baris di kiri atas.
  - Nama layer diringkas dengan membuang awalan yang sama, mis. "BSI EXPO 2026 - EXPO LINE" → "EXPO LINE"; nama
    lengkap ada di tooltip.
  - Di HP, filter & layer masing-masing satu baris yang bisa digeser.
- **Bar tab**: bila sempit, tombol Cari menjadi ikon saja. Mode **⛶** tetap menyembunyikan header & tab untuk denah
  layar penuh.

**Layer jaringan (beberapa jaringan dalam satu denah).** Untuk venue yang sama dengan jaringan terpisah, mis. EXPO LINE dan
BSI LINE: sumber WAN berbeda dan tarikan kabel ke endpoint yang berbeda pula.
- **Kelola** di *Proyek → Layer jaringan*: tambah layer, ganti nama & warna, hapus layer kosong.
- **Impor event lain sebagai layer**: semua perangkat event itu disalin menjadi layer baru, termasuk posisi, uplink &
  port, konfigurasi, status, ceklis, hasil pengecekan, dan foto bukti (file disalin).
  - Posisi & jalur kabel diskalakan bila ukuran denah berbeda.
  - Event asal tidak berubah.
  - Contoh: buka event EXPO LINE → impor "BSI LINE".
  - Bila sudah ada layer bernama sama dengan event sumber, aplikasi meminta konfirmasi (mencegah impor dobel).
- **Denah**: pemilih **Layer** (Semua / per layer) di bawah pemilih tampilan.
  - Layer lain tampil samar dan tidak bisa diklik, sehingga posisi fisiknya tetap terlihat.
  - Titik berwarna di kiri bawah tiap perangkat menunjukkan layer-nya.
  - Perangkat baru masuk layer uplink-nya, atau layer yang sedang aktif.
  - Memilih perangkat dari layer lain (mis. lewat pencarian) otomatis menampilkan layer itu.
- **Pindah layer**: di tab *Identitas* (perangkat di bawahnya ikut), atau lewat aksi massal *◧ Layer…* di daftar.
  Bisa di-Ctrl+Z.
- **Daftar, topologi, ceklis, support & listrik, port, ringkasan panel** mengikuti layer aktif. Halaman Ceklis &
  Support memberi catatan "Menampilkan layer …" + tombol *Tampilkan semua layer*. Tombol "✓ semua", CSV, dan cetak di
  halaman itu juga hanya untuk layer aktif.
  - Pada "Semua", pohon topologi dikelompokkan per layer.
  - Daftar memberi label layer pada tiap perangkat.
  - Pada "Semua", tabel **Kebutuhan perangkat** dan **Estimasi kabel** di Topologi punya kolom per layer (berwarna) + Total.
    Ringkasan Sumber WAN memberi label layer dan kapasitas per layer.
  - Satu layer dipilih: ringkasan Topologi (WAN, SSID, kebutuhan perangkat, kabel) hanya untuk layer itu.
  - Ekspor CSV daftar perangkat diberi kolom **Layer** dan diurutkan per layer.
- **Pemeriksaan**: IP ganda dihitung per layer, karena jaringan terpisah boleh memakai IP yang sama. Ada peringatan bila
  uplink menyeberang ke layer lain.
- **Laporan**: dialog *Cetak* punya pilihan **Layer jaringan**.
  - *Semua layer*: laporan gabungan. Daftar perangkat dikelompokkan per layer (baris judul berwarna + jumlah), dan
    tabel kebutuhan perangkat & estimasi kabel dirinci per layer.
  - Satu layer: denah, tabel, kebutuhan perangkat, kabel, pemeriksaan, foto, dan PowerPoint hanya untuk jaringan itu,
    dengan judul "— Layer …".
  - Berlaku juga untuk sheet AP, CSV, laporan support, dan laporan foto.
  - Laporan gabungan semua layer, per jenis laporan:
    - **Laporan lengkap**: legenda layer, titik warna layer di denah, daftar perangkat berkelompok per layer.
    - **Laporan foto (cetak)**: rekap per layer, lalu per layer judul berwarna + kartu foto + tabel belum difoto.
    - **PowerPoint**: perangkat & tarikan LAN per layer di sampul; ringkasan per layer & jenis; daftar titik berjudul "Layer · Jenis";
      slide pembatas tiap layer; slide titik diberi strip warna layer + nama layer di judul & kaki.
    - **Sheet AP / CSV AP**: urut per layer, label / kolom Layer.
    - **Laporan support & listrik**: label layer di titik listrik & peralatan support.
- **Penyimpanan**: kolom `np_proyek.lapisan` (JSON, migrasi otomatis skema 11) dan atribut perangkat `lapisan`.
  - Ikut duplikat event dan backup / pulihkan.
  - Event tanpa layer tetap satu jaringan seperti biasa; pemilih layer tidak tampil.

**Lantai gedung (denah berbeda per lantai).** Untuk satu gedung dengan beberapa lantai, setiap lantai punya gambar
denah dan skala sendiri. Lantai terpisah dari layer: layer adalah jaringan, lantai adalah lokasi fisik, jadi satu layer
bisa melintasi beberapa lantai.
- **Kelola** di *Proyek → Lantai gedung*:
  - tambah lantai, ganti nama, isi tinggi lantai (meter, untuk kabel riser), dan atur urutan bawah → atas (↑ ↓);
  - upload denah per lantai. Centang *Venue sama* bila hanya mengganti versi gambar, maka posisi perangkat dan skala
    ikut diskalakan;
  - hapus lantai hanya bila sudah kosong.
  - Lantai 1 = denah utama (kartu *Denah venue*).
- **Denah**:
  - pemilih **Lantai** di atas peta (urut seperti tombol lift); peta selalu menampilkan satu lantai;
  - perangkat baru ditaruh di lantai yang tampil;
  - memilih perangkat lantai lain (pencarian, daftar) otomatis pindah ke denah lantainya;
  - alat **Ukur** / kalibrasi menyimpan skala lantai yang sedang tampil.
- **Pindah lantai**: *Identitas → Lantai (denah)* (perangkat terpilih) atau *Daftar → ⇅ Lantai…* (massal). Posisi
  diskalakan ke ukuran denah tujuan dan lekukan jalur dihapus. Bisa dibatalkan dengan Ctrl+Z.
- **Kabel antar lantai (riser)**: uplink ke perangkat di lantai lain diatur lewat pilihan uplink di panel.
  - Garisnya berujung di **titik riser** = posisi uplink pada denah lantai ini. Denah antar lantai dianggap sejajar,
    dan ukuran gambar yang berbeda diskalakan.
  - Titik riser ditandai lingkaran ungu ⇅ + "SW-01 · Lantai 1".
  - Perangkat tujuan mendapat lencana ⇅n (jumlah kabel dari lantai lain).
  - Panjang kabel = jalur mendatar di denah lantai asal sampai titik riser + selisih ketinggian lantai + tambahan %.
- **Lainnya**:
  - pemeriksaan co-channel AP hanya membandingkan AP di lantai yang sama;
  - titik listrik di lantai yang sama diutamakan;
  - impor event lain sebagai layer masuk ke lantai yang sedang tampil.
- **Laporan**:
  - laporan lengkap, sheet AP, dan laporan support mencetak satu denah per lantai (judul nama lantai + jumlah perangkat);
  - daftar perangkat diberi nama lantai, dan uplink lintas lantai ditandai "(⇅ Lantai …)";
  - PowerPoint dan potongan denah checker memakai denah lantai titik itu.
- **Penyimpanan**: kolom `np_proyek.lantai` (JSON `[{id, nama, tinggi, denah_file, denah_w, denah_h, skala}]`, migrasi
  otomatis skema 12) dan atribut perangkat `lantai` (kosong = Lantai 1).
  - Gambar lantai lain diambil lewat `api/denah.php?…&lantai=F2`.
  - Ikut duplikat event (file denah disalin), hapus event, dan backup / pulihkan.

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
- **Aturan koneksi per kategori** (dikelompokkan per uplink):

  | Aturan | Level |
  |---|---|
  | Endpoint / CCTV / server adalah perangkat ujung dan tidak bisa menjadi uplink | error |
  | Media wireless ke perangkat tanpa radio | error |
  | Switch / router / titik LAN di-uplink wireless ke AP | error |
  | Perangkat selain router / wireless bridge langsung di Sumber WAN (tanpa NAT/DHCP/firewall) | peringatan |
  | Sumber WAN yang punya uplink | peringatan |
  | Klien kabel di AP | peringatan |
  | Router / titik LAN di bawah AP atau titik LAN | peringatan |
  | Titik LAN tidak ditarik dari switch / router | peringatan |
  | Fiber ke switch / router tanpa port SFP (butuh media converter) | peringatan |
  | Antar wireless bridge memakai kabel | info |
- **Konfigurasi perangkat inti**:

  | Aturan | Level |
  |---|---|
  | Router tanpa IP LAN / subnet | error |
  | Switch yang membawa VLAN tetapi tipenya (managed) belum diisi | peringatan |
  | VLAN dibuat di router tetapi tidak dipakai perangkat | info |
  | Bandwidth Sumber WAN belum diisi | info |

  **Garis merah di denah.** Kabel yang terkena **error** digambar merah tegas dengan halo berkedip pelan. Contohnya:
  - media wireless ke switch;
  - port dobel;
  - VLAN terputus atau belum dibuat;
  - uplink access yang memutus VLAN;
  - kabel berstatus bermasalah.

  Arahkan kursor ke garis untuk melihat pesan error-nya. Garis kembali normal begitu error diperbaiki. Di lapisan
  *Progres kabel*, warna status kabel tetap dipakai. IP ganda tidak memerahkan garis karena bukan kesalahan kabel.

  VLAN access yang diatur manual di kotak VLAN ikut dihitung sebagai VLAN perangkat. Jadi VLAN yang belum dibuat di
  router, atau tidak dibawa trunk di atasnya, ikut terdeteksi. Peringatan VLAN tampil juga di kotak VLAN tab Koneksi.

## Link lihat-saja

Setiap event punya link `index.html?lihat=KODE` (tersedia juga sebagai QR di tab Proyek) untuk teknisi lapangan. Link ini
bisa dibuka tanpa login, tetapi data tidak bisa diubah, password WiFi/admin disamarkan, dan isinya diperbarui otomatis
setiap 30 detik. Tombol **Ganti link** membuat kode baru dan link lama tidak berlaku lagi.

## Instalasi

Aplikasi ini memakai database yang sama dengan aplikasi lain (`extradata`), dengan tabel berawalan `np_`.

**Migrasi database berjalan otomatis setelah deploy**, tanpa phpMyAdmin dan tanpa perlu login:
- Versi struktur database tersimpan di tabel `np_meta` (`schema`), sedangkan versi kode ada di `NP_SCHEMA`
  (`api/db.php`).
- Setelah kode baru sampai di server (push GitHub → update di cPanel), **request pertama** ke Net Plan, baik halaman
  admin maupun link lihat-saja, mendeteksi versi yang tertinggal lalu menjalankan `np_install_schema()`.
  `GET_LOCK` memastikan hanya satu request yang memigrasi.
- Bisa juga dijalankan manual atau sebagai langkah deploy: `php net-plan/api/migrate.php`. Skrip ini menampilkan versi
  dan tabel, dan keluar dengan kode 1 bila gagal. Skrip tidak bisa dibuka dari browser.
- User database harus punya hak **CREATE, ALTER, INDEX**. Bila tidak, halaman menampilkan pesan error yang jelas.

Struktur juga bisa diimpor manual dari `database/netplan.sql`.

Migrasi ini **idempoten** dan sudah diuji pada database baru, database versi lama berisi data, dan 5 migrasi yang
berjalan bersamaan:
- tabel dibuat dengan `CREATE TABLE IF NOT EXISTS`;
- kolom dan index baru hanya ditambahkan bila belum ada (dicek lewat `information_schema`). Error "sudah ada" dari
  request lain yang berjalan bersamaan diabaikan;
- tipe endpoint bawaan hanya diisi saat tabelnya baru dibuat (`INSERT IGNORE` + `UNIQUE` nama), sehingga tidak dobel
  dan tipe yang sengaja dihapus tidak muncul lagi;
- tidak ada data yang dihapus atau diubah.

Untuk menambah kolom di versi berikutnya, tambahkan di `CREATE TABLE` **dan** di `np_install_schema()`, lalu naikkan
`NP_SCHEMA`.

- **XAMPP lokal**: tidak perlu konfigurasi. Password bawaan `admin` hanya berlaku bila halaman dibuka dari komputer itu
  sendiri (localhost).
- **Hosting / cPanel**: salin `api/config.local.example.php` menjadi `api/config.local.php`, lalu isi kredensial database
  dan `NP_ADMIN_PASS`. File ini tidak ikut ke Git. Folder `uploads/` harus bisa ditulis oleh PHP.
- **Update di server** dilakukan dengan `git pull` lewat SSH di folder web (lihat `other/README.md`, bagian *Upload ke
  cPanel*). Migrasi database jalan otomatis setelahnya. Pasang hook `post-merge` agar migrasi langsung jalan saat pull.

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
