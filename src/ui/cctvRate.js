/**
 * The camera viewer's "Source: …" line (GODS-EYE-VIEW-SPEC v2, 4.9): what the
 * source actually delivers, measured, never the viewer's own frame cap.
 */

const formatSeconds = (sec) =>
  sec < 90 ? `${sec} s` : `${Math.round(sec / 60)} min`;

/**
 * @param {{ isVideo?: boolean, feedType?: string|null, measuredFps?: number|null, cadence?: { intervalSec: number|null, everyCheck?: boolean }|null }} input
 */
export function cctvSourceRateLine({
  isVideo = false,
  feedType = null,
  measuredFps = null,
  cadence = null,
} = {}) {
  if (isVideo) {
    return Number.isFinite(measuredFps)
      ? `Source: ${String(feedType || 'video').toUpperCase()} video ~${Math.round(measuredFps)} fps (measured)`
      : `Source: ${String(feedType || 'video').toUpperCase()} video, measuring frame rate…`;
  }
  if (feedType === 'mjpeg')
    return 'Source: MJPEG stream (frame rate cannot be measured in the browser)';
  if (!cadence || cadence.intervalSec == null)
    return 'Source: still image, measuring how often it changes…';
  const every = formatSeconds(cadence.intervalSec);
  return cadence.everyCheck
    ? `Source: still image, changed at every check (~${every}); it may update faster`
    : `Source: still image, new frame every ~${every} (measured)`;
}

export const CCTV_FPS_STORAGE_KEY = 'godsEyeView.v2.cctvFpsCap';

/** The viewer's saved frame cap; AUTO when storage is unavailable. */
export function readCctvFpsCap(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(CCTV_FPS_STORAGE_KEY);
    return ['auto', '5', '10', '15'].includes(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function writeCctvFpsCap(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(CCTV_FPS_STORAGE_KEY, value);
  } catch {
    // Remembered for this page only.
  }
}
