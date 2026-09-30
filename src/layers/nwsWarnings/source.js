/** Browser source for NWS alert polygons in a view box (via the gateway). */
export function createNwsWarningSource({
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  endpoint = '/api/nws/alerts',
} = {}) {
  return {
    /** @param {{ viewBox?: { south: number, west: number, north: number, east: number }|null, signal?: AbortSignal }} [query] */
    async getSnapshot({ viewBox = null, signal } = {}) {
      signal?.throwIfAborted();
      if (!viewBox) return { alerts: [], stale: false };
      const params = new URLSearchParams({
        lamin: viewBox.south.toFixed(3),
        lomin: viewBox.west.toFixed(3),
        lamax: viewBox.north.toFixed(3),
        lomax: viewBox.east.toFixed(3),
      });
      const response = await fetchImpl(`${endpoint}?${params}`, { signal });
      const body = await response.json().catch(() => ({}));
      signal?.throwIfAborted();
      if (!response.ok)
        throw new Error(body?.error || 'WEATHER DATA TEMPORARILY UNAVAILABLE');
      return {
        alerts: Array.isArray(body.alerts) ? body.alerts : [],
        stale: body.stale === true,
      };
    },
  };
}
