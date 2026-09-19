import { get, set } from 'idb-keyval';

const KEY = 'lms-offline-sync-meta';
export const SYNC_EVENT = 'lms-offline-synced';

export async function getSyncMeta() {
  try {
    return (await get(KEY)) || {};
  } catch {
    return {};
  }
}

export async function setSyncMeta(meta) {
  try {
    await set(KEY, meta);
  } catch {
    /* ignore */
  }
}

export function notifySync(meta) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: meta }));
  }
}