import api from '../api/client';
import { forumsApi } from '../api/forums.api';
import { calendarApi } from '../api/calendar.api';
import { notificationsApi } from '../api/notifications.api';

const MUTATIONS = {
  'lesson-complete': {
    mutationFn: ({ lessonId, courseId }) =>
      api.post(`/progress/lessons/${lessonId}/complete`, { courseId }),
  },
  'video-toggle-complete': {
    mutationFn: ({ lessonId, courseId, complete }) =>
      api.post(`/progress/lessons/${lessonId}/${complete ? 'complete' : 'incomplete'}`, { courseId }),
  },
  'video-bookmark-add': {
    mutationFn: ({ lessonId, courseId, positionSecs, label }) =>
      api.post(`/progress/lessons/${lessonId}/bookmarks`, { courseId, positionSecs, label }),
  },
  'video-bookmark-delete': {
    mutationFn: ({ lessonId, bookmarkId }) =>
      api.delete(`/progress/lessons/${lessonId}/bookmarks/${bookmarkId}`),
  },
  'assignment-submit': {
    mutationFn: ({ assignmentId, textContent, files }) => {
      const fd = new FormData();
      if (textContent && String(textContent).trim()) fd.append('textContent', String(textContent).trim());
      for (const f of files || []) fd.append('files', f);
      return api.post(`/submissions/assignments/${assignmentId}/submit`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
  },
  'quiz-submit': {
    mutationFn: ({ attemptId, payload }) =>
      api.post(`/assessments/attempts/${attemptId}/submit`, { answers: payload }),
  },
  'forum-create-thread': {
    mutationFn: ({ courseId, ...data }) => forumsApi.createThread(courseId, data),
  },
  'forum-reply': {
    mutationFn: ({ courseId, threadId, content }) =>
      forumsApi.createPost(courseId, threadId, { content }),
  },
  'forum-update-post': {
    mutationFn: ({ courseId, threadId, postId, data }) =>
      forumsApi.updatePost(courseId, threadId, postId, data),
  },
  'forum-delete-post': {
    mutationFn: ({ courseId, threadId, postId }) =>
      forumsApi.deletePost(courseId, threadId, postId),
  },
  'forum-mark-answer': {
    mutationFn: ({ courseId, threadId, postId }) =>
      forumsApi.markAsAnswer(courseId, threadId, postId),
  },
  'forum-react': {
    mutationFn: ({ courseId, threadId, postId, emoji }) =>
      forumsApi.toggleReaction(courseId, threadId, postId, emoji),
  },
  'message-send': {
    mutationFn: ({ recipientId, content }) =>
      api.post('/messages/send', { recipientId, content }),
  },
  'message-delete': {
    mutationFn: ({ convId, msgId }) =>
      api.delete(`/messages/${convId}/messages/${msgId}`),
  },
  'notification-read': {
    mutationFn: (ids) => api.patch('/notifications/read', { ids: ids || [] }),
  },
  'notification-read-all': {
    mutationFn: () => api.patch('/notifications/read', {}),
  },
  'notification-read-one': {
    mutationFn: (id) => api.patch('/notifications/read', { ids: [id] }),
  },
  'notification-delete': {
    mutationFn: (id) => api.delete(`/notifications/${id}`),
  },
  'notification-prefs': {
    mutationFn: ({ type, data }) => notificationsApi.updatePreference(type, data),
  },
  'calendar-create': {
    mutationFn: (data) => calendarApi.createEvent(data),
  },
  'calendar-delete': {
    mutationFn: (id) => calendarApi.deleteEvent(id),
  },
  'profile-update': {
    mutationFn: (data) => api.patch('/users/profile', data),
  },
};

export function registerMutationDefaults(queryClient) {
  for (const [key, def] of Object.entries(MUTATIONS)) {
    queryClient.setMutationDefaults([key], {
      mutationFn: def.mutationFn,
      retry: 2,
      networkMode: 'online',
    });
  }
  return queryClient;
}

export const mutationKeys = Object.keys(MUTATIONS);