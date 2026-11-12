-- REFERENCE ONLY — DO NOT APPLY IN STAGE 1.
-- These are logical tables planned for later stages. Actual migrations will be
-- split into numbered, incremental files when those stages are implemented.

CREATE TABLE segments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lead_segments (
  lead_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  added_by TEXT,
  PRIMARY KEY (lead_id, segment_id),
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
);

CREATE TABLE search_jobs (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  filters_json TEXT NOT NULL,
  status TEXT NOT NULL,
  checked_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chat_queue (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('waiting','processing','done','error','skipped','excluded')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE TABLE chat_history (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  queue_id TEXT,
  action_type TEXT NOT NULL,
  result TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (queue_id) REFERENCES chat_queue(id) ON DELETE SET NULL
);

CREATE TABLE app_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_lead_segments_segment ON lead_segments(segment_id, lead_id);
CREATE INDEX idx_search_jobs_status_created ON search_jobs(status, created_at DESC);
CREATE INDEX idx_chat_queue_status_next ON chat_queue(status, next_attempt_at);
CREATE INDEX idx_chat_queue_lead ON chat_queue(lead_id, created_at DESC);
CREATE INDEX idx_chat_history_lead_created ON chat_history(lead_id, created_at DESC);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
