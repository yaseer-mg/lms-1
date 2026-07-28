'use strict';

const db          = require('../../config/db');
const ApiError    = require('../../shared/utils/apiError');
const eventBus    = require('../../shared/events/eventBus');
const fileService = require('../files/files.service');

// ─────────────────────────────────────────────
//  ASSIGNMENT & SUBMISSION ENGINE
// ─────────────────────────────────────────────

async function verifyCourseOwner(courseId, requestingUser) {
  const { rows } = await db.query(
    'SELECT instructor_id FROM courses WHERE id = $1 AND deleted_at IS NULL',
    [courseId]
  );
  if (!rows[0]) throw ApiError.notFound('Course not found');
  if (requestingUser.role !== 'admin' && rows[0].instructor_id !== requestingUser.id) {
    throw ApiError.forbidden('Access denied');
  }
}

async function verifyEnrolled(userId, courseId) {
  const { rows } = await db.query(
    `SELECT id FROM enrollments WHERE user_id=$1 AND course_id=$2 AND status='active'`,
    [userId, courseId]
  );
  if (!rows[0]) throw ApiError.forbidden('You must be enrolled to submit this assignment');

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

// ─────────────────────────────────────────────
//  ASSIGNMENT CRUD (Instructor)
// ─────────────────────────────────────────────

async function createAssignment(lessonId, courseId, data, requestingUser) {
  await verifyCourseOwner(courseId, requestingUser);

  const { rows: lRows } = await db.query(
    'SELECT id, type FROM lessons WHERE id=$1 AND course_id=$2 AND deleted_at IS NULL',
    [lessonId, courseId]
  );
  if (!lRows[0]) throw ApiError.notFound('Lesson not found');
  if (lRows[0].type !== 'assignment') {
    await db.query(`UPDATE lessons SET type = 'assignment', updated_at = NOW() WHERE id = $1`, [lessonId]);
  }

  const { rows } = await db.query(
    `INSERT INTO assignments
       (lesson_id, course_id, title, instructions, max_score, passing_score,
        allow_text_submission, allow_file_submission,
        max_file_size_mb, allowed_file_types, max_files, due_date,
        is_group_assignment, is_published)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      lessonId, courseId, data.title, data.instructions || null,
      data.maxScore ?? 100, data.passingScore ?? 50,
      data.allowTextSubmission ?? true, data.allowFileSubmission ?? true,
      data.maxFileSizeMb ?? 50,
      data.allowedFileTypes ? `{${data.allowedFileTypes.join(',')}}` : null,
      data.maxFiles ?? 3,
      data.dueDate || null,
      data.isGroupAssignment ?? false,
      true,
    ]
  );

  // Sync calendar event
  syncCalendarEvent(rows[0].id, courseId, data.title, data.dueDate).catch(() => {});

  // Notify enrolled students about the new assignment
  eventBus.emit('assignment.created', {
    assignmentId: rows[0].id,
    courseId,
    assignmentTitle: data.title,
  });

  return rows[0];
}

async function updateAssignment(assignmentId, data, requestingUser) {
  const { rows } = await db.query(
    `SELECT a.*, c.instructor_id FROM assignments a
     JOIN courses c ON c.id = a.course_id WHERE a.id = $1`,
    [assignmentId]
  );
  if (!rows[0]) throw ApiError.notFound('Assignment not found');
  if (requestingUser.role !== 'admin' && rows[0].instructor_id !== requestingUser.id) {
    throw ApiError.forbidden('Access denied');
  }

  const { rows: updated } = await db.query(
    `UPDATE assignments SET
       title                 = COALESCE($1,  title),
       instructions          = COALESCE($2,  instructions),
       max_score             = COALESCE($3,  max_score),
       passing_score         = COALESCE($4,  passing_score),
       allow_text_submission = COALESCE($5,  allow_text_submission),
       allow_file_submission = COALESCE($6,  allow_file_submission),
       max_file_size_mb      = COALESCE($7,  max_file_size_mb),
       max_files             = COALESCE($8,  max_files),
       due_date              = COALESCE($9,  due_date),
       is_published          = COALESCE($10, is_published),
       is_group_assignment   = COALESCE($11, is_group_assignment),
       updated_at            = NOW()
     WHERE id = $12 RETURNING *`,
    [
      data.title, data.instructions, data.maxScore, data.passingScore,
      data.allowTextSubmission, data.allowFileSubmission,
      data.maxFileSizeMb, data.maxFiles, data.dueDate,
      data.isPublished, data.isGroupAssignment, assignmentId,
    ]
  );
  // Sync calendar event with updated data
  const resolvedTitle = data.title || updated[0].title;
  const resolvedDue   = data.dueDate !== undefined ? data.dueDate : updated[0].due_date;
  syncCalendarEvent(assignmentId, updated[0].course_id, resolvedTitle, resolvedDue).catch(() => {});

  return updated[0];
}

// ─────────────────────────────────────────────
//  CALENDAR SYNC — auto-seed assignment due dates
// ─────────────────────────────────────────────

async function syncCalendarEvent(assignmentId, courseId, title, dueDate) {
  // Remove existing calendar event for this assignment
  await db.query(
    `UPDATE calendar_events SET deleted_at = NOW()
     WHERE reference_type = 'assignment' AND reference_id = $1 AND deleted_at IS NULL`,
    [assignmentId]
  );

  // Create new event if due date is set
  if (dueDate) {
    await db.query(
      `INSERT INTO calendar_events
         (title, description, event_type, start_date, end_date, all_day,
          course_id, reference_type, reference_id)
       VALUES ($1, $2, 'assignment_due', $3, $4, true, $5, 'assignment', $6)`,
      [
        `Due: ${title}`,
        `Assignment "${title}" is due`,
        dueDate, dueDate,
        courseId, assignmentId,
      ]
    );
  }
}

async function getAssignment(assignmentId, requestingUser) {
  const { rows } = await db.query(
    `SELECT a.*, c.instructor_id,
            u.first_name || ' ' || u.last_name AS instructor_name
     FROM assignments a
     JOIN courses c ON c.id = a.course_id
     JOIN users u ON u.id = c.instructor_id
     WHERE a.id = $1`,
    [assignmentId]
  );
  if (!rows[0]) throw ApiError.notFound('Assignment not found');

  const isOwner = requestingUser.role === 'admin' ||
    rows[0].instructor_id === requestingUser.id;

  // Students see published only
  if (!isOwner && !rows[0].is_published) {
    throw ApiError.notFound('Assignment not found');
  }
  return rows[0];
}

async function getAssignmentByLesson(lessonId, requestingUser) {
  const { rows } = await db.query(
    `SELECT a.*, c.instructor_id,
            u.first_name || ' ' || u.last_name AS instructor_name
     FROM assignments a
     JOIN lessons l ON l.id = a.lesson_id
     JOIN courses c ON c.id = a.course_id
     JOIN users u ON u.id = c.instructor_id
     WHERE a.lesson_id = $1 AND l.deleted_at IS NULL`,
    [lessonId]
  );
  if (!rows[0]) throw ApiError.notFound('Assignment not found');

  const isOwner = requestingUser.role === 'admin' ||
    rows[0].instructor_id === requestingUser.id;

  if (!isOwner && !rows[0].is_published) {
    throw ApiError.notFound('Assignment not found');
  }
  return rows[0];
}

// ─────────────────────────────────────────────
//  SUBMISSIONS (Student)
// ─────────────────────────────────────────────

async function submitAssignment(assignmentId, userId, textContent, uploadedFiles, groupId) {
  // 1. Load assignment
  const { rows: aRows } = await db.query(
    'SELECT * FROM assignments WHERE id=$1 AND is_published=true',
    [assignmentId]
  );
  const assignment = aRows[0];
  if (!assignment) throw ApiError.notFound('Assignment not found');

  await verifyEnrolled(userId, assignment.course_id);

  // 2. Validate group assignment requirements
  if (assignment.is_group_assignment) {
    // If no groupId provided, look up the user's group
    if (!groupId) {
      const { rows: grpRows } = await db.query(
        `SELECT gm.group_id FROM group_members gm
         JOIN course_groups g ON g.id = gm.group_id
         WHERE gm.user_id = $1 AND g.course_id = $2`,
        [userId, assignment.course_id]
      );
      if (!grpRows[0]) throw ApiError.badRequest('You must be in a group to submit a group assignment');
      groupId = grpRows[0].group_id;
    }
  }

  // 2. Validate due date
  if (assignment.due_date && new Date() > new Date(assignment.due_date)) {
    throw ApiError.badRequest('The submission deadline has passed');
  }

  // 3. Validate content
  if (!textContent && (!uploadedFiles || uploadedFiles.length === 0)) {
    throw ApiError.badRequest('Submission must include text or at least one file');
  }
  if (textContent && !assignment.allow_text_submission) {
    throw ApiError.badRequest('Text submissions are not allowed for this assignment');
  }
  if (uploadedFiles?.length > 0 && !assignment.allow_file_submission) {
    throw ApiError.badRequest('File submissions are not allowed for this assignment');
  }
  if (uploadedFiles?.length > assignment.max_files) {
    throw ApiError.badRequest(`Maximum ${assignment.max_files} files allowed`);
  }

  // 4. Handle attempt number
  let attemptNumber;
  if (assignment.is_group_assignment && groupId) {
    const { rows: prevRows } = await db.query(
      'SELECT MAX(attempt_number) AS max FROM assignment_submissions WHERE assignment_id=$1 AND group_id=$2',
      [assignmentId, groupId]
    );
    attemptNumber = (parseInt(prevRows[0]?.max || 0, 10)) + 1;
  } else {
    const { rows: prevRows } = await db.query(
      'SELECT MAX(attempt_number) AS max FROM assignment_submissions WHERE assignment_id=$1 AND user_id=$2',
      [assignmentId, userId]
    );
    attemptNumber = (parseInt(prevRows[0]?.max || 0, 10)) + 1;
  }

  // 5. Save uploaded files
  const fileIds = [];
  for (const file of (uploadedFiles || [])) {
    const saved = await fileService.saveFile({
      uploadedFile: file,
      context:      'assignment_submission',
      ownerId:      assignmentId,
      uploadedBy:   userId,
      isPublic:     false,
    });
    fileIds.push(saved.id);
  }

  // 6. Create submission
  const { rows } = await db.query(
    `INSERT INTO assignment_submissions
       (assignment_id, user_id, course_id, text_content, file_ids,
        status, attempt_number, group_id)
     VALUES ($1,$2,$3,$4,$5,'submitted',$6,$7)
     RETURNING *`,
    [
      assignmentId, userId, assignment.course_id,
      textContent || null,
      JSON.stringify(fileIds),
      attemptNumber,
      assignment.is_group_assignment ? groupId : null,
    ]
  );

  eventBus.emit('assignment.submitted', {
    submissionId: rows[0].id,
    userId, assignmentId,
    courseId: assignment.course_id,
  });

  return rows[0];
}

async function getMySubmission(assignmentId, userId) {
  const { rows: aRow } = await db.query(
    'SELECT is_group_assignment FROM assignments WHERE id = $1',
    [assignmentId]
  );

  let rows;
  if (aRow[0]?.is_group_assignment) {
    rows = (await db.query(
      `SELECT s.*, a.max_score, a.passing_score, a.title AS assignment_title,
              g.name AS group_name
       FROM assignment_submissions s
       JOIN assignments a ON a.id = s.assignment_id
       LEFT JOIN course_groups g ON g.id = s.group_id
       WHERE s.assignment_id = $1
         AND (s.user_id = $2
           OR s.group_id IN (
             SELECT group_id FROM group_members WHERE user_id = $2
           ))
       ORDER BY s.attempt_number DESC`,
      [assignmentId, userId]
    )).rows;
  } else {
    rows = (await db.query(
      `SELECT s.*, a.max_score, a.passing_score, a.title AS assignment_title
       FROM assignment_submissions s
       JOIN assignments a ON a.id = s.assignment_id
       WHERE s.assignment_id = $1 AND s.user_id = $2
       ORDER BY s.attempt_number DESC`,
      [assignmentId, userId]
    )).rows;
  }
  return rows;
}

// ─────────────────────────────────────────────
//  GRADING (Instructor)
// ─────────────────────────────────────────────

async function gradeSubmission(submissionId, score, feedback, requestingUser) {
  const { rows } = await db.query(
    `SELECT s.*, a.max_score, a.passing_score, a.lesson_id, 
            a.is_group_assignment, c.instructor_id
     FROM assignment_submissions s
     JOIN assignments a ON a.id = s.assignment_id
     JOIN courses c ON c.id = s.course_id
     WHERE s.id = $1`,
    [submissionId]
  );
  const sub = rows[0];
  if (!sub) throw ApiError.notFound('Submission not found');
  if (requestingUser.role !== 'admin' && sub.instructor_id !== requestingUser.id) {
    throw ApiError.forbidden('Access denied');
  }
  if (score > sub.max_score) {
    throw ApiError.badRequest(`Score cannot exceed max score of ${sub.max_score}`);
  }

  const scorePct = Math.round((score / sub.max_score) * 100);
  const passed   = score >= sub.passing_score;

  await db.transaction(async (client) => {
    // Update submission
    await client.query(
      `UPDATE assignment_submissions SET
         score = $1, feedback = $2, status = 'graded',
         graded_by = $3, graded_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [score, feedback || null, requestingUser.id, submissionId]
    );

    // Determine which users to grade
    let userIds = [sub.user_id];
    if (sub.is_group_assignment && sub.group_id) {
      const { rows: members } = await client.query(
        'SELECT user_id FROM group_members WHERE group_id = $1',
        [sub.group_id]
      );
      userIds = members.map(m => m.user_id);
    }

    // Upsert unified grade record for each user
    for (const uid of userIds) {
      await client.query(
        `INSERT INTO grades
           (user_id, course_id, lesson_id, submission_id, grade_type,
            score, max_score, score_pct, passed)
         VALUES ($1,$2,$3,$4,'assignment',$5,$6,$7,$8)
         ON CONFLICT (user_id, lesson_id, grade_type) DO UPDATE SET
           score=$5, max_score=$6, score_pct=$7,
           passed=$8, submission_id=$4, graded_at=NOW()`,
        [uid, sub.course_id, sub.lesson_id,
         submissionId, score, sub.max_score, scorePct, passed]
      );
    }
  });

  eventBus.emit('assignment.graded', {
    submissionId,
    userId: sub.user_id,
    courseId: sub.course_id,
    score, passed,
  });

  return { submissionId, score, scorePct, passed };
}

async function listSubmissions(assignmentId, requestingUser) {
  const { rows: aRows } = await db.query(
    `SELECT a.course_id, c.instructor_id FROM assignments a
     JOIN courses c ON c.id = a.course_id WHERE a.id = $1`,
    [assignmentId]
  );
  if (!aRows[0]) throw ApiError.notFound('Assignment not found');
  if (requestingUser.role !== 'admin' && aRows[0].instructor_id !== requestingUser.id) {
    throw ApiError.forbidden('Access denied');
  }

  const { rows } = await db.query(
    `SELECT s.id, s.user_id, s.status, s.score, s.feedback,
            s.submitted_at, s.graded_at, s.attempt_number,
            u.email, u.first_name, u.last_name
     FROM assignment_submissions s
     JOIN users u ON u.id = s.user_id
     WHERE s.assignment_id = $1
     ORDER BY s.submitted_at DESC`,
    [assignmentId]
  );
  return rows;
}

async function getSubmissionDetail(submissionId, requestingUser) {
  const { rows } = await db.query(
    `SELECT s.*, a.title AS assignment_title, a.max_score, a.passing_score,
            c.instructor_id,
            u.email, u.first_name, u.last_name
     FROM assignment_submissions s
     JOIN assignments a ON a.id = s.assignment_id
     JOIN courses c ON c.id = s.course_id
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [submissionId]
  );
  const sub = rows[0];
  if (!sub) throw ApiError.notFound('Submission not found');

  const canView = requestingUser.role === 'admin' ||
    sub.instructor_id === requestingUser.id ||
    sub.user_id === requestingUser.id;
  if (!canView) throw ApiError.forbidden('Access denied');

  // Resolve file details
  const fileIds = sub.file_ids || [];
  if (fileIds.length > 0) {
    const { rows: files } = await db.query(
      `SELECT id, original_name, storage_path, mime_type, size_bytes
       FROM files WHERE id = ANY($1)`,
      [fileIds]
    );
    sub.files = files;
  } else {
    sub.files = [];
  }

  return sub;
}

// ─────────────────────────────────────────────
//  GRADEBOOK (Student / Instructor view)
// ─────────────────────────────────────────────

async function getGradebook(courseId, targetUserId, requestingUser) {
  // Student can only see their own; instructor sees any
  if (requestingUser.role === 'student' && requestingUser.id !== targetUserId) {
    throw ApiError.forbidden('Access denied');
  }

  // Check show_grades_to_student for students
  if (requestingUser.role === 'student') {
    const { rows: courseRows } = await db.query(
      'SELECT show_grades_to_student FROM courses WHERE id = $1',
      [courseId]
    );
    if (courseRows[0] && !courseRows[0].show_grades_to_student) {
      throw ApiError.forbidden('Grades are not visible to students for this course');
    }
  }

  const { rows } = await db.query(
    `SELECT
       g.id, g.grade_type, g.score, g.max_score, g.score_pct, g.passed, g.graded_at,
       l.title AS lesson_title, l.type AS lesson_type,
       s.title AS section_title
     FROM grades g
     JOIN lessons l ON l.id = g.lesson_id
     JOIN sections s ON s.id = l.section_id
     WHERE g.user_id = $1 AND g.course_id = $2
     ORDER BY s.sort_order, l.sort_order`,
    [targetUserId, courseId]
  );

  const totalScore = rows.reduce((sum, g) => sum + parseFloat(g.score), 0);
  const maxScore   = rows.reduce((sum, g) => sum + parseFloat(g.max_score), 0);
  const overallPct = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  return {
    grades: rows,
    summary: {
      totalScore,
      maxScore,
      overallPct,
      gradedItems: rows.length,
      passed: rows.filter(g => g.passed).length,
      failed: rows.filter(g => !g.passed).length,
    },
  };
}

async function getCourseGradebook(courseId, requestingUser) {
  await verifyCourseOwner(courseId, requestingUser);

  // Get all enrolled students
  const { rows: students } = await db.query(
    `SELECT u.id, u.first_name, u.last_name, u.email
     FROM enrollments e
     JOIN users u ON u.id = e.user_id
     WHERE e.course_id = $1 AND e.status = 'active'
     ORDER BY u.last_name, u.first_name`,
    [courseId]
  );

  // Get all graded-item lessons (columns) — quizzes & assignments, regardless of grades or publish status
  const { rows: columns } = await db.query(
    `SELECT l.id AS lesson_id, l.title AS lesson_title, l.type AS lesson_type,
            COALESCE(a.max_score, (SELECT COALESCE(SUM(points), 100) FROM quiz_questions WHERE quiz_id = qz.id), 100) AS max_score,
            s.title AS section_title
     FROM lessons l
     JOIN sections s ON s.id = l.section_id
     LEFT JOIN assignments a ON a.lesson_id = l.id
     LEFT JOIN quizzes qz ON qz.lesson_id = l.id
     WHERE l.course_id = $1
       AND l.deleted_at IS NULL
       AND (a.id IS NOT NULL OR qz.id IS NOT NULL)
     ORDER BY s.sort_order, l.sort_order`,
    [courseId]
  );

  if (students.length === 0) {
    return { graderows: [], columns: [] };
  }

  // Get all grades for this course
  const studentIds = students.map(s => s.id);
  const { rows: allGrades } = await db.query(
    `SELECT g.user_id, g.lesson_id, g.score, g.max_score, g.score_pct,
            g.passed, g.grade_type, g.graded_at
     FROM grades g
     WHERE g.course_id = $1 AND g.user_id = ANY($2::uuid[])
     ORDER BY g.user_id, g.lesson_id`,
    [courseId, studentIds]
  );

  // Index grades by {userId_lessonId}
  const gradeMap = {};
  for (const g of allGrades) {
    gradeMap[`${g.user_id}_${g.lesson_id}`] = g;
  }

  // Build rows
  const graderows = students.map(student => {
    const rowGrades = {};
    let totalScore = 0, maxScore = 0, gradedItems = 0, passed = 0, failed = 0;

    for (const col of columns) {
      const key = `${student.id}_${col.lesson_id}`;
      const g = gradeMap[key];
      rowGrades[col.lesson_id] = g
        ? { score: parseFloat(g.score), maxScore: parseFloat(g.max_score), scorePct: parseFloat(g.score_pct), passed: g.passed, gradeType: g.grade_type }
        : null;
      if (g) {
        totalScore += parseFloat(g.score);
        maxScore += parseFloat(g.max_score);
        gradedItems++;
        if (g.passed) passed++; else failed++;
      }
    }

    return {
      student: {
        id: student.id,
        firstName: student.first_name,
        lastName: student.last_name,
        email: student.email,
      },
      grades: rowGrades,
      summary: {
        totalScore,
        maxScore,
        overallPct: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0,
        gradedItems,
        passed,
        failed,
      },
    };
  });

  return { graderows, columns };
}

// ─────────────────────────────────────────────
//  LIST ASSIGNMENTS BY COURSE (Instructor)
// ─────────────────────────────────────────────

async function listCourseAssignments(courseId, requestingUser) {
  await verifyCourseOwner(courseId, requestingUser);
  const { rows } = await db.query(
    `SELECT a.*, l.title AS lesson_title,
            COUNT(asb.id) AS submission_count,
            COUNT(asb.id) FILTER (WHERE asb.status = 'graded') AS graded_count
     FROM assignments a
     JOIN lessons l ON l.id = a.lesson_id
     LEFT JOIN assignment_submissions asb ON asb.assignment_id = a.id
     WHERE a.course_id = $1
     GROUP BY a.id, l.title
     ORDER BY a.created_at DESC`,
    [courseId]
  );
  return rows;
}

module.exports = {
  createAssignment, updateAssignment,
  getAssignment, getAssignmentByLesson,
  submitAssignment, getMySubmission,
  gradeSubmission, listSubmissions, getSubmissionDetail,
  getGradebook, getCourseGradebook,
  listCourseAssignments,
};