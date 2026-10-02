import { createNwsWarningsLayer } from '../../layers/nwsWarnings/index.js';
/** Wire NWS warning polygons to their supplied source. */
export function createApplicationNwsWarnings(options) {
  return createNwsWarningsLayer(options);
}
