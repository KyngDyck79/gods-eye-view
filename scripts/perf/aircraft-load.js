/**
 * SYNTHETIC render-load test for the spec 4.29 target (5,000 aircraft at
 * ≥ 45 fps, no UI freeze > 100 ms). Browser-only and dev-only: paste into
 * the DevTools console of the running app, or run
 *   await (await import('/scripts/perf/aircraft-load.js')).runAircraftLoad()
 * It replaces /api/aircraft answers IN THIS TAB ONLY with generated contacts
 * spread over the current view, labeled "SYNTHETIC LOAD TEST", measures frame
 * rate and long tasks, then restores the real feed. Nothing is sent anywhere.
 */

export async function runAircraftLoad({
  count = 5000,
  settleMs = 15_000,
  measureMs = 10_000,
  motion = true,
} = {}) {
  const app = window.__godsEyeView;
  if (!app?.viewer) throw new Error('Open the app first');
  const { viewer, dataManager } = app;
  const Cesium = window.Cesium || (await import('cesium'));
  // Exactly `count` contacts: drop real aircraft first, and hold the camera.
  if (dataManager.layers.get('flights').enabled)
    await dataManager.setEnabled('flights', false, { origin: 'user' });
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-90, 36, 3_000_000),
  });
  await new Promise((res) => setTimeout(res, 1000));
  const r = viewer.camera.computeViewRectangle();
  const box = {
    south: Cesium.Math.toDegrees(r.south),
    north: Cesium.Math.toDegrees(r.north),
    west: Cesium.Math.toDegrees(r.west),
    east: Cesium.Math.toDegrees(r.east),
  };
  const seeds = Array.from({ length: count }, (_, i) => ({
    icao: (0xa00000 + i).toString(16),
    lat: box.south + Math.random() * (box.north - box.south),
    lon: box.west + Math.random() * (box.east - box.west),
    alt: 1000 + Math.random() * 11000,
    trk: Math.random() * 360,
    gs: 120 + Math.random() * 130,
  }));
  const realFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (!url.includes('/api/aircraft')) return realFetch(input, init);
    const now = Date.now() / 1000;
    const states = seeds.map((s) => {
      s.lat += (Math.cos((s.trk * Math.PI) / 180) * s.gs * 10) / 111_000;
      s.lon += (Math.sin((s.trk * Math.PI) / 180) * s.gs * 10) / 111_000;
      return [s.icao, `SYN${s.icao.slice(-4)}`, 'SYNTHETIC', now, now, s.lon, s.lat, s.alt, false, s.gs, s.trk, 0, null, s.alt, null, false, 0, 0, null, null, 'none'];
    });
    return new Response(
      JSON.stringify({ time: Math.floor(now), states, source: 'SYNTHETIC LOAD TEST', providerId: 'synthetic', coverage: 'synthetic', complete: true, stale: false, ageMs: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const longTasks = [];
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTasks.push(e.duration);
  });
  try {
    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    /* longtask unsupported */
  }
  try {
    await dataManager.setEnabled('flights', true, { origin: 'user' });
    await dataManager.layers.get('flights').module.update?.(viewer);
    await new Promise((res) => setTimeout(res, settleMs));
    const all = dataManager.layers.get('flights').module.getAllPositions?.(100_000) || [];
    const rendered = all.length;
    const synthetic = all.filter((p) => String(p.label || '').startsWith('SYN')).length;
    const frames = [];
    let spin = null;
    if (motion) {
      spin = () => viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, 0.0008);
      viewer.scene.preRender.addEventListener(spin);
    }
    longTasks.length = 0;
    await new Promise((resolve) => {
      const start = performance.now();
      let last = start;
      const tick = (t) => {
        frames.push(t - last);
        last = t;
        if (t - start < measureMs) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    if (spin) viewer.scene.preRender.removeEventListener(spin);
    frames.shift();
    const sorted = frames.slice().sort((a, b) => a - b);
    const avgMs = frames.reduce((a, b) => a + b, 0) / frames.length;
    return {
      label: 'SYNTHETIC LOAD TEST',
      requested: count,
      rendered,
      synthetic,
      motion,
      fpsAverage: Math.round(1000 / avgMs),
      fps5thPercentile: Math.round(1000 / sorted[Math.floor(sorted.length * 0.95)]),
      worstFrameMs: Math.round(sorted.at(-1)),
      longTasksOver100ms: longTasks.filter((d) => d > 100).length,
      longestTaskMs: Math.round(Math.max(0, ...longTasks)),
      userAgent: navigator.userAgent,
      viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
    };
  } finally {
    observer.disconnect();
    window.fetch = realFetch;
  }
}
