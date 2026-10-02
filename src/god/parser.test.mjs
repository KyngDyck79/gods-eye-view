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
  assert.deepEqual(p('go to KMYR'), {
    intent: 'goTo',
    ref: 'place',
    place: 'kmyr',
  });
  assert.deepEqual(p('fly to Charleston'), {
    intent: 'goTo',
    ref: 'place',
    place: 'charleston',
  });
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

test('natural speech still finds the command', () => {
  const cases = [
    ['Where is the nearest airport?', { intent: 'nearestAirport' }],
    ["what's the closest airport to me", { intent: 'nearestAirport' }],
    ['the nearest airport', { intent: 'nearestAirport' }],
    [
      'Hey God, can you tell me the weather',
      { intent: 'weather', ref: 'here' },
    ],
    [
      'How is the weather in Charleston',
      { intent: 'weather', ref: 'place', place: 'charleston' },
    ],
    ['Is it raining', { intent: 'weather', ref: 'here' }],
    ['Are there any tornado warnings', { intent: 'severeWeather' }],
    ['What kind of plane is that plane', { intent: 'whatsThatPlane' }],
    ['what frequency should I be on', { intent: 'atcFrequency' }],
    ['I want to listen to the tower', { intent: 'openAtcSource' }],
    [
      'Take me to Myrtle Beach please',
      { intent: 'goTo', ref: 'place', place: 'myrtle beach' },
    ],
    [
      'show me cameras near Austin',
      { intent: 'camerasNear', ref: 'place', place: 'austin' },
    ],
  ];
  for (const [said, want] of cases) assert.deepEqual(p(said), want, said);
  assert.equal(p('who won the game last night'), null);
});
