import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INCIDENT_CACHE_MS,
  boxAreaKm2,
  createTrafficIncidentService,
  normalizeIncident,
} from '../../server/providers/trafficIncidents/index.js';
import { createProviderRegistry } from '../../server/providers/gateway/registry.js';

// Shape of a real TomTom Incident Details v5 feature (Grand Strand, 2026-09-30).
const FEATURE = {
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[-79.0521, 33.8401], [-79.0502, 33.8389]] },
  properties: {
    id: 'abc123',
    iconCategory: 7,
    magnitudeOfDelay: 0,
    events: [{ description: 'Lane closed', code: 500, iconCategory: 7 }],
    startTime: '2026-09-29T12:00:00Z',
    endTime: null,
    from: 'SC-319/Elm St (US-501)',
    to: 'SC-22/Veterans Hwy (US-501)',
    length: 812.4,
    delay: 0,
    roadNumbers: ['US-501 S'],
  },
};
const GRAND_STRAND = new URLSearchParams('lamin=33.4&lomin=-79.3&lamax=34.1&lomax=-78.5');

function setup({ env = { TOMTOM_API_KEY: 'test-key' }, respond } = {}) {
  const clock = { t: Date.UTC(2026, 8, 30, 15) };
  const calls = [];
  const service = createTrafficIncidentService({
    env,
    now: () => clock.t,
    registry: createProviderRegistry({ now: () => clock.t, env }),
    fetchImpl: async (url) => {
      calls.push(String(url));
      return respond ? respond() : new Response(JSON.stringify({ incidents: [FEATURE] }));
    },
  });
  return { service, calls, clock };
}

test('normalises a TomTom incident with category, roads and source time', () => {
  const incident = normalizeIncident(FEATURE, 1);
  assert.equal(incident.category, 'Lane closed');
  assert.equal(incident.description, 'Lane closed');
  assert.deepEqual(incident.roads, ['US-501 S']);
  assert.equal(incident.lat, 33.8401);
  assert.equal(incident.observedAt, Date.parse('2026-09-29T12:00:00Z'));
  assert.equal(incident.estimated, false);
  assert.equal(normalizeIncident({ properties: {} }, 1), null);
});

test('incidents in view are fetched once and cached for five minutes', async () => {
  const { service, calls, clock } = setup();
  const first = await service.handle(GRAND_STRAND);
  assert.equal(first.status, 200);
  assert.equal(first.body.incidents.length, 1);
  assert.match(calls[0], /^https:\/\/api\.tomtom\.com\/traffic\/services\/5\/incidentDetails\?key=test-key&bbox=-79\.3,33\.4,-78\.5,34\.1&/);
  await service.handle(GRAND_STRAND);
  assert.equal(calls.length, 1);
  clock.t += INCIDENT_CACHE_MS;
  await service.handle(GRAND_STRAND);
  assert.equal(calls.length, 2);
});

test('without a key the route says NEEDS KEY and never calls TomTom', async () => {
  const { service, calls } = setup({ env: {} });
  const { status, body } = await service.handle(GRAND_STRAND);
  assert.equal(status, 503);
  assert.equal(body.error, 'TOMTOM NEEDS API KEY');
  assert.equal(calls.length, 0);
});

test('views over 10,000 km² ask to zoom in instead of spending requests', async () => {
  const { service, calls } = setup();
  const { body } = await service.handle(new URLSearchParams('lamin=30&lomin=-85&lamax=36&lomax=-75'));
  assert.equal(body.zoomIn, true);
  assert.equal(calls.length, 0);
  assert.ok(boxAreaKm2({ lamin: 33.4, lomin: -79.3, lamax: 34.1, lomax: -78.5 }) < 10_000);
});

test('the daily budget (80) cannot be exceeded', async () => {
  const { service, calls, clock } = setup();
  for (let i = 0; i < 120; i += 1) {
    clock.t += 60_000;
    await service.handle(new URLSearchParams(`lamin=33.4&lomin=${-79.3 + i * 0.001}&lamax=34.1&lomax=-78.5`));
  }
  assert.ok(calls.length <= 80, `${calls.length} requests`);
});

test('an outage serves cached incidents marked stale, then the unavailable message', async () => {
  let up = true;
  const { service, clock } = setup({
    respond: () => (up ? new Response(JSON.stringify({ incidents: [FEATURE] })) : new Response('', { status: 502 })),
  });
  await service.handle(GRAND_STRAND);
  up = false;
  clock.t += INCIDENT_CACHE_MS;
  const stale = await service.handle(GRAND_STRAND);
  assert.equal(stale.body.stale, true);
  const other = await service.handle(new URLSearchParams('lamin=32.4&lomin=-80.3&lamax=33.1&lomax=-79.5'));
  assert.equal(other.status, 503);
  assert.equal(other.body.error, 'TRAFFIC INCIDENTS TEMPORARILY UNAVAILABLE');
});
