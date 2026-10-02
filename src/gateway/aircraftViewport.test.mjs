import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ADSBLOL_TILES,
  TILE_RADIUS_NM,
  mergeAdsbLolTiles,
  openSkyCreditCost,
  openSkyRequestBox,
  padViewBox,
  parseViewBox,
  planAdsbLolTiles,
  planCoverCircle,
} from '../../server/providers/aircraft/viewport.js';

const NM_PER_RAD = 3440.065;

/** Great-circle distance in nautical miles (independent of the module's own). */
function distanceNm(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * NM_PER_RAD * Math.asin(Math.sqrt(a));
}

const grandStrand = { lamin: 33.3, lomin: -79.4, lamax: 34.2, lomax: -78.4 };

test('a Grand Strand view is covered by a few adsb.lol tiles inside the 250 nm limit', () => {
  const tiles = planAdsbLolTiles(padViewBox(grandStrand));
  assert.ok(tiles && tiles.length >= 1 && tiles.length <= 4, `got ${tiles?.length}`);
  for (const tile of tiles) assert.ok(tile.radiusNm <= 250);
});

test('property: every point of a small view lies inside some tile circle', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 300; i += 1) {
    const lat = -75 + rand() * 150;
    const lon = -180 + rand() * 360;
    const box = {
      lamin: Math.max(-89, lat - rand() * 3),
      lamax: Math.min(89, lat + rand() * 3),
      lomin: lon,
      lomax: ((lon + rand() * 4 + 180) % 360) - 180,
    };
    const tiles = planAdsbLolTiles(box, { maxTiles: 64 });
    assert.ok(tiles, 'small views must be tileable');
    for (let s = 0; s < 25; s += 1) {
      const pLat = box.lamin + (box.lamax - box.lamin) * rand();
      const span = box.lomax >= box.lomin ? box.lomax - box.lomin : box.lomax - box.lomin + 360;
      const pLon = ((box.lomin + span * rand() + 540) % 360) - 180;
      const covered = tiles.some((t) => distanceNm(pLat, pLon, t.lat, t.lon) <= TILE_RADIUS_NM);
      assert.ok(covered, `point ${pLat},${pLon} uncovered for box ${JSON.stringify(box)}`);
    }
  }
});

test('tiles are fixed global cells, so overlapping views share keys', () => {
  const a = planAdsbLolTiles({ lamin: 33.1, lomin: -79.3, lamax: 33.9, lomax: -78.6 });
  const b = planAdsbLolTiles({ lamin: 33.2, lomin: -79.1, lamax: 33.8, lomax: -78.7 });
  assert.deepEqual(b.map((t) => t.key), a.map((t) => t.key));
});

test('continental views exceed the tile cap and fall through to OpenSky', () => {
  assert.equal(planAdsbLolTiles({ lamin: 25, lomin: -100, lamax: 49, lomax: -66 }), null);
  assert.ok(MAX_ADSBLOL_TILES < 20);
});

test('antimeridian views are tiled on both sides', () => {
  const tiles = planAdsbLolTiles({ lamin: -18, lomin: 178, lamax: -16, lomax: -178 });
  assert.ok(tiles.some((t) => t.lon > 170) && tiles.some((t) => t.lon < -170));
});

test('OpenSky credit cost follows the documented area tiers', () => {
  assert.equal(openSkyCreditCost({ lamin: 0, lamax: 5, lomin: 0, lomax: 5 }), 1);
  assert.equal(openSkyCreditCost({ lamin: 0, lamax: 10, lomin: 0, lomax: 10 }), 2);
  assert.equal(openSkyCreditCost({ lamin: 0, lamax: 20, lomin: 0, lomax: 20 }), 3);
  assert.equal(openSkyCreditCost({ lamin: 0, lamax: 21, lomin: 0, lomax: 20 }), 4);
  assert.equal(openSkyCreditCost(null), 4);
});

test('OpenSky request boxes round outwards; global-priced boxes become global', () => {
  assert.deepEqual(openSkyRequestBox({ lamin: 33.3, lomin: -79.4, lamax: 34.2, lomax: -78.4 }), {
    lamin: 33,
    lamax: 35,
    lomin: -80,
    lomax: -78,
  });
  assert.equal(openSkyRequestBox({ lamin: -60, lomin: -170, lamax: 70, lomax: 170 }), null);
  assert.equal(openSkyRequestBox({ lamin: 0, lomin: 170, lamax: 5, lomax: -170 }), null);
});

test('parseViewBox validates input and falls back to a centre anchor', () => {
  const params = (q) => new URLSearchParams(q);
  assert.deepEqual(parseViewBox(params('lamin=33&lomin=-80&lamax=34&lomax=-78')), {
    lamin: 33,
    lomin: -80,
    lamax: 34,
    lomax: -78,
  });
  assert.equal(parseViewBox(params('lamin=40&lomin=-80&lamax=30&lomax=-78&lat=100&lon=0')), null);
  const anchored = parseViewBox(params('lat=33.7&lon=-78.9'));
  assert.ok(anchored.lamin < 33.7 && anchored.lamax > 33.7);
  assert.equal(parseViewBox(params('')), null);
});

test('mergeAdsbLolTiles dedupes by hex, keeps the newest fix and carries identity columns', () => {
  const now = 1_790_000_000;
  const merged = mergeAdsbLolTiles([
    { payload: { now: now * 1000, ac: [{ hex: 'A1B2C3', lat: 33.7, lon: -78.9, seen_pos: 9, flight: 'AAL123 ', r: 'N12345', t: 'B738', squawk: '7700', emergency: 'general', alt_baro: 3500, gs: 200, track: 180 }] } },
    { payload: { now: now * 1000, ac: [{ hex: 'a1b2c3', lat: 33.71, lon: -78.91, seen_pos: 2, flight: 'AAL123', r: 'N12345', t: 'B738', squawk: '7700', emergency: 'general', alt_baro: 3400 }] } },
    { payload: { now: now * 1000, ac: [{ hex: 'ffffff' }] } },
  ]);
  assert.equal(merged.time, now);
  assert.equal(merged.states.length, 1);
  const [row] = merged.states;
  assert.equal(row[0], 'a1b2c3');
  assert.equal(row[6], 33.71, 'the fix seen 2 s ago wins over the one seen 9 s ago');
  assert.equal(row[14], '7700');
  assert.equal(row[18], 'N12345');
  assert.equal(row[19], 'B738');
  assert.equal(row[20], 'general');
});

test('a regional view needs one adsb.lol request: a single covering circle', () => {
  const circle = planCoverCircle(padViewBox(grandStrand));
  assert.ok(circle);
  assert.ok(circle.radiusNm <= 250 && circle.radiusNm % 25 === 0);
  for (const [lat, lon] of [[33.3, -79.4], [34.2, -78.4], [33.3, -78.4], [34.2, -79.4]]) {
    assert.ok(distanceNm(lat, lon, circle.lat, circle.lon) <= circle.radiusNm);
  }
});

test('property: the covering circle contains every point of the view', () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let covered = 0;
  for (let i = 0; i < 400; i += 1) {
    const lat = -70 + rand() * 140;
    const lon = -180 + rand() * 360;
    const box = {
      lamin: lat,
      lamax: Math.min(89, lat + rand() * 6),
      lomin: lon,
      lomax: ((lon + rand() * 8 + 180) % 360) - 180,
    };
    const circle = planCoverCircle(box);
    if (!circle) continue;
    covered += 1;
    const span = box.lomax >= box.lomin ? box.lomax - box.lomin : box.lomax - box.lomin + 360;
    for (let s = 0; s < 30; s += 1) {
      const pLat = box.lamin + (box.lamax - box.lamin) * rand();
      const pLon = ((box.lomin + span * rand() + 540) % 360) - 180;
      assert.ok(
        distanceNm(pLat, pLon, circle.lat, circle.lon) <= circle.radiusNm,
        `point ${pLat},${pLon} outside ${JSON.stringify(circle)}`,
      );
    }
  }
  assert.ok(covered > 100, 'most small views get a single circle');
});

test('views wider than 250 nm from their centre get no single circle', () => {
  assert.equal(planCoverCircle({ lamin: 25, lomin: -90, lamax: 40, lomax: -70 }), null);
});
