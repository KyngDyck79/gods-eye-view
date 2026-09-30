import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAlertFeed,
  nwsAlerts,
  providerAlerts,
  quakeAlerts,
  squawkAlerts,
} from './engine.js';

const ALL_ON = { squawk: { on: true, voice: true }, nws: { on: true, voice: false }, quake: { on: true, voice: false }, providers: { on: true, voice: false } };

test('emergency squawks produce neutral alerts', () => {
  const alerts = squawkAlerts([
    { icao24: 'a1', callsign: 'N12345', squawk: '7700', lat: 33.7, lon: -78.9 },
    { icao24: 'a2', callsign: 'DAL45', squawk: '1200' },
    { icao24: 'a3', registration: 'N9', squawk: '2000', emergency: 'minfuel' },
  ]);
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].title, 'Squawk 7700 reported by N12345');
  assert.match(alerts[0].detail, /may be set in error|can be set in error/);
  assert.doesNotMatch(alerts.map((a) => a.title + a.detail).join(' '), /!|MAYDAY|crash/i);
  assert.equal(alerts[1].title, 'Emergency status "minfuel" reported by N9');
});

test('only the three spec’d NWS warning kinds alert', () => {
  const alerts = nwsAlerts([
    { id: '1', event: 'Tornado Warning', areaDesc: 'Horry, SC', bbox: [-79, 33, -78, 34] },
    { id: '2', event: 'Flood Warning', areaDesc: 'x' },
    { id: '3', event: 'Flash Flood Warning', areaDesc: 'y' },
  ]);
  assert.deepEqual(alerts.map((a) => a.title), ['Tornado Warning', 'Flash Flood Warning']);
  assert.equal(alerts[0].lat, 33.5);
});

test('earthquakes filter by magnitude and radius', () => {
  const quake = (id, mag, lon, lat) => ({ id, properties: { mag, place: id, time: 0 }, geometry: { coordinates: [lon, lat, 10] } });
  const alerts = quakeAlerts(
    [quake('near-big', 5.1, -79, 33), quake('near-small', 3.0, -79, 33), quake('far-big', 6.5, 140, 35)],
    { center: { lat: 33.7, lon: -78.9 }, minMag: 4.5, radiusKm: 500 },
  );
  assert.deepEqual(alerts.map((a) => a.id), ['quake:near-big']);
});

test('provider health alerts', () => {
  const alerts = providerAlerts([
    { id: 'adsblol', name: 'ADSB.lol', status: 'OFFLINE' },
    { id: 'opensky', name: 'OpenSky Network', status: 'ONLINE' },
    { id: 'awc', name: 'AviationWeather.gov', status: 'RATE_LIMITED' },
  ]);
  assert.deepEqual(alerts.map((a) => a.title), ['ADSB.lol is offline', 'AviationWeather.gov is rate limited']);
});

test('the feed de-duplicates, timestamps, clears, and never reads an alert twice', () => {
  let t = 1000;
  const spoken = [];
  const feed = createAlertFeed({ now: () => t, speak: (s) => spoken.push(s) });
  const squawk = squawkAlerts([{ icao24: 'a1', callsign: 'N12345', squawk: '7700' }]);
  feed.update(['squawk'], squawk, ALL_ON);
  t = 2000;
  feed.update(['squawk'], squawk, ALL_ON);
  assert.equal(feed.list().length, 1);
  assert.equal(feed.list()[0].firstSeenAt, 1000);
  assert.equal(spoken.length, 1);
  t = 3000;
  feed.update(['squawk'], [], ALL_ON);
  assert.equal(feed.list()[0].cleared, true);
  assert.equal(feed.activeCount(), 0);
  t = 4000;
  feed.update(['squawk'], squawk, ALL_ON);
  assert.equal(spoken.length, 1, 'a returning alert is not read again');
});

test('rules that are off produce nothing; voice only when enabled', () => {
  const spoken = [];
  const feed = createAlertFeed({ speak: (s) => spoken.push(s) });
  feed.update(['providers'], providerAlerts([{ id: 'x', name: 'X', status: 'OFFLINE' }]), { ...ALL_ON, providers: { on: false, voice: true } });
  assert.equal(feed.list().length, 0);
  feed.update(['nws'], nwsAlerts([{ id: '1', event: 'Tornado Warning' }]), ALL_ON);
  assert.equal(feed.list().length, 1);
  assert.equal(spoken.length, 0);
});
