import { createNaturalEventsLayer } from '../../layers/naturalEvents/index.js';
/** Wire NASA EONET natural events to their supplied source. */
export function createApplicationNaturalEvents(options) {
  return createNaturalEventsLayer(options);
}
