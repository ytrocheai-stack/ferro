CREATE TABLE IF NOT EXISTS adaptation_quotas (
  user_hash TEXT NOT NULL,
  iso_week TEXT NOT NULL,
  analysis_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_hash, iso_week)
);
CREATE TABLE IF NOT EXISTS adaptation_idempotency (
  user_hash TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  analysis_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (user_hash, idem_key)
);
CREATE TABLE IF NOT EXISTS adaptation_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_hash TEXT NOT NULL,
  analysis_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  model TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  index_version TEXT NOT NULL,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS adaptation_telemetry_created_at ON adaptation_telemetry(created_at);
