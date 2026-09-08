-- Conversation ownership is explicit so a continuation cannot cross private threads.
ALTER TABLE coach_runs ADD COLUMN conversation_id TEXT NOT NULL DEFAULT 'legacy-conversation';
CREATE INDEX IF NOT EXISTS coach_runs_account_conversation ON coach_runs(account_hash, conversation_id, updated_at);
