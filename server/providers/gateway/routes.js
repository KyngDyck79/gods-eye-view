/**
 * GET /api/health    — is the gateway up, and in which usage mode.
 * GET /api/providers — metadata and live status for every registered
 *                      provider (diagnostics and attribution panels).
 *
 * Neither route ever returns a key or secret: the registry holds only
 * metadata, timestamps, status text and budget counters.
 */

import { providerRegistry } from './registry.js';

const startedAt = Date.now();

/**
 * @param {{ registry?: typeof providerRegistry, now?: () => number }} [options]
 */
export function createGatewayRoutes({
  registry = providerRegistry,
  now = Date.now,
} = {}) {
  function health() {
    const providers = registry.list();
    const counts = {};
    for (const provider of providers) {
      counts[provider.status] = (counts[provider.status] || 0) + 1;
    }
    return {
      ok: true,
      product: "GOD'S EYE VIEW",
      usageMode: registry.usageMode(),
      uptimeMs: now() - startedAt,
      providers: counts,
    };
  }

  function providers() {
    return { usageMode: registry.usageMode(), providers: registry.list() };
  }

  return { health, providers };
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/** Vite plugin: mount the gateway status routes on dev and preview servers. */
export function gatewayStatusRoutes(options) {
  const routes = createGatewayRoutes(options);
  const install = (server) => {
    server.middlewares.use('/api/health', (req, res) => {
      sendJson(res, 200, routes.health());
    });
    server.middlewares.use('/api/providers', (req, res) => {
      sendJson(res, 200, routes.providers());
    });
  };
  return {
    name: 'gev-gateway-status',
    configureServer: install,
    configurePreviewServer: install,
  };
}
