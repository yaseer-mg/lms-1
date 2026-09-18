import { get, set, del } from 'idb-keyval';

const K = {
  client: 'lms-offline-client-v1',
  videos: 'lms-offline-videos-v1',
};

export function createIDBPersister(key = K.client) {
  return {
    persistClient: async (client) => { await set(key, client); },
    restoreClient: async () => await get(key),
    removeClient:  async () => await del(key),
  };
}

export const offlineKeys = K;