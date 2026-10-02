import * as Cesium from 'cesium';
export { createTrafficIncidentSource } from './source.js';

/** Colors by incident kind (closures red, works orange, crashes magenta). */
export function incidentColor(categoryCode) {
  switch (categoryCode) {
    case 8:
      return Cesium.Color.fromCssColorString('#ff3b3b');
    case 7:
      return Cesium.Color.fromCssColorString('#ff8c42');
    case 9:
      return Cesium.Color.fromCssColorString('#ffb13b');
    case 1:
    case 14:
      return Cesium.Color.fromCssColorString('#ff4fd8');
    case 6:
      return Cesium.Color.fromCssColorString('#ffd23b');
    default:
      return Cesium.Color.fromCssColorString('#55dff5');
  }
}

/** Plain-JSON record for the analyst engine and voice. */
export function mapIncidentRecord(incident, index) {
  return {
    layerKey: 'traffic-incidents',
    id: incident.id ?? `incident-${index}`,
    label: `${incident.category}${incident.roads?.length ? ` · ${incident.roads.join(', ')}` : ''}`,
    category: incident.category,
    description: incident.description,
    from: incident.from,
    to: incident.to,
    delaySec: incident.delaySec,
    latitude: incident.lat,
    longitude: incident.lon,
    startTime: incident.startTime,
    source: 'TomTom',
  };
}

/**
 * Traffic incidents in the current view (accidents, closures, road works,
 * jams) from the gateway. Refreshed while enabled; nothing is drawn when the
 * source is unavailable, and the row says why.
 */
export function createTrafficIncidentsLayer(
  { source } = /** @type {any} */ ({}),
) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Traffic incidents require a snapshot source');
  let _viewer = null;
  let _dataSource = null;
  let _request = null;
  let _enabled = false;
  /** @type {any} */
  let _dataManager = null;
  let _incidents = [];
  let _lastUpdate = null;
  let _lastError = null;
  let _status = 'idle';
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
    for (const incident of _incidents) {
      const color = incidentColor(incident.categoryCode);
      const title = `${incident.category}${incident.roads?.length ? ` · ${incident.roads.join(', ')}` : ''}`;
      const detail = [
        incident.description,
        incident.from && incident.to
          ? `${incident.from} → ${incident.to}`
          : incident.from,
        Number.isFinite(incident.delaySec) && incident.delaySec > 0
          ? `Delay about ${Math.round(incident.delaySec / 60)} min`
          : null,
        'Source: TomTom',
      ]
        .filter(Boolean)
        .join('\n');
      _dataSource.entities.add({
        id: `traffic-incident:${incident.id}`,
        name: title,
        description: detail,
        position: Cesium.Cartesian3.fromDegrees(incident.lon, incident.lat),
        point: {
          pixelSize: 9,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1.5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        ...(incident.path?.length > 1
          ? {
              polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(
                  incident.path.flat(),
                ),
                width: 4,
                material: color.withAlpha(0.85),
                clampToGround: true,
              },
            }
          : {}),
      });
    }
  }

  const layer = {
    id: 'traffic-incidents',
    name: 'Traffic Incidents',
    icon: '⚠️',
    source: 'TomTom',
    updateInterval: 120_000,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('traffic-incidents');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      // Incidents are per view: refresh shortly after the camera settles.
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
        _incidents = snapshot.incidents.filter(
          (i) => Number.isFinite(i?.lat) && Number.isFinite(i?.lon),
        );
        _lastUpdate = Date.now();
        _lastError = null;
        _status = snapshot.zoomIn
          ? 'zoom-in'
          : _incidents.length
            ? 'ok'
            : 'empty';
        _statusMessage = snapshot.zoomIn
          ? snapshot.message || 'Zoom in to see traffic incidents'
          : _incidents.length
            ? `${snapshot.stale ? 'STALE · ' : ''}${_incidents.length} incidents in view`
            : 'No incidents reported in view';
        render();
        _dataManager?.refreshLayerStats?.();
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        // Never keep drawing old incidents as if current.
        _incidents = [];
        render();
        _dataManager?.refreshLayerStats?.();
        _lastError =
          error?.message || 'TRAFFIC INCIDENTS TEMPORARILY UNAVAILABLE';
        _status = error?.keyRequired ? 'key-required' : 'error';
        _statusMessage = null;
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      clearTimeout(_moveTimer);
      _removeMoveListener?.();
      _removeMoveListener = null;
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource && viewer) viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _viewer = null;
      _incidents = [];
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_enabled) return [];
      return _incidents.slice(0, maxCount).map(mapIncidentRecord);
    },

    /** Keep a manager handle so background loads repaint the panel row. */
    attachDataManager(dataManager) {
      _dataManager = dataManager;
    },
    getStats() {
      return {
        count: _incidents.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
        status: _status,
        statusMessage: _statusMessage,
        keyRequired: _status === 'key-required',
      };
    },
  };
  return layer;
}
