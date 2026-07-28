'use strict';

const Joi         = require('joi');
const service     = require('./submissions.service');
const ApiResponse = require('../../shared/utils/apiResponse');
const ApiError    = require('../../shared/utils/apiError');

const assignmentSchema = Joi.object({
  lessonId:             Joi.string().uuid().required(),
  courseId:             Joi.string().uuid().required(),
  title:                Joi.string().trim().min(3).max(255).required(),
  instructions:         Joi.string().max(10000).allow('', null),
  maxScore:             Joi.number().integer().min(1),
  passingScore:         Joi.number().integer().min(0),
  allowTextSubmission:  Joi.boolean(),
  allowFileSubmission:  Joi.boolean(),
  maxFileSizeMb:        Joi.number().integer().min(1).max(500),
  allowedFileTypes:     Joi.array().items(Joi.string()),
  maxFiles:             Joi.number().integer().min(1).max(10),
  dueDate:              Joi.alternatives().try(Joi.string().isoDate(), Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/)).allow(null),
  isPublished:          Joi.boolean(),
  isGroupAssignment:    Joi.boolean(),
});

async function createAssignment(req, res, next) {
  try {
    const { error, value } = assignmentSchema.validate(req.body, { abortEarly: false, allowUnknown: true });
    if (error) {
      console.error('[Assignment Validation]', error.details.map(d => d.message));
      throw ApiError.badRequest('Validation failed', error.details.map(d => d.message));
    }
    const assignment = await service.createAssignment(
      value.lessonId, value.courseId, value, req.user
    );
    ApiResponse.created(res, { assignment }, 'Assignment created');
  } catch (err) { next(err); }
}

async function updateAssignment(req, res, next) {
  try {
    const assignment = await service.updateAssignment(req.params.assignmentId, req.body, req.user);
    ApiResponse.success(res, { assignment }, 'Assignment updated');
  } catch (err) { next(err); }
}

async function getAssignment(req, res, next) {
  try {
    const assignment = await service.getAssignment(req.params.assignmentId, req.user);
    ApiResponse.success(res, { assignment });
  } catch (err) { next(err); }
}

async function getAssignmentByLesson(req, res, next) {
  try {
    const assignment = await service.getAssignmentByLesson(req.params.lessonId, req.user);
    ApiResponse.success(res, { assignment });
  } catch (err) { next(err); }
}

async function submitAssignment(req, res, next) {
  try {
    const { textContent, groupId } = req.body;
    const submission = await service.submitAssignment(
      req.params.assignmentId, req.user.id, textContent, req.files || [], groupId
    );
    ApiResponse.created(res, { submission }, 'Assignment submitted successfully');
  } catch (err) { next(err); }
}

async function getMySubmission(req, res, next) {
  try {
    const submissions = await service.getMySubmission(req.params.assignmentId, req.user.id);
    ApiResponse.success(res, { submissions });
  } catch (err) { next(err); }
}

async function listSubmissions(req, res, next) {
  try {
    const { courseId } = req.query;
    if (courseId) {
      const assignments = await service.listCourseAssignments(courseId, req.user);
      return ApiResponse.success(res, { assignments });
    }
    const submissions = await service.listSubmissions(req.params.assignmentId, req.user);
    ApiResponse.success(res, { submissions });
  } catch (err) { next(err); }
}

async function getSubmissionDetail(req, res, next) {
  try {
    const submission = await service.getSubmissionDetail(req.params.submissionId, req.user);
    ApiResponse.success(res, { submission });
  } catch (err) { next(err); }
}

async function gradeSubmission(req, res, next) {
  try {
    const { score, feedback } = req.body;
    if (score === undefined) throw ApiError.badRequest('score is required');
    const result = await service.gradeSubmission(
      req.params.submissionId, score, feedback, req.user
    );
    ApiResponse.success(res, result, 'Submission graded');
  } catch (err) { next(err); }
}

async function getGradebook(req, res, next) {
  try {
    const data = await service.getGradebook(req.params.courseId, req.user.id, req.user);
    ApiResponse.success(res, data);
  } catch (err) { next(err); }
}

async function getCourseGradebook(req, res, next) {
  try {
    const data = await service.getCourseGradebook(req.params.courseId, req.user);
    ApiResponse.success(res, data);
  } catch (err) { next(err); }
}

async function getGradebookForUser(req, res, next) {
  try {
    const data = await service.getGradebook(
      req.params.courseId, req.params.userId, req.user
    );
    ApiResponse.success(res, data);
  } catch (err) { next(err); }
}

module.exports = {
  createAssignment, updateAssignment, getAssignment, getAssignmentByLesson,
  submitAssignment, getMySubmission,
  listSubmissions, getSubmissionDetail, gradeSubmission,
  getGradebook, getCourseGradebook, getGradebookForUser,
};