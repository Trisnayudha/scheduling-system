// src/providers/waWebJsClient.js
import qrcode from 'qrcode-terminal';
import pkg from 'whatsapp-web.js';           // CJS → default import
const { Client, LocalAuth } = pkg;

let client;
let ready = false;
let initPromise;

function toWid(e164) {
    const num = String(e164).replace(/\D/g, '');
    return `${num}@c.us`;
}

function buildClient() {
    return new Client({
        authStrategy: new LocalAuth({
            clientId: process.env.WA_CLIENT_ID || 'im26',
            dataPath: process.env.WA_DATA_DIR || '.wwebjs_auth'
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        }
    });
}

export function initWaWebJs() {
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve, reject) => {
        const c = buildClient();

        c.on('qr', (qr) => {
            console.log('[wa-webjs] Scan QR ini (WhatsApp > Linked devices > Link a device):');
            qrcode.generate(qr, { small: true });
        });

        c.on('authenticated', () => console.log('[wa-webjs] authenticated'));
        c.on('auth_failure', (m) => console.error('[wa-webjs] auth_failure:', m));
        c.on('ready', () => {
            ready = true;
            console.log('[wa-webjs] ready');
            resolve(c);
        });
        c.on('disconnected', (reason) => {
            ready = false;
            console.warn('[wa-webjs] disconnected:', reason, '— reinit 5s...');
            setTimeout(() => { initPromise = null; initWaWebJs().catch(() => { }); }, 5000);
        });

        c.initialize().catch(reject);
        client = c;
    });

    return initPromise;
}

export async function sendWaWebJs({ toPhoneE164, text }) {
    if (!ready) await initWaWebJs();          // pastikan init
    const wid = toWid(toPhoneE164);
    const res = await client.sendMessage(wid, text);
    return { ok: true, providerMessageId: res.id?._serialized || String(Date.now()) };
}
