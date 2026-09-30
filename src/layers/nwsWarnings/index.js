import * as Cesium from 'cesium';
export { createNwsWarningSource } from './source.js';

/**
 * NWS warning, watch and advisory polygons in view, in the official NWS
 * hazard colors. US only. Refreshed every 2 minutes and after the camera
 * settles; on failure nothing old is kept on the map.
 */
export function createNwsWarningsLayer({ source } = /** @type {any} */ ({})) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('NWS warnings require a snapshot source');
  let _viewer = null;
  let _dataSource = null;
  let _request = null;
  let _enabled = false;
  /** @type {any} */
  let _dataManager = null;
  let _alerts = [];
  let _lastUpdate = null;
  let _lastError = null;
  let _statusMessage = null;
  let _removeMoveListener = null;
  let _moveTimer = null;

  const viewBoxOf = (viewer) => {
    try {
      const r = viewer?.camera?.computeViewRectangle?.();
      if (!r) return null;
      const d = Cesium.Math.toDegrees;
      return {
        south: d(r.south),
        west: d(r.west),
        north: d(r.north),
        east: d(r.east),
      };
    } catch {
      return null;
    }
  };

  function render() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    for (const alert of _alerts) {
      const color = Cesium.Color.fromCssColorString(alert.color || '#C0C0C0');
      alert.rings.forEach((ring, i) => {
        const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());
        _dataSource.entities.add({
          id: `nws:${alert.id}:${i}`,
          name: alert.event,
          description: [alert.headline, alert.areaDesc]
            .filter(Boolean)
            .join('\n'),
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: color.withAlpha(0.22),
            classificationType: Cesium.ClassificationType.BOTH,
          },
          polyline: {
            positions,
            width: 2,
            material: color.withAlpha(0.95),
            clampToGround: true,
          },
        });
      });
    }
  }

  const layer = {
    id: 'nws-warnings',
    name: 'Weather Warnings (NWS)',
    icon: '⚠️',
    source: 'NOAA NWS',
    updateInterval: 120_000,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('nws-warnings');
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
      if (_dataSource) _dataSource.show = false;
    },
    async update(viewer = _viewer) {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({
          viewBox: viewBoxOf(viewer),
          signal: request.signal,
        });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _alerts = snapshot.alerts.filter(
          (a) => Array.isArray(a.rings) && a.rings.length,
        );
        _lastUpdate = Date.now();
        _lastError = null;
        _statusMessage = _alerts.length
          ? `${snapshot.stale ? 'STALE · ' : ''}${_alerts.length} alert areas in view`
          : 'No NWS alert areas in view (US only)';
        render();
        _dataManager?.refreshLayerStats?.();
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _alerts = [];
        render();
        _dataManager?.refreshLayerStats?.();
        _lastError = error?.message || 'WEATHER DATA TEMPORARILY UNAVAILABLE';
        _statusMessage = null;
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },
    destroy(viewer = _viewer) {
      clearTimeout(_moveTimer);
      _removeMoveListener?.();
      _request?.abort();
      if (_dataSource && viewer) viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _viewer = null;
      _alerts = [];
      _enabled = false;
    },
    /** Alerts currently drawn, most severe first (storm list, voice, analyst). */
    getAlerts() {
      return _enabled ? _alerts.slice() : [];
    },
    getAnalystRecords(maxCount = 2000) {
      return layer
        .getAlerts()
        .slice(0, maxCount)
        .map((a) => ({
          layerKey: 'nws-warnings',
          id: a.id,
          label: a.event,
          severity: a.severity,
          area: a.areaDesc,
          expires: a.expires,
          source: 'NWS',
        }));
    },
    /** Keep a manager handle so background loads repaint the panel row. */
    attachDataManager(dataManager) {
      _dataManager = dataManager;
    },
    getStats() {
      return {
        count: _alerts.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
        status: _lastError ? 'error' : _alerts.length ? 'ok' : 'empty',
        statusMessage: _statusMessage,
      };
    },
  };
  return layer;
}
