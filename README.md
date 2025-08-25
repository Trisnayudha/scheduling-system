# 📬 msg-scheduler

Email & WhatsApp **scheduling service** berbasis Node.js.  
Mendengarkan tabel MySQL → enqueue job di BullMQ (Redis) → kirim via Postmark & WhatsApp (`whatsapp-web.js`).

---

## ✨ Fitur

- Auto-send: polling DB → enqueue otomatis
- Email templating: Handlebars HTML (`templates/email/`)
- WhatsApp templating: modul JS (`templates/whatsapp/`)
- Antrian BullMQ v5 (Redis) + retry/backoff
- Status: `PENDING → SCHEDULED → SENT/FAILED`

---

## ⚙️ Setup Cepat

```bash
git clone <REPO_URL> msg-scheduler
cd msg-scheduler
npm install
```

mysql -u root -p -e "CREATE DATABASE scheduler CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

sudo apt-get install -y redis-server
redis-cli ping # harus PONG

DB_NAME=scheduler
DB_USER=root
DB_PASS=your_password
DB_HOST=127.0.0.1
DB_DIALECT=mysql

REDIS_URL=redis://127.0.0.1:6379

POSTMARK_SERVER_TOKEN=pm_xxxxx
FROM_EMAIL="Indonesia Miner <noreply@indonesiaminer.com>"

PORT=3000
POLL_INTERVAL_MS=15000
TZ=Asia/Jakarta

npm run dev
npm run worker
