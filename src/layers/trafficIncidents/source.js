/**
 * Browser source for traffic incidents: asks the gateway for the incidents
 * in a view box. Keys and the TomTom call stay on the server.
 */

/** @param {{ fetchImpl?: typeof fetch, endpoint?: string }} [options] */
export function createTrafficIncidentSource({
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  endpoint = '/api/traffic/incidents',
} = {}) {
  return {
    /**
     * @param {{ viewBox: { south: number, west: number, north: number, east: number }, signal?: AbortSignal }} query
     * @returns {Promise<{ incidents: any[], zoomIn: boolean, message: string|null, stale: boolean }>}
     */
    async getSnapshot({ viewBox, signal } = /** @type {any} */ ({})) {
      signal?.throwIfAborted();
      if (!viewBox)
        return {
          incidents: [],
          zoomIn: true,
          message: 'Zoom in to see traffic incidents',
          stale: false,
        };
      const params = new URLSearchParams({
        lamin: viewBox.south.toFixed(3),
        lomin: viewBox.west.toFixed(3),
        lamax: viewBox.north.toFixed(3),
        lomax: viewBox.east.toFixed(3),
      });
      const response = await fetchImpl(`${endpoint}?${params}`, { signal });
      const body = await response.json().catch(() => ({}));
      signal?.throwIfAborted();
      if (!response.ok) {
        const error = new Error(
          body?.error || 'TRAFFIC INCIDENTS TEMPORARILY UNAVAILABLE',
        );
        /** @type {any} */ (error).keyRequired = body?.status === 'NEEDS_KEY';
        throw error;
      }
      return {
        incidents: Array.isArray(body.incidents) ? body.incidents : [],
        zoomIn: body.zoomIn === true,
        message: body.message || null,
        stale: body.stale === true,
      };
    },
  };
}
