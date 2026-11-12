import { makeId } from './http.js';

export async function logActivity(db, action, entityType, entityId, description) {
  await db.prepare(`
    INSERT INTO activity_logs (id, actor, action, entity_type, entity_id, description, created_at)
    VALUES (?, 'admin', ?, ?, ?, ?, ?)
  `).bind(makeId(), action, entityType, entityId || null, description, new Date().toISOString()).run();
}

export async function getDatabaseStatus(env) {
  if (!env.DB) return { status: 'not_configured', leadsCount: null, segmentsCount: null };
  try {
    const [leads, segments] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS total FROM leads').first(),
      env.DB.prepare('SELECT COUNT(*) AS total FROM segments').first(),
    ]);
    return {
      status: 'connected',
      leadsCount: Number(leads?.total ?? 0),
      segmentsCount: Number(segments?.total ?? 0),
    };
  } catch {
    return { status: 'schema_missing_or_unavailable', leadsCount: null, segmentsCount: null };
  }
}

export async function getLeadWithSegments(db, id) {
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first();
  if (!lead) return null;
  let extra = {};
  try { extra = lead.extra_json ? JSON.parse(lead.extra_json) : {}; } catch { extra = {}; }
  const result = await db.prepare(`
    SELECT s.id, s.name, s.color
      FROM segments s
      JOIN lead_segments ls ON ls.segment_id = s.id
     WHERE ls.lead_id = ?
     ORDER BY s.name COLLATE NOCASE
  `).bind(id).all();
  return { ...lead, notes: typeof extra.notes === 'string' ? extra.notes : '', segments: result.results || [] };
}
