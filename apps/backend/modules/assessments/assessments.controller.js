'use strict';

const Joi         = require('joi');
const service     = require('./assessments.service');
const ApiResponse = require('../../shared/utils/apiResponse');
const ApiError    = require('../../shared/utils/apiError');

// ── Validation schemas ────────────────────────
const quizSchema = Joi.object({
  title:            Joi.string().trim().min(3).max(255).required(),
  description:      Joi.string().max(2000).allow('', null),
  maxAttempts:      Joi.number().integer().min(1).allow(null),
  timeLimitMins:    Joi.number().integer().min(1).allow(null),
  passingScorePct:  Joi.number().integer().min(0).max(100),
  shuffleQuestions: Joi.boolean(),
  shuffleOptions:   Joi.boolean(),
  showAnswersAfter: Joi.boolean(),
  isPublished:      Joi.boolean(),
});

const questionSchema = Joi.object({
  type:         Joi.string().valid('multiple_choice','multi_select','true_false','short_answer').required(),
  questionText: Joi.string().trim().min(1).required(),
  options:      Joi.array().items(Joi.object({
    id:         Joi.string().required(),
    text:       Joi.string().required(),
    is_correct: Joi.boolean().required(),
  })).when('type', { is: 'short_answer', then: Joi.optional(), otherwise: Joi.required() }),
  modelAnswer:  Joi.string().allow('', null),
  explanation:  Joi.string().allow('', null),
  points:       Joi.number().integer().min(1),
});

const answerSchema = Joi.array().items(Joi.object({
  questionId:      Joi.string().uuid().required(),
  selectedOptions: Joi.array().items(Joi.string()).required(),
}));

// ── Quiz CRUD ─────────────────────────────────
async function createQuiz(req, res, next) {
  try {
    const { lessonId, courseId } = req.body;
    if (!lessonId || !courseId) throw ApiError.badRequest('lessonId and courseId are required');
    const { error, value } = quizSchema.validate(req.body, { abortEarly: false, allowUnknown: true });
    if (error) {
      console.error('[Quiz Validation]', error.details.map(d => d.message));
      throw ApiError.badRequest('Validation failed', error.details.map(d => d.message));
    }
    const quiz = await service.createQuiz(lessonId, courseId, value, req.user);
    ApiResponse.created(res, { quiz }, 'Quiz created');
  } catch (err) { next(err); }
}

async function updateQuiz(req, res, next) {
  try {
    const { error, value } = quizSchema.fork(
      Object.keys(quizSchema.describe().keys),
      s => s.optional()
    ).validate(req.body, { abortEarly: false });
    if (error) throw ApiError.badRequest('Validation failed', error.details.map(d => d.message));
    const quiz = await service.updateQuiz(req.params.quizId, value, req.user);
    ApiResponse.success(res, { quiz }, 'Quiz updated');
  } catch (err) { next(err); }
}

async function getQuizForInstructor(req, res, next) {
  try {
    const quiz = await service.getQuizForInstructor(req.params.quizId, req.user);
    ApiResponse.success(res, { quiz });
  } catch (err) { next(err); }
}

async function getQuizAnalytics(req, res, next) {
  try {
    const data = await service.getQuizAnalytics(req.params.quizId, req.user);
    ApiResponse.success(res, data);
  } catch (err) { next(err); }
}

// ── Questions ─────────────────────────────────
async function addQuestion(req, res, next) {
  try {
    const { error, value } = questionSchema.validate(req.body, { abortEarly: false });
    if (error) throw ApiError.badRequest('Validation failed', error.details.map(d => d.message));
    const question = await service.addQuestion(req.params.quizId, value, req.user);
    ApiResponse.created(res, { question }, 'Question added');
  } catch (err) { next(err); }
}

async function updateQuestion(req, res, next) {
  try {
    const question = await service.updateQuestion(req.params.questionId, req.body, req.user);
    ApiResponse.success(res, { question }, 'Question updated');
  } catch (err) { next(err); }
}

async function deleteQuestion(req, res, next) {
  try {
    await service.deleteQuestion(req.params.questionId, req.user);
    ApiResponse.success(res, {}, 'Question deleted');
  } catch (err) { next(err); }
}

// ── Student: get quiz by lesson ──────────────
async function getQuizByLesson(req, res, next) {
  try {
    const result = await service.getQuizByLesson(req.params.lessonId, req.user.id);
    ApiResponse.success(res, result);
  } catch (err) { next(err); }
}

// ── Student Attempt Flow ──────────────────────
async function startAttempt(req, res, next) {
  try {
    const result = await service.startAttempt(req.params.quizId, req.user.id);
    ApiResponse.created(res, result, 'Quiz attempt started');
  } catch (err) { next(err); }
}

async function submitAttempt(req, res, next) {
  try {
    const { answers } = req.body;
    if (!Array.isArray(answers)) throw ApiError.badRequest('answers must be an array');
    const { error } = answerSchema.validate(answers);
    if (error) throw ApiError.badRequest('Invalid answers format', error.details.map(d => d.message));
    const result = await service.submitAttempt(req.params.attemptId, req.user.id, answers);
    ApiResponse.success(res, result, 'Quiz submitted');
  } catch (err) { next(err); }
}

async function getAttemptResult(req, res, next) {
  try {
    const result = await service.getAttemptResult(req.params.attemptId, req.user.id);
    ApiResponse.success(res, { result });
  } catch (err) { next(err); }
}

async function getMyAttempts(req, res, next) {
  try {
    const attempts = await service.getMyAttempts(req.params.quizId, req.user.id);
    ApiResponse.success(res, { attempts });
  } catch (err) { next(err); }
}

async function gradeShortAnswer(req, res, next) {
  try {
    const { points, instructorNote } = req.body;
    if (points === undefined) throw ApiError.badRequest('points is required');
    await service.gradeShortAnswer(req.params.answerId, points, instructorNote, req.user);
    ApiResponse.success(res, {}, 'Answer graded');
  } catch (err) { next(err); }
}

async function getPendingShortAnswers(req, res, next) {
  try {
    const answers = await service.getPendingShortAnswers(req.params.quizId, req.user);
    ApiResponse.success(res, { answers });
  } catch (err) { next(err); }
}

module.exports = {
  createQuiz, updateQuiz, getQuizForInstructor, getQuizAnalytics,
  addQuestion, updateQuestion, deleteQuestion,
  getQuizByLesson,
  startAttempt, submitAttempt, getAttemptResult, getMyAttempts,
  gradeShortAnswer, getPendingShortAnswers,
};