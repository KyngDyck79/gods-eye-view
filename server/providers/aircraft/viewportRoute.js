/**
 * GET /api/aircraft — live aircraft for the browser's current view.
 *
 * Source order (GODS-EYE-VIEW-SPEC v2, Part 3):
 *   1. adsb.lol point queries, one per fixed global cell the view touches;
 *   2. OpenSky /states/all for the view's box, when the view is too large to
 *      tile or adsb.lol is unavailable.
 *
 * Both run under a request budget, so no number of browser tabs can push
 * either provider past its limit: tabs share cached tiles and in-flight
 * requests. Data older than STALE_MAX_MS is never served; after that the
 * route answers 503 and the map shows no aircraft rather than old ones.
 *
 * The response keeps the OpenSky state-vector shape the Flights layer
 * already consumes, with columns 18–20 carrying registration, type code and
 * emergency status when adsb.lol supplies them.
 */

import { readResponseJsonCapped } from '../common/http.js';
import {
  createBudget,
  UpstreamStatusError,
  parseRetryAfterMs,
} from '../gateway/budget.js';
import { PROVIDER_CATALOG } from '../gateway/catalog.js';
import { gevUserAgent, providerRegistry } from '../gateway/registry.js';
import { getOpenSkyToken } from './opensky.js';
import {
  mergeAdsbLolTiles,
  openSkyCreditCost,
  openSkyRequestBox,
  padViewBox,
  parseViewBox,
  planAdsbLolTiles,
  planCoverCircle,
} from './viewport.js';

/** adsb.lol tile freshness: the spec's 5–10 s live cadence. */
const TILE_TTL_MS = 10_000;
/** Never serve aircraft data older than this (spec 2.3: remove after 5 min). */
export const STALE_MAX_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
/** Gap between consecutive adsb.lol requests; bursts are answered with 429. */
const ADSBLOL_SPACING_MS = 1_100;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const TILE_CACHE_MAX = 400;
const OPENSKY_CACHE_MAX = 64;
const DAY_MS = 86_400_000;

export const AIRCRAFT_UNAVAILABLE = 'AIRCRAFT DATA TEMPORARILY UNAVAILABLE';

function openSkyConfigured(env) {
  return Boolean(env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET);
}

/**
 * Spread the remaining OpenSky credits evenly over the rest of the UTC day,
 * so a map left open all day never runs the account dry by mid-afternoon.
 * @param {{ creditsRemaining: number|null }} budget
 * @param {number} cost Credits per request for this box.
 * @param {number} now
 * @param {number} floorMs Shortest allowed refresh (OpenSky's own resolution).
 */
export function openSkyRefreshMs(budget, cost, now, floorMs) {
  const remaining = budget?.creditsRemaining;
  if (!Number.isFinite(remaining) || remaining <= 0) return floorMs;
  const msLeftToday = DAY_MS - (now % DAY_MS);
  return Math.max(floorMs, Math.ceil(msLeftToday / (remaining / cost)));
}

/** Insert into a Map used as an LRU, evicting the oldest entries. */
function remember(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   env?: Record<string, string|undefined>,
 *   now?: () => number,
 *   registry?: ReturnType<typeof import('../gateway/registry.js').createProviderRegistry>,
 *   getToken?: () => Promise<string|null>,
 *   sleep?: (ms: number) => Promise<void>,
 * }} [options]
 */
export function createAircraftViewportHandler({
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  env = process.env,
  now = Date.now,
  registry = providerRegistry,
  getToken = getOpenSkyToken,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const adsbBudget = createBudget({ perMinute: 30, now });
  const openskyAuthed = openSkyConfigured(env);
  const openskyBudget = createBudget({
    // Stay well under OpenSky's own limits; the daily ledger is the real cap.
    perMinute: 6,
    dailyCredits: openskyAuthed ? 4000 : 400,
    now,
  });
  const adsb = registry.register(PROVIDER_CATALOG.adsblol, {
    budget: adsbBudget,
  });
  const opensky = registry.register(PROVIDER_CATALOG.opensky, {
    budget: openskyBudget,
  });
  const openskyFloorMs = openskyAuthed ? 10_000 : 15_000;

  /** @type {Map<string, { payload: any, fetchedAt: number }>} */
  const tileCache = new Map();
  /** @type {Map<string, { body: any, fetchedAt: number }>} */
  const openskyCache = new Map();

  async function getJson(url, headers) {
    const started = now();
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': gevUserAgent(env),
        ...headers,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      response.body?.cancel?.().catch?.(() => {});
      throw new UpstreamStatusError(response.status, {
        retryAfterMs:
          parseRetryAfterMs(response.headers?.get?.('retry-after'), now()) ??
          (Number(response.headers?.get?.('x-rate-limit-retry-after-seconds')) *
            1000 ||
            null),
      });
    }
    const body = await readResponseJsonCapped(response, MAX_RESPONSE_BYTES);
    return { body, latencyMs: now() - started, headers: response.headers };
  }

  /** One adsb.lol tile: fresh from cache, fetched, or stale within the limit. */
  async function loadTile(tile) {
    const cached = tileCache.get(tile.key);
    const t = now();
    if (cached && t - cached.fetchedAt < TILE_TTL_MS)
      return { ...cached, stale: false };
    try {
      const { body, latencyMs } = await adsbBudget.run(tile.key, () =>
        getJson(
          `https://api.adsb.lol/v2/point/${tile.lat}/${tile.lon}/${tile.radiusNm}`,
        ),
      );
      const entry = { payload: body, fetchedAt: now() };
      remember(tileCache, tile.key, entry, TILE_CACHE_MAX);
      adsb.success({ latencyMs, observedAt: Number(body?.now) || null });
      return { ...entry, stale: false };
    } catch (error) {
      adsb.failure(error);
      if (cached && now() - cached.fetchedAt < STALE_MAX_MS) {
        adsb.stale();
        return { ...cached, stale: true };
      }
      return null;
    }
  }

  async function fromAdsbLol(tiles) {
    // One request at a time, spaced: adsb.lol rate-limits bursts.
    const results = [];
    for (const tile of tiles) {
      const cached = tileCache.get(tile.key);
      const fresh = cached && now() - cached.fetchedAt < TILE_TTL_MS;
      if (results.length && !fresh) await sleep(ADSBLOL_SPACING_MS);
      results.push(await loadTile(tile));
    }
    const loaded = results.filter(Boolean);
    if (!loaded.length) return null;
    const merged = mergeAdsbLolTiles(loaded);
    return {
      ...merged,
      source: 'ADSB.lol',
      providerId: 'adsblol',
      coverage: `viewport · ${loaded.length} of ${tiles.length} area${tiles.length === 1 ? '' : 's'}`,
      complete: loaded.length === tiles.length,
      stale: loaded.some((r) => r.stale),
      fetchedAt: Math.min(...loaded.map((r) => r.fetchedAt)),
    };
  }

  async function fromOpenSky(box) {
    const requestBox = openSkyRequestBox(box);
    const cost = openSkyCreditCost(requestBox);
    const key = requestBox
      ? `${requestBox.lamin},${requestBox.lomin},${requestBox.lamax},${requestBox.lomax}`
      : 'global';
    const cached = openskyCache.get(key);
    const t = now();
    const refreshMs = openSkyRefreshMs(
      openskyBudget.snapshot(),
      cost,
      t,
      openskyFloorMs,
    );
    const describe = (entry, stale) => ({
      time: Number(entry.body?.time) || Math.floor(entry.fetchedAt / 1000),
      states: Array.isArray(entry.body?.states) ? entry.body.states : [],
      source: 'OpenSky Network',
      providerId: 'opensky',
      coverage: requestBox ? 'viewport box' : 'worldwide',
      complete: true,
      stale,
      fetchedAt: entry.fetchedAt,
    });
    if (cached && t - cached.fetchedAt < refreshMs)
      return describe(cached, false);
    try {
      const query = requestBox
        ? `?lamin=${requestBox.lamin}&lomin=${requestBox.lomin}&lamax=${requestBox.lamax}&lomax=${requestBox.lomax}&extended=1`
        : '?extended=1';
      const { body, latencyMs, headers } = await openskyBudget.run(
        key,
        async () => {
          const token = openskyAuthed ? await getToken() : null;
          if (openskyAuthed && !token)
            opensky.failure('OAuth token unavailable; using anonymous access');
          return getJson(
            `https://opensky-network.org/api/states/all${query}`,
            token ? { Authorization: `Bearer ${token}` } : {},
          );
        },
        { cost },
      );
      const remaining = Number(headers?.get?.('x-rate-limit-remaining'));
      if (Number.isFinite(remaining))
        openskyBudget.recordSuccess({ remainingCredits: remaining });
      const entry = { body, fetchedAt: now() };
      remember(openskyCache, key, entry, OPENSKY_CACHE_MAX);
      opensky.success({
        latencyMs,
        observedAt: Number(body?.time) * 1000 || null,
      });
      return describe(entry, false);
    } catch (error) {
      opensky.failure(error);
      if (cached && now() - cached.fetchedAt < STALE_MAX_MS) {
        opensky.stale();
        return describe(cached, true);
      }
      return null;
    }
  }

  /**
   * @param {URLSearchParams} params
   * @returns {Promise<{ status: number, body: any }>}
   */
  async function handle(params) {
    const box = parseViewBox(params);
    if (!box) {
      return {
        status: 400,
        body: { error: 'lamin, lomin, lamax, lomax (or lat, lon) required' },
      };
    }
    const padded = padViewBox(box);
    const circle = planCoverCircle(padded);
    const tiles = circle ? [circle] : planAdsbLolTiles(padded);
    let result = null;
    if (tiles && registry.allowed('adsblol')) result = await fromAdsbLol(tiles);
    if (!result && registry.allowed('opensky'))
      result = await fromOpenSky(padded);
    if (!result) {
      return { status: 503, body: { error: AIRCRAFT_UNAVAILABLE } };
    }
    const { fetchedAt, ...payload } = result;
    return {
      status: 200,
      body: { ...payload, ageMs: Math.max(0, now() - fetchedAt) },
    };
  }

  return { handle, budgets: { adsblol: adsbBudget, opensky: openskyBudget } };
}

/** Vite plugin: mount /api/aircraft on the dev and preview servers. */
export function aircraftViewportProxy(options) {
  let handler = null;
  const install = (server) => {
    handler ||= createAircraftViewportHandler(options);
    server.middlewares.use('/api/aircraft', async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' });
        res.end();
        return;
      }
      let result;
      try {
        const url = new URL(req.url || '', 'http://localhost');
        result = await handler.handle(url.searchParams);
      } catch (error) {
        console.error('[Aircraft]', error?.message || error);
        result = { status: 503, body: { error: AIRCRAFT_UNAVAILABLE } };
      }
      res.writeHead(result.status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(result.body?.source
          ? { 'X-Flight-Source': result.body.source }
          : {}),
        // Header values must be ASCII; the JSON body keeps the full text.
        ...(result.body?.coverage
          ? {
              'X-Flight-Coverage': String(result.body.coverage).replace(
                /[^\x20-\x7e]/g,
                '-',
              ),
            }
          : {}),
      });
      res.end(JSON.stringify(result.body));
    });
  };
  return {
    name: 'gev-aircraft-viewport',
    configureServer: install,
    configurePreviewServer: install,
  };
}
