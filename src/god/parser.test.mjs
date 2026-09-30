import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, resolveLayer } from './parser.js';

const layers = [
  { id: 'flights', name: 'Live Flights' },
  { id: 'nws-warnings', name: 'Weather Warnings (NWS)' },
  { id: 'emergency-facilities', name: 'Emergency Facilities (OSM)' },
  { id: 'cctv', name: 'Cameras' },
];
const p = (t) => parseCommand(t, { layers });

test('every spec 4.19 command parses', () => {
  assert.deepEqual(p('track DAL45'), { intent: 'track', query: 'dal45' });
  assert.deepEqual(p('Track flight AAL123.'), {
    intent: 'track',
    query: 'aal123',
  });
  assert.deepEqual(p('track it'), { intent: 'track', ref: 'there' });
  assert.deepEqual(p('show hospitals near Myrtle Beach'), {
    intent: 'showLayerNear',
    layerId: 'emergency-facilities',
    ref: 'place',
    place: 'myrtle beach',
  });
  assert.deepEqual(p('show flights near here'), {
    intent: 'showLayerNear',
    layerId: 'flights',
    ref: 'here',
  });
  assert.deepEqual(p('open cockpit'), { intent: 'openCockpit' });
  assert.deepEqual(p('nearest airport'), { intent: 'nearestAirport' });
  assert.deepEqual(p("what's the closest airport"), {
    intent: 'nearestAirport',
  });
  assert.deepEqual(p("what's that plane"), { intent: 'whatsThatPlane' });
  assert.deepEqual(p('weather here'), { intent: 'weather', ref: 'here' });
  assert.deepEqual(p('weather there'), { intent: 'weather', ref: 'there' });
  assert.deepEqual(p('weather at KMYR'), {
    intent: 'weather',
    ref: 'place',
    place: 'kmyr',
  });
  assert.deepEqual(p('show severe weather'), { intent: 'severeWeather' });
  assert.deepEqual(p('cameras near KMYR'), {
    intent: 'camerasNear',
    ref: 'place',
    place: 'kmyr',
  });
  assert.deepEqual(p('show cameras near Austin'), {
    intent: 'camerasNear',
    ref: 'place',
    place: 'austin',
  });
  assert.deepEqual(p('which ATC frequency'), { intent: 'atcFrequency' });
  assert.deepEqual(p('open ATC source'), { intent: 'openAtcSource' });
  assert.deepEqual(p('toggle earthquakes'), {
    intent: 'toggleLayer',
    layerId: 'earthquakes',
    enabled: null,
  });
  assert.deepEqual(p('turn off the planes'), {
    intent: 'toggleLayer',
    layerId: 'flights',
    enabled: false,
  });
  assert.deepEqual(p('turn weather warnings on'), {
    intent: 'toggleLayer',
    layerId: 'nws-warnings',
    enabled: true,
  });
  assert.deepEqual(p('Hey God, toggle cameras'), {
    intent: 'toggleLayer',
    layerId: 'cctv',
    enabled: null,
  });
});

test('free-form questions are not guessed', () => {
  assert.equal(p('how many planes are over the ocean right now'), null);
  assert.equal(p('toggle the flux capacitor'), null);
  assert.equal(p(''), null);
});

test('layer names resolve from synonyms and panel names', () => {
  assert.equal(
    resolveLayer('Emergency Facilities', layers),
    'emergency-facilities',
  );
  assert.equal(resolveLayer('the warnings layer', layers), 'nws-warnings');
  assert.equal(resolveLayer('ship', layers), 'ais-live-vessels');
  assert.equal(resolveLayer('nothing like this', layers), null);
});
