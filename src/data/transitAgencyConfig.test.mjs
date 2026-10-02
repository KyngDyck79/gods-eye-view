import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTransitAgencies } from './transitAgencyConfig.js';
import {
  addConfiguredTransitFeeds,
  getTransitFeed,
  publicTransitCatalog,
  transitFeedsInRange,
} from './transitFeeds.js';

const example = JSON.parse(
  readFileSync(new URL('../../config/transit-agencies.example.json', import.meta.url), 'utf8'),
);

test('the shipped config is an empty list', () => {
  const shipped = JSON.parse(
    readFileSync(new URL('../../config/transit-agencies.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(shipped.agencies, []);
  assert.deepEqual(parseTransitAgencies(shipped, {}), { feeds: [], problems: [] });
});

test('the documented example needs its key, then parses', () => {
  const noKey = parseTransitAgencies(example, {});
  assert.equal(noKey.feeds.length, 0);
  assert.match(noKey.problems[0], /NEEDS KEY: add TRANSIT_KEY_WMATA/);
  const ok = parseTransitAgencies(example, { TRANSIT_KEY_WMATA: 'k123' });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.feeds[0].id, 'wmata-bus');
  assert.deepEqual(ok.feeds[0].headers, { api_key: 'k123' });
});

test('bad entries are reported, never guessed', () => {
  const base = example.agencies[0];
  const cases = [
    [{ ...base, id: 'Bad Id' }, /"id"/],
    [{ ...base, vehiclePositionsUrl: 'http://x.example/vp.pb' }, /https/],
    [{ ...base, vehiclePositionsUrl: 'https://u:p@x.example/vp.pb' }, /keyEnv/],
    [{ ...base, center: null }, /center/],
    [{ ...base, license: '' }, /required/],
    [{ ...base, keyEnv: 'OPENAI_API_KEY' }, /TRANSIT_KEY_/],
    [{ ...base, keyHeader: 'Cookie' }, /header/],
    [{ ...base, id: 'mbta' }, /already used/],
  ];
  for (const [agency, why] of cases) {
    const r = parseTransitAgencies({ agencies: [agency] }, { TRANSIT_KEY_WMATA: 'k' }, { reservedIds: ['mbta'] });
    assert.equal(r.feeds.length, 0);
    assert.match(r.problems[0], why);
  }
  assert.equal(parseTransitAgencies({ agencies: [{ ...base, enabled: false }] }, {}).problems.length, 0);
});

test('configured agencies route on the server and appear in the catalog without the key', () => {
  const { feeds } = parseTransitAgencies(example, { TRANSIT_KEY_WMATA: 'secret' });
  assert.equal(addConfiguredTransitFeeds(feeds), 1);
  assert.equal(addConfiguredTransitFeeds(feeds), 0, 'no duplicates');
  assert.equal(getTransitFeed('wmata-bus').url, 'https://api.wmata.com/gtfs/bus-gtfsrt-vehiclepositions.pb');
  assert.ok(transitFeedsInRange(38.9, -77.03).some((f) => f.id === 'wmata-bus'));
  const entry = publicTransitCatalog().find((f) => f.id === 'wmata-bus');
  assert.equal(entry.configured, true);
  assert.doesNotMatch(JSON.stringify(publicTransitCatalog()), /secret/);
});
