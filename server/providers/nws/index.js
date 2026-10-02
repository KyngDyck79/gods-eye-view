/**
 * National Weather Service active alerts (api.weather.gov), US only.
 *
 * Per the NWS API docs (checked 2026-09-30): a User-Agent identifying the
 * application with contact information is required; the rate limit is not
 * published. The gateway downloads the national active-alert collection at
 * most every 90 s, only while someone is asking, and answers view queries
 * from memory.
 *
 *   GET /api/nws/alerts?lamin&lomin&lamax&lomax   — polygon alerts in view
 *   GET /api/nws/alerts?lat&lon                    — every alert covering a point,
 *                                                     zone-based ones included
 *
 * View queries return polygon alerts only (zone-only alerts are counted but
 * not drawn: placing them needs zone shapes). Point queries use NWS's own
 * `point=` lookup, which resolves zones, cached per 0.05° for 90 s.
 */

import {
  createBudget,
  UpstreamStatusError,
  parseRetryAfterMs,
} from '../gateway/budget.js';
import { PROVIDER_CATALOG } from '../gateway/catalog.js';
import { gevUserAgent, providerRegistry } from '../gateway/registry.js';
import { readResponseJsonCapped } from '../common/http.js';

export const NWS_REFRESH_MS = 90_000;
/** Show a banner past this age; alerts are never silently kept (spec 2.3). */
export const NWS_STALE_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 40 * 1024 * 1024;

/** Official NWS hazard map colors (weather.gov/help-map, checked 2026-09-30). */
export const NWS_COLORS = Object.freeze({
  'Tornado Warning': '#FF0000',
  'Severe Thunderstorm Warning': '#FFA500',
  'Flash Flood Warning': '#8B0000',
  'Flood Warning': '#00FF00',
  'Tornado Watch': '#FFFF00',
  'Severe Thunderstorm Watch': '#DB7093',
  'Flash Flood Watch': '#2E8B57',
  'Hurricane Warning': '#DC143C',
  'Hurricane Watch': '#FF00FF',
  'Tropical Storm Warning': '#B22222',
  'Tropical Storm Watch': '#F08080',
  'Storm Surge Warning': '#B524F7',
  'Winter Storm Warning': '#FF69B4',
  'Blizzard Warning': '#FF4500',
  'Ice Storm Warning': '#8B008B',
  'Winter Weather Advisory': '#7B68EE',
  'Special Marine Warning': '#FFA500',
  'Extreme Wind Warning': '#FF8C00',
  'Heat Advisory': '#FF7F50',
  'Extreme Heat Warning': '#C71585',
  'Dense Fog Advisory': '#708090',
  'High Wind Warning': '#DAA520',
  'Coastal Flood Warning': '#228B22',
  'Rip Current Statement': '#40E0D0',
  'Special Weather Statement': '#FFE4B5',
});
const DEFAULT_COLOR = '#C0C0C0';

const SEVERITY_RANK = Object.freeze({
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
});

/** Outer rings of a GeoJSON Polygon / MultiPolygon as [[lon, lat], …]. */
function outerRings(geometry) {
  if (geometry?.type === 'Polygon')
    return [geometry.coordinates?.[0]].filter(Boolean);
  if (geometry?.type === 'MultiPolygon')
    return (geometry.coordinates || []).map((p) => p?.[0]).filter(Boolean);
  return [];
}

/** Normalise one NWS alert feature. */
export function normalizeNwsAlert(feature, receivedAt) {
  const p = feature?.properties || {};
  if (!p.id && !feature?.id) return null;
  const rings = outerRings(feature.geometry)
    .map((ring) =>
      ring.filter(
        (c) =>
          Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
      ),
    )
    .filter((ring) => ring.length >= 3);
  let bbox = null;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      bbox = bbox
        ? [
            Math.min(bbox[0], lon),
            Math.min(bbox[1], lat),
            Math.max(bbox[2], lon),
            Math.max(bbox[3], lat),
          ]
        : [lon, lat, lon, lat];
    }
  }
  return {
    id: String(p.id || feature.id),
    providerId: 'nws',
    event: p.event || 'Alert',
    severity: p.severity || 'Unknown',
    severityRank: SEVERITY_RANK[p.severity] ?? 0,
    urgency: p.urgency || null,
    certainty: p.certainty || null,
    headline: p.headline || null,
    description: p.description || null,
    instruction: p.instruction || null,
    areaDesc: p.areaDesc || null,
    sender: p.senderName || null,
    sent: p.sent || null,
    effective: p.effective || null,
    expires: p.expires || p.ends || null,
    observedAt: Date.parse(p.sent || '') || null,
    receivedAt,
    estimated: false,
    color: NWS_COLORS[p.event] || DEFAULT_COLOR,
    rings,
    bbox,
  };
}

/** Ray-casting point-in-polygon on [lon, lat] rings. */
export function pointInRings(lon, lat, rings) {
  return rings.some((ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (
        yi > lat !== yj > lat &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      )
        inside = !inside;
    }
    return inside;
  });
}

const overlaps = (a, box) =>
  a &&
  a[0] <= box.lomax &&
  a[2] >= box.lomin &&
  a[1] <= box.lamax &&
  a[3] >= box.lamin;

/**
 * @param {{ fetchImpl?: typeof fetch, env?: Record<string,string|undefined>, now?: () => number, registry?: typeof providerRegistry }} [options]
 */
export function createNwsAlertService({
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  env = process.env,
  now = Date.now,
  registry = providerRegistry,
} = {}) {
  const budget = createBudget({ perMinute: 4, now });
  const provider = registry.register(PROVIDER_CATALOG.nws, { budget });
  let alerts = null;
  let zoneOnly = 0;
  let fetchedAt = 0;
  let pending = null;
  /** @type {Map<string, { alerts: any[], fetchedAt: number }>} */
  const pointCache = new Map();

  async function pointAlerts(lat, lon) {
    const key = `${(Math.round(lat * 20) / 20).toFixed(2)},${(Math.round(lon * 20) / 20).toFixed(2)}`;
    const cached = pointCache.get(key);
    if (cached && now() - cached.fetchedAt < NWS_REFRESH_MS) return cached;
    try {
      const list = await budget.run(`point:${key}`, async () => {
        const started = now();
        const response = await fetchImpl(
          `https://api.weather.gov/alerts/active?status=actual&point=${key}`,
          {
            headers: {
              Accept: 'application/geo+json',
              'User-Agent': gevUserAgent(env),
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          },
        );
        if (!response.ok) {
          response.body?.cancel?.().catch?.(() => {});
          throw new UpstreamStatusError(response.status);
        }
        const body = await readResponseJsonCapped(response, MAX_BYTES);
        provider.success({ latencyMs: now() - started });
        const receivedAt = now();
        return (Array.isArray(body?.features) ? body.features : [])
          .map((f) => normalizeNwsAlert(f, receivedAt))
          .filter(Boolean);
      });
      const entry = { alerts: list, fetchedAt: now() };
      pointCache.set(key, entry);
      while (pointCache.size > 200)
        pointCache.delete(pointCache.keys().next().value);
      return entry;
    } catch (error) {
      provider.failure(error);
      return cached || null;
    }
  }

  async function download() {
    await budget.run('nws-active', async () => {
      const started = now();
      const response = await fetchImpl(
        'https://api.weather.gov/alerts/active?status=actual',
        {
          headers: {
            Accept: 'application/geo+json',
            'User-Agent': gevUserAgent(env),
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        response.body?.cancel?.().catch?.(() => {});
        throw new UpstreamStatusError(response.status, {
          retryAfterMs:
            parseRetryAfterMs(response.headers?.get?.('retry-after'), now()) ??
            5_000,
        });
      }
      const body = await readResponseJsonCapped(response, MAX_BYTES);
      const receivedAt = now();
      const list = (Array.isArray(body?.features) ? body.features : [])
        .map((f) => normalizeNwsAlert(f, receivedAt))
        .filter(Boolean);
      alerts = list.filter((a) => a.rings.length);
      zoneOnly = list.length - alerts.length;
      fetchedAt = receivedAt;
      provider.success({ latencyMs: receivedAt - started });
    });
  }

  function refresh() {
    if (alerts && now() - fetchedAt < NWS_REFRESH_MS) return Promise.resolve();
    pending ||= download()
      .catch((error) => {
        provider.failure(error);
        if (alerts) provider.stale();
      })
      .finally(() => {
        pending = null;
      });
    return pending;
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
    const point = { lat: n('lat'), lon: n('lon') };
    const hasBox =
      params.has('lamin') &&
      Object.values(box).every(Number.isFinite) &&
      box.lamin < box.lamax &&
      box.lomin < box.lomax;
    const hasPoint =
      params.has('lat') &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lon);
    if (!hasBox && !hasPoint)
      return {
        status: 400,
        body: { error: 'lamin, lomin, lamax, lomax (or lat, lon) required' },
      };
    if (!hasBox) {
      if (Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) {
        return { status: 400, body: { error: 'lat and lon out of range' } };
      }
      const entry = await pointAlerts(point.lat, point.lon);
      if (!entry)
        return {
          status: 503,
          body: { error: 'WEATHER DATA TEMPORARILY UNAVAILABLE' },
        };
      const list = entry.alerts
        .slice()
        .sort((a, b) => b.severityRank - a.severityRank);
      const ageMs = now() - entry.fetchedAt;
      return {
        status: 200,
        body: {
          alerts: list,
          ageMs,
          stale: ageMs > NWS_STALE_MS,
          attribution: PROVIDER_CATALOG.nws.attribution,
        },
      };
    }
    await refresh();
    if (!alerts)
      return {
        status: 503,
        body: { error: 'WEATHER DATA TEMPORARILY UNAVAILABLE' },
      };
    const selected = alerts.filter((a) => overlaps(a.bbox, box));
    selected.sort((a, b) => b.severityRank - a.severityRank);
    const ageMs = now() - fetchedAt;
    return {
      status: 200,
      body: {
        alerts: selected,
        zoneOnlyNationwide: zoneOnly,
        ageMs,
        stale: ageMs > NWS_STALE_MS,
        attribution: PROVIDER_CATALOG.nws.attribution,
      },
    };
  }

  return { handle, refresh };
}

/** Vite plugin: mount /api/nws/alerts. */
export function nwsAlertsProxy(options) {
  let service = null;
  const install = (server) => {
    service ||= createNwsAlertService(options);
    server.middlewares.use('/api/nws/alerts', async (req, res) => {
      let result;
      try {
        result = await service.handle(
          new URL(req.url || '/', 'http://localhost').searchParams,
        );
      } catch {
        result = {
          status: 503,
          body: { error: 'WEATHER DATA TEMPORARILY UNAVAILABLE' },
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
    name: 'gev-nws-alerts',
    configureServer: install,
    configurePreviewServer: install,
  };
}
