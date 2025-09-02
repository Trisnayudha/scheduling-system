// src/services/invoiceWatcher.js
import { pool } from '../db.js';
import { enqueueTask } from './taskService.js';

function isoZ(d) { return new Date(d).toISOString(); }

// expiry_date kamu sudah UTC ISO -> parser fleksibel (hindari "ZZ")
function parseUtcFlexible(val) {
    if (val instanceof Date) return val;
    const s = String(val || '').trim();
    if (!s) return new Date(NaN);
    if (/[zZ]$|[+\-]\d{2}:\d{2}$/.test(s)) return new Date(s); // sudah ada offset/Z
    return new Date(s.replace(' ', 'T') + 'Z'); // fallback 'YYYY-MM-DD HH:mm:ss'
}

// Konfig opsional via ENV
const EVENT_DATE_RANGE = process.env.EVENT_DATE_RANGE || 'May 5 – 7, 2026';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'info@indonesiaminer.com';
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '+62 811 1798 599';
const SUPPORT_PHONE_E164 = process.env.SUPPORT_PHONE_E164 || '628111798599';

// Status invoice yang DIPROSES untuk reminder
const ALLOWED_STATUSES = (process.env.INVOICE_ALLOWED_STATUSES || 'PENDING')
    .split(',').map(s => s.trim().toUpperCase());

// Status invoice yang DIANGGAP BAYAR -> cancel task
const PAID_STATUSES = (process.env.INVOICE_PAID_STATUSES || 'PAID')
    .split(',').map(s => s.trim().toUpperCase());

async function getOffset(conn) {
    const [rows] = await conn.query(
        `SELECT last_id FROM comm_offsets WHERE source='payment_invoice' FOR UPDATE`
    );
    if (rows.length) return rows[0].last_id;
    await conn.query(
        `INSERT INTO comm_offsets (source,last_id,updated_at)
     VALUES ('payment_invoice',0,UTC_TIMESTAMP())`
    );
    return 0;
}

async function setOffset(conn, newId) {
    await conn.query(
        `UPDATE comm_offsets
        SET last_id=?, updated_at=UTC_TIMESTAMP()
      WHERE source='payment_invoice'`,
        [newId]
    );
}

/**
 * Cancel semua comm_tasks (pending/queued) untuk invoice yang sudah PAID.
 * Pakai SELECT ... FOR UPDATE SKIP LOCKED untuk ambil ID yang aman di-update sekarang.
 */
async function cancelPendingForPaid(conn) {
    const paidUpper = PAID_STATUSES.map(s => s.toUpperCase());
    if (!paidUpper.length) return 0;

    const inList = paidUpper.map(() => '?').join(',');

    // 1) Ambil task id yang eligible untuk di-cancel, skip row yang lagi di-lock worker
    const [rows] = await conn.query(
        `
    SELECT ct.id
      FROM comm_tasks ct
      JOIN payment_invoice pi
        ON (
             ct.job_key = CONCAT('pay:', TRIM(pi.payment_code))
             OR (
               (pi.payment_code IS NULL OR TRIM(pi.payment_code) = '')
               AND ct.job_key = CONCAT('pay:', CAST(pi.id AS CHAR))
             )
           )
     WHERE ct.topic='payment'
       AND ct.status IN ('pending','queued')
       AND UPPER(pi.status) IN (${inList})
     FOR UPDATE SKIP LOCKED
    `,
        paidUpper
    );

    if (!rows.length) return 0;

    // 2) UPDATE by IDs (terhindar dari lock panjang)
    const ids = rows.map(r => r.id);
    const chunkSize = 500;
    let affected = 0;
    for (let i = 0; i < ids.length; i += chunkSize) {
        const part = ids.slice(i, i + chunkSize);
        const [r] = await conn.query(
            `UPDATE comm_tasks
          SET status='canceled',
              last_error='auto-canceled: payment marked PAID'
        WHERE id IN (${part.map(() => '?').join(',')})`,
            part
        );
        affected += r?.affectedRows || 0;
    }

    if (affected) {
        console.log(`[watcher] auto-canceled ${affected} task(s) due to PAID status`);
    }
    return affected;
}

export async function invoiceTick(limit = 200) {
    const conn = await pool.getConnection();
    try {
        // Isolation yang lebih ramah untuk workload read/write campuran
        await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await conn.beginTransaction();
        await conn.query("SET time_zone = '+00:00'");

        // 0) Cancel dulu task untuk invoice yang sudah PAID (real-time, tanpa offset)
        await cancelPendingForPaid(conn);

        // 1) Offset untuk invoice BARU
        const lastId = await getOffset(conn);

        // 2) Ambil invoice baru; expiry_date sudah UTC ISO → ambil apa adanya; ikutkan created_at untuk audit
        const [rows] = await conn.query(
            `SELECT 
         pi.id,
         pi.payment_code,
         pi.payer_email,
         pi.description,
         pi.invoice_url,
         pi.status,
         pi.type AS invoice_type,
         u.name AS user_name,
         p.package_id,
         et.title AS ticket_title,
         pi.expiry_date  AS expiry_utc,
         pi.created_at   AS invoice_created_at
       FROM payment_invoice pi
       LEFT JOIN users u            ON pi.users_id = u.id
       LEFT JOIN payment p          ON p.code_payment = pi.payment_code
       LEFT JOIN events_tickets et  ON et.id = p.package_id
       WHERE pi.id > ?
       ORDER BY pi.id ASC
       LIMIT ?`,
            [lastId, limit]
        );

        if (!rows.length) {
            await conn.commit();
            return 0;
        }

        let maxId = lastId;
        let inserted = 0;
        const now = Date.now();

        // 3) Jadwalkan reminder untuk invoice baru yang eligible
        for (const r of rows) {
            if (r.id > maxId) maxId = r.id;

            const stat = String(r.status || '').toUpperCase();
            if (!ALLOWED_STATUSES.includes(stat)) continue;
            if (!r.payer_email) continue;
            if (!r.expiry_utc) continue;

            const expUtc = parseUtcFlexible(r.expiry_utc);
            if (isNaN(expUtc)) { console.log('[watcher] skip bad expiry', r.id, r.expiry_utc); continue; }

            // Stage awal dinamis: 12h → 3h → 60m → expired
            const t12h = expUtc.getTime() - 12 * 3600 * 1000;
            const t3h = expUtc.getTime() - 3 * 3600 * 1000;
            const t60m = expUtc.getTime() - 60 * 60 * 1000;
            const tExp = expUtc.getTime();

            let firstCode, firstAtMs;
            if (now <= t12h) { firstCode = 'pay_12h'; firstAtMs = t12h; }
            else if (now <= t3h) { firstCode = 'pay_3h'; firstAtMs = t3h; }
            else if (now <= t60m) { firstCode = 'pay_60mins'; firstAtMs = t60m; }
            else if (now < tExp) { firstCode = 'pay_expired'; firstAtMs = tExp; }
            else { continue; } // sudah lewat expired

            const displayName =
                (r.user_name && r.user_name.trim()) ||
                (r.payer_email?.split('@')[0]) ||
                'Guest';

            // Ticket name: events_tickets.title → fallback description
            const ticketPromo =
                (r.ticket_title && r.ticket_title.trim()) ||
                (r.description && r.description.trim()) ||
                'Promotional';

            const payload = {
                name: displayName,
                ticket_promo_name: ticketPromo,
                pay_link: r.invoice_url,
                expired_at: isoZ(expUtc),

                // audit/info tambahan
                invoice_created_at: r.invoice_created_at ? new Date(r.invoice_created_at).toISOString() : null,
                event_date_range: EVENT_DATE_RANGE,

                // untuk template expired
                support_email: SUPPORT_EMAIL,
                support_phone: SUPPORT_PHONE,
                support_phone_e164: SUPPORT_PHONE_E164,

                // meta
                invoice_type: r.invoice_type || 'ticket',
                invoice_code: r.payment_code,
                package_id: r.package_id || null
            };

            const jobKey = `pay:${r.payment_code || r.id}`;
            const scheduleDate = new Date(firstAtMs);

            try {
                // PAKAI KONEKSI/TRANSAKSI YANG SAMA untuk mengurangi lock antar-koneksi
                const ok = await enqueueTask({
                    channel: 'email',
                    to_email: r.payer_email,
                    template_code: firstCode,
                    topic: 'payment',
                    payload,
                    job_key: jobKey,
                    scheduled_at: scheduleDate
                }, conn);

                if (ok) {
                    inserted++;
                    // Uncomment kalau perlu audit:
                    // console.log(`[watcher] enqueue ok id=${r.id} job=${jobKey} code=${firstCode} expiry=${expUtc.toISOString()} schedule=${scheduleDate.toISOString()}`);
                }
            } catch (err) {
                console.error('[invoiceWatcher][enqueueTask]', err?.code || err?.message || err);
            }
        }

        // 4) Majukan offset & commit
        await setOffset(conn, maxId);
        await conn.commit();

        if (inserted) console.log(`[invoiceWatcher] inserted ${inserted} task(s), offset=${maxId}`);
        return inserted;
    } catch (e) {
        try { await conn.rollback(); } catch { }
        console.error('[invoiceWatcher]', e?.code || e?.message || e);
        return 0;
    } finally {
        conn.release();
    }
}
