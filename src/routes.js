const express = require('express');
const CampaignRecipient = require('../models/CampaignRecipient');
const router = express.Router();

router.get('/health', (_req, res) => res.json({ ok: true }));
router.get('/recipients', async (_req, res) => {
    const rows = await CampaignRecipient.findAll({ limit: 100, order: [['id', 'DESC']] });
    res.json(rows);
});
module.exports = router;
