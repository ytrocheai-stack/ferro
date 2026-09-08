-- Shared across users and isolates. Dispatch reservations are never refunded.
CREATE TABLE IF NOT EXISTS provider_request_limits (
  provider TEXT PRIMARY KEY,
  next_allowed_at INTEGER NOT NULL
);
