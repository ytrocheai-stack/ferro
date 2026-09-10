-- La autorización se inicializa explícitamente desde el diario histórico.
-- Cero solicitudes disponibles hasta completar esa conciliación.
ALTER TABLE provider_request_limits ADD COLUMN used_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_request_limits ADD COLUMN max_requests INTEGER NOT NULL DEFAULT 0;
