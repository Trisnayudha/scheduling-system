require('dotenv').config();
const express = require('express');
const sequelize = require('../config/database');
const routes = require('./routes');
const { startPoller } = require('./poller');

const app = express();
app.use(express.json());
app.use('/api', routes);

(async () => {
    try {
        await sequelize.authenticate();
        // ensure tables exist
        require('../models/Template');
        require('../models/Campaign');
        require('../models/CampaignRecipient');
        await sequelize.sync();

        const port = process.env.PORT || 3000;
        app.listen(port, () => console.log(`🚀 API http://localhost:${port}`));

        startPoller(Number(process.env.POLL_INTERVAL_MS || 15000));
        console.log('✅ Listener ready');
    } catch (e) {
        console.error('DB init error:', e);
        process.exit(1);
    }
})();
