-- ─────────────────────────────────────────────
--  Migration 028 — YouTube video lessons
--  Lessons can now reference a YouTube video
--  instead of an uploaded file, so no server
--  storage is consumed. Existing rows default to
--  the 'upload' source and keep their files.
-- ─────────────────────────────────────────────

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS video_source VARCHAR(16) NOT NULL DEFAULT 'upload';

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS youtube_id   VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_lessons_video_source
  ON lessons (video_source);