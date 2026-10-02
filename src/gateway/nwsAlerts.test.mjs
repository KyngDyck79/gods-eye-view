import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NWS_COLORS,
  NWS_REFRESH_MS,
  createNwsAlertService,
  normalizeNwsAlert,
  pointInRings,
} from '../../server/providers/nws/index.js';
import { createProviderRegistry } from '../../server/providers/gateway/registry.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nws/alerts-active.sample.json', import.meta.url), 'utf8'),
);

test('recorded alerts normalise with official colors, full text and bounds', () => {
  const [polygon, , zoneOnly] = FIXTURE.features.map((f) => normalizeNwsAlert(f, 1));
  assert.equal(polygon.event, 'Flood Warning');
  assert.equal(polygon.color, NWS_COLORS['Flood Warning']);
  assert.ok(polygon.rings[0].length >= 3);
  assert.ok(polygon.bbox[0] <= polygon.bbox[2] && polygon.bbox[1] <= polygon.bbox[3]);
  assert.ok(polygon.description && polygon.description.length > 20, 'full text kept');
  assert.equal(zoneOnly.rings.length, 0, 'zone-only alerts carry no polygon');
  assert.equal(NWS_COLORS['Tornado Warning'], '#FF0000');
});

test('point in polygon', () => {
  const square = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
  assert.equal(pointInRings(5, 5, square), true);
  assert.equal(pointInRings(15, 5, square), false);
});

function setup(respond) {
  const clock = { t: Date.UTC(2026, 8, 30, 16) };
  const calls = [];
  const service = createNwsAlertService({
    env: { GEV_CONTACT_EMAIL: 'rod@example.com' },
    now: () => clock.t,
    registry: createProviderRegistry({ now: () => clock.t, env: {} }),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), headers: init.headers });
      return respond(String(url));
    },
  });
  return { service, calls, clock };
}

test('view queries return polygon alerts in view from one national download, refreshed every 90 s', async () => {
  const { service, calls, clock } = setup(() => new Response(JSON.stringify(FIXTURE)));
  const first = FIXTURE.features[0].geometry.coordinates[0][0];
  const box = new URLSearchParams({ lamin: first[1] - 1, lomin: first[0] - 1, lamax: first[1] + 1, lomax: first[0] + 1 });
  const { status, body } = await service.handle(box);
  assert.equal(status, 200);
  assert.ok(body.alerts.some((a) => a.id === FIXTURE.features[0].properties.id));
  assert.equal(body.zoneOnlyNationwide, 1);
  assert.equal(calls[0].headers['User-Agent'], 'GodsEyeView/2.0 (+contact: rod@example.com)');
  await service.handle(new URLSearchParams('lamin=0&lomin=0&lamax=1&lomax=1'));
  assert.equal(calls.length, 1);
  clock.t += NWS_REFRESH_MS;
  await service.handle(box);
  assert.equal(calls.length, 2);
});

test('point queries use the NWS point lookup, which includes zone-based alerts', async () => {
  const { service, calls } = setup(() => new Response(JSON.stringify({ type: 'FeatureCollection', features: [FIXTURE.features[2]] })));
  const { body } = await service.handle(new URLSearchParams('lat=33.70&lon=-78.90'));
  assert.equal(body.alerts[0].event, 'Coastal Flood Advisory');
  assert.match(calls[0].url, /alerts\/active\?status=actual&point=33\.70,-78\.90$/);
});

test('no-fake-data: NWS unreachable → the exact unavailable message', async () => {
  const { service } = setup(() => new Response('', { status: 503 }));
  const { status, body } = await service.handle(new URLSearchParams('lamin=30&lomin=-80&lamax=35&lomax=-75'));
  assert.equal(status, 503);
  assert.equal(body.error, 'WEATHER DATA TEMPORARILY UNAVAILABLE');
});
