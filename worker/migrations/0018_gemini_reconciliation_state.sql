-- La reconciliación se completa sólo después de aplicar sus contadores a
-- gemini_quota_state. Antes de esta migración la fila se insertaba antes de
-- actualizar los contadores, por lo que una fila histórica no permite saber si
-- quedó aplicada o pendiente. Se conserva como aplicada para que un reinicio
-- no duplique contadores; las nuevas filas se insertan explícitamente con 0.
ALTER TABLE gemini_quota_reconciliations ADD COLUMN state_applied INTEGER NOT NULL DEFAULT 1 CHECK (state_applied IN (0, 1));
ALTER TABLE gemini_quota_reconciliations ADD COLUMN state_applied_at INTEGER;

CREATE INDEX IF NOT EXISTS gemini_quota_reconciliations_pending
  ON gemini_quota_reconciliations(state_applied, reservation_id);
