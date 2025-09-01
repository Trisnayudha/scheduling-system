import { tx, pool } from '../db.js';
import { renderEmail, renderWaText } from '../renderer.js';
import { sendEmail } from '../providers/postmarkClient.js';
import { sendWaWebJs } from '../providers/waWebJsClient.js';
import { isPaidByJobKey, isCheckedInByJobKey } from './guards.js';

const PAYMENT_FLOW = ['pay_12h', 'pay_3h', 'pay_expired'];

export async function enqueueTask(task) {
    const {
        channel, to_email = null, to_phone = null,
        template_code, topic = 'general', payload = null,
        job_key, scheduled_at
    } = task;

    await pool.execute(
        `INSERT INTO comm_tasks
     (channel, to_email, to_phone, template_code, topic, payload, job_key, scheduled_at)
     VALUES (?,?,?,?,?,?,?,?)`,
        [channel, to_email, to_phone, template_code, topic, payload ? JSON.stringify(payload) : null, job_key, toDate(scheduled_at)]
    );
}

function toDate(d) {
    // Terima string/Date → simpan sebagai UTC
    const dt = (d instanceof Date) ? d : new Date(d);
    return new Date(dt.toISOString().replace('Z', '')); // mysql DATETIME (tanpa zona) assumed UTC
}

export async function cancelByJobKey(jobKey) {
    const [res] = await pool.execute(
        `UPDATE comm_tasks
     SET status='canceled'
     WHERE job_key=? AND status IN ('pending','queued')`,
        [jobKey]
    );
    return res.affectedRows;
}

export async function pickPendingBatch(limit = 100) {
    return tx(async (conn) => {
        const [rows] = await conn.execute(
            `SELECT id, channel, to_email, to_phone, template_code, topic, payload, job_key
       FROM comm_tasks
       WHERE status='pending' AND scheduled_at <= UTC_TIMESTAMP()
       ORDER BY scheduled_at ASC
       LIMIT ? FOR UPDATE SKIP LOCKED`,
            [limit]
        );
        if (!rows.length) return [];
        const ids = rows.map(r => r.id);
        await conn.query(
            `UPDATE comm_tasks SET status='queued' WHERE id IN (${ids.map(() => '?').join(',')})`,
            ids
        );
        return rows.map(r => ({ ...r, payload: safeJson(r.payload) }));
    });
}

function safeJson(j) { try { return j ? JSON.parse(j) : null; } catch { return null; } }

async function resolveTemplate(code, channel) {
    const [rows] = await pool.execute(
        `SELECT template_ref, subject FROM comm_templates
     WHERE code=? AND channel=? AND active=1 LIMIT 1`,
        [code, channel]
    );
    if (!rows.length) throw new Error(`Template not found: ${code}/${channel}`);
    return rows[0];
}

async function shouldSend(task) {
    if (task.topic === 'payment' && await isPaidByJobKey(task.job_key)) return false;
    if (task.topic === 'event' && await isCheckedInByJobKey(task.job_key)) return false;
    return true;
}

async function sendTask(task) {
    const { template_code, channel, to_email, to_phone, payload } = task;
    const { template_ref, subject } = await resolveTemplate(template_code, channel);

    if (channel === 'email') {
        const html = await renderEmail(template_ref, payload);
        return await sendEmail({ to: to_email, subject: subject || '(no subject)', html });
    }

    if (channel === 'whatsapp') {
        // Pilihan 1: WA Cloud (butuh WA_CLOUD_TOKEN & WA_CLOUD_PHONE_ID)
        try {
            return await sendWaCloudTemplate({ toPhoneE164: to_phone, templateRef: template_ref, language: 'id', payload });
        } catch {
            // Pilihan 2: fallback ke wa-webjs (text file)
            const text = await renderWaText(template_ref + '.txt', payload);
            return await sendWaWebJs({ toPhoneE164: to_phone, text });
        }
    }

    throw new Error('Unsupported channel: ' + channel);
}

export async function markSent(id, providerMessageId) {
    await pool.execute(
        `UPDATE comm_tasks SET status='sent', sent_at=UTC_TIMESTAMP(), provider_message_id=? WHERE id=?`,
        [providerMessageId || null, id]
    );
}

export async function markFailed(id, err) {
    await pool.execute(
        `UPDATE comm_tasks SET status='failed', last_error=? WHERE id=?`,
        [String(err?.message || err), id]
    );
}

export async function chainPaymentIfNeeded(task) {
    if (task.topic !== 'payment') return;
    const idx = PAYMENT_FLOW.indexOf(task.template_code);
    if (idx === -1 || idx === PAYMENT_FLOW.length - 1) return;
    if (await isPaidByJobKey(task.job_key)) return;

    const nextCode = PAYMENT_FLOW[idx + 1];
    const expAtStr = task.payload?.expired_at;
    if (!expAtStr) return;
    const expAt = new Date(expAtStr);
    const nextAt =
        nextCode === 'pay_3h' ? new Date(expAt.getTime() - 3 * 3600 * 1000) :
            nextCode === 'pay_expired' ? expAt : expAt;

    const ops = [];
    if (task.to_email) ops.push(enqueueTask({ channel: 'email', to_email: task.to_email, template_code: nextCode, topic: 'payment', payload: task.payload, job_key: task.job_key, scheduled_at: nextAt }));
    if (task.to_phone) ops.push(enqueueTask({ channel: 'whatsapp', to_phone: task.to_phone, template_code: nextCode, topic: 'payment', payload: task.payload, job_key: task.job_key, scheduled_at: nextAt }));
    await Promise.all(ops);
}

export async function processOne(task) {
    try {
        if (!(await shouldSend(task))) {
            await pool.execute(`UPDATE comm_tasks SET status='canceled' WHERE id=?`, [task.id]);
            return;
        }
        const res = await sendTask(task);
        await markSent(task.id, res.providerMessageId);
        if (task.template_code.startsWith('pay_')) await chainPaymentIfNeeded(task);
    } catch (err) {
        await markFailed(task.id, err);
    }
}
