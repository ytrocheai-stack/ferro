-- La reconciliación se completa sólo después de aplicar sus contadores a
-- gemini_quota_state. Los marcadores ya existentes se dejan pendientes: la
-- versión anterior insertaba el marcador antes de actualizar contadores y no
-- podía demostrar que ambas escrituras hubieran quedado juntas.
ALTER TABLE gemini_quota_reconciliations ADD COLUMN state_applied INTEGER NOT NULL DEFAULT 0 CHECK (state_applied IN (0, 1));
ALTER TABLE gemini_quota_reconciliations ADD COLUMN state_applied_at INTEGER;

CREATE INDEX IF NOT EXISTS gemini_quota_reconciliations_pending
  ON gemini_quota_reconciliations(state_applied, reservation_id);
