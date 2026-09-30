import test from 'node:test';
import assert from 'node:assert/strict';
import { cctvSourceRateLine, readCctvFpsCap } from './cctvRate.js';

test('the source line reports what the source delivers, never the viewer cap', () => {
  assert.equal(cctvSourceRateLine({ isVideo: true, feedType: 'hls', measuredFps: 14.8 }), 'Source: HLS video ~15 fps (measured)');
  assert.equal(cctvSourceRateLine({ isVideo: true, feedType: 'hls' }), 'Source: HLS video, measuring frame rate…');
  assert.equal(cctvSourceRateLine({ feedType: 'image', cadence: { intervalSec: 30 } }), 'Source: still image, new frame every ~30 s (measured)');
  assert.equal(cctvSourceRateLine({ feedType: 'image', cadence: { intervalSec: 180, everyCheck: true } }), 'Source: still image, changed at every check (~3 min); it may update faster');
  assert.match(cctvSourceRateLine({ feedType: 'mjpeg' }), /cannot be measured/);
  assert.match(cctvSourceRateLine({ feedType: 'image' }), /measuring/);
});

test('the saved cap falls back to AUTO', () => {
  assert.equal(readCctvFpsCap({ getItem: () => '10' }), '10');
  assert.equal(readCctvFpsCap({ getItem: () => 'nonsense' }), 'auto');
  assert.equal(readCctvFpsCap({ getItem() { throw new Error('blocked'); } }), 'auto');
});
