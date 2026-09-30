# StockLab Online — Handoff untuk Chat Berikutnya

Dokumen ini melengkapi README: gunakan README untuk setup/deploy umum, dan file ini untuk status kerja paling baru.

## Project dan akses

- Workspace: `/home/dac/stocklabonline`
- Aplikasi aktif: Vite memakai `src/`; `index.html` root adalah prototipe lama.
- GitHub remote: `https://github.com/rizkifadlillah1707-code/stocklabmmultidevice.git`
- Branch: `main`
- Situs production: https://stocklab-online.pages.dev/
- Cloudflare Pages project: `stocklab-online`; deployment production branch yang digunakan sebelumnya `STOCKLAB`; ada juga preview alias `main.stocklab-online.pages.dev`.
- Firebase project: `projecttestingstocklab`; konfigurasi lokal berada di `.env` (ignored, jangan dibaca/cetak/commit atau meminta user mengirimkannya).

## Status Git terkini

Pada saat catatan ini dibuat:

- HEAD lokal: `25841a4` — `Tampilkan kartu aksi saat bidding dan dashboard portofolio semua pemain`
- `origin/main` masih di `f3af42b`; artinya ada **1 commit lokal belum dipush**.
- Commit `25841a4` juga **belum dideploy ke Cloudflare**. Production yang live saat ini tidak memiliki perubahan tersebut.
- Working tree bersih setelah commit.
- Jangan push/deploy sebelum memahami dan mempertahankan commit lokal ini.

Perubahan di `25841a4`:
1. Kartu aksi ronde dibagikan di awal ronde dan preview ringkasnya tampil selama bidding.
2. Dashboard portofolio bersama menampilkan saham per pemain, nilai saham dan total beredar.
3. Tes/build baru saja dijalankan setelah perubahan tersebut: `npm test` **19/19 lulus**, `npm run build` berhasil. Belum ada tes UI/browser khusus untuk fitur baru.

## Arsitektur

- `src/index.html` — markup aplikasi.
- `src/main.js` — UI, room subscriptions, moderator dan peserta.
- `src/game-engine.js` — aturan/efek kartu dan transisi fase.
- `src/room-service.js` — Firebase Realtime Database access.
- `src/firebase.js` — inisialisasi Firebase dari `VITE_FIREBASE_*`.
- `firebase.database.rules.json` — rules yang dipasang melalui Firebase Console.
- `tests/game-engine.test.js` — tes deterministik engine (saat ini 19).
- `README.md` — instruksi setup lokal, Firebase, dan Cloudflare Pages.

## Perilaku / batasan penting

- Room 3–5 pemain; beberapa room dapat berjalan bersamaan.
- Firebase Spark Realtime Database membatasi 100 koneksi simultan seluruh project.
- Moderator browser adalah otoritas state dan harus tetap aktif selama permainan. Ini MVP untuk demo/kelas dengan moderator tepercaya, bukan backend anti-cheat.
- Engine tidak memiliki mekanik pailit/eliminasi. Pungutan/biaya tidak membuat saldo negatif; uang dipotong maksimal sampai 0. Utang kartu mengurangi skor akhir 13 per kartu.
- Harga saham memakai tangga harga positif; tidak ada path untuk harga 0. Crash menghapus holdings dan reset ke 5 saat melampaui dasar; Split menggandakan holdings dan reset ke 5 saat melewati puncak.
- Informasi kartu ekonomi privat dari Info Bursa dikirim ke pemain pemilih.
- Economy rules tertentu mungkin perlu diverifikasi dengan rulebook cetak, terutama definisi Merger/World Oil/Tax Amnesty dan kapan crash/split terjadi.

## Verifikasi sebelumnya

Jalankan dari root project:

- `npm test` — terakhir 19/19 pass.
- `npm run build` — terakhir berhasil.

Tes mencakup 5 action cards, 18 economy-card types, split/crash keempat sector tracks, Resesi, Stimulus, Restructuring, Tax Amnesty, World Oil + Merger, pinjaman, pungutan, serta satu simulasi enam ronde.

## Saran langkah berikutnya

1. Lanjutkan dari commit lokal `25841a4`; jangan checkout/reset ke `origin/main`.
2. Uji melalui browser sebagai beberapa peserta: pastikan semua klien menerima kartu aksi sebelum bidding, kartu yang ditampilkan sesuai pool yang diambil setelah bidding, lalu dashboard menunjukkan nilai holdings aktual setelah tiap aksi/jual/fase ekonomi.
3. Jika lolos, push commit lokal ke GitHub.
4. Deploy build yang sama ke Cloudflare production `STOCKLAB` dan preview alias `main` bila masih digunakan.
5. Verifikasi production tampil preview kartu bidding/dashboard dan Firebase berstatus connected.

Jangan tulis API key, credential, token, isi `.env`, atau secret ke file handoff ini.
