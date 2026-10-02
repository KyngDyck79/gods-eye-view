import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createFacilityService,
  facilityQuery,
  facilityTiles,
  normalizeFacility,
} from '../../server/providers/facilities/index.js';
import { createProviderRegistry } from '../../server/providers/gateway/registry.js';

test('tiles are coarse 0.5° cells covering the view', () => {
  const tiles = facilityTiles({
    lamin: 33.6,
    lomin: -79.1,
    lamax: 33.9,
    lomax: -78.7,
  });
  assert.deepEqual(
    tiles.map((t) => [t.s, t.w]),
    [
      [33.5, -79.5],
      [33.5, -79],
    ],
  );
  assert.match(
    facilityQuery(tiles[0]),
    /amenity"~"\^\(hospital\|fire_station\|police\)\$"\]\(33\.5,-79\.5,34,-79\)/,
  );
  assert.match(facilityQuery(tiles[0]), /emergency"="ambulance_station"/);
  assert.match(facilityQuery(tiles[0]), /out center tags;$/);
});

test('OSM elements normalize; bus shelters are not emergency shelters', () => {
  const h = normalizeFacility({
    type: 'way',
    id: 5,
    center: { lat: 33.7, lon: -78.9 },
    tags: {
      amenity: 'hospital',
      name: 'Grand Strand Medical Center',
      emergency: 'yes',
    },
  });
  assert.equal(h.kind, 'hospital');
  assert.equal(h.emergencyDept, 'yes');
  assert.equal(h.osmUrl, 'https://www.openstreetmap.org/way/5');
  assert.equal(
    normalizeFacility({
      type: 'node',
      id: 1,
      lat: 1,
      lon: 1,
      tags: { amenity: 'shelter', shelter_type: 'public_transport' },
    }),
    null,
  );
  assert.equal(
    normalizeFacility({
      type: 'node',
      id: 2,
      lat: 1,
      lon: 1,
      tags: { amenity: 'shelter' },
    }),
    null,
  );
  assert.equal(
    normalizeFacility({
      type: 'node',
      id: 3,
      lat: 1,
      lon: 1,
      tags: { social_facility: 'shelter' },
    }).kind,
    'shelter',
  );
  assert.equal(
    normalizeFacility({
      type: 'node',
      id: 4,
      lat: 1,
      lon: 1,
      tags: { emergency: 'ambulance_station' },
    }).kind,
    'ambulance_station',
  );
  assert.equal(
    normalizeFacility({ type: 'node', id: 6, tags: { amenity: 'police' } }),
    null,
    'no position, no facility',
  );
});

test('each tile is queried once, then served from the 7-day disk cache', async () => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'gev-fac-'));
  let calls = 0;
  const fetchPayload = async (body, _max, { endpoints }) => {
    calls += 1;
    assert.equal(endpoints[0], 'https://overpass-api.de/api/interpreter');
    assert.equal(endpoints.length, 2);
    assert.match(decodeURIComponent(body), /^data=\[out:json\]/);
    return {
      status: 200,
      body: JSON.stringify({
        elements: [
          {
            type: 'node',
            id: 9,
            lat: 33.7,
            lon: -78.9,
            tags: { amenity: 'fire_station', name: 'Station 1' },
          },
        ],
      }),
    };
  };
  const make = () =>
    createFacilityService({
      env: {},
      cacheDir,
      fetchPayload,
      registry: createProviderRegistry(),
    });
  const params = new URLSearchParams({
    lamin: '33.6',
    lomin: '-79.1',
    lamax: '33.9',
    lomax: '-78.7',
  });
  const first = await make().handle(params);
  assert.equal(first.status, 200);
  assert.equal(first.body.facilities.length, 1);
  assert.equal(calls, 2);
  assert.equal(readdirSync(cacheDir).length, 2);
  const again = await make().handle(params);
  assert.equal(again.body.facilities.length, 1);
  assert.equal(
    calls,
    2,
    'a restart reads the disk cache instead of asking Overpass',
  );
});

test('wide views are refused and the public instance can be switched off', async () => {
  const svc = createFacilityService({
    env: {},
    cacheDir: mkdtempSync(path.join(tmpdir(), 'gev-fac-')),
    fetchPayload: async () => assert.fail('no fetch'),
    registry: createProviderRegistry(),
  });
  const wide = await svc.handle(
    new URLSearchParams({
      lamin: '30',
      lomin: '-82',
      lamax: '36',
      lomax: '-76',
    }),
  );
  assert.equal(wide.body.tooWide, true);
  const off = createFacilityService({
    env: { FACILITIES_PUBLIC_OVERPASS: '0' },
    registry: createProviderRegistry(),
  });
  const saved = process.env.OVERPASS_UPSTREAMS;
  delete process.env.OVERPASS_UPSTREAMS;
  try {
    const r = await off.handle(
      new URLSearchParams({
        lamin: '33.6',
        lomin: '-79.1',
        lamax: '33.9',
        lomax: '-78.7',
      }),
    );
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'NOT_CONFIGURED');
  } finally {
    if (saved !== undefined) process.env.OVERPASS_UPSTREAMS = saved;
  }
});

test('a failed tile with nothing cached is an honest 503', async () => {
  const svc = createFacilityService({
    env: {},
    cacheDir: mkdtempSync(path.join(tmpdir(), 'gev-fac-')),
    fetchPayload: async () => ({ status: 429, body: '{}' }),
    registry: createProviderRegistry(),
  });
  const r = await svc.handle(
    new URLSearchParams({
      lamin: '33.6',
      lomin: '-78.9',
      lamax: '33.8',
      lomax: '-78.7',
    }),
  );
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'FACILITY DATA TEMPORARILY UNAVAILABLE');
});
