import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { renderEmail } from '../src/renderer.js';
import { buildTasks, shouldSendExhibitionReminder, exhibitionInvoiceTick, EXHIBITION_REMINDERS } from '../src/services/exhibitionReminder.js';

const row = { id: 12, code_payment: 'INV-12', name: 'Example', email: 'LOGIN@example.com', pic_email: 'pic@example.com', due_local: '2026-11-18 12:00:00', link: 'https://example.test/pay' };
const now = Date.parse('2026-11-17T05:00:00Z');
test('schedules 12-hour, one-hour and expiry reminders for distinct recipients', () => {
  const tasks = buildTasks(row, now);
  assert.equal(tasks.length, 6);
  assert.deepEqual(tasks.slice(0, 3).map(t => t.scheduled_at.toISOString()), ['2026-11-17T17:00:00.000Z', '2026-11-18T04:00:00.000Z', '2026-11-18T05:00:00.000Z']);
  assert.equal(new Set(tasks.map(t => t.job_key)).size, 2);
  assert.match(tasks[2].payload.pay_link, /\/invoice$/);
});
test('deduplicates emails and skips past stages or expired invoices', () => {
  const same = { ...row, pic_email: ' login@EXAMPLE.com ' };
  assert.equal(buildTasks(same, now).length, 3);
  assert.equal(buildTasks(same, Date.parse('2026-11-18T04:30:00Z')).length, 1);
  assert.equal(buildTasks(same, Date.parse('2026-11-18T05:01:00Z')).length, 0);
});
test('checks payment status, recipient and payment session immediately before sending', async () => {
  const task = buildTasks(row, now)[0];
  const original = pool.execute;
  try {
    pool.execute = async () => [[{ ...row, status: 'unpaid' }]];
    assert.equal(await shouldSendExhibitionReminder(task), true);
    pool.execute = async () => [[{ ...row, status: 'paid' }]];
    assert.equal(await shouldSendExhibitionReminder(task), false);
    pool.execute = async () => [[{ ...row, status: 'unpaid', link: 'https://new.example/pay' }]];
    assert.equal(await shouldSendExhibitionReminder(task), false);
    pool.execute = async () => [[{ ...row, status: 'unpaid', pic_email: 'new@example.com' }]];
    assert.equal(await shouldSendExhibitionReminder(task), false);
  } finally { pool.execute = original; }
});

test('does not reschedule reminders already sent on a later scan', async () => {
  const oldGet = pool.getConnection;
  const existing = new Set();
  const tomorrow = new Date(Date.now() + 86400000 + 7 * 3600000).toISOString().slice(0,19).replace('T', ' ');
  const current = { ...row, due_local: tomorrow, pic_email: row.email };
  const conn = {
    async query(sql) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('RELEASE_LOCK')) return [[{}]];
      return [[current]];
    },
    async execute(sql, args) {
      if (sql.startsWith('SELECT id')) return [existing.has(args.join('|')) ? [{id: 1}] : []];
      const key = [args[6], args[3], args[0]].join('|');
      existing.add(key);
      return [{ affectedRows: 1 }];
    },
    release() {}
  };
  pool.getConnection = async () => conn;
  try {
    assert.equal(await exhibitionInvoiceTick(), 3);
    assert.equal(await exhibitionInvoiceTick(), 0);
  } finally { pool.getConnection = oldGet; }
});

test('each reminder uses its own renderable template and wording', async () => {
  const tasks = buildTasks(row, now).slice(0, 3);
  const words = ['12 hours', '60 minutes', 'payment link has now expired'];
  assert.equal(new Set(EXHIBITION_REMINDERS.map(r => r.code)).size, 3);
  for (let i = 0; i < tasks.length; i++) {
    const html = await renderEmail(`${tasks[i].template_code}.hbs`, tasks[i].payload);
    assert.ok(html.includes(words[i]));
    assert.ok(html.includes('INV-12'));
    assert.ok(!html.includes('{{'));
  }
});
