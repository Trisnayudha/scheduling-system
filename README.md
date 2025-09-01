# Invoice Reminder Watcher

Watcher service untuk membuat task **email reminder pembayaran** berdasarkan data dari tabel `payment_invoice`.  
Reminder utama adalah **12 jam sebelum invoice expired** (`pay_12h`), dan sistem ini bisa dikembangkan untuk reminder lain (3h, expired, WhatsApp, dll).

## ✨ Fitur Utama

- Membaca invoice baru dari DB dengan offset (`comm_offsets`) → **idempotent**, tidak dobel.
- Filter hanya status yang relevan: `PENDING`, `UNPAID`, `WAITING_PAYMENT`.
- Join dengan tabel `users` untuk ambil `users.name`.
- Konversi `expiry_date` dari **WIB (+07:00)** ke **UTC** agar jadwal reminder konsisten.
- Menyimpan offset agar setiap batch selalu melanjutkan dari ID terakhir.
- Menggunakan `enqueueTask` untuk menjadwalkan job kirim email dengan template `pay_12h`.

## 📂 Struktur File

src/
├─ db.js # Pool koneksi MySQL
├─ services/
│ ├─ invoiceWatcher.js # Watcher logic (scan & enqueue reminder)
│ └─ taskService.js # Utility enqueueTask (push ke queue)
└─ ...

sql
Copy code

## ⚙️ Query Utama

Watcher mengambil data invoice dan join user:

```sql
SELECT
    pi.id,
    pi.payment_code,
    pi.payer_email,
    pi.description,
    pi.invoice_url,
    pi.status,
    u.name AS user_name,
    CONVERT_TZ(pi.expiry_date, '+07:00', '+00:00') AS expiry_utc
FROM payment_invoice pi
LEFT JOIN users u ON pi.users_id = u.id
WHERE pi.id > ?
ORDER BY pi.id ASC
LIMIT ?;
🚀 Cara Jalanin
Install dependencies

bash
Copy code
npm install
Set environment
Buat file .env:

env
Copy code
DB_HOST=localhost
DB_USER=root
DB_PASS=******
DB_NAME=indonesiaminer
Jalankan watcher (manual)

bash
Copy code
node src/services/invoiceWatcher.js
Atau pakai scheduler (misalnya Supervisor, pm2, atau cron) untuk jalan periodik:

bash
Copy code
# contoh tiap 1 menit
* * * * * /usr/bin/node /path/to/src/services/invoiceWatcher.js
📨 Payload Reminder
Contoh payload yang di-enqueue ke task queue:

json
Copy code
{
  "channel": "email",
  "to_email": "user@email.com",
  "template_code": "pay_12h",
  "topic": "payment",
  "payload": {
    "name": "Nama User",
    "invoice": "INV-12345",
    "pay_link": "https://...",
    "expired_at": "2025-09-01T10:00:00.000Z"
  },
  "job_key": "pay:INV-12345",
  "scheduled_at": "2025-08-31T22:00:00.000Z"
}
🔒 Catatan Teknis
Timezone: semua jadwal disimpan dan dihitung dalam UTC. expiry_date dianggap WIB (+07:00).

Offset Table: tabel comm_offsets memastikan tidak ada invoice yang terbaca dua kali.

Idempotent: jika job dengan job_key sama sudah ada di queue, watcher akan skip (biar aman kalau restart).
```
