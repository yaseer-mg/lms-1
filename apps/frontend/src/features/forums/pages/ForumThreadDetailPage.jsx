import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../../shared/stores/authStore';
import {
  MessageSquare, ArrowLeft, Pin, Lock, CheckCircle,
  ThumbsUp, Reply, Trash2, Edit3, Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { forumsApi } from '../../../shared/api/forums.api';
import { offlineMutation } from '../../../shared/offline/mutations';
import Button from '../../../shared/components/ui/Button';
import Spinner from '../../../shared/components/ui/spinner';

const EMOJIS = ['👍', '❤️', '😂', '🎉', '🚀', '👀'];

export default function ForumThreadDetailPage() {
  const { courseId, threadId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore(s => s.user);
  const canModerate = user?.role === 'instructor' || user?.role === 'admin' || user?.role === 'super_admin';

  const [replyContent, setReplyContent] = useState('');
  const [editingPostId, setEditingPostId] = useState(null);
  const [editContent, setEditContent] = useState('');

  const { data: thread, isLoading: threadLoading } = useQuery({
    queryKey: ['forum-thread', courseId, threadId],
    queryFn: () => forumsApi.getThread(courseId, threadId).then(r => r.data.data.thread),
  });

  const { data: postsData, isLoading: postsLoading } = useQuery({
    queryKey: ['forum-posts', courseId, threadId],
    queryFn: () => forumsApi.listPosts(courseId, threadId, { page: 1, limit: 100 }).then(r => r.data.data),
  });

  const replyMut = useMutation(offlineMutation('forum-reply', {
    onSuccess: () => {
      setReplyContent('');
      queryClient.invalidateQueries({ queryKey: ['forum-posts', courseId, threadId] });
      queryClient.invalidateQueries({ queryKey: ['forum-threads', courseId] });
      toast.success('Reply posted');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to reply'),
  }));

  const updatePostMut = useMutation(offlineMutation('forum-update-post', {
    onSuccess: () => {
      setEditingPostId(null);
      setEditContent('');
      queryClient.invalidateQueries({ queryKey: ['forum-posts', courseId, threadId] });
      toast.success('Post updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update'),
  }));

  const deletePostMut = useMutation(offlineMutation('forum-delete-post', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-posts', courseId, threadId] });
      queryClient.invalidateQueries({ queryKey: ['forum-threads', courseId] });
      toast.success('Post deleted');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete'),
  }));

  const answerMut = useMutation(offlineMutation('forum-mark-answer', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-posts', courseId, threadId] });
      queryClient.invalidateQueries({ queryKey: ['forum-thread', courseId, threadId] });
      queryClient.invalidateQueries({ queryKey: ['forum-threads', courseId] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  }));

  const reactMut = useMutation(offlineMutation('forum-react', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-posts', courseId, threadId] });
    },
  }));

  const handleReply = (e) => {
    e.preventDefault();
    if (!replyContent.trim()) return;
    replyMut.mutate({ courseId, threadId, content: replyContent });
  };

  const handleEdit = (postId) => {
    if (!editContent.trim()) return;
    updatePostMut.mutate({ courseId, threadId, postId, data: { content: editContent } });
  };

  if (threadLoading) {
    return <div className="flex justify-center py-20"><Spinner /></div>;
  }

  if (!thread) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p className="text-lg">Thread not found</p>
        <Button variant="ghost" onClick={() => navigate(`/learn/${courseId}/forums`)} className="mt-4">
          Back to discussions
        </Button>
      </div>
    );
  }

  const posts = postsData?.posts || [];
  const isLocked = thread.is_locked;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <button
        onClick={() => navigate(`/learn/${courseId}/forums`)}
        className="btn-ghost text-sm flex items-center gap-1.5 text-gray-400 hover:text-white mb-4"
      >
        <ArrowLeft size={16} />
        Back to discussions
      </button>

      <div className="card p-6 mb-6">
        <div className="flex items-center gap-2 mb-2">
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
        <h1 className="font-display font-bold text-2xl text-white mb-3">{thread.title}</h1>
        <div className="text-gray-300 leading-relaxed whitespace-pre-wrap mb-4">{thread.content}</div>
        <div className="flex items-center gap-4 text-xs text-gray-600">
          <span>by {thread.author?.first_name} {thread.author?.last_name}</span>
          <span className="flex items-center gap-1"><MessageSquare size={12} /> {thread.reply_count} replies</span>
          <span className="flex items-center gap-1"><Eye size={12} /> {thread.view_count} views</span>
          <span>{new Date(thread.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      {postsLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="space-y-4 mb-6">
          {posts.map(post => {
            const isOwnPost = post.author_id === user?.id;
            const reactions = post.reactions || {};
            const userReaction = post.user_reaction;

            return (
              <div
                key={post.id}
                className={`card p-5 ${post.is_answer ? 'border-green-500/30 bg-green-500/5' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white text-sm">
                          {post.author?.first_name} {post.author?.last_name}
                        </span>
                        <span className="text-xs text-gray-600">{new Date(post.created_at).toLocaleDateString()}</span>
                        {post.is_edited && <span className="text-xs text-gray-600">(edited)</span>}
                        {post.is_answer && (
                          <span className="flex items-center gap-1 text-xs text-green-500">
                            <CheckCircle size={12} /> Accepted Answer
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {canModerate && !post.is_answer && (
                          <button
                            onClick={() => answerMut.mutate({ courseId, threadId, postId: post.id })}
                            className="btn-ghost p-1 rounded text-xs text-gray-600 hover:text-green-500"
                            title="Mark as answer"
                          >
                            <CheckCircle size={14} />
                          </button>
                        )}
                        {canModerate && post.is_answer && (
                          <button
                            onClick={() => answerMut.mutate({ courseId, threadId, postId: post.id })}
                            className="btn-ghost p-1 rounded text-xs text-green-500"
                            title="Unmark as answer"
                          >
                            <CheckCircle size={14} />
                          </button>
                        )}
                        {isOwnPost && editingPostId !== post.id && (
                          <>
                            <button
                              onClick={() => { setEditingPostId(post.id); setEditContent(post.content); }}
                              className="btn-ghost p-1 rounded text-gray-600 hover:text-white"
                              title="Edit"
                            >
                              <Edit3 size={12} />
                            </button>
                            <button
                              onClick={() => { if (confirm('Delete this post?')) deletePostMut.mutate({ courseId, threadId, postId: post.id }); }}
                              className="btn-ghost p-1 rounded text-gray-600 hover:text-red-400"
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {editingPostId === post.id ? (
                      <div className="flex flex-col gap-2">
                        <textarea
                          value={editContent}
                          onChange={e => setEditContent(e.target.value)}
                          rows={3}
                          className="input resize-none text-sm"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleEdit(post.id)} loading={updatePostMut.isPending}>
                            <Send size={12} /> Save
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => setEditingPostId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{post.content}</div>
                    )}

                    {/* Reactions */}
                    <div className="flex items-center gap-2 mt-3">
                      {EMOJIS.map(emoji => {
                        const count = reactions[emoji] || 0;
                        const isActive = userReaction === emoji;
                        return (
                          <button
                            key={emoji}
                            onClick={() => reactMut.mutate({ courseId, threadId, postId: post.id, emoji })}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
                              isActive
                                ? 'bg-[#3B9EE8]/20 text-[#3B9EE8]'
                                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                            }`}
                          >
                            {emoji} {count > 0 && count}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reply form */}
      {isLocked ? (
        <div className="card p-4 text-center text-gray-500">
          <Lock size={16} className="inline mr-1" />
          This thread is locked. No new replies can be added.
        </div>
      ) : (
        <form onSubmit={handleReply} className="card p-5">
          <h3 className="font-medium text-white text-sm mb-3">Post a Reply</h3>
          <textarea
            value={replyContent}
            onChange={e => setReplyContent(e.target.value)}
            rows={4}
            className="input resize-none mb-3"
            placeholder="Write your reply…"
            required
          />
          <div className="flex justify-end">
            <Button type="submit" loading={replyMut.isPending}>
              <Reply size={14} /> Reply
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
