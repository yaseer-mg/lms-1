-- ─────────────────────────────────────────────
--  Migration 027 — Idempotency keys
--  Enables safe offline-first sync: mutations
--  carry an Idempotency-Key so retries/resumed
--  offline actions never create duplicates.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT        NOT NULL,
  user_id       UUID,
  method        TEXT        NOT NULL,
  path          TEXT        NOT NULL,
  request_hash  TEXT        NOT NULL,
  status_code   INTEGER     NOT NULL DEFAULT 200,
  response_body JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_idempotency_unique UNIQUE (key, user_id, method, path)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user
  ON idempotency_keys (user_id, created_at);