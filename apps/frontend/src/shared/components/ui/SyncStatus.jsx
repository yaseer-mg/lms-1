import { useEffect, useState } from 'react';
import { useMutationState } from '@tanstack/react-query';
import { CloudOff, CheckCircle2, RefreshCw } from 'lucide-react';
import { getSyncMeta, SYNC_EVENT } from '../../offline/sync.meta';

function formatAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SyncStatus() {
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [status, setStatus] = useState('synced');

  useEffect(() => {
    getSyncMeta().then(meta => setStatus(meta.status || 'synced'));
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const onSync = (e) => setStatus(e.detail?.status || 'synced');
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener(SYNC_EVENT, onSync);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener(SYNC_EVENT, onSync);
    };
  }, []);

  const pending = useMutationState({
    filters: { predicate: (m) => m.state.isPaused },
  });

  const pendingCount = pending.length;
  if (online && pendingCount === 0 && status === 'synced') return null;

  let label;
  let icon;
  let cls;
  if (!online) {
    label = 'Offline';
    icon = <CloudOff size={14} />;
    cls = 'text-amber-300 bg-amber-500/15 border-amber-500/30';
  } else if (pendingCount > 0) {
    label = pendingCount === 1 ? 'Syncing 1 action…' : `Syncing ${pendingCount} actions…`;
    icon = <RefreshCw size={14} className="animate-spin" />;
    cls = 'text-blue-300 bg-blue-500/15 border-blue-500/30';
  } else {
    label = 'Synced';
    icon = <CheckCircle2 size={14} />;
    cls = 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30';
  }

  return (
    <div
      className={`hidden md:flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border ${cls}`}
      title="Actions you make offline are queued and synced automatically when you reconnect."
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}