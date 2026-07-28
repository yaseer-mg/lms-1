'use strict';

const db       = require('../../config/db');
const ApiError = require('../../shared/utils/apiError');
const eventBus = require('../../shared/events/eventBus');

// ─────────────────────────────────────────────
//  QUIZ BY LESSON (Student-facing)
// ─────────────────────────────────────────────

async function getQuizByLesson(lessonId, userId) {
  const { rows: lRows } = await db.query(
    `SELECT id, course_id FROM lessons WHERE id = $1 AND deleted_at IS NULL AND type = 'quiz'`,
    [lessonId]
  );
  if (!lRows[0]) throw ApiError.notFound('Quiz lesson not found');

  await verifyEnrolled(userId, lRows[0].course_id);

  const { rows: qRows } = await db.query(
    `SELECT q.* FROM quizzes q
     WHERE q.lesson_id = $1 AND q.is_published = true
     ORDER BY q.created_at DESC LIMIT 1`,
    [lessonId]
  );
  if (!qRows[0]) throw ApiError.notFound('No published quiz found for this lesson');

  const quiz = qRows[0];

  const { rows: questions } = await db.query(
    'SELECT id, type, question_text, options, points, sort_order FROM quiz_questions WHERE quiz_id = $1 ORDER BY sort_order',
    [quiz.id]
  );

  const questionsForStudent = questions.map(q => ({
    id:           q.id,
    type:         q.type,
    questionText: q.question_text,
    points:       q.points,
    options:      q.options.map(o => ({ id: o.id, text: o.text })),
  }));

  const { rows: activeRows } = await db.query(
    `SELECT id, attempt_number, started_at FROM quiz_attempts
     WHERE quiz_id = $1 AND user_id = $2 AND status = 'in_progress'
     LIMIT 1`,
    [quiz.id, userId]
  );

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) AS count FROM quiz_attempts
     WHERE quiz_id = $1 AND user_id = $2 AND status NOT IN ('in_progress', 'abandoned')`,
    [quiz.id, userId]
  );
  const usedAttempts = parseInt(countRows[0].count, 10);

  return {
    quiz: {
      id: quiz.id,
      lessonId: quiz.lesson_id,
      title: quiz.title,
      description: quiz.description,
      maxAttempts: quiz.max_attempts,
      timeLimitMins: quiz.time_limit_mins,
      passingScorePct: quiz.passing_score_pct,
      shuffleQuestions: quiz.shuffle_questions,
      shuffleOptions: quiz.shuffle_options,
    },
    questions: questionsForStudent,
    activeAttempt: activeRows[0] || null,
    usedAttempts,
  };
}

// ─────────────────────────────────────────────
//  QUIZ ENGINE
// ─────────────────────────────────────────────

// ── Helpers ───────────────────────────────────

async function verifyCourseOwner(courseId, requestingUser) {
  const { rows } = await db.query(
    'SELECT id, instructor_id FROM courses WHERE id = $1 AND deleted_at IS NULL',
    [courseId]
  );
  if (!rows[0]) throw ApiError.notFound('Course not found');
  if (requestingUser.role !== 'admin' && rows[0].instructor_id !== requestingUser.id) {
    throw ApiError.forbidden('You do not have permission to modify this course');
  }
}

async function verifyEnrolled(userId, courseId) {
  const { rows } = await db.query(
    `SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND status = 'active'`,
    [userId, courseId]
  );
  if (!rows[0]) throw ApiError.forbidden('You must be enrolled to access this assessment');

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

  return rows[0];
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Auto-grade a single question ──────────────
function gradeQuestion(question, selectedOptions) {
  if (question.type === 'short_answer') {
    return { isCorrect: null, pointsEarned: 0 }; // manual grading
  }

  const correct = question.options
    .filter(o => o.is_correct)
    .map(o => o.id)
    .sort();
  const selected = [...selectedOptions].sort();

  let isCorrect = false;

  if (question.type === 'multiple_choice' || question.type === 'true_false') {
    isCorrect = selected.length === 1 && selected[0] === correct[0];
  } else if (question.type === 'multi_select') {
    isCorrect = JSON.stringify(selected) === JSON.stringify(correct);
  }

  return {
    isCorrect,
    pointsEarned: isCorrect ? question.points : 0,
  };
}

// ─────────────────────────────────────────────
//  QUIZ CRUD (Instructor)
// ─────────────────────────────────────────────

async function createQuiz(lessonId, courseId, data, requestingUser) {
  await verifyCourseOwner(courseId, requestingUser);

  // Verify lesson belongs to course and is type 'quiz'
  const { rows: lRows } = await db.query(
    `SELECT id, type FROM lessons WHERE id = $1 AND course_id = $2 AND deleted_at IS NULL`,
    [lessonId, courseId]
  );
  if (!lRows[0]) throw ApiError.notFound('Lesson not found');
  if (lRows[0].type !== 'quiz') {
    await db.query(`UPDATE lessons SET type = 'quiz', updated_at = NOW() WHERE id = $1`, [lessonId]);
  }

  const { rows } = await db.query(
    `INSERT INTO quizzes
       (lesson_id, course_id, title, description, max_attempts, time_limit_mins,
        passing_score_pct, shuffle_questions, shuffle_options, show_answers_after,
        is_published)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      lessonId, courseId,
      data.title, data.description || null,
      data.maxAttempts ?? 1,
      data.timeLimitMins ?? null,
      data.passingScorePct ?? 70,
      data.shuffleQuestions ?? false,
      data.shuffleOptions ?? false,
      data.showAnswersAfter ?? true,
      data.isPublished ?? true,
    ]
  );

  eventBus.emit('quiz.created', {
    quizId: rows[0].id,
    courseId,
    quizTitle: data.title || rows[0].title,
  });

  return rows[0];
}

async function updateQuiz(quizId, data, requestingUser) {
  const { rows: qRows } = await db.query(
    'SELECT q.*, c.instructor_id FROM quizzes q JOIN courses c ON c.id = q.course_id WHERE q.id = $1',
    [quizId]
  );
  if (!qRows[0]) throw ApiError.notFound('Quiz not found');
  if (requestingUser.role !== 'admin' && qRows[0].instructor_id !== requestingUser.id) {
    throw ApiError.forbidden('Access denied');
  }

  const { rows } = await db.query(
    `UPDATE quizzes SET
       title              = COALESCE($1, title),
       description        = COALESCE($2, description),
       max_attempts       = COALESCE($3, max_attempts),
       time_limit_mins    = COALESCE($4, time_limit_mins),
       passing_score_pct  = COALESCE($5, passing_score_pct),
       shuffle_questions  = COALESCE($6, shuffle_questions),
       shuffle_options    = COALESCE($7, shuffle_options),
       show_answers_after = COALESCE($8, show_answers_after),
       is_published       = COALESCE($9, is_published),
       updated_at         = NOW()
     WHERE id = $10 RETURNING *`,
    [
      data.title, data.description, data.maxAttempts, data.timeLimitMins,
      data.passingScorePct, data.shuffleQuestions, data.shuffleOptions,
      data.showAnswersAfter, data.isPublished, quizId,
    ]
  );
  return rows[0];
}

async function getQuizForInstructor(quizId, requestingUser) {
  const { rows } = await db.query(
    `SELECT q.*, json_agg(
       json_build_object(
         'id', qq.id, 'type', qq.type, 'question_text', qq.question_text,
         'options', qq.options, 'model_answer', qq.model_answer,
         'explanation', qq.explanation, 'points', qq.points, 'sort_order', qq.sort_order
       ) ORDER BY qq.sort_order
     ) FILTER (WHERE qq.id IS NOT NULL) AS questions
     FROM quizzes q
     LEFT JOIN quiz_questions qq ON qq.quiz_id = q.id
     WHERE q.id = $1
     GROUP BY q.id`,
    [quizId]
  );
  if (!rows[0]) throw ApiError.notFound('Quiz not found');

  const { rows: cRows } = await db.query(
    'SELECT instructor_id FROM courses WHERE id = $1', [rows[0].course_id]
  );
  if (requestingUser.role !== 'admin' && cRows[0]?.instructor_id !== requestingUser.id) {
    throw ApiError.forbidden('Access denied');
  }
  return rows[0];
}

// ── Question management ───────────────────────

async function addQuestion(quizId, data, requestingUser) {
  const { rows: qRows } = await db.query(
    'SELECT q.course_id, c.instructor_id FROM quizzes q JOIN courses c ON c.id = q.course_id WHERE q.id = $1',
    [quizId]
  );
  if (!qRows[0]) throw ApiError.notFound('Quiz not found');
  if (requestingUser.role !== 'admin' && qRows[0].instructor_id !== requestingUser.id) {
    throw ApiError.forbidden('Access denied');
  }

  // Validate options for objective questions
  if (data.type !== 'short_answer') {
    if (!Array.isArray(data.options) || data.options.length < 2) {
      throw ApiError.badRequest('At least 2 options required for this question type');
    }
    const hasCorrect = data.options.some(o => o.is_correct);
    if (!hasCorrect) throw ApiError.badRequest('At least one option must be marked correct');

    if (data.type === 'multiple_choice' || data.type === 'true_false') {
      const correctCount = data.options.filter(o => o.is_correct).length;
      if (correctCount !== 1) throw ApiError.badRequest('Exactly one correct answer for this question type');
    }
  }

  const { rows: orderRows } = await db.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM quiz_questions WHERE quiz_id = $1',
    [quizId]
  );

  const { rows } = await db.query(
    `INSERT INTO quiz_questions
       (quiz_id, type, question_text, options, model_answer, explanation, points, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      quizId, data.type, data.questionText,
      JSON.stringify(data.options || []),
      data.modelAnswer || null, data.explanation || null,
      data.points ?? 1, orderRows[0].next,
    ]
  );
  return rows[0];
}

async function updateQuestion(questionId, data, requestingUser) {
  const { rows: qRows } = await db.query(
    `SELECT qq.*, c.instructor_id FROM quiz_questions qq
     JOIN quizzes q ON q.id = qq.quiz_id
     JOIN courses c ON c.id = q.course_id
     WHERE qq.id = $1`,
    [questionId]
  );
  if (!qRows[0]) throw ApiError.notFound('Question not found');
  if (requestingUser.role !== 'admin' && qRows[0].instructor_id !== requestingUser.id) {
    throw ApiError.forbidden('Access denied');
  }

  const { rows } = await db.query(
    `UPDATE quiz_questions SET
       question_text = COALESCE($1, question_text),
       options       = COALESCE($2, options),
       model_answer  = COALESCE($3, model_answer),
       explanation   = COALESCE($4, explanation),
       points        = COALESCE($5, points),
       sort_order    = COALESCE($6, sort_order)
     WHERE id = $7 RETURNING *`,
    [
      data.questionText, data.options ? JSON.stringify(data.options) : null,
      data.modelAnswer, data.explanation, data.points, data.sortOrder, questionId,
    ]
  );
  return rows[0];
}

async function deleteQuestion(questionId, requestingUser) {
  const { rows } = await db.query(
    `SELECT qq.id, c.instructor_id FROM quiz_questions qq
     JOIN quizzes q ON q.id = qq.quiz_id
     JOIN courses c ON c.id = q.course_id
     WHERE qq.id = $1`,
    [questionId]
  );
  if (!rows[0]) throw ApiError.notFound('Question not found');
  if (requestingUser.role !== 'admin' && rows[0].instructor_id !== requestingUser.id) {
    throw ApiError.forbidden('Access denied');
  }
  await db.query('DELETE FROM quiz_questions WHERE id = $1', [questionId]);
}

// ─────────────────────────────────────────────
//  QUIZ ATTEMPT ENGINE (Student)
// ─────────────────────────────────────────────

async function startAttempt(quizId, userId) {
  // 1. Load quiz
  const { rows: qRows } = await db.query(
    `SELECT q.*, l.course_id FROM quizzes q
     JOIN lessons l ON l.id = q.lesson_id
     WHERE q.id = $1 AND q.is_published = true`,
    [quizId]
  );
  const quiz = qRows[0];
  if (!quiz) throw ApiError.notFound('Quiz not found or not published');

  await verifyEnrolled(userId, quiz.course_id);

  // 2. Check attempt limit (exclude abandoned and in_progress)
  const { rows: attemptRows } = await db.query(
    `SELECT COUNT(*) AS count FROM quiz_attempts
     WHERE quiz_id = $1 AND user_id = $2 AND status NOT IN ('in_progress', 'abandoned')`,
    [quizId, userId]
  );
  const usedAttempts = parseInt(attemptRows[0].count, 10);
  if (quiz.max_attempts !== null && usedAttempts >= quiz.max_attempts) {
    throw ApiError.badRequest(
      `You have used all ${quiz.max_attempts} attempt(s) for this quiz`
    );
  }

  // 3. Abandon any stale in_progress attempt
  await db.query(
    `UPDATE quiz_attempts SET
       status = 'abandoned',
       submitted_at = NOW(),
       time_taken_secs = EXTRACT(EPOCH FROM NOW() - started_at)::INTEGER
     WHERE quiz_id = $1 AND user_id = $2 AND status = 'in_progress'`,
    [quizId, userId]
  );

  // 4. Load questions (shuffle if configured)
  const { rows: questions } = await db.query(
    'SELECT id, type, question_text, options, points, sort_order FROM quiz_questions WHERE quiz_id = $1 ORDER BY sort_order',
    [quizId]
  );
  if (questions.length === 0) throw ApiError.badRequest('This quiz has no questions yet');

  const orderedQuestions = quiz.shuffle_questions ? shuffleArray(questions) : questions;

  // Shuffle options within each question if configured
  const questionsForStudent = orderedQuestions.map(q => {
    const opts = quiz.shuffle_options ? shuffleArray(q.options) : q.options;
    return {
      id:           q.id,
      type:         q.type,
      questionText: q.question_text,
      points:       q.points,
      // Strip is_correct from options — student must not see answers
      options: opts.map(o => ({ id: o.id, text: o.text })),
    };
  });

  const totalPoints    = questions.reduce((sum, q) => sum + q.points, 0);
  const { rows: maxRow } = await db.query(
    `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next FROM quiz_attempts
     WHERE quiz_id = $1 AND user_id = $2`,
    [quizId, userId]
  );
  const attemptNumber  = maxRow[0].next;
  const questionOrder  = orderedQuestions.map(q => q.id);

  // 5. Create attempt record
  const { rows: atmRows } = await db.query(
    `INSERT INTO quiz_attempts
       (quiz_id, user_id, course_id, attempt_number, total_points, question_order, status)
     VALUES ($1,$2,$3,$4,$5,$6,'in_progress')
     RETURNING id, attempt_number, started_at`,
    [quizId, userId, quiz.course_id, attemptNumber,
     totalPoints, JSON.stringify(questionOrder)]
  );

  return {
    attemptId:     atmRows[0].id,
    attemptNumber: atmRows[0].attempt_number,
    startedAt:     atmRows[0].started_at,
    timeLimitMins: quiz.time_limit_mins,
    totalPoints,
    questions:     questionsForStudent,
  };
}

async function submitAttempt(attemptId, userId, answers) {
  // answers: [{ questionId, selectedOptions: ['a'] }, ...]

  // 1. Load attempt
  const { rows: atmRows } = await db.query(
    `SELECT qa.*, q.passing_score_pct, q.show_answers_after, q.time_limit_mins, q.lesson_id
     FROM quiz_attempts qa
     JOIN quizzes q ON q.id = qa.quiz_id
     WHERE qa.id = $1 AND qa.user_id = $2`,
    [attemptId, userId]
  );
  const attempt = atmRows[0];
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (attempt.status !== 'in_progress') {
    throw ApiError.badRequest('This attempt has already been submitted');
  }

  // 2. Check time limit
  if (attempt.time_limit_mins) {
    const elapsed = (Date.now() - new Date(attempt.started_at).getTime()) / 1000 / 60;
    if (elapsed > attempt.time_limit_mins + 1) { // 1 min grace
      // Auto-submit whatever answers were given
    }
  }

  // 3. Load full questions with correct answers
  const { rows: questions } = await db.query(
    'SELECT * FROM quiz_questions WHERE quiz_id = $1',
    [attempt.quiz_id]
  );
  const questionMap = Object.fromEntries(questions.map(q => [q.id, q]));

  // 4. Grade each answer
  let earnedPoints  = 0;
  let hasShortAnswer = false;
  const answerInserts = [];

  for (const answer of answers) {
    const question = questionMap[answer.questionId];
    if (!question) continue;

    const { isCorrect, pointsEarned } = gradeQuestion(question, answer.selectedOptions || []);
    if (question.type === 'short_answer') hasShortAnswer = true;

    earnedPoints += pointsEarned;
    answerInserts.push([
      attemptId, answer.questionId,
      JSON.stringify(answer.selectedOptions || []),
      isCorrect, pointsEarned,
    ]);
  }

  const timeTaken = Math.floor((Date.now() - new Date(attempt.started_at).getTime()) / 1000);
  const scorePct  = attempt.total_points > 0
    ? Math.round((earnedPoints / attempt.total_points) * 100)
    : 0;
  const passed    = hasShortAnswer ? null : scorePct >= attempt.passing_score_pct;

  // 5. Save answers + update attempt in transaction
  await db.transaction(async (client) => {
    // Insert all answers
    for (const [aId, qId, sel, corr, pts] of answerInserts) {
      await client.query(
        `INSERT INTO quiz_answers (attempt_id, question_id, selected_options, is_correct, points_earned)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (attempt_id, question_id) DO UPDATE
         SET selected_options = $3, is_correct = $4, points_earned = $5`,
        [aId, qId, sel, corr, pts]
      );
    }

    // Update attempt
    await client.query(
      `UPDATE quiz_attempts SET
         earned_points  = $1,
         score_pct      = $2,
         passed         = $3,
         submitted_at   = NOW(),
         time_taken_secs = $4,
         status         = $5
       WHERE id = $6`,
      [earnedPoints, scorePct, passed, timeTaken,
       hasShortAnswer ? 'grading' : 'graded', attemptId]
    );

    // Upsert unified grade (skip if short_answer pending manual grade)
    if (!hasShortAnswer) {
      await client.query(
        `INSERT INTO grades
           (user_id, course_id, lesson_id, quiz_attempt_id, grade_type,
            score, max_score, score_pct, passed)
         VALUES ($1,$2,$3,$4,'quiz',$5,$6,$7,$8)
         ON CONFLICT (user_id, lesson_id, grade_type) DO UPDATE SET
           score = $5, max_score = $6, score_pct = $7,
           passed = $8, quiz_attempt_id = $4, graded_at = NOW()`,
        [userId, attempt.course_id, attempt.lesson_id,
         attemptId, earnedPoints, attempt.total_points, scorePct, passed]
      );
    }
  });

  // 6. Build result — include correct answers if show_answers_after = true
  const result = {
    attemptId,
    earnedPoints,
    totalPoints: attempt.total_points,
    scorePct,
    passed,
    timeTakenSecs: timeTaken,
    status: hasShortAnswer ? 'grading' : 'graded',
  };

  if (attempt.show_answers_after && !hasShortAnswer) {
    result.questions = questions.map(q => ({
      id:           q.id,
      questionText: q.question_text,
      type:         q.type,
      points:       q.points,
      options:      q.options,        // with is_correct revealed
      explanation:  q.explanation,
      studentAnswer: answers.find(a => a.questionId === q.id)?.selectedOptions || [],
    }));
  }

  eventBus.emit('quiz.submitted', {
    userId, quizId: attempt.quiz_id,
    courseId: attempt.course_id,
    passed, scorePct,
  });

  return result;
}

async function getAttemptResult(attemptId, userId) {
  const { rows } = await db.query(
    `SELECT qa.*, q.show_answers_after, q.passing_score_pct, q.title AS quiz_title
     FROM quiz_attempts qa
     JOIN quizzes q ON q.id = qa.quiz_id
     WHERE qa.id = $1 AND qa.user_id = $2`,
    [attemptId, userId]
  );
  if (!rows[0]) throw ApiError.notFound('Attempt not found');
  const attempt = rows[0];

  // Load answers with question details
  const { rows: answers } = await db.query(
    `SELECT qa.*, qq.question_text, qq.type, qq.options, qq.explanation, qq.points
     FROM quiz_answers qa
     JOIN quiz_questions qq ON qq.id = qa.question_id
     WHERE qa.attempt_id = $1
     ORDER BY qq.sort_order`,
    [attemptId]
  );

  return { ...attempt, answers };
}

async function getMyAttempts(quizId, userId) {
  const { rows } = await db.query(
    `SELECT id, attempt_number, score_pct, passed, earned_points, total_points,
            started_at, submitted_at, time_taken_secs, status
     FROM quiz_attempts
     WHERE quiz_id = $1 AND user_id = $2
     ORDER BY attempt_number`,
    [quizId, userId]
  );
  return rows;
}

// ── Grade short answer (Instructor) ───────────
async function gradeShortAnswer(answerId, points, instructorNote, requestingUser) {
  const { rows } = await db.query(
    `SELECT qa.*, qq.points AS max_points, q.course_id, c.instructor_id
     FROM quiz_answers qa
     JOIN quiz_questions qq ON qq.id = qa.question_id
     JOIN quiz_attempts qat ON qat.id = qa.attempt_id
     JOIN quizzes q ON q.id = qat.quiz_id
     JOIN courses c ON c.id = q.course_id
     WHERE qa.id = $1`,
    [answerId]
  );
  if (!rows[0]) throw ApiError.notFound('Answer not found');
  if (requestingUser.role !== 'admin' && rows[0].instructor_id !== requestingUser.id) {
    throw ApiError.forbidden('Access denied');
  }
  if (points > rows[0].max_points) {
    throw ApiError.badRequest(`Max points for this question is ${rows[0].max_points}`);
  }

  await db.transaction(async (client) => {
    await client.query(
      `UPDATE quiz_answers SET
         points_earned = $1, is_correct = $2, instructor_note = $3
       WHERE id = $4`,
      [points, points >= rows[0].max_points, instructorNote || null, answerId]
    );

    // Recompute attempt totals
    const { rows: totals } = await client.query(
      `SELECT SUM(points_earned) AS earned, COUNT(*) FILTER (WHERE is_correct IS NULL) AS pending
       FROM quiz_answers WHERE attempt_id = $1`,
      [rows[0].attempt_id]
    );

    if (parseInt(totals[0].pending, 10) === 0) {
      const earned  = parseFloat(totals[0].earned);
      const { rows: atmRows } = await client.query(
        'SELECT total_points, user_id, course_id FROM quiz_attempts WHERE id = $1',
        [rows[0].attempt_id]
      );
      const atm     = atmRows[0];
      const scorePct = Math.round((earned / atm.total_points) * 100);
      const passed   = scorePct >= rows[0].passing_score_pct;

      await client.query(
        `UPDATE quiz_attempts SET earned_points=$1, score_pct=$2, passed=$3, status='graded'
         WHERE id=$4`,
        [earned, scorePct, passed, rows[0].attempt_id]
      );

      // Write unified grade
      await client.query(
        `INSERT INTO grades
           (user_id, course_id, lesson_id, quiz_attempt_id, grade_type,
            score, max_score, score_pct, passed)
         VALUES ($1,$2,$3,$4,'quiz',$5,$6,$7,$8)
         ON CONFLICT (user_id, lesson_id, grade_type) DO UPDATE SET
           score=$5, max_score=$6, score_pct=$7, passed=$8, graded_at=NOW()`,
        [atm.user_id, atm.course_id, rows[0].lesson_id,
         rows[0].attempt_id, earned, atm.total_points, scorePct, passed]
      );
    }
  });
}

// ── Quiz analytics (Instructor) ───────────────
async function getQuizAnalytics(quizId, requestingUser) {
  const { rows: qRows } = await db.query(
    `SELECT q.*, c.instructor_id FROM quizzes q JOIN courses c ON c.id = q.course_id WHERE q.id = $1`,
    [quizId]
  );
  if (!qRows[0]) throw ApiError.notFound('Quiz not found');
  if (requestingUser.role !== 'admin' && qRows[0].instructor_id !== requestingUser.id) {
    throw ApiError.forbidden('Access denied');
  }

  const { rows: stats } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'graded')                     AS total_submissions,
       COUNT(*) FILTER (WHERE passed = true)                         AS passed_count,
       COUNT(*) FILTER (WHERE passed = false)                        AS failed_count,
       ROUND(AVG(score_pct) FILTER (WHERE status = 'graded'), 1)    AS avg_score_pct,
       ROUND(AVG(time_taken_secs) FILTER (WHERE status = 'graded')) AS avg_time_secs,
       MIN(score_pct) FILTER (WHERE status = 'graded')              AS min_score,
       MAX(score_pct) FILTER (WHERE status = 'graded')              AS max_score
     FROM quiz_attempts WHERE quiz_id = $1`,
    [quizId]
  );

  // Per-question difficulty
  const { rows: questionStats } = await db.query(
    `SELECT
       qq.id, qq.question_text, qq.type, qq.points,
       COUNT(qa.id)                                           AS attempts,
       COUNT(qa.id) FILTER (WHERE qa.is_correct = true)      AS correct,
       CASE WHEN COUNT(qa.id) > 0
         THEN ROUND(COUNT(qa.id) FILTER (WHERE qa.is_correct = true)::numeric
              / COUNT(qa.id) * 100)
         ELSE 0
       END AS correct_pct
     FROM quiz_questions qq
     LEFT JOIN quiz_answers qa ON qa.question_id = qq.id
     WHERE qq.quiz_id = $1
     GROUP BY qq.id, qq.question_text, qq.type, qq.points
     ORDER BY correct_pct ASC`,
    [quizId]
  );

  return {
    quiz:          qRows[0],
    stats:         stats[0],
    questionStats,
  };
}

// ── Pending short answers (Instructor) ─────────
async function getPendingShortAnswers(quizId, requestingUser) {
  const { rows: qRows } = await db.query(
    `SELECT c.instructor_id FROM quizzes q JOIN courses c ON c.id = q.course_id WHERE q.id = $1`,
    [quizId]
  );
  if (!qRows[0]) throw ApiError.notFound('Quiz not found');
  if (requestingUser.role !== 'admin' && qRows[0].instructor_id !== requestingUser.id) {
    throw ApiError.forbidden('Access denied');
  }

  const { rows } = await db.query(
    `SELECT qa.id, qa.selected_options, qa.attempt_id, qa.question_id,
            qa.instructor_note,
            qq.question_text, qq.points AS max_points,
            u.id AS user_id, u.first_name, u.last_name,
            qat.attempt_number, qat.submitted_at
     FROM quiz_answers qa
     JOIN quiz_questions qq ON qq.id = qa.question_id
     JOIN quiz_attempts qat ON qat.id = qa.attempt_id
     JOIN users u ON u.id = qat.user_id
     WHERE qq.quiz_id = $1
       AND qq.type = 'short_answer'
       AND qa.is_correct IS NULL
     ORDER BY qat.submitted_at ASC`,
    [quizId]
  );

  return rows;
}

module.exports = {
  createQuiz, updateQuiz, getQuizForInstructor,
  addQuestion, updateQuestion, deleteQuestion,
  getQuizByLesson,
  startAttempt, submitAttempt, getAttemptResult,
  getMyAttempts, gradeShortAnswer, getQuizAnalytics,
  getPendingShortAnswers,
};