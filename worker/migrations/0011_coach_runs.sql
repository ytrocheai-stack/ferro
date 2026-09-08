-- Durable private coach executions. Account identity remains pseudonymized in D1.
CREATE TABLE IF NOT EXISTS coach_runs (
  id TEXT PRIMARY KEY,
  account_hash TEXT NOT NULL,
  event_id TEXT NOT NULL,
  context_version TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  request_json TEXT NOT NULL,
  decision_json TEXT,
  error_code TEXT,
  usage_json TEXT,
  workflow_status TEXT,
  applied_at INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS coach_runs_account_idempotency ON coach_runs(account_hash, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS coach_runs_one_active_per_account ON coach_runs(account_hash) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS coach_runs_account_updated ON coach_runs(account_hash, updated_at);
