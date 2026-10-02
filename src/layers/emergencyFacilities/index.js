import * as Cesium from 'cesium';
export { createEmergencyFacilitySource } from './source.js';

export const FACILITY_STYLE = Object.freeze({
  hospital: { color: '#ff4d6d' },
  fire_station: { color: '#ff8c1a' },
  police: { color: '#4d8dff' },
  ambulance_station: { color: '#ffffff' },
  shelter: { color: '#3ddc84' },
});

/**
 * Hospitals, fire stations, police, ambulance stations and emergency shelters
 * from OpenStreetMap, loaded for the view once the camera settles. Only a
 * city-sized view loads (the gateway refuses wide views), and every tile is
 * cached for 7 days.
 */
export function createEmergencyFacilitiesLayer(
  { source } = /** @type {any} */ ({}),
) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Emergency facilities require a snapshot source');
  let _viewer = null;
  let _dataSource = null;
  let _request = null;
  let _enabled = false;
  /** @type {any} */
  let _dataManager = null;
  let _facilities = [];
  let _lastUpdate = null;
  let _lastError = null;
  let _statusMessage = null;
  let _removeMoveListener = null;
  let _moveTimer = null;

  /** Half-size of the box loaded around the screen center when tilted. */
  const CENTER_HALF_DEG = 0.2;
  const MAX_SPAN_DEG = 1.2;

  /**
   * The view rectangle, or — when it is too wide (a tilted camera sees to
   * the horizon) — a box around the point at the center of the screen.
   */
  const viewBoxOf = (viewer) => {
    try {
      const d = Cesium.Math.toDegrees;
      const r = viewer?.camera?.computeViewRectangle?.();
      const box = r
        ? {
            south: d(r.south),
            west: d(r.west),
            north: d(r.north),
            east: d(r.east),
          }
        : null;
      if (
        box &&
        box.north - box.south <= MAX_SPAN_DEG &&
        box.east - box.west <= MAX_SPAN_DEG &&
        box.east > box.west
      )
        return box;
      const canvas = viewer?.scene?.canvas;
      const hit = canvas
        ? viewer.camera.pickEllipsoid(
            new Cesium.Cartesian2(
              canvas.clientWidth / 2,
              canvas.clientHeight / 2,
            ),
          )
        : null;
      const altitude = viewer?.camera?.positionCartographic?.height;
      if (!hit || !(altitude < 60_000)) return null;
      const c = Cesium.Cartographic.fromCartesian(hit);
      const lat = d(c.latitude);
      const lon = d(c.longitude);
      return {
        south: lat - CENTER_HALF_DEG,
        west: lon - CENTER_HALF_DEG,
        north: lat + CENTER_HALF_DEG,
        east: lon + CENTER_HALF_DEG,
      };
    } catch {
      return null;
    }
  };

  function render() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    for (const f of _facilities) {
      const style = FACILITY_STYLE[f.kind] || FACILITY_STYLE.shelter;
      const color = Cesium.Color.fromCssColorString(style.color);
      _dataSource.entities.add({
        id: `facility:${f.id}`,
        name: f.name || f.kindLabel,
        description: [
          f.kindLabel,
          f.emergencyDept === 'yes' ? 'Emergency department (per OSM)' : null,
          f.shelterType ? `Shelter type: ${f.shelterType}` : null,
          f.address,
          f.phone,
          f.operator,
          f.osmUrl,
          '© OpenStreetMap contributors',
        ]
          .filter(Boolean)
          .join('\n'),
        position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat),
        point: {
          pixelSize: 9,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1.5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  }

  const layer = {
    id: 'emergency-facilities',
    name: 'Emergency Facilities (OSM)',
    icon: '🏥',
    source: 'OpenStreetMap',
    updateInterval: 10 * 60_000,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('emergency-facilities');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _removeMoveListener =
        viewer.camera?.moveEnd?.addEventListener?.(() => {
          clearTimeout(_moveTimer);
          if (_enabled)
            _moveTimer = setTimeout(() => void layer.update(), 1500);
        }) || null;
    },
    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
    },
    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      clearTimeout(_moveTimer);
      if (_dataSource) _dataSource.show = false;
    },
    async update(viewer = _viewer) {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const viewBox = viewBoxOf(viewer);
        // At startup the camera may not have reached the saved view yet;
        // look again shortly instead of waiting for the next camera move.
        clearTimeout(_moveTimer);
        if (!viewBox) _moveTimer = setTimeout(() => void layer.update(), 4000);
        const snapshot = await source.getSnapshot({
          viewBox,
          signal: request.signal,
        });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _facilities = snapshot.facilities.filter(
          (f) => Number.isFinite(f.lat) && Number.isFinite(f.lon),
        );
        _lastUpdate = Date.now();
        _lastError = null;
        _statusMessage =
          snapshot.message ||
          `${snapshot.stale ? 'STALE · ' : ''}${_facilities.length} facilities in view${snapshot.missingTiles ? ` · ${snapshot.missingTiles} area(s) not loaded` : ''}`;
        render();
        _dataManager?.refreshLayerStats?.();
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _facilities = [];
        render();
        _dataManager?.refreshLayerStats?.();
        _lastError = error?.message || 'FACILITY DATA TEMPORARILY UNAVAILABLE';
        _statusMessage = null;
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },
    destroy(viewer = _viewer) {
      _request?.abort();
      clearTimeout(_moveTimer);
      _removeMoveListener?.();
      if (_dataSource && viewer) viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _viewer = null;
      _facilities = [];
      _enabled = false;
    },
    getAnalystRecords(maxCount = 2000) {
      return (_enabled ? _facilities : []).slice(0, maxCount).map((f) => ({
        layerKey: 'emergency-facilities',
        id: f.id,
        label: f.name || f.kindLabel,
        kind: f.kind,
        category: f.kindLabel,
        latitude: f.lat,
        longitude: f.lon,
        phone: f.phone,
        source: 'OpenStreetMap',
      }));
    },
    /** Keep a manager handle so background loads repaint the panel row. */
    attachDataManager(dataManager) {
      _dataManager = dataManager;
    },
    getStats() {
      return {
        count: _facilities.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
        status: _lastError ? 'error' : _facilities.length ? 'ok' : 'empty',
        statusMessage: _statusMessage,
      };
    },
  };
  return layer;
}
