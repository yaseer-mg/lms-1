import { useEffect, useState } from 'react';
import { useMutationState } from '@tanstack/react-query';

export default function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const pending = useMutationState({
    filters: { predicate: (m) => m.state?.isPaused },
  });

  if (online && pending.length === 0) return null;

  const isOffline = !online;

  return (
    <div className={`px-4 py-2 text-center text-sm font-medium transition-colors ${isOffline ? 'bg-amber-500/15 text-amber-300 border-b border-amber-500/30' : 'bg-emerald-500/15 text-emerald-300 border-b border-emerald-500/30'}`}>
      {isOffline ? (
        <>
          You're offline — using saved data.
          {pending.length > 0 && ` ${pending.length} action${pending.length === 1 ? '' : 's'} pending sync.`}
        </>
      ) : (
        <>Syncing {pending.length} pending action{pending.length === 1 ? '' : 's'} to the server…</>
      )}
    </div>
  );
}