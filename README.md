# StockLab Online

StockLab Online adalah MVP multiplayer untuk room StockLab: moderator membuat room, peserta bergabung memakai kode/tautan, lalu setiap orang mengirim tawaran dan memilih aksi dari perangkat masing-masing. Realtime memakai Firebase Authentication anonim + Realtime Database; aplikasi statis dibangun dengan Vite. Status koneksi pemain terlihat di lobby dan moderator dapat melewati giliran pemain yang terputus.

> **Catatan MVP:** moderator harus tetap membuka tab selama permainan karena ia menjadi otoritas yang memvalidasi dan menerapkan aksi. Deck ekonomi, saldo, tawaran yang belum dibuka, dan state otoritatif hanya dapat dibaca moderator / pemain yang berhak. Batas lima pemain saat ini divalidasi aplikasi, belum ditegakkan secara atomik oleh Firebase Rules. Ini bukan backend anti-cheat setingkat server khusus.

## Struktur

- `src/index.html` — markup aplikasi aktif, digunakan Vite.
- `src/styles.css` — tampilan responsif.
- `src/main.js` — layar room, realtime subscriptions, kontrol moderator dan peserta.
- `src/game-engine.js` — aturan fase, bidding, kartu aksi, ekonomi dan skor.
- `src/firebase.js` — inisialisasi Firebase dari environment variables.
- `src/room-service.js` — akses room, state, bid privat dan command.
- `firebase.database.rules.json` — security rules Realtime Database.
- `index.html` — prototipe lokal lama; bukan entry point untuk build online.

## Aktivasi lokal

### 1. Buat Firebase project gratis

1. Buka [Firebase Console](https://console.firebase.google.com/) dan buat project.
2. Pada **Authentication → Sign-in method**, aktifkan **Anonymous**.
3. Pada **Realtime Database**, buat database (region yang dekat dengan pemain disarankan).
4. Buka tab **Rules** pada Realtime Database, ganti rules dengan isi `firebase.database.rules.json`, lalu tekan **Publish**. Jangan memakai Test mode / rules terbuka.
5. Dari **Project settings → General → Your apps**, daftarkan aplikasi Web dan salin `apiKey`, `authDomain`, `projectId`, dan `appId`. Salin juga URL Realtime Database, biasanya `https://<project-id>-default-rtdb.<region>.firebasedatabase.app`.

### 2. Isi konfigurasi dan jalankan

1. Salin `.env.example` menjadi `.env` di folder root.
2. Isi nilai-nilai ini dari Firebase Console: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, dan `VITE_FIREBASE_APP_ID`.
3. Install dependencies dengan `npm install`.
4. Jalankan `npm run dev` dan buka URL lokal yang ditampilkan.
5. Uji dengan beberapa browser/perangkat. Minimal 3, maksimal 5 pemain.

Firebase Web API key memang terlihat di bundle browser dan bukan password. Keamanan data bergantung pada Authentication dan Realtime Database Rules yang disediakan, bukan menyembunyikan API key. Jangan pernah menaruh service-account key di `.env` frontend.

## Deploy gratis ke internet (Cloudflare Pages)

Alamat gratis yang diberikan adalah subdomain seperti `nama-proyek.pages.dev`. Domain kustom milik sendiri biasanya perlu dibeli; Pages tidak menyediakan domain `.com` gratis.

1. Push folder project ke repository GitHub. Pastikan `.env` tidak ikut di-commit (`.gitignore` sudah mengecualikannya).
2. Di Cloudflare Dashboard, buka **Workers & Pages → Create → Pages → Connect to Git** dan pilih repository.
3. Atur build:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** repository root (leave blank/default). `vite.config.js` already points Vite at `src/` and writes build output to `dist/`.
4. Pada **Settings → Environment variables**, tambahkan kelima variabel Firebase `VITE_FIREBASE_*` untuk **Production** (dan Preview bila diperlukan). Nilainya sama dengan `.env` lokal.
5. Jalankan deployment. Cloudflare Pages memberi URL `https://<nama-proyek>.pages.dev`.
6. Di Firebase Console, buka **Authentication → Settings → Authorized domains** dan tambahkan hostname `<nama-proyek>.pages.dev` (tanpa `https://`). Tambahkan juga hostname Preview Pages jika akan menguji deployment preview.
7. Buka URL tersebut di dua atau lebih perangkat. Moderator membuat room, menyalin tautan/kode, peserta mengisi nama dan join. Untuk tautan undangan, URL otomatis memakai `?room=KODE`.

Setiap perubahan rules Firebase dilakukan di Firebase Console. Jika konfigurasi environment berubah di Cloudflare, lakukan deployment baru agar variabel `VITE_*` masuk ke hasil build.

## Build check

- `npm run build` — membuat static bundle ke `dist/`.
- `npm run preview` — menjalankan hasil build secara lokal.
- `npm test` — menjalankan tes transisi game engine.

Firebase Spark (gratis) mempunyai batas penggunaan dan kuota. Untuk kelas kecil/demo biasanya cukup; pantau halaman **Usage and billing** di Firebase Console dan jangan mengaktifkan layanan berbayar tanpa memahami batasnya.
