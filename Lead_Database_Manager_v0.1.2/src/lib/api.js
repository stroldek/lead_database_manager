import { authRoutes, isAdminAuthorized } from './auth.js';
import { getDatabaseStatus, getLeadWithSegments, logActivity } from './db.js';
import { fail, json, makeId, readJson, safeText, validDate } from './http.js';

const STATUSES = new Set(['new', 'in_progress', 'processed', 'qualified', 'rejected', 'blocked']);
const QUALITIES = new Set(['high', 'medium', 'low', 'unclassified']);
const SORT_FIELDS = {
  created_at: 'l.created_at',
  updated_at: 'l.updated_at',
  username: 'l.username',
  first_name: 'l.first_name',
  status: 'l.status',
  quality: 'l.quality',
  telegram_id: 'l.telegram_id',
};

async function dashboard(request, env) {
  const status = await getDatabaseStatus(env);
  if (status.status !== 'connected') return fail('database_not_ready', 503, status);
  const [newCount, processedCount, byQuality, recent, segments] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM leads WHERE status = 'new'").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM leads WHERE status IN ('processed', 'qualified')").first(),
    env.DB.prepare('SELECT quality, COUNT(*) AS total FROM leads GROUP BY quality').all(),
    env.DB.prepare('SELECT id, action, entity_type, description, created_at FROM activity_logs ORDER BY created_at DESC LIMIT 8').all(),
    env.DB.prepare(`SELECT s.id, s.name, s.color, COUNT(ls.lead_id) AS leads_count
                    FROM segments s LEFT JOIN lead_segments ls ON ls.segment_id = s.id
                    GROUP BY s.id ORDER BY s.name COLLATE NOCASE LIMIT 8`).all(),
  ]);
  return json({
    ok: true,
    totals: {
      leads: status.leadsCount,
      segments: status.segmentsCount,
      new: Number(newCount?.total || 0),
      processed: Number(processedCount?.total || 0),
    },
    by_quality: byQuality.results || [],
    recent_activity: recent.results || [],
    top_segments: segments.results || [],
  });
}

function makeLeadWhere(params) {
  const clauses = ['1 = 1'];
  const values = [];
  const q = safeText(params.get('q'), 120);
  const status = safeText(params.get('status'), 32);
  const quality = safeText(params.get('quality'), 32);
  const source = safeText(params.get('source'), 120);
  const segmentId = safeText(params.get('segment_id'), 64);
  const dateFrom = params.get('date_from');
  const dateTo = params.get('date_to');

  if (q) {
    clauses.push(`(l.telegram_id LIKE ? OR l.username LIKE ? COLLATE NOCASE OR l.first_name LIKE ? COLLATE NOCASE OR l.last_name LIKE ? COLLATE NOCASE OR l.source LIKE ? COLLATE NOCASE)`);
    const needle = `%${q}%`;
    values.push(needle, needle, needle, needle, needle);
  }
  if (status && STATUSES.has(status)) { clauses.push('l.status = ?'); values.push(status); }
  if (quality && QUALITIES.has(quality)) { clauses.push('l.quality = ?'); values.push(quality); }
  if (source) { clauses.push('l.source = ?'); values.push(source); }
  if (segmentId) {
    clauses.push('EXISTS (SELECT 1 FROM lead_segments ls WHERE ls.lead_id = l.id AND ls.segment_id = ?)');
    values.push(segmentId);
  }
  if (validDate(dateFrom)) { clauses.push('date(l.created_at) >= date(?)'); values.push(dateFrom); }
  if (validDate(dateTo)) { clauses.push('date(l.created_at) <= date(?)'); values.push(dateTo); }
  return { sql: clauses.join(' AND '), values };
}

async function listLeads(request, env) {
  const url = new URL(request.url);
  const page = Math.max(1, Math.min(1_000_000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1));
  const pageSizeRaw = Number.parseInt(url.searchParams.get('page_size') || '25', 10) || 25;
  const pageSize = [25, 50, 100].includes(pageSizeRaw) ? pageSizeRaw : 25;
  const sort = SORT_FIELDS[url.searchParams.get('sort')] || SORT_FIELDS.created_at;
  const direction = url.searchParams.get('direction') === 'asc' ? 'ASC' : 'DESC';
  const where = makeLeadWhere(url.searchParams);
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM leads l WHERE ${where.sql}`).bind(...where.values).first();
  const total = Number(count?.total || 0);
  const offset = (page - 1) * pageSize;
  const result = await env.DB.prepare(`
    SELECT l.id, l.telegram_id, l.username, l.first_name, l.last_name, l.source,
           l.quality, l.status, l.consent_status, l.created_at, l.updated_at,
           (SELECT GROUP_CONCAT(s.name, char(31))
              FROM lead_segments ls JOIN segments s ON s.id = ls.segment_id
             WHERE ls.lead_id = l.id) AS segment_names
      FROM leads l
     WHERE ${where.sql}
     ORDER BY ${sort} ${direction}, l.id ASC
     LIMIT ? OFFSET ?
  `).bind(...where.values, pageSize, offset).all();

  const items = (result.results || []).map((row) => ({
    ...row,
    segments: row.segment_names ? row.segment_names.split(String.fromCharCode(31)) : [],
  }));
  return json({ ok: true, items, pagination: { page, page_size: pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) } });
}

function normalizeLead(body, partial = false) {
  const output = {};
  const keys = ['telegram_id', 'username', 'first_name', 'last_name', 'source', 'quality', 'status', 'notes'];
  for (const key of keys) {
    if (partial && !Object.hasOwn(body, key)) continue;
    const raw = body[key];
    if (key === 'telegram_id') {
      const value = safeText(raw, 20);
      if (!value || !/^\d{1,20}$/.test(value) || /^0+$/.test(value)) throw new Error('invalid_telegram_id');
      output[key] = value;
    } else if (key === 'quality') {
      const value = raw === undefined || raw === null || raw === '' ? 'unclassified' : String(raw);
      if (!QUALITIES.has(value)) throw new Error('invalid_quality');
      output[key] = value;
    } else if (key === 'status') {
      const value = raw === undefined || raw === null || raw === '' ? 'new' : String(raw);
      if (!STATUSES.has(value)) throw new Error('invalid_status');
      output[key] = value;
    } else {
      const max = key === 'notes' ? 4000 : key === 'source' ? 120 : key === 'username' ? 64 : 128;
      output[key] = safeText(raw, max);
    }
  }
  if (!partial && !output.source) output.source = 'manual';
  if (!partial && !output.quality) output.quality = 'unclassified';
  if (!partial && !output.status) output.status = 'new';
  return output;
}

async function createLead(request, env) {
  let body;
  try { body = await readJson(request); } catch (error) { return fail(error.message, error.message === 'payload_too_large' ? 413 : 400); }
  let data;
  try { data = normalizeLead(body); } catch (error) { return fail(error.message, 400); }

  const existing = await env.DB.prepare('SELECT id FROM leads WHERE telegram_id = ?').bind(data.telegram_id).first();
  const now = new Date().toISOString();
  let id;
  let action;
  if (existing?.id) {
    id = existing.id;
    action = 'updated';
    await env.DB.prepare(`
      UPDATE leads SET username = ?, first_name = ?, last_name = ?, source = ?, quality = ?, status = ?, extra_json = ?, updated_at = ?
      WHERE id = ?
    `).bind(data.username, data.first_name, data.last_name, data.source, data.quality, data.status, JSON.stringify({ notes: data.notes || '' }), now, id).run();
    await logActivity(env.DB, 'lead.updated', 'lead', id, `Обновлён лид с Telegram ID ${data.telegram_id}`);
  } else {
    id = makeId();
    action = 'created';
    try {
      await env.DB.prepare(`
        INSERT INTO leads (id, telegram_id, username, first_name, last_name, source, quality, status, consent_status, extra_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?)
      `).bind(id, data.telegram_id, data.username, data.first_name, data.last_name, data.source, data.quality, data.status, JSON.stringify({ notes: data.notes || '' }), now, now).run();
    } catch (error) {
      if (!String(error?.message || '').toLowerCase().includes('unique')) throw error;
      const duplicate = await env.DB.prepare('SELECT id FROM leads WHERE telegram_id = ?').bind(data.telegram_id).first();
      if (!duplicate?.id) throw error;
      id = duplicate.id;
      action = 'updated';
      await env.DB.prepare(`
        UPDATE leads SET username = ?, first_name = ?, last_name = ?, source = ?, quality = ?, status = ?, extra_json = ?, updated_at = ? WHERE id = ?
      `).bind(data.username, data.first_name, data.last_name, data.source, data.quality, data.status, JSON.stringify({ notes: data.notes || '' }), now, id).run();
    }
    await logActivity(env.DB, action === 'created' ? 'lead.created' : 'lead.updated', 'lead', id,
      `${action === 'created' ? 'Добавлен' : 'Обновлён'} лид с Telegram ID ${data.telegram_id}`);
  }
  const lead = await getLeadWithSegments(env.DB, id);
  return json({ ok: true, action, item: lead }, action === 'created' ? 201 : 200);
}

async function updateLead(request, env, id) {
  const exists = await env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(id).first();
  if (!exists) return fail('lead_not_found', 404);
  let body;
  try { body = await readJson(request); } catch (error) { return fail(error.message, error.message === 'payload_too_large' ? 413 : 400); }
  let data;
  try { data = normalizeLead(body, true); } catch (error) { return fail(error.message, 400); }
  const allowed = Object.keys(data);
  if (!allowed.length) return fail('nothing_to_update', 400);
  const now = new Date().toISOString();
  const dbFields = [];
  const dbValues = [];
  for (const key of allowed) {
    if (key === 'notes') {
      const current = await env.DB.prepare('SELECT extra_json FROM leads WHERE id = ?').bind(id).first();
      let extra = {};
      try { extra = current?.extra_json ? JSON.parse(current.extra_json) : {}; } catch { extra = {}; }
      extra.notes = data.notes || '';
      dbFields.push('extra_json'); dbValues.push(JSON.stringify(extra));
    } else {
      dbFields.push(key); dbValues.push(data[key]);
    }
  }
  const sql = `UPDATE leads SET ${dbFields.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
  try {
    await env.DB.prepare(sql).bind(...dbValues, now, id).run();
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('unique')) return fail('telegram_id_already_exists', 409);
    throw error;
  }
  await logActivity(env.DB, 'lead.updated', 'lead', id, 'Изменены данные лида');
  return json({ ok: true, item: await getLeadWithSegments(env.DB, id) });
}

async function deleteLead(env, id) {
  const lead = await env.DB.prepare('SELECT telegram_id FROM leads WHERE id = ?').bind(id).first();
  if (!lead) return fail('lead_not_found', 404);
  await env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(id).run();
  await logActivity(env.DB, 'lead.deleted', 'lead', id, `Удалён лид с Telegram ID ${lead.telegram_id}`);
  return json({ ok: true, deleted_id: id });
}

async function listSegments(env) {
  const result = await env.DB.prepare(`
    SELECT s.id, s.name, s.description, s.color, s.created_at, s.updated_at,
           COUNT(ls.lead_id) AS leads_count
      FROM segments s LEFT JOIN lead_segments ls ON ls.segment_id = s.id
     GROUP BY s.id ORDER BY s.name COLLATE NOCASE
  `).all();
  return json({ ok: true, items: result.results || [] });
}

async function createSegment(request, env) {
  let body;
  try { body = await readJson(request, 16_000); } catch (error) { return fail(error.message); }
  const name = safeText(body.name, 80);
  const description = safeText(body.description, 500) || '';
  const color = safeText(body.color, 16) || '#78A9C8';
  if (!name) return fail('segment_name_required');
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return fail('invalid_segment_color');
  const duplicate = await env.DB.prepare('SELECT id FROM segments WHERE name = ? COLLATE NOCASE').bind(name).first();
  if (duplicate) return fail('segment_name_exists', 409);
  const id = makeId();
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO segments (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, name, description, color, now, now).run();
  await logActivity(env.DB, 'segment.created', 'segment', id, `Создан раздел «${name}»`);
  return json({ ok: true, item: { id, name, description, color, leads_count: 0 } }, 201);
}

async function updateSegment(request, env, id) {
  const current = await env.DB.prepare('SELECT * FROM segments WHERE id = ?').bind(id).first();
  if (!current) return fail('segment_not_found', 404);
  let body;
  try { body = await readJson(request, 16_000); } catch (error) { return fail(error.message); }
  const name = Object.hasOwn(body, 'name') ? safeText(body.name, 80) : current.name;
  const description = Object.hasOwn(body, 'description') ? (safeText(body.description, 500) || '') : current.description;
  const color = Object.hasOwn(body, 'color') ? safeText(body.color, 16) : current.color;
  if (!name) return fail('segment_name_required');
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return fail('invalid_segment_color');
  const duplicate = await env.DB.prepare('SELECT id FROM segments WHERE name = ? COLLATE NOCASE AND id <> ?').bind(name, id).first();
  if (duplicate) return fail('segment_name_exists', 409);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE segments SET name = ?, description = ?, color = ?, updated_at = ? WHERE id = ?')
    .bind(name, description, color, now, id).run();
  await logActivity(env.DB, 'segment.updated', 'segment', id, `Изменён раздел «${name}»`);
  return json({ ok: true, item: { ...current, name, description, color, updated_at: now } });
}

async function deleteSegment(env, id) {
  const segment = await env.DB.prepare('SELECT name FROM segments WHERE id = ?').bind(id).first();
  if (!segment) return fail('segment_not_found', 404);
  await env.DB.prepare('DELETE FROM segments WHERE id = ?').bind(id).run();
  await logActivity(env.DB, 'segment.deleted', 'segment', id, `Удалён раздел «${segment.name}». Лиды сохранены.`);
  return json({ ok: true, deleted_id: id });
}

async function changeSegmentMembers(request, env, id) {
  const segment = await env.DB.prepare('SELECT id FROM segments WHERE id = ?').bind(id).first();
  if (!segment) return fail('segment_not_found', 404);
  let body;
  try { body = await readJson(request, 64_000); } catch (error) { return fail(error.message); }
  const ids = Array.isArray(body.lead_ids) ? [...new Set(body.lead_ids.map((value) => String(value).slice(0, 64)))].filter(Boolean) : [];
  if (!ids.length || ids.length > 200) return fail('lead_ids_must_contain_1_to_200_ids');
  const operation = body.operation;
  if (!['add', 'remove'].includes(operation)) return fail('invalid_operation');
  const statements = ids.map((leadId) => operation === 'add'
    ? env.DB.prepare('INSERT OR IGNORE INTO lead_segments (lead_id, segment_id, created_at) VALUES (?, ?, ?)').bind(leadId, id, new Date().toISOString())
    : env.DB.prepare('DELETE FROM lead_segments WHERE lead_id = ? AND segment_id = ?').bind(leadId, id));
  try { await env.DB.batch(statements); } catch { return fail('invalid_lead_id_or_database_error', 400); }
  await logActivity(env.DB, `segment.members.${operation}`, 'segment', id,
    `${operation === 'add' ? 'Добавлено в' : 'Удалено из'} раздела записей: ${ids.length}`);
  return json({ ok: true, processed: ids.length, operation });
}

async function bulkLeads(request, env) {
  let body;
  try { body = await readJson(request, 96_000); } catch (error) { return fail(error.message); }
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map((v) => String(v).slice(0, 64)))].filter(Boolean) : [];
  if (!ids.length || ids.length > 200) return fail('ids_must_contain_1_to_200_ids');
  const action = body.action;
  let statements = [];
  if (action === 'status' && STATUSES.has(body.value)) {
    statements = ids.map((id) => env.DB.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ?').bind(body.value, new Date().toISOString(), id));
  } else if (action === 'quality' && QUALITIES.has(body.value)) {
    statements = ids.map((id) => env.DB.prepare('UPDATE leads SET quality = ?, updated_at = ? WHERE id = ?').bind(body.value, new Date().toISOString(), id));
  } else if (action === 'delete') {
    statements = ids.map((id) => env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(id));
  } else if (['add_segment', 'remove_segment'].includes(action) && typeof body.segment_id === 'string') {
    const segment = await env.DB.prepare('SELECT id FROM segments WHERE id = ?').bind(body.segment_id).first();
    if (!segment) return fail('segment_not_found', 404);
    statements = ids.map((id) => action === 'add_segment'
      ? env.DB.prepare('INSERT OR IGNORE INTO lead_segments (lead_id, segment_id, created_at) VALUES (?, ?, ?)').bind(id, body.segment_id, new Date().toISOString())
      : env.DB.prepare('DELETE FROM lead_segments WHERE lead_id = ? AND segment_id = ?').bind(id, body.segment_id));
  } else {
    return fail('invalid_bulk_action');
  }
  try { await env.DB.batch(statements); } catch { return fail('bulk_operation_failed', 400); }
  await logActivity(env.DB, `leads.bulk.${action}`, 'lead', null, `Массовая операция ${action}; записей: ${ids.length}`);
  return json({ ok: true, processed: ids.length, action });
}

async function listActivity(request, env) {
  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const pageSize = 30;
  const totalRow = await env.DB.prepare('SELECT COUNT(*) AS total FROM activity_logs').first();
  const total = Number(totalRow?.total || 0);
  const result = await env.DB.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .bind(pageSize, (page - 1) * pageSize).all();
  return json({ ok: true, items: result.results || [], pagination: { page, page_size: pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) } });
}

export async function handleApiRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  const authResponse = await authRoutes(request, env, path);
  if (authResponse) return authResponse;

  if (path === '/api/health' && method === 'GET') {
    const database = await getDatabaseStatus(env);
    return json({
      ok: database.status === 'connected',
      app: 'Lead Database Manager',
      version: '0.2.0',
      checks: {
        worker: 'ok',
        database: database.status,
        admin_auth: env.ADMIN_TOKEN ? 'configured' : 'not_configured',
        telegram: env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET ? 'configured' : 'not_configured',
      },
      leads_count: database.leadsCount,
      segments_count: database.segmentsCount,
      checked_at: new Date().toISOString(),
    }, database.status === 'connected' ? 200 : 503);
  }

  if (!path.startsWith('/api/')) return null;
  const authorization = isAdminAuthorized(request, env);
  if (!authorization.ok) return fail(authorization.error, authorization.status);
  if (!env.DB) return fail('database_not_configured', 503);

  if (path === '/api/dashboard' && method === 'GET') return dashboard(request, env);
  if (path === '/api/leads' && method === 'GET') return listLeads(request, env);
  if (path === '/api/leads' && method === 'POST') return createLead(request, env);
  if (path === '/api/leads/bulk' && method === 'POST') return bulkLeads(request, env);
  if (path === '/api/segments' && method === 'GET') return listSegments(env);
  if (path === '/api/segments' && method === 'POST') return createSegment(request, env);
  if (path === '/api/activity' && method === 'GET') return listActivity(request, env);

  const memberRoute = path.match(/^\/api\/segments\/([^/]+)\/members$/);
  if (memberRoute && method === 'POST') return changeSegmentMembers(request, env, decodeURIComponent(memberRoute[1]));
  const segmentRoute = path.match(/^\/api\/segments\/([^/]+)$/);
  if (segmentRoute && method === 'PATCH') return updateSegment(request, env, decodeURIComponent(segmentRoute[1]));
  if (segmentRoute && method === 'DELETE') return deleteSegment(env, decodeURIComponent(segmentRoute[1]));

  const leadRoute = path.match(/^\/api\/leads\/([^/]+)$/);
  if (leadRoute) {
    const id = decodeURIComponent(leadRoute[1]);
    if (method === 'GET') {
      const item = await getLeadWithSegments(env.DB, id);
      return item ? json({ ok: true, item }) : fail('lead_not_found', 404);
    }
    if (method === 'PATCH') return updateLead(request, env, id);
    if (method === 'DELETE') return deleteLead(env, id);
  }

  return fail('api_route_not_found', 404);
}
