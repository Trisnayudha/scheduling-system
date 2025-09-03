// src/services/taskService.js
import Handlebars from 'handlebars';
import { tx, pool } from '../db.js';
import { renderEmail, renderWaText } from '../renderer.js';
import { sendEmail } from '../providers/postmarkClient.js';
import { sendWaWebJs } from '../providers/waWebJsClient.js';
import { isPaidByJobKey, isCheckedInByJobKey } from './guards.js';
import { toUtcDatetimeString, parseMaybeWibToUtc } from '../utils/datetime.js';

const PAYMENT_FLOW = ['pay_12h', 'pay_3h', 'pay_60mins', 'pay_expired'];

function safeJson(j) { try { return j ? JSON.parse(j) : null; } catch { return null; } }

function renderSubjectTemplate(subject, payload) {
    try {
        if (!subject) return '(no subject)';
        if (!subject.includes('{{')) return subject;
        const tpl = Handlebars.compile(subject);
        return tpl(payload || {});
    } catch {
        return subject || '(no subject)';
    }
}

/**
 * Idempotent via UNIQUE (job_key, template_code, channel).
 * - connOpt: optional connection/transaction (dipakai watcher untuk kurangi lock).
 * - return true jika INSERT baru, false jika duplicate (sudah ada).
 */
export async function enqueueTask(task, connOpt = null) {
    const {
        channel, to_email = null, to_phone = null,
        template_code, topic = 'general', payload = null,
        job_key, scheduled_at
    } = task;

    const db = connOpt || pool;
    const dtUtc = toUtcDatetimeString(parseMaybeWibToUtc(scheduled_at));
    const payloadStr = payload ? JSON.stringify(payload) : null;

    const [res] = await db.execute(
        `INSERT INTO comm_tasks
       (channel, to_email, to_phone, template_code, topic, payload, job_key, scheduled_at, status)
     VALUES (?,?,?,?,?,?,?,?, 'pending')
     ON DUPLICATE KEY UPDATE job_key=VALUES(job_key)`,
        [channel, to_email, to_phone, template_code, topic, payloadStr, job_key, dtUtc]
    );

    // INSERT baru → 1; duplicate → 2 (MySQL)
    return res.affectedRows === 1;
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
        await conn.query("SET time_zone = '+00:00'");

        const [rows] = await conn.execute(
            `SELECT id, channel, to_email, to_phone, template_code, topic, payload, job_key
         FROM comm_tasks
        WHERE status='pending'
          AND scheduled_at <= UTC_TIMESTAMP()
        ORDER BY scheduled_at ASC, id ASC
        LIMIT ? FOR UPDATE SKIP LOCKED`,
            [limit]
        );

        if (!rows.length) return [];

        const ids = rows.map(r => r.id);
        // Jika kamu punya kolom queued_at, boleh tambahkan: , queued_at=UTC_TIMESTAMP()
        await conn.query(
            `UPDATE comm_tasks
          SET status='queued'
        WHERE status='pending' AND id IN (${ids.map(() => '?').join(',')})`,
            ids
        );

        return rows.map(r => ({ ...r, payload: safeJson(r.payload) }));
    });
}

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
        const subj = renderSubjectTemplate(subject, payload);
        return await sendEmail({ to: to_email, subject: subj, html });
    }

    if (channel === 'whatsapp') {
        const text = await renderWaText(template_ref + '.txt', payload);
        return await sendWaWebJs({ toPhoneE164: to_phone, text });
    }

    throw new Error('Unsupported channel: ' + channel);
}

export async function markSent(id, providerMessageId) {
    await pool.execute(
        `UPDATE comm_tasks
        SET status='sent', sent_at=UTC_TIMESTAMP(), provider_message_id=?
      WHERE id=?`,
        [providerMessageId || null, id]
    );
}

export async function markFailed(id, err) {
    await pool.execute(
        `UPDATE comm_tasks
        SET status='failed', last_error=?
      WHERE id=?`,
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

    const expAt = parseMaybeWibToUtc(expAtStr);
    let nextAt = expAt;
    if (nextCode === 'pay_3h') nextAt = new Date(expAt.getTime() - 3 * 3600 * 1000);
    else if (nextCode === 'pay_60mins') nextAt = new Date(expAt.getTime() - 60 * 60 * 1000);
    else if (nextCode === 'pay_expired') nextAt = expAt;

    const ops = [];
    if (task.to_email) ops.push(enqueueTask({
        channel: 'email', to_email: task.to_email, template_code: nextCode, topic: 'payment',
        payload: task.payload, job_key: task.job_key, scheduled_at: nextAt
    }));
    if (task.to_phone) ops.push(enqueueTask({
        channel: 'whatsapp', to_phone: task.to_phone, template_code: nextCode, topic: 'payment',
        payload: task.payload, job_key: task.job_key, scheduled_at: nextAt
    }));
    await Promise.all(ops);
}

export async function processOne(task) {
    try {
        if (!(await shouldSend(task))) {
            await pool.execute(`UPDATE comm_tasks SET status='canceled' WHERE id=?`, [task.id]);
            return;
        }
        const res = await sendTask(task);
        await markSent(task.id, res?.providerMessageId);
        if (task.template_code.startsWith('pay_')) await chainPaymentIfNeeded(task);
    } catch (err) {
        await markFailed(task.id, err);
    }
}
