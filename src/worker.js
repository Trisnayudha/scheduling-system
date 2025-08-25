const { Worker } = require('bullmq');
const { connection } = require('./queue');
const { sendEmail } = require('./services/postmarkService');
const { sendWhatsapp } = require('./services/whatsappService');
const { renderEmail, renderWhatsapp } = require('./services/templateEngine');
const Template = require('../models/Template');
const CampaignRecipient = require('../models/CampaignRecipient');

const worker = new Worker('message-queue', async (job) => {
    const { templateId, recipientId } = job.data;
    const [tpl, rec] = await Promise.all([
        Template.findByPk(templateId),
        CampaignRecipient.findByPk(recipientId)
    ]);
    if (!tpl || !rec) throw new Error('Template/Recipient not found');

    try {
        if (tpl.type === 'EMAIL') {
            const html = renderEmail(tpl.emailFile, rec.variables || {});
            await sendEmail({ to: rec.email, subject: tpl.subject || '(no subject)', html, messageStream: tpl.messageStream });
        } else if (tpl.type === 'WHATSAPP') {
            const text = renderWhatsapp(tpl.whatsappModule, rec.variables || {});
            await sendWhatsapp({ to: rec.phone, message: text });
        } else {
            const html = renderEmail(tpl.emailFile, rec.variables || {});
            const text = renderWhatsapp(tpl.whatsappModule, rec.variables || {});
            await sendEmail({ to: rec.email, subject: tpl.subject || '(no subject)', html, messageStream: tpl.messageStream });
            await sendWhatsapp({ to: rec.phone, message: text });
        }
        await rec.update({ state: 'SENT', lastError: null });
    } catch (e) {
        await rec.update({ state: 'FAILED', lastError: String(e?.message || e) });
        throw e;
    }
}, { connection });

worker.on('completed', j => console.log(`✅ worker: job ${j.id} done`));
worker.on('failed', (j, err) => console.error(`❌ worker: job ${j?.id} failed`, err.message));
