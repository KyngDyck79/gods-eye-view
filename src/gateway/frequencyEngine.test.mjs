import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAirportStore } from '../../server/providers/airports/store.js';
import {
  EN_ROUTE_NOTE,
  compassPoint,
  formatMhz,
  frequenciesOfKind,
  selectFrequency,
} from '../../server/providers/airports/frequencyEngine.js';

// Real OurAirports rows for the Grand Strand (downloaded 2026-09-29).
const AIRPORTS = `"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"
19549,"KCRE","medium_airport","Grand Strand Airport",33.8116989136,-78.72389984130001,32,"NA","US","US-SC","North Myrtle Beach","no","KCRE","CRE","KCRE","CRE",,,
20110,"KHYW","small_airport","Conway Horry County Airport",33.828499,-79.1222,35,"NA","US","US-SC","Conway","no",,,"KHYW","HYW",,,
3717,"KMYR","large_airport","Myrtle Beach International Airport",33.679699,-78.928299,25,"NA","US","US-SC","Myrtle Beach","yes","KMYR","MYR","KMYR","MYR",,,
600379,"SC10","heliport","McLeod Health Carolina Forest Heliport",33.758099,-78.853569,32,"NA","US","US-SC","Myrtle Beach","no",,,"SC10","SC10",,,
`;
const RUNWAYS = `"id","airport_ref","airport_ident","length_ft","width_ft","surface","lighted","closed","le_ident","le_latitude_deg","le_longitude_deg","le_elevation_ft","le_heading_degT","le_displaced_threshold_ft","he_ident","he_latitude_deg","he_longitude_deg","he_elevation_ft","he_heading_degT","he_displaced_threshold_ft"
243123,19549,"KCRE",5997,100,"ASP",1,0,"05",33.80599976,-78.73100281,32,46.1,,"23",33.81750107,-78.71679688,29,226.1,
242415,20110,"KHYW",4401,75,"ASP",1,0,"04",33.82329941,-79.12599945,33,31.8,,"22",33.83359909,-79.11840057,34,211.8,
241262,3717,"KMYR",9503,150,"ASP",1,0,"18",33.692501068115234,-78.93150329589844,22,168,,"36",33.66699981689453,-78.92510223388672,21,348,
`;
const FREQUENCIES = `"id","airport_ref","airport_ident","type","description","frequency_mhz"
65312,19549,"KCRE","A/D","MYRTLE BEACH APP/DEP",119.2
65313,19549,"KCRE","ATIS","ATIS",119.625
65314,19549,"KCRE","CTAF","CTAF",124.6
65315,19549,"KCRE","GND","STRAND GND",121.8
65317,19549,"KCRE","TWR","STRAND TWR",124.6
63887,20110,"KHYW","A/D","MYRTLE BEACH APP/DEP",127.4
63888,20110,"KHYW","UNIC","CTAF/UNICOM",122.7
61494,3717,"KMYR","A/D","APP/DEP",119.2
61495,3717,"KMYR","ATIS","ATIS",123.925
61497,3717,"KMYR","CLD","CLNC DEL",119.7
61498,3717,"KMYR","CTAF","CTAF",128.45
61499,3717,"KMYR","GND","GND",120.3
61500,3717,"KMYR","TWR","TWR",128.45
`;

const store = buildAirportStore({ airports: AIRPORTS, runways: RUNWAYS, frequencies: FREQUENCIES });

/** Offset a point by nautical miles north and east. */
function offset(lat, lon, northNm, eastNm) {
  return {
    lat: lat + northNm / 60,
    lon: lon + eastNm / (60 * Math.cos((lat * Math.PI) / 180)),
  };
}
const KMYR = { lat: 33.679699, lon: -78.928299 };
const KHYW = { lat: 33.828499, lon: -79.1222 };

const base = { onGround: false, gsKts: 140, trackDeg: 0, vsFpm: 0, altFt: 3000, stationarySec: 0 };

/** The scenario table required by GODS-EYE-VIEW-SPEC v2, Part 7. */
const SCENARIOS = [
  {
    name: 'ground: taxiing at KMYR',
    aircraft: { ...base, ...KMYR, onGround: true, gsKts: 12, altFt: 25 },
    expect: { facility: 'GND', mhz: 120.3, airport: 'KMYR', confidence: 'HIGH' },
  },
  {
    name: 'ground: parked more than two minutes → clearance delivery',
    aircraft: { ...base, ...offset(KMYR.lat, KMYR.lon, 0.3, 0.2), onGround: true, gsKts: 0, altFt: 25, stationarySec: 300 },
    expect: { facility: 'CLD', mhz: 119.7, airport: 'KMYR', confidence: 'HIGH' },
  },
  {
    name: 'takeoff: climbing off RWY 36, 1 nm north, 900 ft',
    aircraft: { ...base, ...offset(KMYR.lat, KMYR.lon, 1.5, 0), altFt: 900, vsFpm: 1800, trackDeg: 350 },
    expect: { facility: 'TWR', mhz: 128.45, airport: 'KMYR', confidence: 'HIGH', runway: '36' },
  },
  {
    name: 'departure: 18 nm out, climbing through 7,000 ft',
    aircraft: { ...base, ...offset(KMYR.lat, KMYR.lon, -18, 0), altFt: 7000, vsFpm: 2000, trackDeg: 180 },
    expect: { facility: 'DEP', mhz: 119.2, airport: 'KMYR', confidence: 'MEDIUM' },
  },
  {
    name: 'en route: FL350 over the Grand Strand',
    aircraft: { ...base, ...KMYR, altFt: 35000, vsFpm: 0 },
    expect: { facility: 'EN_ROUTE', mhz: null, confidence: 'LOW' },
  },
  {
    name: 'approach: 25 nm south, descending through 6,000 ft',
    aircraft: { ...base, ...offset(KMYR.lat, KMYR.lon, -25, 0), altFt: 6000, vsFpm: -1200, trackDeg: 350, destination: 'KMYR' },
    expect: { facility: 'APP', mhz: 119.2, airport: 'KMYR', confidence: 'MEDIUM' },
  },
  {
    name: 'final: 6 nm south, 2,400 ft, aligned with RWY 36',
    aircraft: { ...base, ...offset(KMYR.lat, KMYR.lon, -6, 0.15), altFt: 2425, vsFpm: -700, trackDeg: 348 },
    expect: { facility: 'TWR', mhz: 128.45, airport: 'KMYR', confidence: 'HIGH', runway: '36' },
  },
  {
    name: 'non-towered field: KHYW, not lined up, CTAF/UNICOM only',
    aircraft: { ...base, ...offset(KHYW.lat, KHYW.lon, 1, 1), altFt: 1000, vsFpm: -400, trackDeg: 120 },
    expect: { facility: 'CTAF', mhz: 122.7, airport: 'KHYW', confidence: 'LOW' },
  },
  {
    name: 'non-towered field: KHYW, lined up with RWY 22',
    aircraft: { ...base, ...offset(KHYW.lat, KHYW.lon, 1, 1), altFt: 1000, vsFpm: -400, trackDeg: 215 },
    expect: { facility: 'CTAF', mhz: 122.7, airport: 'KHYW', confidence: 'MEDIUM', runway: '22' },
  },
  {
    name: 'level at 5,000 ft, 20 nm south-east of KMYR: approach, low confidence',
    aircraft: { ...base, ...offset(KMYR.lat, KMYR.lon, -14, 14), altFt: 5000, vsFpm: 0, trackDeg: 90 },
    expect: { facility: 'APP', mhz: 119.2, airport: 'KMYR', confidence: 'LOW' },
  },
  {
    name: 'no airport within 60 nm: offshore',
    aircraft: { ...base, ...offset(KMYR.lat, KMYR.lon, -60, 70), altFt: 8000 },
    expect: { facility: 'EN_ROUTE', mhz: null, confidence: 'LOW' },
  },
];

for (const scenario of SCENARIOS) {
  test(`frequency engine — ${scenario.name}`, () => {
    const result = selectFrequency(store, scenario.aircraft);
    const { expect } = scenario;
    assert.equal(result.facility, expect.facility, result.reason);
    assert.equal(result.frequencyMHz, expect.mhz, result.reason);
    assert.equal(result.confidence, expect.confidence, result.reason);
    if (expect.airport) assert.equal(result.airport.ident, expect.airport);
    if (expect.runway) assert.equal(result.alignedRunway?.ident, expect.runway, result.reason);
    assert.equal(result.estimated, true, 'every suggestion is labeled an estimate');
    assert.match(result.reason, /\((HIGH|MEDIUM|LOW)\)$|Center\) frequency not in dataset$/);
  });
}

test('the reason reads like the spec example', () => {
  const result = selectFrequency(store, {
    ...base,
    ...offset(KMYR.lat, KMYR.lon, -6, 0.15),
    altFt: 2425,
    vsFpm: -700,
    trackDeg: 348,
  });
  assert.equal(
    result.reason,
    'Descending through 2,400 ft AGL, 6.0 nm south of KMYR, aligned with RWY 36 → Tower 128.45 (HIGH)',
  );
  assert.deepEqual(result.atis, [{ mhz: 123.925, description: 'ATIS' }]);
});

test('en-route answers say the Center frequency is not in the dataset, never a guess', () => {
  const result = selectFrequency(store, { ...base, ...KMYR, altFt: 35000 });
  assert.equal(result.note, EN_ROUTE_NOTE);
  assert.equal(result.frequencyMHz, null);
});

test('a route destination within 60 nm wins while descending', () => {
  // Between KMYR and KCRE, nearer KCRE, but filed for KMYR and descending.
  const point = offset(33.8117, -78.7239, -2, -2);
  const result = selectFrequency(store, { ...base, ...point, altFt: 2500, vsFpm: -800, trackDeg: 220, destination: 'MYR' });
  assert.equal(result.airport.ident, 'KMYR');
});

test('frequency kinds match OurAirports types and descriptions', () => {
  const kmyr = store.get('KMYR');
  assert.deepEqual(frequenciesOfKind(kmyr, 'APP').map((f) => f.mhz), [119.2]);
  assert.deepEqual(frequenciesOfKind(kmyr, 'DEP').map((f) => f.mhz), [119.2]);
  assert.deepEqual(frequenciesOfKind(store.get('KHYW'), 'CTAF').map((f) => f.mhz), [122.7]);
});

test('helpers', () => {
  assert.equal(formatMhz(119.2), '119.2');
  assert.equal(formatMhz(123.925), '123.925');
  assert.equal(compassPoint(180), 'south');
  assert.equal(compassPoint(350), 'north');
});

test('high above a field, runway alignment is ignored and the estimate is LOW', () => {
  // Found live 2026-09-30: an airliner at ~14,500 ft, 3 nm from a small field,
  // happened to track along its runway heading.
  const result = selectFrequency(store, {
    ...base,
    ...offset(KMYR.lat, KMYR.lon, -3, 0),
    altFt: 14500,
    vsFpm: -1500,
    trackDeg: 348,
  });
  assert.equal(result.alignedRunway, null);
  assert.equal(result.facility, 'APP');
  assert.equal(result.confidence, 'LOW');
  assert.doesNotMatch(result.reason, /aligned/);
});

test('above FL180 the nearest airport stays as context for its weather, with no frequency', () => {
  const result = selectFrequency(store, { ...base, ...offset(KMYR.lat, KMYR.lon, 20, 20), altFt: 37000 });
  assert.equal(result.facility, 'EN_ROUTE');
  assert.equal(result.frequencyMHz, null);
  assert.equal(result.airport.ident, 'KCRE');
  assert.match(result.reason, /^At 37,000 ft, above FL180, \d+ nm north-east of KCRE → En-route \(Center\) frequency not in dataset$/);
});
