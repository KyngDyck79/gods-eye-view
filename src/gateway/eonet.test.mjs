import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EONET_REFRESH_MS, createEonetService, normalizeEonetEvent } from '../../server/providers/eonet/index.js';
import { createProviderRegistry } from '../../server/providers/gateway/registry.js';

const FIXTURE = readFileSync(new URL('../../tests/fixtures/eonet/events-open.sample.json', import.meta.url), 'utf8');

test('recorded EONET events normalise to their latest position with source links', () => {
  const events = JSON.parse(FIXTURE).events.map((e) => normalizeEonetEvent(e, 1)).filter(Boolean);
  assert.equal(events.length, 5);
  for (const e of events) {
    assert.ok(Number.isFinite(e.lat) && Number.isFinite(e.lon));
    assert.ok(e.link?.startsWith('https://eonet.gsfc.nasa.gov/'));
    assert.equal(e.estimated, false);
  }
  assert.ok(events.some((e) => e.category === 'Wildfires'));
});

test('one global request per 15 minutes; outage gives the unavailable message', async () => {
  const clock = { t: 0 };
  let calls = 0;
  let up = true;
  const service = createEonetService({
    env: {},
    now: () => clock.t,
    registry: createProviderRegistry({ now: () => clock.t, env: {} }),
    fetchImpl: async () => {
      calls += 1;
      return up ? new Response(FIXTURE) : new Response('', { status: 500 });
    },
  });
  assert.equal((await service.handle()).body.events.length, 5);
  await service.handle();
  assert.equal(calls, 1);
  clock.t += EONET_REFRESH_MS;
  up = false;
  const stale = await service.handle();
  assert.equal(stale.status, 200, 'last good data keeps serving');
  const fresh = createEonetService({
    env: {},
    registry: createProviderRegistry({ env: {} }),
    fetchImpl: async () => new Response('', { status: 500 }),
  });
  assert.deepEqual((await fresh.handle()).body, { error: 'NATURAL EVENTS TEMPORARILY UNAVAILABLE' });
});
