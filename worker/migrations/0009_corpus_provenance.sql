-- Procedencia y filtros explícitos del corpus normalizado. Todo es aditivo:
-- las filas heredadas conservan valores desconocidos y no se vuelven elegibles.
ALTER TABLE adaptation_sources ADD COLUMN source_hash TEXT;
ALTER TABLE adaptation_sources ADD COLUMN review_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE adaptation_sources ADD COLUMN scientific_review TEXT NOT NULL DEFAULT 'not_appraised';
ALTER TABLE adaptation_sources ADD COLUMN population_json TEXT NOT NULL DEFAULT '["unknown"]';
ALTER TABLE adaptation_sources ADD COLUMN population_reviewed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE adaptation_chunks ADD COLUMN section TEXT;
ALTER TABLE adaptation_chunks ADD COLUMN retrieval_class TEXT NOT NULL DEFAULT 'evidence';
ALTER TABLE adaptation_chunks ADD COLUMN collection TEXT NOT NULL DEFAULT 'scientific';
ALTER TABLE adaptation_chunks ADD COLUMN population_json TEXT NOT NULL DEFAULT '["unknown"]';
ALTER TABLE adaptation_chunks ADD COLUMN population_reviewed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS adaptation_chunks_retrieval_filter ON adaptation_chunks(corpus_version, retrieval_class, population_reviewed);
