/** Browser source for OpenStreetMap emergency facilities (via the gateway). */
export function createEmergencyFacilitySource({
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  endpoint = '/api/facilities',
} = {}) {
  return {
    /** @param {{ viewBox?: { south: number, west: number, north: number, east: number } | null, signal?: AbortSignal }} [query] */
    async getSnapshot({ viewBox, signal } = {}) {
      signal?.throwIfAborted();
      if (!viewBox)
        return {
          facilities: [],
          message: 'Zoom in to load emergency facilities',
        };
      const q = new URLSearchParams({
        lamin: viewBox.south.toFixed(4),
        lomin: viewBox.west.toFixed(4),
        lamax: viewBox.north.toFixed(4),
        lomax: viewBox.east.toFixed(4),
      });
      const response = await fetchImpl(`${endpoint}?${q}`, { signal });
      const body = await response.json().catch(() => ({}));
      signal?.throwIfAborted();
      if (!response.ok)
        throw new Error(body?.error || 'FACILITY DATA TEMPORARILY UNAVAILABLE');
      return {
        facilities: Array.isArray(body.facilities) ? body.facilities : [],
        message: body.message || null,
        stale: body.stale === true,
        missingTiles: Number(body.missingTiles) || 0,
      };
    },
  };
}
