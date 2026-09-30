/**
 * NASA EONET v3 open natural events (wildfires, volcanoes, severe storms…).
 * One global request, cached 15 minutes, only while someone is asking.
 *
 *   GET /api/eonet/events   — open events from the last 30 days
 */

import { createBudget, UpstreamStatusError } from '../gateway/budget.js';
import { PROVIDER_CATALOG } from '../gateway/catalog.js';
import { gevUserAgent, providerRegistry } from '../gateway/registry.js';
import { readResponseJsonCapped } from '../common/http.js';

export const EONET_REFRESH_MS = 15 * 60_000;
const URL_OPEN =
  'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30';

/** Normalise one EONET event to its latest point position. */
export function normalizeEonetEvent(event, receivedAt) {
  const points = (event?.geometry || []).filter(
    (g) =>
      g?.type === 'Point' &&
      Number.isFinite(g.coordinates?.[0]) &&
      Number.isFinite(g.coordinates?.[1]),
  );
  const latest = points.at(-1);
  if (!event?.id || !latest) return null;
  return {
    id: String(event.id),
    providerId: 'eonet',
    title: event.title || 'Natural event',
    category: event.categories?.[0]?.title || 'Natural event',
    categoryId: event.categories?.[0]?.id || null,
    lon: latest.coordinates[0],
    lat: latest.coordinates[1],
    observedAt: Date.parse(latest.date || '') || null,
    receivedAt,
    estimated: false,
    magnitude: Number.isFinite(latest.magnitudeValue)
      ? `${latest.magnitudeValue} ${latest.magnitudeUnit || ''}`.trim()
      : null,
    track: points.map((g) => g.coordinates).slice(-60),
    sources: (event.sources || [])
      .map((s) => ({ id: s.id, url: s.url }))
      .filter((s) => s.url),
    link: event.link || null,
  };
}

/**
 * @param {{ fetchImpl?: typeof fetch, env?: Record<string,string|undefined>, now?: () => number, registry?: typeof providerRegistry }} [options]
 */
export function createEonetService({
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  env = process.env,
  now = Date.now,
  registry = providerRegistry,
} = {}) {
  const budget = createBudget({ perMinute: 2, now });
  const provider = registry.register(PROVIDER_CATALOG.eonet, { budget });
  let events = null;
  let fetchedAt = 0;
  let pending = null;

  function refresh() {
    if (events && now() - fetchedAt < EONET_REFRESH_MS)
      return Promise.resolve();
    pending ||= budget
      .run('eonet', async () => {
        const started = now();
        const response = await fetchImpl(URL_OPEN, {
          headers: { 'User-Agent': gevUserAgent(env) },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          response.body?.cancel?.().catch?.(() => {});
          throw new UpstreamStatusError(response.status);
        }
        const body = await readResponseJsonCapped(response, 20 * 1024 * 1024);
        const receivedAt = now();
        events = (Array.isArray(body?.events) ? body.events : [])
          .map((e) => normalizeEonetEvent(e, receivedAt))
          .filter(Boolean);
        fetchedAt = receivedAt;
        provider.success({ latencyMs: receivedAt - started });
      })
      .catch((error) => {
        provider.failure(error);
        if (events) provider.stale();
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  async function handle() {
    await refresh();
    if (!events)
      return {
        status: 503,
        body: { error: 'NATURAL EVENTS TEMPORARILY UNAVAILABLE' },
      };
    return {
      status: 200,
      body: {
        events,
        ageMs: now() - fetchedAt,
        attribution: PROVIDER_CATALOG.eonet.attribution,
      },
    };
  }

  return { handle };
}

/** Vite plugin: mount /api/eonet/events. */
export function eonetProxy(options) {
  let service = null;
  const install = (server) => {
    service ||= createEonetService(options);
    server.middlewares.use('/api/eonet/events', async (_req, res) => {
      let result;
      try {
        result = await service.handle();
      } catch {
        result = {
          status: 503,
          body: { error: 'NATURAL EVENTS TEMPORARILY UNAVAILABLE' },
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
    name: 'gev-eonet',
    configureServer: install,
    configurePreviewServer: install,
  };
}
