'use strict';

// Extracts an 11-char YouTube video ID from common URL formats:
//   https://youtube.com/watch?v=ID
//   https://youtu.be/ID
//   https://youtube.com/shorts/ID
//   https://youtube.com/embed/ID
//   https://youtube.com/live/ID
const YOUTUBE_ID_RE = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

function parseYoutubeId(url) {
  if (!url) return null;
  const match = String(url).trim().match(YOUTUBE_ID_RE);
  return match ? match[1] : null;
}

module.exports = { parseYoutubeId };