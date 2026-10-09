# Live Vote

Voting langsung untuk acara/rapat: peserta memilih lewat link (atau QR), hasilnya langsung bergerak di layar hasil.
Setiap pemilih hanya punya **1 kesempatan memilih per sesi**.

| Halaman | Untuk | Isi |
|---|---|---|
| `index.html` | Admin | Buat sesi (pertanyaan + pilihan), buka/tutup voting, pantau hasil, kelola link pemilih, unduh CSV |
| `vote.html?k=KODE` | Peserta | Pilih satu jawaban lalu kirim. Tanpa `k`, peserta bisa mengetik kode voting |
| `layar.html?k=KODE_LAYAR` | Proyektor/TV | Hasil live (diperbarui tiap 1,5 detik), QR + kode untuk bergabung |

## Cara membatasi 1 suara per pemilih

Dipilih per sesi:

- **Link terbuka** — satu link/QR untuk semua. Tiap perangkat diberi kunci acak (cookie + cadangan di localStorage)
  dan hanya bisa memilih sekali. Cocok untuk acara umum; orang yang sengaja menghapus data browser/berganti
  perangkat masih bisa memilih lagi.
- **Link undangan** — admin menempelkan daftar nama, setiap orang mendapat link pribadi yang hanya bisa dipakai
  sekali (di perangkat mana pun). Paling ketat; cocok untuk pemilihan resmi.

Batasan ini dijaga oleh kunci unik di database (`lv_suara.sesi_id + voter_key`), jadi klik ganda atau beberapa tab
sekaligus tetap hanya tercatat satu suara.

## Alur pakai

1. Buka `http://localhost/extra.saturegis/live-vote/` → login admin.
2. **+ Sesi baru** → isi judul, pertanyaan, pilihan, dan mode → Simpan.
3. (Mode undangan) tempel daftar nama di *Daftar pemilih* → **Buat link** → **Salin semua link** / **Unduh CSV** lalu kirim ke masing-masing.
4. Klik **Buka layar** dan tampilkan di proyektor. Klik **Buka voting**.
5. Peserta memilih; layar hasil bergerak otomatis. Klik **Tutup voting** untuk mengakhiri (pemenang disorot 🏆).

Tombol di layar hasil (gerakkan mouse untuk memunculkan, atau pakai keyboard):
`H` sembunyikan/tampilkan hasil (untuk menjaga ketegangan), `S` urutkan dari suara terbanyak, `Q` sembunyikan QR, `F` layar penuh.

Link layar hasil memakai kode rahasia yang berbeda dari kode voting, jadi peserta tidak bisa mengintip hasil kecuali
admin mencentang *Tampilkan hasil ke pemilih setelah memilih*.

## Instalasi

Memakai database yang sama dengan aplikasi lain (`extradata`), tabel berawalan `lv_`.
Tabel **dibuat otomatis** saat admin login pertama kali (atau impor manual `database/livevote.sql`).

- **XAMPP lokal**: tanpa konfigurasi. Password admin bawaan `admin`, dan hanya berlaku bila dibuka dari komputer itu sendiri (localhost).
- **Hosting / cPanel**: salin `api/config.local.example.php` menjadi `api/config.local.php`, isi kredensial database
  dan `LV_ADMIN_PASS`. Tanpa `LV_ADMIN_PASS`, admin tidak bisa login dari luar localhost. File ini tidak ikut ke Git.

Agar peserta bisa membuka link dari HP di jaringan lokal, buka halaman admin lewat alamat IP komputer
(mis. `http://192.168.1.10/extra.saturegis/live-vote/`) — link & QR mengikuti alamat yang dipakai admin.
Login admin dari alamat IP tersebut memerlukan `LV_ADMIN_PASS`.

Tidak memakai CDN: QR code dibuat oleh `vendor/qrcode.min.js` (qrcode-generator, MIT).

## Struktur

```
live-vote/
├── index.html, vote.html, layar.html
├── assets/   lv.css, layar.css, common.js, admin.js, vote.js, layar.js
├── api/      db.php, admin.php, vote.php, layar.php, config.local.example.php
├── database/ livevote.sql (folder tertutup dari browser)
└── vendor/   qrcode.min.js
```
