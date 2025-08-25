const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Template = sequelize.define('Template', {
    name: { type: DataTypes.STRING, allowNull: false, unique: true }, // ex: WELCOME_EMAIL
    type: { type: DataTypes.ENUM('EMAIL', 'WHATSAPP', 'BOTH'), allowNull: false },

    // EMAIL
    subject: DataTypes.STRING,
    emailFile: DataTypes.STRING,        // ex: welcome.hbs (templates/email/)
    messageStream: DataTypes.STRING,    // opsional override stream

    // WHATSAPP
    whatsappModule: DataTypes.STRING    // ex: welcome.js (templates/whatsapp/)
}, { tableName: 'templates' });

module.exports = Template;
