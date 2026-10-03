import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore }   from './shared/stores/authStore';
import { useSocketStore } from './shared/stores/socketStore';
import { prefetchStudentData } from './shared/offline/prefetch';

// Layouts & guards
import AppLayout, { AuthLayout, ClassroomLayout } from './shared/components/layout/AppLayout';
import { RequireAuth, RequireRole, GuestOnly }     from './app/guards';
import { PageLoader } from './shared/components/ui/spinner';
import ErrorBoundary from './shared/components/ErrorBoundary';

// If a lazily loaded chunk fails (stale service worker cache after a deploy,
// interrupted download), reload once with the fresh index.html instead of
// leaving the user on a blank screen.
const LAZY_RELOAD_KEY = '__lazy_chunk_reload__';
function lazyRetry(factory) {
  return lazy(() =>
    factory()
      .then((mod) => {
        try { sessionStorage.removeItem(LAZY_RELOAD_KEY); } catch { /* ignore */ }
        return mod;
      })
      .catch((err) => {
        let retried = false;
        try {
          retried = sessionStorage.getItem(LAZY_RELOAD_KEY) === '1';
          sessionStorage.setItem(LAZY_RELOAD_KEY, '1');
        } catch { /* ignore */ }
        if (!retried) window.location.reload();
        throw err;
      })
  );
}

// ── Lazy pages ────────────────────────────────
const LoginPage           = lazyRetry(() => import('./features/auth/pages/LoginPage'));
const ForgotPasswordPage  = lazyRetry(() => import('./features/auth/pages/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage   = lazyRetry(() => import('./features/auth/pages/ForgotPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const ChangePasswordPage  = lazyRetry(() => import('./features/auth/pages/ChangePasswordPage'));
const VerifyEmailPage     = lazyRetry(() => import('./features/auth/pages/VerifyEmailPage'));
const StudentDashboard    = lazyRetry(() => import('./features/dashboard/StudentDashboard'));
const CourseCatalogPage   = lazyRetry(() => import('./features/courses/pages/CourseCatalogPage'));
const CourseDetailPage    = lazyRetry(() => import('./features/courses/pages/CourseDetailPage'));
const ClassroomPage       = lazyRetry(() => import('./features/classroom/pages/ClassroomPage'));
const MessagesPage        = lazyRetry(() => import('./features/messages/pages/MessagesPage'));
const InstructorDashboard = lazyRetry(() => import('./features/instructor/pages/InstructorDashboardPage'));
const AdminDashboard      = lazyRetry(() => import('./features/admin/pages/AdminDashboardPage'));
const ProfilePage         = lazyRetry(() => import('./features/auth/pages/ProfilePage'));
const NotificationsPage   = lazyRetry(() => import('./features/notifications/pages/NotificationsPage'));
const AdminUsersPage      = lazyRetry(() => import('./features/admin/pages/AdminUsersPage'));
const AdminCoursesPage    = lazyRetry(() => import('./features/admin/pages/AdminCoursesPage'));
const AdminCreateCoursePage = lazyRetry(() => import('./features/admin/pages/AdminCreateCoursePage'));
const AdminEnrollmentsPage = lazyRetry(() => import('./features/admin/pages/AdminEnrollmentsPage'));
const AdminAnalyticsPage = lazyRetry(() => import('./features/admin/pages/AdminAnalyticsPage'));
const AuditLogPage       = lazyRetry(() => import('./features/admin/pages/AuditLogPage'));
const AdminSettingsPage  = lazyRetry(() => import('./features/admin/pages/AdminSettingsPage'));
const PaymentGatewayPage = lazyRetry(() => import('./features/admin/pages/PaymentGatewayPage'));
const InstructorAnalyticsPage = lazyRetry(() => import('./features/instructor/pages/InstructorAnalyticsPage'));
const CourseAnalyticsPage = lazyRetry(() => import('./features/instructor/pages/CourseAnalyticsPage'));
const CourseBuilderPage = lazyRetry(() => import('./features/instructor/pages/CourseBuilderPage'));
const QuestionBankPage   = lazyRetry(() => import('./features/instructor/pages/QuestionBankPage'));
const CourseGroupsPage   = lazyRetry(() => import('./features/instructor/pages/CourseGroupsPage'));
const CourseCertificatesPage = lazyRetry(() => import('./features/instructor/pages/CourseCertificatesPage'));
const InstructorStudentsPage = lazyRetry(() => import('./features/instructor/pages/InstructorStudentsPage'));
const InstructorGradebookPage = lazyRetry(() => import('./features/instructor/pages/InstructorGradebookPage'));
const SubmissionsPage = lazyRetry(() => import('./features/instructor/pages/SubmissionsPage'));
const ForumThreadsPage = lazyRetry(() => import('./features/forums/pages/ForumThreadsPage'));
const ForumThreadDetailPage = lazyRetry(() => import('./features/forums/pages/ForumThreadDetailPage'));
const CertificatesPage = lazyRetry(() => import('./features/certificates/pages/CertificatesPage'));
const LeaderboardPage = lazyRetry(() => import('./features/certificates/pages/LeaderboardPage'));
const CalendarPage = lazyRetry(() => import('./features/calendar/pages/CalendarPage'));

// Prefetch student data when a student session is restored
function OfflinePrefetch() {
  const user         = useAuthStore(s => s.user);
  const queryClient  = useQueryClient();
  useEffect(() => {
    if (user?.id) prefetchStudentData(queryClient, user.role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  return null;
}

// Connect Socket.io once the user is known
function SocketInit() {
  const user    = useAuthStore(s => s.user);
  const connect = useSocketStore(s => s.connect);
  const disconnect = useSocketStore(s => s.disconnect);
  useEffect(() => {
    if (user?.id) connect(user.id);
    else disconnect();
  }, [user?.id, connect, disconnect]);
  return null;
}

function AppRoutes() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <SocketInit />
      <OfflinePrefetch />
      <Suspense fallback={<PageLoader />}>
        <Routes>

          {/* ── Auth pages (centered, no sidebar) ── */}
          <Route element={<AuthLayout />}>
            <Route path="/login"           element={<GuestOnly><LoginPage /></GuestOnly>} />
            <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
            <Route path="/reset-password"  element={<GuestOnly><ResetPasswordPage /></GuestOnly>} />
            <Route path="/verify-email"    element={<VerifyEmailPage />} />
          </Route>

          {/* ── Forced/voluntary password change (logged in, centered) ── */}
          <Route element={<RequireAuth><AuthLayout /></RequireAuth>}>
            <Route path="/change-password" element={<ChangePasswordPage />} />
          </Route>

          {/* ── Classroom (full width, requires login) ── */}
          <Route element={<RequireAuth />}>
            <Route element={<ClassroomLayout />}>
              <Route path="/learn/:courseId/forums/:threadId" element={<ForumThreadDetailPage />} />
              <Route path="/learn/:courseId/forums"           element={<ForumThreadsPage />} />
              <Route path="/learn/:courseId"                   element={<ClassroomPage />} />
              <Route path="/learn/:courseId/lessons/:lessonId" element={<ClassroomPage />} />
            </Route>
          </Route>

          {/* ── Main app shell (navbar + sidebar) ── */}
          <Route element={<AppLayout />}>

            {/* Public */}
            <Route index                  element={<Navigate to="/courses" replace />} />
            <Route path="/courses"        element={<CourseCatalogPage />} />
            <Route path="/courses/:slug"  element={<CourseDetailPage />} />

            {/* Student — requires login only */}
            <Route element={<RequireAuth />}>
              <Route path="/dashboard"     element={<StudentDashboard />} />
              <Route path="/profile"       element={<ProfilePage />} />
              <Route path="/messages"      element={<MessagesPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/calendar"      element={<CalendarPage />} />
              <Route path="/achievements"  element={<CertificatesPage />} />
              <Route path="/leaderboard"   element={<LeaderboardPage />} />
            </Route>

            {/* Instructor — requires login + role */}
            <Route element={<RequireAuth />}>
              <Route element={<RequireRole roles={['instructor','admin','super_admin']} />}>
                <Route path="/instructor"                       element={<InstructorDashboard />} />
                <Route path="/instructor/gradebook"            element={<InstructorGradebookPage />} />
                <Route path="/instructor/courses"              element={<Navigate to="/instructor" replace />} />
                <Route path="/instructor/courses/:id/edit"      element={<CourseBuilderPage />} />
                <Route path="/instructor/courses/:id/question-bank" element={<QuestionBankPage />} />
                <Route path="/instructor/courses/:id/groups"       element={<CourseGroupsPage />} />
                <Route path="/instructor/courses/:id/analytics" element={<CourseAnalyticsPage />} />
                <Route path="/instructor/courses/:id/certificates" element={<CourseCertificatesPage />} />
                <Route path="/instructor/courses/:id/gradebook" element={<InstructorGradebookPage />} />
                <Route path="/instructor/students"              element={<InstructorStudentsPage />} />
                <Route path="/instructor/submissions"           element={<SubmissionsPage />} />
                <Route path="/instructor/analytics"             element={<InstructorAnalyticsPage />} />
              </Route>
            </Route>

            {/* Admin — requires login + role */}
            <Route element={<RequireAuth />}>
              <Route element={<RequireRole roles={['admin','super_admin']} />}>
                <Route path="/admin"             element={<AdminDashboard />} />
                <Route path="/admin/users"       element={<AdminUsersPage />} />
                <Route path="/admin/courses"     element={<AdminCoursesPage />} />
                <Route path="/admin/courses/new" element={<AdminCreateCoursePage />} />
                <Route path="/admin/enrollments" element={<AdminEnrollmentsPage />} />
                <Route path="/admin/analytics"   element={<AdminAnalyticsPage />} />
                <Route path="/admin/audit-logs" element={<AuditLogPage />} />
                <Route path="/admin/payments"  element={<PaymentGatewayPage />} />
                <Route path="/admin/settings"   element={<AdminSettingsPage />} />
              </Route>
            </Route>

            <Route path="*" element={
              <div className="text-center py-32">
                <p className="text-7xl font-display font-black text-gray-800 mb-4">404</p>
                <p className="text-gray-400 text-lg">Page not found</p>
              </div>
            } />
          </Route>

        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
