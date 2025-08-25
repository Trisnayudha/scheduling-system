const waClient = require('./whatsappClient');

async function sendWhatsapp({ to, message }) {
    const chatId = to.includes('@c.us') ? to : `${to}@c.us`; // 628xx...@c.us
    const msg = await waClient.sendMessage(chatId, message);
    return msg.id.id;
}
module.exports = { sendWhatsapp };
