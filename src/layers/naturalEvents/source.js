/** Browser source for NASA EONET open natural events (via the gateway). */
export function createNaturalEventSource({
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  endpoint = '/api/eonet/events',
} = {}) {
  return {
    /** @param {{ signal?: AbortSignal }} [query] */
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(endpoint, { signal });
      const body = await response.json().catch(() => ({}));
      signal?.throwIfAborted();
      if (!response.ok)
        throw new Error(
          body?.error || 'NATURAL EVENTS TEMPORARILY UNAVAILABLE',
        );
      return { events: Array.isArray(body.events) ? body.events : [] };
    },
  };
}
