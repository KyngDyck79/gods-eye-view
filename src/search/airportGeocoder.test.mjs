import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirportGeocoder } from './airportGeocoder.js';

const KMYR = { ident: 'KMYR', icao: 'KMYR', iata: 'MYR', gps: 'KMYR', local: 'MYR', name: 'Myrtle Beach International Airport', lat: 33.6797, lon: -78.9283 };
const LAXEY = { ident: 'XLAX', name: 'Laxey Airport', lat: 54.2, lon: -4.4 };

function geocoder(airports, calls = []) {
  return createAirportGeocoder({
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(JSON.stringify({ airports }));
    },
  });
}

test('an ICAO or IATA code resolves to the airport', async () => {
  for (const q of ['KMYR', 'myr']) {
    const { place, answered } = await geocoder([KMYR]).geocode(q);
    assert.equal(answered, true);
    assert.equal(place.label, 'KMYR · Myrtle Beach International Airport');
    assert.deepEqual(place.types, ['airport']);
    assert.ok(place.viewport.southwest.lat < place.lat && place.lat < place.viewport.northeast.lat);
  }
});

test('a bare code that is not the result code does not hijack the search', async () => {
  const { place } = await geocoder([LAXEY]).geocode('LAX');
  assert.equal(place, null);
});

test('ordinary place names pass through without a request', async () => {
  const calls = [];
  const { place, answered } = await geocoder([KMYR], calls).geocode('Myrtle Beach');
  assert.equal(place, null);
  assert.equal(answered, true);
  assert.equal(calls.length, 0);
});

test('"… airport" names are looked up', async () => {
  const calls = [];
  const { place } = await geocoder([KMYR], calls).geocode('Myrtle Beach airport');
  assert.equal(place.name, 'Myrtle Beach International Airport');
  assert.match(calls[0], /\/api\/airports\/search\?q=Myrtle\+Beach\+airport&limit=1/);
});

test('an unavailable airport index is not an answer, so later geocoders still run', async () => {
  const offline = createAirportGeocoder({
    fetchImpl: async () => new Response('{}', { status: 503 }),
  });
  assert.deepEqual(await offline.geocode('KMYR'), { place: null, answered: false });
  const broken = createAirportGeocoder({
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  assert.deepEqual(await broken.geocode('KMYR'), { place: null, answered: false });
});
