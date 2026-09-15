-- Cuotas y circuitos durables para el failover del Coach.
-- Esta migración es estrictamente aditiva: los datos históricos no se borran ni se
-- reinterpretan como consumo disponible.
ALTER TABLE coach_run_attempts ADD COLUMN provider TEXT NOT NULL DEFAULT 'nvidia';
ALTER TABLE coach_run_attempts ADD COLUMN logical_call_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE coach_run_attempts ADD COLUMN dispatch_status TEXT NOT NULL DEFAULT 'sent';

-- Los intentos anteriores sólo podían proceder de NVIDIA. Su número lógico es el
-- número de intento existente y su estado de despacho conserva el estado conocido.
UPDATE coach_run_attempts
SET logical_call_no = attempt_no,
    dispatch_status = CASE status
      WHEN 'reserved' THEN 'reserved'
      WHEN 'sent' THEN 'sent'
      WHEN 'succeeded' THEN 'succeeded'
      WHEN 'failed' THEN 'failed'
      WHEN 'uncertain' THEN 'uncertain'
      ELSE 'uncertain'
    END
WHERE provider = 'nvidia';

CREATE INDEX IF NOT EXISTS coach_run_attempts_provider_call
  ON coach_run_attempts(provider, run_id, logical_call_no, attempt_no);

-- Una fila global por proyecto Gemini. minute_key es una ventana fija de un minuto
-- y pacific_day la fecha civil de America/Los_Angeles. Los campos medidos/estimados
-- son diagnóstico; sólo los tres contadores de cuota participan en la reserva.
CREATE TABLE IF NOT EXISTS gemini_quota_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  minute_key INTEGER NOT NULL DEFAULT -1,
  minute_requests INTEGER NOT NULL DEFAULT 0 CHECK (minute_requests >= 0),
  minute_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (minute_input_tokens >= 0),
  pacific_day TEXT NOT NULL DEFAULT '',
  day_requests INTEGER NOT NULL DEFAULT 0 CHECK (day_requests >= 0),
  input_tokens_estimated INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens_estimated >= 0),
  input_tokens_measured INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens_measured >= 0),
  usage_incomplete INTEGER NOT NULL DEFAULT 0 CHECK (usage_incomplete IN (0, 1)),
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO gemini_quota_state (id) VALUES (1);

-- Un circuito por proveedor, compartido entre usuarios e isolates.
CREATE TABLE IF NOT EXISTS provider_circuit_state (
  provider TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  opened_at INTEGER,
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  half_open_lease_id TEXT,
  half_open_lease_until INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO provider_circuit_state(provider) VALUES ('gemini'), ('nvidia');
CREATE INDEX IF NOT EXISTS provider_circuit_state_cooldown
  ON provider_circuit_state(cooldown_until, provider);

-- 0010/0014 conservan la tabla histórica. No se crea una fila NVIDIA aquí:
-- la conciliación/operación existente decide cuándo inicializarla. max_requests
-- no es autorización; used_requests sólo conserva telemetría diagnóstica.
