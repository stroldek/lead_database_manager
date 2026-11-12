-- Lead Database Manager v0.2.0
-- Apply AFTER 0001_stage1_prototype.sql in the Cloudflare D1 SQL Console.

-- Lead notes are stored inside the existing leads.extra_json field to keep this migration repeat-safe.

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#78A9C8',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lead_segments (
  lead_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lead_id, segment_id),
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT 'admin',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS search_jobs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'stopped')),
  checked_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_queue (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped', 'excluded')),
  consent_snapshot TEXT NOT NULL DEFAULT 'none',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (lead_id),
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_history (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  status TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_consent_created ON leads(consent_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_segments_name ON segments(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_lead_segments_segment ON lead_segments(segment_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_jobs_created ON search_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_queue_status ON chat_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_history_lead ON chat_history(lead_id, created_at DESC);

INSERT OR IGNORE INTO segments (id, name, description, color)
VALUES
  ('seg-unprocessed', 'Необработанные', 'Лиды, которые ещё не прошли первичную обработку.', '#78A9C8'),
  ('seg-promising', 'Перспективные', 'Лиды, требующие дальнейшей проработки.', '#77B99A'),
  ('seg-mobile', 'Мобильные аксессуары', 'Лиды по направлению мобильных аксессуаров.', '#D8B777'),
  ('seg-electronics', 'Электроника', 'Лиды по направлению электроники.', '#A99BD6');

INSERT OR IGNORE INTO schema_migrations(version) VALUES ('0002_core_management');
