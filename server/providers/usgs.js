/**
 * USGS earthquake summary feeds through the gateway (alerts engine), cached
 * for 60 s; the feeds themselves update every minute.
 *
 *   GET /api/usgs/{all_hour|2.5_day|4.5_day|significant_week|all_day|4.5_week}
 */

import { createBudget, UpstreamStatusError } from './gateway/budget.js';
import { PROVIDER_CATALOG } from './gateway/catalog.js';
import { gevUserAgent, providerRegistry } from './gateway/registry.js';
import { readResponseJsonCapped } from './common/http.js';

export const USGS_FEEDS = Object.freeze([
  'all_hour',
  '2.5_day',
  '4.5_day',
  'significant_week',
  'all_day',
  '4.5_week',
]);
const CACHE_MS = 60_000;

export function createUsgsService({
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  env = process.env,
  now = Date.now,
  registry = providerRegistry,
} = {}) {
  const budget = createBudget({ perMinute: 12, now });
  const provider = registry.register(PROVIDER_CATALOG.usgs, { budget });
  const cache = new Map();

  async function handle(feed) {
    if (!USGS_FEEDS.includes(feed))
      return { status: 404, body: { error: 'Unknown USGS feed' } };
    const cached = cache.get(feed);
    if (cached && now() - cached.fetchedAt < CACHE_MS)
      return { status: 200, body: cached.body };
    try {
      const body = await budget.run(feed, async () => {
        const started = now();
        const response = await fetchImpl(
          `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`,
          {
            headers: { 'User-Agent': gevUserAgent(env) },
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (!response.ok) {
          response.body?.cancel?.().catch?.(() => {});
          throw new UpstreamStatusError(response.status);
        }
        const json = await readResponseJsonCapped(response, 20 * 1024 * 1024);
        provider.success({
          latencyMs: now() - started,
          observedAt: Number(json?.metadata?.generated) || null,
        });
        return json;
      });
      cache.set(feed, { body, fetchedAt: now() });
      return { status: 200, body };
    } catch (error) {
      provider.failure(error);
      if (cached) return { status: 200, body: cached.body };
      return {
        status: 503,
        body: { error: 'EARTHQUAKE DATA TEMPORARILY UNAVAILABLE' },
      };
    }
  }
  return { handle };
}

export function usgsProxy(options) {
  let service = null;
  const install = (server) => {
    service ||= createUsgsService(options);
    server.middlewares.use('/api/usgs', async (req, res) => {
      const feed = decodeURIComponent(
        new URL(req.url || '/', 'http://localhost').pathname.replace(
          /^\/+/,
          '',
        ),
      );
      const result = await service.handle(feed).catch(() => ({
        status: 503,
        body: { error: 'EARTHQUAKE DATA TEMPORARILY UNAVAILABLE' },
      }));
      res.writeHead(result.status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(result.body));
    });
  };
  return {
    name: 'gev-usgs',
    configureServer: install,
    configurePreviewServer: install,
  };
}
