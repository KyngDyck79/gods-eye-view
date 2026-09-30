import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  ceilingFt,
  decodeMetarCsv,
  decodeTafXml,
  describeMetar,
  flightCategory,
} from '../../server/providers/aviationWeather/decode.js';
import {
  METAR_REFRESH_MS,
  WEATHER_UNAVAILABLE,
  createAviationWeatherService,
} from '../../server/providers/aviationWeather/index.js';
import { createProviderRegistry } from '../../server/providers/gateway/registry.js';

const fixture = (name) =>
  readFileSync(new URL(`../../tests/fixtures/awc/${name}`, import.meta.url), 'utf8');
const METAR_CSV = fixture('metars.cache.sample.csv');
const TAF_XML = fixture('tafs.cache.sample.xml');
// Capture time of the fixtures (see tests/fixtures/README.md).
const CAPTURED = Date.parse('2026-09-30T03:38:00Z');

test('decodes the recorded KMYR METAR, keeping the raw text', () => {
  const metars = decodeMetarCsv(METAR_CSV);
  const kmyr = metars.get('KMYR');
  assert.equal(
    kmyr.raw,
    'METAR KMYR 300253Z AUTO 00000KT 10SM CLR 23/21 A3008 RMK AO2 SLP184 T02280206 51017 $',
  );
  assert.equal(kmyr.observedAt, Date.parse('2026-09-30T02:53:00Z'));
  assert.deepEqual(kmyr.wind, { directionDeg: 0, variable: false, speedKt: 0, gustKt: null });
  assert.equal(kmyr.visibilitySm, 10);
  assert.equal(kmyr.visibilityText, '10+ SM');
  assert.equal(kmyr.ceilingFt, null);
  assert.equal(kmyr.temperatureC, 22.8);
  assert.equal(kmyr.dewpointC, 20.6);
  assert.equal(kmyr.altimeterInHg, 30.08);
  assert.equal(kmyr.flightCategory, 'VFR');
  assert.equal(
    describeMetar(kmyr),
    'Wind calm, visibility 10+ SM, no ceiling, temperature 22.8 °C, dewpoint 20.6 °C, altimeter 30.08 inHg',
  );
});

test('ceiling is the lowest BKN/OVC layer or vertical visibility; category matches AWC', () => {
  const metars = decodeMetarCsv(METAR_CSV);
  // CYNA: 1/2SM FG VV001 → ceiling 100 ft, LIFR.
  assert.equal(metars.get('CYNA').ceilingFt, 100);
  assert.equal(metars.get('CYNA').flightCategory, 'LIFR');
  // KHNR: 7SM OVC005 → IFR.
  assert.equal(metars.get('KHNR').ceilingFt, 500);
  assert.equal(metars.get('KHNR').flightCategory, 'IFR');
  // KTWM: VRB05KT 3SM BR OVC005 → variable wind.
  assert.equal(metars.get('KTWM').wind.variable, true);
  // Our own computation agrees with AWC for every recorded station that has both.
  for (const metar of metars.values()) {
    if (metar.computedFlightCategory && ['VFR', 'MVFR', 'IFR', 'LIFR'].includes(metar.flightCategory)) {
      assert.equal(metar.computedFlightCategory, metar.flightCategory, metar.raw);
    }
  }
});

test('flight category and ceiling rules', () => {
  assert.equal(flightCategory(null, 10), 'VFR');
  assert.equal(flightCategory(3000, 10), 'MVFR');
  assert.equal(flightCategory(3100, 5), 'MVFR');
  assert.equal(flightCategory(999, 10), 'IFR');
  assert.equal(flightCategory(5000, 2.5), 'IFR');
  assert.equal(flightCategory(400, 10), 'LIFR');
  assert.equal(flightCategory(null, null), null);
  assert.equal(ceilingFt([{ cover: 'FEW', baseFtAgl: 200 }, { cover: 'BKN', baseFtAgl: 1200 }, { cover: 'OVC', baseFtAgl: 900 }], null), 900);
  assert.equal(ceilingFt([{ cover: 'SCT', baseFtAgl: 200 }], 300), 300);
});

test('decodes the recorded KMYR TAF with raw text and forecast periods', () => {
  const tafs = decodeTafXml(TAF_XML);
  const kmyr = tafs.get('KMYR');
  assert.equal(
    kmyr.raw,
    'TAF KMYR 292324Z 3000/3024 VRB05KT P6SM FEW060 FM300900 00000KT 4SM BR SKC FM301200 07004KT P6SM SKC FM301800 13009KT P6SM FEW050',
  );
  assert.equal(kmyr.validFrom, Date.parse('2026-09-30T00:00:00Z'));
  assert.equal(kmyr.validTo, Date.parse('2026-10-01T00:00:00Z'));
  assert.ok(kmyr.periods.length >= 4);
  const mist = kmyr.periods.find((p) => p.weather === 'BR');
  assert.equal(mist.visibilitySm, 4);
  assert.equal(mist.change, 'FM');
  assert.ok(kmyr.periods.every((p, i, all) => i === 0 || all[i - 1].from <= p.from), 'sorted by time');
  assert.ok([...tafs.values()].some((t) => t.periods.some((p) => p.probability != null)), 'PROB groups decode');
});

function awcUpstream({ metar = METAR_CSV, taf = TAF_XML, fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers || {} });
    if (fail) throw new TypeError('fetch failed');
    const body = String(url).includes('metars') ? metar : taf;
    return new Response(gzipSync(Buffer.from(body)), { headers: { etag: '"x1"' } });
  };
  return { calls, fetchImpl };
}

function service(upstream, clock) {
  return createAviationWeatherService({
    fetchImpl: upstream.fetchImpl,
    now: () => clock.t,
    registry: createProviderRegistry({ now: () => clock.t, env: {} }),
    env: {},
  });
}

test('METAR route serves decoded reports with age, and reuses the file until it is due', async () => {
  const clock = { t: CAPTURED };
  const upstream = awcUpstream();
  const svc = service(upstream, clock);
  const first = await svc.handle('/metar', new URLSearchParams('ids=KMYR,KZZZ'));
  assert.equal(first.status, 200);
  assert.equal(first.body.metars[0].station, 'KMYR');
  assert.equal(first.body.metars[0].ageMs, 45 * 60_000);
  assert.equal(first.body.metars[0].stale, false);
  assert.deepEqual(first.body.missing, ['KZZZ']);
  assert.match(upstream.calls[0].headers['User-Agent'], /^GodsEyeView\/2\.0/);
  await svc.handle('/metar', new URLSearchParams('ids=KCRE'));
  assert.equal(upstream.calls.length, 1, 'no second download inside the refresh period');
  clock.t += METAR_REFRESH_MS;
  await svc.handle('/metar', new URLSearchParams('ids=KCRE'));
  assert.equal(upstream.calls.length, 2);
  assert.equal(upstream.calls[1].headers['If-None-Match'], '"x1"');
});

test('a METAR older than 90 minutes is marked STALE but still shown', async () => {
  const clock = { t: Date.parse('2026-09-30T04:30:00Z') };
  const svc = service(awcUpstream(), clock);
  const { body } = await svc.handle('/metar', new URLSearchParams('ids=KMYR'));
  assert.equal(body.metars[0].stale, true);
  assert.equal(body.metars[0].raw.startsWith('METAR KMYR'), true);
});

test('nearest METAR stations to the Grand Strand', async () => {
  const clock = { t: CAPTURED };
  const svc = service(awcUpstream(), clock);
  const { body } = await svc.handle('/nearest', new URLSearchParams('lat=33.70&lon=-78.90&radiusNm=40'));
  assert.deepEqual(body.metars.map((m) => m.station), ['KMYR', 'KCRE', 'KHYW']);
});

test('TAF route', async () => {
  const clock = { t: CAPTURED };
  const svc = service(awcUpstream(), clock);
  const { status, body } = await svc.handle('/taf', new URLSearchParams('ids=KMYR'));
  assert.equal(status, 200);
  assert.equal(body.tafs[0].station, 'KMYR');
});

test('no-fake-data: AWC unreachable on first request → the exact unavailable message', async () => {
  const clock = { t: CAPTURED };
  const svc = service(awcUpstream({ fail: true }), clock);
  const { status, body } = await svc.handle('/metar', new URLSearchParams('ids=KMYR'));
  assert.equal(status, 503);
  assert.deepEqual(body, { error: WEATHER_UNAVAILABLE });
  assert.equal(WEATHER_UNAVAILABLE, 'WEATHER DATA TEMPORARILY UNAVAILABLE');
});

test('malformed file: previous good data keeps serving', async () => {
  const clock = { t: CAPTURED };
  let broken = false;
  const upstream = {
    calls: [],
    fetchImpl: async () =>
      new Response(gzipSync(Buffer.from(broken ? 'garbage' : METAR_CSV))),
  };
  const svc = service(upstream, clock);
  await svc.handle('/metar', new URLSearchParams('ids=KMYR'));
  broken = true;
  clock.t += METAR_REFRESH_MS;
  const { status, body } = await svc.handle('/metar', new URLSearchParams('ids=KMYR'));
  assert.equal(status, 200);
  assert.equal(body.metars[0].station, 'KMYR');
});

test('bad requests', async () => {
  const svc = service(awcUpstream(), { t: CAPTURED });
  assert.equal((await svc.handle('/metar', new URLSearchParams(''))).status, 400);
  assert.equal((await svc.handle('/nearest', new URLSearchParams('lat=x'))).status, 400);
  assert.equal((await svc.handle('/pirep', new URLSearchParams(''))).status, 404);
});
