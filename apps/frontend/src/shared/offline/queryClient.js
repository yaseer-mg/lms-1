import { QueryClient } from '@tanstack/react-query';
import { createIDBPersister } from './persister';

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
    shouldDehydrateMutation: (mutation) =>
      mutation.state.status === 'paused' || mutation.state.isPaused,
  },
  hydrateOptions: {},
};

export function setupOfflineSync(queryClient) {
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      queryClient.resumePausedMutations().catch(() => {});
    });
  }
  return queryClient;
}