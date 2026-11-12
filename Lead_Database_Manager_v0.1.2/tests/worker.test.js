import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const fakeDB = {
  prepare(sql) {
    return {
      first: async () => sql.includes('COUNT(*)') ? { total: 4 } : null,
    };
  },
};

test('health endpoint reports Worker, D1 and Telegram configuration', async () => {
  const response = await worker.fetch(new Request('https://example.workers.dev/api/health'), {
    DB: fakeDB,
    ADMIN_TOKEN: 'K'.repeat(48),
    TELEGRAM_BOT_TOKEN: 'test-token-not-used',
    TELEGRAM_WEBHOOK_SECRET: 'A'.repeat(40),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.checks.worker, 'ok');
  assert.equal(body.checks.database, 'connected');
  assert.equal(body.checks.telegram, 'configured');
  assert.equal(body.checks.admin_auth, 'configured');
  assert.equal(body.leads_count, 4);
});

test('auth config endpoint does not disclose the admin secret', async () => {
  const response = await worker.fetch(new Request('https://example.workers.dev/api/auth/config'), { ADMIN_TOKEN: 'K'.repeat(48) });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.admin_token_configured, true);
  assert.equal(JSON.stringify(body).includes('K'.repeat(48)), false);
});

test('admin token validation accepts only exact configured secret', async () => {
  const env = { ADMIN_TOKEN: 'K'.repeat(48) };
  const ok = await worker.fetch(new Request('https://example.workers.dev/api/auth/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'K'.repeat(48) }),
  }), env);
  const bad = await worker.fetch(new Request('https://example.workers.dev/api/auth/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'wrong' }),
  }), env);
  assert.equal(ok.status, 200);
  assert.equal(bad.status, 401);
});

test('protected API rejects requests without admin token', async () => {
  const response = await worker.fetch(new Request('https://example.workers.dev/api/leads'), { ADMIN_TOKEN: 'K'.repeat(48), DB: fakeDB });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'unauthorized');
});

test('protected API explains when admin token is not configured', async () => {
  const response = await worker.fetch(new Request('https://example.workers.dev/api/leads'), { DB: fakeDB });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'admin_token_not_configured');
});

test('webhook rejects requests without Telegram secret header', async () => {
  const response = await worker.fetch(new Request('https://example.workers.dev/api/telegram/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ update_id: 1 }),
  }), {
    DB: fakeDB, TELEGRAM_BOT_TOKEN: 'test-token-not-used', TELEGRAM_WEBHOOK_SECRET: 'A'.repeat(40),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'unauthorized');
});

test('webhook setup rejects an incorrect setup token before calling Telegram', async () => {
  const response = await worker.fetch(new Request('https://example.workers.dev/api/setup/telegram-webhook', {
    method: 'POST', headers: { 'x-setup-token': 'wrong-token' },
  }), {
    DB: fakeDB, SETUP_TOKEN: 'S'.repeat(40), TELEGRAM_BOT_TOKEN: 'test-token-not-used', TELEGRAM_WEBHOOK_SECRET: 'A'.repeat(40),
  });
  assert.equal(response.status, 401);
});
