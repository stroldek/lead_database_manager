-- Lead Database Manager / Stage 1 prototype schema
-- Apply this file once to the project's D1 database.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  source TEXT NOT NULL DEFAULT 'telegram_bot',
  quality TEXT NOT NULL DEFAULT 'unclassified'
    CHECK (quality IN ('high', 'medium', 'low', 'unclassified')),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'processed', 'qualified', 'rejected', 'blocked')),
  consent_status TEXT NOT NULL DEFAULT 'none'
    CHECK (consent_status IN ('none', 'granted', 'revoked')),
  consent_at TEXT,
  consent_source TEXT,
  last_interaction_at TEXT,
  extra_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS consent_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('granted', 'revoked')),
  source TEXT NOT NULL,
  event_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id INTEGER PRIMARY KEY,
  update_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processing', 'processed', 'failed')),
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processing_at TEXT,
  processed_at TEXT,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_username ON leads(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_quality ON leads(quality);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_consent_status ON leads(consent_status);
CREATE INDEX IF NOT EXISTS idx_consent_events_lead_created ON consent_events(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_updates_status ON telegram_updates(status, received_at);

INSERT OR IGNORE INTO schema_migrations(version) VALUES ('0001_stage1_prototype');
