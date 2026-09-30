/** Frame-rate caps offered in the viewer; AUTO follows the source up to 30. */
export const CCTV_FPS_CAPS = Object.freeze(['auto', '5', '10', '15']);
const AUTO_MAX_FPS = 30;
/** New source frames are counted over this window to measure the rate. */
const MEASURE_WINDOW_MS = 3000;

/** Renderer cap in frames per second for a CCTV_FPS_CAPS value. */
export function cctvFpsCapValue(cap) {
  const n = Number(cap);
  return Number.isFinite(n) && n > 0 ? n : AUTO_MAX_FPS;
}

/**
 * Paint a second surface from the projection decoder, bounded to 640px and a
 * renderer frame cap (15 fps unless `getMaxFps` says otherwise). The cap is a
 * limit on redraws, never a claim about the source; `getMeasuredFps` reports
 * how many genuinely new source frames arrived per second.
 */
export function createCctvVideoSurface(
  canvas,
  getVideo,
  {
    requestFrame = requestAnimationFrame,
    cancelFrame = cancelAnimationFrame,
    getMaxFps = () => 15,
  } = {},
) {
  const ctx = canvas.getContext('2d');
  let handle = 0;
  let stopped = false;
  let previous = null;
  let previousTime = -1;
  let paintedAt = -Infinity;
  let sampledTime = -1;
  let newFrameTimes = [];
  const paint = (now) => {
    if (stopped) return;
    const video = getVideo();
    if (video !== previous) {
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      previous = video;
      previousTime = -1;
      sampledTime = -1;
      newFrameTimes = [];
    }
    // Count distinct decoded frames whether or not the cap lets us draw them.
    if (video?.readyState >= 2 && video.currentTime !== sampledTime) {
      sampledTime = video.currentTime;
      newFrameTimes.push(now);
    }
    while (newFrameTimes.length && now - newFrameTimes[0] > MEASURE_WINDOW_MS)
      newFrameTimes.shift();
    if (
      ctx &&
      video?.readyState >= 2 &&
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      now - paintedAt >= 1000 / Math.max(1, getMaxFps()) &&
      video.currentTime !== previousTime
    ) {
      const width = Math.min(640, video.videoWidth);
      const height = Math.max(
        1,
        Math.round((width * video.videoHeight) / video.videoWidth),
      );
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      try {
        ctx.drawImage(video, 0, 0, width, height);
        previousTime = video.currentTime;
        paintedAt = now;
      } catch {
        /* A resolution/decode transition retries on the next frame. */
      }
    }
    handle = requestFrame(paint);
  };
  handle = requestFrame(paint);
  return {
    /** Genuinely new source frames per second, or null while measuring. */
    getMeasuredFps() {
      if (newFrameTimes.length < 3) return null;
      const span = newFrameTimes.at(-1) - newFrameTimes[0];
      return span > 0 ? ((newFrameTimes.length - 1) * 1000) / span : null;
    },
    stop() {
      stopped = true;
      cancelFrame(handle);
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
