import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Trash2, Clock, Settings, BellOff, Mail } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../../../shared/api/client';
import { notificationsApi } from '../../../shared/api/notifications.api';
import Spinner from '../../../shared/components/ui/spinner';
import Button from '../../../shared/components/ui/Button';
import { clsx } from 'clsx';
import { offlineMutation } from '../../../shared/offline/mutations';

const TYPE_ICONS = {
  enrollment: '🎓',
  quiz_graded: '📝',
  assignment_graded: '✅',
  certificate_issued: '🎉',
  forum_reply: '💬',
  forum_mention: '💬',
  forum_thread_created: '💬',
  direct_message: '✉️',
  system: '🔔',
  lesson_available: '📚',
  announcement: '📢',
  course_announcement: '📢',
  payment_receipt: '🧾',
};

const ALL_TYPES = [
  { type: 'enrollment', label: 'Enrollment' },
  { type: 'lesson_available', label: 'Lesson available' },
  { type: 'assignment_graded', label: 'Assignment graded' },
  { type: 'quiz_graded', label: 'Quiz graded' },
  { type: 'announcement', label: 'Announcements' },
  { type: 'course_announcement', label: 'Course announcements' },
  { type: 'certificate_issued', label: 'Certificate issued' },
  { type: 'forum_reply', label: 'Forum replies' },
  { type: 'forum_mention', label: 'Forum mentions' },
  { type: 'forum_thread_created', label: 'New forum threads' },
  { type: 'direct_message', label: 'Direct messages' },
  { type: 'payment_receipt', label: 'Payment receipts' },
  { type: 'system', label: 'System notifications' },
];

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', unreadOnly],
    queryFn: () => api.get('/notifications', { params: { unreadOnly, limit: 50 } }).then(r => r.data),
  });

  const notifications = data?.data || [];

  const markReadMutation = useMutation(offlineMutation('notification-read', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  }));

  const deleteMutation = useMutation(offlineMutation('notification-delete', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete'),
  }));

  const { data: prefsData } = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => notificationsApi.getPreferences().then(r => r.data.data.preferences),
    enabled: showSettings,
  });

  const updatePrefMut = useMutation(offlineMutation('notification-prefs', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', 'preferences'] });
      toast.success('Preference updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update'),
  }));

  const userPrefs = prefsData || [];
  const getPref = (type) => {
    const p = userPrefs.find(x => x.type === type);
    return { inApp: p?.in_app ?? true, email: p?.email ?? true };
  };

  return (
    <div className="max-w-3xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-white">Notifications</h1>
          <p className="text-gray-400 text-sm mt-1">Stay updated with your learning activity</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setUnreadOnly(!unreadOnly)}
            className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              unreadOnly ? 'bg-[#1A6FBF] text-white' : 'bg-[#112236] text-gray-400 hover:text-white'
            )}
          >
            Unread only
          </button>
          {notifications.some(n => !n.is_read) && (
            <Button variant="ghost" className="text-xs"
              onClick={() => markReadMutation.mutate([])}>
              <CheckCheck size={14} /> Mark all read
            </Button>
          )}
          <Button variant="ghost" className="text-xs"
            onClick={() => setShowSettings(v => !v)}>
            <Settings size={14} /> {showSettings ? 'Done' : 'Settings'}
          </Button>
        </div>
      </div>

      {showSettings && (
        <div className="card mb-6 p-4 space-y-3">
          <h3 className="font-semibold text-white text-sm">Notification Settings</h3>
          <p className="text-xs text-gray-500">Choose how you receive each type of notification.</p>
          <div className="divide-y divide-gray-800">
            {ALL_TYPES.map(({ type, label }) => {
              const pref = getPref(type);
              return (
                <div key={type} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-sm text-gray-300">{TYPE_ICONS[type] || '🔔'} {label}</span>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                      <input type="checkbox" checked={pref.inApp}
                        onChange={() => updatePrefMut.mutate({ type, data: { inApp: !pref.inApp, email: pref.email } })}
                        className="accent-[#1A6FBF]" />
                      <BellOff size={12} /> In-app
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                      <input type="checkbox" checked={pref.email}
                        onChange={() => updatePrefMut.mutate({ type, data: { inApp: pref.inApp, email: !pref.email } })}
                        className="accent-[#1A6FBF]" />
                      <Mail size={12} /> Email
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-16">
            <Bell size={36} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">No notifications yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {notifications.map(n => (
              <div key={n.id}
                className={clsx('flex flex-wrap items-start gap-3 px-4 sm:px-5 py-4 transition-colors',
                  !n.is_read && 'bg-[#1A6FBF]/5'
                )}
              >
                <span className="text-lg flex-shrink-0 mt-0.5">
                  {TYPE_ICONS[n.type] || '🔔'}
                </span>
                <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap justify-end">
                    <p className={clsx('text-sm', !n.is_read ? 'text-white font-semibold' : 'text-gray-300')}>
                      {n.title}
                    </p>
                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-[#3B9EE8]" />}
                  </div>
                  {n.body && <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>}
                  <p className="text-xs text-gray-600 mt-1 flex items-center gap-1">
                    <Clock size={10} />
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!n.is_read && (
                    <button
                      onClick={() => markReadMutation.mutate([n.id])}
                      className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
                      title="Mark read"
                    >
                      <CheckCheck size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm('Delete this notification?')) deleteMutation.mutate(n.id);
                    }}
                    className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
