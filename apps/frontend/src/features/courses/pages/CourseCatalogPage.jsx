import { useState }   from 'react';
import { useQuery }   from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, Star, Clock, Users, BookOpen } from 'lucide-react';
import { coursesApi } from '../../../shared/api/courses.api';
import { enrollmentsApi } from '../../../shared/api/enrollments.api';
import { useAuthStore } from '../../../shared/stores/authStore';
import Spinner        from '../../../shared/components/ui/spinner';
import { clsx }       from 'clsx';

export default function CourseCatalogPage() {
  const user = useAuthStore(s => s.user);
  const isStudent = user?.role === 'student';

  const [params, setParams] = useSearchParams();
  const search   = params.get('search')   || '';
  const category = params.get('category') || '';
  const level    = params.get('level')    || '';
  const sort     = params.get('sort')     || 'newest';
  const page     = parseInt(params.get('page') || '1', 10);

  const set = (key, val) => {
    const p = new URLSearchParams(params);
    if (val) p.set(key, val); else p.delete(key);
    p.delete('page');
    setParams(p);
  };

  const { data: cats }  = useQuery({
    queryKey: ['categories'],
    queryFn:  () => coursesApi.categories().then(r => r.data.data.categories),
  });

  const enrolledQuery = useQuery({
    queryKey: ['enrolled-courses'],
    queryFn:  () => enrollmentsApi.myEnrollments().then(r => r.data.data.enrollments),
    enabled:  isStudent,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['courses', { search, category, level, sort, page }],
    queryFn:  () => coursesApi.list({ search, category, level, sort, page, limit: 12 }).then(r => r.data),
    enabled:  !isStudent,
  });

  const allCourses = !isStudent ? (data?.data || []) : [];
  const enrolledCourses = isStudent ? (enrolledQuery.data || []) : [];
  const courses = isStudent ? enrolledCourses : allCourses;
  const pagination = !isStudent ? data?.pagination : null;
  const loading = isStudent ? enrolledQuery.isLoading : isLoading;

  return (
    <div className="px-4 sm:px-6">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <h1 className="font-display font-bold text-3xl text-white mb-2">
          {isStudent ? 'My Courses' : 'Course Catalog'}
        </h1>
        <p className="text-gray-400">
          {isStudent ? 'Courses you are enrolled in' : 'Explore all available courses'}
        </p>
      </div>

      {/* Search + sort bar (only for non-students / public) */}
      {!isStudent && (
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="relative flex-1 min-w-56">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="input pl-9"
              placeholder="Search courses…"
              defaultValue={search}
              onKeyDown={(e) => { if (e.key === 'Enter') set('search', e.target.value); }}
            />
          </div>
          <select className="input w-auto" value={sort} onChange={e => set('sort', e.target.value)}>
            <option value="newest">Newest</option>
            <option value="popular">Most popular</option>
            <option value="rating">Highest rated</option>
          </select>
          <select className="input w-auto" value={level} onChange={e => set('level', e.target.value)}>
            <option value="">All levels</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>
      )}

      {/* Mobile category filter */}
      {!isStudent && (
        <div className="lg:hidden mb-4">
          <select
            className="input w-full"
            value={category}
            onChange={e => set('category', e.target.value)}
          >
            <option value="">All categories</option>
            {cats?.map(cat => (
              <option key={cat.id} value={cat.slug}>{cat.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-6">
        {/* Category sidebar (only for non-students) */}
        {!isStudent && (
          <aside className="hidden lg:flex flex-col gap-1 w-48 flex-shrink-0">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Category
            </p>
            <button
              onClick={() => set('category', '')}
              className={clsx('text-left text-sm px-3 py-2 rounded-lg transition-colors',
                !category ? 'bg-[#1A6FBF]/20 text-[#3B9EE8]' : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              All categories
            </button>
            {cats?.map(cat => (
              <button
                key={cat.id}
                onClick={() => set('category', cat.slug)}
                className={clsx('text-left text-sm px-3 py-2 rounded-lg transition-colors',
                  category === cat.slug ? 'bg-[#1A6FBF]/20 text-[#3B9EE8]' : 'text-gray-400 hover:text-white hover:bg-white/5'
                )}
              >
                {cat.name}
              </button>
            ))}
          </aside>
        )}

        {/* Course grid */}
        <div className="flex-1">
          {loading ? (
            <div className="flex justify-center py-20"><Spinner size="lg" /></div>
          ) : courses.length === 0 ? (
            <div className="text-center py-20 text-gray-500">
              {isStudent ? (
                <>
                  <BookOpen size={40} className="mx-auto mb-3 text-gray-700" />
                  <p className="font-medium text-gray-400">You're not enrolled in any courses yet</p>
                  <Link to="/courses" className="mt-4 inline-block text-[#3B9EE8] hover:underline text-sm">
                    Browse the full catalog &rarr;
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-4xl mb-3">🔍</p>
                  <p className="font-medium text-gray-400">No courses found</p>
                  <p className="text-sm mt-1">Try adjusting your search or filters</p>
                </>
              )}
            </div>
          ) : (
            <>
              {!isStudent && (
                <p className="text-sm text-gray-500 mb-4">
                  {pagination?.total || 0} courses found
                </p>
              )}
              {isStudent && (
                <p className="text-sm text-gray-500 mb-4">
                  {courses.length} enrolled course{courses.length !== 1 ? 's' : ''}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {courses.map(c => (
                  <CourseCard key={c.course_id || c.id} course={c} isStudent={isStudent} />
                ))}
              </div>

              {/* Pagination (only for non-students) */}
              {!isStudent && pagination && pagination.totalPages > 1 && (
                <div className="flex justify-center gap-2 mt-8">
                  {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(p => (
                    <button
                      key={p}
                      onClick={() => { const ps = new URLSearchParams(params); ps.set('page', p); setParams(ps); }}
                      className={clsx('w-9 h-9 rounded-lg text-sm font-medium transition-colors',
                        p === page ? 'bg-[#1A6FBF] text-white' : 'bg-[#112236] text-gray-400 hover:text-white'
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CourseCard({ course, isStudent }) {
  const formatDuration = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const linkTo = isStudent
    ? `/learn/${course.course_id}`
    : `/courses/${course.slug}`;

  return (
    <Link
      to={linkTo}
      className="card p-0 overflow-hidden flex flex-col hover:border-[#3B9EE8]/40
                 transition-colors group"
    >
      {/* Thumbnail */}
      <div className="h-44 bg-gradient-to-br from-[#112236] to-[#0D1B2A] relative overflow-hidden">
        {course.thumbnail_path ? (
          <img
            src={`/lmsdata/${course.thumbnail_path}`}
            alt={course.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl">📚</div>
        )}
        <div className="absolute top-2 left-2">
          <span className="badge-green badge">Available</span>
        </div>
        <div className="absolute top-2 right-2">
          <span className="badge-gray badge capitalize">{course.level}</span>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col flex-1">
        <p className="text-xs text-gray-500 mb-1">{course.category_name || ''}</p>
        <h3 className="font-semibold text-white text-sm leading-tight mb-2 line-clamp-2 flex-1">
          {course.title}
        </h3>
        <p className="text-xs text-gray-500 mb-3">{course.instructor_name}</p>

        <div className="flex items-center gap-3 text-xs text-gray-500">
          {course.rating_average > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <Star size={11} fill="currentColor" />
              {parseFloat(course.rating_average).toFixed(1)}
            </span>
          )}
          {course.duration_seconds > 0 && (
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {formatDuration(course.duration_seconds)}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Users size={11} />
            {course.student_count || 0}
          </span>
        </div>
      </div>
    </Link>
  );
}