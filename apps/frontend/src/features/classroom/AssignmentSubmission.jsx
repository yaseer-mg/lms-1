import { useState, useEffect } from 'react';
import { FileText, Upload, CheckCircle2, XCircle, Clock, Download, X, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../../shared/api/client';
import { submissionsApi } from '../../shared/api';
import { offlineMutation } from '../../shared/offline/mutations';
import Spinner from '../../shared/components/ui/spinner';
import { clsx } from 'clsx';

const MODES = { LOADING: 'loading', READY: 'ready', SUBMITTED: 'submitted', ERROR: 'error' };

export default function AssignmentSubmission({ lessonId, courseId, onComplete }) {
  const [mode, setMode] = useState(MODES.LOADING);
  const [assignment, setAssignment] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [textContent, setTextContent] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [assRes, subRes] = await Promise.all([
          api.get(`/submissions/assignments/by-lesson/${lessonId}`),
          api.get(`/submissions/assignments/${null}/my-submission`).catch(() => null),
        ]);
        if (cancelled) return;
        const ass = assRes.data.data.assignment;
        setAssignment(ass);

        try {
          const subRes2 = await submissionsApi.mySubmission(ass.id);
          setSubmissions(subRes2.data.data.submissions || []);
        } catch {
          setSubmissions([]);
        }
        setMode(MODES.READY);
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.message || 'Failed to load assignment');
          setMode(MODES.ERROR);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [lessonId]);

  const latest = submissions[0];
  const isPassed = latest?.status === 'graded' && latest?.score >= (assignment?.passing_score || 0);
  const isOverdue = assignment?.due_date && new Date(assignment.due_date) < new Date();

  const submitMutation = useMutation(offlineMutation('assignment-submit', {
    onSuccess: (res) => {
      const newSubmission = res.data.data.submission;
      setSubmissions(prev => [newSubmission, ...prev]);
      setTextContent('');
      setFiles([]);
      toast.success('Assignment submitted');
      if (onComplete) onComplete({ submitted: true });
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Failed to submit'),
  }));

  const submitting = submitMutation.isPending;

  function handleSubmit(e) {
    e.preventDefault();
    if (!textContent.trim() && files.length === 0) {
      return toast.error('Please provide text content or upload files');
    }
    submitMutation.mutate({ assignmentId: assignment.id, textContent, files });
  }

  function removeFile(index) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  if (mode === MODES.LOADING) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (mode === MODES.ERROR) {
    return (
      <div className="card p-6 text-center">
        <AlertTriangle size={32} className="text-red-400 mx-auto mb-2" />
        <p className="text-red-400 font-medium">Could not load assignment</p>
        <p className="text-gray-500 text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Assignment header */}
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-amber-400" />
            <h3 className="font-semibold text-white text-lg">{assignment.title}</h3>
          </div>
          {assignment.is_group_assignment && (
            <span className="badge badge-blue shrink-0">Group Assignment</span>
          )}
        </div>

        {assignment.instructions && (
          <div className="text-gray-300 text-sm whitespace-pre-wrap mb-4 leading-relaxed">
            {assignment.instructions}
          </div>
        )}

        <div className="flex flex-wrap gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <FileText size={12} /> Max Score: <strong className="text-white">{assignment.max_score}</strong>
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 size={12} /> Passing: <strong className="text-white">{assignment.passing_score}</strong>
          </span>
          {assignment.due_date && (
            <span className={clsx('flex items-center gap-1', isOverdue && 'text-red-400')}>
              <Clock size={12} />
              Due: {format(new Date(assignment.due_date), 'MMM d, yyyy h:mm a')}
              {isOverdue && <span className="text-red-400 font-medium"> (Overdue)</span>}
            </span>
          )}
        </div>
      </div>

      {/* Previous submission / Grade result */}
      {latest && (
        <div className={clsx('card border', latest.status === 'graded'
          ? isPassed ? 'border-green-500/30' : 'border-red-500/30'
          : 'border-amber-500/30'
        )}>
          <div className="flex items-center gap-2 mb-3">
            {latest.status === 'graded' ? (
              isPassed
                ? <CheckCircle2 size={18} className="text-green-400" />
                : <XCircle size={18} className="text-red-400" />
            ) : (
              <Clock size={18} className="text-amber-400" />
            )}
            <h4 className="font-medium text-white text-sm">
              {latest.status === 'graded' ? 'Graded' : latest.status === 'submitted' ? 'Submitted' : latest.status}
            </h4>
            <span className="text-xs text-gray-500 ml-auto">
              {formatDistanceToNow(new Date(latest.submitted_at), { addSuffix: true })}
            </span>
          </div>

          {latest.status === 'graded' && (
            <>
              <div className="flex items-baseline gap-2 mb-2">
                <span className={clsx('text-2xl font-bold',
                  isPassed ? 'text-green-400' : 'text-red-400'
                )}>
                  {latest.score}
                </span>
                <span className="text-gray-500">/ {latest.max_score}</span>
                <span className={clsx('text-sm ml-2', isPassed ? 'text-green-400' : 'text-red-400')}>
                  ({Math.round((latest.score / latest.max_score) * 100)}%)
                </span>
              </div>
              {latest.feedback && (
                <div className="bg-[#0A1628] rounded-lg p-3 text-sm text-gray-300 mt-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Instructor Feedback</p>
                  <p className="whitespace-pre-wrap">{latest.feedback}</p>
                </div>
              )}
            </>
          )}

          {latest.text_content && (
            <div className="mt-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Your Submission</p>
              <div className="bg-[#0A1628] rounded-lg p-3 text-sm text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {latest.text_content}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Submit form (only if not graded or allow resubmission) */}
      {(!latest || latest.status === 'submitted') && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          <h4 className="font-medium text-white text-sm flex items-center gap-2">
            <Upload size={16} className="text-blue-400" />
            {latest ? 'Resubmit Assignment' : 'Submit Assignment'}
          </h4>

          {isOverdue && (
            <div className="flex items-start gap-2 bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>The due date has passed. Submission may not be accepted.</span>
            </div>
          )}

          {assignment.allow_text_submission && (
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">Text Response</label>
              <textarea
                value={textContent}
                onChange={e => setTextContent(e.target.value)}
                rows={6}
                className="w-full bg-[#0A1628] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#3B9EE8] resize-none"
                placeholder="Write your answer here..."
                disabled={submitting}
              />
            </div>
          )}

          {assignment.allow_file_submission && (
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                File Upload (max {assignment.max_files} files, {assignment.max_file_size_mb}MB each)
              </label>
              <div className="border border-dashed border-gray-600 rounded-lg p-4">
                {files.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {files.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 bg-[#0A1628] rounded-lg px-3 py-2 text-sm text-gray-300">
                        <FileText size={14} className="text-blue-400 shrink-0" />
                        <span className="truncate flex-1">{f.name}</span>
                        <span className="text-xs text-gray-500">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                        <button type="button" onClick={() => removeFile(i)} className="text-gray-500 hover:text-red-400">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className={clsx(
                  'flex items-center justify-center gap-2 cursor-pointer rounded-lg border border-gray-700 px-4 py-3 text-sm transition-colors',
                  files.length >= (assignment.max_files || 5)
                    ? 'text-gray-600 bg-gray-800/50 cursor-not-allowed'
                    : 'text-gray-400 hover:text-white hover:border-[#3B9EE8]/50'
                )}>
                  <Upload size={16} />
                  {files.length >= (assignment.max_files || 5) ? 'Max files reached' : 'Choose Files'}
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    disabled={files.length >= (assignment.max_files || 5) || submitting}
                    onChange={e => {
                      const newFiles = Array.from(e.target.files);
                      const remaining = (assignment.max_files || 5) - files.length;
                      setFiles(prev => [...prev, ...newFiles.slice(0, remaining)].slice(0, assignment.max_files || 5));
                    }}
                  />
                </label>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting || (!textContent.trim() && files.length === 0)}
              className="btn-primary btn"
            >
              {submitting ? 'Submitting...' : latest ? 'Resubmit' : 'Submit Assignment'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
