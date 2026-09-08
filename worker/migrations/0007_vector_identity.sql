-- Identidad física v2: el ID lógico se conserva en `id` y el ID enviado a
-- Vectorize queda disponible para rollback. Las filas heredadas permanecen
-- con vector_id NULL y usan su ID físico anterior al revertir.
ALTER TABLE adaptation_chunks ADD COLUMN vector_id TEXT;
CREATE INDEX IF NOT EXISTS adaptation_chunks_vector_id ON adaptation_chunks(vector_id);
