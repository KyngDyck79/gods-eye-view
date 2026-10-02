import * as Cesium from 'cesium';
export { createNaturalEventSource } from './source.js';

const CATEGORY_COLORS = Object.freeze({
  wildfires: '#ff6a2b',
  volcanoes: '#ff2b2b',
  severeStorms: '#55dff5',
  seaLakeIce: '#e6f7ff',
  floods: '#2b7bff',
});

/** NASA EONET open natural events worldwide (last 30 days), with storm tracks. */
export function createNaturalEventsLayer({ source } = /** @type {any} */ ({})) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Natural events require a snapshot source');
  let _viewer = null;
  let _dataSource = null;
  let _request = null;
  let _enabled = false;
  let _events = [];
  let _lastUpdate = null;
  let _lastError = null;

  function render() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    for (const event of _events) {
      const color = Cesium.Color.fromCssColorString(
        CATEGORY_COLORS[event.categoryId] || '#ffd23b',
      );
      _dataSource.entities.add({
        id: `eonet:${event.id}`,
        name: event.title,
        description: [event.category, event.magnitude, event.link]
          .filter(Boolean)
          .join('\n'),
        position: Cesium.Cartesian3.fromDegrees(event.lon, event.lat),
        point: {
          pixelSize: 10,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1.5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        ...(event.track?.length > 1
          ? {
              polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(
                  event.track.flat(),
                ),
                width: 2,
                material: color.withAlpha(0.7),
                clampToGround: true,
              },
            }
          : {}),
      });
    }
  }

  const layer = {
    id: 'natural-events',
    name: 'Natural Events (NASA EONET)',
    icon: '🌋',
    source: 'NASA EONET',
    updateInterval: 15 * 60_000,
    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('natural-events');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
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
    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const { events } = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _events = events.filter(
          (e) => Number.isFinite(e.lat) && Number.isFinite(e.lon),
        );
        _lastUpdate = Date.now();
        _lastError = null;
        render();
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _events = [];
        render();
        _lastError = error?.message || 'NATURAL EVENTS TEMPORARILY UNAVAILABLE';
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },
    destroy(viewer = _viewer) {
      _request?.abort();
      if (_dataSource && viewer) viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _viewer = null;
      _events = [];
      _enabled = false;
    },
    getAnalystRecords(maxCount = 2000) {
      return (_enabled ? _events : []).slice(0, maxCount).map((e) => ({
        layerKey: 'natural-events',
        id: e.id,
        label: e.title,
        category: e.category,
        latitude: e.lat,
        longitude: e.lon,
        source: 'NASA EONET',
        link: e.link,
      }));
    },
    getStats() {
      return {
        count: _events.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
