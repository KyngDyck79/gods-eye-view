import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFrameCadenceTracker,
  describeStillCadence,
} from '../../server/providers/cctv/cadence.js';
import { fetchCctvImageFromUpstream } from '../../server/providers/cctv/media.js';

const frame = (n) => Buffer.from(`jpeg-${n}`);

test('cadence is the median time between real content changes', () => {
  let t = 0;
  const tracker = createFrameCadenceTracker({ now: () => t });
  // Checked every 10 s; the camera publishes a new image every 30 s.
  let image = 0;
  for (let i = 0; i < 12; i += 1) {
    t = i * 10_000;
    if (i % 3 === 0) image += 1;
    tracker.observe('cam', frame(image));
  }
  const measured = tracker.describe('cam');
  assert.equal(measured.intervalSec, 30);
  assert.equal(measured.checkIntervalSec, 10);
  assert.equal(measured.everyCheck, false);
  assert.equal(describeStillCadence(measured), 'Source: still image, new frame every ~30 s (measured)');
});

test('changing at every check never reports our polling rate as the camera rate', () => {
  let t = 0;
  const tracker = createFrameCadenceTracker({ now: () => t });
  for (let i = 0; i < 5; i += 1) {
    t = i * 180_000;
    tracker.observe('cam', frame(i));
  }
  const measured = tracker.describe('cam');
  assert.equal(measured.everyCheck, true);
  assert.equal(describeStillCadence(measured), 'Source: still image, changed at every check (~3 min); it may update faster');
});

test('a 304 (null body) counts as unchanged; too few changes means still measuring', () => {
  let t = 0;
  const tracker = createFrameCadenceTracker({ now: () => t });
  tracker.observe('cam', frame(1));
  t = 60_000;
  tracker.observe('cam', null);
  assert.equal(tracker.describe('cam').intervalSec, null);
  assert.match(describeStillCadence(tracker.describe('cam')), /measuring/);
  assert.match(describeStillCadence(null), /measuring/);
});

test('conditional frame fetch: validators are sent and 304 skips the download', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init.headers);
    if (init.headers['If-None-Match'] === '"v1"') return new Response(null, { status: 304 });
    return new Response(frame(1), {
      headers: { 'content-type': 'image/jpeg', etag: '"v1"', 'last-modified': 'Wed, 30 Sep 2026 12:00:00 GMT' },
    });
  };
  const first = await fetchCctvImageFromUpstream('https://cams.example/1.jpg', { fetchImpl });
  assert.equal(first.etag, '"v1"');
  assert.equal(first.lastModified, 'Wed, 30 Sep 2026 12:00:00 GMT');
  assert.equal(calls[0]['If-None-Match'], undefined, 'unconditional without validators');
  const second = await fetchCctvImageFromUpstream('https://cams.example/1.jpg', {
    fetchImpl,
    validators: { etag: first.etag, lastModified: first.lastModified },
  });
  assert.deepEqual(second, { ok: true, notModified: true });
  assert.equal(calls[1]['If-Modified-Since'], 'Wed, 30 Sep 2026 12:00:00 GMT');
});
