import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../../shared/stores/authStore';
import {
  BookOpen, Plus, Trash2, GripVertical, Video, FileText, HelpCircle,
  ClipboardList, Eye, Upload, ChevronDown, ChevronRight, Save, EyeOff, BarChart3,
  Lock, Unlock, X, Megaphone, Database, Package, ExternalLink, Globe,
  Calendar, Settings, ToggleLeft, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../shared/api/client';
import { coursesApi, lessonsApi } from '../../../shared/api/courses.api';
import { assessmentsApi } from '../../../shared/api/assessments.api';
import { questionBankApi } from '../../../shared/api/question-bank.api';
import { submissionsApi } from '../../../shared/api/submissions.api';
import { availabilityApi } from '../../../shared/api/availability.api';
import { announcementsApi } from '../../../shared/api/announcements.api';
import Spinner from '../../../shared/components/ui/spinner';
import Button from '../../../shared/components/ui/Button';
import Input, { Textarea, Select } from '../../../shared/components/ui/input';
import Modal from '../../../shared/components/ui/modal';
import QuizAnalyticsModal from '../components/QuizAnalyticsModal';
import { clsx } from 'clsx';

const LEVELS = ['beginner', 'intermediate', 'advanced'];

// Client-side preview helper (authoritative validation happens server-side)
const youtubeIdFromUrl = (url) => {
  if (!url) return null;
  const m = String(url).trim().match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
};

const LESSON_TYPES = [
  { value: 'video', label: 'Video', icon: Video },
  { value: 'text', label: 'Text', icon: FileText },
  { value: 'quiz', label: 'Quiz', icon: HelpCircle },
  { value: 'assignment', label: 'Assignment', icon: ClipboardList },
  { value: 'scorm', label: 'SCORM', icon: Package },
  { value: 'lti', label: 'LTI Tool', icon: Globe },
];

const TAB_CONFIG = {
  details: { label: 'Course Details', icon: FileText },
  curriculum: { label: 'Curriculum', icon: BookOpen },
  settings: { label: 'Settings', icon: Settings },
  announcements: { label: 'Announcements', icon: Megaphone },
  'question-bank': { label: 'Question Bank', icon: HelpCircle },
  groups: { label: 'Groups', icon: Users },
};

export default function CourseBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditing = !!id;
  const isExactlyInstructor = useAuthStore(s => s.user?.role === 'instructor');

  const [tab, setTab] = useState(isExactlyInstructor ? 'curriculum' : 'details');
  const [form, setForm] = useState({
    title: '', description: '', shortDescription: '', categoryId: '',
    level: 'beginner', language: 'English',
    tags: '', requirements: '', objectives: '',
    price: '', duration: '',
  });
  const [settings, setSettings] = useState({
    startDate: '',
    endDate: '',
    enableCompletionTracking: false,
    showGradesToStudent: true,
  });
  const [sections, setSections] = useState(() => {
    const cached = queryClient.getQueryData(['course-builder', id]);
    return cached?.sections || [];
  });
  const [expandedSections, setExpandedSections] = useState(() => {
    const cached = queryClient.getQueryData(['course-builder', id]);
    const expanded = {};
    (cached?.sections || []).forEach(s => { expanded[s.id] = true; });
    return expanded;
  });
  const [showSectionModal, setShowSectionModal] = useState(false);
  const [showLessonModal, setShowLessonModal] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [editingLesson, setEditingLesson] = useState(null);
  const [analyticsQuizId, setAnalyticsQuizId] = useState(null);

  // Fetch course data for editing
  const { data: courseData, isLoading } = useQuery({
    queryKey: ['course-builder', id],
    queryFn: () => api.get(`/courses/my-courses`).then(r => {
      const course = r.data.data?.find(c => c.id === id);
      if (!course) throw new Error('Course not found');
      // Fetch full detail with sections/lessons
      return api.get(`/courses/${course.slug}`).then(r2 => {
        const c = r2.data.data.course;
        setForm({
          title: c.title || '',
          description: c.description || '',
          shortDescription: c.short_description || '',
          categoryId: c.category_id || '',
          level: c.level || 'beginner',
          language: c.language || 'English',
          tags: (c.tags || []).join(', '),
          requirements: (c.requirements || []).join(', '),
          objectives: (c.objectives || []).join(', '),
          price: c.metadata?.price?.toString() || '',
          duration: c.metadata?.duration || '',
        });
        setSettings({
          startDate: c.start_date ? c.start_date.slice(0, 16) : '',
          endDate: c.end_date ? c.end_date.slice(0, 16) : '',
          enableCompletionTracking: c.enable_completion_tracking ?? false,
          showGradesToStudent: c.show_grades_to_student ?? true,
        });
        setSections(c.sections || []);
        const expanded = {};
        (c.sections || []).forEach(s => { expanded[s.id] = true; });
        setExpandedSections(expanded);
        return c;
      });
    }),
    enabled: isEditing,
  });

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => coursesApi.categories().then(r => r.data.data?.categories || []),
  });

  const createCourse = useMutation({
    mutationFn: (data) => coursesApi.create(data),
    onSuccess: (res) => {
      toast.success('Course created');
      navigate(`/instructor/courses/${res.data.data.course.id}/edit`);
      queryClient.invalidateQueries({ queryKey: ['instructor-courses'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  });

  const updateCourse = useMutation({
    mutationFn: (data) => coursesApi.update(id, data),
    onSuccess: () => {
      toast.success('Course saved');
      queryClient.invalidateQueries({ queryKey: ['course-builder', id] });
      queryClient.invalidateQueries({ queryKey: ['instructor-courses'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  });

  const createSectionMut = useMutation({
    mutationFn: (data) => coursesApi.createSection(id, data),
    onSuccess: (res) => {
      setSections(prev => [...prev, res.data.data.section]);
      setShowSectionModal(false);
      toast.success('Section added');
      queryClient.invalidateQueries({ queryKey: ['course-builder', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  });

  const deleteSectionMut = useMutation({
    mutationFn: (sectionId) => coursesApi.deleteSection(id, sectionId),
    onSuccess: () => {
      setSections(prev => prev.filter(s => s.id !== activeSectionId));
      toast.success('Section deleted');
      queryClient.invalidateQueries({ queryKey: ['course-builder', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  });

  const publishMut = useMutation({
    mutationFn: () => api.patch(`/courses/${id}/publish`),
    onSuccess: () => {
      toast.success('Course published');
      queryClient.invalidateQueries({ queryKey: ['course-builder', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to publish'),
  });

  const unpublishMut = useMutation({
    mutationFn: () => api.patch(`/courses/${id}/unpublish`),
    onSuccess: () => {
      toast.success('Course unpublished');
      queryClient.invalidateQueries({ queryKey: ['course-builder', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to unpublish'),
  });

  const thumbnailMut = useMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('thumbnail', file);
      return coursesApi.uploadThumbnail(id, fd);
    },
    onSuccess: () => {
      toast.success('Thumbnail uploaded');
      queryClient.invalidateQueries({ queryKey: ['course-builder', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  });

  // Announcements
  const { data: announcementsData } = useQuery({
    queryKey: ['course-announcements', id],
    queryFn: () => announcementsApi.list(id).then(r => r.data.data || []),
    enabled: isEditing,
  });

  const [announceForm, setAnnounceForm] = useState({ title: '', body: '' });

  const postAnnounceMut = useMutation({
    mutationFn: (data) => announcementsApi.create(id, data),
    onSuccess: () => {
      toast.success('Announcement posted');
      setAnnounceForm({ title: '', body: '' });
      queryClient.invalidateQueries({ queryKey: ['course-announcements', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to post announcement'),
  });

  const deleteAnnounceMut = useMutation({
    mutationFn: (announceId) => announcementsApi.delete(id, announceId),
    onSuccess: () => {
      toast.success('Announcement deleted');
      queryClient.invalidateQueries({ queryKey: ['course-announcements', id] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete'),
  });

  const handleSaveDetails = () => {
    const data = {
      title: form.title,
      description: form.description || undefined,
      shortDescription: form.shortDescription || undefined,
      categoryId: form.categoryId || undefined,
      level: form.level,
      language: form.language || undefined,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      requirements: form.requirements ? form.requirements.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      objectives: form.objectives ? form.objectives.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      startDate: settings.startDate ? new Date(settings.startDate).toISOString() : null,
      endDate: settings.endDate ? new Date(settings.endDate).toISOString() : null,
      enableCompletionTracking: settings.enableCompletionTracking,
      showGradesToStudent: settings.showGradesToStudent,
      metadata: {
        price: form.price ? Number(form.price) : 0,
        duration: form.duration || '',
        currency: 'NGN',
      },
    };

    if (isEditing) {
      updateCourse.mutate(data);
    } else {
      createCourse.mutate(data);
    }
  };

  const handleSectionSubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd);
    Object.keys(data).forEach(k => { if (data[k] === '') delete data[k]; });
    createSectionMut.mutate(data);
  };

  if (isEditing && isLoading) {
    return <div className="flex justify-center py-20"><Spinner /></div>;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-white">
            {isExactlyInstructor ? 'Manage Curriculum' : isEditing ? 'Edit Course' : 'Create Course'}
          </h1>
          {isEditing && <p className="text-gray-500 text-sm mt-1">{form.title}</p>}
        </div>
        <div className="flex items-center gap-2">
          {isEditing && (
            <>
              {courseData?.status === 'published' ? (
                <Button variant="ghost" onClick={() => unpublishMut.mutate()} loading={unpublishMut.isPending}>
                  <EyeOff size={16} /> Unpublish
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => publishMut.mutate()} loading={publishMut.isPending}>
                  <Eye size={16} /> Publish
                </Button>
              )}
              <Button variant="ghost" onClick={() => navigate(`/courses/${courseData?.slug}`)}>
                <Eye size={16} /> Preview
              </Button>
            </>
          )}
          {!isExactlyInstructor && (
            <Button onClick={handleSaveDetails} loading={createCourse.isPending || updateCourse.isPending}>
              <Save size={16} /> {isEditing ? 'Save' : 'Create'}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1.5 bg-white/[0.02] border border-gray-800 rounded-xl mb-6 overflow-x-auto w-max max-w-full">
        {['details', 'curriculum', 'settings', 'announcements', 'question-bank', 'groups'].filter(t => {
          if (isExactlyInstructor && t === 'details') return false;
          if (!isEditing && (t === 'announcements' || t === 'question-bank' || t === 'groups' || t === 'settings')) return false;
          return true;
        }).map(t => {
          const config = TAB_CONFIG[t] || { label: t, icon: FileText };
          const Icon = config.icon;
          const isActive = tab === t;
          return (
            <button key={t}
              onClick={() => {
                if (t === 'question-bank') navigate(`/instructor/courses/${id}/question-bank`);
                else if (t === 'groups') navigate(`/instructor/courses/${id}/groups`);
                else setTab(t);
              }}
              className={clsx('flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap border',
                isActive 
                  ? 'bg-[#3B9EE8]/10 text-[#3B9EE8] border-[#3B9EE8]/20 shadow-sm'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.01] border-transparent'
              )}
            >
              <Icon size={16} />
              {config.label}
            </button>
          );
        })}
      </div>

      {tab === 'details' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left Column - Main Info */}
          <div className="lg:col-span-2 space-y-6">
            <div className="card p-6 space-y-5">
              <h3 className="font-semibold text-lg flex items-center gap-2 border-b border-gray-800 pb-3" style={{ color: 'var(--text-primary)' }}>
                <FileText size={16} className="text-[#3B9EE8]" />
                Basic Course Info
              </h3>
              
              <Input label="Course title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                placeholder="e.g. Introduction to Web Development" />

              <div>
                <label className="text-sm font-medium text-gray-300 mb-1.5 block">Description</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={5} className="input resize-none" placeholder="Full course description…" />
              </div>

              <Input label="Short description" value={form.shortDescription}
                onChange={e => setForm(p => ({ ...p, shortDescription: e.target.value }))}
                placeholder="Brief summary shown in course cards" />
            </div>

            <div className="card p-6 space-y-5">
              <h3 className="font-semibold text-lg flex items-center gap-2 border-b border-gray-800 pb-3" style={{ color: 'var(--text-primary)' }}>
                <ClipboardList size={16} className="text-[#3B9EE8]" />
                Requirements & Objectives
              </h3>

              <div>
                <label className="text-sm font-medium text-gray-300 mb-1.5 block">Requirements (one per line)</label>
                <textarea value={form.requirements}
                  onChange={e => setForm(p => ({ ...p, requirements: e.target.value }))}
                  rows={3} className="input resize-none" placeholder="Basic computer skills, Internet access" />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-300 mb-1.5 block">Objectives (one per line)</label>
                <textarea value={form.objectives}
                  onChange={e => setForm(p => ({ ...p, objectives: e.target.value }))}
                  rows={3} className="input resize-none" placeholder="Build a REST API, Deploy to production" />
              </div>
            </div>
          </div>

          {/* Right Column - Sidebar Settings */}
          <div className="space-y-6">
            <div className="card p-6 space-y-5">
              <h3 className="font-semibold text-lg flex items-center gap-2 border-b border-gray-800 pb-3" style={{ color: 'var(--text-primary)' }}>
                <Database size={16} className="text-[#3B9EE8]" />
                Course Metadata
              </h3>

              <Select label="Category" value={form.categoryId}
                onChange={e => setForm(p => ({ ...p, categoryId: e.target.value }))}>
                <option value="">Select category</option>
                {(categories || []).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>

              <Select label="Level" value={form.level}
                onChange={e => setForm(p => ({ ...p, level: e.target.value }))}>
                {LEVELS.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
              </Select>

              <Input label="Language" value={form.language}
                onChange={e => setForm(p => ({ ...p, language: e.target.value }))} />

              <Input label="Price (NGN)" type="number" min="0" value={form.price}
                onChange={e => setForm(p => ({ ...p, price: e.target.value }))}
                placeholder="e.g. 5000" />

              <Input label="Duration" value={form.duration}
                onChange={e => setForm(p => ({ ...p, duration: e.target.value }))}
                placeholder="e.g. 8 Weeks" />

              <div>
                <label className="text-sm font-medium text-gray-300 mb-1.5 block">Tags (comma separated)</label>
                <input value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))}
                  className="input" placeholder="html, css, javascript" />
              </div>
            </div>

            {isEditing && (
              <div className="card p-6 space-y-5">
                <h3 className="font-semibold text-lg flex items-center gap-2 border-b border-gray-800 pb-3" style={{ color: 'var(--text-primary)' }}>
                  <Upload size={16} className="text-[#3B9EE8]" />
                  Course Thumbnail
                </h3>

                <div className="space-y-4">
                  {courseData?.thumbnail_path ? (
                    <div className="relative group rounded-xl overflow-hidden border border-gray-800 bg-[#0D1B2A] aspect-video">
                      <img src={`/lmsdata/${courseData.thumbnail_path}`} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <label className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-xs font-semibold text-white cursor-pointer transition-all duration-200">
                          <Upload size={14} className="inline mr-1" /> Replace Image
                          <input type="file" accept="image/*" className="hidden"
                            onChange={e => { if (e.target.files[0]) thumbnailMut.mutate(e.target.files[0]); }} />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-800 rounded-xl p-8 hover:border-[#3B9EE8]/50 hover:bg-white/[0.01] transition-all cursor-pointer group">
                      <Upload size={24} className="text-gray-500 group-hover:text-[#3B9EE8] mb-2 transition-colors" />
                      <p className="text-xs font-medium text-gray-300 group-hover:text-white transition-colors">Upload course thumbnail</p>
                      <p className="text-[10px] text-gray-500 mt-1">PNG, JPG up to 5MB</p>
                      <input type="file" accept="image/*" className="hidden"
                        onChange={e => { if (e.target.files[0]) thumbnailMut.mutate(e.target.files[0]); }} />
                    </label>
                  )}
                  {thumbnailMut.isPending && (
                    <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                      <Spinner size="sm" /> Uploading image...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'curriculum' && (
        <div>
          {!isEditing ? (
            <div className="text-center py-20 text-gray-500">
              <BookOpen size={40} className="mx-auto mb-3 text-gray-700" />
              <p className="font-medium">Save the course first to add curriculum</p>
              <p className="text-sm mt-1">Fill in the course details and click Create</p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-400">
                  {sections.length} section{sections.length !== 1 ? 's' : ''} — {sections.reduce((sum, s) => sum + (s.lessons?.length || 0), 0)} lessons
                </p>
                <Button onClick={() => setShowSectionModal(true)}><Plus size={16} /> Section</Button>
              </div>

              <div className="space-y-3">
                {sections.map((section, si) => (
                  <SectionCard
                    key={section.id}
                    section={section}
                    index={si}
                    courseId={id}
                    isExpanded={expandedSections[section.id]}
                    onToggle={() => setExpandedSections(prev => ({ ...prev, [section.id]: !prev[section.id] }))}
                    onDelete={() => { setActiveSectionId(section.id); deleteSectionMut.mutate(section.id); }}
                    onAddLesson={() => { setActiveSectionId(section.id); setEditingLesson(null); setShowLessonModal(true); }}
                    onEditLesson={(lesson) => { setActiveSectionId(section.id); setEditingLesson(lesson); setShowLessonModal(true); }}
                  />
                ))}
              </div>

              {sections.length === 0 && (
                <div className="text-center py-16 border-2 border-dashed border-gray-800 rounded-xl">
                  <BookOpen size={36} className="mx-auto mb-3 text-gray-700" />
                  <p className="text-gray-500">No sections yet. Add your first section.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="max-w-xl space-y-6">
          <div className="card space-y-5">
            <h3 className="font-semibold text-lg flex items-center gap-2 border-b border-gray-800 pb-3"
                style={{ color: 'var(--text-primary)' }}>
              <Calendar size={16} className="text-[#3B9EE8]" />
              Course Dates
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-300 mb-1.5 block">Start Date</label>
                <div className="relative">
                  <input type="datetime-local" value={settings.startDate}
                    onChange={e => setSettings(p => ({ ...p, startDate: e.target.value }))}
                    className="input" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-300 mb-1.5 block">End Date</label>
                <div className="relative">
                  <input type="datetime-local" value={settings.endDate}
                    onChange={e => setSettings(p => ({ ...p, endDate: e.target.value }))}
                    className="input" />
                </div>
              </div>
            </div>
          </div>

          <div className="card space-y-5">
            <h3 className="font-semibold text-lg flex items-center gap-2 border-b border-gray-800 pb-3"
                style={{ color: 'var(--text-primary)' }}>
              <ToggleLeft size={16} className="text-[#3B9EE8]" />
              Tracking & Grades
            </h3>

            <div className="space-y-4">
              <label className="flex items-center justify-between p-4 rounded-xl border border-gray-800 bg-[#112236]/30 hover:border-gray-700 transition-all cursor-pointer">
                <div className="pr-4">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Enable Completion Tracking</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>Track lesson completion progress for students</p>
                </div>
                <div className="relative inline-flex items-center shrink-0">
                  <input type="checkbox" checked={settings.enableCompletionTracking}
                    onChange={e => setSettings(p => ({ ...p, enableCompletionTracking: e.target.checked }))}
                    className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-300 dark:bg-gray-850 border border-gray-400 dark:border-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#3B9EE8] peer-checked:border-[#3B9EE8]"></div>
                </div>
              </label>

              <label className="flex items-center justify-between p-4 rounded-xl border border-gray-800 bg-[#112236]/30 hover:border-gray-700 transition-all cursor-pointer">
                <div className="pr-4">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Show Grades to Students</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>Students can view their scores in the gradebook</p>
                </div>
                <div className="relative inline-flex items-center shrink-0">
                  <input type="checkbox" checked={settings.showGradesToStudent}
                    onChange={e => setSettings(p => ({ ...p, showGradesToStudent: e.target.checked }))}
                    className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-300 dark:bg-gray-850 border border-gray-400 dark:border-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#3B9EE8] peer-checked:border-[#3B9EE8]"></div>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveDetails} loading={updateCourse.isPending}>
              <Save size={16} /> Save Settings
            </Button>
          </div>
        </div>
      )}

      {tab === 'announcements' && (
        <div className="max-w-3xl space-y-6">
          <div className="card space-y-4">
            <h3 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>Post Announcement</h3>
            <Input label="Title" value={announceForm.title}
              onChange={e => setAnnounceForm(p => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Assignment deadline extended" />
            <div>
              <label className="text-sm font-medium text-gray-300 mb-1.5 block">Message</label>
              <textarea value={announceForm.body}
                onChange={e => setAnnounceForm(p => ({ ...p, body: e.target.value }))}
                rows={4} className="input resize-none" placeholder="Write your announcement..." />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => postAnnounceMut.mutate(announceForm)}
                loading={postAnnounceMut.isPending}>
                <Megaphone size={14} /> Post Announcement
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold text-lg flex items-center gap-2"
                style={{ color: 'var(--text-primary)' }}>
              <Megaphone size={16} className="text-blue-400" />
              Previous Announcements
            </h3>
            {!announcementsData || announcementsData.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No announcements yet.</p>
            ) : (
              announcementsData.map(a => (
                <div key={a.id} className="card p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{a.title}</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {a.first_name} {a.last_name} &middot; {new Date(a.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button onClick={() => deleteAnnounceMut.mutate(a.id)}
                      className="text-red-400 hover:text-red-300 p-1 shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {a.body && <p className="text-sm text-gray-300 whitespace-pre-wrap">{a.body}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Section modal */}
      <Modal open={showSectionModal} onClose={() => setShowSectionModal(false)} title="Add Section" size="sm">
        <form onSubmit={handleSectionSubmit} className="flex flex-col gap-4">
          <Input label="Section title" name="title" required placeholder="e.g. Getting Started" />
          <Textarea label="Description (optional)" name="description" rows={2} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowSectionModal(false)}>Cancel</Button>
            <Button type="submit" loading={createSectionMut.isPending}>Add</Button>
          </div>
        </form>
      </Modal>

      {/* Lesson modal */}
      <LessonModal
        open={showLessonModal}
        onClose={() => { setShowLessonModal(false); setEditingLesson(null); }}
        courseId={id}
        sectionId={activeSectionId}
        lesson={editingLesson}
        courseLessons={sections.flatMap(s => s.lessons || [])}
        onAnalytics={(qId) => setAnalyticsQuizId(qId)}
        onSaved={(newLesson) => {
          if (!editingLesson && newLesson) {
            setEditingLesson(newLesson);
            queryClient.invalidateQueries({ queryKey: ['course-builder', id] });
          } else {
            setShowLessonModal(false);
            setEditingLesson(null);
            queryClient.invalidateQueries({ queryKey: ['course-builder', id] });
          }
        }}
      />
      <QuizAnalyticsModal
        quizId={analyticsQuizId}
        open={!!analyticsQuizId}
        onClose={() => setAnalyticsQuizId(null)}
      />
    </div>
  );
}

function SectionCard({ section, index, courseId, isExpanded, onToggle, onDelete, onAddLesson, onEditLesson }) {
  const lessons = section.lessons || [];

  return (
    <div className="card overflow-hidden border-l-4 border-l-[#3B9EE8] transition-all duration-200">
      <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/[0.01]" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <GripVertical size={16} className="text-gray-600 cursor-grab shrink-0" />
          <div>
            <p className="font-semibold text-white text-base">
              Section {index + 1}: {section.title}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {section.description || 'No description'} &bull; {lessons.length} lesson{lessons.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={e => { e.stopPropagation(); onAddLesson(); }}
            className="p-1.5 rounded-lg border border-gray-800 hover:border-gray-700 bg-white/[0.02] text-gray-400 hover:text-white transition-all flex items-center gap-1 text-xs" title="Add lesson">
            <Plus size={14} /> Add Lesson
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 rounded-lg border border-transparent hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-all" title="Delete section">
            <Trash2 size={14} />
          </button>
          <div className="p-1.5">
            {isExpanded ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-800 bg-[#0F1E33]/30 px-6 py-4 space-y-2">
          {lessons.map((lesson, li) => (
            <div key={lesson.id}
              className="flex items-center justify-between py-3 px-4 rounded-xl border border-gray-800/60 bg-[#112236]/30 hover:bg-white/[0.01] hover:border-[#3B9EE8]/30 transition-all cursor-pointer group"
              onClick={() => onEditLesson(lesson)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs text-gray-600 w-5 text-right font-medium shrink-0">{li + 1}.</span>
                <div className="p-1.5 bg-[#0D1B2A] rounded-lg border border-gray-800 shrink-0">
                  <LessonTypeIcon type={lesson.type} />
                </div>
                <span className="text-sm font-medium text-gray-300 group-hover:text-white truncate transition-colors mr-2">{lesson.title}</span>
                <LessonTypeBadge type={lesson.type} />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-gray-500 hidden sm:inline mr-2">
                  {lesson.duration_seconds ? `${Math.round(lesson.duration_seconds / 60)} mins` : 'No duration'}
                </span>
                <button onClick={e => { e.stopPropagation(); onEditLesson(lesson); }}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all opacity-0 group-hover:opacity-100">
                  Edit
                </button>
              </div>
            </div>
          ))}
          {lessons.length === 0 && (
            <div className="text-center py-6 text-gray-500 border border-dashed border-gray-800 rounded-xl bg-black/[0.02]">
              <HelpCircle size={20} className="mx-auto mb-1.5 text-gray-700" />
              <p className="text-xs">No lessons added to this section yet.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LessonTypeIcon({ type }) {
  const map = { video: Video, text: FileText, quiz: HelpCircle, assignment: ClipboardList, scorm: Package, lti: Globe };
  const Icon = map[type] || FileText;
  return <Icon size={14} className="text-gray-500" />;
}

function LessonTypeBadge({ type }) {
  const map = {
    video: { label: 'Video', class: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
    text: { label: 'Article', class: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
    quiz: { label: 'Quiz', class: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
    assignment: { label: 'Assignment', class: 'bg-green-500/10 text-green-400 border-green-500/20' },
    scorm: { label: 'SCORM', class: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
    lti: { label: 'LTI Tool', class: 'bg-teal-500/10 text-teal-400 border-teal-500/20' },
  };
  const config = map[type] || { label: type, class: 'bg-gray-500/10 text-gray-400 border-gray-500/20' };
  return (
    <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize shrink-0', config.class)}>
      {config.label}
    </span>
  );
}

function LessonModal({ open, onClose, courseId, sectionId, lesson, courseLessons = [], onSaved, onAnalytics }) {
  const queryClient = useQueryClient();
  const allCourseLessons = courseLessons;
  const isEditing = !!lesson;
  const [form, setForm] = useState({
    title: '', type: 'video', content: '', durationSeconds: '',
  });
  const [videoFile, setVideoFile] = useState(null);
  const [resourceFile, setResourceFile] = useState(null);
  const [videoSource, setVideoSource] = useState('upload');
  const [videoUrl, setVideoUrl] = useState('');

  // Quiz builder state
  const [quizForm, setQuizForm] = useState({
    title: '', description: '', passingScorePct: 70, timeLimitMins: '',
    maxAttempts: 1, shuffleQuestions: false,
  });
  const [questions, setQuestions] = useState([]);
  const [savedQuizId, setSavedQuizId] = useState(null);
  const [showQuestionForm, setShowQuestionForm] = useState(false);
  const [editingQ, setEditingQ] = useState(null);
  const [showImportBank, setShowImportBank] = useState(false);
  const [questionForm, setQuestionForm] = useState({
    type: 'multiple_choice', questionText: '', points: 1, modelAnswer: '',
    options: [{ id: 'a', text: '', is_correct: false }, { id: 'b', text: '', is_correct: false }],
  });

  // Assignment builder state
  const [assignForm, setAssignForm] = useState({
    title: '', instructions: '', maxScore: 100, passingScore: 50,
    dueDate: '', allowTextSubmission: true, allowFileSubmission: true,
    maxFileSizeMb: 50, maxFiles: 3, isGroupAssignment: false, isPublished: true,
  });
  const [savedAssignmentId, setSavedAssignmentId] = useState(null);

  // Rubric state
  const [rubric, setRubric] = useState({ name: '', description: '', criteria: [] });

  // Availability conditions state
  const [availabilityEnabled, setAvailabilityEnabled] = useState(false);
  const [availConditions, setAvailConditions] = useState([]);

  // SCORM state
  const [scormUploaded, setScormUploaded] = useState(false);

  // LTI state
  const [ltiToolId, setLtiToolId] = useState('');
  const [showLtiForm, setShowLtiForm] = useState(false);
  const [ltiForm, setLtiForm] = useState({
    title: '', launchUrl: '', consumerKey: '', consumerSecret: '', description: '',
  });

  useEffect(() => {
    if (lesson) {
      setForm({
        title: lesson.title || '',
        type: lesson.type || 'video',
        content: lesson.content || '',
        durationSeconds: lesson.duration_seconds?.toString() || '',
      });
      setVideoSource(lesson.type === 'video' && lesson.video_source === 'youtube' ? 'youtube' : 'upload');
      setVideoUrl(lesson.youtube_id ? `https://youtu.be/${lesson.youtube_id}` : '');
    } else {
      setForm({ title: '', type: 'video', content: '', durationSeconds: '' });
      setVideoSource('upload');
      setVideoUrl('');
    }
    setVideoFile(null);
    setResourceFile(null);
    setScormUploaded(false);
    setLtiToolId('');

    // Load LTI tool ID from lesson content
    if (lesson?.type === 'lti' && lesson?.content) {
      try {
        const parsed = JSON.parse(lesson.content);
        if (parsed.toolId) setLtiToolId(parsed.toolId);
      } catch {}
    }
  }, [lesson, open]);

  // Load quiz data when editing a quiz lesson
  useEffect(() => {
    if (isEditing && lesson?.type === 'quiz' && lesson?.quiz_id) {
      assessmentsApi.getQuiz(lesson.quiz_id).then(r => {
        const q = r.data.data.quiz;
        setSavedQuizId(q.id);
        setQuizForm({
          title: q.title || '',
          description: q.description || '',
          passingScorePct: q.passing_score_pct ?? 70,
          timeLimitMins: q.time_limit_mins?.toString() || '',
          maxAttempts: q.max_attempts ?? 1,
          shuffleQuestions: q.shuffle_questions ?? false,
        });
        setQuestions((q.questions || []).map((qst, i) => ({ ...qst, _key: i })));
      }).catch(() => {});
    } else if (lesson?.type !== 'quiz') {
      setSavedQuizId(null);
      setQuestions([]);
    }
  }, [lesson, open]);

  // Load assignment data when editing an assignment lesson
  useEffect(() => {
    if (isEditing && lesson?.type === 'assignment' && lesson?.assignment_id) {
      submissionsApi.getAssignment(lesson.assignment_id).then(r => {
        const a = r.data.data.assignment;
        setSavedAssignmentId(a.id);
        setAssignForm({
          title: a.title || '',
          instructions: a.instructions || '',
          maxScore: a.max_score ?? 100,
          passingScore: a.passing_score ?? 50,
          dueDate: a.due_date ? a.due_date.slice(0, 10) : '',
          allowTextSubmission: a.allow_text_submission ?? true,
          allowFileSubmission: a.allow_file_submission ?? true,
          maxFileSizeMb: a.max_file_size_mb ?? 50,
          maxFiles: a.max_files ?? 3,
          isGroupAssignment: a.is_group_assignment ?? false,
        });
      }).catch(() => {});
    } else if (lesson?.type !== 'assignment') {
      setSavedAssignmentId(null);
    }
  }, [lesson, open]);

  // Load rubric data when editing an assignment
  useEffect(() => {
    if (isEditing && lesson?.type === 'assignment' && lesson?.assignment_id) {
      submissionsApi.getRubric(lesson.assignment_id).then(res => {
        const r = res?.data?.data?.rubric;
        if (r) {
          setRubric({
            name: r.name || '',
            description: r.description || '',
            criteria: (r.criteria || []).map(c => ({ id: c.id, description: c.description, max_score: c.max_score })),
          });
        } else {
          setRubric({ name: '', description: '', criteria: [] });
        }
      }).catch(() => {});
    } else if (lesson?.type !== 'assignment') {
      setRubric({ name: '', description: '', criteria: [] });
    }
  }, [lesson, open]);

  // Load availability conditions when editing
  useEffect(() => {
    if (isEditing && lesson?.id) {
      availabilityApi.getAvailability(courseId, lesson.id).then(res => {
        if (res?.availability?.conditions?.length > 0) {
          setAvailabilityEnabled(true);
          setAvailConditions(res.availability.conditions);
        } else {
          setAvailabilityEnabled(false);
          setAvailConditions([]);
        }
      }).catch(() => {});
    } else {
      setAvailabilityEnabled(false);
      setAvailConditions([]);
    }
  }, [lesson, open]);

  const saveMutation = useMutation({
    mutationFn: (data) => isEditing
      ? lessonsApi.update(courseId, lesson.id, data)
      : lessonsApi.create(courseId, { ...data, sectionId }),
    onSuccess: (res) => {
      toast.success(isEditing ? 'Lesson updated' : 'Lesson created');
      const newLesson = res?.data?.data?.lesson || res?.data?.lesson;
      onSaved(newLesson);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  });

  const videoMut = useMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('video', file);
      return lessonsApi.uploadVideo(courseId, lesson?.id, fd);
    },
    onSuccess: () => toast.success('Video uploaded'),
    onError: (err) => toast.error(err.response?.data?.message || 'Upload failed'),
  });

  const resourceMut = useMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('resource', file);
      return lessonsApi.uploadResource(courseId, lesson?.id, fd);
    },
    onSuccess: () => toast.success('Resource uploaded'),
    onError: (err) => toast.error(err.response?.data?.message || 'Upload failed'),
  });

  // SCORM upload mutation
  const scormUploadMut = useMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('package', file);
      return api.post(`/scorm/courses/${courseId}/lessons/${lesson?.id}/package`, fd);
    },
    onSuccess: () => {
      toast.success('SCORM package uploaded');
      setScormUploaded(true);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'SCORM upload failed'),
  });

  // LTI register mutation
  const registerLtiMut = useMutation({
    mutationFn: (data) => api.post(`/lti/courses/${courseId}/tools`, data),
    onSuccess: (res) => {
      toast.success('LTI tool registered');
      setShowLtiForm(false);
      setLtiForm({ title: '', launchUrl: '', consumerKey: '', consumerSecret: '', description: '' });
      // Select the newly created tool
      const tool = res.data.data?.tool;
      if (tool) {
        setLtiToolId(tool.id);
        setForm(p => ({ ...p, content: JSON.stringify({ toolId: tool.id }) }));
      }
      // Refresh tools list
      queryClient.invalidateQueries({ queryKey: ['lti-tools', courseId] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to register tool'),
  });

  // LTI tools query
  const { data: ltiTools } = useQuery({
    queryKey: ['lti-tools', courseId],
    queryFn: () => api.get(`/lti/courses/${courseId}/tools`).then(r => r.data.data.tools || []),
    enabled: form.type === 'lti' && !!courseId,
  });

  // Create/update quiz when lesson is saved
  const saveQuizMut = useMutation({
    mutationFn: (data) => savedQuizId
      ? assessmentsApi.updateQuiz(savedQuizId, data)
      : assessmentsApi.createQuiz(data),
    onSuccess: (res) => {
      const q = res.data.data.quiz;
      setSavedQuizId(q.id);
      toast.success(savedQuizId ? 'Quiz updated' : 'Quiz created');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save quiz'),
  });

  const saveQuestionMut = useMutation({
    mutationFn: (data) => editingQ
      ? assessmentsApi.updateQuestion(savedQuizId, editingQ.id, data)
      : assessmentsApi.addQuestion(savedQuizId, data),
    onSuccess: (res) => {
      const q = res.data.data.question;
      if (editingQ) {
        setQuestions(prev => prev.map(x => x.id === q.id ? { ...q, _key: x._key } : x));
      } else {
        setQuestions(prev => [...prev, { ...q, _key: Date.now() }]);
      }
      setShowQuestionForm(false);
      setEditingQ(null);
      toast.success(editingQ ? 'Question updated' : 'Question added');
    },
    onError: (err) => {
      const data = err.response?.data;
      const msg = data?.message || 'Failed to save question';
      if (data?.errors?.length) toast.error(`${msg}: ${data.errors.join('; ')}`);
      else toast.error(msg);
    },
  });

  const deleteQuestionMut = useMutation({
    mutationFn: (qId) => assessmentsApi.deleteQuestion(savedQuizId, qId),
    onSuccess: () => {
      setQuestions(prev => prev.filter(x => x.id !== editingQ?.id));
      toast.success('Question deleted');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete question'),
  });

  const importBankMut = useMutation({
    mutationFn: (questionIds) => questionBankApi.importToQuiz(courseId, savedQuizId, { questionIds }),
    onSuccess: (res) => {
      const imported = res.data.data?.imported || 0;
      toast.success(`${imported} question(s) imported`);
      setShowImportBank(false);
      // Reload quiz questions
      assessmentsApi.getQuiz(savedQuizId).then(r => {
        const qs = r.data.data.quiz.questions || [];
        setQuestions(qs.map((qst, i) => ({ ...qst, _key: i })));
      }).catch(() => {});
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to import questions'),
  });

  // Save assignment
  const saveAssignMut = useMutation({
    mutationFn: (data) => savedAssignmentId
      ? submissionsApi.updateAssignment(savedAssignmentId, data)
      : submissionsApi.createAssignment(data),
    onSuccess: (res) => {
      const a = res.data.data.assignment;
      setSavedAssignmentId(a.id);
      toast.success(savedAssignmentId ? 'Assignment updated' : 'Assignment created');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save assignment'),
  });

  // Save availability conditions
  const saveAvailMut = useMutation({
    mutationFn: (conditions) => availabilityApi.setAvailability(courseId, lesson.id, conditions),
    onSuccess: () => toast.success('Access conditions saved'),
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save conditions'),
  });

  // Save rubric
  const saveRubricMut = useMutation({
    mutationFn: (data) => submissionsApi.saveRubric(lesson.assignment_id, data),
    onSuccess: (res) => {
      const r = res?.data?.data?.rubric;
      if (r) {
        setRubric({
          name: r.name || '',
          description: r.description || '',
          criteria: (r.criteria || []).map(c => ({ id: c.id, description: c.description, max_score: c.max_score })),
        });
      }
      toast.success('Rubric saved');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save rubric'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = {
      title: form.title,
      type: form.type,
      content: form.content || undefined,
      durationSeconds: form.durationSeconds ? parseInt(form.durationSeconds, 10) : undefined,
    };
    if (form.type === 'video') {
      data.videoSource = videoSource;
      if (videoSource === 'youtube') data.videoUrl = videoUrl || undefined;
    }
    saveMutation.mutate(data);
  };

  return (
    <Modal open={open} onClose={onClose} title={isEditing ? 'Edit Lesson' : 'Add Lesson'} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 overflow-y-auto max-h-[70vh] pr-1">
        <Input label="Lesson title" value={form.title}
          onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
          required placeholder="e.g. Introduction to HTML" />

        <Select label="Lesson type" value={form.type}
          onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
          {LESSON_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>

        {form.type === 'text' && (
          <div>
            <label className="text-sm font-medium text-gray-300 mb-1.5 block">Content</label>
            <textarea value={form.content}
              onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
              rows={8} className="input resize-none font-mono text-sm" placeholder="Markdown content…" />
          </div>
        )}

        <Input label="Duration (seconds)" type="number" value={form.durationSeconds}
          onChange={e => setForm(p => ({ ...p, durationSeconds: e.target.value }))}
          placeholder="e.g. 600" />

        {form.type === 'video' && (
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-sm font-medium text-gray-300 mb-1.5 block">Video source</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setVideoSource('upload')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    videoSource === 'upload'
                      ? 'bg-[#1A6FBF] text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Upload file
                </button>
                <button
                  type="button"
                  onClick={() => setVideoSource('youtube')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    videoSource === 'youtube'
                      ? 'bg-[#1A6FBF] text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  YouTube link
                </button>
              </div>
            </div>

            {videoSource === 'youtube' ? (
              <div className="flex flex-col gap-2">
                <input
                  type="url"
                  value={videoUrl}
                  onChange={e => setVideoUrl(e.target.value)}
                  placeholder="Paste a YouTube link — watch?v=…, youtu.be/…, shorts/, embed/, live/"
                  className="input"
                />
                {(() => {
                  const yid = youtubeIdFromUrl(videoUrl);
                  if (yid) {
                    return (
                      <div className="aspect-video w-full rounded-lg overflow-hidden border border-white/10">
                        <iframe
                          src={`https://www.youtube-nocookie.com/embed/${yid}`}
                          title="Video preview"
                          className="w-full h-full"
                          allowFullScreen
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        />
                      </div>
                    );
                  }
                  if (videoUrl) {
                    return <p className="text-sm text-amber-400">Enter a valid YouTube link to preview it.</p>;
                  }
                  return <p className="text-xs text-gray-500">No server storage used — the video streams from YouTube. Available only while connected.</p>;
                })()}
              </div>
            ) : (
              <div>
                {isEditing ? (
                  <>
                    <input type="file" accept="video/*" onChange={e => {
                      if (e.target.files[0]) { setVideoFile(e.target.files[0]); videoMut.mutate(e.target.files[0]); }
                    }} className="text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#1A6FBF] file:text-white file:text-sm" />
                    {videoMut.isPending && <Spinner size="sm" />}
                  </>
                ) : (
                  <p className="text-xs text-gray-500">Create the lesson first, then upload the video file from the lesson list.</p>
                )}
              </div>
            )}
          </div>
        )}

        {isEditing && (
          <div>
            <label className="text-sm font-medium text-gray-300 mb-1.5 block">Resource file (PDF etc.)</label>
            <input type="file" onChange={e => {
              if (e.target.files[0]) { setResourceFile(e.target.files[0]); resourceMut.mutate(e.target.files[0]); }
            }} className="text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#1A6FBF] file:text-white file:text-sm" />
            {resourceMut.isPending && <Spinner size="sm" />}
          </div>
        )}

        {/* ── SCORM upload ── */}
        {isEditing && form.type === 'scorm' && (
          <div>
            <label className="text-sm font-medium text-gray-300 mb-1.5 block">
              SCORM Package (.zip)
            </label>
            {scormUploaded ? (
              <div className="flex items-center gap-2 text-green-400 text-sm bg-green-400/5 px-3 py-2 rounded-lg">
                <Package size={14} />
                Package uploaded
              </div>
            ) : (
              <input type="file" accept=".zip" onChange={e => {
                if (e.target.files[0]) { scormUploadMut.mutate(e.target.files[0]); }
              }} className="text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#1A6FBF] file:text-white file:text-sm" />
            )}
            {scormUploadMut.isPending && <Spinner size="sm" />}
          </div>
        )}

        {/* ── LTI tool selection ── */}
        {form.type === 'lti' && (
          <div>
            <label className="text-sm font-medium text-gray-300 mb-1.5 block">LTI Tool</label>
            {ltiTools && ltiTools.length > 0 ? (
              <select value={ltiToolId}
                onChange={e => {
                  const toolId = e.target.value;
                  setLtiToolId(toolId);
                  setForm(p => ({ ...p, content: JSON.stringify({ toolId }) }));
                }}
                className="input">
                <option value="">-- Select an LTI tool --</option>
                {(ltiTools || []).map(t => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-gray-500">No LTI tools registered yet.</p>
            )}
            <button type="button" onClick={() => setShowLtiForm(true)}
              className="mt-2 text-sm text-blue-400 hover:underline">
              + Register new tool
            </button>

            {/* LTI registration form */}
            {showLtiForm && (
              <div className="mt-3 p-3 card space-y-3">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Register New LTI Tool</p>
                <Input label="Tool name" value={ltiForm.title}
                  onChange={e => setLtiForm(p => ({ ...p, title: e.target.value }))}
                  required placeholder="e.g. H5P, Articulate Rise" />
                <Input label="Launch URL" value={ltiForm.launchUrl}
                  onChange={e => setLtiForm(p => ({ ...p, launchUrl: e.target.value }))}
                  required placeholder="https://tool.example.com/lti/launch" />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Consumer Key" value={ltiForm.consumerKey}
                    onChange={e => setLtiForm(p => ({ ...p, consumerKey: e.target.value }))}
                    placeholder="Auto-generated if empty" />
                  <Input label="Consumer Secret" value={ltiForm.consumerSecret}
                    onChange={e => setLtiForm(p => ({ ...p, consumerSecret: e.target.value }))}
                    placeholder="Auto-generated if empty" />
                </div>
                <Input label="Description (optional)" value={ltiForm.description}
                  onChange={e => setLtiForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Brief description of the tool" />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowLtiForm(false)}
                    className="btn-ghost text-xs px-3 py-1.5">
                    Cancel
                  </button>
                  <button type="button"
                    onClick={() => registerLtiMut.mutate(ltiForm)}
                    disabled={!ltiForm.title || !ltiForm.launchUrl || registerLtiMut.isPending}
                    className="btn-primary text-xs px-3 py-1.5">
                    {registerLtiMut.isPending ? 'Registering...' : 'Register'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Conditional Access ── */}
        {isEditing && (
          <div className="border-t border-gray-800 pt-4 mt-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                {availabilityEnabled ? <Lock size={14} className="text-amber-400" /> : <Unlock size={14} className="text-gray-600" />}
                Conditional Access
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (availabilityEnabled) {
                    setAvailabilityEnabled(false);
                    setAvailConditions([]);
                    saveAvailMut.mutate([]);
                  } else {
                    setAvailabilityEnabled(true);
                  }
                }}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  availabilityEnabled
                    ? 'border-amber-500/50 text-amber-400 hover:bg-amber-500/10'
                    : 'border-gray-700 text-gray-500 hover:text-gray-300'
                }`}
              >
                {availabilityEnabled ? 'Disable' : 'Enable'}
              </button>
            </div>

            {availabilityEnabled && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Students must meet ALL conditions to access this lesson.</p>
                {availConditions.map((cond, i) => (
                  <div key={i} className="flex items-start gap-2 bg-white/[0.02] p-3 rounded-lg">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={cond.type}
                          onChange={e => {
                            const updated = [...availConditions];
                            if (e.target.value === 'date_range') {
                              updated[i] = { type: 'date_range', start: '', end: '' };
                            } else if (e.target.value === 'quiz_score') {
                              updated[i] = { type: 'quiz_score', lessonId: '', minScore: 80 };
                            } else {
                              updated[i] = { type: e.target.value, lessonId: '' };
                            }
                            setAvailConditions(updated);
                          }}
                          className="input py-1.5 text-xs w-auto"
                        >
                          <option value="lesson_completed">Prerequisite lesson</option>
                          <option value="quiz_score">Minimum quiz score</option>
                          <option value="date_range">Date range</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => setAvailConditions(prev => prev.filter((_, j) => j !== i))}
                          className="p-1 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      {cond.type === 'lesson_completed' && (
                        <Select value={cond.lessonId} onChange={e => {
                          const updated = [...availConditions];
                          updated[i] = { ...updated[i], lessonId: e.target.value };
                          setAvailConditions(updated);
                        }}>
                          <option value="">Select a lesson…</option>
                          {allCourseLessons.map(l => (
                            <option key={l.id} value={l.id} disabled={l.id === lesson?.id}>
                              {l.title} ({l.type})
                            </option>
                          ))}
                        </Select>
                      )}

                      {cond.type === 'quiz_score' && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <Select value={cond.lessonId} onChange={e => {
                              const updated = [...availConditions];
                              updated[i] = { ...updated[i], lessonId: e.target.value };
                              setAvailConditions(updated);
                            }}>
                              <option value="">Select quiz lesson…</option>
                              {allCourseLessons.filter(l => l.type === 'quiz').map(l => (
                                <option key={l.id} value={l.id} disabled={l.id === lesson?.id}>
                                  {l.title}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={cond.minScore}
                            onChange={e => {
                              const updated = [...availConditions];
                              updated[i] = { ...updated[i], minScore: +e.target.value };
                              setAvailConditions(updated);
                            }}
                            className="input py-1.5 text-xs w-20"
                            placeholder="80%"
                          />
                          <span className="text-xs text-gray-500">%</span>
                        </div>
                      )}

                      {cond.type === 'date_range' && (
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={cond.start || ''}
                            onChange={e => {
                              const updated = [...availConditions];
                              updated[i] = { ...updated[i], start: e.target.value };
                              setAvailConditions(updated);
                            }}
                            className="input py-1.5 text-xs flex-1"
                          />
                          <span className="text-xs text-gray-500">to</span>
                          <input
                            type="date"
                            value={cond.end || ''}
                            onChange={e => {
                              const updated = [...availConditions];
                              updated[i] = { ...updated[i], end: e.target.value };
                              setAvailConditions(updated);
                            }}
                            className="input py-1.5 text-xs flex-1"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setAvailConditions(prev => [...prev, { type: 'lesson_completed', lessonId: '' }])}
                  className="text-xs text-[#3B9EE8] hover:underline"
                >
                  + Add condition
                </button>

                {availConditions.length > 0 && (
                  <div className="flex justify-end pt-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => saveAvailMut.mutate(availConditions)}
                      loading={saveAvailMut.isPending}
                    >
                      Save Conditions
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Quiz Builder ── */}
        {isEditing && form.type === 'quiz' && (
          <div className="border-t border-gray-800 pt-4 mt-2 space-y-4">
            <h3 className="font-semibold text-white text-lg">Quiz Settings</h3>
            <Input label="Quiz title" value={quizForm.title}
              onChange={e => setQuizForm(p => ({ ...p, title: e.target.value }))} />
            <div>
              <label className="text-sm font-medium text-gray-300 mb-1.5 block">Description</label>
              <textarea value={quizForm.description}
                onChange={e => setQuizForm(p => ({ ...p, description: e.target.value }))}
                rows={2} className="input resize-none" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label="Passing score (%)" type="number" value={quizForm.passingScorePct}
                onChange={e => setQuizForm(p => ({ ...p, passingScorePct: +e.target.value }))} />
              <Input label="Time limit (min)" type="number" value={quizForm.timeLimitMins}
                onChange={e => setQuizForm(p => ({ ...p, timeLimitMins: e.target.value }))} />
              <Input label="Max attempts" type="number" value={quizForm.maxAttempts}
                onChange={e => setQuizForm(p => ({ ...p, maxAttempts: +e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={quizForm.shuffleQuestions}
                onChange={e => setQuizForm(p => ({ ...p, shuffleQuestions: e.target.checked }))} />
              Shuffle questions
            </label>
            <div className="flex justify-end">
              <Button type="button" onClick={() => {
                saveQuizMut.mutate({ lessonId: lesson.id, courseId, ...quizForm, timeLimitMins: quizForm.timeLimitMins ? parseInt(quizForm.timeLimitMins) : null });
              }} loading={saveQuizMut.isPending}><Save size={14} /> Save Quiz</Button>
            </div>

            {/* Questions */}
            <div className="border-t border-gray-800 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-white">Questions ({questions.length})</h4>
                <div className="flex gap-2">
                  {savedQuizId && (
                    <Button type="button" variant="secondary" size="sm" onClick={() => onAnalytics?.(savedQuizId)}>
                      <BarChart3 size={14} /> Analytics
                    </Button>
                  )}
                  {savedQuizId && (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setShowImportBank(true)}>
                      <Database size={14} /> Import from Bank
                    </Button>
                  )}
                  <Button type="button" variant="secondary" size="sm" onClick={() => {
                  setEditingQ(null);
                  setQuestionForm({ type: 'multiple_choice', questionText: '', points: 1, modelAnswer: '', options: [
                    { id: 'a', text: '', is_correct: false }, { id: 'b', text: '', is_correct: false },
                  ]});
                  setShowQuestionForm(true);
                }}><Plus size={14} /> Add Question</Button>
              </div>
            </div>
            {questions.map((q, i) => (
                <div key={q._key ?? q.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/[0.02] group">
                  <div className="text-sm text-gray-300">
                    <span className="text-gray-600 mr-2">{i + 1}.</span>
                    <span>{q.question_text}</span>
                    <span className="text-xs text-gray-600 ml-2">({q.type} · {q.points}pt)</span>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                    <button type="button" className="btn-ghost p-1 rounded text-xs" onClick={() => {
                      setEditingQ(q);
                      setQuestionForm({
                        type: q.type, questionText: q.question_text, points: q.points,
                        modelAnswer: q.model_answer || '',
                        options: (q.options || []).map(o => ({ ...o })),
                      });
                      setShowQuestionForm(true);
                    }}>Edit</button>
                    <button type="button" className="btn-ghost p-1 rounded text-xs text-red-400" onClick={() => {
                      setEditingQ(q);
                      deleteQuestionMut.mutate(q.id);
                    }}>Del</button>
                  </div>
                </div>
              ))}
              {questions.length === 0 && <p className="text-gray-600 text-sm">No questions yet</p>}
            </div>
          </div>
        )}

        {/* ── Assignment Builder ── */}
        {isEditing && form.type === 'assignment' && (
          <div className="border-t border-gray-800 pt-4 mt-2 space-y-4">
            <h3 className="font-semibold text-white text-lg">Assignment Settings</h3>
            <Input label="Assignment title" value={assignForm.title}
              onChange={e => setAssignForm(p => ({ ...p, title: e.target.value }))} />
            <div>
              <label className="text-sm font-medium text-gray-300 mb-1.5 block">Instructions</label>
              <textarea value={assignForm.instructions}
                onChange={e => setAssignForm(p => ({ ...p, instructions: e.target.value }))}
                rows={4} className="input resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Max score" type="number" value={assignForm.maxScore}
                onChange={e => setAssignForm(p => ({ ...p, maxScore: +e.target.value }))} />
              <Input label="Passing score" type="number" value={assignForm.passingScore}
                onChange={e => setAssignForm(p => ({ ...p, passingScore: +e.target.value }))} />
            </div>
            <Input label="Due date" type="date" value={assignForm.dueDate}
              onChange={e => setAssignForm(p => ({ ...p, dueDate: e.target.value }))} />
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={assignForm.allowTextSubmission}
                  onChange={e => setAssignForm(p => ({ ...p, allowTextSubmission: e.target.checked }))} />
                Text submission
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={assignForm.allowFileSubmission}
                  onChange={e => setAssignForm(p => ({ ...p, allowFileSubmission: e.target.checked }))} />
                File submission
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={assignForm.isGroupAssignment}
                  onChange={e => setAssignForm(p => ({ ...p, isGroupAssignment: e.target.checked }))} />
                Group submission
              </label>
            </div>
            {assignForm.isGroupAssignment && (
              <p className="text-xs text-amber-400">
                Students must be in a group to submit. Manage groups in the Groups tab.
              </p>
            )}
            <div className="border-t border-gray-800 pt-4 mt-2 space-y-4">
              <h4 className="font-semibold text-white text-lg">Rubric <span className="text-gray-500 text-sm font-normal">(optional)</span></h4>
              <Input label="Rubric name (optional)" placeholder="e.g. Essay Grading Rubric"
                value={rubric.name}
                onChange={e => setRubric(p => ({ ...p, name: e.target.value }))} />
              <div>
                <label className="text-sm font-medium text-gray-300 mb-1.5 block">Rubric description (optional)</label>
                <textarea value={rubric.description}
                  onChange={e => setRubric(p => ({ ...p, description: e.target.value }))}
                  rows={2} className="input resize-none" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-300">Criteria</span>
                  <button type="button" className="btn-ghost text-sm text-blue-400 hover:text-blue-300"
                    onClick={() => setRubric(p => ({
                      ...p,
                      criteria: [...p.criteria, { description: '', max_score: '', _key: Date.now() }],
                    }))}>
                    + Add criterion
                  </button>
                </div>
                {rubric.criteria.map((c, i) => (
                  <div key={c._key || c.id || i} className="flex gap-2 items-start">
                    <div className="flex-1">
                      <input type="text" placeholder="Criterion description"
                        className="input text-sm"
                        value={c.description}
                        onChange={e => {
                          const next = [...rubric.criteria];
                          next[i] = { ...next[i], description: e.target.value };
                          setRubric(p => ({ ...p, criteria: next }));
                        }} />
                    </div>
                    <div className="w-24 shrink-0">
                      <input type="number" placeholder="Max"
                        className="input text-sm"
                        value={c.max_score}
                        onChange={e => {
                          const next = [...rubric.criteria];
                          next[i] = { ...next[i], max_score: +e.target.value };
                          setRubric(p => ({ ...p, criteria: next }));
                        }} />
                    </div>
                    <button type="button" className="btn-ghost p-1.5 rounded text-red-400 hover:text-red-300 mt-1"
                      onClick={() => setRubric(p => ({
                        ...p,
                        criteria: p.criteria.filter((_, j) => j !== i),
                      }))}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {rubric.criteria.length > 0 && (
                  <div className="text-right text-sm text-gray-400">
                    Total: {rubric.criteria.reduce((s, c) => s + (Number(c.max_score) || 0), 0)} pts
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={() => {
                  saveRubricMut.mutate({
                    name: rubric.name,
                    description: rubric.description,
                    criteria: rubric.criteria.map(c => ({ description: c.description, max_score: c.max_score })),
                  });
                }} loading={saveRubricMut.isPending}><Save size={14} /> Save Rubric</Button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={() => {
                saveAssignMut.mutate({ lessonId: lesson.id, courseId, ...assignForm, dueDate: assignForm.dueDate || null });
              }} loading={saveAssignMut.isPending}><Save size={14} /> Save Assignment</Button>
            </div>
          </div>
        )}

        {/* ── Question Form Modal ── */}
        <Modal open={showQuestionForm} onClose={() => { setShowQuestionForm(false); setEditingQ(null); }}
          title={editingQ ? 'Edit Question' : 'Add Question'} size="md">
          <div className="flex flex-col gap-4 overflow-y-auto max-h-[60vh] pr-1">
            <Select label="Type" value={questionForm.type}
              onChange={e => setQuestionForm(p => ({ ...p, type: e.target.value }))}>
              <option value="multiple_choice">Multiple Choice</option>
              <option value="multi_select">Multi Select</option>
              <option value="true_false">True / False</option>
              <option value="short_answer">Short Answer</option>
            </Select>
            <div>
              <label className="text-sm font-medium text-gray-300 mb-1.5 block">Question</label>
              <textarea value={questionForm.questionText}
                onChange={e => setQuestionForm(p => ({ ...p, questionText: e.target.value }))}
                rows={2} className="input resize-none" />
            </div>
            <Input label="Points" type="number" value={questionForm.points}
              onChange={e => setQuestionForm(p => ({ ...p, points: +e.target.value }))} />
            {questionForm.type !== 'short_answer' && (
              <div>
                <label className="text-sm font-medium text-gray-300 mb-1.5 block">Options</label>
                {questionForm.options.map((opt, i) => (
                  <div key={opt.id} className="flex items-center gap-2 mb-2">
                    <input type={questionForm.type === 'multiple_choice' ? 'radio' : 'checkbox'}
                      name="correctOpt" checked={opt.is_correct}
                      onChange={() => {
                        const newOpts = questionForm.options.map(o => ({
                          ...o, is_correct: questionForm.type === 'multiple_choice' ? o.id === opt.id : questionForm.type === 'multi_select' ? (o.id === opt.id ? !o.is_correct : o.is_correct) : o.is_correct,
                        }));
                        setQuestionForm(p => ({ ...p, options: newOpts }));
                      }} className="mr-1" />
                    <input className="input flex-1 text-sm" value={opt.text}
                      onChange={e => {
                        const newOpts = questionForm.options.map(o => o.id === opt.id ? { ...o, text: e.target.value } : o);
                        setQuestionForm(p => ({ ...p, options: newOpts }));
                      }} placeholder={`Option ${i + 1}`} />
                    {questionForm.options.length > 2 && (
                      <button type="button" className="text-red-400 text-xs"
                        onClick={() => setQuestionForm(p => ({ ...p, options: p.options.filter(o => o.id !== opt.id) }))}>
                        X
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className="text-xs text-[#3B9EE8] mt-1"
                  onClick={() => {
                    const newId = String.fromCharCode(97 + questionForm.options.length);
                    setQuestionForm(p => ({ ...p, options: [...p.options, { id: newId, text: '', is_correct: false }] }));
                  }}>
                  + Add option
                </button>
              </div>
            )}
            {questionForm.type === 'short_answer' && (
              <div>
                <label className="text-sm font-medium text-gray-300 mb-1.5 block">Model answer (optional)</label>
                <textarea value={questionForm.modelAnswer}
                  onChange={e => setQuestionForm(p => ({ ...p, modelAnswer: e.target.value }))}
                  rows={2} className="input resize-none" />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
              <Button variant="secondary" type="button" onClick={() => { setShowQuestionForm(false); setEditingQ(null); }}>Cancel</Button>
              <Button type="button" onClick={() => {
                if (!savedQuizId) { toast.error('Save the quiz first'); return; }
                saveQuestionMut.mutate(questionForm);
              }} loading={saveQuestionMut.isPending}>{editingQ ? 'Update' : 'Add'}</Button>
            </div>
          </div>
        </Modal>

        {/* ── Import from Question Bank Modal ── */}
        <ImportBankModal
          open={showImportBank}
          onClose={() => setShowImportBank(false)}
          courseId={courseId}
          onImport={(questionIds) => importBankMut.mutate(questionIds)}
          loading={importBankMut.isPending}
        />

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saveMutation.isPending}>
            {isEditing ? 'Update' : 'Create'} Lesson
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ImportBankModal({ open, onClose, courseId, onImport, loading }) {
  const [selectedIds, setSelectedIds] = useState([]);

  const { data: catsData } = useQuery({
    queryKey: ['question-bank-categories', courseId],
    queryFn: () => questionBankApi.listCategories(courseId).then(r => r.data.data?.categories || []),
    enabled: open,
  });
  const categories = catsData || [];

  const { data: qsData, isLoading } = useQuery({
    queryKey: ['question-bank-questions', courseId],
    queryFn: () => questionBankApi.listQuestions(courseId).then(r => r.data.data?.questions || []),
    enabled: open,
  });
  const questions = qsData || [];

  const getCatName = (id) => categories.find(c => c.id === id)?.name || id;

  const toggleId = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleImport = () => {
    if (selectedIds.length === 0) {
      toast.error('Select at least one question');
      return;
    }
    onImport(selectedIds);
  };

  return (
    <Modal open={open} onClose={onClose} title="Import from Question Bank" size="lg">
      <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto pr-1">
        {isLoading ? (
          <Spinner />
        ) : questions.length === 0 ? (
          <div className="text-center py-8">
            <Database size={40} className="mx-auto text-gray-700 mb-3" />
            <p className="text-gray-500 text-sm">No questions in the bank for this course</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-400">{questions.length} question(s) available</p>
              <p className="text-sm text-gray-400">{selectedIds.length} selected</p>
            </div>
            {categories.map(cat => {
              const catQs = questions.filter(q => q.category_id === cat.id);
              if (catQs.length === 0) return null;
              return (
                <div key={cat.id}>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{cat.name}</h4>
                  <div className="space-y-1">
                    {catQs.map(q => (
                      <label key={q.id}
                        className={clsx(
                          'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                          selectedIds.includes(q.id)
                            ? 'border-[#1A6FBF]/50 bg-[#1A6FBF]/10'
                            : 'border-gray-800 hover:border-gray-700'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(q.id)}
                          onChange={() => toggleId(q.id)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white">{q.question_text}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-[#1A6FBF]/20 text-[#3B9EE8]">
                              {q.type.replace('_', ' ')}
                            </span>
                            <span className="text-xs text-gray-600">{q.points} pts</span>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-3 border-t border-gray-800 mt-4">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="button" onClick={handleImport} loading={loading} disabled={selectedIds.length === 0}>
          <Database size={14} /> Import Selected ({selectedIds.length})
        </Button>
      </div>
    </Modal>
  );
}
