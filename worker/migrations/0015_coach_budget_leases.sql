-- Reservas por ejecución: los triggers y la fila cambian en la misma transacción.
CREATE TABLE IF NOT EXISTS coach_budget_leases (
 run_id TEXT PRIMARY KEY, user_hash TEXT NOT NULL, iso_week TEXT NOT NULL,
 input_estimate INTEGER NOT NULL, output_estimate INTEGER NOT NULL,
 input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
 settled INTEGER NOT NULL DEFAULT 0 CHECK (settled IN (0,1))
);
CREATE TRIGGER IF NOT EXISTS coach_budget_reserve AFTER INSERT ON coach_budget_leases BEGIN
 UPDATE adaptation_budgets SET reserved_input_tokens = reserved_input_tokens + NEW.input_estimate,
 reserved_output_tokens = reserved_output_tokens + NEW.output_estimate, active_runs = active_runs + 1
 WHERE user_hash = NEW.user_hash AND iso_week = NEW.iso_week;
END;
CREATE TRIGGER IF NOT EXISTS coach_budget_settle AFTER UPDATE OF settled ON coach_budget_leases
WHEN OLD.settled = 0 AND NEW.settled = 1 BEGIN
 UPDATE adaptation_budgets SET reserved_input_tokens = MAX(0, reserved_input_tokens - NEW.input_estimate),
 reserved_output_tokens = MAX(0, reserved_output_tokens - NEW.output_estimate), active_runs = MAX(0, active_runs - 1),
 input_tokens = input_tokens + NEW.input_tokens, output_tokens = output_tokens + NEW.output_tokens
 WHERE user_hash = NEW.user_hash AND iso_week = NEW.iso_week;
END;
