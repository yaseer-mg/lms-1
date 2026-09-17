import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  Plus, Trash2, Clock, BookOpen, GraduationCap,
} from 'lucide-react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, addMonths, subMonths, isSameMonth,
  isSameDay, isToday, parseISO,
} from 'date-fns';
import toast from 'react-hot-toast';
import { calendarApi } from '../../../shared/api/calendar.api';
import Button from '../../../shared/components/ui/Button';
import Input from '../../../shared/components/ui/input';
import Modal from '../../../shared/components/ui/modal';
import Spinner from '../../../shared/components/ui/spinner';

const EVENT_COLORS = {
  assignment_due: { dot: 'bg-red-500', bg: 'bg-red-500/10 text-red-400 border-red-500/20' },
  course_start:   { dot: 'bg-green-500', bg: 'bg-green-500/10 text-green-400 border-green-500/20' },
  institutional:  { dot: 'bg-purple-500', bg: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  manual:         { dot: 'bg-[#3B9EE8]', bg: 'bg-[#3B9EE8]/10 text-[#3B9EE8] border-[#3B9EE8]/20' },
};

const EVENT_ICONS = {
  assignment_due: BookOpen,
  course_start:   GraduationCap,
  manual:         Clock,
  institutional:  CalendarIcon,
};

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [form, setForm] = useState({
    title: '', description: '', startDate: '', endDate: '',
    allDay: true, eventType: 'manual',
  });

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const { data, isLoading } = useQuery({
    queryKey: ['calendar-events', format(monthStart, 'yyyy-MM'), format(monthEnd, 'yyyy-MM')],
    queryFn: () => calendarApi.listEvents({
      startDate: format(calStart, "yyyy-MM-dd'T'HH:mm:ss'Z'"),
      endDate: format(calEnd, "yyyy-MM-dd'T'HH:mm:ss'Z'"),
    }).then(r => r.data.data.events || []),
  });

  const events = data || [];

  const eventsByDate = useMemo(() => {
    const map = {};
    events.forEach(ev => {
      const key = format(parseISO(ev.start_date), 'yyyy-MM-dd');
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    });
    return map;
  }, [events]);

  const selectedEvents = selectedDate ? eventsByDate[format(selectedDate, 'yyyy-MM-dd')] || [] : [];

  const createMut = useMutation({
    mutationFn: (data) => calendarApi.createEvent(data),
    onSuccess: () => {
      toast.success('Event created');
      setShowCreateModal(false);
      setForm({ title: '', description: '', startDate: '', endDate: '', allDay: true, eventType: 'manual' });
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create event'),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => calendarApi.deleteEvent(id),
    onSuccess: () => {
      toast.success('Event deleted');
      setShowEventModal(false);
      setEditingEvent(null);
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete event'),
  });

  const handleCreate = (e) => {
    e.preventDefault();
    createMut.mutate({
      ...form,
      startDate: form.startDate ? new Date(form.startDate).toISOString() : new Date().toISOString(),
      endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
    });
  };

  const goToday = () => setCurrentDate(new Date());
  const prevMonth = () => setCurrentDate(d => subMonths(d, 1));
  const nextMonth = () => setCurrentDate(d => addMonths(d, 1));

  const openCreateForDate = (date) => {
    setForm({
      title: '', description: '', startDate: format(date, 'yyyy-MM-dd'),
      endDate: '', allDay: true, eventType: 'manual',
    });
    setShowCreateModal(true);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="font-display font-bold text-xl sm:text-2xl text-white flex items-center gap-3">
          <CalendarIcon size={24} className="text-[#3B9EE8]" />
          Calendar
        </h1>
        <Button onClick={() => {
          setForm({ title: '', description: '', startDate: format(new Date(), 'yyyy-MM-dd'), endDate: '', allDay: true, eventType: 'manual' });
          setShowCreateModal(true);
        }}>
          <Plus size={16} /> Add Event
        </Button>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Calendar grid */}
        <div className="flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <button onClick={prevMonth} className="btn-ghost p-1.5 rounded-lg"><ChevronLeft size={18} /></button>
              <h2 className="font-semibold text-base sm:text-lg text-white min-w-0 text-center whitespace-nowrap">
                {format(currentDate, 'MMMM yyyy')}
              </h2>
              <button onClick={nextMonth} className="btn-ghost p-1.5 rounded-lg"><ChevronRight size={18} /></button>
            </div>
            <Button variant="secondary" size="sm" onClick={goToday}>Today</Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-20"><Spinner /></div>
          ) : (
            <div className="card overflow-hidden">
              <div className="grid grid-cols-7 border-b border-gray-800">
                {[
                  { short: 'Su', full: 'Sun' },
                  { short: 'Mo', full: 'Mon' },
                  { short: 'Tu', full: 'Tue' },
                  { short: 'We', full: 'Wed' },
                  { short: 'Th', full: 'Thu' },
                  { short: 'Fr', full: 'Fri' },
                  { short: 'Sa', full: 'Sat' },
                ].map(d => (
                  <div key={d.full} className="p-2 text-center text-xs font-semibold text-gray-500 uppercase">
                    <span className="hidden sm:inline">{d.full}</span>
                    <span className="sm:hidden">{d.short}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map(day => {
                  const key = format(day, 'yyyy-MM-dd');
                  const dayEvents = eventsByDate[key] || [];
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  const isSelected = selectedDate && isSameDay(day, selectedDate);
                  const today = isToday(day);

                  return (
                    <div
                      key={key}
                      onClick={() => setSelectedDate(day)}
                      className={`min-h-[60px] sm:min-h-[100px] p-1.5 border-b border-r border-gray-800/50 cursor-pointer
                        transition-colors hover:bg-white/[0.02]
                        ${!isCurrentMonth ? 'opacity-30' : ''}
                        ${isSelected ? 'bg-[#3B9EE8]/10 ring-1 ring-[#3B9EE8]/30' : ''}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full
                            ${today ? 'bg-[#3B9EE8] text-white' : isCurrentMonth ? 'text-gray-400' : 'text-gray-700'}`}
                        >
                          {format(day, 'd')}
                        </span>
                        {dayEvents.length > 0 && (
                          <span className="text-[10px] text-gray-600">{dayEvents.length}</span>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 3).map(ev => {
                          const color = EVENT_COLORS[ev.event_type] || EVENT_COLORS.manual;
                          return (
                            <div
                              key={ev.id}
                              onClick={e => { e.stopPropagation(); setEditingEvent(ev); setShowEventModal(true); }}
                              className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] leading-tight ${color.bg}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color.dot}`} />
                              <span className="hidden sm:inline truncate">{ev.title}</span>
                            </div>
                          );
                        })}
                        {dayEvents.length > 3 && (
                          <p className="text-[10px] text-gray-600 pl-1">+{dayEvents.length - 3} more</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Side panel — selected day events */}
        <div className="w-full lg:w-80 flex-shrink-0">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-sm">
                {selectedDate ? format(selectedDate, 'MMMM d, yyyy') : 'Select a day'}
              </h3>
              {selectedDate && (
                <Button variant="secondary" size="sm" onClick={() => openCreateForDate(selectedDate)}>
                  <Plus size={12} /> Add
                </Button>
              )}
            </div>

            {selectedDate && selectedEvents.length === 0 && (
              <p className="text-gray-600 text-sm text-center py-8">No events on this day</p>
            )}

            <div className="space-y-2">
              {selectedEvents.map(ev => {
                const Icon = EVENT_ICONS[ev.event_type] || CalendarIcon;
                const color = EVENT_COLORS[ev.event_type] || EVENT_COLORS.manual;
                return (
                  <div
                    key={ev.id}
                    onClick={() => { setEditingEvent(ev); setShowEventModal(true); }}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors hover:bg-white/[0.02] ${color.bg.replace('text-', 'border-').split(' ')[2] ? '' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon size={14} className="mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{ev.title}</p>
                        {ev.course_title && (
                          <p className="text-xs text-gray-500 mt-0.5">{ev.course_title}</p>
                        )}
                        <p className="text-xs text-gray-600 mt-1">
                          {ev.all_day ? (
                            'All day'
                          ) : (
                            <>
                              {format(parseISO(ev.start_date), 'h:mm a')}
                              {ev.end_date && ` — ${format(parseISO(ev.end_date), 'h:mm a')}`}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Event detail modal */}
      <Modal open={showEventModal} onClose={() => { setShowEventModal(false); setEditingEvent(null); }} title="Event Details" size="sm">
        {editingEvent && (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm font-medium text-gray-300 mb-1">Title</p>
              <p className="text-white">{editingEvent.title}</p>
            </div>
            {editingEvent.description && (
              <div>
                <p className="text-sm font-medium text-gray-300 mb-1">Description</p>
                <p className="text-gray-400 text-sm whitespace-pre-wrap">{editingEvent.description}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-sm font-medium text-gray-300 mb-1">Date</p>
                <p className="text-white text-sm">{format(parseISO(editingEvent.start_date), 'MMM d, yyyy')}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-300 mb-1">Type</p>
                <p className="text-white text-sm capitalize">{editingEvent.event_type.replace('_', ' ')}</p>
              </div>
            </div>
            {editingEvent.course_title && (
              <div>
                <p className="text-sm font-medium text-gray-300 mb-1">Course</p>
                <p className="text-white text-sm">{editingEvent.course_title}</p>
              </div>
            )}
            {editingEvent.reference_type === 'assignment' && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <p className="text-xs text-red-400">Assignment due date — synced automatically</p>
              </div>
            )}
            {editingEvent.event_type === 'manual' && (
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
                <Button variant="danger" size="sm"
                  onClick={() => { if (confirm('Delete this event?')) deleteMut.mutate(editingEvent.id); }}
                  loading={deleteMut.isPending}>
                  <Trash2 size={12} /> Delete
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Create event modal */}
      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Add Event" size="md">
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <Input label="Title" value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            required placeholder="Event title" />
          <div>
            <label className="text-sm font-medium text-gray-300 mb-1.5 block">Description</label>
            <textarea value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={3} className="input resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start date" type="date" value={form.startDate}
              onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} required />
            <Input label="End date" type="date" value={form.endDate}
              onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={form.allDay}
                onChange={e => setForm(p => ({ ...p, allDay: e.target.checked }))} />
              All day
            </label>
            <select value={form.eventType}
              onChange={e => setForm(p => ({ ...p, eventType: e.target.value }))}
              className="input text-sm">
              <option value="manual">General</option>
              <option value="institutional">Institutional</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button type="submit" loading={createMut.isPending}>Create Event</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
