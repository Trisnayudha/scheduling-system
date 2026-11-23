import crypto from 'node:crypto';
import Handlebars from 'handlebars';
import { pool } from '../db.js';
import { enqueueTask } from './taskService.js';
import { parseMaybeWibToUtc } from '../utils/datetime.js';

export const EXHIBITION_REMINDERS = [
    { code: 'exhibition_12h', offset: 12 * 60 * 60 * 1000, subject: 'Additional Order Payment Reminder: {{invoice_code}}' },
    { code: 'exhibition_60mins', offset: 60 * 60 * 1000, subject: 'Additional Order Payment Reminder: {{invoice_code}}' },
    { code: 'exhibition_expired', offset: 0, subject: 'Additional Order Payment Reminder: {{invoice_code}}' }
];

export function recipients(row) {
    const pic = String(row.pic_email || '').trim() || String(row.email_alternate || '').trim();
    const unique = new Map();
    for (const value of [pic, String(row.email || '').trim()]) {
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) unique.set(value.toLowerCase(), value);
    }
    return [...unique.values()];
}

export function buildTasks(row, now = Date.now()) {
    const due = parseMaybeWibToUtc(row.due_local);
    if (!Number.isFinite(due.getTime()) || due.getTime() <= now || !row.link) return [];
    const safe = value => Handlebars.escapeExpression(String(value || ''));
    const tasks = [];
    for (const email of recipients(row)) {
        const digest = crypto.createHash('sha256').update(`${email.toLowerCase()}\0${row.due_local}\0${row.link}`).digest('hex').slice(0, 24);
        for (const reminder of EXHIBITION_REMINDERS) {
            const at = due.getTime() - reminder.offset;
            if (at <= now) continue;
            tasks.push({
                channel: 'email', to_email: email, template_code: reminder.code,
                topic: 'exhibition_payment', job_key: `exhibition:${row.id}:${digest}`,
                scheduled_at: new Date(at),
                payload: { payment_id: row.id, due_local: row.due_local, payment_link: row.link,
                    name: safe(row.company_name || row.name || 'Customer'),
                    invoice_code: safe(row.code_payment),
                    pay_link: safe(reminder.offset === 0 ? (process.env.EXHIBITION_PORTAL_INVOICE_URL || 'https://portal.indonesiaminer.com/invoice') : row.link),
                    }
            });
        }
    }
    return tasks;
}

export async function exhibitionInvoiceTick() {
    // Unlike ticket invoices, an exhibitor may choose a payment method after checkout.
    // Re-scan eligible invoices so a late-created payment link is never missed.
    const conn = await pool.getConnection();
    let locked = false;
    try {
        const [locks] = await conn.query("SELECT GET_LOCK('exhibition_reminder_watcher', 0) AS acquired");
        locked = Number(locks[0]?.acquired) === 1;
        if (!locked) return 0;
        const [rows] = await conn.query(`
            SELECT ep.id, ep.code_payment, ep.link,
                   DATE_FORMAT(ep.invoice_due_date, '%Y-%m-%d %H:%i:%s') AS due_local,
                   c.name, c.company_name, c.email, c.pic_email, c.email_alternate
              FROM exhibition_payment ep
              JOIN company c ON c.id = (SELECT ecl.company_id FROM exhibition_cart_list ecl
                                         WHERE ecl.payment_id = ep.id ORDER BY ecl.id LIMIT 1)
             WHERE LOWER(ep.status) = 'unpaid' AND ep.link IS NOT NULL AND ep.link <> ''
               AND ep.invoice_due_date IS NOT NULL
               AND ep.invoice_due_date > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR)`);
        let count = 0;
        for (const row of rows) {
            for (const task of buildTasks(row)) {
                // The existing unique index covers only pending tasks. Check all statuses
                // while holding a shared DB lock to avoid resending already-sent reminders.
                const [existing] = await conn.execute(
                    'SELECT id FROM comm_tasks WHERE job_key = ? AND template_code = ? AND channel = ? LIMIT 1',
                    [task.job_key, task.template_code, task.channel]
                );
                if (!existing.length && await enqueueTask(task, conn)) count++;
            }
        }
        if (count) console.log(`[exhibitionReminder] scheduled ${count} reminder(s)`);
        return count;
    } finally {
        try {
            if (locked) await conn.query("SELECT RELEASE_LOCK('exhibition_reminder_watcher')");
        } finally { conn.release(); }
    }
}

export async function shouldSendExhibitionReminder(task) {
    const payload = task.payload || {};
    if (!Number.isSafeInteger(Number(payload.payment_id)) || !payload.payment_link || !payload.due_local) return false;
    const [rows] = await pool.execute(`SELECT ep.status, ep.link,
        DATE_FORMAT(ep.invoice_due_date, '%Y-%m-%d %H:%i:%s') AS due_local,
        c.email, c.pic_email, c.email_alternate
        FROM exhibition_payment ep
        JOIN company c ON c.id = (SELECT ecl.company_id FROM exhibition_cart_list ecl
            WHERE ecl.payment_id = ep.id ORDER BY ecl.id LIMIT 1)
        WHERE ep.id = ? LIMIT 1`, [payload.payment_id]);
    const invoice = rows[0];
    return Boolean(invoice && String(invoice.status).toLowerCase() === 'unpaid' &&
        invoice.link === payload.payment_link && invoice.due_local === payload.due_local &&
        recipients(invoice).some(email => email.toLowerCase() === String(task.to_email || '').toLowerCase()));
}
