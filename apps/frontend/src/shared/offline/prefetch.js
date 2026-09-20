import api from '../api/client';
import { coursesApi } from '../api/courses.api';
import { enrollmentsApi } from '../api/enrollments.api';
import { certificatesApi } from '../api/certificates.api';
import { calendarApi } from '../api/calendar.api';

export function prefetchStudentData(queryClient, role) {
  if (role !== 'student') return;

  queryClient.prefetchQuery({
    queryKey: ['enrolled-courses'],
    queryFn:  () => enrollmentsApi.myEnrollments().then(r => r.data.data.enrollments),
  });
  queryClient.prefetchQuery({
    queryKey: ['categories'],
    queryFn:  () => coursesApi.categories().then(r => r.data.data.categories || []),
  });
  queryClient.prefetchQuery({
    queryKey: ['student-dashboard'],
    queryFn:  () => api.get('/progress/dashboard').then(r => r.data.data),
  });
  queryClient.prefetchQuery({
    queryKey: ['my-xp'],
    queryFn:  () => certificatesApi.myXp().then(r => r.data.data),
  });
  queryClient.prefetchQuery({
    queryKey: ['dashboard-calendar'],
    queryFn:  () => calendarApi.listEvents({
      startDate: new Date().toISOString(),
      endDate:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).then(r => r.data.data.events || []),
  });
  queryClient.prefetchQuery({
    queryKey: ['dashboard-activity'],
    queryFn:  () => api.get('/notifications', { params: { limit: 5 } }).then(r => r.data.data || []),
  });
}