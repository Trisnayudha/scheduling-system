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

        // 1) lock & baca cursor
        const lastId = await getOffset(conn);

        // 2) ambil invoice BARU saja
        const [rows] = await conn.query(
            `SELECT id, payment_code, payer_email, description, expiry_date, invoice_url, status
         FROM payment_invoice
        WHERE id > ?
        ORDER BY id ASC
        LIMIT ?`,
            [lastId, limit]
        );

        if (!rows.length) { await conn.commit(); return 0; }

        let maxId = lastId;
        let inserted = 0;

        for (const r of rows) {
            if (r.id > maxId) maxId = r.id;

            const stat = String(r.status || '').toUpperCase();
            if (!['PENDING', 'UNPAID', 'WAITING_PAYMENT'].includes(stat)) continue;
            if (!r.payer_email) continue;
            if (!r.expiry_date) continue;

            // expiry_date kamu ISO (…Z) → parse ke Date
            const expUtc = new Date(String(r.expiry_date));
            if (isNaN(expUtc)) continue;

            const sched12h = new Date(expUtc.getTime() - 12 * 3600 * 1000);

            const payload = {
                name: r.description?.trim() || (r.payer_email?.split('@')[0] || 'Guest'),
                invoice: r.payment_code,
                pay_link: r.invoice_url,
                expired_at: isoZ(expUtc)
            };

            try {
                await enqueueTask({
                    channel: 'email',
                    to_email: r.payer_email,
                    template_code: 'pay_12h',
                    topic: 'payment',
                    payload,
                    job_key: `pay:${r.payment_code}`,
                    scheduled_at: sched12h
                });
                inserted++;
            } catch (_) {
                // kalau kebetulan udah ada (misal restart di tengah), lewati saja
            }
        }

        // 3) majukan cursor ke batch yang sudah discan
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
