-- ─────────────────────────────────────────────
--  Migration 001 — Extensions & Enums
--  Run order: first
-- ─────────────────────────────────────────────

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums ────────────────────────────────────

CREATE TYPE user_role AS ENUM (
  'student',
  'instructor',
  'admin',
  'super_admin'
);

CREATE TYPE user_status AS ENUM (
  'pending_verification',
  'active',
  'suspended',
  'deactivated'
);

CREATE TYPE course_status AS ENUM (
  'draft',
  'under_review',
  'published',
  'archived'
);

CREATE TYPE lesson_type AS ENUM (
  'video',
  'pdf',
  'text',
  'quiz',
  'assignment'
);

CREATE TYPE enrollment_status AS ENUM (
  'active',
  'completed',
  'expired',
  'refunded',
  'revoked'
);

CREATE TYPE submission_status AS ENUM (
  'submitted',
  'grading',
  'graded',
  'returned'
);

-- payment_status enum removed — payments handled manually

CREATE TYPE notification_type AS ENUM (
  'enrollment',
  'lesson_available',
  'assignment_graded',
  'announcement',
  'certificate_issued',
  'payment_receipt',
  'system'
);

CREATE TYPE storage_backend AS ENUM (
  'local',
  'minio',
  's3'
);