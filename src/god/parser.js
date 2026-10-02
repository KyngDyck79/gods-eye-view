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
  return (
    parseStrict(text, layers) ||
    parseStrict(stripFiller(text), layers) ||
    keywordIntent(stripFiller(text))
  );
}

/** Spoken lead-ins that carry no meaning ("hey god, can you tell me…"). */
export function stripFiller(text) {
  let t = clean(text);
  let before;
  do {
    before = t;
    t = t
      .replace(
        /^(hey god|ok god|okay god|god|um+|uh+|so|and|please|can you|could you|would you|will you|i want to|i'd like to|i would like to|tell me|let me know|let me see|give me|show me)[, ]+/,
        '',
      )
      .replace(/\s+(please|for me|right now|now)$/, '');
  } while (t !== before);
  return t;
}

/**
 * Last resort for natural speech: a few unmistakable keywords. Still never a
 * guess about data; every intent here answers from live sources.
 * @param {string} t Cleaned text.
 */
export function keywordIntent(t) {
  if (!t) return null;
  const camera = cameraIntent(t);
  if (camera) return camera;
  let m;
  if (
    /\b(nearest|closest)\b.*\bairports?\b|\bairports?\b.*\b(nearest|closest|near me|nearby|around here)\b/.test(
      t,
    )
  )
    return { intent: 'nearestAirport' };
  if (/\b(that|this)\s+(plane|aircraft|flight|jet|airplane)\b/.test(t))
    return { intent: 'whatsThatPlane' };
  if (
    /\b(severe weather|weather warnings?|tornado|thunderstorm warnings?|flood warnings?|any storms?)\b/.test(
      t,
    )
  )
    return { intent: 'severeWeather' };
  if (/\bfrequenc(y|ies)\b/.test(t)) return { intent: 'atcFrequency' };
  if (/\b(listen|play|open|hear)\b.*\b(atc|tower|air traffic)\b/.test(t))
    return { intent: 'openAtcSource' };
  if (/\bcockpit\b/.test(t)) return { intent: 'openCockpit' };
  if ((m = /\bcameras?\b.*?\b(?:near|around|at|in|by)\s+(.+)$/.exec(t)))
    return { intent: 'camerasNear', ...placeRef(m[1]) };
  if (
    (m =
      /\b(?:weather|metar|forecast|temperature|conditions)\b.*?\b(?:at|in|for|near|around|over)\s+(.+)$/.exec(
        t,
      ))
  )
    return { intent: 'weather', ...placeRef(m[1]) };
  if (
    /\b(weather|metar|temperature|raining|rain|windy|wind|how hot|how cold)\b/.test(
      t,
    )
  )
    return { intent: 'weather', ref: 'here' };
  if (
    (m = /\b(?:go|fly|take me|zoom|head|jump)\s+(?:over\s+)?to\s+(.+)$/.exec(t))
  )
    return { intent: 'goTo', ...placeRef(m[1]) };
  return null;
}

const AMOUNT = (t) =>
  /\b(a (little|bit)|slightly|little|bit)\b/.test(t)
    ? 'little'
    : /\b(a lot|way|all the way|much)\b/.test(t)
      ? 'lot'
      : 'medium';

/**
 * Camera moves: zoom in/out, orbit / circle / pan around (a place), pan or
 * tilt a direction, stop, whole globe.
 * @param {string} t Cleaned text.
 */
export function cameraIntent(t) {
  let m;
  if (
    /^(stop|stop (moving|orbiting|spinning|rotating|panning|it|the camera)|hold (still|it)|freeze)$/.test(
      t,
    )
  )
    return { intent: 'camera', motion: 'stop' };
  if (
    /\b(whole (world|globe|earth|planet)|zoom (all the way )?out to (the )?(globe|earth|world))\b/.test(
      t,
    )
  )
    return { intent: 'camera', motion: 'globe' };
  if (
    /\bzoom\s*(?:the (?:map|camera)\s*)?in\b|\b(get|move|go) closer\b|\bcloser\b/.test(
      t,
    )
  )
    return {
      intent: 'camera',
      motion: 'zoom',
      direction: 'in',
      amount: AMOUNT(t),
    };
  if (
    /\bzoom\s*(?:the (?:map|camera)\s*)?out\b|\b(pull|back) (back|out|up)\b|\bfarther\b|\bfurther (out|away)\b/.test(
      t,
    )
  )
    return {
      intent: 'camera',
      motion: 'zoom',
      direction: 'out',
      amount: AMOUNT(t),
    };
  if (
    (m =
      /\b(?:circle around|spin around|fly around|pan around|go around|rotate around|look around|orbit|circle)\b(?:\s+(?:the\s+)?(.+))?$/.exec(
        t,
      ))
  ) {
    const place = (m[1] || '')
      .replace(/^(it|here|this|this area|that)$/, '')
      .trim();
    return place
      ? { intent: 'camera', motion: 'orbit', ref: 'place', place }
      : { intent: 'camera', motion: 'orbit' };
  }
  if (
    (m =
      /\b(pan|move|look|turn|rotate|tilt)\s+(left|right|up|down)\b/.test(t) &&
      /\b(pan|move|look|turn|rotate|tilt)\s+(left|right|up|down)\b/.exec(t))
  ) {
    const verb = m[1];
    const motion =
      verb === 'tilt' || (verb === 'look' && /up|down/.test(m[2]))
        ? 'tilt'
        : verb === 'turn' || verb === 'rotate'
          ? 'rotate'
          : 'pan';
    return { intent: 'camera', motion, direction: m[2] };
  }
  return null;
}

/** The exact command forms (spec 4.19). */
function parseStrict(text, layers) {
  let t = clean(text).replace(/^(hey god|god|ok god|okay god)[, ]+/, '');
  t = t
    .replace(/^(please|can you|could you|would you)\s+/, '')
    .replace(/\s+please$/, '');
  if (!t) return null;
  let m;

  const camera = cameraIntent(t);
  if (camera) return camera;

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
      /^(?:show|find|open)?\s*(?:me )?(?:the |any )?(?:traffic )?cameras? (?:near|around|at|in|by) (.+)$/.exec(
        t,
      ))
  )
    return { intent: 'camerasNear', ...placeRef(m[1]) };
  if (
    (m = /^(?:go to|fly to|take me to|zoom to|search for|search) (.+)$/.exec(
      t,
    )) &&
    !/ (near|around) /.test(m[1])
  )
    return { intent: 'goTo', ...placeRef(m[1]) };
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
