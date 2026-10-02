/**
 * Emergency facilities from OpenStreetMap via the Overpass API
 * (GODS-EYE-VIEW-SPEC v2, "Emergency facilities and POIs").
 *
 *   GET /api/facilities?lamin&lomin&lamax&lomax
 *
 * The view is split into 0.5° tiles and each tile is one fixed query for:
 * hospitals, fire stations, police, ambulance stations and shelters. Tiles are
 * cached on disk for 7 days and fetched one at a time, so panning never sends
 * a query (Overpass usage policy: roughly 10,000 requests and 1 GB per day for
 * the public instance, https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).
 *
 * Upstream: OVERPASS_UPSTREAMS when set, otherwise the public instances
 * below. Set FACILITIES_PUBLIC_OVERPASS=0 to
 * never use the public instance.
 */

import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { createBudget } from '../gateway/budget.js';
import { PROVIDER_CATALOG } from '../gateway/catalog.js';
import { providerRegistry } from '../gateway/registry.js';
import { resolveOverpassUpstreams } from '../overpass/constants.js';
import { fetchOverpassPayload } from '../overpass/transport.js';

export const FACILITY_TILE_DEG = 0.5;
export const FACILITY_MAX_TILES = 6;
export const FACILITY_CACHE_MS = 7 * 86_400_000;
/**
 * Public instances from the OSM wiki list (checked 2026-09-30), tried in
 * order: FOSSGIS main (about 10,000 queries/day casual, "divide by 100 for
 * regular applications"), then VK Maps ("no requests limitations").
 */
export const PUBLIC_OVERPASS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]);
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/** Shelter kinds that are not emergency shelters (bus stops, picnic roofs…). */
const NON_EMERGENCY_SHELTERS = new Set([
  'public_transport',
  'picnic_shelter',
  'sun_shelter',
  'changing_rooms',
  'field_shelter',
  'lean_to',
  'rock_shelter',
  'weather_shelter',
  'gazebo',
]);

export const FACILITY_KINDS = Object.freeze({
  hospital: 'Hospital',
  fire_station: 'Fire station',
  police: 'Police',
  ambulance_station: 'Ambulance station',
  shelter: 'Shelter',
});

/** Tiles (south-west corners) covering a view box. */
export function facilityTiles(box, size = FACILITY_TILE_DEG) {
  const tiles = [];
  const s0 = Math.floor(box.lamin / size) * size;
  const w0 = Math.floor(box.lomin / size) * size;
  for (let s = s0; s < box.lamax; s += size)
    for (let w = w0; w < box.lomax; w += size)
      tiles.push({
        s: +s.toFixed(4),
        w: +w.toFixed(4),
        n: +(s + size).toFixed(4),
        e: +(w + size).toFixed(4),
      });
  return tiles;
}

/** The fixed Overpass QL query for one tile. */
export function facilityQuery({ s, w, n, e }) {
  const bb = `(${s},${w},${n},${e})`;
  return [
    '[out:json][timeout:25];',
    '(',
    `nwr["amenity"~"^(hospital|fire_station|police)$"]${bb};`,
    `nwr["emergency"="ambulance_station"]${bb};`,
    `nwr["amenity"="shelter"]${bb};`,
    `nwr["social_facility"="shelter"]${bb};`,
    ');',
    'out center tags;',
  ].join('');
}

/** One OSM element → a facility, or null when it is not one. */
export function normalizeFacility(el) {
  const t = el?.tags || {};
  let kind = null;
  if (['hospital', 'fire_station', 'police'].includes(t.amenity))
    kind = t.amenity;
  else if (t.emergency === 'ambulance_station') kind = 'ambulance_station';
  else if (t.social_facility === 'shelter') kind = 'shelter';
  else if (
    t.amenity === 'shelter' &&
    !NON_EMERGENCY_SHELTERS.has(t.shelter_type || '') &&
    t.shelter_type
  )
    kind = 'shelter';
  if (!kind) return null;
  const lat = Number(el.lat ?? el.center?.lat);
  const lon = Number(el.lon ?? el.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const address = [t['addr:housenumber'], t['addr:street'], t['addr:city']]
    .filter(Boolean)
    .join(' ');
  return {
    id: `${el.type}/${el.id}`,
    kind,
    kindLabel: FACILITY_KINDS[kind],
    name: t.name || null,
    lat,
    lon,
    operator: t.operator || null,
    phone: t.phone || t['contact:phone'] || null,
    website: t.website || t['contact:website'] || null,
    address: address || null,
    emergencyDept: kind === 'hospital' ? t.emergency || null : null,
    shelterType:
      kind === 'shelter'
        ? t.shelter_type || t['social_facility:for'] || null
        : null,
    osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  };
}

/**
 * @param {{ env?: Record<string,string|undefined>, now?: () => number, cacheDir?: string, fetchPayload?: typeof fetchOverpassPayload, registry?: typeof providerRegistry }} [options]
 */
export function createFacilityService({
  env = process.env,
  now = Date.now,
  cacheDir = path.join(process.cwd(), '.gev-cache', 'facilities'),
  fetchPayload = fetchOverpassPayload,
  registry = providerRegistry,
} = {}) {
  const endpoints = () => {
    const own = resolveOverpassUpstreams();
    if (own.length) return own;
    return env.FACILITIES_PUBLIC_OVERPASS === '0' ? [] : [...PUBLIC_OVERPASS];
  };
  const budget = createBudget({ perMinute: 6, dailyCredits: 100, now });
  const provider = registry.register(PROVIDER_CATALOG['osm-overpass'], {
    budget,
    configured: () => endpoints().length > 0,
  });
  /** @type {Map<string, { facilities: any[], fetchedAt: number }>} */
  const memory = new Map();
  /** @type {Promise<any>} */
  let queue = Promise.resolve();

  const keyOf = (tile) => `${tile.s}_${tile.w}`;
  const fileOf = (tile) => path.join(cacheDir, `${keyOf(tile)}.json`);

  async function readDisk(tile) {
    try {
      const entry = JSON.parse(await fsp.readFile(fileOf(tile), 'utf8'));
      return Array.isArray(entry?.facilities) ? entry : null;
    } catch {
      return null;
    }
  }

  async function fetchTile(tile) {
    return budget.run(`tile:${keyOf(tile)}`, async () => {
      const started = now();
      const body = new URLSearchParams({
        data: facilityQuery(tile),
      }).toString();
      const payload = await fetchPayload(body, MAX_RESPONSE_BYTES, {
        endpoints: endpoints(),
      });
      if (payload.status < 200 || payload.status >= 300) {
        const error = new Error(`Overpass answered ${payload.status}`);
        Object.assign(error, {
          status: payload.status,
          retryAfterMs: payload.retryAfterMs,
        });
        throw error;
      }
      const elements = JSON.parse(payload.body).elements || [];
      const facilities = elements.map(normalizeFacility).filter(Boolean);
      const entry = { facilities, fetchedAt: now() };
      provider.success({ latencyMs: now() - started });
      await fsp.mkdir(cacheDir, { recursive: true }).catch(() => {});
      await fsp.writeFile(fileOf(tile), JSON.stringify(entry)).catch(() => {});
      return entry;
    });
  }

  /** Cached tile, else one queued fetch; a stale disk copy beats nothing. */
  async function tileEntry(tile) {
    const key = keyOf(tile);
    let entry = memory.get(key) || (await readDisk(tile));
    if (entry && now() - entry.fetchedAt < FACILITY_CACHE_MS) {
      memory.set(key, entry);
      return { entry, stale: false };
    }
    const fetched = (queue = queue.then(
      () => fetchTile(tile),
      () => fetchTile(tile),
    ));
    try {
      entry = await fetched;
      memory.set(key, entry);
      while (memory.size > 400) memory.delete(memory.keys().next().value);
      return { entry, stale: false };
    } catch (error) {
      provider.failure(error);
      if (entry) {
        provider.stale();
        return { entry, stale: true };
      }
      return { entry: null, stale: false };
    }
  }

  /** @param {URLSearchParams} params */
  async function handle(params) {
    const n = (k) => Number(params.get(k));
    const box = {
      lamin: n('lamin'),
      lomin: n('lomin'),
      lamax: n('lamax'),
      lomax: n('lomax'),
    };
    if (
      !Object.values(box).every(Number.isFinite) ||
      box.lamin >= box.lamax ||
      box.lomin >= box.lomax ||
      Math.abs(box.lamin) > 90 ||
      Math.abs(box.lamax) > 90
    )
      return {
        status: 400,
        body: { error: 'lamin, lomin, lamax, lomax required' },
      };
    if (!endpoints().length)
      return {
        status: 503,
        body: {
          error:
            'OpenStreetMap facilities are switched off (FACILITIES_PUBLIC_OVERPASS=0 and no OVERPASS_UPSTREAMS)',
          code: 'NOT_CONFIGURED',
        },
      };
    const tiles = facilityTiles(box);
    if (tiles.length > FACILITY_MAX_TILES)
      return {
        status: 200,
        body: {
          facilities: [],
          tooWide: true,
          message: 'Zoom in to load emergency facilities',
        },
      };
    const facilities = [];
    const seen = new Set();
    let missing = 0;
    let stale = false;
    let oldest = Infinity;
    for (const tile of tiles) {
      const { entry, stale: s } = await tileEntry(tile);
      if (!entry) {
        missing += 1;
        continue;
      }
      stale ||= s;
      oldest = Math.min(oldest, entry.fetchedAt);
      for (const f of entry.facilities)
        if (
          !seen.has(f.id) &&
          f.lat >= box.lamin &&
          f.lat <= box.lamax &&
          f.lon >= box.lomin &&
          f.lon <= box.lomax
        ) {
          seen.add(f.id);
          facilities.push(f);
        }
    }
    if (missing === tiles.length)
      return {
        status: 503,
        body: { error: 'FACILITY DATA TEMPORARILY UNAVAILABLE' },
      };
    return {
      status: 200,
      body: {
        facilities,
        missingTiles: missing,
        stale,
        dataAgeMs: Number.isFinite(oldest) ? now() - oldest : null,
        attribution: PROVIDER_CATALOG['osm-overpass'].attribution,
      },
    };
  }

  return { handle };
}

/** Vite plugin: mount /api/facilities. */
export function facilitiesProxy(options) {
  let service = null;
  const install = (server) => {
    service ||= createFacilityService(options);
    server.middlewares.use('/api/facilities', async (req, res) => {
      let result;
      try {
        result = await service.handle(
          new URL(req.url || '/', 'http://localhost').searchParams,
        );
      } catch {
        result = {
          status: 503,
          body: { error: 'FACILITY DATA TEMPORARILY UNAVAILABLE' },
        };
      }
      res.writeHead(result.status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(result.body));
    });
  };
  return {
    name: 'gev-facilities',
    configureServer: install,
    configurePreviewServer: install,
  };
}
