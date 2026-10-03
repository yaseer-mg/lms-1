// ── Build freshness guard ───────────────────────────────────────────
// A returning client can hold a stale service-worker precache while the
// network already serves a newer build. Mixing chunks from two builds makes
// the module graph throw (e.g. "Cannot access 'x' before initialization").
// On boot we ask the network (bypassing the precache) which bundle the
// server currently serves and, if it isn't ours, drop the stale precache
// and reload so the tab runs a single consistent build.

const RUNNING_BUNDLE = (() => {
  const src = [...document.querySelectorAll('script[src]')]
    .map((el) => el.src)
    .find((s) => /\/assets\/index-[^/]+\.js$/.test(s));
  return src ? src.split('/').pop() : null;
})();

let checked = false;
const ATTEMPT_KEY = '__build_refresh_attempt__';

// Removes only the workbox precache; downloaded lessons/media
// (lmsdata-cache) and the API cache are preserved.
export async function purgeStalePrecache() {
  try {
    if (!('caches' in window)) return;
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('workbox-precache')).map((k) => caches.delete(k))
    );
  } catch { /* ignore */ }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs || []).map((r) => r.unregister()));
  } catch { /* ignore */ }
}

export async function reloadWithFreshBuild() {
  await purgeStalePrecache();
  window.location.reload();
}

export async function ensureFreshBuild() {
  if (checked || !RUNNING_BUNDLE || !navigator.onLine) return;
  checked = true;
  try {
    // Never loop: if we already refreshed once in this tab, keep running
    // whatever we have instead of reloading again.
    if (sessionStorage.getItem(ATTEMPT_KEY) === '1') return;

    // Query string keeps this off the precached '/index.html' route,
    // so it always hits the network.
    const res = await fetch(`/index.html?fresh=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const html = await res.text();
    const match = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
    if (!match || match[0].split('/').pop() === RUNNING_BUNDLE) {
      sessionStorage.removeItem(ATTEMPT_KEY);
      return;
    }
    sessionStorage.setItem(ATTEMPT_KEY, '1');
    await purgeStalePrecache();
    window.location.reload();
  } catch {
    // Offline / blocked request — keep running the build we already have.
  }
}