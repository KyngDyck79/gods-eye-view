/**
 * AviationWeather.gov METAR and TAF, from the official cache files.
 *
 * Per the AWC Data API terms (checked 2026-09-29): a custom User-Agent, at
 * most 100 requests per minute, at most 400 results per request. The gateway
 * downloads the whole-world cache files instead of querying per station:
 *   /data/cache/metars.cache.csv.gz  (updated every minute; refreshed here ≤ every 90 s)
 *   /data/cache/tafs.cache.xml.gz    (updated every 10 minutes; refreshed here ≤ every 10 min)
 * Files are fetched only while someone is asking, never on a timer.
 *
 *   GET /api/avwx/metar?ids=KMYR,KCRE
 *   GET /api/avwx/taf?ids=KMYR
 *   GET /api/avwx/nearest?lat&lon[&radiusNm&limit]   (METAR stations)
 */

import { gunzipSync } from 'node:zlib';
import { createBudget, UpstreamStatusError } from '../gateway/budget.js';
import { PROVIDER_CATALOG } from '../gateway/catalog.js';
import { gevUserAgent, providerRegistry } from '../gateway/registry.js';
import { distanceNm, bearingDeg } from '../airports/store.js';
import {
  METAR_STALE_MS,
  decodeMetarCsv,
  decodeTafXml,
  describeMetar,
} from './decode.js';

const BASE = 'https://aviationweather.gov/data/cache/';
export const METAR_REFRESH_MS = 90_000;
export const TAF_REFRESH_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_IDS = 20;

export const WEATHER_UNAVAILABLE = 'WEATHER DATA TEMPORARILY UNAVAILABLE';

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   registry?: typeof providerRegistry,
 *   env?: Record<string, string|undefined>,
 * }} [options]
 */
export function createAviationWeatherService({
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  now = Date.now,
  registry = providerRegistry,
  env = process.env,
} = {}) {
  // Far under AWC's 100/min: two files, each at most once per refresh period.
  const budget = createBudget({ perMinute: 6, now });
  const provider = registry.register(PROVIDER_CATALOG.awc, { budget });

  /** @type {Record<'metar'|'taf', { data: Map<string, any>|null, fetchedAt: number, etag: string|null, pending: Promise<void>|null }>} */
  const files = {
    metar: { data: null, fetchedAt: 0, etag: null, pending: null },
    taf: { data: null, fetchedAt: 0, etag: null, pending: null },
  };
  const spec = {
    metar: {
      name: 'metars.cache.csv.gz',
      refreshMs: METAR_REFRESH_MS,
      decode: decodeMetarCsv,
    },
    taf: {
      name: 'tafs.cache.xml.gz',
      refreshMs: TAF_REFRESH_MS,
      decode: decodeTafXml,
    },
  };

  async function download(kind) {
    const file = files[kind];
    const { name, decode } = spec[kind];
    await budget.run(name, async () => {
      const started = now();
      const response = await fetchImpl(`${BASE}${name}`, {
        headers: {
          'User-Agent': gevUserAgent(env),
          ...(file.etag ? { 'If-None-Match': file.etag } : {}),
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.status === 304) {
        file.fetchedAt = now();
        provider.success({ latencyMs: now() - started });
        return;
      }
      if (!response.ok) throw new UpstreamStatusError(response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      // The files are gzip; some transports hand back already-inflated bytes.
      const text = (
        bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
      ).toString('utf8');
      const data = decode(text);
      if (!data.size) throw new Error(`AWC ${name} decoded to no reports`);
      file.data = data;
      file.fetchedAt = now();
      file.etag = response.headers?.get?.('etag') || null;
      provider.success({ latencyMs: now() - started });
    });
  }

  /** Refresh a file when due; never throws. Keeps serving the last good copy. */
  function refresh(kind) {
    const file = files[kind];
    if (file.data && now() - file.fetchedAt < spec[kind].refreshMs)
      return Promise.resolve();
    if (!file.pending) {
      file.pending = download(kind)
        .catch((error) => {
          provider.failure(error);
          if (file.data) provider.stale();
        })
        .finally(() => {
          file.pending = null;
        });
    }
    return file.pending;
  }

  const withAge = (metar) => {
    const ageMs = Math.max(0, now() - metar.observedAt);
    return {
      ...metar,
      ageMs,
      stale: ageMs > METAR_STALE_MS,
      summary: describeMetar(metar),
    };
  };

  function parseIds(params) {
    return (params.get('ids') || '')
      .split(',')
      .map((id) => id.trim().toUpperCase())
      .filter((id) => /^[A-Z0-9]{3,4}$/.test(id))
      .slice(0, MAX_IDS);
  }

  /**
   * @param {string} subpath
   * @param {URLSearchParams} params
   * @returns {Promise<{ status: number, body: any }>}
   */
  async function handle(subpath, params) {
    const route = subpath.replace(/^\/+|\/+$/g, '');
    const attribution = PROVIDER_CATALOG.awc.attribution;
    if (route === 'metar' || route === 'taf') {
      const ids = parseIds(params);
      if (!ids.length)
        return { status: 400, body: { error: 'ids required, e.g. ids=KMYR' } };
      await refresh(route);
      const data = files[route].data;
      if (!data) return { status: 503, body: { error: WEATHER_UNAVAILABLE } };
      const found = ids.map((id) => data.get(id)).filter(Boolean);
      return {
        status: 200,
        body: {
          [route === 'metar' ? 'metars' : 'tafs']:
            route === 'metar' ? found.map(withAge) : found,
          missing: ids.filter((id) => !data.has(id)),
          fileAgeMs: now() - files[route].fetchedAt,
          attribution,
        },
      };
    }
    if (route === 'nearest') {
      const lat = Number(params.get('lat'));
      const lon = Number(params.get('lon'));
      const radiusNm = Math.min(
        250,
        Math.max(1, Number(params.get('radiusNm')) || 60),
      );
      const limit = Math.min(20, Math.max(1, Number(params.get('limit')) || 5));
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      ) {
        return { status: 400, body: { error: 'lat and lon required' } };
      }
      await refresh('metar');
      const data = files.metar.data;
      if (!data) return { status: 503, body: { error: WEATHER_UNAVAILABLE } };
      const near = [];
      for (const metar of data.values()) {
        if (!Number.isFinite(metar.lat) || !Number.isFinite(metar.lon))
          continue;
        const d = distanceNm(lat, lon, metar.lat, metar.lon);
        if (d <= radiusNm) near.push({ metar, d });
      }
      near.sort((a, b) => a.d - b.d);
      return {
        status: 200,
        body: {
          metars: near.slice(0, limit).map(({ metar, d }) => ({
            ...withAge(metar),
            distanceNm: Math.round(d * 10) / 10,
            bearingDeg: Math.round(bearingDeg(lat, lon, metar.lat, metar.lon)),
          })),
          attribution,
        },
      };
    }
    return { status: 404, body: { error: 'Unknown aviation weather route' } };
  }

  return { handle, refresh };
}

/** Vite plugin: mount /api/avwx on dev and preview servers. */
export function aviationWeatherProxy(options) {
  let service = null;
  const install = (server) => {
    service ||= createAviationWeatherService(options);
    server.middlewares.use('/api/avwx', async (req, res) => {
      let result;
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        result = await service.handle(url.pathname, url.searchParams);
      } catch (error) {
        console.error('[AviationWeather]', error?.message || error);
        result = { status: 503, body: { error: WEATHER_UNAVAILABLE } };
      }
      res.writeHead(result.status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(result.body));
    });
  };
  return {
    name: 'gev-aviation-weather',
    configureServer: install,
    configurePreviewServer: install,
  };
}
