/**
 * Measured still-image cadence per camera (GODS-EYE-VIEW-SPEC v2, 4.9).
 *
 * Every frame the proxy fetches is fingerprinted; the time between real
 * content changes is the camera's measured cadence. If the image changed at
 * EVERY check, the source may update faster than we look, so the answer says
 * that rather than reporting our own polling rate as the camera's.
 */

import { createHash } from 'node:crypto';

const MAX_CAMERAS = 4000;
const MAX_SAMPLES = 12;

/** Median of a non-empty numeric list. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param {{ now?: () => number }} [options]
 */
export function createFrameCadenceTracker({ now = Date.now } = {}) {
  /** @type {Map<string, { hash: string|null, checks: number[], changes: number[], unchangedChecks: number }>} */
  const cameras = new Map();

  /**
   * Record one fetched frame (or a 304 "not modified").
   * @param {string} cameraId
   * @param {Buffer|null} body Frame bytes, or null for "not modified".
   * @returns {ReturnType<typeof describe>}
   */
  function observe(cameraId, body) {
    const t = now();
    let entry = cameras.get(cameraId);
    if (!entry) {
      if (cameras.size >= MAX_CAMERAS)
        cameras.delete(cameras.keys().next().value);
      entry = { hash: null, checks: [], changes: [], unchangedChecks: 0 };
      cameras.set(cameraId, entry);
    }
    entry.checks.push(t);
    if (entry.checks.length > MAX_SAMPLES) entry.checks.shift();
    const hash = body
      ? createHash('sha1').update(body).digest('hex')
      : entry.hash;
    if (hash && hash !== entry.hash) {
      if (entry.hash !== null) {
        entry.changes.push(t);
        if (entry.changes.length > MAX_SAMPLES) entry.changes.shift();
      }
      entry.hash = hash;
    } else if (entry.hash !== null) {
      entry.unchangedChecks += 1;
    }
    return describe(cameraId);
  }

  /** Measured cadence for a camera, or null before two changes are seen. */
  function describe(cameraId) {
    const entry = cameras.get(cameraId);
    if (!entry) return null;
    const checkGaps = entry.checks
      .slice(1)
      .map((t, i) => (t - entry.checks[i]) / 1000);
    const changeGaps = entry.changes
      .slice(1)
      .map((t, i) => (t - entry.changes[i]) / 1000);
    const checkIntervalSec = checkGaps.length
      ? Math.round(median(checkGaps))
      : null;
    if (!changeGaps.length) {
      return {
        kind: 'still',
        intervalSec: null,
        checkIntervalSec,
        everyCheck: false,
        samples: entry.changes.length,
      };
    }
    return {
      kind: 'still',
      intervalSec: Math.round(median(changeGaps)),
      checkIntervalSec,
      // Never saw an unchanged frame: the source is at least this fast.
      everyCheck: entry.unchangedChecks === 0,
      samples: changeGaps.length,
    };
  }

  return { observe, describe };
}

/**
 * The line the camera panel shows, e.g.
 * "Source: still image, new frame every ~30 s (measured)".
 * @param {ReturnType<ReturnType<typeof createFrameCadenceTracker>['describe']>} cadence
 */
export function describeStillCadence(cadence) {
  if (!cadence || cadence.intervalSec == null)
    return 'Source: still image, measuring how often it changes…';
  const every = formatSeconds(cadence.intervalSec);
  return cadence.everyCheck
    ? `Source: still image, changed at every check (~${every}); it may update faster`
    : `Source: still image, new frame every ~${every} (measured)`;
}

function formatSeconds(sec) {
  return sec < 90 ? `${sec} s` : `${Math.round(sec / 60)} min`;
}
