const { queue } = require('./queue');
const Campaign = require('../models/Campaign');
const CampaignRecipient = require('../models/CampaignRecipient');

async function tick() {
    const recs = await CampaignRecipient.findAll({ where: { state: 'PENDING' }, limit: 200 });
    for (const r of recs) {
        const camp = await Campaign.findByPk(r.campaignId);
        if (!camp || camp.status !== 'ACTIVE') continue;

        const opts = { attempts: 3, backoff: { type: 'exponential', delay: 5000 } };
        if (r.scheduledAt) opts.delay = Math.max(0, new Date(r.scheduledAt) - Date.now());
        else if (camp.mode === 'ONCE' && camp.sendAt) opts.delay = Math.max(0, new Date(camp.sendAt) - Date.now());

        await queue.add('send', { templateId: camp.templateId, recipientId: r.id }, opts);
        await r.update({ state: 'SCHEDULED' });
    }
}

function startPoller(intervalMs) {
    console.log(`⏱️ poller every ${intervalMs}ms`);
    tick().catch(console.error);
    return setInterval(() => tick().catch(console.error), intervalMs);
}
module.exports = { startPoller };
