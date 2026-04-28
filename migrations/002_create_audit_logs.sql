CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  params TEXT NOT NULL,
  response_summary TEXT NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT NOT NULL
);
