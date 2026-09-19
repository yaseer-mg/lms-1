import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileText, MessageSquare, Megaphone, CalendarDays, CheckCircle, Play, Menu } from 'lucide-react';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import api            from '../../../shared/api/client';
import { announcementsApi } from '../../../shared/api/announcements.api';
import { useAuthStore } from '../../../shared/stores/authStore';
import VideoPlayer    from '../VideoPlayer';
import CourseProgress from '../CourseProgress';
import QuizPlayer     from '../../assessments/QuizPlayer';
import { offlineMutation } from '../../../shared/offline/mutations';
import AssignmentSubmission from '../AssignmentSubmission';
import SCORMPlayer from '../SCORMPlayer';
import LTILaunch from '../LTILaunch';
import Spinner from '../../../shared/components/ui/spinner';

export default function ClassroomPage() {
  const { courseId, lessonId } = useParams();
  const navigate               = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState('lesson'); // 'lesson' | 'announcements'
  const accessToken = useAuthStore(s => s.accessToken);
  const [lessonSidebarOpen, setLessonSidebarOpen] = useState(false);

  // Load full course progress (sections + lessons list)
  const { data: progress, error: progressError, refetch: refetchProgress } = useQuery({
    queryKey: ['course-progress', courseId],
    queryFn:  () => api.get(`/progress/courses/${courseId}`).then(r => r.data.data.progress),
    retry: false,
  });

  // Show start screen only on first visit (no progress, no specific lesson)
  const allLessons = progress?.lessons || [];
  const showStartScreen = progress && progress.completed_lessons === 0 && !lessonId;
  const activeLessonId = showStartScreen ? null : (lessonId || progress?.nextLessonId || allLessons[0]?.id);
  const activeLesson   = allLessons.find(l => l.id === activeLessonId);

  // Load lesson content
  const { data: lessonData, isLoading: lessonLoading } = useQuery({
    queryKey: ['lesson', activeLessonId, courseId],
    queryFn:  () => api.get(`/courses/${courseId}/lessons/${activeLessonId}`).then(r => r.data.data.lesson),
    enabled:  !!activeLessonId,
  });

  // Quiz data if lesson type = quiz
  const { data: quizData } = useQuery({
    queryKey: ['quiz-for-lesson', activeLessonId],
    queryFn:  () => api.get(`/assessments/quizzes/by-lesson/${activeLessonId}`).then(r => r.data.data),
    enabled:  lessonData?.type === 'quiz',
  });

  // Announcements
  const { data: announcements = [] } = useQuery({
    queryKey: ['classroom-announcements', courseId],
    queryFn:  () => announcementsApi.list(courseId).then(r => r.data.data || []),
  });

  // Navigate to next lesson
  const currentIndex = allLessons.findIndex(l => l.id === activeLessonId);
  const nextLesson   = allLessons[currentIndex + 1];
  const prevLesson   = allLessons[currentIndex - 1];

  const goToLesson = (id) => navigate(`/learn/${courseId}/lessons/${id}`);

  const handleStart = () => {
    if (allLessons[0]) goToLesson(allLessons[0].id);
  };

  const handleLessonComplete = () => {
    refetchProgress();
    if (nextLesson) setTimeout(() => goToLesson(nextLesson.id), 1500);
  };

  const [isCompleting, setIsCompleting] = useState(false);
  const completeMut = useMutation(offlineMutation('lesson-complete', {
    onSuccess: () => {
      toast.success('Lesson completed');
      refetchProgress();
      queryClient.invalidateQueries({ queryKey: ['course-progress', courseId] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to mark complete'),
  }));

  // Blocked state for date restrictions
  if (progressError?.response?.status === 403) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <div className="text-center max-w-md p-8">
          <CalendarDays size={48} className="mx-auto mb-4 text-gray-600" />
          <h2 className="text-xl font-bold text-white mb-2">Course Unavailable</h2>
          <p className="text-gray-400">{progressError?.response?.data?.message || 'This course is not available at this time.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">

      {/* Mobile overlay for lesson sidebar */}
      {lessonSidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setLessonSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar: lesson list ── */}
      <aside className={clsx(
        'fixed inset-y-16 left-0 z-30 w-72 flex flex-col border-r border-gray-800 bg-[#0D1B2A] overflow-hidden transition-transform duration-300',
        'lg:static lg:translate-x-0',
        lessonSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        <div className="p-4 border-b border-gray-800">
          <h2 className="font-semibold text-white text-sm line-clamp-2">
            {progress?.course_title || 'Course'}
          </h2>
        </div>
        <div className="overflow-y-auto flex-1">
          {progress
            ? <CourseProgress
                courseId={courseId}
                activeLessonId={activeLessonId}
                onSelectLesson={(id) => { setView('lesson'); goToLesson(id); setLessonSidebarOpen(false); }}
              />
            : <div className="flex justify-center py-10"><Spinner /></div>
          }
        </div>
        {/* Sidebar footer links */}
        <div className="border-t border-gray-800 p-3 space-y-1">
          <button onClick={() => { setView(view === 'announcements' ? 'lesson' : 'announcements'); setLessonSidebarOpen(false); }}
            className={clsx('w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
              view === 'announcements'
                ? 'bg-blue-500/10 text-blue-400'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            )}>
            <Megaphone size={15} />
            Announcements
            {announcements.length > 0 && (
              <span className="ml-auto text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">
                {announcements.length}
              </span>
            )}
          </button>
          <Link to={`/learn/${courseId}/forums`}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
            <MessageSquare size={15} />
            Discussions
          </Link>
        </div>
      </aside>

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-3
                        border-b border-gray-800 bg-[#0D1B2A] flex-shrink-0">
          {view === 'announcements' ? (
            <div className="flex items-center gap-3">
              <button onClick={() => setView('lesson')}
                className="btn-ghost p-1.5 rounded-lg">
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm text-white font-medium">Announcements</span>
            </div>
          ) : showStartScreen ? (
            <span className="text-sm text-white font-medium">Getting Started</span>
          ) : (
            <div className="flex items-center gap-3">
              <button onClick={() => setLessonSidebarOpen(true)}
                className="btn-ghost p-1.5 rounded-lg lg:hidden mr-1">
                <Menu size={18} />
              </button>
              <button onClick={() => prevLesson && goToLesson(prevLesson.id)}
                disabled={!prevLesson}
                className="btn-ghost p-1.5 rounded-lg disabled:opacity-30">
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm text-white font-medium line-clamp-1">
                {lessonData?.title || 'Loading…'}
              </span>
              <button onClick={() => nextLesson && goToLesson(nextLesson.id)}
                disabled={!nextLesson}
                className="btn-ghost p-1.5 rounded-lg disabled:opacity-30">
                <ChevronRight size={18} />
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>{progress?.percent_complete ?? 0}% complete</span>
            <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full"
                style={{ width: `${progress?.percent_complete ?? 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Start screen — first visit, no specific lesson targeted */}
        {showStartScreen && (
          <div className="flex-1 overflow-y-auto p-5 flex items-center justify-center">
            <div className="text-center max-w-lg">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400
                              flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-500/20">
                <Play size={28} className="text-white ml-0.5" fill="white" />
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">
                {progress?.course_title || 'Course'}
              </h1>
              <p className="text-gray-400 mb-8 leading-relaxed">
                You're enrolled and ready to go. Work through the lessons at your own pace, 
                and track your progress as you learn.
              </p>
              <div className="flex items-center justify-center gap-6 mb-8 text-sm text-gray-500">
                <span>{progress?.total_lessons || 0} lessons</span>
                <span className="w-px h-4 bg-gray-700" />
                <span>{Math.round((progress?.duration_seconds || 0) / 60)} minutes</span>
              </div>
              <button onClick={handleStart}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl
                          bg-blue-600 hover:bg-blue-700 text-white font-medium
                          transition-colors shadow-lg shadow-blue-600/20">
                <Play size={18} fill="white" />
                Start Learning
              </button>
            </div>
          </div>
        )}

        {!showStartScreen && (
        <div className="flex-1 overflow-y-auto p-5">
          {view === 'announcements' ? (
            <div className="max-w-3xl mx-auto space-y-4">
              <h2 className="font-display font-bold text-xl text-white flex items-center gap-2">
                <Megaphone size={20} className="text-blue-400" />
                Announcements
              </h2>
              {announcements.length === 0 ? (
                <p className="text-gray-500 text-sm py-8">No announcements yet.</p>
              ) : (
                announcements.map(a => (
                  <div key={a.id} className="bg-[#0A1628] rounded-xl p-5 border border-gray-800 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-white">{a.title}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {a.first_name} {a.last_name} &middot; {new Date(a.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {a.body && <p className="text-sm text-gray-300 whitespace-pre-wrap mt-2">{a.body}</p>}
                  </div>
                ))
              )}
            </div>
          ) : lessonLoading ? (
            <div className="flex justify-center py-20"><Spinner size="lg" /></div>
          ) : !lessonData ? (
            <div className="text-center py-20 text-gray-400">Lesson not found.</div>
          ) : (
            <div className="max-w-4xl mx-auto flex flex-col gap-6">

              {/* VIDEO lesson */}
              {lessonData.type === 'video' && lessonData.video_file_id && (
                <VideoPlayer
                  lessonId={lessonData.id}
                  courseId={courseId}
                  videoUrl={`/api/v1/files/${lessonData.video_file_id}?token=${encodeURIComponent(accessToken || '')}`}
                  durationSecs={lessonData.duration_seconds}
                  onComplete={handleLessonComplete}
                  onNext={nextLesson ? () => goToLesson(nextLesson.id) : undefined}
                />
              )}

              {/* TEXT lesson */}
              {lessonData.type === 'text' && (
                <>
                  <div className="card prose prose-invert max-w-none">
                    <div
                      className="text-gray-300 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: lessonData.content || '' }}
                    />
                  </div>
                  <LessonCompletionBar
                    lessonId={lessonData.id}
                    courseId={courseId}
                    isCompleted={activeLesson?.is_completed}
                    onComplete={() => completeMut.mutate({ lessonId: lessonData.id, courseId })}
                    loading={completeMut.isPending}
                    nextLesson={nextLesson}
                    onNext={() => goToLesson(nextLesson.id)}
                    prevLesson={prevLesson}
                    onPrev={() => goToLesson(prevLesson.id)}
                  />
                </>
              )}

              {/* QUIZ lesson */}
              {lessonData.type === 'quiz' && quizData?.quiz && (
                <QuizPlayer
                  quizId={quizData.quiz.id}
                  courseId={courseId}
                  onComplete={handleLessonComplete}
                />
              )}

              {/* ASSIGNMENT lesson */}
              {lessonData.type === 'assignment' && (
                <AssignmentSubmission
                  lessonId={lessonData.id}
                  courseId={courseId}
                  onComplete={handleLessonComplete}
                />
              )}

              {/* SCORM lesson */}
              {lessonData.type === 'scorm' && <ScormLesson
                lessonId={lessonData.id}
                courseId={courseId}
                onComplete={handleLessonComplete}
              />}

              {/* LTI lesson */}
              {lessonData.type === 'lti' && (
                <>
                  <LTILaunch
                    lessonId={lessonData.id}
                    courseId={courseId}
                    onComplete={handleLessonComplete}
                  />
                  <LessonCompletionBar
                    lessonId={lessonData.id}
                    courseId={courseId}
                    isCompleted={activeLesson?.is_completed}
                    onComplete={() => completeMut.mutate({ lessonId: lessonData.id, courseId })}
                    loading={completeMut.isPending}
                    nextLesson={nextLesson}
                    onNext={() => goToLesson(nextLesson.id)}
                    prevLesson={prevLesson}
                    onPrev={() => goToLesson(prevLesson.id)}
                  />
                </>
              )}

              {/* PDF / fallback for unknown types */}
              {!['video', 'text', 'quiz', 'assignment', 'scorm', 'lti'].includes(lessonData.type) && (
                <>
                  {lessonData.content && (
                    <div className="card prose prose-invert max-w-none">
                      <div className="text-gray-300 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: lessonData.content || '' }} />
                    </div>
                  )}
                  <LessonCompletionBar
                    lessonId={lessonData.id}
                    courseId={courseId}
                    isCompleted={activeLesson?.is_completed}
                    onComplete={() => completeMut.mutate({ lessonId: lessonData.id, courseId })}
                    loading={completeMut.isPending}
                    nextLesson={nextLesson}
                    onNext={() => goToLesson(nextLesson.id)}
                    prevLesson={prevLesson}
                    onPrev={() => goToLesson(prevLesson.id)}
                  />
                </>
              )}

              {/* Lesson title + resources */}
              <div className="card">
                <h1 className="font-display font-bold text-xl text-white mb-3">
                  {lessonData.title}
                </h1>

                {lessonData.resources?.length > 0 && (
                  <div className="mt-4 border-t border-gray-700 pt-4">
                    <p className="text-sm font-semibold text-gray-400 mb-3">
                      Resources
                    </p>
                    <div className="flex flex-col gap-2">
                      {lessonData.resources.map(r => (
                        <a
                          key={r.id}
                          href={`/api/v1/files/${r.file_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 text-sm text-[#3B9EE8]
                                     hover:underline"
                        >
                          <FileText size={14} />
                          {r.title}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Course forum link */}
              <div className="flex justify-end">
                <Link
                  to={`/learn/${courseId}/forums`}
                  className="btn-ghost text-sm flex items-center gap-2"
                >
                  <MessageSquare size={15} />
                  Course discussions
                </Link>
              </div>

            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

// ── Lesson completion bar ──────────────────────
function LessonCompletionBar({ lessonId, courseId, isCompleted, onComplete, loading, nextLesson, onNext, prevLesson, onPrev }) {
  const [marked, setMarked] = useState(false);
  const completed = isCompleted || marked;

  return (
    <div className="card flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3">
        {prevLesson && (
          <button onClick={onPrev}
            className="btn-ghost flex items-center gap-1.5 text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg transition-colors">
            <ChevronLeft size={16} /> Previous
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => { if (!completed) { onComplete(); setMarked(true); } }}
          disabled={completed || loading}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            completed
              ? 'bg-green-600 text-white cursor-default'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
          }`}
        >
          <CheckCircle size={16} />
          {completed ? 'Completed' : 'Mark Complete'}
        </button>
        {nextLesson && (
          <button onClick={onNext}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors">
            Next Lesson <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── SCORM sub-component ───────────────────────
function ScormLesson({ lessonId, courseId, onComplete }) {
  const { data: pkg, isLoading, error } = useQuery({
    queryKey: ['scorm-package', courseId, lessonId],
    queryFn: () => api.get(`/scorm/courses/${courseId}/lessons/${lessonId}/package`).then(r => r.data.data.package),
    enabled: !!lessonId,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (error) return <div className="card text-center py-12 text-red-400">Failed to load SCORM content</div>;
  if (!pkg) return <div className="card text-center py-12 text-gray-500">No SCORM package uploaded yet</div>;

  return <SCORMPlayer packageId={pkg.id} lessonId={lessonId} courseId={courseId} onComplete={onComplete} />;
}