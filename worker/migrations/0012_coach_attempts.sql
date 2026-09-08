-- Durable provider-attempt ledger. A sent attempt is never replayed implicitly.
ALTER TABLE coach_runs ADD COLUMN deadline_at INTEGER;
ALTER TABLE coach_runs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS coach_run_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'sent', 'succeeded', 'failed', 'uncertain')),
  response_json TEXT,
  usage_json TEXT,
  error_code TEXT,
  retry_after_ms INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(run_id, attempt_no),
  UNIQUE(run_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS coach_run_attempts_run ON coach_run_attempts(run_id, attempt_no);
