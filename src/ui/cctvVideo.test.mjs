import test from 'node:test';
import assert from 'node:assert/strict';
import { createCctvVideoSurface } from './cctvVideo.js';
test('second surface uses shared decoder, caps draws, clears switch and cancels teardown', () => {
  let callback;
  let draws = 0;
  let clears = 0;
  let cancelled = 0;
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => ({ drawImage: () => draws++, clearRect: () => clears++ }),
  };
  let v = {
    readyState: 2,
    videoWidth: 1920,
    videoHeight: 1080,
    currentTime: 1,
  };
  const surface = createCctvVideoSurface(canvas, () => v, {
    requestFrame: (fn) => {
      callback = fn;
      return 1;
    },
    cancelFrame: () => cancelled++,
  });
  callback(0);
  callback(20);
  callback(80);
  assert.equal(draws, 1);
  assert.equal(canvas.width, 640);
  v = { ...v };
  callback(160);
  assert.equal(draws, 2);
  assert.equal(clears, 2);
  surface.stop();
  callback(200);
  assert.equal(cancelled, 1);
  assert.equal(draws, 2);
});

test('the frame cap limits redraws and the measured rate counts only new source frames', () => {
  let callback;
  let draws = 0;
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => ({ drawImage: () => draws++, clearRect() {} }),
  };
  const video = {
    readyState: 2,
    videoWidth: 640,
    videoHeight: 360,
    currentTime: 0,
  };
  let cap = 5;
  const surface = createCctvVideoSurface(canvas, () => video, {
    requestFrame: (fn) => ((callback = fn), 1),
    cancelFrame() {},
    getMaxFps: () => cap,
  });
  // A 10 fps source sampled by a 60 Hz display for 2 seconds.
  for (let ms = 0; ms <= 2000; ms += 1000 / 60) {
    video.currentTime = Math.floor(ms / 100) / 10;
    callback(ms);
  }
  assert.ok(
    Math.abs(surface.getMeasuredFps() - 10) < 0.6,
    `measured ${surface.getMeasuredFps()}`,
  );
  assert.ok(draws <= 11, `a 5 fps cap drew ${draws} times in 2 s`);
  cap = 30;
  const before = draws;
  for (let ms = 2000; ms <= 3000; ms += 1000 / 60) {
    video.currentTime = Math.floor(ms / 100) / 10;
    callback(ms);
  }
  assert.ok(
    draws - before >= 9,
    'raising the cap draws every new source frame',
  );
  surface.stop();
});
