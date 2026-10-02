/**
 * GOD's view of the app: context (view, selection, layers, alerts), the
 * action runner, gateway data routes, and the tier-2 tool definitions
 * (GODS-EYE-VIEW-SPEC v2, 4.19). Every tool answers from live app data or
 * says it has none.
 */

import * as Cesium from 'cesium';
import { audioSourceStore, getAudioSources } from '../audio/sources.js';
import { createStreamPlayer } from '../audio/streamPlayer.js';
import { atcQueryParams } from '../ui/cockpitAtc.js';
import { getActiveAlerts } from '../ui/alertsPanel.js';
import { readVoiceSettings } from '../voice/local/settings.js';

const TOOL_TIMEOUT_MS = 20_000;

/**
 * @param {{ runner: (name: string, args: any, options?: any) => Promise<any>, dataManager: any, viewer: any, placeSearch?: any, fetchImpl?: typeof fetch, win?: any }} options
 */
export function createGodTools({
  runner,
  dataManager,
  viewer,
  placeSearch = null,
  fetchImpl = (i, n) => globalThis.fetch(i, n),
  win = globalThis,
}) {
  let player = null;
  const flights = () => dataManager?.layers?.get?.('flights')?.module || null;

  async function run(name, args) {
    try {
      return await runner(name, args, {
        signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
      });
    } catch (error) {
      return { ok: false, error: error?.message || `${name} failed` };
    }
  }

  async function getJson(url) {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
  }

  function context() {
    const d = Cesium.Math.toDegrees;
    let center = null;
    let viewBox = null;
    try {
      const canvas = viewer.scene.canvas;
      const hit = viewer.camera.pickEllipsoid(
        new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
      );
      if (hit) {
        const c = Cesium.Cartographic.fromCartesian(hit);
        center = { lat: d(c.latitude), lon: d(c.longitude) };
      }
      const r = viewer.camera.computeViewRectangle();
      if (r)
        viewBox = {
          south: d(r.south),
          west: d(r.west),
          north: d(r.north),
          east: d(r.east),
        };
    } catch {
      /* camera not ready */
    }
    const tracked = trackedAircraft();
    return {
      center,
      viewBox,
      cameraAltitudeM: viewer?.camera?.positionCartographic?.height ?? null,
      selection: tracked
        ? {
            kind: 'aircraft',
            label: tracked.callsign || tracked.registration || tracked.icao24,
            lat: tracked.lat,
            lon: tracked.lon,
          }
        : null,
      activeLayers: layers()
        .filter((l) => l.enabled)
        .map((l) => l.id),
      alerts: getActiveAlerts().slice(0, 10),
    };
  }

  function layers() {
    try {
      return (dataManager?.getAll?.() || []).map((l) => ({
        id: l.id,
        name: l.name,
        enabled: Boolean(l.enabled),
      }));
    } catch {
      return [];
    }
  }

  function trackedAircraft() {
    const info = flights()?.getTrackedInfo?.();
    const icao = info?.icao24;
    if (!icao) return null;
    const record = (flights()?.getAnalystRecords?.(10_000) || []).find(
      (r) => r.icao24 === icao,
    );
    return record || null;
  }

  async function findPlace(query) {
    const q = String(query || '').trim();
    if (/^[a-z0-9]{3,4}$/i.test(q)) {
      const a = await getJson(
        `/api/airports/${encodeURIComponent(q.toUpperCase())}`,
      ).catch(() => null);
      const ap = a?.airport || a;
      if (Number.isFinite(ap?.lat))
        return {
          lat: ap.lat,
          lon: ap.lon,
          label: `${ap.name} (${ap.icao || ap.ident})`,
        };
    }
    if (!placeSearch?.geocode) return null;
    try {
      const { place } = await placeSearch.geocode(q, {
        signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
      });
      return place
        ? { lat: place.lat, lon: place.lng, label: place.label || q }
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Cameras in the loaded packs within `radiusKm` of a point, nearest first,
   * plus the nearest one overall (so "none nearby" can say how far it is).
   */
  function camerasNear(point, radiusKm = 50) {
    const cams =
      dataManager?.layers?.get?.('cctv')?.module?.getDetectableObjects?.({}) ||
      [];
    const d = Cesium.Math.toDegrees;
    const list = [];
    for (const cam of cams) {
      if (!cam?.position) continue;
      const c = Cesium.Cartographic.fromCartesian(cam.position);
      if (!c) continue;
      const lat = d(c.latitude);
      const lon = d(c.longitude);
      const dLat = ((lat - point.lat) * Math.PI) / 180;
      const dLon = ((lon - point.lon) * Math.PI) / 180;
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((point.lat * Math.PI) / 180) *
          Math.cos((lat * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
      list.push({
        name: String(cam.id || '').replace(/^CAM-/, ''),
        km: 12742 * Math.asin(Math.min(1, Math.sqrt(h))),
      });
    }
    list.sort((a, b) => a.km - b.km);
    return {
      total: cams.length,
      within: list.filter((c) => c.km <= radiusKm),
      nearest: list[0] || null,
    };
  }

  const flyTo = (point, { close = false } = {}) =>
    run('fly_to_location', {
      latitude: point.lat,
      longitude: point.lon,
      viewMode: close ? 'close' : 'overview',
      rangeM: close ? 2_500 : 25_000,
      waitForArrival: true,
    });

  function frequencyQuery() {
    const info = flights()?.getTrackedInfo?.();
    // Only a tracked aircraft has a flight phase to estimate from.
    return info && Number.isFinite(info.latitude)
      ? atcQueryParams(info).toString()
      : null;
  }

  const definitions = () => [
    {
      name: 'searchObjects',
      description:
        'Find live aircraft by callsign, registration or ICAO hex in the current data.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
    {
      name: 'getAircraft',
      description:
        'Details of the tracked/selected aircraft, or one by callsign.',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    },
    {
      name: 'findNearest',
      description: 'Nearest airports to a point (default: map center).',
      parameters: {
        type: 'object',
        properties: { lat: { type: 'number' }, lon: { type: 'number' } },
      },
    },
    {
      name: 'getCameras',
      description:
        'Turn on traffic cameras and show the nearest one to the map center.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'getProviderStatus',
      description: 'Health of every data provider.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'selectObject',
      description: 'Track an object by name or callsign.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
    {
      name: 'flyTo',
      description: 'Fly the map to a place name or coordinates.',
      parameters: {
        type: 'object',
        properties: {
          place: { type: 'string' },
          lat: { type: 'number' },
          lon: { type: 'number' },
        },
      },
    },
    {
      name: 'setLayer',
      description: 'Turn a data layer on or off by id.',
      parameters: {
        type: 'object',
        properties: {
          layerId: { type: 'string', enum: layers().map((l) => l.id) },
          enabled: { type: 'boolean' },
        },
        required: ['layerId', 'enabled'],
      },
    },
    {
      name: 'openCockpit',
      description: 'Open cockpit view for the tracked aircraft.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'getRelevantFrequency',
      description:
        'Estimated ATC frequency for the tracked aircraft or the map center.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'getAudioSources',
      description: 'ATC audio sources for an airport.',
      parameters: {
        type: 'object',
        properties: { airportIcao: { type: 'string' } },
      },
    },
    {
      name: 'openAudioSource',
      description:
        'Play the best ATC audio source (user sources play; LiveATC opens externally).',
      parameters: {
        type: 'object',
        properties: { airportIcao: { type: 'string' } },
      },
    },
    {
      name: 'getMetar',
      description:
        'Latest METAR for station ids, or the nearest station to the map center.',
      parameters: { type: 'object', properties: { ids: { type: 'string' } } },
    },
    {
      name: 'getTaf',
      description: 'Latest TAF for station ids.',
      parameters: {
        type: 'object',
        properties: { ids: { type: 'string' } },
        required: ['ids'],
      },
    },
    {
      name: 'getAlerts',
      description: 'Open alerts in the ALERTS feed plus NWS warnings in view.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'getRadarStatus',
      description: 'Whether the weather radar layer is on and healthy.',
      parameters: { type: 'object', properties: {} },
    },
  ];

  async function callTool(name, args) {
    const c = context();
    const at = (p) => (p && Number.isFinite(p.lat) ? p : c.center);
    switch (name) {
      case 'searchObjects':
      case 'getAircraft': {
        const q = String(args.query || '')
          .trim()
          .toUpperCase();
        const recs = flights()?.getAnalystRecords?.(10_000) || [];
        if (!q)
          return {
            ok: true,
            aircraft: trackedAircraft(),
            fetchedAt: Date.now(),
          };
        const hits = recs
          .filter((r) =>
            [r.callsign, r.registration, r.icao24].some(
              (v) => String(v || '').toUpperCase() === q,
            ),
          )
          .slice(0, 5);
        return {
          ok: true,
          aircraft: hits,
          note: hits.length
            ? 'positionEpochMs is when each position was reported'
            : 'no match in current data',
        };
      }
      case 'findNearest': {
        const p = at(args);
        if (!p) return { ok: false, error: 'no map position' };
        return getJson(
          `/api/airports/nearest?lat=${p.lat}&lon=${p.lon}&limit=3`,
        );
      }
      case 'getCameras':
        await run('set_layer_visibility', { layerId: 'cctv', enabled: true });
        return run('control_cctv', { action: 'nearest' });
      case 'getProviderStatus':
        return getJson('/api/providers');
      case 'selectObject':
        return run('track_entity', { query: String(args.query || '') });
      case 'flyTo': {
        if (Number.isFinite(args.lat) && Number.isFinite(args.lon))
          return flyTo({ lat: args.lat, lon: args.lon });
        const p = await findPlace(args.place);
        return p
          ? flyTo(p)
          : { ok: false, error: `place not found: ${args.place}` };
      }
      case 'setLayer':
        return run('set_layer_visibility', {
          layerId: args.layerId,
          enabled: Boolean(args.enabled),
        });
      case 'openCockpit':
        return run('control_cockpit', { action: 'enter' });
      case 'getRelevantFrequency': {
        const q = frequencyQuery();
        return q
          ? getJson(`/api/airports/frequency?${q}`)
          : { ok: false, error: 'no position' };
      }
      case 'getAudioSources':
        return {
          ok: true,
          sources: audioSources({ airportIcao: args.airportIcao || null }),
        };
      case 'openAudioSource': {
        const best = audioSources({ airportIcao: args.airportIcao || null })[0];
        if (!best) return { ok: false, error: 'no source' };
        if (best.embeddable) {
          playAudio(best);
          return { ok: true, playing: best.label };
        }
        return {
          ok: openExternal(best.url),
          external: best.url,
          note: 'external link; not embedded',
        };
      }
      case 'getMetar':
        if (args.ids)
          return getJson(`/api/avwx/metar?ids=${encodeURIComponent(args.ids)}`);
        return c.center
          ? getJson(
              `/api/avwx/nearest?lat=${c.center.lat}&lon=${c.center.lon}&limit=1`,
            )
          : { ok: false };
      case 'getTaf':
        return getJson(
          `/api/avwx/taf?ids=${encodeURIComponent(String(args.ids || ''))}`,
        );
      case 'getAlerts': {
        const box = c.viewBox;
        const nws = box
          ? await getJson(
              `/api/nws/alerts?lamin=${box.south}&lomin=${box.west}&lamax=${box.north}&lomax=${box.east}`,
            ).catch((e) => ({ error: e.message }))
          : null;
        return {
          feed: getActiveAlerts(),
          nws: nws?.alerts
            ? {
                ageMs: nws.ageMs,
                alerts: nws.alerts.slice(0, 20).map((a) => ({
                  event: a.event,
                  areaDesc: a.areaDesc,
                  expires: a.expires,
                })),
              }
            : nws,
        };
      }
      case 'getRadarStatus': {
        const layer = layers().find((l) => l.id === 'weather');
        const stats =
          dataManager?.layers?.get?.('weather')?.module?.getStats?.() || null;
        return { enabled: Boolean(layer?.enabled), stats };
      }
      default:
        return { ok: false, error: `unknown tool ${name}` };
    }
  }

  function audioSources(query) {
    return getAudioSources(audioSourceStore, query);
  }
  function playAudio(source) {
    player ||= createStreamPlayer();
    void player.play(source);
  }
  function openExternal(url) {
    try {
      return Boolean(win.open(url, '_blank', 'noopener'));
    } catch {
      return false;
    }
  }

  return {
    run,
    getJson,
    context,
    layers,
    layerEnabled: (id) => Boolean(layers().find((l) => l.id === id)?.enabled),
    /** The layer's own last error, e.g. "FACILITY DATA TEMPORARILY UNAVAILABLE". */
    layerError: (id) => {
      try {
        return (
          dataManager?.layers?.get?.(id)?.module?.getStats?.()?.error || null
        );
      } catch {
        return null;
      }
    },
    trackedAircraft,
    camerasNear,
    selectedAircraft: () => null,
    findPlace,
    flyTo,
    frequencyQuery,
    audioSources,
    playAudio,
    openExternal,
    definitions,
    callTool,
    speechOptions: () => ({ flightLevels: readVoiceSettings().flightLevels }),
    describeContext: (ctx) => ({
      mapCenter: ctx.center,
      viewBox: ctx.viewBox,
      selection: ctx.selection,
      activeLayers: ctx.activeLayers,
      openAlerts: ctx.alerts,
    }),
  };
}
