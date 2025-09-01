import 'dotenv/config';
import pLimit from 'p-limit';
import { pickPendingBatch, processOne } from './services/taskService.js';
import { invoiceTick } from './services/invoiceWatcher.js';
import { initWaWebJs } from './providers/waWebJsClient.js'; // kalau pakai WA device

const SEND_INTERVAL = Number(process.env.POLL_INTERVAL_MS || 15000);
const INVOICE_SCAN = Number(process.env.INVOICE_SCAN_MS || 30000);
const BATCH = Number(process.env.PICK_BATCH_SIZE || 100);
const CONC = Number(process.env.WORKER_CONCURRENCY || 5);
const limit = pLimit(CONC);

// opsional: munculkan QR saat start
if (process.env.WA_USE_WEBJS === 'true') {
    initWaWebJs().catch(err => console.error('[wa-webjs] init error:', err?.message || err));
}

async function sendTick() {
    try {
        const tasks = await pickPendingBatch(BATCH);
        if (tasks.length) {
            console.log(`[worker] picked ${tasks.length} task(s)`);
            await Promise.all(tasks.map(t => limit(() => processOne(t))));
        }
    } catch (e) { console.error('[sendTick]', e?.message || e); }
}

async function watchTick() {
    try {
        await invoiceTick(Number(process.env.INVOICE_SCAN_LIMIT || 200));
    } catch (e) { console.error('[watchTick]', e?.message || e); }
}

console.log(`Comm Worker started. send=${SEND_INTERVAL}ms, watch=${INVOICE_SCAN}ms`);
setInterval(sendTick, SEND_INTERVAL);
setInterval(watchTick, INVOICE_SCAN);
