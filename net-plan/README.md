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

**Status pemasangan bertahap.** Di tab *Identitas* (dan kotak update status link tim), status alat memakai langkah
yang sama dengan status kabel: *Rencana → Terpasang → Sudah diuji*, tombol satu klik *Tandai tahap berikutnya*, dan
*Bermasalah* terpisah. Tim hanya bisa memilih status yang diizinkan PM. Perubahan admin bisa di-Ctrl+Z.

**Port switch / router.** Di panel switch/router (tab *Info*, bagian *Terhubung ke sini*) tampil **peta port**.
Jumlah port diambil dari isian *Jumlah port* atau katalog (Port Ethernet + SFP). Isinya:
- Kotak port 1…N (+ SFP): terpakai berwarna perangkatnya, kosong abu-abu, port uplink bergaris tepi, port dobel
  merah bergaris. Klik kotak port untuk membuka perangkatnya.
- Setiap perangkat terhubung menampilkan label port-nya. Port yang tidak ada di switch ditandai merah.
- **Belum ada port**: pilih dari port kosong, atau *Isi otomatis berurutan*. Gaya nama port ikut yang sudah dipakai,
  mis. `ether7`, dan bisa di-Ctrl+Z.

Di sisi perangkat anak, kolom *Port di uplink* (tab Koneksi) menyarankan port kosong. Nama port dibaca dari angka
terakhirnya ("ether5" = "5" = "ge-0/0/5", "sfp2" = SFP 2). Pemeriksaan desain memberi tanda port dobel dan port di
luar jumlah port.

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
| `Alt+1`–`5` | Pindah tab (Denah · Daftar · Topologi · Support · Proyek) |
| `?` | Daftar semua pintasan (juga di menu akun) |

Scroll/pinch untuk zoom, geser latar untuk pan. Saat menghubungkan, Shift+klik menghubungkan beberapa perangkat
sekaligus.

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
