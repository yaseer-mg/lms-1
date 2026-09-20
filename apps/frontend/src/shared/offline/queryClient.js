import { QueryClient } from '@tanstack/react-query';
import { createIDBPersister } from './persister';
import { setSyncMeta, notifySync } from './sync.meta';

export function createOfflineQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 1000 * 60 * 10,
        gcTime: 1000 * 60 * 60 * 24 * 7,
        refetchOnWindowFocus: false,
        networkMode: 'offlineFirst',
      },
      mutations: {
        retry: 2,
        networkMode: 'online',
      },
    },
  });
}

export const offlinePersister = createIDBPersister();

export const persistOptions = {
  persister: offlinePersister,
  maxAge: 1000 * 60 * 60 * 24 * 7,
  dehydrateOptions: {
    shouldDehydrateMutation: (mutation) => Boolean(mutation?.state) && (mutation.state.status === 'paused' || mutation.state.isPaused),
  },
  hydrateOptions: {},
};

export function setupOfflineSync(queryClient) {
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      queryClient.resumePausedMutations().catch(() => {});
    });
  }

  const mutations = queryClient.getMutationCache();
  mutations.subscribe((mutation) => {
    if (!mutation?.state) return;
    const { status } = mutation.state;
    if (status === 'success') {
      const meta = { lastSynced: Date.now(), status: 'synced' };
      setSyncMeta(meta);
      notifySync(meta);
    } else if (status === 'paused') {
      const meta = { status: 'pending' };
      setSyncMeta(meta);
      notifySync(meta);
    }
  });

  return queryClient;
}