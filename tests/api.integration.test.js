import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import worker from '../src/worker.js';

class LocalD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec(readFileSync(resolve('migrations/0001_stage1_prototype.sql'), 'utf8'));
    this.db.exec(readFileSync(resolve('migrations/0002_core_management.sql'), 'utf8'));
  }
  prepare(sql) {
    const owner = this;
    const statement = { sql, params: [] };
    return {
      bind(...params) { statement.params = params; return this; },
      async first() {
        const row = owner.db.prepare(statement.sql).get(...statement.params);
        return row ? { ...row } : null;
      },
      async all() {
        const rows = owner.db.prepare(statement.sql).all(...statement.params).map((row) => ({ ...row }));
        return { results: rows, success: true, meta: { changes: rows.length } };
      },
      async run() {
        const result = owner.db.prepare(statement.sql).run(...statement.params);
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } };
      },
      _statement: statement,
    };
  }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = statements.map((item) => {
        const s = item._statement;
        const result = this.db.prepare(s.sql).run(...s.params);
        return { success: true, meta: { changes: Number(result.changes) } };
      });
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

const TOKEN = 'T'.repeat(48);
const db = new LocalD1();
const env = { DB: db, ADMIN_TOKEN: TOKEN };
async function call(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (auth) headers['x-admin-token'] = TOKEN;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return worker.fetch(new Request(`https://test.example${path}`, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
}

test('API end-to-end: creates, updates, lists, segments and deletes without duplicates', async () => {
  let response = await call('/api/leads', { method: 'POST', body: {
    telegram_id: '5000001', username: 'test_lead', first_name: 'Test', last_name: 'User',
    source: 'manual', quality: 'high', status: 'new', notes: 'Integration check',
  } });
  assert.equal(response.status, 201);
  let created = await response.json();
  assert.equal(created.action, 'created');
  const leadId = created.item.id;
  assert.equal(created.item.telegram_id, '5000001');
  assert.equal(created.item.notes, 'Integration check');

  response = await call('/api/leads', { method: 'POST', body: {
    telegram_id: '5000001', username: 'test_lead_2', first_name: 'Updated',
    source: 'manual', quality: 'medium', status: 'in_progress', notes: 'Updated note',
  } });
  const duplicate = await response.json();
  assert.equal(response.status, 200);
  assert.equal(duplicate.action, 'updated');
  assert.equal(duplicate.item.id, leadId);
  assert.equal(duplicate.item.notes, 'Updated note');

  response = await call('/api/leads', { method: 'POST', body: {
    telegram_id: '5000002', username: 'second_lead', first_name: 'Second', source: 'manual', quality: 'low', status: 'new',
  } });
  assert.equal(response.status, 201);
  const secondLeadId = (await response.json()).item.id;

  response = await call('/api/segments', { method: 'POST', body: { name: 'Integration segment', description: 'Test', color: '#78A9C8' } });
  assert.equal(response.status, 201);
  const segment = (await response.json()).item;

  response = await call(`/api/segments/${segment.id}/members`, { method: 'POST', body: { operation: 'add', lead_ids: [leadId] } });
  assert.equal(response.status, 200);

  response = await call(`/api/leads/${leadId}`);
  const detail = (await response.json()).item;
  assert.equal(detail.segments.length, 1);
  assert.equal(detail.segments[0].name, 'Integration segment');

  response = await call('/api/leads?q=Updated&segment_id=' + segment.id + '&page=1&page_size=25');
  const list = await response.json();
  assert.equal(response.status, 200);
  assert.equal(list.pagination.total, 1);
  assert.equal(list.items[0].id, leadId);

  response = await call('/api/leads/' + leadId, { method: 'PATCH', body: { status: 'qualified', quality: 'high' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).item.status, 'qualified');

  response = await call(`/api/segments/${segment.id}`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  response = await call(`/api/leads/${leadId}`);
  const afterSegmentDelete = (await response.json()).item;
  assert.equal(afterSegmentDelete.telegram_id, '5000001');
  assert.equal(afterSegmentDelete.segments.length, 0);

  response = await call('/api/leads/bulk', { method: 'POST', body: { ids: [secondLeadId], action: 'delete' } });
  assert.equal(response.status, 200);
  response = await call(`/api/leads/${leadId}`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  response = await call('/api/activity');
  assert.equal(response.status, 200);
  assert.ok((await response.json()).items.length > 0);
  response = await call('/api/leads?q=5000001');
  assert.equal((await response.json()).pagination.total, 0);
});

test('API enforces admin token and validates Telegram IDs', async () => {
  let response = await call('/api/leads', { auth: false });
  assert.equal(response.status, 401);
  response = await call('/api/leads', { method: 'POST', body: { telegram_id: 'not-a-number' } });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_telegram_id');
});
