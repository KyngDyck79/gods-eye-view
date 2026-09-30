import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRCRAFT_UNAVAILABLE,
  STALE_MAX_MS,
  createAircraftViewportHandler,
  openSkyRefreshMs,
} from '../../server/providers/aircraft/viewportRoute.js';
import { createProviderRegistry } from '../../server/providers/gateway/registry.js';

const GRAND_STRAND = new URLSearchParams('lamin=33.3&lomin=-79.4&lamax=34.2&lomax=-78.4');
const CONUS = new URLSearchParams('lamin=25&lomin=-100&lamax=49&lomax=-66');

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A scripted upstream: `routes` maps a URL prefix to a response factory. */
function fakeUpstream(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers || {} });
    for (const [prefix, respond] of Object.entries(routes)) {
      if (String(url).startsWith(prefix)) return respond(String(url));
    }
    throw new TypeError('fetch failed');
  };
  return { fetchImpl, calls };
}

function setup({ routes, env = {}, clock = { t: Date.UTC(2026, 8, 29, 18) } } = {}) {
  const upstream = fakeUpstream(routes);
  const registry = createProviderRegistry({ now: () => clock.t, env });
  const handler = createAircraftViewportHandler({
    fetchImpl: upstream.fetchImpl,
    env,
    now: () => clock.t,
    registry,
    getToken: async () => 'test-token',
    sleep: async () => {},
  });
  return { handler, calls: upstream.calls, registry, clock };
}

const adsbPayload = (clock) => ({
  now: clock.t,
  ac: [{ hex: 'a1b2c3', lat: 33.7, lon: -78.9, flight: 'AAL123', r: 'N12345', t: 'B738', squawk: '1200', alt_baro: 3000, seen_pos: 1, seen: 1 }],
});
const openskyPayload = (clock) => ({
  time: Math.floor(clock.t / 1000),
  states: [['abc123', 'DAL45  ', 'United States', Math.floor(clock.t / 1000) - 3, Math.floor(clock.t / 1000) - 1, -78.8, 33.6, 1000, false, 120, 90, 0, null, 1050, '4321', false, 0, 0]],
});

test('a regional view is served by adsb.lol with source, coverage and age', async () => {
  const clock = { t: Date.UTC(2026, 8, 29, 18) };
  const { handler, calls } = setup({
    clock,
    routes: { 'https://api.adsb.lol/v2/point/': () => jsonResponse(adsbPayload(clock)) },
  });
  const { status, body } = await handler.handle(GRAND_STRAND);
  assert.equal(status, 200);
  assert.equal(body.source, 'ADSB.lol');
  assert.equal(body.providerId, 'adsblol');
  assert.equal(body.complete, true);
  assert.equal(body.stale, false);
  assert.equal(body.states.length, 1);
  assert.equal(body.states[0][18], 'N12345');
  assert.ok(calls.every((c) => c.url.startsWith('https://api.adsb.lol/v2/point/')));
  assert.match(calls[0].headers['User-Agent'], /^GodsEyeView\/2\.0/);
});

test('when adsb.lol fails, the same view falls back to an OpenSky box with the OAuth token', async () => {
  const clock = { t: Date.UTC(2026, 8, 29, 18) };
  const { handler, calls, registry } = setup({
    clock,
    env: { OPENSKY_CLIENT_ID: 'id', OPENSKY_CLIENT_SECRET: 'secret' },
    routes: {
      'https://api.adsb.lol/': () => jsonResponse({ error: 'down' }, { status: 503 }),
      'https://opensky-network.org/api/states/all': () =>
        jsonResponse(openskyPayload(clock), { headers: { 'x-rate-limit-remaining': '3990' } }),
    },
  });
  const { status, body } = await handler.handle(GRAND_STRAND);
  assert.equal(status, 200);
  assert.equal(body.source, 'OpenSky Network');
  assert.equal(body.coverage, 'viewport box');
  const openskyCall = calls.find((c) => c.url.includes('opensky-network.org'));
  assert.match(openskyCall.url, /lamin=33&lomin=-80&lamax=35&lomax=-78/);
  assert.equal(openskyCall.headers.Authorization, 'Bearer test-token');
  const statuses = Object.fromEntries(registry.list().map((p) => [p.id, p.status]));
  assert.equal(statuses.adsblol, 'OFFLINE');
  assert.equal(statuses.opensky, 'ONLINE');
});

test('continental views go straight to OpenSky without tiling adsb.lol', async () => {
  const clock = { t: Date.UTC(2026, 8, 29, 18) };
  const { handler, calls } = setup({
    clock,
    routes: { 'https://opensky-network.org/': () => jsonResponse(openskyPayload(clock)) },
  });
  const { body } = await handler.handle(CONUS);
  assert.equal(body.providerId, 'opensky');
  assert.equal(calls.filter((c) => c.url.includes('adsb.lol')).length, 0);
});

test('no-fake-data: with every upstream offline the route returns zero aircraft and the exact message', async () => {
  const { handler } = setup({ routes: {} });
  const { status, body } = await handler.handle(GRAND_STRAND);
  assert.equal(status, 503);
  assert.deepEqual(body, { error: AIRCRAFT_UNAVAILABLE });
  assert.equal(AIRCRAFT_UNAVAILABLE, 'AIRCRAFT DATA TEMPORARILY UNAVAILABLE');
});

test('after an outage, cached data is served marked stale for at most five minutes', async () => {
  const clock = { t: Date.UTC(2026, 8, 29, 18) };
  let online = true;
  const { handler } = setup({
    clock,
    routes: {
      'https://api.adsb.lol/': () => (online ? jsonResponse(adsbPayload(clock)) : jsonResponse({}, { status: 502 })),
    },
  });
  assert.equal((await handler.handle(GRAND_STRAND)).body.stale, false);
  online = false;
  clock.t += 60_000;
  const during = await handler.handle(GRAND_STRAND);
  assert.equal(during.status, 200);
  assert.equal(during.body.stale, true);
  assert.equal(during.body.ageMs, 60_000);
  clock.t += STALE_MAX_MS;
  const after = await handler.handle(GRAND_STRAND);
  assert.equal(after.status, 503);
  assert.equal(after.body.states, undefined);
});

test('ten simultaneous tabs cause one upstream request per tile', async () => {
  const clock = { t: Date.UTC(2026, 8, 29, 18) };
  const { handler, calls } = setup({
    clock,
    routes: { 'https://api.adsb.lol/': () => jsonResponse(adsbPayload(clock)) },
  });
  const results = await Promise.all(Array.from({ length: 10 }, () => handler.handle(GRAND_STRAND)));
  assert.ok(results.every((r) => r.status === 200));
  const tileCount = new Set(calls.map((c) => c.url)).size;
  assert.equal(calls.length, tileCount);
  await handler.handle(GRAND_STRAND);
  assert.equal(calls.length, tileCount, 'a repeat within 10 s is served from cache');
});

test('commercial mode disables OpenSky (non-commercial terms)', async () => {
  const clock = { t: Date.UTC(2026, 8, 29, 18) };
  const { handler, calls, registry } = setup({
    clock,
    env: { GEV_USAGE_MODE: 'commercial' },
    routes: {
      'https://opensky-network.org/': () => jsonResponse(openskyPayload(clock)),
    },
  });
  const { status } = await handler.handle(CONUS);
  assert.equal(status, 503);
  assert.equal(calls.length, 0);
  const opensky = registry.list().find((p) => p.id === 'opensky');
  assert.equal(opensky.status, 'DISABLED');
  assert.equal(opensky.message, 'Disabled in commercial mode — provider terms.');
});

test('bad requests are rejected', async () => {
  const { handler } = setup({ routes: {} });
  assert.equal((await handler.handle(new URLSearchParams('lat=999&lon=0'))).status, 400);
});

test('OpenSky refresh spreads remaining credits over the rest of the UTC day', () => {
  const noon = Date.UTC(2026, 8, 29, 12);
  // 43,200 s left, 1,000 global requests left → one every 43.2 s.
  assert.equal(openSkyRefreshMs({ creditsRemaining: 4000 }, 4, noon, 10_000), 43_200);
  assert.equal(openSkyRefreshMs({ creditsRemaining: 4000 }, 1, noon, 10_000), 10_800);
  assert.equal(openSkyRefreshMs({ creditsRemaining: null }, 4, noon, 10_000), 10_000);
});
