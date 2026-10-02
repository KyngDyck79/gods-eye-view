import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../../server/providers/airports/csv.js';
import { buildAirportStore } from '../../server/providers/airports/store.js';
import {
  AIRPORT_DATA_UNAVAILABLE,
  OURAIRPORTS_BASE,
  REFRESH_MS,
  createAirportService,
} from '../../server/providers/airports/index.js';
import { createProviderRegistry } from '../../server/providers/gateway/registry.js';

// Rows copied from the OurAirports CSV layout (header names are the real ones).
const AIRPORTS = `"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"
3674,"KMYR","medium_airport","Myrtle Beach International Airport",33.6797,-78.9283,25,"NA","US","US-SC","Myrtle Beach","yes","KMYR","MYR","KMYR","MYR",,,
20165,"KCRE","small_airport","Grand Strand Airport",33.8117,-78.7239,32,"NA","US","US-SC","North Myrtle Beach","no","KCRE","CRE","KCRE","CRE",,,
3622,"KCHS","large_airport","Charleston Air Force Base/International Airport",32.8986,-80.0405,46,"NA","US","US-SC","North Charleston","yes","KCHS","CHS","KCHS","CHS",,,"Joint base, ""quoted"" keyword, with comma"
999,"XCLS","closed","Closed Field",33.7,-78.9,10,"NA","US","US-SC","Nowhere","no",,,,,,,
`;
const RUNWAYS = `"id","airport_ref","airport_ident","length_ft","width_ft","surface","lighted","closed","le_ident","le_latitude_deg","le_longitude_deg","le_elevation_ft","le_heading_degT","le_displaced_threshold_ft","he_ident","he_latitude_deg","he_longitude_deg","he_elevation_ft","he_heading_degT","he_displaced_threshold_ft"
1,3674,"KMYR",9503,150,"ASP",1,0,"18",33.6917,-78.9361,25,176.9,,"36",33.6656,-78.9204,20,356.9,
`;
const FREQUENCIES = `"id","airport_ref","airport_ident","type","description","frequency_mhz"
1,3674,"KMYR","TWR","MYRTLE BEACH TWR",128.35
2,3674,"KMYR","GND","GND",121.9
3,3674,"KMYR","ATIS","ATIS",123.75
`;
const NAVAIDS = `"id","filename","ident","name","type","frequency_khz","latitude_deg","longitude_deg","elevation_ft","iso_country","dme_frequency_khz","dme_channel","dme_latitude_deg","dme_longitude_deg","dme_elevation_ft","slaved_variation_deg","magnetic_variation_deg","usageType","power","associated_airport"
1,"x","MYR","Myrtle Beach","VORTAC",114.3,33.6,-78.9,20,"US",,,,,,,,,,"KMYR"
`;

test('parseCsv handles quotes, doubled quotes, embedded commas, CRLF and a BOM', () => {
  const rows = parseCsv('﻿"a","b"\r\n1,"x, ""y"""\r\n2,\n');
  assert.deepEqual(rows, [
    { a: '1', b: 'x, "y"' },
    { a: '2', b: '' },
  ]);
});

test('store indexes codes, skips closed fields and attaches runways and frequencies', () => {
  const store = buildAirportStore({ airports: AIRPORTS, runways: RUNWAYS, frequencies: FREQUENCIES, navaids: NAVAIDS });
  assert.equal(store.counts.airports, 3);
  assert.equal(store.get('myr').ident, 'KMYR');
  assert.equal(store.get('KMYR').runways[0].ends[1].ident, '36');
  assert.deepEqual(
    store.get('KMYR').frequencies.map((f) => [f.type, f.mhz]),
    [['TWR', 128.35], ['GND', 121.9], ['ATIS', 123.75]],
  );
  assert.equal(store.get('XCLS'), null);
});

test('nearest returns airports by distance with bearing, filtered by radius and type', () => {
  const store = buildAirportStore({ airports: AIRPORTS });
  const near = store.nearest(33.70, -78.90, { radiusNm: 60 });
  assert.deepEqual(near.map((r) => r.airport.ident), ['KMYR', 'KCRE']);
  assert.ok(near[0].distanceNm < 3);
  const wide = store.nearest(33.70, -78.90, { radiusNm: 150, types: ['large_airport'] });
  assert.deepEqual(wide.map((r) => r.airport.ident), ['KCHS']);
  assert.ok(wide[0].bearingDeg > 200 && wide[0].bearingDeg < 250, 'Charleston is south-west');
});

test('search ranks an exact code first, then name and city matches', () => {
  const store = buildAirportStore({ airports: AIRPORTS });
  assert.equal(store.search('CRE')[0].ident, 'KCRE');
  assert.deepEqual(store.search('myrtle').map((a) => a.ident), ['KMYR', 'KCRE']);
  assert.deepEqual(store.search('x'), [], 'one character is too short');
});

/** In-memory fs double. */
function memoryFs(initial = {}, clock) {
  const files = new Map(Object.entries(initial).map(([k, v]) => [k, { body: v.body, mtimeMs: v.mtimeMs }]));
  return {
    files,
    async readFile(file) {
      const entry = files.get(file);
      if (!entry) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return entry.body;
    },
    async writeFile(file, body) {
      files.set(file, { body: String(body), mtimeMs: clock.t });
    },
    async stat(file) {
      const entry = files.get(file);
      if (!entry) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { mtimeMs: entry.mtimeMs };
    },
    async mkdir() {},
    async rename(from, to) {
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
}

const BODIES = {
  'airports.csv': AIRPORTS,
  'runways.csv': RUNWAYS,
  'airport-frequencies.csv': FREQUENCIES,
  'navaids.csv': NAVAIDS,
};

function service({ fs, fetchImpl, clock }) {
  return createAirportService({
    dataDir: '/cache',
    fs,
    fetchImpl,
    now: () => clock.t,
    registry: createProviderRegistry({ now: () => clock.t, env: {} }),
    env: {},
  });
}

test('first run downloads every file once, then serves lookups from memory', async () => {
  const clock = { t: Date.UTC(2026, 8, 29) };
  const fs = memoryFs({}, clock);
  const requested = [];
  const svc = service({
    fs,
    clock,
    fetchImpl: async (url) => {
      requested.push(url);
      return new Response(BODIES[url.slice(OURAIRPORTS_BASE.length)], { headers: { etag: '"v1"' } });
    },
  });
  const nearest = await svc.handle('/nearest', new URLSearchParams('lat=33.7&lon=-78.9'));
  assert.equal(nearest.status, 200);
  assert.equal(nearest.body.airports[0].ident, 'KMYR');
  assert.equal(requested.length, 4);
  assert.equal(fs.files.get('/cache/airports.csv.etag').body, '"v1"');
  const detail = await svc.handle('/MYR', new URLSearchParams());
  assert.equal(detail.body.airport.frequencies.length, 3);
  assert.equal((await svc.handle('/ZZZZ', new URLSearchParams())).status, 404);
  assert.equal((await svc.handle('/nearest', new URLSearchParams('lat=abc'))).status, 400);
  assert.equal(requested.length, 4, 'lookups never go to the network');
});

test('a weekly refresh sends If-None-Match and keeps the file on 304', async () => {
  const clock = { t: Date.UTC(2026, 8, 29) };
  const old = clock.t - REFRESH_MS - 1;
  const initial = {};
  for (const [name, body] of Object.entries(BODIES)) {
    initial[`/cache/${name}`] = { body, mtimeMs: old };
    initial[`/cache/${name}.etag`] = { body: '"v1"', mtimeMs: old };
  }
  const fs = memoryFs(initial, clock);
  const headers = [];
  const svc = service({
    fs,
    clock,
    fetchImpl: async (url, init) => {
      headers.push(init.headers['If-None-Match']);
      return new Response(null, { status: 304 });
    },
  });
  await svc.ensureLoaded();
  assert.deepEqual(headers, ['"v1"', '"v1"', '"v1"', '"v1"']);
  assert.equal(fs.files.get('/cache/airports.csv').mtimeMs, clock.t, 'weekly clock restarted');
  assert.equal(svc.state().ready, true);
});

test('offline with a cached copy: the old files are still served', async () => {
  const clock = { t: Date.UTC(2026, 8, 29) };
  const initial = {};
  for (const [name, body] of Object.entries(BODIES)) {
    initial[`/cache/${name}`] = { body, mtimeMs: clock.t - REFRESH_MS - 1 };
  }
  const svc = service({
    fs: memoryFs(initial, clock),
    clock,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  const result = await svc.handle('/search', new URLSearchParams('q=KMYR'));
  assert.equal(result.status, 200);
  assert.equal(result.body.airports[0].ident, 'KMYR');
});

test('offline on first run: an honest unavailable message, no invented airports', async () => {
  const clock = { t: Date.UTC(2026, 8, 29) };
  const svc = service({
    fs: memoryFs({}, clock),
    clock,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  const result = await svc.handle('/nearest', new URLSearchParams('lat=33.7&lon=-78.9'));
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: AIRPORT_DATA_UNAVAILABLE });
});
