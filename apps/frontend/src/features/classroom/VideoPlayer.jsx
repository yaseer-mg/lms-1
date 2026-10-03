import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import apiClient from '@/shared/api/client';
import { offlineMutation } from '../../shared/offline/mutations';
import {
  downloadOfflineVideo,
  getOfflineVideo,
  removeOfflineVideo,
  fileIdFromUrl,
} from '../../shared/offline/videos';

// ─────────────────────────────────────────────
//  VideoPlayer
//
//  Props:
//    lessonId       string  — current lesson UUID
//    courseId       string  — parent course UUID
//    videoUrl       string  — /api/v1/files/:fileId (auth-gated)
//    durationSecs   number  — total lesson duration
//    onComplete     fn      — called when lesson is marked complete
//    onNext         fn      — called when student clicks "Next Lesson"
// ─────────────────────────────────────────────

const HEARTBEAT_INTERVAL = 10_000;   // 10 seconds

export default function VideoPlayer({
  lessonId, courseId, videoUrl, durationSecs = 0, onComplete, onNext,
  videoSource = 'upload', youtubeId,
}) {
  const videoRef       = useRef(null);
  const heartbeatTimer = useRef(null);
  const watchedRanges  = useRef([]);   // [[start, end], ...] — for dedup
  const segmentStart   = useRef(null); // when current play segment started

  const [isCompleted,   setIsCompleted]   = useState(false);
  const [progress,      setProgress]      = useState(0);    // 0-100 %
  const [resumePos,     setResumePos]     = useState(0);    // seconds
  const [bookmarks,     setBookmarks]     = useState([]);
  const [showBookmarkInput, setShowBookmarkInput] = useState(false);
  const [bookmarkLabel,     setBookmarkLabel]     = useState('');
  const [loading,       setLoading]       = useState(true);

  const [offlineMeta,   setOfflineMeta]   = useState(null);
  const [blobUrl,       setBlobUrl]       = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [isOnline,      setIsOnline]      = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  const fileId = useMemo(() => fileIdFromUrl(videoUrl), [videoUrl]);
  const isYouTube  = videoSource === 'youtube' && !!youtubeId;
  const embedUrl   = isYouTube
    ? `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&playsinline=1&enablejsapi=1${
        typeof window !== 'undefined' ? `&origin=${encodeURIComponent(window.location.origin)}` : ''
      }`
    : null;
  const offlineMissing = !isOnline && offlineMeta === null;

  // ── Online/offline status ─────────────────────
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // ── Load offline copy (if any) ───────────────
  useEffect(() => {
    if (!fileId) return;
    getOfflineVideo(fileId)
      .then(meta => { if (meta) setOfflineMeta(meta); })
      .catch(() => {});
  }, [fileId]);

  // ── Object URL from persisted blob when offline ─
  useEffect(() => {
    let url = null;
    if (!isOnline && offlineMeta?.blob) {
      url = URL.createObjectURL(offlineMeta.blob);
      setBlobUrl(url);
    } else {
      setBlobUrl(null);
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [isOnline, offlineMeta]);

  useEffect(() => {
    if (offlineMissing) setLoading(false);
  }, [offlineMissing]);

  const handleDownload = async () => {
    if (saving || !fileId) return;
    setSaving(true);
    try {
      await downloadOfflineVideo({ fileId, lessonId, videoUrl });
      const meta = await getOfflineVideo(fileId);
      setOfflineMeta(meta);
      toast.success('Video saved for offline viewing');
    } catch (err) {
      toast.error('Download failed. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveOffline = async () => {
    if (!fileId) return;
    try {
      await removeOfflineVideo(fileId);
      setOfflineMeta(null);
      toast.success('Offline video removed');
    } catch (err) {
      toast.error('Could not remove offline video');
    }
  };

  // ── Load saved position on mount ─────────────
  useEffect(() => {
    let cancelled = false;
    async function loadProgress() {
      try {
        const [progressRes, bookmarkRes] = await Promise.all([
          apiClient.get(`/progress/lessons/${lessonId}?courseId=${courseId}`),
          apiClient.get(`/progress/lessons/${lessonId}/bookmarks`),
        ]);
        if (cancelled) return;

        const saved = progressRes.data.data.progress;
        setIsCompleted(saved.is_completed);
        setResumePos(saved.watch_position_secs || 0);
        setBookmarks(bookmarkRes.data.data.bookmarks || []);

        // Restore video position
        if (videoRef.current && saved.watch_position_secs > 10) {
          videoRef.current.currentTime = saved.watch_position_secs;
        }
      } catch (err) {
        console.error('[VideoPlayer] Failed to load progress:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadProgress();
    return () => { cancelled = true; };
  }, [lessonId, courseId]);

  // ── Compute total watched seconds from ranges ─
  const getTotalWatched = useCallback(() => {
    const merged = [];
    const sorted = [...watchedRanges.current].sort((a, b) => a[0] - b[0]);
    for (const [s, e] of sorted) {
      if (merged.length === 0 || merged[merged.length - 1][1] < s) {
        merged.push([s, e]);
      } else {
        merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
      }
    }
    return merged.reduce((acc, [s, e]) => acc + (e - s), 0);
  }, []);

  // ── Heartbeat sender ──────────────────────────
  const sendHeartbeat = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.paused || video.ended) return;

    // Extend current segment
    if (segmentStart.current !== null) {
      const now = video.currentTime;
      watchedRanges.current.push([segmentStart.current, now]);
      segmentStart.current = now;
    }

    const totalWatched = getTotalWatched();
    const pos          = Math.floor(video.currentTime);

    try {
      const res = await apiClient.post('/progress/heartbeat', {
        lessonId,
        courseId,
        positionSecs: pos,
        watchedSecs:  Math.floor(totalWatched),
      });

      const data = res.data.data;
      if (durationSecs > 0) {
        setProgress(Math.min(100, Math.round((pos / durationSecs) * 100)));
      }
      if (data.isCompleted && !isCompleted) {
        setIsCompleted(true);
        onComplete?.();
      }
    } catch (err) {
      console.warn('[VideoPlayer] Heartbeat failed:', err.message);
    }
  }, [lessonId, courseId, durationSecs, isCompleted, getTotalWatched, onComplete]);

  // ── Start / stop heartbeat on play / pause ───
  const startHeartbeat = useCallback(() => {
    segmentStart.current = videoRef.current?.currentTime || 0;
    heartbeatTimer.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
  }, [sendHeartbeat]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
    // Close the current segment
    const video = videoRef.current;
    if (segmentStart.current !== null && video) {
      watchedRanges.current.push([segmentStart.current, video.currentTime]);
      segmentStart.current = null;
    }
    sendHeartbeat(); // final ping on pause
  }, [sendHeartbeat]);

  // ── Cleanup on unmount / lesson change ───────
  useEffect(() => {
    return () => {
      stopHeartbeat();
    };
  }, [lessonId, stopHeartbeat]);

  // ── Offline-aware mutations ──────────────────
  // Declared before handleEnded: the useCallback dependency array below
  // reads it during render, so it must already be initialised.
  const completeMut = useMutation(offlineMutation('video-toggle-complete', {
    onError: () => {
      setIsCompleted(true);
      onComplete?.();
    },
  }));

  const addBookmarkMut = useMutation(offlineMutation('video-bookmark-add'));

  const removeBookmarkMut = useMutation(offlineMutation('video-bookmark-delete'));

  // ── Video ended ───────────────────────────────
  const handleEnded = useCallback(async () => {
    stopHeartbeat();

    // Best-effort final heartbeat to record the full watch
    if (!isYouTube && durationSecs > 0) {
      apiClient.post('/progress/heartbeat', {
        lessonId, courseId,
        positionSecs: durationSecs,
        watchedSecs:  durationSecs,
      }).catch((err) => { console.warn('[VideoPlayer] Final heartbeat failed:', err.message); });
    }

    setIsCompleted(true);
    setProgress(100);
    onComplete?.();

    // Record completion — offline-aware (queued + synced when back online)
    completeMut.mutate(
      { lessonId, courseId, complete: true },
      {
        onSuccess: (res) => {
          if (res?.data?.data?.is_completed) onComplete?.();
        },
      }
    );
  }, [lessonId, courseId, durationSecs, stopHeartbeat, isYouTube, completeMut, onComplete]);

  // ── Detect YouTube playback end (IFrame API postMessage) ──
  useEffect(() => {
    if (!isYouTube) return undefined;
    const onMessage = (evt) => {
      let parsed;
      try { parsed = JSON.parse(evt.data); } catch { return; }
      if (parsed && parsed.event === 'infoDelivery' && parsed.info && parsed.info.playerState === 0) {
        handleEnded();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isYouTube, handleEnded]);

  // ── Bookmarks ─────────────────────────────────
  const addBookmark = () => {
    const pos = Math.floor(videoRef.current?.currentTime || 0);
    addBookmarkMut.mutate(
      { lessonId, courseId, positionSecs: pos, label: bookmarkLabel || undefined },
      {
        onSuccess: (res) => {
          setBookmarks(prev =>
            [...prev, res.data.data.bookmark].sort((a, b) => a.position_secs - b.position_secs)
          );
          setBookmarkLabel('');
          setShowBookmarkInput(false);
        },
      }
    );
  };

  const removeBookmark = (bookmarkId) => {
    setBookmarks(prev => prev.filter(b => b.id !== bookmarkId));
    removeBookmarkMut.mutate({ lessonId, bookmarkId });
  };

  const jumpToBookmark = (positionSecs) => {
    if (videoRef.current) videoRef.current.currentTime = positionSecs;
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = String(Math.floor(secs % 60)).padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="flex flex-col bg-gray-900 rounded-xl overflow-hidden">

      {/* ── Video element ── */}
      {isYouTube ? (
        <div className="relative w-full bg-black" style={{ aspectRatio: '16/9' }}>
          {!isOnline && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
              <div className="text-center px-6">
                <p className="text-gray-200 font-medium mb-1">Video not available offline</p>
                <p className="text-gray-500 text-sm">This lesson streams from YouTube. Reconnect to watch it.</p>
              </div>
            </div>
          )}
          {isOnline && (
            <iframe
              src={embedUrl}
              title="YouTube video player"
              className="w-full h-full"
              allowFullScreen
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
          {isCompleted && (
            <div className="absolute top-3 right-3 bg-green-600 text-white text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1">
              <span>✓</span> Completed
            </div>
          )}
        </div>
      ) : (
        <div className="relative w-full bg-black" style={{ aspectRatio: '16/9' }}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {offlineMissing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
              <div className="text-center px-6">
                <p className="text-gray-200 font-medium mb-1">Video not available offline</p>
                <p className="text-gray-500 text-sm">Reconnect to download it for offline viewing.</p>
              </div>
            </div>
          )}

          <video
            ref={videoRef}
            className="w-full h-full"
            src={offlineMissing ? undefined : (!isOnline && blobUrl ? blobUrl : videoUrl)}
            controls
            controlsList="nodownload"
            onPlay={startHeartbeat}
            onPause={stopHeartbeat}
            onEnded={handleEnded}
            onLoadedMetadata={() => {
              setLoading(false);
              if (resumePos > 10 && videoRef.current) {
                videoRef.current.currentTime = resumePos;
              }
            }}
          />

          {/* Completion badge overlay */}
          {isCompleted && (
            <div className="absolute top-3 right-3 bg-green-600 text-white text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1">
              <span>✓</span> Completed
            </div>
          )}
        </div>
      )}

      {/* ── Progress bar ── */}
      {durationSecs > 0 && (
        <div className="h-1 bg-gray-700 w-full">
          <div
            className="h-full bg-blue-500 transition-all duration-1000"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* ── Controls bar ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 gap-3 flex-wrap">

        {/* Bookmark button (uploaded videos only) */}
        {!isYouTube && (
          <button
            onClick={() => setShowBookmarkInput(v => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
          >
            🔖 Bookmark
          </button>
        )}

        {/* Download for offline (uploaded videos only) */}
        {!isYouTube && (
          <button
            onClick={offlineMeta ? handleRemoveOffline : handleDownload}
            disabled={!isOnline || saving}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              offlineMeta
                ? 'bg-green-800/60 hover:bg-green-700/60 text-green-200'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
            }`}
          >
            {saving
              ? '⏳ Downloading…'
              : offlineMeta
                ? '✓ Offline Saved'
                : isOnline
                  ? '⬇ Download for Offline'
                  : '⬇ Offline'}
          </button>
        )}

        {/* Next lesson */}
        {onNext && (
          <button
            onClick={onNext}
            className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white transition-colors font-medium"
          >
            Next Lesson →
          </button>
        )}
      </div>

      {/* ── Bookmark input (uploaded videos only) ── */}
      {!isYouTube && showBookmarkInput && (
        <div className="flex gap-2 px-4 py-3 bg-gray-800 border-t border-gray-700">
          <input
            type="text"
            value={bookmarkLabel}
            onChange={e => setBookmarkLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addBookmark()}
            placeholder={`Bookmark at ${formatTime(videoRef.current?.currentTime || 0)}`}
            className="flex-1 bg-gray-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <button
            onClick={addBookmark}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg"
          >
            Save
          </button>
        </div>
      )}

      {/* ── Bookmark list (uploaded videos only) ── */}
      {!isYouTube && bookmarks.length > 0 && (
        <div className="px-4 py-3 bg-gray-800 border-t border-gray-700">
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">
            Your Bookmarks
          </p>
          <div className="flex flex-col gap-1">
            {bookmarks.map(bm => (
              <div key={bm.id} className="flex items-center gap-3 group">
                <button
                  onClick={() => jumpToBookmark(bm.position_secs)}
                  className="text-blue-400 hover:text-blue-300 text-xs font-mono min-w-[40px]"
                >
                  {formatTime(bm.position_secs)}
                </button>
                <span className="text-gray-300 text-sm flex-1 truncate">{bm.label}</span>
                <button
                  onClick={() => removeBookmark(bm.id)}
                  className="text-gray-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}