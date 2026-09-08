-- Desglosa el consumo observado de la estimación usada cuando el proveedor
-- no devuelve usage. Los campos antiguos se conservan para compatibilidad.
ALTER TABLE adaptation_telemetry ADD COLUMN input_tokens_measured INTEGER;
ALTER TABLE adaptation_telemetry ADD COLUMN output_tokens_measured INTEGER;
ALTER TABLE adaptation_telemetry ADD COLUMN input_tokens_estimated INTEGER;
ALTER TABLE adaptation_telemetry ADD COLUMN output_tokens_estimated INTEGER;
ALTER TABLE adaptation_telemetry ADD COLUMN usage_incomplete INTEGER NOT NULL DEFAULT 0;
