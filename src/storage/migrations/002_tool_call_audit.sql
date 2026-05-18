ALTER TABLE tool_calls ADD COLUMN approval_id TEXT;
ALTER TABLE tool_calls ADD COLUMN error_json TEXT;
ALTER TABLE tool_calls ADD COLUMN started_at TEXT;
ALTER TABLE tool_calls ADD COLUMN completed_at TEXT;
ALTER TABLE tool_calls ADD COLUMN duration_ms INTEGER;
