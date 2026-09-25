'use strict';

const db          = require('../../config/db');
const ApiError    = require('../../shared/utils/apiError');
const fileService = require('../files/files.service');
const avail       = require('./availability.service');

function isCourseManager(user, instructorId) {
  return user.role === 'admin' || user.role === 'super_admin' || user.id === instructorId;
}

// ── Helper: verify course ownership ──────────
async function verifyCourseOwner(courseId, requestingUser) {
  const { rows } = await db.query(
    'SELECT id, instructor_id FROM courses WHERE id = $1 AND deleted_at IS NULL',
    [courseId]
  );
  const course = rows[0];
  if (!course) {
    throw ApiError.notFound('Course not found');
  }

  if (!isCourseManager(requestingUser, course.instructor_id)) {
    throw ApiError.forbidden('You do not have permission to modify this course');
  }

  return course;
}

// ── Helper: verify enrollment ─────────────────
async function verifyEnrollment(userId, courseId) {
  const { rows } = await db.query(
    `SELECT id FROM enrollments
     WHERE user_id = $1 AND course_id = $2 AND status = 'active'`,
    [userId, courseId]
  );
  return rows.length > 0;
}

// ── Helper: update lesson/course counts ───────
async function updateCourseMeta(courseId, client = db) {
  await client.query(
    `UPDATE courses SET
       lesson_count = (
         SELECT COUNT(*) FROM lessons
         WHERE course_id = $1 AND deleted_at IS NULL
       ),
       duration_seconds = (
         SELECT COALESCE(SUM(duration_seconds), 0) FROM lessons
         WHERE course_id = $1 AND deleted_at IS NULL
       ),
       updated_at = NOW()
     WHERE id = $1`,
    [courseId]
  );
}

// ── Create lesson ─────────────────────────────
async function createLesson(courseId, sectionId, data, requestingUser) {
  await verifyCourseOwner(courseId, requestingUser);

  const { rows: secRows } = await db.query(
    'SELECT id FROM sections WHERE id = $1 AND course_id = $2',
    [sectionId, courseId]
  );
  if (!secRows[0]) {
    throw ApiError.notFound('Section not found in this course');
  }

  const { rows: orderRows } = await db.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM lessons WHERE section_id = $1',
    [sectionId]
  );

  const { rows } = await db.query(
    `INSERT INTO lessons
       (section_id, course_id, title, type, content, duration_seconds,
        sort_order, is_published, video_source, youtube_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      sectionId,
      courseId,
      data.title,
      data.type || 'video',
      data.content || null,
      data.durationSeconds || 0,
      orderRows[0].next,
      data.isPublished !== undefined ? data.isPublished : true,
      data.videoSource || 'upload',
      data.youtubeId || null,
    ]
  );

  await updateCourseMeta(courseId);
  return rows[0];
}

// ── Get lesson (with enrollment check) ────────
async function getLesson(lessonId, courseId, requestingUser) {
  const { rows } = await db.query(
    `SELECT l.*, f.storage_path AS video_path,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', lr.id,
                  'title', lr.title,
                  'file_id', lr.file_id,
                  'sort_order', lr.sort_order
                ) ORDER BY lr.sort_order
              ) FILTER (WHERE lr.id IS NOT NULL),
              '[]'::json
            ) AS resources
     FROM lessons l
     LEFT JOIN files f ON f.id = l.video_file_id
     LEFT JOIN lesson_resources lr ON lr.lesson_id = l.id
     WHERE l.id = $1 AND l.course_id = $2 AND l.deleted_at IS NULL
     GROUP BY l.id, f.storage_path`,
    [lessonId, courseId]
  );
  const lesson = rows[0];
  if (!lesson || !lesson.is_published) {
    throw ApiError.notFound('Lesson not found');
  }

  const enrolled = await verifyEnrollment(requestingUser.id, courseId);
  let isOwner = false;
  if (!enrolled) {
    isOwner = requestingUser.role === 'admin' || requestingUser.role === 'super_admin' ||
      await db.query(
        'SELECT id FROM courses WHERE id = $1 AND instructor_id = $2',
        [courseId, requestingUser.id]
      ).then((result) => result.rows.length > 0);

    if (!isOwner) {
      throw ApiError.forbidden('You must be enrolled to access this lesson');
    }
  }

  // Check course date restrictions for non-owners
  if (!isOwner) {
    const { rows: courseRows } = await db.query(
      'SELECT start_date, end_date FROM courses WHERE id = $1',
      [courseId]
    );
    const course = courseRows[0];
    const now = new Date();
    if (course) {
      if (course.start_date && new Date(course.start_date) > now) {
        throw ApiError.forbidden(`This course starts on ${new Date(course.start_date).toLocaleDateString()}`);
      }
      if (course.end_date && new Date(course.end_date) < now) {
        throw ApiError.forbidden('This course has ended');
      }
    }
  }

  // Check conditional availability for enrolled students
  if (enrolled && !isOwner) {
    const availability = await avail.getAvailability(lessonId);
    if (availability && availability.conditions && availability.conditions.length > 0) {
      const evaluation = await avail.evaluateConditions(requestingUser.id, availability.conditions);
      if (!evaluation.accessible) {
        throw ApiError.forbidden(
          evaluation.reasons.join('; ') || 'This lesson is not yet available'
        );
      }
    }
  }

  return lesson;
}

// ── Get lesson preview (public, published-only) ─
async function getPreview(lessonId, courseId) {
  const { rows } = await db.query(
    `SELECT l.id, l.title, l.type, l.duration_seconds,
            l.video_source, l.youtube_id,
            f.storage_path AS video_path
     FROM lessons l
     LEFT JOIN files f ON f.id = l.video_file_id
     WHERE l.id = $1 AND l.course_id = $2
       AND l.is_published = true AND l.deleted_at IS NULL`,
    [lessonId, courseId]
  );
  if (!rows[0]) {
    throw ApiError.forbidden('This lesson is not available for preview');
  }
  return rows[0];
}

// ── Update lesson ─────────────────────────────
async function updateLesson(lessonId, courseId, updates, requestingUser) {
  await verifyCourseOwner(courseId, requestingUser);

  const sets   = [];
  const params = [lessonId, courseId];
  const add = (column, value) => {
    if (value !== undefined) {
      sets.push(`${column} = $${params.length + 1}`);
      params.push(value);
    }
  };

  add('title', updates.title);
  add('content', updates.content);
  add('duration_seconds', updates.durationSeconds);
  add('is_published', updates.isPublished);
  if (updates.videoSource !== undefined) {
    add('video_source', updates.videoSource);
    add('youtube_id', updates.youtubeId);
  }
  if (sets.length === 0) {
    throw ApiError.badRequest('No fields to update');
  }
  sets.push('updated_at = NOW()');

  const { rows } = await db.query(
    `UPDATE lessons SET ${sets.join(', ')}
     WHERE id = $1 AND course_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    params
  );
  if (!rows[0]) {
    throw ApiError.notFound('Lesson not found');
  }

  await updateCourseMeta(courseId);
  return rows[0];
}

// ── Delete lesson ─────────────────────────────
async function deleteLesson(lessonId, courseId, requestingUser) {
  await verifyCourseOwner(courseId, requestingUser);

  const { rows } = await db.query(
    'UPDATE lessons SET deleted_at = NOW() WHERE id = $1 AND course_id = $2 AND deleted_at IS NULL RETURNING id',
    [lessonId, courseId]
  );
  if (!rows[0]) {
    throw ApiError.notFound('Lesson not found');
  }

  await updateCourseMeta(courseId);
}

// ── Reorder lessons in a section ──────────────
async function reorderLessons(courseId, sectionId, orderedIds, requestingUser) {
  await verifyCourseOwner(courseId, requestingUser);

  await db.transaction(async (client) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        'UPDATE lessons SET sort_order = $1 WHERE id = $2 AND section_id = $3 AND course_id = $4',
        [i, orderedIds[i], sectionId, courseId]
      );
    }
  });
}

// ── Upload video to a lesson ──────────────────
async function uploadVideo(lessonId, courseId, uploadedFile, uploadedBy, requestingUser) {
  await verifyCourseOwner(courseId, requestingUser);

  const { rows } = await db.query(
    'SELECT id FROM lessons WHERE id = $1 AND course_id = $2 AND deleted_at IS NULL',
    [lessonId, courseId]
  );
  if (!rows[0]) {
    throw ApiError.notFound('Lesson not found');
  }

  const file = await fileService.saveFile({
    uploadedFile,
    context: 'lesson_video',
    ownerId: lessonId,
    uploadedBy,
    isPublic: false,
  });

  await db.query(
    'UPDATE lessons SET video_file_id = $1, updated_at = NOW() WHERE id = $2',
    [file.id, lessonId]
  );
  return file;
}

// ── Upload resource (PDF etc) to lesson ───────
async function uploadResource(lessonId, courseId, uploadedFile, uploadedBy, title, requestingUser) {
  await verifyCourseOwner(courseId, requestingUser);

  const { rows } = await db.query(
    'SELECT id FROM lessons WHERE id = $1 AND course_id = $2 AND deleted_at IS NULL',
    [lessonId, courseId]
  );
  if (!rows[0]) {
    throw ApiError.notFound('Lesson not found');
  }

  const file = await fileService.saveFile({
    uploadedFile,
    context: 'lesson_resource',
    ownerId: lessonId,
    uploadedBy,
    isPublic: false,
  });

  const { rows: orderRows } = await db.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM lesson_resources WHERE lesson_id = $1',
    [lessonId]
  );

  const { rows: res } = await db.query(
    `INSERT INTO lesson_resources (lesson_id, file_id, title, sort_order)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [lessonId, file.id, title || uploadedFile.originalname, orderRows[0].next]
  );
  return res[0];
}

// ── Delete resource ───────────────────────────
async function deleteResource(lessonId, courseId, resourceId, requestingUser) {
  await verifyCourseOwner(courseId, requestingUser);

  const { rows } = await db.query(
    'DELETE FROM lesson_resources WHERE id = $1 AND lesson_id = $2 RETURNING id, file_id',
    [resourceId, lessonId]
  );
  if (!rows[0]) {
    throw ApiError.notFound('Resource not found');
  }

  await fileService.deleteFile(rows[0].file_id, requestingUser.id);
}

module.exports = {
  createLesson,
  getLesson,
  getPreview,
  updateLesson,
  deleteLesson,
  reorderLessons,
  uploadVideo,
  uploadResource,
  deleteResource,
};
