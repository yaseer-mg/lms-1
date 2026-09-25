'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const db       = require('../../config/db');
const storage  = require('../../config/storage');
const ApiError = require('../../shared/utils/apiError');

// Allowed MIME types per context
const ALLOWED_TYPES = {
  avatar:               ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  course_thumbnail:     ['image/jpeg', 'image/png', 'image/webp'],
  lesson_video:         ['video/mp4', 'video/webm'],
  lesson_resource:      ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  assignment_submission: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'text/plain',
    'application/zip',
  ],
  institution_logo:     ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'],
};

// Max sizes per context (bytes)
const MAX_SIZES = {
  avatar:                5 * 1024 * 1024,    // 5 MB
  course_thumbnail:      5 * 1024 * 1024,    // 5 MB
  lesson_video:          500 * 1024 * 1024,  // 500 MB
  lesson_resource:       50 * 1024 * 1024,   // 50 MB
  assignment_submission: 100 * 1024 * 1024,  // 100 MB
  institution_logo:      2 * 1024 * 1024,    // 2 MB
};

// Context -> storage sub-directory mapping
const CONTEXT_DIRS = {
  avatar:                'uploads/avatars',
  course_thumbnail:      'uploads/courses',
  lesson_video:          'uploads/lessons',
  lesson_resource:       'uploads/lessons',
  assignment_submission: 'uploads/assignments',
  institution_logo:      'uploads/branding',
};

/**
 * Verify the requesting user owns the entity associated with a file context.
 * Used by the generic file upload endpoint to prevent cross-entity file uploads.
 */
async function verifyFileContextOwner(context, ownerId, requestingUser) {
  if (context === 'lesson_video' || context === 'lesson_resource') {
    const { rows } = await db.query(
      `SELECT c.instructor_id
       FROM lessons l
       JOIN courses c ON c.id = l.course_id
       WHERE l.id = $1 AND l.deleted_at IS NULL AND c.deleted_at IS NULL`,
      [ownerId]
    );
    if (!rows[0]) throw ApiError.notFound('Lesson not found');
    if (requestingUser.role !== 'admin' && requestingUser.role !== 'super_admin'
        && rows[0].instructor_id !== requestingUser.id) {
      throw ApiError.forbidden('You do not have permission to upload files to this lesson');
    }
  } else if (context === 'course_thumbnail') {
    const { rows } = await db.query(
      'SELECT instructor_id FROM courses WHERE id = $1 AND deleted_at IS NULL',
      [ownerId]
    );
    if (!rows[0]) throw ApiError.notFound('Course not found');
    if (requestingUser.role !== 'admin' && requestingUser.role !== 'super_admin'
        && rows[0].instructor_id !== requestingUser.id) {
      throw ApiError.forbidden('You do not have permission to upload a thumbnail for this course');
    }
  } else if (context === 'avatar') {
    if (requestingUser.id !== ownerId
        && requestingUser.role !== 'admin'
        && requestingUser.role !== 'super_admin') {
      throw ApiError.forbidden('You can only upload your own avatar');
    }
  }
  // assignment_submission — handled by the assignment submission route
}

/**
 * Verify the requesting user has access to a file.
 * Public files are always accessible; private files require enrollment or ownership.
 */
async function verifyFileAccess(fileId, requestingUser) {
  const { rows } = await db.query(
    'SELECT context, is_public, uploaded_by, deleted_at FROM files WHERE id = $1',
    [fileId]
  );
  const file = rows[0];
  if (!file || file.deleted_at) throw ApiError.notFound('File not found');

  if (file.is_public) return;

  if (!requestingUser) {
    throw ApiError.forbidden('Authentication required to access this file');
  }

  if (requestingUser.role === 'admin' || requestingUser.role === 'super_admin') return;

  if (file.uploaded_by === requestingUser.id) return;

  if (file.context === 'lesson_video') {
    const { rows: lessonRows } = await db.query(
      `SELECT l.course_id FROM lessons l WHERE l.video_file_id = $1 AND l.deleted_at IS NULL`,
      [fileId]
    );
    if (lessonRows.length > 0) {
      const courseId = lessonRows[0].course_id;
      const { rows: enrRows } = await db.query(
        `SELECT id FROM enrollments
         WHERE course_id = $1 AND user_id = $2 AND status = 'active'`,
        [courseId, requestingUser.id]
      );
      if (enrRows.length > 0) return;

      const { rows: courseRows } = await db.query(
        `SELECT instructor_id FROM courses WHERE id = $1`,
        [courseId]
      );
      if (courseRows.length > 0 && courseRows[0].instructor_id === requestingUser.id) return;
    }
  }

  if (file.context === 'lesson_resource') {
    const { rows: lessonRows } = await db.query(
      `SELECT l.course_id
       FROM lesson_resources lr
       JOIN lessons l ON l.id = lr.lesson_id
       WHERE lr.file_id = $1 AND l.deleted_at IS NULL`,
      [fileId]
    );
    if (lessonRows.length > 0) {
      const courseId = lessonRows[0].course_id;
      const { rows: enrRows } = await db.query(
        `SELECT id FROM enrollments
         WHERE course_id = $1 AND user_id = $2 AND status = 'active'`,
        [courseId, requestingUser.id]
      );
      if (enrRows.length > 0) return;

      const { rows: courseRows } = await db.query(
        `SELECT instructor_id FROM courses WHERE id = $1`,
        [courseId]
      );
      if (courseRows.length > 0 && courseRows[0].instructor_id === requestingUser.id) return;
    }
  }

  throw ApiError.forbidden('You do not have access to this file');
}

/**
 * Compute SHA-256 hash of a file on disk.
 */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Move a file from temp/ to its permanent location inside lmsdata/.
 */
async function saveFile({ uploadedFile, context, ownerId, uploadedBy, isPublic = false }) {
  // 1. Validate context
  if (!ALLOWED_TYPES[context]) {
    throw ApiError.badRequest(`Unknown file context: ${context}`);
  }

  // 2. Validate MIME type
  if (!ALLOWED_TYPES[context].includes(uploadedFile.mimetype)) {
    // Clean up temp file
    fs.unlink(uploadedFile.path, () => {});
    throw ApiError.badRequest(
      `File type '${uploadedFile.mimetype}' is not allowed for ${context}. ` +
      `Allowed: ${ALLOWED_TYPES[context].join(', ')}`
    );
  }

  // 3. Validate file size
  if (uploadedFile.size > MAX_SIZES[context]) {
    fs.unlink(uploadedFile.path, () => {});
    throw ApiError.badRequest(
      `File too large. Max size for ${context} is ${MAX_SIZES[context] / 1024 / 1024} MB`
    );
  }

  // 4. Compute SHA-256 hash
  const sha256 = await hashFile(uploadedFile.path);

  // 5. Deduplication check
  const existing = await db.query(
    'SELECT id, storage_path FROM files WHERE sha256_hash = $1 AND deleted_at IS NULL',
    [sha256]
  );
  if (existing.rows.length > 0) {
    // Reuse existing file record - delete the duplicate temp file
    fs.unlink(uploadedFile.path, () => {});
    console.log(`[Files] Deduplication hit for hash ${sha256.slice(0, 8)}...`);
    return existing.rows[0];
  }

  // 6. Build permanent path: lmsdata/{contextDir}/{ownerId}/
  const ext = path.extname(uploadedFile.originalname).toLowerCase();
  const storedName = `${uuidv4()}${ext}`;
  const subDir = CONTEXT_DIRS[context];
  const destDir = storage.localPath(`${subDir}/${ownerId}`);
  const storagePath = `${subDir}/${ownerId}/${storedName}`;
  const destPath = storage.localPath(storagePath);

  // 7. Ensure destination directory exists
  storage.ensureDir(destDir);

  // 8. Move file from temp/ to permanent location
  fs.renameSync(uploadedFile.path, destPath);

  // 9. Insert metadata record into DB (ONLY metadata - no file content)
  const { rows } = await db.query(
    `INSERT INTO files
       (original_name, stored_name, storage_path, mime_type, size_bytes,
        sha256_hash, storage_backend, is_public, context, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      uploadedFile.originalname,
      storedName,
      storagePath,
      uploadedFile.mimetype,
      uploadedFile.size,
      sha256,
      storage.backend,
      isPublic,
      context,
      uploadedBy,
    ]
  );

  console.log(`[Files] Saved: ${storagePath} (${(uploadedFile.size / 1024).toFixed(1)} KB)`);
  return rows[0];
}

/**
 * Serve a private file - verify the requester has access, then return the absolute path.
 * Used by the files controller to stream private files through the API.
 */
async function getFilePath(fileId) {
  const { rows } = await db.query(
    'SELECT storage_path, is_public, mime_type, size_bytes, original_name, deleted_at FROM files WHERE id = $1',
    [fileId]
  );
  const file = rows[0];
  if (!file || file.deleted_at) throw ApiError.notFound('File not found');

  const absPath = storage.localPath(file.storage_path);
  if (!fs.existsSync(absPath)) throw ApiError.notFound('File not found on disk');

  return {
    absPath,
    isPublic: file.is_public,
    mimeType: file.mime_type,
    sizeBytes: file.size_bytes,
    originalName: file.original_name,
  };
}

/**
 * Soft-delete a file record.
 * Actual file removal is handled by a background cleanup worker.
 */
async function deleteFile(fileId, deletedBy, requestingUser) {
  const { rows } = await db.query(
    'SELECT uploaded_by FROM files WHERE id = $1 AND deleted_at IS NULL',
    [fileId]
  );
  if (!rows[0]) throw ApiError.notFound('File not found');

  if (requestingUser.role !== 'admin' && requestingUser.role !== 'super_admin'
      && rows[0].uploaded_by !== requestingUser.id) {
    throw ApiError.forbidden('You do not have permission to delete this file');
  }

  await db.query(
    `UPDATE files SET deleted_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [fileId]
  );

  await db.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id)
     VALUES ($1, 'file.deleted', 'file', $2)`,
    [deletedBy, fileId]
  );
}

module.exports = { saveFile, getFilePath, deleteFile, verifyFileContextOwner, verifyFileAccess, ALLOWED_TYPES, MAX_SIZES };
