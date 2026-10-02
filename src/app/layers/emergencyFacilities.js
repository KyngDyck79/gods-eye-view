import { createEmergencyFacilitiesLayer } from '../../layers/emergencyFacilities/index.js';
/** Wire OpenStreetMap emergency facilities to their supplied source. */
export function createApplicationEmergencyFacilities(options) {
  return createEmergencyFacilitiesLayer(options);
}
