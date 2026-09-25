'use strict';

const express      = require('express');
const multer       = require('multer');
const path         = require('path');
const router       = express.Router();
const controller   = require('./submissions.controller');
const rubricCtrl   = require('./rubrics.controller');
const authenticate = require('../../shared/middleware/authenticate');
const authorize    = require('../../shared/middleware/authorize');
const storage      = require('../../config/storage');

const upload = multer({
  dest: path.join(storage.lmsdataPath, 'temp'),
  limits: { fileSize: 100 * 1024 * 1024, files: 5 },
});

router.use(authenticate);

// ── Assignment CRUD (Instructor / Admin) ──────
router.post  ('/assignments',                   authorize('instructor','admin'), controller.createAssignment);
router.get   ('/assignments/by-lesson/:lessonId', controller.getAssignmentByLesson);
router.get   ('/assignments/:assignmentId',     controller.getAssignment);
router.patch ('/assignments/:assignmentId',     authorize('instructor','admin'), controller.updateAssignment);

// ── Submissions (Student) ─────────────────────
router.post  ('/assignments/:assignmentId/submit',
  upload.array('files', 5),
  controller.submitAssignment
);
router.get   ('/assignments/:assignmentId/my-submission', controller.getMySubmission);

// ── Grading (Instructor / Admin) ──────────────
router.get   ('/assignments/:assignmentId/submissions',  authorize('instructor','admin'), controller.listSubmissions);
router.get   ('/assignments',                            authorize('instructor','admin'), controller.listSubmissions);
router.get   ('/submissions/:submissionId',              controller.getSubmissionDetail);
router.patch ('/submissions/:submissionId/grade',        authorize('instructor','admin'), controller.gradeSubmission);

// ── Rubrics (Instructor / Admin) ────────────────
router.get   ('/assignments/:assignmentId/rubric',               rubricCtrl.getRubric);
router.put   ('/assignments/:assignmentId/rubric',
  authorize('instructor','admin'),
  rubricCtrl.saveRubric);
router.get   ('/submissions/:submissionId/rubric-feedback',      rubricCtrl.getFeedback);
router.post  ('/submissions/:submissionId/grade-rubric',
  authorize('instructor','admin'),
  rubricCtrl.gradeWithRubric);

// ── Gradebook ─────────────────────────────────
router.get   ('/gradebook/:courseId',           controller.getGradebook);
router.get   ('/gradebook/:courseId/all',
  authorize('instructor','admin'),
  controller.getCourseGradebook
);
router.get   ('/gradebook/:courseId/user/:userId',
  authorize('instructor','admin'),
  controller.getGradebookForUser
);

// Grade an assessment that happened offline (physical exam / paper test)
router.post  ('/gradebook/:courseId/lessons/:lessonId/manual-grades',
  authorize('instructor','admin'),
  controller.addManualGrades
);

// Download the full course gradebook as CSV
router.get   ('/gradebook/:courseId/export',
  authorize('instructor','admin'),
  controller.exportGradebook
);

module.exports = router;