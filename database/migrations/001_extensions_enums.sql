-- ─────────────────────────────────────────────
--  Migration 001 — Extensions & Enums
--  Run order: first
-- ─────────────────────────────────────────────

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums ────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'student', 'instructor', 'admin', 'super_admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM (
    'pending_verification', 'active', 'suspended', 'deactivated'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE course_status AS ENUM (
    'draft', 'under_review', 'published', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE lesson_type AS ENUM (
    'video', 'pdf', 'text', 'quiz', 'assignment'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE enrollment_status AS ENUM (
    'active', 'completed', 'expired', 'refunded', 'revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE submission_status AS ENUM (
    'submitted', 'grading', 'graded', 'returned'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- payment_status enum removed — payments handled manually

DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'enrollment', 'lesson_available', 'assignment_graded',
    'announcement', 'certificate_issued', 'payment_receipt', 'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE storage_backend AS ENUM (
    'local', 'minio', 's3'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
