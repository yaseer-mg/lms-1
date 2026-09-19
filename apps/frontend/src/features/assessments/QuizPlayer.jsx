import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import apiClient from '@/shared/api/client';
import { offlineMutation } from '../../shared/offline/mutations';

// ─────────────────────────────────────────────
//  QuizPlayer
//  Props:
//    quizId    — UUID of the quiz
//    courseId  — UUID of the course
//    onComplete — called with { passed, scorePct } on submission
// ─────────────────────────────────────────────

const STATES = { IDLE: 'idle', ACTIVE: 'active', SUBMITTED: 'submitted', ERROR: 'error' };

export default function QuizPlayer({ quizId, courseId, onComplete }) {
  const [state,      setState]      = useState(STATES.IDLE);
  const [attempt,    setAttempt]    = useState(null);   // from startAttempt
  const [answers,    setAnswers]    = useState({});      // { questionId: [optionIds] }
  const [result,     setResult]     = useState(null);    // from submitAttempt
  const [myAttempts, setMyAttempts] = useState([]);
  const [current,    setCurrent]    = useState(0);      // current question index
  const [timeLeft,   setTimeLeft]   = useState(null);   // seconds remaining
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const timerRef = useRef(null);
  const submitRef = useRef(null);

  // ── Load previous attempts on mount ──────────
  useEffect(() => {
    apiClient.get(`/assessments/quizzes/${quizId}/my-attempts`)
      .then(res => setMyAttempts(res.data.data.attempts || []))
      .catch(() => {});
  }, [quizId]);

  // ── Timer ──────────────────────────────────
  useEffect(() => {
    if (state !== STATES.ACTIVE || !attempt?.timeLimitMins) return;
    setTimeLeft(attempt.timeLimitMins * 60);

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          submitRef.current(true); // auto-submit on time-up
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [state, attempt]);

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  // ── Start attempt ────────────────────────────
  const handleStart = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.post(`/assessments/quizzes/${quizId}/start`);
      const data = res.data.data;
      setAttempt(data);
      setAnswers({});
      setCurrent(0);
      setState(STATES.ACTIVE);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not start quiz');
    } finally {
      setLoading(false);
    }
  };

  // ── Answer selection ─────────────────────────
  const selectOption = (questionId, optionId, type) => {
    setAnswers(prev => {
      const current = prev[questionId] || [];
      if (type === 'multiple_choice' || type === 'true_false') {
        return { ...prev, [questionId]: [optionId] };
      }
      // multi_select — toggle
      const exists = current.includes(optionId);
      return {
        ...prev,
        [questionId]: exists
          ? current.filter(id => id !== optionId)
          : [...current, optionId],
      };
    });
  };

  const setShortAnswer = (questionId, text) => {
    setAnswers(prev => ({ ...prev, [questionId]: [text] }));
  };

  // ── Submit ───────────────────────────────────
  const submitMutation = useMutation(offlineMutation('quiz-submit'));

  const handleSubmit = useCallback(async (autoSubmit = false) => {
    if (!autoSubmit) {
      const unanswered = attempt.questions.filter(
        q => !answers[q.id] || answers[q.id].length === 0
      );
      if (unanswered.length > 0) {
        const ok = window.confirm(
          `You have ${unanswered.length} unanswered question(s). Submit anyway?`
        );
        if (!ok) return;
      }
    }

    clearInterval(timerRef.current);
    setLoading(true);
    try {
      const payload = attempt.questions.map(q => ({
        questionId:      q.id,
        selectedOptions: answers[q.id] || [],
      }));
      const res = await submitMutation.mutateAsync({ attemptId: attempt.attemptId, payload });
      const data = res.data.data;
      setResult(data);
      setState(STATES.SUBMITTED);
      onComplete?.({ passed: data.passed, scorePct: data.scorePct });
    } catch (err) {
      setError(err.response?.data?.message || 'Submission failed');
    } finally {
      setLoading(false);
    }
  }, [attempt, answers, onComplete, submitMutation]);

  submitRef.current = handleSubmit;

  const currentQ = attempt?.questions?.[current];
  const totalQ   = attempt?.questions?.length || 0;
  const answered = Object.keys(answers).filter(id => answers[id]?.length > 0).length;

  // ────────────────────────────────────────────
  //  IDLE — show start screen
  // ────────────────────────────────────────────
  if (state === STATES.IDLE) {
    const lastAttempt = myAttempts[myAttempts.length - 1];
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 sm:p-6 md:p-8 text-center w-full max-w-lg mx-auto">
        <div className="text-5xl mb-4">📝</div>
        <h2 className="text-xl font-bold text-white mb-2">Quiz</h2>

        {myAttempts.length > 0 && (
          <div className="mb-6 p-3 bg-gray-700/50 rounded-lg text-sm">
            <p className="text-gray-400">
              Previous best: <span className={`font-bold ${lastAttempt.passed ? 'text-green-400' : 'text-red-400'}`}>
                {lastAttempt.score_pct}%
              </span>
              {' '}— Attempt {myAttempts.length}
            </p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        <button type="button"
          onClick={handleStart}
          disabled={loading}
          className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          {loading ? 'Starting…' : myAttempts.length > 0 ? 'Retry Quiz' : 'Start Quiz'}
        </button>
      </div>
    );
  }

  // ────────────────────────────────────────────
  //  SUBMITTED — show result
  // ────────────────────────────────────────────
  if (state === STATES.SUBMITTED && result) {
    const isPending = result.status === 'grading';
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 sm:p-6 md:p-8 w-full max-w-2xl mx-auto">

        {/* Score header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">
            {isPending ? '⏳' : result.passed ? '🎉' : '😔'}
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">
            {isPending ? 'Pending Manual Grading'
              : result.passed ? 'Quiz Passed!' : 'Quiz Failed'}
          </h2>
          {!isPending && (
            <p className="text-4xl font-black mt-2" style={{
              color: result.scorePct >= 70 ? '#22c55e' : '#f43f5e'
            }}>
              {result.scorePct}%
            </p>
          )}
          <p className="text-gray-400 text-sm mt-1">
            {result.earnedPoints} / {result.totalPoints} points
          </p>
        </div>

        {/* Question review */}
        {result.questions && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Review
            </h3>
            {result.questions.map((q, i) => {
              const studentOpts = q.studentAnswer || [];
              const correctOpts = q.options.filter(o => o.is_correct).map(o => o.id);
              const isCorrect   = JSON.stringify([...studentOpts].sort()) ===
                                  JSON.stringify([...correctOpts].sort());
              return (
                <div key={q.id}
                  className={`p-4 rounded-lg border ${
                    isCorrect ? 'border-green-700/50 bg-green-900/20'
                              : 'border-red-700/50 bg-red-900/20'
                  }`}
                >
                  <p className="text-sm font-medium text-white mb-2">
                    <span className="text-gray-500 mr-2">Q{i + 1}.</span>
                    {q.questionText}
                  </p>
                  <div className="space-y-1">
                    {q.options.map(opt => (
                      <div key={opt.id} className={`text-xs px-3 py-1.5 rounded flex items-center gap-2 ${
                        opt.is_correct ? 'bg-green-800/40 text-green-300'
                          : studentOpts.includes(opt.id) ? 'bg-red-800/40 text-red-300'
                          : 'text-gray-500'
                      }`}>
                        <span>{opt.is_correct ? '✓' : studentOpts.includes(opt.id) ? '✗' : '○'}</span>
                        {opt.text}
                      </div>
                    ))}
                  </div>
                  {q.explanation && (
                    <p className="text-xs text-blue-400 mt-2 italic">💡 {q.explanation}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 flex gap-3 justify-center">
          <button type="button"
            onClick={() => setState(STATES.IDLE)}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
          >
            {result.passed ? 'Done' : 'Try Again'}
          </button>
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────
  //  ACTIVE — question interface
  // ────────────────────────────────────────────
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden w-full max-w-2xl mx-auto">

      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900 border-b border-gray-700">
        <span className="text-sm text-gray-400">
          Question <span className="text-white font-bold">{current + 1}</span> of {totalQ}
        </span>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500">{answered}/{totalQ} answered</span>
          {timeLeft !== null && (
            <span className={`text-sm font-mono font-bold ${timeLeft < 60 ? 'text-red-400' : 'text-white'}`}>
              ⏱ {formatTime(timeLeft)}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-700">
        <div
          className="h-full bg-blue-500 transition-all"
          style={{ width: `${((current + 1) / totalQ) * 100}%` }}
        />
      </div>

      {/* Question */}
      {currentQ && (
        <div className="p-6">
          <div className="flex items-start justify-between gap-4 mb-6">
            <p className="text-white font-medium text-lg leading-relaxed">
              {currentQ.questionText}
            </p>
            <span className="flex-shrink-0 text-xs text-gray-500 bg-gray-700 px-2 py-1 rounded">
              {currentQ.points} pt{currentQ.points !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Options */}
          {currentQ.type === 'short_answer' ? (
            <textarea
              value={answers[currentQ.id]?.[0] || ''}
              onChange={e => setShortAnswer(currentQ.id, e.target.value)}
              placeholder="Type your answer here…"
              rows={5}
              className="w-full bg-gray-700 text-white rounded-xl p-4 text-sm resize-none outline-none focus:ring-2 focus:ring-blue-500"
            />
          ) : (
            <div className="space-y-3">
              {currentQ.options.map(opt => {
                const selected = (answers[currentQ.id] || []).includes(opt.id);
                return (
                  <button type="button"
                    key={opt.id}
                    onClick={() => selectOption(currentQ.id, opt.id, currentQ.type)}
                    className={`w-full text-left px-4 py-3 rounded-xl border-2 text-sm transition-all ${
                      selected
                        ? 'border-blue-500 bg-blue-900/30 text-white'
                        : 'border-gray-600 bg-gray-700/50 text-gray-300 hover:border-gray-500'
                    }`}
                  >
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full border-2 mr-3 text-xs font-bold flex-shrink-0 ${
                      selected ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-500 text-gray-500'
                    }`}>
                      {selected ? '✓' : opt.id.toUpperCase()}
                    </span>
                    {opt.text}
                  </button>
                );
              })}
            </div>
          )}

          {currentQ.type === 'multi_select' && (
            <p className="text-xs text-gray-500 mt-3">Select all that apply</p>
          )}
        </div>
      )}

      {/* Navigation footer */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900 border-t border-gray-700">
        <button type="button"
          onClick={() => setCurrent(p => Math.max(0, p - 1))}
          disabled={current === 0}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm disabled:opacity-30"
        >
          ← Previous
        </button>

        {/* Question dots */}
        <div className="flex gap-1.5">
          {attempt.questions.map((q, i) => (
            <button type="button"
              key={q.id}
              onClick={() => setCurrent(i)}
              className={`w-2.5 h-2.5 rounded-full transition-all ${
                i === current ? 'bg-blue-500 scale-125'
                  : answers[q.id]?.length > 0 ? 'bg-green-500'
                  : 'bg-gray-600 hover:bg-gray-500'
              }`}
            />
          ))}
        </div>

        {current < totalQ - 1 ? (
          <button type="button"
            onClick={() => setCurrent(p => p + 1)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
          >
            Next →
          </button>
        ) : (
          <button type="button"
            onClick={() => handleSubmit(false)}
            disabled={loading}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {loading ? 'Submitting…' : 'Submit Quiz'}
          </button>
        )}
      </div>
    </div>
  );
}