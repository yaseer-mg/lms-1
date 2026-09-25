'use strict';

const express      = require('express');
const http         = require('http');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const { Server }   = require('socket.io');

const env           = require('./config/env');
const db            = require('./config/db');
const redisClient   = require('./config/redis');
const errorHandler  = require('./shared/middleware/errorHandler');
const requestLogger = require('./shared/middleware/requestLogger');
const eventBus      = require('./shared/events/eventBus');

// ── Route imports ─────────────────────────────
const authRoutes        = require('./modules/auth/auth.routes');
const userRoutes        = require('./modules/users/users.routes');
const fileRoutes        = require('./modules/files/files.routes');
const courseRoutes      = require('./modules/courses/courses.routes');
const lessonRoutes      = require('./modules/lessons/lessons.routes');
const enrollmentRoutes  = require('./modules/enrollments/enrollments.routes');
const progressRoutes    = require('./modules/progress/progress.routes');
const assessmentRoutes  = require('./modules/assessments/assessments.routes');
const submissionRoutes  = require('./modules/submissions/submissions.routes');
const forumRoutes       = require('./modules/forums/forums.routes');
const messageRoutes     = require('./modules/messages/messages.routes');
const notificationRoutes = require('./modules/notifications/notifications.routes');
const announcementRoutes = require('./modules/announcements/announcements.routes');
const questionBankRoutes = require('./modules/question-bank/question-bank.routes');
const courseGroupRoutes  = require('./modules/course-groups/course-groups.routes');
const certificateRoutes  = require('./modules/certificates/certificates.routes');
const paymentWebhookRoutes = require('./modules/enrollments/payment-webhook.routes');
const calendarRoutes       = require('./modules/calendar/calendar.routes');
const scormRoutes          = require('./modules/scorm/scorm.routes');
const ltiRoutes            = require('./modules/lti/lti.routes');

const app    = express();
const server = http.createServer(app);

// Trust the nginx reverse proxy (needed for rate-limiter IP detection)
app.set('trust proxy', 1);

// ── Socket.io ─────────────────────────────────
const io = new Server(server, {
  cors: { origin: env.APP_URL, methods: ['GET', 'POST'] },
  pingInterval: 25000,
  pingTimeout:  10000,
});

// Socket.io authentication middleware — verify JWT from handshake auth
const jwt = require('jsonwebtoken');
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error('Authentication required'));
  jwt.verify(token, env.JWT_ACCESS_SECRET, (err, decoded) => {
    if (err) return next(new Error('Invalid or expired token'));
    socket.userId = decoded.id;
    socket.userRole = decoded.role;
    next();
  });
});
app.set('io', io);

// ── Raw body for payment gateway webhook signature verification ──
// Must be registered BEFORE express.json() — this route needs the
// untouched raw bytes to verify the HMAC signature.
app.use('/api/v1/payments/webhook', express.raw({ type: '*/*', limit: '2mb' }));

// ── Global Middleware ─────────────────────────
// CSP is extended so enrolled students can embed YouTube lessons
// (frame-src) and preview thumbnails (img-src) provided by YouTube.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'frame-src': ["'self'", 'https://www.youtube-nocookie.com', 'https://www.youtube.com'],
      'img-src':   ["'self'", 'data:', 'https://i.ytimg.com', 'https://img.youtube.com'],
    },
  },
}));
app.use(cors({ origin: env.APP_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));
app.use(requestLogger);

// ── Idempotency — safe retries for offline-first mutations ──
const idempotency = require('./shared/middleware/idempotency');
app.use('/api/v1', idempotency());

// ── Health Check ──────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    await redisClient.ping();
    res.json({
      status:    'ok',
      timestamp: new Date().toISOString(),
      services:  { database: 'up', redis: 'up' },
    });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: err.message });
  }
});

const instructorRoutes = require('./modules/instructor/instructor.routes');
const adminRoutes      = require('./modules/admin/admin.routes');
const { apiLimiter } = require('./shared/middleware/rateLimiter');

// ── API Routes ────────────────────────────────
app.use('/api/v1/auth',                        authRoutes);
app.use('/api/v1/users',                       userRoutes);
app.use('/api/v1/files',                       fileRoutes);
app.use('/api/v1/courses',                     courseRoutes);
app.use('/api/v1/courses/:courseId/lessons',   lessonRoutes);
app.use('/api/v1/courses/:courseId/forums',    forumRoutes);   // ← Phase 6
app.use('/api/v1/courses/:courseId/announcements', announcementRoutes);
app.use('/api/v1/courses/:courseId/question-bank', questionBankRoutes);
app.use('/api/v1/courses/:courseId/groups',        courseGroupRoutes);
app.use('/api/v1/enrollments',                     enrollmentRoutes);
app.use('/api/v1/progress',                    progressRoutes);
app.use('/api/v1/assessments',                 assessmentRoutes);
app.use('/api/v1/submissions',                 submissionRoutes);
app.use('/api/v1/messages',                    messageRoutes);        // ← Phase 6
app.use('/api/v1/notifications',               notificationRoutes);   // ← Phase 6
app.use('/api/v1/certificates',                certificateRoutes);    // ← Phase 8
app.use('/api/v1/payments/webhook',             paymentWebhookRoutes); // ← External payment gateway
app.use('/api/v1/calendar',                      calendarRoutes);
app.use('/api/v1/scorm',                        scormRoutes);
app.use('/api/v1/lti',                          ltiRoutes);
app.use('/api/v1/instructor',                   instructorRoutes);
app.use('/api/v1/admin',                        adminRoutes);           // ← Phase 9

// ── 404 ───────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// ── Global error handler ──────────────────────
app.use(errorHandler);

// ─────────────────────────────────────────────
//  SOCKET.IO — Room Management
//
//  Rooms used:
//    user_{userId}               → personal notifications, DM badge
//    course_{courseId}_instructors → new submission alerts
//    dm_{conversationId}         → real-time DM messages
// ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id} (user ${socket.userId})`);

  // Client joins their personal room (authenticated userId from JWT)
  socket.on('join_user', (userId) => {
    if (userId !== socket.userId) {
      return socket.emit('error', 'Unauthorized: cannot join another user\'s room');
    }
    socket.join(`user_${userId}`);
    console.log(`[Socket] user_${userId} joined personal room`);
  });

  // Instructor joins their course room (for submission alerts)
  socket.on('join_course', ({ courseId }) => {
    socket.join(`course_${courseId}_instructors`);
    console.log(`[Socket] Joined course_${courseId}_instructors`);
  });

  // Both parties join a DM conversation room
  socket.on('join_dm', ({ conversationId }) => {
    socket.join(`dm_${conversationId}`);
    console.log(`[Socket] Joined dm_${conversationId}`);
  });

  socket.on('leave_dm', ({ conversationId }) => {
    socket.leave(`dm_${conversationId}`);
  });

  // Typing indicator for DMs — use authenticated userId
  socket.on('dm_typing', ({ conversationId, isTyping }) => {
    socket.to(`dm_${conversationId}`).emit('dm_typing', { userId: socket.userId, isTyping });
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
  });
});

// ─────────────────────────────────────────────
//  EVENT BUS LISTENERS
// ─────────────────────────────────────────────
const { notify, notifyMany } = require('./modules/notifications/notifications.service');

// Phase 3 — progress
eventBus.on('lesson.completed', async ({ userId, lessonId, courseId }) => {
  io.to(`user_${userId}`).emit('lesson_completed', { lessonId, courseId });
  try {
    const certService = require('./modules/certificates/certificates.service');
    // Count completed lessons in this course
    const { rows } = await db.query(
      `SELECT COUNT(*) AS cnt FROM lesson_progress
       WHERE user_id=$1 AND course_id=$2 AND is_completed=true`,
      [userId, courseId]
    );
    await certService.awardLessonCompleteXp(userId, parseInt(rows[0]?.cnt || 0, 10));
  } catch (err) {
    console.error('[Events] lesson.completed XP error:', err.message);
  }
});

eventBus.on('course.completed', async ({ userId, courseId }) => {
  io.to(`user_${userId}`).emit('course_completed', { courseId });
  try {
    // Generate certificate
    const certService = require('./modules/certificates/certificates.service');
    await certService.issueCertificate(userId, courseId);

    const { rows } = await db.query('SELECT title FROM courses WHERE id=$1', [courseId]);
    await notify(io, {
      userId,
      type:  'certificate_issued',
      title: '🎉 Certificate Ready!',
      body:  `You completed "${rows[0]?.title}". View your certificate in your profile.`,
      data:  { courseId },
    });
  } catch (err) {
    console.error('[Events] course.completed error:', err.message);
  }
});

eventBus.on('enrollment.created', async ({ userId, courseId }) => {
  try {
    await redisClient.del(`dashboard_${userId}`);
    const { rows } = await db.query('SELECT title FROM courses WHERE id=$1', [courseId]);
    await notify(io, {
      userId,
      type:  'enrollment',
      title: 'Successfully Enrolled!',
      body:  `You are now enrolled in "${rows[0]?.title}". Start learning!`,
      data:  { courseId },
    });
  } catch (err) {
    console.error('[Events] enrollment.created notify error:', err.message);
  }
});

// Phase 4 — assessments
eventBus.on('quiz.submitted', async ({ userId, courseId, passed, scorePct, quizId }) => {
  io.to(`user_${userId}`).emit('quiz_result', { courseId, passed, scorePct });
  try {
    await notify(io, {
      userId,
      type:  'quiz_graded',
      title: passed ? '✅ Quiz Passed!' : '❌ Quiz Failed',
      body:  `You scored ${scorePct}%. ${passed ? 'Well done!' : 'Review the material and try again.'}`,
      data:  { courseId, passed, scorePct },
    });
    // Award perfect score badge if 100%
    if (parseFloat(scorePct) === 100) {
      const certService = require('./modules/certificates/certificates.service');
      await certService.awardQuizPerfectXp(userId, quizId);
    }
  } catch (err) {
    console.error('[Events] quiz.submitted error:', err.message);
  }
});

eventBus.on('assignment.created', async ({ assignmentId, courseId, assignmentTitle }) => {
  try {
    const { rows } = await db.query(
      `SELECT user_id FROM enrollments WHERE course_id = $1 AND status = 'active'`,
      [courseId]
    );
    const userIds = rows.map(r => r.user_id);
    if (userIds.length > 0) {
      await notifyMany(io, userIds, {
        type:  'assignment_available',
        title: 'New Assignment',
        body:  `A new assignment "${assignmentTitle}" is now available`,
        data:  { courseId, assignmentId },
      });
    }
  } catch (err) {
    console.error('[Events] assignment.created notify error:', err.message);
  }
});

eventBus.on('quiz.created', async ({ quizId, courseId, quizTitle }) => {
  try {
    const { rows } = await db.query(
      `SELECT user_id FROM enrollments WHERE course_id = $1 AND status = 'active'`,
      [courseId]
    );
    const userIds = rows.map(r => r.user_id);
    if (userIds.length > 0) {
      await notifyMany(io, userIds, {
        type:  'quiz_available',
        title: 'New Quiz Available',
        body:  `A new quiz "${quizTitle}" is now available`,
        data:  { courseId, quizId },
      });
    }
  } catch (err) {
    console.error('[Events] quiz.created notify error:', err.message);
  }
});

eventBus.on('assignment.submitted', ({ userId, submissionId, courseId }) => {
  io.to(`course_${courseId}_instructors`).emit('submission_pending', { submissionId, userId });
});

eventBus.on('assignment.graded', async ({ userId, submissionId, score, passed }) => {
  io.to(`user_${userId}`).emit('assignment_graded', { submissionId, score, passed });
  try {
    await notify(io, {
      userId,
      type:  'assignment_graded',
      title: 'Assignment Graded',
      body:  `Your assignment has been graded. Score: ${score}. ${passed ? 'Passed ✅' : 'Not passed ❌'}`,
      data:  { submissionId, score, passed },
    });
  } catch (err) {
    console.error('[Events] assignment.graded notify error:', err.message);
  }
});

// Phase 6 — enrollment revoked
eventBus.on('enrollment.revoked', async ({ userId, courseId }) => {
  try {
    const { rows } = await db.query('SELECT title FROM courses WHERE id=$1', [courseId]);
    await notify(io, {
      userId,
      type:  'system',
      title: 'Enrollment Revoked',
      body:  `Your access to "${rows[0]?.title}" has been revoked. Contact the administrator for details.`,
      data:  { courseId },
    });
  } catch (err) {
    console.error('[Events] enrollment.revoked notify error:', err.message);
  }
});

// ── Auth emails (verification + password reset) ──
const { sendMail } = require('./shared/mailer/mailer');
const { verifyEmailEmail, passwordResetEmail } = require('./shared/mailer/templates');

eventBus.on('user.registered', async ({ email, firstName, verificationToken }) => {
  try {
    const verificationUrl = `${env.APP_URL}/verify-email?token=${verificationToken}`;
    await sendMail({
      to:      email,
      subject: 'Verify your email address',
      html:    verifyEmailEmail({ firstName, verificationUrl }),
    });
  } catch (err) {
    console.error('[Events] user.registered email error:', err.message);
  }
});

eventBus.on('user.forgot_password', async ({ email, firstName, resetToken }) => {
  try {
    const resetUrl = `${env.APP_URL}/reset-password?token=${resetToken}`;
    await sendMail({
      to:      email,
      subject: 'Reset your password',
      html:    passwordResetEmail({ firstName, resetUrl }),
    });
  } catch (err) {
    console.error('[Events] user.forgot_password email error:', err.message);
  }
});

// ── Cache invalidation via events ──────────
eventBus.on('course.created',  async ({ courseId }) => {
  await require('./shared/utils/cache').invalidatePattern('courses:list:*');
  require('./shared/utils/laravelSync').syncCourse(courseId).catch(err => console.error('[Event course.created] Laravel sync error:', err.message));
});
eventBus.on('course.updated',  async ({ courseId }) => {
  await require('./shared/utils/cache').invalidatePattern('courses:list:*');
  require('./shared/utils/laravelSync').syncCourse(courseId).catch(err => console.error('[Event course.updated] Laravel sync error:', err.message));
});
eventBus.on('course.published', async ({ courseId }) => {
  await require('./shared/utils/cache').invalidatePattern('courses:list:*');
  await require('./shared/utils/cache').invalidate('admin:analytics');
  require('./shared/utils/laravelSync').syncCourse(courseId).catch(err => console.error('[Event course.published] Laravel sync error:', err.message));
});
eventBus.on('course.deleted',  async ({ courseId }) => {
  await require('./shared/utils/cache').invalidatePattern('courses:list:*');
  require('./shared/utils/laravelSync').deleteCourse(courseId).catch(err => console.error('[Event course.deleted] Laravel delete error:', err.message));
});
eventBus.on('enrollment.created', async () => { await require('./shared/utils/cache').invalidate('admin:analytics'); });
eventBus.on('course.completed',   async () => { await require('./shared/utils/cache').invalidate('admin:analytics'); });
eventBus.on('user.registered',    async () => { await require('./shared/utils/cache').invalidate('admin:analytics'); });

// ── Run pending DB migrations ───────────────────────
async function runMigrations() {
  try {
    const { execSync } = require('child_process');
    const migrateScript = require('path').join(__dirname, 'database', 'migrate.js');
    console.log('\n[Server] Checking pending DB migrations...');
    execSync(`node "${migrateScript}"`, { stdio: 'inherit', env: process.env });
  } catch (err) {
    console.error('[Server] Migration failed:', err.message);
    process.exit(1);
  }
}

// ── Connect DB and Redis before accepting traffic ────
(async () => {
  try {
    await db.checkConnection();
    await runMigrations();
    await redisClient.connectWithRetry();

    const { verifyConnection } = require('./shared/mailer/mailer');
    verifyConnection(); // non-fatal — logs a warning if SMTP isn't reachable

    const PORT = process.env.PORT || env.BACKEND_PORT || 5000;
    server.listen(PORT, () => {
      console.log(`
╔══════════════════════════════════════╗
║   Shaheed Mahmoud Academy — Running  ║
║  Port    : ${PORT}                       ║
║  Env     : ${env.NODE_ENV}            ║
║  DB      : ${env.POSTGRES_DB}          ║
╚══════════════════════════════════════╝
      `);
    });
  } catch (err) {
    console.error('[Server] Startup failed:', err.message);
    process.exit(1);
  }
})();

// ── Graceful shutdown ─────────────────────────
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM — shutting down gracefully');
  server.close(async () => {
    await db.end();
    if (redisClient.isOpen) await redisClient.quit();
    process.exit(0);
  });
});

module.exports = { app, io };