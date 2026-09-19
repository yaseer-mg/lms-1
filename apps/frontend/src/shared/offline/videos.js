import { get, set, del, keys, createStore } from 'idb-keyval';
import { offlineKeys } from './persister';

const videoStore = createStore(offlineKeys.videos, 'videos');
const INDEX_KEY = 'index';

export async function ensurePersistentStorage() {
  try {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      return granted;
    }
  } catch {
    return false;
  }
  return false;
}

export async function downloadOfflineVideo({ fileId, lessonId, videoUrl }) {
  ensurePersistentStorage();
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const size = blob.size;
  await set(`video:${fileId}`, blob, videoStore);

  const savedAt = Date.now();
  const index = await getVideoIndex();
  const entry = { fileId, lessonId, size, savedAt, type: blob.type || 'video/mp4' };
  const next = [...index.filter(e => e.fileId !== fileId), entry];
  await set(INDEX_KEY, next, videoStore);
  return entry;
}

export async function getOfflineVideo(fileId) {
  if (!fileId) return null;
  const blob = await get(`video:${fileId}`, videoStore);
  if (!blob) return null;
  const index = await getVideoIndex();
  const meta = index.find(e => e.fileId === fileId) || {};
  return { blob, ...meta };
}

export async function removeOfflineVideo(fileId) {
  await del(`video:${fileId}`, videoStore);
  const index = await getVideoIndex();
  await set(INDEX_KEY, index.filter(e => e.fileId !== fileId), videoStore);
}

export async function getVideoIndex() {
  return (await get(INDEX_KEY, videoStore)) || [];
}

export async function getOfflineVideoKeys() {
  return (await keys(videoStore)).filter(k => typeof k === 'string' && k.startsWith('video:'));
}

export function fileIdFromUrl(videoUrl) {
  if (!videoUrl) return null;
  const m = String(videoUrl).match(/\/api\/v1\/files\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}