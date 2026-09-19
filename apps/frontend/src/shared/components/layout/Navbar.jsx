import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sun, Moon, Bell, MessageSquare, Menu, X, ChevronDown, BookOpen } from 'lucide-react';
import { useQuery }  from '@tanstack/react-query';
import { useAuth }          from '../../hooks/useAuth';
import { useNotifications } from '../../hooks/useNotifications';
import NotificationDrawer   from '../../../features/notifications/NotificationDrawer';
import SyncStatus           from '../ui/SyncStatus';
import api                  from '../../api/client';
import { useTheme }         from '../../contexts/ThemeContext';

export default function Navbar({ onMenuToggle }) {
  const { user, logout, isAdmin, isInstructor } = useAuth();
  const { unreadCount } = useNotifications();
  const navigate         = useNavigate();
  const { theme, toggle } = useTheme();

  const [showNotifs,   setShowNotifs]   = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Fetch institution settings for branding
  const { data: settings } = useQuery({
    queryKey: ['institution-settings'],
    queryFn: () => api.get('/admin/settings').then(r => r.data.data.settings || {}),
    staleTime: 5 * 60 * 1000,
  });

  const institutionName = settings?.institution_name || 'Shaheed Mahmoud Academy';
  const logoUrl = settings?.institution_logo_url || '/logo.jpg';
  const [logoError, setLogoError] = useState(false);

  return (
    <>
    <nav className="fixed top-0 left-0 right-0 z-40 h-16
                       backdrop-blur-md
                       border-b flex items-center px-4 gap-4"
         style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>

        {/* Sidebar toggle (mobile) */}
        <button
          className="btn-ghost p-2 rounded-lg lg:hidden"
          onClick={onMenuToggle}
        >
          <Menu size={20} />
        </button>

        {/* Logo */}
        <Link to="/"
              className="flex items-center justify-center gap-2 flex-1 lg:flex-none lg:justify-start lg:mr-4 min-w-0">
          <div className="w-8 h-8 bg-[#1A6FBF] rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoError ? (
              <BookOpen size={16} className="text-white" />
            ) : (
              <img src={logoUrl} alt={institutionName} className="w-full h-full object-cover"
                onError={() => setLogoError(true)} />
            )}
          </div>
          <span className="font-display font-bold text-sm truncate max-w-[100px] sm:max-w-[200px]"
                style={{ color: 'var(--text-primary)' }}>
            {institutionName}
          </span>
        </Link>

        {/* Search */}
        <div className="flex-1 max-w-sm hidden md:block">
          <input
            type="text"
            placeholder="Search courses…"
            className="input py-2 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target.value) {
                navigate(`/courses?search=${encodeURIComponent(e.target.value)}`);
              }
            }}
          />
        </div>

        <div className="flex-1" />

        {/* Nav links */}
        <Link to="/courses" className="btn-ghost text-sm hidden sm:flex">
          Browse Courses
        </Link>

        {user && (
          <>
            <SyncStatus />

            {/* Messages */}
            <Link to="/messages" className="btn-ghost p-2 rounded-lg relative">
              <MessageSquare size={20} />
            </Link>

            {/* Notifications */}
            <button
              className="btn-ghost p-2 rounded-lg relative"
              onClick={() => setShowNotifs(v => !v)}
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[18px] h-[18px]
                                 bg-red-500 text-white text-[10px] font-bold
                                 rounded-full flex items-center justify-center px-1">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {/* Theme */}
            <button
              onClick={toggle}
              className="btn-ghost p-2 rounded-lg"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(v => !v)}
                className="flex items-center gap-2 btn-ghost px-3 py-2 rounded-xl"
              >
                <div className="w-8 h-8 rounded-full bg-[#1A6FBF]
                                flex items-center justify-center
                                text-white text-sm font-bold">
                  {user.first_name?.[0] || user.email?.[0]?.toUpperCase() || '?'}{user.last_name?.[0] || ''}
                </div>
                <span className="text-sm hidden sm:block"
                      style={{ color: 'var(--text-primary)' }}>
                  {user.first_name}
                </span>
                <ChevronDown size={14} className="text-gray-400" />
              </button>

              {showUserMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowUserMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-52 z-50
                                  card py-1 shadow-2xl">
                    <div className="px-4 py-2 mb-1" style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <p className="text-sm font-semibold"
                         style={{ color: 'var(--text-primary)' }}>
                        {user.first_name} {user.last_name}
                      </p>
                      <p className="text-xs capitalize"
                         style={{ color: 'var(--text-secondary)' }}>
                        {user.role === 'super_admin' ? 'Super Admin' : user.role}
                      </p>
                    </div>

                    {[
                      { label: 'My Dashboard',    to: '/dashboard' },
                      isInstructor && { label: 'Instructor Panel', to: '/instructor' },
                      isAdmin      && { label: 'Admin Panel',      to: '/admin' },
                      { label: 'Profile Settings', to: '/profile' },
                    ].filter(Boolean).map(({ label, to }) => (
                      <Link
                        key={to}
                        to={to}
                        onClick={() => setShowUserMenu(false)}
                        className="flex px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
                      >
                        {label}
                      </Link>
                    ))}

                    <div className="mt-1 pt-1" style={{ borderTop: '1px solid var(--border-color)' }}>
                      <button
                        onClick={() => { setShowUserMenu(false); logout(); }}
                        className="w-full text-left px-4 py-2 text-sm
                                   text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {!user && (
          <div className="flex items-center gap-2">
            <Link to="/login" className="btn-primary text-sm">Sign in</Link>
          </div>
        )}
      </nav>

      {/* Notification drawer */}
      <NotificationDrawer open={showNotifs} onClose={() => setShowNotifs(false)} />
    </>
  );
}