import test from 'node:test';
import assert from 'node:assert/strict';
import { atcQueryParams, atcViewModel, reportAge } from './cockpitAtc.js';

test('cockpit info becomes aviation units for the frequency engine', () => {
  const params = atcQueryParams(
    {
      latitude: 33.58,
      longitude: -78.925,
      altitudeM: 739.14,
      velocityMps: 72,
      track: 348,
      verticalRateMps: -3.556,
      onGround: false,
      route: { origin: { code: 'CLT' }, destination: { code: 'MYR' } },
    },
    { stationarySec: 0 },
  );
  assert.equal(params.get('alt'), '2425');
  assert.equal(params.get('gs'), '140');
  assert.equal(params.get('trk'), '348');
  assert.equal(params.get('vs'), '-700');
  assert.equal(params.get('gnd'), null);
  assert.equal(params.get('orig'), 'CLT');
  assert.equal(params.get('dest'), 'MYR');
});

test('missing values are left out, not sent as zero', () => {
  const params = atcQueryParams({ latitude: 1, longitude: 2, onGround: true }, { stationarySec: 180 });
  assert.equal(params.get('alt'), null);
  assert.equal(params.get('vs'), null);
  assert.equal(params.get('gnd'), '1');
  assert.equal(params.get('still'), '180');
});

const FREQUENCY = {
  airport: { ident: 'KMYR', icao: 'KMYR', name: 'Myrtle Beach International Airport' },
  distanceNm: 6,
  runway: { ident: '36', lengthFt: 9503, distanceNm: 5.1 },
  alignedRunway: { ident: '36', lengthFt: 9503, distanceNm: 5.1 },
  facility: 'TWR',
  facilityName: 'Tower',
  frequencyMHz: 128.45,
  confidence: 'HIGH',
  atis: [{ mhz: 123.925 }],
  reason: 'Descending through 2,400 ft AGL, 6.0 nm south of KMYR, aligned with RWY 36 → Tower 128.45 (HIGH)',
};

test('ATC view shows facility, frequency, confidence, reason, METAR and TAF', () => {
  const view = atcViewModel({
    frequency: FREQUENCY,
    metar: { station: 'KMYR', flightCategory: 'VFR', ageMs: 45 * 60_000, stale: false, summary: 'Wind calm', raw: 'METAR KMYR 300253Z AUTO 00000KT 10SM CLR' },
    taf: { raw: 'TAF KMYR 292324Z 3000/3024 VRB05KT P6SM FEW060' },
  });
  assert.equal(view.airport, 'KMYR');
  assert.equal(view.runway, 'RWY 36');
  assert.equal(view.runwayDetail, 'ALIGNED · 9,503 FT · 5.1 NM');
  assert.equal(view.facility, 'TOWER');
  assert.equal(view.frequency, '128.45');
  assert.equal(view.confidence, 'HIGH CONFIDENCE · ESTIMATE');
  assert.equal(view.atis, 'ATIS 123.925');
  assert.equal(view.reason, FREQUENCY.reason);
  assert.equal(view.category, 'VFR · KMYR');
  assert.equal(view.metarAge, '45 MIN AGO');
  assert.match(view.metarRaw, /^METAR KMYR/);
  assert.match(view.tafRaw, /^TAF KMYR/);
});

test('en route: no invented frequency', () => {
  const view = atcViewModel({
    frequency: { facility: 'EN_ROUTE', facilityName: 'En route (Center)', frequencyMHz: null, confidence: 'LOW', atis: [], note: 'En-route (Center) frequency not in dataset', reason: 'At 35,000 ft → En-route (Center) frequency not in dataset' },
  });
  assert.equal(view.frequency, 'NOT IN DATASET');
  assert.equal(view.airportDetail, 'En-route (Center) frequency not in dataset');
  assert.equal(view.metarRaw, '—');
});

test('weather outage shows the message; stale METAR says STALE', () => {
  assert.equal(
    atcViewModel({ frequency: FREQUENCY, weatherError: 'WEATHER DATA TEMPORARILY UNAVAILABLE' }).metarSummary,
    'WEATHER DATA TEMPORARILY UNAVAILABLE',
  );
  const stale = atcViewModel({ frequency: FREQUENCY, metar: { station: 'KMYR', ageMs: 2 * 3_600_000, stale: true, summary: '', raw: 'x' } });
  assert.equal(stale.metarAge, '2 H AGO · STALE');
  assert.equal(reportAge(null), '—');
});
