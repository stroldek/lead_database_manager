import test from 'node:test';
import assert from 'node:assert/strict';
import { mtprotoRoutes } from './mtproto-api.js';

test('MTProto routes ignore unrelated paths', async () => {
  assert.equal(await mtprotoRoutes(new Request('https://x.test/api/leads'), {}, '/api/leads'), null);
});

test('MTProto routes require admin auth before contacting the Durable Object', async () => {
  const response = await mtprotoRoutes(new Request('https://x.test/api/mtproto/status'), { ADMIN_TOKEN: 'a'.repeat(40) }, '/api/mtproto/status');
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: 'unauthorized' });
});

test('MTProto routes report missing DO binding', async () => {
  const token = 'A'.repeat(40);
  const response = await mtprotoRoutes(new Request('https://x.test/api/mtproto/status', { headers: { 'x-admin-token': token } }), { ADMIN_TOKEN: token }, '/api/mtproto/status');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'durable_object_binding_missing');
});
