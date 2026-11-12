import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const fakeDB = {
  prepare(sql) {
    return {
      first: async () => {
        if (sql.includes('COUNT(*)')) return { total: 4 };
        return null;
      },
    };
  },
};

test('health endpoint reports Worker, D1 and Telegram configuration', async () => {
  const response = await worker.fetch(new Request('https://example.workers.dev/api/health'), {
    DB: fakeDB,
    TELEGRAM_BOT_TOKEN: 'test-token-not-used',
    TELEGRAM_WEBHOOK_SECRET: 'A'.repeat(40),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.checks.worker, 'ok');
  assert.equal(body.checks.database, 'connected');
  assert.equal(body.checks.telegram, 'configured');
  assert.equal(body.leads_count, 4);
});

test('webhook rejects requests without Telegram secret header', async () => {
  const response = await worker.fetch(new Request('https://example.workers.dev/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ update_id: 1 }),
  }), {
    DB: fakeDB,
    TELEGRAM_BOT_TOKEN: 'test-token-not-used',
    TELEGRAM_WEBHOOK_SECRET: 'A'.repeat(40),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'unauthorized');
});

test('webhook setup rejects an incorrect setup token before calling Telegram', async () => {
  const response = await worker.fetch(new Request('https://example.workers.dev/api/setup/telegram-webhook', {
    method: 'POST',
    headers: { 'x-setup-token': 'wrong-token' },
  }), {
    DB: fakeDB,
    SETUP_TOKEN: 'S'.repeat(40),
    TELEGRAM_BOT_TOKEN: 'test-token-not-used',
    TELEGRAM_WEBHOOK_SECRET: 'A'.repeat(40),
  });
  assert.equal(response.status, 401);
});
