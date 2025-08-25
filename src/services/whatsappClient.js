const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const waClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});
waClient.on('qr', qr => { console.log('📲 Scan QR ini:'); qrcode.generate(qr, { small: true }); });
waClient.on('ready', () => console.log('✅ WhatsApp ready'));
waClient.on('disconnected', r => console.log('❌ WhatsApp disconnected:', r));
waClient.initialize();

module.exports = waClient;
