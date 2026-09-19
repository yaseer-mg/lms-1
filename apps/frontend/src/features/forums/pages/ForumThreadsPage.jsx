import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../../shared/stores/authStore';
import {
  MessageSquare, Plus, Search, Pin, Lock, CheckCircle,
  ArrowUp, Eye, Clock, ThumbsUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { forumsApi } from '../../../shared/api/forums.api';
import Button from '../../../shared/components/ui/Button';
import Input from '../../../shared/components/ui/input';
import { offlineMutation } from '../../../shared/offline/mutations';
import Modal from '../../../shared/components/ui/modal';
import Spinner from '../../../shared/components/ui/spinner';

export default function ForumThreadsPage() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore(s => s.user);
  const canModerate = user?.role === 'instructor' || user?.role === 'admin' || user?.role === 'super_admin';

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('latest');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [threadForm, setThreadForm] = useState({ title: '', content: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['forum-threads', courseId, sort, page, search],
    queryFn: () => forumsApi.listThreads(courseId, { sort, page, limit: 20, search }).then(r => r.data.data),
  });

  const createMut = useMutation(offlineMutation('forum-create-thread', {
    onSuccess: (res) => {
      toast.success('Thread created');
      setShowCreate(false);
      setThreadForm({ title: '', content: '' });
      queryClient.invalidateQueries({ queryKey: ['forum-threads', courseId] });
      navigate(`/learn/${courseId}/forums/${res.data.data.thread.id}`);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create thread'),
  }));

  const pinMut = useMutation({
    mutationFn: (threadId) => forumsApi.pinThread(courseId, threadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-threads', courseId] });
    },
  });

  const lockMut = useMutation({
    mutationFn: (threadId) => forumsApi.lockThread(courseId, threadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-threads', courseId] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (threadId) => forumsApi.deleteThread(courseId, threadId),
    onSuccess: () => {
      toast.success('Thread deleted');
      queryClient.invalidateQueries({ queryKey: ['forum-threads', courseId] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  });

  const threads = data?.threads || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / 20);

  const handleCreate = (e) => {
    e.preventDefault();
    createMut.mutate({ ...threadForm, courseId });
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h1 className="font-display font-bold text-2xl text-white flex items-center gap-3">
          <MessageSquare size={24} className="text-[#3B9EE8]" />
          Discussions
        </h1>
        <Button onClick={() => setShowCreate(true)}><Plus size={16} /> New Thread</Button>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search discussions…"
            className="input pl-9"
          />
        </div>
        <div className="flex gap-1 bg-gray-900 rounded-lg p-1 flex-wrap">
          {[
            { key: 'latest', label: 'Latest', icon: Clock },
            { key: 'popular', label: 'Popular', icon: ThumbsUp },
            { key: 'unanswered', label: 'Unanswered', icon: CheckCircle },
          ].map(s => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                onClick={() => { setSort(s.key); setPage(1); }}
                className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5 transition-colors ${
                  sort === s.key ? 'bg-[#3B9EE8] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                <Icon size={14} />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : threads.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <MessageSquare size={40} className="mx-auto mb-3 text-gray-700" />
          <p>No discussions yet. Start the conversation!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map(thread => (
            <div
              key={thread.id}
              className="card p-4 hover:border-gray-700 transition-colors cursor-pointer"
              onClick={() => navigate(`/learn/${courseId}/forums/${thread.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {thread.is_pinned && (
                      <span className="flex items-center gap-1 text-xs text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                        <Pin size={12} /> Pinned
                      </span>
                    )}
                    {thread.is_locked && (
                      <span className="flex items-center gap-1 text-xs text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full">
                        <Lock size={12} /> Locked
                      </span>
                    )}
                    {thread.is_answered && (
                      <span className="flex items-center gap-1 text-xs text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">
                        <CheckCircle size={12} /> Answered
                      </span>
                    )}
                  </div>
                  <h3 className="font-medium text-white text-base truncate">{thread.title}</h3>
                  <p className="text-sm text-gray-500 mt-1 line-clamp-1">{thread.content}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-600 flex-wrap">
                    <span>by {thread.author?.first_name || 'Unknown'}</span>
                    <span className="flex items-center gap-1"><MessageSquare size={12} /> {thread.reply_count}</span>
                    <span className="flex items-center gap-1"><Eye size={12} /> {thread.view_count}</span>
                    <span>{new Date(thread.last_post_at || thread.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                {canModerate && (
                  <div className="flex items-center gap-1 ml-4" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => pinMut.mutate(thread.id)}
                      className={`btn-ghost p-1.5 rounded-lg ${thread.is_pinned ? 'text-yellow-500' : 'text-gray-600 hover:text-yellow-500'}`}
                      title={thread.is_pinned ? 'Unpin' : 'Pin'}
                    >
                      <Pin size={14} />
                    </button>
                    <button
                      onClick={() => lockMut.mutate(thread.id)}
                      className={`btn-ghost p-1.5 rounded-lg ${thread.is_locked ? 'text-red-500' : 'text-gray-600 hover:text-red-500'}`}
                      title={thread.is_locked ? 'Unlock' : 'Lock'}
                    >
                      <Lock size={14} />
                    </button>
                    <button
                      onClick={() => { if (confirm('Delete this thread?')) deleteMut.mutate(thread.id); }}
                      className="btn-ghost p-1.5 rounded-lg text-gray-600 hover:text-red-400"
                      title="Delete"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                p === page ? 'bg-[#3B9EE8] text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Thread" size="lg">
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <Input label="Title" value={threadForm.title}
            onChange={e => setThreadForm(p => ({ ...p, title: e.target.value }))}
            required placeholder="What's your question?" />
          <div>
            <label className="text-sm font-medium text-gray-300 mb-1.5 block">Content</label>
            <textarea value={threadForm.content}
              onChange={e => setThreadForm(p => ({ ...p, content: e.target.value }))}
              rows={6} className="input resize-none" required placeholder="Describe your question or discussion topic…" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={createMut.isPending}>Create Thread</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
