-- Estado de la reserva idempotente y presupuesto operativo por cuenta/semana.
ALTER TABLE adaptation_idempotency ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';

CREATE TABLE IF NOT EXISTS adaptation_budgets (
  user_hash TEXT NOT NULL,
  iso_week TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reserved_input_tokens INTEGER NOT NULL DEFAULT 0,
  reserved_output_tokens INTEGER NOT NULL DEFAULT 0,
  active_runs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_hash, iso_week)
);
