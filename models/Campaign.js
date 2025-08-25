const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Campaign = sequelize.define('Campaign', {
    name: DataTypes.STRING,
    mode: { type: DataTypes.ENUM('IMMEDIATE', 'ONCE', 'CRON'), defaultValue: 'IMMEDIATE' },
    sendAt: DataTypes.DATE,      // untuk ONCE
    cron: DataTypes.STRING,      // untuk CRON (opsional)
    timezone: DataTypes.STRING,
    templateId: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'DONE'), defaultValue: 'ACTIVE' }
}, { tableName: 'campaigns' });

module.exports = Campaign;
