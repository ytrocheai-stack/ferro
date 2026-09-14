-- T8: snapshots durables por ejecución. Aditiva y conservada durante rollback.
CREATE TABLE IF NOT EXISTS coach_run_snapshots (
 run_id TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK (sequence > 0),
 text TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
 decision_json TEXT,
 error_code TEXT,
 created_at INTEGER NOT NULL,
 PRIMARY KEY (run_id, sequence)
);
CREATE INDEX IF NOT EXISTS coach_run_snapshots_created_idx ON coach_run_snapshots (run_id, created_at);
