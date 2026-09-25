import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, FileText, CheckCircle2, XCircle, BarChart3, ArrowLeft, Download, Eye, Upload, Save, X } from 'lucide-react';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import api from '../../../shared/api/client';
import { submissionsApi } from '../../../shared/api';
import Spinner from '../../../shared/components/ui/spinner';

export default function InstructorGradebookPage() {
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualLessonId, setManualLessonId] = useState('');
  const [manualMax, setManualMax] = useState('100');
  const [manualScores, setManualScores] = useState({});

  const queryClient = useQueryClient();

  const { data: courses = [], isLoading: coursesLoading } = useQuery({
    queryKey: ['instructor-courses-all'],
    queryFn: () => api.get('/courses/my-courses').then(r => r.data.data || []),
  });

  const { data: gbData, isLoading: gbLoading } = useQuery({
    queryKey: ['course-gradebook', selectedCourse],
    queryFn: () => api.get(`/submissions/gradebook/${selectedCourse}/all`).then(r => r.data.data),
    enabled: !!selectedCourse,
  });

  const { data: studentGradebook, isLoading: studentGbLoading } = useQuery({
    queryKey: ['student-gradebook', selectedCourse, selectedStudent],
    queryFn: () => submissionsApi.gradebookForUser(selectedCourse, selectedStudent).then(r => r.data.data),
    enabled: !!selectedCourse && !!selectedStudent,
  });

  const graderows = gbData?.graderows || [];
  const columns = gbData?.columns || [];

  const course = courses.find(c => c.id === selectedCourse);

  const { data: structure } = useQuery({
    queryKey: ['course-structure', course?.slug],
    queryFn: () => api.get(`/courses/${course.slug}`).then(r => r.data.data.course),
    enabled: !!course?.slug,
  });

  const lessonsList = (structure?.sections || []).flatMap(s =>
    (s.lessons || []).map(l => ({ ...l, sectionTitle: s.title }))
  );

  const openManual = () => {
    setManualOpen(true);
    setManualLessonId('');
    setManualMax('100');
    setManualScores({});
  };

  const selectManualLesson = (id) => {
    setManualLessonId(id);
    const prefill = {};
    for (const row of graderows) {
      const g = row.grades[id];
      if (g && g.gradeType === 'manual') prefill[row.student.id] = String(g.score);
    }
    setManualScores(prefill);
  };

  const manualMut = useMutation({
    mutationFn: () => {
      const grades = Object.entries(manualScores)
        .filter(([, v]) => v !== '' && v !== null && v !== undefined)
        .map(([userId, score]) => ({ userId, score: Number(score) }));
      return api.post(
        `/submissions/gradebook/${selectedCourse}/lessons/${manualLessonId}/manual-grades`,
        { grades, maxScore: Number(manualMax) }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-gradebook', selectedCourse] });
      toast.success('Manual grades saved');
      setManualOpen(false);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save grades'),
  });

  const downloadCsv = () => {
    api.get(`/submissions/gradebook/${selectedCourse}/export`, { responseType: 'blob' })
      .then(r => {
        const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `gradebook-${(course?.title || 'course').replace(/\W+/g, '-').toLowerCase()}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to download grades'));
  };

  if (!selectedCourse) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="font-display font-bold text-2xl text-white">Gradebook</h1>
          <p className="text-gray-400 text-sm mt-1">Select a course to view student grades</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {coursesLoading ? (
            <div className="col-span-full flex justify-center py-12"><Spinner /></div>
          ) : courses.length === 0 ? (
            <div className="col-span-full text-center py-16 text-gray-500">
              <BookOpen size={40} className="mx-auto mb-3 text-gray-700" />
              <p className="font-medium">No courses yet</p>
            </div>
          ) : courses.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCourse(c.id)}
              className="card text-left hover:border-[#3B9EE8]/40 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <BookOpen size={18} className="text-blue-400" />
                <span className={clsx('badge',
                  c.status === 'published' ? 'badge-green' : 'badge-gray'
                )}>{c.status}</span>
              </div>
              <p className="font-semibold text-white mb-1">{c.title}</p>
              <p className="text-xs text-gray-500">{c.student_count || 0} students</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => { setSelectedCourse(null); setSelectedStudent(null); }}
            className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-display font-bold text-2xl text-white">{course?.title}</h1>
            <p className="text-gray-400 text-sm mt-1">
              {graderows.length} student{graderows.length !== 1 ? 's' : ''} · {columns.length} graded item{columns.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openManual} className="btn-primary text-xs px-3 py-2 flex items-center gap-1.5">
            <Upload size={14} />
            Enter Manual Grades
          </button>
          <button onClick={downloadCsv} className="btn-ghost text-xs px-3 py-2 flex items-center gap-1.5">
            <Download size={14} />
            Download CSV
          </button>
        </div>
      </div>

      {gbLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : graderows.length === 0 ? (
        <div className="text-center py-16 text-gray-500 border border-gray-800 rounded-xl">
          <BarChart3 size={40} className="mx-auto mb-3 text-gray-700" />
          <p className="font-medium">No grades yet</p>
          <p className="text-sm mt-1">Grades will appear here once assignments and quizzes are graded</p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="sticky left-0 bg-[#0D1B2A] z-10 px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left min-w-[160px]">
                  Student
                </th>
                <th className="px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center min-w-[60px]">
                  Overall
                </th>
                {columns.map(col => (
                  <th key={col.lesson_id} className="px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center min-w-[80px]">
                    <div className="truncate max-w-[90px]" title={col.lesson_title}>
                      {col.lesson_title}
                    </div>
                    <div className="text-[10px] text-gray-600 font-normal mt-0.5">
                      {col.lesson_type} · {col.max_score}pts
                    </div>
                  </th>
                ))}
                <th className="px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center min-w-[50px]">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {graderows.map((row, i) => {
                const gradeCount = columns.filter(c => row.grades[c.lesson_id]).length;
                return (
                  <tr key={row.student.id}
                    className={clsx('border-b border-gray-800/50 hover:bg-white/[0.02]',
                      i % 2 === 0 && 'bg-white/[0.01]',
                      selectedStudent === row.student.id && 'bg-[#1A6FBF]/10'
                    )}>
                    <td className="sticky left-0 bg-[#0D1B2A] z-10 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#1B2D4A] flex items-center justify-center text-blue-400 text-xs font-semibold shrink-0">
                          {row.student.firstName?.[0]}{row.student.lastName?.[0]}
                        </div>
                        <div className="truncate">
                          <p className="font-medium text-white text-xs truncate">
                            {row.student.firstName} {row.student.lastName}
                          </p>
                          <p className="text-[10px] text-gray-500 truncate">{gradeCount}/{columns.length} graded</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      {row.summary.gradedItems > 0 ? (
                        <div>
                          <span className={clsx('text-sm font-bold',
                            row.summary.overallPct >= 70 ? 'text-green-400' :
                            row.summary.overallPct >= 40 ? 'text-amber-400' : 'text-red-400'
                          )}>
                            {row.summary.overallPct}%
                          </span>
                          <div className="text-[10px] text-gray-500">
                            {row.summary.totalScore}/{row.summary.maxScore}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    {columns.map(col => {
                      const grade = row.grades[col.lesson_id];
                      return (
                        <td key={col.lesson_id} className="px-3 py-3 text-center">
                          {grade ? (
                            <div className="flex flex-col items-center">
                              <span className={clsx('text-xs font-semibold',
                                grade.passed ? 'text-green-400' : 'text-red-400'
                              )}>
                                {grade.scorePct}%
                              </span>
                              <span className="text-[10px] text-gray-500">
                                {grade.score}/{grade.maxScore}
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-700 text-xs">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 text-center">
                      <button
                        onClick={() => setSelectedStudent(row.student.id)}
                        className="btn-ghost p-1 rounded-lg"
                        title="View student grades"
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Class summary card */}
      {graderows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          {[
            { label: 'Students', value: graderows.length, icon: BookOpen, color: 'text-blue-400' },
            { label: 'Graded Items', value: columns.length, icon: FileText, color: 'text-amber-400' },
            {
              label: 'Avg Score',
              value: graderows.filter(r => r.summary.gradedItems > 0).length > 0
                ? `${Math.round(graderows.reduce((s, r) => s + (r.summary.overallPct || 0), 0) / graderows.filter(r => r.summary.gradedItems > 0).length)}%`
                : '—',
              icon: BarChart3,
              color: 'text-green-400',
            },
            {
              label: 'Passing',
              value: `${graderows.filter(r => r.summary.overallPct >= 50).length}/${graderows.length}`,
              icon: CheckCircle2,
              color: 'text-green-400',
            },
          ].map(stat => (
            <div key={stat.label} className="card">
              <stat.icon size={18} className={clsx(stat.color, 'mb-2')} />
              <p className="text-xl font-bold text-white">{stat.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Manual grades modal */}
      {manualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => { if (!manualMut.isPending) setManualOpen(false); }}>
          <div className="bg-[#0D1B2A] border border-gray-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <div>
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <Upload size={16} className="text-blue-400" />
                  Manual Grades
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  For exams done on paper / physically
                </p>
              </div>
              <button onClick={() => setManualOpen(false)} className="text-gray-500 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Assessment lesson</label>
                  <select
                    value={manualLessonId}
                    onChange={e => selectManualLesson(e.target.value)}
                    className="w-full bg-[#0A1628] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="">Select a lesson…</option>
                    {lessonsList.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.title} ({l.sectionTitle || 'section'} · {l.type})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Maximum score</label>
                  <input
                    type="number"
                    min="1"
                    value={manualMax}
                    onChange={e => setManualMax(e.target.value)}
                    className="w-full bg-[#0A1628] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>

              {manualLessonId && graderows.length > 0 && (
                <div className="border border-gray-700 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-[1fr_90px_110px] px-4 py-2 bg-[#0A1628] text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    <span>Student</span>
                    <span className="text-center">Score</span>
                    <span className="text-right">Status</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {graderows.map(row => {
                      const val = manualScores[row.student.id] ?? '';
                      const num = Number(val);
                      const valid = val !== '' && !Number.isNaN(num) && num >= 0 && num <= Number(manualMax || 0);
                      return (
                        <div key={row.student.id} className="grid grid-cols-[1fr_90px_110px] items-center gap-2 px-4 py-2 border-t border-gray-800/50">
                          <span className="text-sm text-white truncate">
                            {row.student.firstName} {row.student.lastName}
                          </span>
                          <input
                            type="number"
                            min="0"
                            max={manualMax || undefined}
                            step="0.5"
                            value={val}
                            onChange={e => setManualScores(prev => ({ ...prev, [row.student.id]: e.target.value }))}
                            placeholder="—"
                            className="w-full bg-[#0A1628] border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white text-center"
                          />
                          <span className="text-right text-xs">
                            {valid
                              ? (num >= Number(manualMax || 0) * 0.5
                                  ? <span className="text-green-400">Pass</span>
                                  : <span className="text-red-400">Fail</span>)
                              : <span className="text-gray-600">—</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button onClick={() => setManualOpen(false)} className="btn-ghost text-sm px-4 py-2">
                  Cancel
                </button>
                <button
                  onClick={() => manualMut.mutate()}
                  disabled={!manualLessonId || manualMut.isPending}
                  className="btn-primary text-sm px-4 py-2 flex items-center gap-1.5"
                >
                  {manualMut.isPending ? <Spinner /> : <Save size={14} />}
                  Save Grades
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Student detail modal */}
      {selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSelectedStudent(null)}>
          <div className="bg-[#0D1B2A] border border-gray-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <h3 className="font-semibold text-white">Student Grades</h3>
              <button onClick={() => setSelectedStudent(null)} className="text-gray-500 hover:text-white">
                ✕
              </button>
            </div>
            {studentGbLoading ? (
              <div className="flex justify-center py-12"><Spinner /></div>
            ) : studentGradebook ? (
              <div className="p-5 space-y-4">
                {/* Summary */}
                <div className="flex items-center gap-3">
                  <div className={clsx('text-3xl font-bold',
                    (studentGradebook.summary?.overallPct || 0) >= 70 ? 'text-green-400' :
                    (studentGradebook.summary?.overallPct || 0) >= 40 ? 'text-amber-400' : 'text-red-400'
                  )}>
                    {studentGradebook.summary?.overallPct || 0}%
                  </div>
                  <div className="text-sm text-gray-400">
                    <p>{studentGradebook.summary?.totalScore || 0} / {studentGradebook.summary?.maxScore || 0} total</p>
                    <p>{studentGradebook.summary?.passed || 0} passed · {studentGradebook.summary?.failed || 0} failed · {studentGradebook.summary?.gradedItems || 0} items</p>
                  </div>
                </div>

                {/* Grade list */}
                {studentGradebook.grades?.length > 0 ? (
                  <div className="space-y-2">
                    {studentGradebook.grades.map(g => (
                      <div key={g.id} className="flex items-center justify-between bg-[#0A1628] rounded-lg px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {g.passed
                            ? <CheckCircle2 size={16} className="text-green-400 shrink-0" />
                            : <XCircle size={16} className="text-red-400 shrink-0" />
                          }
                          <div className="min-w-0">
                            <p className="text-sm text-white truncate">{g.lesson_title}</p>
                            <p className="text-xs text-gray-500">{g.section_title} · {g.grade_type}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className={clsx('text-sm font-semibold', g.passed ? 'text-green-400' : 'text-red-400')}>
                            {g.score}/{g.max_score}
                          </p>
                          <p className="text-xs text-gray-500">{g.score_pct}%</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-gray-500 py-6">No graded items yet</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}