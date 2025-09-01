import postmark from 'postmark';

const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);
const stream = process.env.POSTMARK_MESSAGE_STREAM_DEFAULT?.trim() || 'outbound';
const FROM = process.env.FROM_EMAIL; // "Indonesia Miner <no-reply@...>"

export async function sendEmail({ to, subject, html }) {
    const res = await client.sendEmail({
        From: FROM,
        To: to,
        Subject: subject,
        HtmlBody: html,
        MessageStream: stream
    });
    return { ok: true, providerMessageId: res.MessageID };
}
