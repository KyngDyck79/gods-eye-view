/**
 * GOD tier 1: the deterministic command parser (GODS-EYE-VIEW-SPEC v2, 4.19).
 * Works offline and never guesses: text either matches one of the commands
 * below or returns null (and goes to the optional AI tier). Pure.
 */

/** Spoken layer names → layer ids (extended at runtime with the panel names). */
export const LAYER_SYNONYMS = Object.freeze({
  flights: 'flights',
  planes: 'flights',
  aircraft: 'flights',
  'live flights': 'flights',
  airplanes: 'flights',
  military: 'military',
  'military flights': 'military',
  ships: 'ais-live-vessels',
  vessels: 'ais-live-vessels',
  boats: 'ais-live-vessels',
  marine: 'ais-live-vessels',
  earthquakes: 'earthquakes',
  quakes: 'earthquakes',
  satellites: 'satellites',
  iss: 'satellites',
  cameras: 'cctv',
  cctv: 'cctv',
  traffic: 'traffic',
  'traffic incidents': 'traffic-incidents',
  incidents: 'traffic-incidents',
  accidents: 'traffic-incidents',
  transit: 'transit',
  buses: 'transit',
  trains: 'transit',
  warnings: 'nws-warnings',
  'weather warnings': 'nws-warnings',
  'severe weather': 'nws-warnings',
  alerts: 'nws-warnings',
  'natural events': 'natural-events',
  wildfires: 'natural-events',
  volcanoes: 'natural-events',
  hospitals: 'emergency-facilities',
  facilities: 'emergency-facilities',
  'emergency facilities': 'emergency-facilities',
  'fire stations': 'emergency-facilities',
  police: 'emergency-facilities',
  shelters: 'emergency-facilities',
  fires: 'local-firms',
  'fire detections': 'local-firms',
  radio: 'radio',
  weather: 'weather',
  radar: 'weather',
  launches: 'rocket-launches',
  'rocket launches': 'rocket-launches',
  bikes: 'bikeshare',
  bikeshare: 'bikeshare',
  cables: 'telegeography-submarine-cables',
  'submarine cables': 'telegeography-submarine-cables',
});

const clean = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Resolve a spoken layer name.
 * @param {string} spoken
 * @param {Array<{ id: string, name: string }>} [layers] Registered layers.
 * @returns {string|null}
 */
export function resolveLayer(spoken, layers = []) {
  const s = clean(spoken)
    .replace(/^(the|my)\s+/, '')
    .replace(/\s+(layer|layers|data)$/, '');
  if (!s) return null;
  if (LAYER_SYNONYMS[s]) return LAYER_SYNONYMS[s];
  const singular = s.replace(/s$/, '');
  for (const [k, v] of Object.entries(LAYER_SYNONYMS))
    if (k.replace(/s$/, '') === singular) return v;
  const byId = layers.find(
    (l) => l.id === s || l.id === s.replace(/\s+/g, '-'),
  );
  if (byId) return byId.id;
  const byName = layers.find(
    (l) => clean(l.name).replace(/\s*\(.*\)$/, '') === s,
  );
  if (byName) return byName.id;
  const partial = layers.filter((l) => clean(l.name).includes(s));
  return partial.length === 1 ? partial[0].id : null;
}

const HERE = /^(here|this area|this place|this location|me)$/;
const THERE =
  /^(there|that|it|that place|that plane|that aircraft|this plane)$/;

/** @param {string} place */
function placeRef(place) {
  const p = clean(place);
  if (!p || HERE.test(p)) return { ref: 'here' };
  if (THERE.test(p)) return { ref: 'there' };
  return { ref: 'place', place: p };
}

/**
 * @param {string} text
 * @param {{ layers?: Array<{ id: string, name: string }> }} [context]
 * @returns {null | { intent: string, [k: string]: any }}
 */
export function parseCommand(text, { layers = [] } = {}) {
  let t = clean(text).replace(/^(hey god|god|ok god|okay god)[, ]+/, '');
  t = t
    .replace(/^(please|can you|could you|would you)\s+/, '')
    .replace(/\s+please$/, '');
  if (!t) return null;
  let m;

  if (
    /^(what('?s| is) (that|this) (plane|aircraft|flight)|identify (that|this|it)( plane| aircraft)?|what plane is (that|this)|who is (that|this))$/.test(
      t,
    )
  )
    return { intent: 'whatsThatPlane' };
  if (
    /^(open|enter|show)( the)? cockpit( view| mode)?$|^cockpit( view| mode)?$/.test(
      t,
    )
  )
    return { intent: 'openCockpit' };
  if (
    /^(what('?s| is) the |show( me)? the |find the )?(nearest|closest) airport( here| to me)?$/.test(
      t,
    )
  )
    return { intent: 'nearestAirport' };
  if (
    /^(which|what)( atc)? frequency( should i (use|listen to)| is (that|this|it) on)?$|^(which|what) (tower|approach|atc|ground) frequency$|^atc frequency$/.test(
      t,
    )
  )
    return { intent: 'atcFrequency' };
  if (
    /^(open|play|start|listen to)( the)? atc( source| audio| feed)?$|^listen to (the )?tower$/.test(
      t,
    )
  )
    return { intent: 'openAtcSource' };
  if (
    /^(show|display|turn on)( the| me)? severe weather$|^severe weather$|^any severe weather$/.test(
      t,
    )
  )
    return { intent: 'severeWeather' };
  if (
    (m =
      /^(?:what(?:'?s| is) the )?(?:weather|metar|conditions)(?: (?:here|there|at|in|for|near) ?(.*))?$/.exec(
        t,
      ))
  ) {
    const where = /weather (here|there)$/.exec(t)?.[1] || m[1] || 'here';
    return { intent: 'weather', ...placeRef(where) };
  }
  if (
    (m =
      /^(?:show|find|open)?\s*(?:the )?(?:traffic )?cameras? (?:near|around|at|in|by) (.+)$/.exec(
        t,
      ))
  )
    return { intent: 'camerasNear', ...placeRef(m[1]) };
  if ((m = /^(?:track|follow|find|lock on(?: to)?) (.+)$/.exec(t))) {
    const q = m[1].replace(/^(flight|aircraft|plane|ship|vessel)\s+/, '');
    return THERE.test(q)
      ? { intent: 'track', ref: 'there' }
      : { intent: 'track', query: q };
  }
  if (
    (m =
      /^(?:show|display)(?: me)? (?:the )?(.+?) (?:near|around|at|in|by|over) (.+)$/.exec(
        t,
      ))
  ) {
    const layerId = resolveLayer(m[1], layers);
    if (layerId) return { intent: 'showLayerNear', layerId, ...placeRef(m[2]) };
  }
  if (
    (m =
      /^(toggle|turn on|turn off|switch on|switch off|show|hide|enable|disable) (?:the )?(.+?)$/.exec(
        t,
      )) ||
    (m = /^(?:turn|switch) (?:the )?(.+?) (on|off)$/.exec(t))
  ) {
    const [verb, name] =
      m[2] === 'on' || m[2] === 'off' ? [`turn ${m[2]}`, m[1]] : [m[1], m[2]];
    const layerId = resolveLayer(name, layers);
    if (!layerId) return null;
    const enabled = /^(turn on|switch on|show|enable)$/.test(verb)
      ? true
      : /^(turn off|switch off|hide|disable)$/.test(verb)
        ? false
        : null;
    return { intent: 'toggleLayer', layerId, enabled };
  }
  return null;
}
