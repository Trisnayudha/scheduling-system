// src/services/invoiceWatcher.js
import { pool } from '../db.js';
import { enqueueTask } from './taskService.js';

function isoZ(d) { return new Date(d).toISOString(); }

async function getOffset(conn) {
    const [rows] = await conn.query(
        `SELECT last_id FROM comm_offsets WHERE source='payment_invoice' FOR UPDATE`
    );
    if (rows.length) return rows[0].last_id;
    await conn.query(
        `INSERT INTO comm_offsets (source,last_id,updated_at) VALUES ('payment_invoice',0,UTC_TIMESTAMP())`
    );
    return 0;
}

async function setOffset(conn, newId) {
    await conn.query(
        `UPDATE comm_offsets SET last_id=?, updated_at=UTC_TIMESTAMP() WHERE source='payment_invoice'`,
        [newId]
    );
}

export async function invoiceTick(limit = 200) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Pastikan sesi MySQL di UTC agar fungsi waktu konsisten
        await conn.query("SET time_zone = '+00:00'");

        // 1) Lock & baca cursor
        const lastId = await getOffset(conn);

        // 2) Ambil invoice BARU, dan konversi expiry_date (WIB) → UTC di SQL
        const [rows] = await conn.query(
            `SELECT 
      pi.id,
      pi.payment_code,
      pi.payer_email,
      pi.description,
      pi.invoice_url,
      pi.status,
      u.name AS user_name,
      -- anggap expiry_date disimpan sebagai WIB tanpa TZ
      CONVERT_TZ(pi.expiry_date, '+07:00', '+00:00') AS expiry_utc
   FROM payment_invoice pi
   LEFT JOIN users u ON pi.users_id = u.id
   WHERE pi.id > ?
   ORDER BY pi.id ASC
   LIMIT ?`,
            [lastId, limit]
        );


        if (!rows.length) { await conn.commit(); return 0; }

        let maxId = lastId;
        let inserted = 0;

        const nowUtcMs = Date.now();

        for (const r of rows) {
            if (r.id > maxId) maxId = r.id;

            const stat = String(r.status || '').toUpperCase();
            if (!['PENDING', 'UNPAID', 'WAITING_PAYMENT'].includes(stat)) continue;
            if (!r.payer_email) continue;
            if (!r.expiry_utc) continue;

            const expUtc = new Date(String(r.expiry_utc).replace(' ', 'T') + 'Z');
            if (isNaN(expUtc)) continue;

            // Jadwalkan 12 jam sebelum expired (UTC)
            const sched12h = new Date(expUtc.getTime() - 12 * 3600 * 1000);

            // Optional: skip kalau jadwal sudah lewat (misal backfill lama)
            if (sched12h.getTime() < nowUtcMs) {
                continue;
            }

            const payload = {
                name: r.description?.trim() || (r.payer_email?.split('@')[0] || 'Guest'),
                invoice: r.payment_code,
                pay_link: r.invoice_url,
                expired_at: isoZ(expUtc) // kirim sebagai ISO UTC
            };

            try {
                await enqueueTask({
                    channel: 'email',
                    to_email: r.payer_email,
                    template_code: 'pay_12h',
                    topic: 'payment',
                    payload,
                    job_key: `pay:${r.payment_code}`,
                    scheduled_at: sched12h // Date(UTC) yang sudah benar
                });
                inserted++;
            } catch {
                // jika duplikat (idempotent di enqueueTask), lewati
            }
        }

        // 3) Majukan cursor
        await setOffset(conn, maxId);
        await conn.commit();

        if (inserted) console.log(`[invoiceWatcher] inserted ${inserted} pay_12h task(s), offset=${maxId}`);
        return inserted;
    } catch (e) {
        try { await conn.rollback(); } catch { }
        console.error('[invoiceWatcher]', e?.message || e);
        return 0;
    } finally {
        conn.release();
    }
}
