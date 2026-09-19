import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Bell, Check } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import api    from '../../shared/api/client';
import Spinner from '../../shared/components/ui/spinner';
import { clsx } from 'clsx';
import { offlineMutation } from '../../shared/offline/mutations';

const TYPE_COLORS = {
  enrollment:        'bg-blue-500/20 text-blue-400',
  forum_reply:       'bg-purple-500/20 text-purple-400',
  forum_mention:     'bg-purple-500/20 text-purple-400',
  direct_message:    'bg-teal-500/20 text-teal-400',
  assignment_graded: 'bg-green-500/20 text-green-400',
  quiz_graded:       'bg-green-500/20 text-green-400',
  certificate_issued:'bg-amber-500/20 text-amber-400',
  course_announcement:'bg-blue-500/20 text-blue-400',
  system:            'bg-gray-500/20 text-gray-400',
};

export default function NotificationDrawer({ open, onClose }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn:  () => api.get('/notifications?limit=30').then(r => r.data),
    enabled:  open,
  });

  const markAllRead = useMutation(offlineMutation('notification-read-all', {
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  }));

  const markOne = useMutation(offlineMutation('notification-read-one', {
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  }));

  const notifications = data?.data || [];
  const unreadCount   = notifications.filter(n => !n.is_read).length;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-16 right-4 z-50 w-96 max-h-[80vh]
                      card flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-[#3B9EE8]" />
            <h3 className="font-semibold text-white text-sm">Notifications</h3>
            {unreadCount > 0 && (
              <span className="badge-blue badge">{unreadCount} new</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="text-xs text-[#3B9EE8] hover:underline flex items-center gap-1"
              >
                <Check size={12} /> Mark all read
              </button>
            )}
            <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-10">
              <Bell size={32} className="text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No notifications yet</p>
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                onClick={() => !n.is_read && markOne.mutate(n.id)}
                className={clsx(
                  'flex gap-3 p-4 border-b border-gray-800/50 cursor-pointer',
                  'hover:bg-white/3 transition-colors',
                  !n.is_read && 'bg-[#1A6FBF]/5'
                )}
              >
                {/* Type dot */}
                <div className={clsx(
                  'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm',
                  TYPE_COLORS[n.type] || TYPE_COLORS.system
                )}>
                  {n.type === 'enrollment'         ? '📚'
                 : n.type === 'forum_reply'         ? '💬'
                 : n.type === 'forum_mention'       ? '@'
                 : n.type === 'direct_message'      ? '✉️'
                 : n.type === 'assignment_graded'   ? '✅'
                 : n.type === 'quiz_graded'         ? '📝'
                 : n.type === 'certificate_issued'  ? '🏆'
                 : '🔔'}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={clsx(
                    'text-sm leading-tight mb-0.5',
                    n.is_read ? 'text-gray-400' : 'text-white font-medium'
                  )}>
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="text-xs text-gray-500 line-clamp-2">{n.body}</p>
                  )}
                  <p className="text-xs text-gray-600 mt-1">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </p>
                </div>

                {!n.is_read && (
                  <div className="w-2 h-2 rounded-full bg-[#3B9EE8] flex-shrink-0 mt-1.5" />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}