/**
 * GET /api/traffic/incidents?lamin&lomin&lamax&lomax — traffic incidents in
 * the current view from TomTom Incident Details v5 (Rod's own key).
 *
 * TomTom's free tier allows 2,500 Incident Details requests per month
 * (docs.tomtom.com/pricing, checked 2026-09-30), so the budget here is 80 per
 * UTC day and each area is cached for 5 minutes. TomTom limits a request box
 * to 10,000 km²; larger views are asked to zoom in rather than tiled, which
 * would multiply requests. Without a key the route answers NEEDS_KEY.
 */

import {
  createBudget,
  UpstreamStatusError,
  parseRetryAfterMs,
} from '../gateway/budget.js';
import { PROVIDER_CATALOG } from '../gateway/catalog.js';
import { providerRegistry } from '../gateway/registry.js';
import { readResponseJsonCapped } from '../common/http.js';

export const INCIDENT_CACHE_MS = 5 * 60_000;
export const MAX_BOX_KM2 = 10_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const CACHE_MAX = 64;
const FIELDS =
  '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers,lastReportTime}}}';

/** TomTom iconCategory codes (Incident Details v5 docs). */
export const INCIDENT_CATEGORIES = Object.freeze({
  0: 'Unknown',
  1: 'Accident',
  2: 'Fog',
  3: 'Dangerous conditions',
  4: 'Rain',
  5: 'Ice',
  6: 'Jam',
  7: 'Lane closed',
  8: 'Road closed',
  9: 'Road works',
  10: 'Wind',
  11: 'Flooding',
  14: 'Broken-down vehicle',
});
const MAGNITUDES = Object.freeze({
  0: 'Unknown',
  1: 'Minor',
  2: 'Moderate',
  3: 'Major',
  4: 'Undefined',
});

/** Approximate area of a lat/lon box in km². */
export function boxAreaKm2({ lamin, lomin, lamax, lomax }) {
  const kmPerDegLat = 111.32;
  const midLat = ((lamin + lamax) / 2) * (Math.PI / 180);
  return (
    (lamax - lamin) *
    kmPerDegLat *
    ((lomax - lomin) * kmPerDegLat * Math.cos(midLat))
  );
}

/**
 * Normalise one TomTom incident feature. The anchor is the first point of
 * the geometry (where the incident starts).
 */
export function normalizeIncident(feature, receivedAt) {
  const p = feature?.properties || {};
  const geometry = feature?.geometry;
  const coords =
    geometry?.type === 'Point'
      ? [geometry.coordinates]
      : Array.isArray(geometry?.coordinates)
        ? geometry.coordinates
        : [];
  const valid = coords.filter(
    (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
  );
  if (!valid.length || !p.id) return null;
  const category = Number(p.iconCategory);
  return {
    id: String(p.id),
    providerId: 'tomtom-incidents',
    category: INCIDENT_CATEGORIES[category] || 'Unknown',
    categoryCode: Number.isFinite(category) ? category : 0,
    magnitude: MAGNITUDES[Number(p.magnitudeOfDelay)] || 'Unknown',
    description:
      (p.events || [])
        .map((e) => e?.description)
        .filter(Boolean)
        .join('; ') || null,
    from: p.from || null,
    to: p.to || null,
    roads: Array.isArray(p.roadNumbers) ? p.roadNumbers.slice(0, 6) : [],
    delaySec: Number.isFinite(p.delay) ? p.delay : null,
    lengthM: Number.isFinite(p.length) ? p.length : null,
    startTime: p.startTime || null,
    endTime: p.endTime || null,
    // The source's own last report time is the observation time when given.
    observedAt: Date.parse(p.lastReportTime || p.startTime || '') || null,
    receivedAt,
    estimated: false,
    lon: valid[0][0],
    lat: valid[0][1],
    path: valid.slice(0, 200),
  };
}

/**
 * @param {{ fetchImpl?: typeof fetch, env?: Record<string,string|undefined>, now?: () => number, registry?: typeof providerRegistry }} [options]
 */
export function createTrafficIncidentService({
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  env = process.env,
  now = Date.now,
  registry = providerRegistry,
} = {}) {
  const key = () => String(env.TOMTOM_API_KEY || '').trim();
  const budget = createBudget({ perMinute: 4, dailyCredits: 80, now });
  const provider = registry.register(PROVIDER_CATALOG['tomtom-incidents'], {
    budget,
    configured: () => Boolean(key()),
  });
  const cache = new Map();

  /** @param {URLSearchParams} params */
  async function handle(params) {
    const box = {
      lamin: Number(params.get('lamin')),
      lomin: Number(params.get('lomin')),
      lamax: Number(params.get('lamax')),
      lomax: Number(params.get('lomax')),
    };
    if (
      !Object.values(box).every(Number.isFinite) ||
      box.lamin >= box.lamax ||
      box.lomin >= box.lomax ||
      Math.abs(box.lamin) > 90 ||
      Math.abs(box.lamax) > 90 ||
      Math.abs(box.lomin) > 180 ||
      Math.abs(box.lomax) > 180
    ) {
      return {
        status: 400,
        body: { error: 'lamin, lomin, lamax, lomax required' },
      };
    }
    if (!registry.allowed('tomtom-incidents')) {
      return {
        status: 503,
        body: { error: 'TOMTOM NEEDS API KEY', status: 'NEEDS_KEY' },
      };
    }
    if (boxAreaKm2(box) > MAX_BOX_KM2) {
      return {
        status: 200,
        body: {
          incidents: [],
          zoomIn: true,
          message:
            'Zoom in to see traffic incidents (view is larger than 10,000 km²)',
        },
      };
    }
    // Round to 0.05° so small pans share one cached request.
    const q = (v, dir) =>
      (dir < 0 ? Math.floor(v * 20) : Math.ceil(v * 20)) / 20;
    const req = {
      lamin: q(box.lamin, -1),
      lomin: q(box.lomin, -1),
      lamax: q(box.lamax, 1),
      lomax: q(box.lomax, 1),
    };
    const cacheKey = `${req.lomin},${req.lamin},${req.lomax},${req.lamax}`;
    const cached = cache.get(cacheKey);
    if (cached && now() - cached.fetchedAt < INCIDENT_CACHE_MS) {
      return {
        status: 200,
        body: {
          incidents: cached.incidents,
          ageMs: now() - cached.fetchedAt,
          stale: false,
        },
      };
    }
    try {
      const incidents = await budget.run(cacheKey, async () => {
        const started = now();
        const url =
          `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${encodeURIComponent(key())}` +
          `&bbox=${cacheKey}&fields=${encodeURIComponent(FIELDS)}&language=en-US&timeValidityFilter=present`;
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
          response.body?.cancel?.().catch?.(() => {});
          throw new UpstreamStatusError(response.status, {
            retryAfterMs: parseRetryAfterMs(
              response.headers?.get?.('retry-after'),
              now(),
            ),
          });
        }
        const body = await readResponseJsonCapped(response, MAX_RESPONSE_BYTES);
        const receivedAt = now();
        const list = (Array.isArray(body?.incidents) ? body.incidents : [])
          .map((f) => normalizeIncident(f, receivedAt))
          .filter(Boolean);
        provider.success({ latencyMs: now() - started });
        return list;
      });
      cache.delete(cacheKey);
      cache.set(cacheKey, { incidents, fetchedAt: now() });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return { status: 200, body: { incidents, ageMs: 0, stale: false } };
    } catch (error) {
      provider.failure(error);
      if (cached) {
        provider.stale();
        return {
          status: 200,
          body: {
            incidents: cached.incidents,
            ageMs: now() - cached.fetchedAt,
            stale: true,
          },
        };
      }
      // Only a real daily-budget or rate-limit refusal is reported as such;
      // a backoff after an upstream error is just "unavailable".
      const limited =
        error?.reason === 'daily-budget' ||
        error?.reason === 'rate-limited' ||
        error?.status === 429;
      return {
        status: 503,
        body: {
          error: limited
            ? 'Traffic incident budget used up for today'
            : 'TRAFFIC INCIDENTS TEMPORARILY UNAVAILABLE',
        },
      };
    }
  }

  return { handle };
}

/** Vite plugin: mount /api/traffic/incidents on dev and preview servers. */
export function trafficIncidentsProxy(options) {
  let service = null;
  const install = (server) => {
    service ||= createTrafficIncidentService(options);
    server.middlewares.use('/api/traffic/incidents', async (req, res) => {
      let result;
      try {
        result = await service.handle(
          new URL(req.url || '/', 'http://localhost').searchParams,
        );
      } catch {
        result = {
          status: 503,
          body: { error: 'TRAFFIC INCIDENTS TEMPORARILY UNAVAILABLE' },
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
    name: 'gev-traffic-incidents',
    configureServer: install,
    configurePreviewServer: install,
  };
}
