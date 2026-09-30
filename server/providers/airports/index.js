/**
 * OurAirports ingest and airport routes.
 *
 * The four CSV files are downloaded once to data/cache/ourairports/ and
 * refreshed weekly (conditional requests with ETag), then served from memory.
 * They are never fetched per request.
 *
 *   GET /api/airports/nearest?lat&lon[&radiusNm&limit&types]
 *   GET /api/airports/search?q[&limit]
 *   GET /api/airports/navaids?lat&lon[&radiusNm&limit]
 *   GET /api/airports/{ICAO|IATA|ident}   (with runways and frequencies)
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { defaultSourceRoot } from '../common/source-root.js';
import { createBudget } from '../gateway/budget.js';
import { PROVIDER_CATALOG } from '../gateway/catalog.js';
import { gevUserAgent, providerRegistry } from '../gateway/registry.js';
import { airportSummary, buildAirportStore } from './store.js';

export const OURAIRPORTS_BASE =
  'https://davidmegginson.github.io/ourairports-data/';
export const OURAIRPORTS_FILES = Object.freeze({
  airports: 'airports.csv',
  runways: 'runways.csv',
  frequencies: 'airport-frequencies.csv',
  navaids: 'navaids.csv',
});
export const REFRESH_MS = 7 * 86_400_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export const AIRPORT_DATA_LOADING = 'AIRPORT DATA LOADING';
export const AIRPORT_DATA_UNAVAILABLE = 'AIRPORT DATA UNAVAILABLE';

/**
 * @param {{
 *   dataDir?: string,
 *   fetchImpl?: typeof fetch,
 *   fs?: Pick<typeof fsp, 'readFile'|'writeFile'|'stat'|'mkdir'|'rename'>,
 *   now?: () => number,
 *   registry?: typeof providerRegistry,
 *   env?: Record<string, string|undefined>,
 * }} [options]
 */
export function createAirportService({
  dataDir = path.join(defaultSourceRoot, 'data', 'cache', 'ourairports'),
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  fs = fsp,
  now = Date.now,
  registry = providerRegistry,
  env = process.env,
} = {}) {
  const budget = createBudget({ perMinute: 8, now });
  const provider = registry.register(PROVIDER_CATALOG.ourairports, { budget });
  let store = null;
  let loading = null;
  let lastError = null;

  async function fileAgeMs(file) {
    try {
      const info = await fs.stat(file);
      return now() - info.mtimeMs;
    } catch {
      return null;
    }
  }

  /** Download one file if missing or older than REFRESH_MS. */
  async function refreshFile(name) {
    const file = path.join(dataDir, name);
    const age = await fileAgeMs(file);
    if (age != null && age < REFRESH_MS) return;
    let etag = null;
    if (age != null) {
      etag = await fs.readFile(`${file}.etag`, 'utf8').catch(() => null);
    }
    try {
      await budget.run(name, async () => {
        const started = now();
        const response = await fetchImpl(`${OURAIRPORTS_BASE}${name}`, {
          headers: {
            'User-Agent': gevUserAgent(env),
            ...(etag ? { 'If-None-Match': etag.trim() } : {}),
          },
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });
        if (response.status === 304) {
          // Unchanged upstream: touch the file so the weekly clock restarts.
          const body = await fs.readFile(file, 'utf8');
          await fs.writeFile(file, body);
        } else if (!response.ok) {
          const error = new Error(`OurAirports HTTP ${response.status}`);
          /** @type {any} */ (error).status = response.status;
          throw error;
        } else {
          const body = await response.text();
          if (!body.includes(','))
            throw new Error('OurAirports returned an empty file');
          await fs.mkdir(dataDir, { recursive: true });
          const tmp = `${file}.tmp`;
          await fs.writeFile(tmp, body);
          await fs.rename(tmp, file);
          const tag = response.headers?.get?.('etag');
          if (tag) await fs.writeFile(`${file}.etag`, tag);
        }
        provider.success({ latencyMs: now() - started });
      });
    } catch (error) {
      provider.failure(error);
      // An older copy on disk is still correct enough to serve; no copy is fatal.
      if (age == null) throw error;
      console.warn(
        `[OurAirports] refresh of ${name} failed; keeping the copy from disk`,
      );
    }
  }

  async function load() {
    for (const name of Object.values(OURAIRPORTS_FILES))
      await refreshFile(name);
    const read = (name) => fs.readFile(path.join(dataDir, name), 'utf8');
    const [airports, runways, frequencies, navaids] = await Promise.all(
      Object.values(OURAIRPORTS_FILES).map(read),
    );
    store = buildAirportStore(
      { airports, runways, frequencies, navaids },
      { loadedAt: now() },
    );
    lastError = null;
    provider.success({});
    console.log(
      `[OurAirports] ${store.counts.airports} airports, ${store.counts.navaids} navaids loaded`,
    );
    return store;
  }

  /** Start (or join) loading; never throws. */
  function ensureLoaded() {
    if (store && now() - store.loadedAt < REFRESH_MS)
      return Promise.resolve(store);
    if (!loading) {
      loading = load()
        .catch((error) => {
          lastError = error;
          provider.failure(error);
          console.warn('[OurAirports] load failed:', error?.message || error);
          return store;
        })
        .finally(() => {
          loading = null;
        });
    }
    return loading;
  }

  function state() {
    return {
      ready: Boolean(store),
      loading: Boolean(loading),
      error: lastError ? AIRPORT_DATA_UNAVAILABLE : null,
    };
  }

  /**
   * Answer one /api/airports request.
   * @param {string} subpath Path after /api/airports, e.g. "/nearest".
   * @param {URLSearchParams} params
   * @returns {Promise<{ status: number, body: any }>}
   */
  async function handle(subpath, params) {
    if (!store) {
      const pending = ensureLoaded();
      // Wait briefly: a warm disk cache loads in well under a second.
      await Promise.race([
        pending,
        new Promise((resolve) => setTimeout(resolve, 3_000).unref?.()),
      ]);
    } else {
      ensureLoaded();
    }
    if (!store) {
      return lastError
        ? { status: 503, body: { error: AIRPORT_DATA_UNAVAILABLE } }
        : { status: 503, body: { error: AIRPORT_DATA_LOADING, loading: true } };
    }
    const number = (name, fallback, min, max) => {
      const raw = params.get(name);
      if (raw == null || raw === '') return fallback;
      const value = Number(raw);
      return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : NaN;
    };
    const route = subpath.replace(/^\/+|\/+$/g, '');
    const attribution = PROVIDER_CATALOG.ourairports.attribution;
    if (route === 'nearest' || route === 'navaids') {
      const lat = number('lat', NaN, -90, 90);
      const lon = number('lon', NaN, -180, 180);
      const radiusNm = number(
        'radiusNm',
        route === 'nearest' ? 60 : 40,
        1,
        250,
      );
      const limit = number('limit', 10, 1, 50);
      if (![lat, lon, radiusNm, limit].every(Number.isFinite)) {
        return { status: 400, body: { error: 'lat and lon required' } };
      }
      if (route === 'navaids') {
        return {
          status: 200,
          body: {
            navaids: store.nearestNavaids(lat, lon, { radiusNm, limit }),
            attribution,
          },
        };
      }
      const types = (params.get('types') || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const results = store.nearest(lat, lon, { radiusNm, limit, types });
      return {
        status: 200,
        body: {
          airports: results.map((r) => ({
            ...airportSummary(r.airport),
            distanceNm: Number(r.distanceNm.toFixed(2)),
            bearingDeg: Math.round(r.bearingDeg),
          })),
          attribution,
        },
      };
    }
    if (route === 'search') {
      const limit = number('limit', 10, 1, 25);
      const results = store.search(params.get('q') || '', { limit });
      return {
        status: 200,
        body: { airports: results.map((a) => airportSummary(a)), attribution },
      };
    }
    if (route && !route.includes('/')) {
      const airport = store.get(decodeURIComponent(route));
      return airport
        ? {
            status: 200,
            body: {
              airport: airportSummary(airport, { detail: true }),
              attribution,
            },
          }
        : { status: 404, body: { error: 'Airport not found' } };
    }
    return { status: 404, body: { error: 'Unknown airport route' } };
  }

  return { ensureLoaded, handle, state };
}

/** Vite plugin: mount /api/airports and start loading in the background. */
export function airportsProxy(options) {
  let service = null;
  const install = (server) => {
    service ||= createAirportService(options);
    // Warm in the background so the first lookup is instant.
    service.ensureLoaded();
    server.middlewares.use('/api/airports', async (req, res) => {
      let result;
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        result = await service.handle(url.pathname, url.searchParams);
      } catch (error) {
        console.error('[Airports]', error?.message || error);
        result = { status: 503, body: { error: AIRPORT_DATA_UNAVAILABLE } };
      }
      res.writeHead(result.status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(result.body));
    });
  };
  return {
    name: 'gev-airports',
    configureServer: install,
    configurePreviewServer: install,
  };
}
