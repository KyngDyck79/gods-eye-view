import { createTrafficIncidentsLayer } from '../../layers/trafficIncidents/index.js';
/** Wire traffic incidents to their supplied source. */
export function createApplicationTrafficIncidents(options) {
  return createTrafficIncidentsLayer(options);
}
