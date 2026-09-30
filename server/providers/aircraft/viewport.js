/**
 * Pure helpers for the viewport aircraft route: tiling a view into adsb.lol
 * point queries, pricing an OpenSky bounding box, and merging tile results.
 *
 * adsb.lol point queries are limited to a 250 nm radius (api.adsb.lol/docs,
 * checked 2026-09-29), so a view is covered by circles around fixed global
 * cells. Fixed cells (not view-relative ones) let every browser tab and
 * every pan share the same cached tiles.
 */

import { normalizeAdsbLolAircraftState } from '../../../src/data/adsbLolFallback.js';

/** Cell height in degrees of latitude (4° ≈ 240 nm). */
export const TILE_BAND_DEG = 4;
/** Circle radius that covers a whole cell, with margin (half-diagonal ≈ 170 nm). */
export const TILE_RADIUS_NM = 180;
/**
 * More cells than this is a continental view: use one OpenSky box instead.
 * adsb.lol answers bursts with HTTP 429 (observed 2026-09-29), so tiles are
 * few and fetched one after another.
 */
export const MAX_ADSBLOL_TILES = 4;
/** Views are padded so aircraft just off-screen are already loaded. */
export const VIEW_PAD_FRACTION = 0.1;

const clampLat = (lat) => Math.max(-90, Math.min(90, lat));

/** Normalise a longitude into [-180, 180). */
export function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Parse `lamin, lomin, lamax, lomax` (and a `lat, lon` fallback) from query
 * parameters. A view that crosses the antimeridian has lomin > lomax.
 * @param {URLSearchParams} params
 * @returns {{ lamin: number, lomin: number, lamax: number, lomax: number } | null}
 */
export function parseViewBox(params) {
  const read = (name) => {
    const raw = params.get(name);
    if (raw == null || raw === '') return NaN;
    return Number(raw);
  };
  const box = {
    lamin: read('lamin'),
    lomin: read('lomin'),
    lamax: read('lamax'),
    lomax: read('lomax'),
  };
  const valid =
    Object.values(box).every(Number.isFinite) &&
    box.lamin >= -90 &&
    box.lamax <= 90 &&
    box.lamin < box.lamax &&
    Math.abs(box.lomin) <= 180 &&
    Math.abs(box.lomax) <= 180;
  if (valid) return box;
  const lat = read('lat');
  const lon = read('lon');
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    return null;
  // No view rectangle (camera looking at sky): one cell around the anchor.
  return {
    lamin: clampLat(lat - 1),
    lamax: clampLat(lat + 1),
    lomin: wrapLon(lon - 1),
    lomax: wrapLon(lon + 1),
  };
}

/** Longitude span of a box in degrees, honouring antimeridian wrap. */
export function lonSpan(box) {
  const span = box.lomax - box.lomin;
  return span >= 0 ? span : span + 360;
}

/**
 * Pad a box by VIEW_PAD_FRACTION of its size on every side.
 * @param {{ lamin: number, lomin: number, lamax: number, lomax: number }} box
 */
export function padViewBox(box) {
  const dLat = (box.lamax - box.lamin) * VIEW_PAD_FRACTION;
  const span = lonSpan(box);
  const dLon = span * VIEW_PAD_FRACTION;
  if (span + 2 * dLon >= 360) {
    return {
      lamin: clampLat(box.lamin - dLat),
      lamax: clampLat(box.lamax + dLat),
      lomin: -180,
      lomax: 180,
    };
  }
  return {
    lamin: clampLat(box.lamin - dLat),
    lamax: clampLat(box.lamax + dLat),
    lomin: wrapLon(box.lomin - dLon),
    lomax: wrapLon(box.lomax + dLon),
  };
}

/** Number of longitude cells in a latitude band, sized at its equator-ward edge. */
function cellsInBand(bandIndex) {
  const south = -90 + bandIndex * TILE_BAND_DEG;
  const north = south + TILE_BAND_DEG;
  const equatorward =
    south <= 0 && north >= 0 ? 0 : Math.min(Math.abs(south), Math.abs(north));
  const width = 360 * Math.cos((equatorward * Math.PI) / 180);
  return Math.max(1, Math.ceil(width / TILE_BAND_DEG));
}

/** Longitude ranges of a box, split at the antimeridian. */
function lonRanges(box) {
  if (box.lomin <= box.lomax) return [[box.lomin, box.lomax]];
  return [
    [box.lomin, 180],
    [-180, box.lomax],
  ];
}

/**
 * Global cells a box touches, each with the circle query that covers it.
 * Returns `null` when more than `maxTiles` would be needed.
 * @param {{ lamin: number, lomin: number, lamax: number, lomax: number }} box
 * @param {{ maxTiles?: number }} [options]
 * @returns {Array<{ key: string, lat: number, lon: number, radiusNm: number }> | null}
 */
export function planAdsbLolTiles(box, { maxTiles = MAX_ADSBLOL_TILES } = {}) {
  const tiles = new Map();
  const bandCount = Math.ceil(180 / TILE_BAND_DEG);
  const firstBand = Math.max(0, Math.floor((box.lamin + 90) / TILE_BAND_DEG));
  const lastBand = Math.min(
    bandCount - 1,
    Math.floor((box.lamax + 90 - 1e-9) / TILE_BAND_DEG),
  );
  for (let band = firstBand; band <= lastBand; band += 1) {
    const cells = cellsInBand(band);
    const step = 360 / cells;
    const centerLat = -90 + (band + 0.5) * TILE_BAND_DEG;
    for (const [west, east] of lonRanges(box)) {
      const firstCell = Math.max(0, Math.floor((west + 180) / step));
      const lastCell = Math.min(
        cells - 1,
        Math.floor((east + 180 - 1e-9) / step),
      );
      for (let cell = firstCell; cell <= lastCell; cell += 1) {
        const key = `${band}:${cell}`;
        if (tiles.has(key)) continue;
        tiles.set(key, {
          key,
          lat: Number(centerLat.toFixed(4)),
          lon: Number((-180 + (cell + 0.5) * step).toFixed(4)),
          radiusNm: TILE_RADIUS_NM,
        });
        if (tiles.size > maxTiles) return null;
      }
    }
  }
  return [...tiles.values()];
}

/** adsb.lol's documented maximum point-query radius. */
export const ADSBLOL_MAX_RADIUS_NM = 250;
const NM_PER_RAD = 3440.065;

/** Great-circle distance in nautical miles. */
export function distanceNm(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * NM_PER_RAD * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * One adsb.lol circle covering the whole box, or `null` when the box needs a
 * radius above the 250 nm limit. The centre snaps to a 0.2° grid and the
 * radius to 25 nm steps so small pans reuse the cached answer.
 * @param {{ lamin: number, lomin: number, lamax: number, lomax: number }} box
 * @returns {{ key: string, lat: number, lon: number, radiusNm: number } | null}
 */
export function planCoverCircle(box) {
  const span = lonSpan(box);
  if (span > 60) return null;
  const snap = (value) => Math.round(value * 5) / 5;
  const lat = snap((box.lamin + box.lamax) / 2);
  const lon = snap(wrapLon(box.lomin + span / 2));
  let farthest = 0;
  for (const cornerLat of [box.lamin, box.lamax]) {
    for (const cornerLon of [box.lomin, box.lomax]) {
      farthest = Math.max(farthest, distanceNm(lat, lon, cornerLat, cornerLon));
    }
  }
  // Mid-edges matter at high latitude, where a box edge bows away from the centre.
  farthest = Math.max(
    farthest,
    distanceNm(lat, lon, box.lamin, lon),
    distanceNm(lat, lon, box.lamax, lon),
  );
  const radiusNm = Math.max(25, Math.ceil(farthest / 25) * 25);
  if (radiusNm > ADSBLOL_MAX_RADIUS_NM) return null;
  return {
    key: `c:${lat.toFixed(1)}:${lon.toFixed(1)}:${radiusNm}`,
    lat: Number(lat.toFixed(1)),
    lon: Number(lon.toFixed(1)),
    radiusNm,
  };
}

/** Area of a box in square degrees (the unit OpenSky prices by). */
export function boxAreaSqDeg(box) {
  return (box.lamax - box.lamin) * lonSpan(box);
}

/**
 * OpenSky /states/all credit cost for a box, per the REST docs (checked
 * 2026-09-29): ≤25 sq° 1, ≤100 sq° 2, ≤400 sq° 3, larger or global 4.
 * @param {{ lamin: number, lomin: number, lamax: number, lomax: number } | null} box
 */
export function openSkyCreditCost(box) {
  if (!box) return 4;
  const area = boxAreaSqDeg(box);
  if (area <= 25) return 1;
  if (area <= 100) return 2;
  if (area <= 400) return 3;
  return 4;
}

/**
 * Round a box outwards to whole degrees so nearby views share one cached
 * OpenSky request. Boxes that cross the antimeridian, or that would cost the
 * global price anyway, become `null` (a global request).
 * @param {{ lamin: number, lomin: number, lamax: number, lomax: number }} box
 */
export function openSkyRequestBox(box) {
  if (box.lomin > box.lomax) return null;
  const rounded = {
    lamin: Math.max(-90, Math.floor(box.lamin)),
    lamax: Math.min(90, Math.ceil(box.lamax)),
    lomin: Math.max(-180, Math.floor(box.lomin)),
    lomax: Math.min(180, Math.ceil(box.lomax)),
  };
  return openSkyCreditCost(rounded) === 4 ? null : rounded;
}

/**
 * Merge adsb.lol tile payloads into one OpenSky-shaped state list, keeping
 * the most recent position per ICAO hex. Rows carry three extra columns after
 * OpenSky's 18: [18] registration, [19] ICAO type code, [20] emergency.
 * @param {Array<{ payload: any }>} tiles
 * @returns {{ time: number, states: any[][] }}
 */
export function mergeAdsbLolTiles(tiles) {
  /** @type {Map<string, any[]>} */
  const byHex = new Map();
  let oldestNow = Infinity;
  for (const { payload } of tiles) {
    const rawNow = Number(payload?.now);
    const nowSeconds = Number.isFinite(rawNow)
      ? Math.floor(rawNow > 10_000_000_000 ? rawNow / 1000 : rawNow)
      : Math.floor(Date.now() / 1000);
    oldestNow = Math.min(oldestNow, nowSeconds);
    for (const aircraft of Array.isArray(payload?.ac) ? payload.ac : []) {
      const state = normalizeAdsbLolAircraftState(aircraft, nowSeconds);
      if (!state) continue;
      state[18] = cleanField(aircraft?.r);
      state[19] = cleanField(aircraft?.t);
      state[20] = cleanField(aircraft?.emergency);
      const previous = byHex.get(state[0]);
      if (!previous || (state[3] ?? 0) > (previous[3] ?? 0)) {
        byHex.set(state[0], state);
      }
    }
  }
  return {
    time: Number.isFinite(oldestNow)
      ? oldestNow
      : Math.floor(Date.now() / 1000),
    states: [...byHex.values()],
  };
}

function cleanField(value) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 16) : null;
}
