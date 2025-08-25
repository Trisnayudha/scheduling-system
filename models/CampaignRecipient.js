const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CampaignRecipient = sequelize.define('CampaignRecipient', {
    campaignId: { type: DataTypes.INTEGER, allowNull: false },
    email: DataTypes.STRING,
    phone: DataTypes.STRING,
    variables: DataTypes.JSON,     // {name:"Yudha",...}
    scheduledAt: DataTypes.DATE,   // kalau masing2 penerima beda jam
    state: {
        type: DataTypes.ENUM('PENDING', 'SCHEDULED', 'SENT', 'FAILED'),
        defaultValue: 'PENDING'
    },
    lastError: DataTypes.TEXT
}, {
    tableName: 'campaign_recipients',
    indexes: [{ fields: ['campaignId'] }, { fields: ['state'] }]
});

module.exports = CampaignRecipient;
