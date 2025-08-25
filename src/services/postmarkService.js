const postmark = require('postmark');
require('dotenv').config();

const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

async function sendEmail({ to, subject, html, messageStream }) {
    const stream = messageStream || process.env.POSTMARK_MESSAGE_STREAM_DEFAULT || 'outbound';
    const From = process.env.FROM_EMAIL || 'noreply@example.com';
    const r = await client.sendEmail({ From, To: to, Subject: subject || '(no subject)', HtmlBody: html || '', MessageStream: stream });
    return r.MessageID;
}
module.exports = { sendEmail };
