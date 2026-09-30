import test from 'node:test';
import assert from 'node:assert/strict';
import { createGod } from './god.js';
import { AI_NOT_CONFIGURED, NOT_AVAILABLE } from './phrasing.js';

const NOW = 1_790_000_000_000;

function fakeTools(overrides = {}) {
  const calls = [];
  const json = {
    '/api/god/status': { configured: false },
    '/api/airports/nearest': {
      airports: [
        {
          name: 'Myrtle Beach International Airport',
          icao: 'KMYR',
          distanceNm: 1.87,
          bearingDeg: 229,
        },
      ],
    },
    '/api/avwx/nearest': {
      metars: [
        {
          station: 'KMYR',
          distanceNm: 2.1,
          ageMs: 120_000,
          stale: false,
          summary: 'Wind 120° at 7 kt',
          flightCategory: 'VFR',
        },
      ],
    },
    '/api/nws/alerts': { alerts: [], ageMs: 30_000 },
    '/api/airports/KMYR': {
      airport: {
        icao: 'KMYR',
        name: 'Myrtle Beach International Airport',
        frequencies: [
          { type: 'TWR', mhz: 128.45 },
          { type: 'CTAF', mhz: 128.45 },
          { type: 'GND', mhz: 120.3 },
          { type: 'A/D', mhz: 119.2 },
          { type: 'ATIS', mhz: 123.925 },
        ],
      },
    },
    '/api/airports/frequency': {
      frequencyMHz: 128.45,
      facility: 'TWR',
      facilityName: 'Tower',
      airport: { icao: 'KMYR' },
      reason: 'Level at 1,475 ft AGL → Tower 128.45 (MEDIUM)',
    },
    ...overrides.json,
  };
  const tools = {
    calls,
    layers: () => [
      { id: 'flights', name: 'Live Flights', enabled: true },
      { id: 'nws-warnings', name: 'Weather Warnings (NWS)', enabled: false },
    ],
    context: () => ({
      center: { lat: 33.7, lon: -78.9 },
      viewBox: { south: 33, west: -79.5, north: 34, east: -78 },
      selection: null,
      activeLayers: ['flights'],
      alerts: [],
    }),
    run: async (name, args) => {
      calls.push([name, args]);
      return (
        overrides.run?.(name, args) ?? {
          ok: true,
          label:
            name === 'set_layer_visibility' ? 'Weather Warnings (NWS)' : 'x',
        }
      );
    },
    getJson: async (url) => {
      calls.push(['GET', url]);
      const key = Object.keys(json).find((k) => url.startsWith(k));
      if (!key) throw new Error('HTTP 404');
      return json[key];
    },
    trackedAircraft: () => overrides.tracked ?? null,
    selectedAircraft: () => null,
    findPlace: async (q) =>
      q === 'kmyr'
        ? {
            lat: 33.68,
            lon: -78.93,
            label: 'Myrtle Beach International Airport (KMYR)',
          }
        : null,
    flyTo: async (p) => calls.push(['flyTo', p]),
    frequencyQuery: () => 'lat=33.7&lon=-78.9&alt=1500',
    camerasNear: () =>
      overrides.cameras ?? {
        total: 3042,
        within: [],
        nearest: { name: 'IH-35 @ SH-45', km: 1712.4 },
      },
    audioSources: () => overrides.sources ?? [],
    playAudio: (s) => calls.push(['play', s.label]),
    openExternal: () => true,
    layerEnabled: (id) => id === 'flights',
    definitions: () => [],
    callTool: async () => ({}),
    describeContext: (c) => c,
    speechOptions: () => ({}),
  };
  return tools;
}

test('nearest airport answers from OurAirports data', async () => {
  const god = createGod({ tools: fakeTools(), now: () => NOW });
  const r = await god.handle('nearest airport');
  assert.equal(r.tier, 1);
  assert.match(
    r.reply,
    /Myrtle Beach International Airport \(KMYR\), 1\.9 nm south-west/,
  );
});

test("what's that plane uses real fields, position age, and aviation speech", async () => {
  const tracked = {
    icao24: 'a1',
    callsign: 'AAL123',
    typeName: 'Boeing 737-800',
    altitudeM: 34000 / 3.28084,
    speedMps: 230,
    positionEpochMs: NOW - 8000,
  };
  const god = createGod({ tools: fakeTools({ tracked }), now: () => NOW });
  const r = await god.handle("what's that plane");
  assert.match(
    r.reply,
    /^AAL123 · Boeing 737-800 · 34000 ft · 447 kt · position 8 seconds ago$/,
  );
  assert.equal(
    r.speech,
    "That's American one two three, a Boeing 737-800, at thirty-four thousand feet, as of eight seconds ago.",
  );
  const none = await createGod({ tools: fakeTools() }).handle(
    'what is that plane',
  );
  assert.match(none.reply, /No aircraft is selected/);
});

test('weather here gives METAR age and NWS status', async () => {
  const r = await createGod({ tools: fakeTools() }).handle('weather here');
  assert.match(
    r.reply,
    /KMYR .* observed 2 minutes ago: Wind 120° at 7 kt\. VFR\. No NWS/,
  );
  assert.match(r.reply, /No NWS alerts in effect/);
});

test('weather at an airport resolves the place', async () => {
  const tools = fakeTools();
  await createGod({ tools }).handle('weather at KMYR');
  assert.ok(
    tools.calls.some(
      ([k, u]) =>
        k === 'GET' && /avwx\/nearest\?lat=33\.6800&lon=-78\.9300/.test(u),
    ),
  );
});

test('severe weather turns on warnings and counts real alerts', async () => {
  const tools = fakeTools({
    json: {
      '/api/nws/alerts': {
        ageMs: 60_000,
        alerts: [
          { event: 'Flood Warning' },
          { event: 'Flood Warning' },
          { event: 'Tornado Warning' },
        ],
      },
    },
  });
  const r = await createGod({ tools }).handle('show severe weather');
  assert.deepEqual(tools.calls[0], [
    'set_layer_visibility',
    { layerId: 'nws-warnings', enabled: true },
  ]);
  assert.match(r.reply, /2 Flood Warnings, 1 Tornado Warning/);
});

test('ATC frequency is labeled estimated; open ATC source prefers your own receiver', async () => {
  const noAircraft = fakeTools();
  noAircraft.frequencyQuery = () => null;
  const list = await createGod({ tools: noAircraft }).handle(
    'which ATC frequency',
  );
  assert.equal(
    list.reply,
    'No aircraft is tracked, so here is the nearest airport, KMYR: Tower 128.45, Ground 120.3, Approach 119.2, ATIS 123.925 (OurAirports). Track an aircraft for an estimate based on its phase of flight.',
  );
  const f = await createGod({ tools: fakeTools() }).handle(
    'which ATC frequency',
  );
  assert.match(f.reply, /Tower 128\.45.*Estimated/);
  const tools = fakeTools({
    sources: [{ label: 'My SDR', embeddable: true, credit: 'Your receiver' }],
  });
  const o = await createGod({ tools }).handle('open ATC source');
  assert.deepEqual(tools.calls.at(-1), ['play', 'My SDR']);
  assert.match(o.reply, /Playing My SDR/);
  const ext = await createGod({
    tools: fakeTools({
      sources: [
        {
          label: 'LiveATC · KMYR',
          embeddable: false,
          url: 'https://www.liveatc.net/search/?icao=KMYR',
        },
      ],
    }),
  }).handle('open ATC source');
  assert.match(ext.reply, /new tab.*never embeds/);
});

test('toggle flips the current state; show X near Y flies then enables', async () => {
  const tools = fakeTools();
  await createGod({ tools }).handle('toggle planes');
  assert.deepEqual(tools.calls[0], [
    'set_layer_visibility',
    { layerId: 'flights', enabled: false },
  ]);
  const t2 = fakeTools();
  await createGod({ tools: t2 }).handle('show warnings near KMYR');
  assert.equal(t2.calls[0][0], 'flyTo');
  assert.deepEqual(t2.calls[1], [
    'set_layer_visibility',
    { layerId: 'nws-warnings', enabled: true },
  ]);
});

test('free-form questions without an AI key get the exact phrase', async () => {
  const r = await createGod({ tools: fakeTools() }).handle(
    'how busy is the airspace over Charleston',
  );
  assert.equal(r.reply, AI_NOT_CONFIGURED);
  assert.equal(
    r.reply,
    'AI assistant not configured — add an AI key in Settings → AI.',
  );
});

test('tier 2 runs tools and answers; nothing found gives the exact phrase', async () => {
  const tools = fakeTools({
    json: { '/api/god/status': { configured: true } },
  });
  tools.callTool = async (name) =>
    name === 'getAlerts' ? { feed: [], nws: { alerts: [] } } : {};
  const turns = [
    { text: '', toolCalls: [{ id: 't1', name: 'getAlerts', args: {} }] },
    { text: NOT_AVAILABLE, toolCalls: [] },
  ];
  const sent = [];
  const fetchImpl = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify(turns.shift()), { status: 200 });
  };
  const debug = [];
  const god = createGod({
    tools,
    fetchImpl,
    onDebug: (e) => debug.push(e.kind),
  });
  const r = await god.handle('anything unusual happening');
  assert.equal(
    r.reply,
    'That information is not currently available from the connected data sources.',
  );
  assert.equal(r.tier, 2);
  assert.equal(sent[1].messages.at(-1).role, 'tool');
  assert.match(sent[0].system, /Answer only from tool results/);
  assert.deepEqual(
    debug.filter((k) => k !== 'input'),
    ['model', 'tool', 'model'],
  );
});

test('cameras near a place with none nearby says so instead of jumping away', async () => {
  const tools = fakeTools();
  const r = await createGod({ tools }).handle('cameras near KMYR');
  assert.equal(
    r.reply,
    'No traffic cameras within 50 km of Myrtle Beach International Airport (KMYR) in the connected camera sources. The nearest camera in the app is IH-35 @ SH-45, 1,712 km away.',
  );
  assert.ok(!tools.calls.some(([n]) => n === 'control_cctv'));
  const t2 = fakeTools({
    cameras: {
      total: 10,
      within: [{ name: 'Congress Ave', km: 1.2 }],
      nearest: { name: 'Congress Ave', km: 1.2 },
    },
    run: (n) =>
      n === 'control_cctv'
        ? { ok: true, activeCamera: 'Congress Ave' }
        : undefined,
  });
  const r2 = await createGod({ tools: t2 }).handle('cameras near KMYR');
  assert.equal(
    r2.reply,
    '1 camera within 50 km of Myrtle Beach International Airport (KMYR). Showing Congress Ave (1.2 km).',
  );
});
