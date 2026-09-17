-- ─────────────────────────────────────────────
--  Migration 026 — Allow 'revoked' enrollment status
--
--  The backend revokeEnrollment() sets enrollments.status = 'revoked',
--  but the enrollment_status enum never included that value, so the
--  Revoke action failed with HTTP 500 ("invalid input value for enum").
-- ─────────────────────────────────────────────

ALTER TYPE enrollment_status ADD VALUE IF NOT EXISTS 'revoked';
