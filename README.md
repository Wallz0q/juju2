# IWAW VPS Bot v2 (Upgraded)

Bot Telegram create & manage VPS di Railway — **alur sama seperti script awal**, bagian deploy di-upgrade agar lebih stabil.

## Upgrade vs script lama

| Fitur | Script awal | v2 |
|--------|-------------|-----|
| Load token bot | Sering lupa `dotenv` | `require('dotenv').config()` di paling atas |
| Error deploy | Hanya "crash Railway" | Pesan GraphQL / auth / repo / TCP jelas |
| Network / 429 | Langsung gagal | Retry otomatis |
| Validasi token Railway | Di tengah proses | Di awal sebelum create project |
| Progress | Ada | Step 1–6 + status deploy real-time |
| Module deploy | Campur di `index.js` | `src/deploy.js` terpisah, bisa dipakai ulang |

## Fitur bot

- `/start` — menu utama
- `/createvps` — buat VPS (minta token kalau belum ada, lalu nama VPS)
- `/settoken` — simpan Railway Account Token per user
- `/mytoken` — cek token tersimpan
- List project Railway
- Data SSH dikirim ke DM user

## Install

```bash
git clone https://github.com/USERNAME/iwaw-vps-bot.git
cd iwaw-vps-bot
npm install
cp .env.example .env
```

Isi `.env`:

```env
BOT_TOKEN=token_dari_BotFather
OWNER_ID=id_telegram_kamu
```

## Jalankan

```bash
npm start
```

## Push ke GitHub

```bash
git init
git add .
git commit -m "v2: stable Railway deploy engine"

git branch -M main
git remote add origin https://github.com/USERNAME/iwaw-vps-bot.git
git push -u origin main
```

**Jangan commit `.env`** (sudah di `.gitignore`).

## Alur Create VPS

1. User `/createvps` atau tombol menu  
2. Kirim Railway **Account Token** (atau sudah `/settoken`)  
3. Kirim nama VPS (`bot-vps-1`)  
4. Bot: validasi token → project → service → password → TCP proxy → tunggu deploy  
5. Kirim host, port, password SSH  

## Troubleshooting

- **Token not provided** → isi `BOT_TOKEN` di `.env`, restart  
- **Auth gagal Railway** → token Railway salah / expired, buat baru di Account Settings → Tokens  
- **Deploy FAILED/CRASHED** → buka project di railway.app, baca Build Logs (sering template repo)  
- **TCP proxy gagal** → batasan akun/plan Railway  

## Struktur

```text
iwaw-vps-bot-upgraded/
├── index.js          # bot Telegram
├── package.json
├── .env.example
├── .gitignore
├── README.md
└── src/
    └── deploy.js     # engine deploy stabil
```

## License

MIT
