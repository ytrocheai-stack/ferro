-- Idempotencia privada: nunca se guarda el payload, solo su HMAC.
ALTER TABLE adaptation_idempotency ADD COLUMN request_hash TEXT NOT NULL DEFAULT '';
