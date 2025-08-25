// src/queue.js
const { Queue } = require('bullmq');     // ⬅️ cukup Queue saja
const IORedis = require('ioredis');
require('dotenv').config();

const connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

const queue = new Queue('message-queue', { connection });

module.exports = { queue, connection };
