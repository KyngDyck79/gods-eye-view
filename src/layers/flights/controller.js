import * as Cesium from 'cesium';

export function createController({
  flightState,
  services,
  parts,
  layer,
  resolveAsset,
}) {
  function _abortActiveUpdates() {
    for (const controller of flightState.feed._activeUpdateControllers)
      controller.abort();
    flightState.feed._activeUpdateControllers.clear();
  }

  function _flightQuery(viewer) {
    const cartographic = viewer?.camera?.positionCartographic;
    if (!cartographic) return {};
    const query = {
      latitude: Cesium.Math.toDegrees(cartographic.latitude),
      longitude: Cesium.Math.toDegrees(cartographic.longitude),
    };
    // The gateway fetches only what is in view; without a rectangle (camera
    // looking at sky) it falls back to the area around the anchor above.
    let rectangle;
    try {
      rectangle = viewer.camera.computeViewRectangle?.();
    } catch {
      rectangle = undefined;
    }
    if (rectangle) {
      query.viewBox = {
        south: Cesium.Math.toDegrees(rectangle.south),
        west: Cesium.Math.toDegrees(rectangle.west),
        north: Cesium.Math.toDegrees(rectangle.north),
        east: Cesium.Math.toDegrees(rectangle.east),
      };
    }
    return query;
  }
  return { _abortActiveUpdates, _flightQuery };
}
