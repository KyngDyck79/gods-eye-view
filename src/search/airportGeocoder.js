/** Half-width of the box an airport is framed with, in degrees (~3 km). */
const AIRPORT_HALF_SPAN_DEG = 0.03;

const AIRPORT_WORDS =
  /\b(airport|airfield|intl|international|field|aerodrome)\b/i;

/**
 * Resolve airport codes (KMYR, MYR) and "… airport" names through the
 * gateway's local OurAirports index. It answers only when the query is
 * clearly about an airport, so "Myrtle Beach" still finds the city.
 *
 * @param {{ fetchImpl?: typeof fetch, endpoint?: string }} [options]
 */
export function createAirportGeocoder({
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  endpoint = '/api/airports/search',
} = {}) {
  return {
    /**
     * @param {string} query
     * @param {{ signal?: AbortSignal }} [options]
     */
    async geocode(query, { signal } = {}) {
      signal?.throwIfAborted();
      const text = String(query || '').trim();
      const code = text.toUpperCase();
      const looksLikeCode = /^[A-Z0-9]{3,4}$/.test(code);
      if (!looksLikeCode && !AIRPORT_WORDS.test(text)) {
        return { place: null, answered: true };
      }
      let payload;
      try {
        const response = await fetchImpl(
          `${endpoint}?${new URLSearchParams({ q: text, limit: '1' })}`,
          { signal },
        );
        if (!response.ok) return { place: null, answered: false };
        payload = await response.json();
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        return { place: null, answered: false };
      }
      signal?.throwIfAborted();
      const airport = payload?.airports?.[0];
      if (
        !airport ||
        !Number.isFinite(airport.lat) ||
        !Number.isFinite(airport.lon)
      ) {
        return { place: null, answered: true };
      }
      const codes = [
        airport.ident,
        airport.icao,
        airport.iata,
        airport.gps,
        airport.local,
      ]
        .filter(Boolean)
        .map((c) => String(c).toUpperCase());
      // A bare code must match exactly; "LAX" must not become "Laxey Airport".
      if (looksLikeCode && !codes.includes(code) && !AIRPORT_WORDS.test(text)) {
        return { place: null, answered: true };
      }
      const label = [airport.icao || airport.ident, airport.name]
        .filter(Boolean)
        .join(' · ');
      return {
        place: {
          lat: airport.lat,
          lng: airport.lon,
          name: airport.name || airport.ident,
          label,
          types: ['airport'],
          viewport: {
            southwest: {
              lat: airport.lat - AIRPORT_HALF_SPAN_DEG,
              lng: airport.lon - AIRPORT_HALF_SPAN_DEG,
            },
            northeast: {
              lat: airport.lat + AIRPORT_HALF_SPAN_DEG,
              lng: airport.lon + AIRPORT_HALF_SPAN_DEG,
            },
          },
        },
        answered: true,
      };
    },
  };
}
