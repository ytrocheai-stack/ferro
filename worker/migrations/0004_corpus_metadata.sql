ALTER TABLE adaptation_sources ADD COLUMN author TEXT NOT NULL DEFAULT '';
ALTER TABLE adaptation_sources ADD COLUMN language TEXT NOT NULL DEFAULT '';
ALTER TABLE adaptation_sources ADD COLUMN published_at TEXT;
ALTER TABLE adaptation_sources ADD COLUMN location TEXT;
ALTER TABLE adaptation_sources ADD COLUMN approved INTEGER NOT NULL DEFAULT 0;
