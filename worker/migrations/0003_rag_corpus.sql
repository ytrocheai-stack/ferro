CREATE TABLE IF NOT EXISTS adaptation_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  license TEXT NOT NULL,
  evidence_level INTEGER NOT NULL,
  approved_at INTEGER NOT NULL,
  corpus_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS adaptation_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES adaptation_sources(id),
  text_hash TEXT NOT NULL,
  text TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  corpus_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS adaptation_chunks_source ON adaptation_chunks(source_id);
